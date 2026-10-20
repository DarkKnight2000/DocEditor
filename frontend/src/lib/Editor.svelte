<script>
    import Quill from "quill";
    import { Delta } from "quill";

    // Text sizes the style menu uses (text_styles.js): Quill's own small, large and huge, plus Raya's
    // xlarge for Heading, between Title (huge) and Subtitle (large)
    const SizeClass = /** @type {any} */ (Quill.import("attributors/class/size"));
    SizeClass.whitelist = ["small", "large", "xlarge", "huge"];
    Quill.register(SizeClass, true);
    import "quill/dist/quill.snow.css";
    import { onDestroy, onMount, tick } from "svelte";
    import "$lib/styles/quill-editor.css";
    import { page } from "$app/state";
    import { dev } from "$app/environment";
    import { createClientState, applyInit, applyLocalChange, takeOutgoing, applyAck, applyServerRev, exceedsCharLimit, cursorForServer, cursorFromServer, screenLength } from "$lib/sync_client.js";
    import RemoteCursors from "$lib/RemoteCursors.svelte";
    import { insertPageBreak, removePageBreakAt } from "$lib/page_break.js";
    import PageBreakIcon from "@iconify-svelte/material-symbols/insert-page-break-outline-rounded";
    import { insertTable, inTable, TABLE_ACTIONS, runTableAction } from "$lib/table.js";
    import TableIcon from "@iconify-svelte/material-symbols/table-outline-rounded";
    import { TEXT_STYLES, styleOfFormat, formatsForStyle } from "$lib/text_styles.js";
    import { buildOutline, activeOutlineItem } from "$lib/outline.js";
    import OutlineIcon from "@iconify-svelte/material-symbols/toc-rounded";
    import ClosePaneIcon from "@iconify-svelte/material-symbols/left-panel-close-outline-rounded";

    // sync status to show in nav bar
    // others: the other people who have the document open, sent by the server
    let { sync_status = $bindable('Connecting…'), doc_id, ws_token, doc_name = $bindable(), others = $bindable([]), noperm_dialog } = $props();

    const MessageTypes = {
        CLIENT_ID: 0,
        CLIENT_REV: 1,
        SERVER_REV: 2,
        SERVER_ACK: 3,
        SERVER_INIT: 4,
        SERVER_DOC_RENAME: 5,
        SERVER_DROP_ACCESS: 6,
        SERVER_DOC_LIMIT: 7,
        SERVER_PRESENCE: 8,
        CLIENT_CURSOR: 9,
        SERVER_CURSOR: 10,
        SERVER_RESYNC: 11
    };

    const ClientState = createClientState();

    // other people's cursors, as positions on this screen (see RemoteCursors.svelte)
    /** @type {{ client: string, user: string, name: string, index: number, length: number, moved: number }[]} */
    let remote_cursors = $state([]);

    // document length limit, sent by the server in SERVER_INIT
    let max_chars = $state(Infinity);
    let char_count = $state(0);
    let limit_hit = $state(false);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let limit_hit_timer;
    function flash_limit()
    {
        limit_hit = true;
        clearTimeout(limit_hit_timer);
        limit_hit_timer = setTimeout(() => limit_hit = false, 2500);
    }

    /** @type {Quill | null} */
    let quill_instance = null;

    /**
     * The document's contents as Quill ops, e.g. for downloading it (call through bind:this)
     * @returns {any[]}
     */
    export function get_contents()
    {
        return quill_instance?.getContents().ops ?? [];
    }
    // style of the line(s) at the cursor, shown in the style dropdown ('' when mixed)
    let current_style = $state('text');
    // whether the cursor is in a table (shows the Table menu), and where the cursor last was: the menu
    // takes the focus from the editor, and the table actions need the cursor's cell
    let in_table = $state(false);
    /** @type {{ index: number, length: number } | null} */
    let last_range = null;
    // Outline pane: the document's Titles and Subtitles
    /** @type {import('$lib/outline.js').OutlineItem[]} */
    let outline = $state([]);
    let active_heading = $state(-1);
    // open by default on wide screens; the viewer's choice is remembered in this browser
    let outline_open = $state(false);
    const OUTLINE_PREF = 'raya.outline_open';

    function set_outline_open(/** @type {boolean} */ open)
    {
        outline_open = open;
        try { localStorage.setItem(OUTLINE_PREF, open ? '1' : '0'); } catch {}
    }

    // rebuild the outline shortly after edits, at most every 150ms while typing
    // (a timer rather than requestAnimationFrame, which browsers pause in background tabs)
    /** @type {ReturnType<typeof setTimeout> | null} */
    let outline_timer = null;
    function schedule_outline()
    {
        if(outline_timer) return;
        outline_timer = setTimeout(() => {
            outline_timer = null;
            if(quill_instance) outline = buildOutline(quill_instance.getContents().ops);
            update_active_heading();
        }, 150);
    }

    function update_active_heading()
    {
        const range = quill_instance?.getSelection();
        if(range) active_heading = activeOutlineItem(outline, range.index);
    }

    /**
     * Scrolls to a heading and puts the cursor at its start
     * @param {import('$lib/outline.js').OutlineItem} item
     */
    function go_to_heading(item)
    {
        const quill = quill_instance;
        if(!quill) return;
        const [line] = quill.getLine(item.index);
        quill.setSelection(item.index, 0, 'silent');
        quill.focus();
        line?.domNode?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        update_active_heading();
        // on narrow screens the pane covers the page, so get it out of the way
        if(!matchMedia('(min-width: 1024px)').matches) set_outline_open(false);
    }

    // The style dropdown is only rendered once Quill exists: Quill's theme replaces every <select>
    // in the toolbar with its own picker when it starts, which would hide our option labels
    let quill_ready = $state(false);

    /**
     * Applies a text style (Title, Subtitle, Text, Tiny) to every line touched by the selection
     * @param {string} style
     */
    function apply_text_style(style)
    {
        const quill = quill_instance;
        if(!quill) return;
        const range = quill.getSelection(true);         // also puts focus back in the editor
        const lines = (range.length ? quill.getLines(range.index, range.length) : [quill.getLine(range.index)[0]]).filter(Boolean);
        const first = lines[0], last = lines[lines.length - 1];
        if(!first || !last) return;
        const start = quill.getIndex(first);
        const end = quill.getIndex(last) + last.length() - 1;     // up to, not including, the last newline

        const before = styleOfFormat(quill.getFormat(start, Math.max(end - start, 1)));
        const { inline, align } = formatsForStyle(style, before);

        if(end > start) quill.formatText(start, end - start, inline, 'user');
        if(align !== undefined) quill.formatLine(start, Math.max(end - start, 1), 'align', align, 'user');
        // an empty line has no text to format yet: set the formats for what gets typed next
        if(range.length === 0)
        {
            for(const [name, value] of Object.entries(inline)) quill.format(name, value, 'user');
        }
        quill.setSelection(range.index, range.length, 'silent');
        current_style = style;
    }


    onMount(() => {
        // websocket
        /** @type {ReturnType<typeof setInterval> | undefined} */
        let interval_id;
        // same host as the page; an https page must use wss, or the browser blocks the socket
        const ws_protocol = page.url.protocol === 'https:' ? 'wss' : 'ws';
        let ws_server_address = `${ws_protocol}://${page.url.host}/api`;
        if(dev)
        {
            ws_server_address = `ws://localhost:8000/api`;
        }
        const socket = new WebSocket(`${ws_server_address}/edit-socket/${doc_id}`);
        const client_id = crypto.randomUUID();
        socket.addEventListener("open", () => {
            // first message authenticates the socket; the server closes it if the token is invalid
            socket.send(JSON.stringify({ type: MessageTypes.CLIENT_ID, id: client_id, token: ws_token }));
            sync_status = 'Connecting…';
        });
        socket.addEventListener("close", () => {
            sync_status = 'Offline';
            others = [];      // no longer know who's here
            remote_cursors = [];
        });
        socket.addEventListener("error", (err) => {
            console.log("Web socket error: ", err);
            sync_status = "Can't connect";
        });

        // editor
        const quill = new Quill("#editor", {
            theme: "snow",
            modules: {
                // syntax: true,
                toolbar: {
                    container: "#editor-toolbar",
                    handlers: {
                        /** @this {any} */
                        pagebreak() { insertPageBreak(this.quill); },
                        // a list or a cleared line inside a table would turn its cell into a plain line and break
                        // the table, so inside tables these only touch the text, not the line
                        /** @this {any} */
                        list(/** @type {any} */ value) {
                            if(!inTable(this.quill)) this.quill.format("list", value, "user");
                        },
                        /** @this {any} */
                        clean() {
                            const range = this.quill.getSelection();
                            if(!range) return;
                            const inline = ["bold", "italic", "underline", "strike", "script", "link", "size", "color", "background"];
                            if(!range.length)
                            {
                                // like Quill's own: with no selection, only the formats for what's typed next
                                for(const name of inline) this.quill.format(name, false, "user");
                            }
                            else if(inTable(this.quill, range))
                            {
                                this.quill.formatText(range.index, range.length, Object.fromEntries(inline.map((n) => [n, false])), "user");
                            }
                            else
                            {
                                this.quill.removeFormat(range.index, range.length, "user");
                            }
                        },
                    },
                },
                table: true,
                keyboard: {
                    bindings: {
                        // Ctrl+Enter (Cmd+Enter on a Mac) inserts a page break, as in Word and Google Docs
                        page_break: {
                            key: "Enter",
                            shortKey: true,
                            /** @this {any} */
                            handler() {
                                insertPageBreak(this.quill);
                                return false;
                            },
                        },
                        // Backspace at the start of the line after a page break, or Delete at the end of the
                        // line before one, removes just the break. Quill's own handlers would join the lines
                        // and give the text line the break's (empty) formats, losing e.g. a Title's centring.
                        page_break_backspace: {
                            key: "Backspace",
                            collapsed: true,
                            offset: 0,
                            /** @this {any} */
                            handler(/** @type {any} */ range) {
                                return !removePageBreakAt(this.quill, range.index - 1);
                            },
                        },
                        page_break_delete: {
                            key: "Delete",
                            collapsed: true,
                            suffix: /^$/,
                            /** @this {any} */
                            handler(/** @type {any} */ range) {
                                return !removePageBreakAt(this.quill, range.index + 1);
                            },
                        },
                        // Enter at the end of a Title or Subtitle line starts a plain Text line instead of
                        // carrying the heading on, like headings in other editors. (Enter in the middle of a
                        // heading keeps both halves as heading.) Runs before Quill's own Enter handler.
                        heading_enter: {
                            key: "Enter",
                            collapsed: true,
                            suffix: /^$/,
                            /** @this {any} */
                            handler(/** @type {any} */ range, /** @type {any} */ context) {
                                const style = styleOfFormat(context.format);
                                if (style !== "title" && style !== "heading" && style !== "subtitle") return true;   // Quill's default
                                const editor = this.quill;
                                // the heading line keeps its line formats (e.g. Title's centring) ...
                                const keep = context.format.align ? { align: context.format.align } : {};
                                // ... and the new line gets none of the heading's formatting
                                const clear = { align: null, size: null, bold: null, italic: null };
                                editor.updateContents(new Delta().retain(range.index).insert("\n", keep).retain(1, clear), "user");
                                editor.setSelection(range.index + 1, 0, "silent");
                                return false;
                            },
                        },
                    },
                },
            },
            placeholder: "Start typing...",
        });
        // read-only until SERVER_INIT gives us the document and its revision
        let initialized = false;
        quill.disable();
        quill_instance = quill;
        quill_ready = true;

        // Ctrl+click (Cmd+click on a Mac) opens a link in a new tab, as in Word and Google Docs. A plain
        // click still just places the cursor and shows Quill's link bubble. Only web and email links open.
        quill.root.addEventListener("click", (/** @type {MouseEvent} */ event) => {
            if(!(event.ctrlKey || event.metaKey)) return;
            const link = /** @type {Element} */ (event.target).closest?.("a[href]");
            if(!link || !quill.root.contains(link)) return;
            const href = link.getAttribute("href") ?? "";
            if(!/^(https?:|mailto:)/i.test(href)) return;
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
        });
        // while Ctrl/Cmd is held, links show the hand pointer (quill-editor.css), hinting they can be opened
        const set_links_openable = (/** @type {boolean} */ on) => quill.container.classList.toggle("links-openable", on);
        const on_modifier = (/** @type {KeyboardEvent} */ event) => set_links_openable(event.ctrlKey || event.metaKey);
        const on_blur = () => set_links_openable(false);
        window.addEventListener("keydown", on_modifier);
        window.addEventListener("keyup", on_modifier);
        window.addEventListener("blur", on_blur);

        /**
         * 'title', 'heading' or 'subtitle' when the line's first text is huge, xlarge or large (as the outline
         * and the style menu decide), otherwise null. Big words later in a normal line don't make it a heading.
         * @param {Element} el a line of the editor
         */
        function heading_level(el)
        {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node;
            while((node = walker.nextNode()) && !node.textContent) {}
            const sized = node?.parentElement?.closest('.ql-size-huge, .ql-size-xlarge, .ql-size-large');
            if(!sized || !el.contains(sized)) return null;
            return sized.classList.contains('ql-size-huge') ? 'title'
                : sized.classList.contains('ql-size-xlarge') ? 'heading' : 'subtitle';
        }

        // Space around Title, Heading and Subtitle lines, more above (a new section) than below (its own text);
        // a heading at the top of a page sits flush with the page margin. CSS alone can't tell
        // whether a line *starts* with big text, so the lines are picked here, into a stylesheet of their own.
        const HEADING_SPACE = { title: ['1.75rem', '0.75rem'], heading: ['1.5rem', '0.6rem'], subtitle: ['1.25rem', '0.5rem'] };
        const heading_style = document.createElement('style');
        document.head.appendChild(heading_style);
        function space_headings()
        {
            const rules = [...quill.root.children].flatMap((el, i) => {
                const level = el.tagName === 'P' ? heading_level(el) : null;
                if(!level) return [];
                const [above, below] = HEADING_SPACE[level];
                // at the top of the first page or of a page after a page break it sits flush with the margin
                const page_top = i === 0 || el.previousElementSibling?.classList.contains('page-break');
                return [`#editor .ql-editor > :nth-child(${i + 1}) { margin-top: ${page_top ? '0' : above}; margin-bottom: ${below}; }`];
            }).join('\n');
            if(heading_style.textContent !== rules) heading_style.textContent = rules;
        }

        // Quill updates the page before it reports a change, so spacing the headings right away means the
        // screen never shows the old spacing on the new lines (e.g. after Enter shifts every line's position)
        quill.on("text-change", space_headings);

        // Send this cursor to the others when it moves, at most every 150ms, as a position in the
        // server's document (sync_client.js). Unchanged positions aren't sent again.
        /** @type {ReturnType<typeof setTimeout> | null} */
        let cursor_timer = null;
        let last_cursor = '';
        function send_cursor()
        {
            cursor_timer = null;
            if(!initialized || socket.readyState !== socket.OPEN) return;
            const range = quill.getSelection();
            if(!range) return;      // not focused: the others keep seeing the last position
            const cursor = cursorForServer(ClientState, range);
            const key = `${cursor.index}:${cursor.length}:${cursor.rev}`;
            if(key === last_cursor) return;
            last_cursor = key;
            socket.send(JSON.stringify({ type: MessageTypes.CLIENT_CURSOR, ...cursor }));
        }

        // keep the style dropdown in step with the line at the cursor
        quill.on("editor-change", (/** @type {string} */ event_name) => {
            const range = quill.getSelection();
            if(range)
            {
                current_style = styleOfFormat(quill.getFormat(range));
                in_table = inTable(quill, range);
                last_range = range;
            }
            if(event_name === "text-change") schedule_outline();
            else update_active_heading();
            if(cursor_timer === null) cursor_timer = setTimeout(send_cursor, 150);
        });

        // Other people's cursors move with every change on screen. Edits typed here don't push a
        // cursor sitting at the same spot (priority), edits from others do, like their own typing.
        quill.on("text-change", (/** @type {any} */ delta, /** @type {any} */ _old, /** @type {string} */ source) => {
            if(!remote_cursors.length) return;
            const mine = source === "user";
            remote_cursors = remote_cursors.map((c) => {
                const start = delta.transformPosition(c.index, mine);
                const end = delta.transformPosition(c.index + c.length, mine);
                return { ...c, index: start, length: Math.max(0, end - start) };
            });
        });

        // outline pane: remembered choice, otherwise open on wide screens
        let saved_pref = null;
        try { saved_pref = localStorage.getItem(OUTLINE_PREF); } catch {}
        outline_open = saved_pref !== null ? saved_pref === '1' : matchMedia('(min-width: 1024px)').matches;

        // characters typed, not counting the newline Quill always keeps at the end
        const text_length = () => quill.getLength() - 1;

        // The editor and the sync state (A, X, Y in sync_client.js) must always describe the same document.
        // If they ever drift apart, changes sent from here wouldn't fit the server's copy, so stop and
        // reload from the saved document instead of sending them.
        let resyncing = false;
        function check_in_step(/** @type {string} */ after)
        {
            if(resyncing || screenLength(ClientState) === quill.getLength()) return;
            console.error(`Raya: the editor no longer matches the sync state (after ${after}); reloading`);
            resync();
        }
        function resync()
        {
            if(resyncing) return;
            resyncing = true;
            sync_status = 'Out of sync, reloading…';
            quill.disable();
            setTimeout(() => location.reload(), 1500);
        }

        quill.on("text-change", (delta, oldContents, source) => {
            if (source == "api") {
                char_count = text_length();
                return;
            }
            const old_length = oldContents.length() - 1;
            if (exceedsCharLimit(old_length, text_length(), max_chars)) {
                // Undo the edit as a normal user change, so Quill's undo history and the sync state
                // record both the edit and its reversal (they cancel out) and stay consistent
                applyLocalChange(ClientState, delta);
                quill.updateContents(delta.invert(oldContents), "user");
                const at = typeof delta.ops[0]?.retain === "number" ? delta.ops[0].retain : 0;
                quill.setSelection(Math.min(at, text_length()), 0, "silent");
                flash_limit();
                return;
            }
            char_count = text_length();
            applyLocalChange(ClientState, delta);
            check_in_step("a local change");
        });

        // event loop
        interval_id = setInterval(() => {
            if (socket.readyState !== socket.OPEN || !initialized) return;
            // have new content and received ack for previously sent content
            const outgoing = takeOutgoing(ClientState);
            if (outgoing) {
                socket.send(JSON.stringify({ type: MessageTypes.CLIENT_REV, ...outgoing }));
                sync_status = 'Saving…'
            }
        }, 500);

        // receive content from server
        socket.addEventListener("message", (event) => {
            try {
                const recv_data = JSON.parse(event.data);
                if (recv_data.type == MessageTypes.SERVER_ACK) {
                    // accepted my changes
                    applyAck(ClientState, recv_data.rev);
                    sync_status = 'Saved';
                } else if (recv_data.type == MessageTypes.SERVER_REV) {
                    // other client changes
                    const B = new Delta(JSON.parse(recv_data.content));
                    const D = applyServerRev(ClientState, B, recv_data.rev);
                    quill.updateContents(D, "api");
                    check_in_step("someone else's change");
                } else if (recv_data.type == MessageTypes.SERVER_INIT) {
                    applyInit(ClientState, recv_data.content, recv_data.rev);
                    max_chars = recv_data.max_chars ?? Infinity;
                    quill.setContents(ClientState.A);
                    char_count = text_length();
                    initialized = true;
                    quill.enable();
                    quill.focus();
                    sync_status = 'Saved';
                } else if (recv_data.type == MessageTypes.SERVER_DOC_RENAME) {
                    // rename state variable in parent
                    doc_name = recv_data.name;
                } else if (recv_data.type == MessageTypes.SERVER_DROP_ACCESS) {
                    // removed as a collaborator, or "deleted" when the owner deleted the document
                    noperm_dialog(recv_data.reason);
                } else if (recv_data.type == MessageTypes.SERVER_DOC_LIMIT) {
                    // Edits from several people together went over the limit and the server refused
                    // this one. Reload to get back in sync with the saved document.
                    flash_limit();
                    sync_status = 'Document is full, reloading…';
                    quill.disable();
                    setTimeout(() => location.reload(), 2000);
                } else if (recv_data.type == MessageTypes.SERVER_RESYNC) {
                    // the server refused a change from here that didn't fit its copy of the document
                    resync();
                } else if (recv_data.type == MessageTypes.SERVER_PRESENCE) {
                    others = recv_data.users;
                } else if (recv_data.type == MessageTypes.SERVER_CURSOR) {
                    // another tab's cursor moved, or (index null) it closed
                    const rest = remote_cursors.filter((c) => c.client !== recv_data.client);
                    const at = recv_data.index == null ? null : cursorFromServer(ClientState, recv_data);
                    remote_cursors = at
                        ? [...rest, { client: recv_data.client, user: recv_data.user, name: recv_data.name, ...at, moved: Date.now() }]
                        : recv_data.index == null ? rest : remote_cursors;
                } else {
                    console.warn("Unknown message from server: ", recv_data);
                }
            } catch (error) {
                console.error("Error handling message from server:", error, event.data);
                sync_status = 'Error saving';
            }
        });

        // called during unmount
        return () => {
            clearInterval(interval_id);
            socket.close();
            heading_style.remove();
            window.removeEventListener("keydown", on_modifier);
            window.removeEventListener("keyup", on_modifier);
            window.removeEventListener("blur", on_blur);
        };
    });

    // onDestroy(() => {
    //     clearInterval(interval_id);
    // });
</script>

<div class="flex-1 min-h-0 flex flex-col">
    <!-- full-width bar under the header; the toolbar's own light top line is only as wide as the toolbar -->
    <div class="flex justify-center bg-white border-b border-gray-200 px-2">
    <div
        id="editor-toolbar"
        class="flex flex-wrap items-center justify-center gap-y-1 px-4 py-1.5 max-w-full text-sm text-black"
    >
        <!-- Text style: presets of size, bold, italic and alignment (see text_styles.js).
             Below laptop width the outline toggle lives here, where it can't cover the page. -->
        <span class="ql-formats">
            <button type="button" class="outline-toggle" aria-label={outline_open ? 'Hide outline' : 'Show outline'}
                title={outline_open ? 'Hide outline' : 'Show outline'} aria-pressed={outline_open}
                onclick={() => set_outline_open(!outline_open)}>
                <OutlineIcon class="w-5 h-5" aria-hidden="true" />
            </button>
            {#if quill_ready}
                <select class="text-style-picker" aria-label="Text style" title="Text style"
                    value={current_style} onchange={(e) => apply_text_style(e.currentTarget.value)}>
                    {#if current_style === ''}
                        <option value="" disabled>Custom</option>
                    {/if}
                    {#each TEXT_STYLES as style}
                        <option value={style.id}>{style.label}</option>
                    {/each}
                </select>
            {/if}
        </span>
        <!-- Add a bold button -->
        <span class="ql-formats">
            <button class="ql-bold" title="Bold button"></button>
            <button class="ql-italic" title="Italic button"></button>
            <button class="ql-underline" title="Underline button"></button>
            <button class="ql-strike" title="Strike button"></button>
            <!-- Text colour and highlight: Quill turns these into colour pickers. The first, empty option
                 removes the colour. A small palette that reads well on white (Tailwind's 600s for text,
                 200s for highlights). -->
            <select class="ql-color" title="Text colour">
                <option selected></option>
                {#each ['#4b5563', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777'] as color}
                    <option value={color}></option>
                {/each}
            </select>
            <select class="ql-background" title="Highlight colour">
                <option selected></option>
                {#each ['#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#e9d5ff', '#bfdbfe', '#99f6e4', '#bbf7d0', '#e5e7eb'] as color}
                    <option value={color}></option>
                {/each}
            </select>
        </span>
        <!-- Add subscript and superscript buttons -->
        <span class="ql-formats">
            <button class="ql-script" title="Superscript button" value="super"></button>
            <button class="ql-script" title="Subscript button" value="sub"></button>
        </span>
        <span class="ql-formats">
            <select class="ql-align">
                <option selected></option>
                <option value="center"></option>
                <option value="right"></option>
                <option value="justify"></option>
            </select>
            <button class="ql-list" title="Ordered list button" value="ordered"></button>
            <button class="ql-list" title="Unordered list button" value="bullet"></button>
            <button class="ql-link" title="Add link button" value="bullet"></button>
        </span>
        <span 
        class="ql-formats">
            <!-- <button class="ql-code-block" title="Clean button" value="super"></button> -->
            <!-- the table controls aren't Quill toolbar formats: mousedown is cancelled so the editor keeps focus -->
            <button type="button" class="table-insert" title={in_table ? "Tables can't be put inside tables" : 'Insert table'}
                aria-label="Insert table" disabled={in_table}
                onmousedown={(e) => e.preventDefault()} onclick={() => quill_instance && insertTable(quill_instance)}>
                <TableIcon aria-hidden="true" />
            </button>
            {#if in_table}
                <select class="text-style-picker table-actions" aria-label="Table" title="Change the table" value=""
                    onchange={(e) => {
                        const action = e.currentTarget.value;
                        e.currentTarget.value = '';
                        if(quill_instance && last_range) runTableAction(quill_instance, action, last_range);
                    }}>
                    <option value="" disabled>Table</option>
                    {#each TABLE_ACTIONS as action}
                        <option value={action.id}>{action.label}</option>
                    {/each}
                </select>
            {/if}
            <button type="button" class="ql-pagebreak" title="Page break (Ctrl+Enter)" aria-label="Insert page break">
                <PageBreakIcon aria-hidden="true" />
            </button>
            <button class="ql-clean" title="Clean button" value="super"></button>
        </span>
        {#if max_chars !== Infinity}
            <span class="ql-formats char-counter text-xs whitespace-nowrap {limit_hit ? 'text-red-600 font-bold' : 'text-gray-400'}"
                title="Documents can have up to {max_chars} characters">
                {char_count} / {max_chars}{limit_hit ? ' (limit reached)' : ''}
            </span>
        {/if}
    </div>
    </div>
    <div class="flex-1 min-h-0 flex relative">
        <!-- on phones the character count sits in a corner instead of taking a toolbar row -->
        {#if max_chars !== Infinity}
            <div class="sm:hidden absolute bottom-3 right-4 z-10 pointer-events-none px-2 py-0.5 rounded-md bg-white/90 border border-gray-200 text-xs whitespace-nowrap {limit_hit ? 'text-red-600 font-bold' : 'text-gray-400'}"
                aria-hidden="true">
                {char_count} / {max_chars}{limit_hit ? ' (limit reached)' : ''}
            </div>
        {/if}
        <!-- Outline pane: beside the page on wide screens, over it on narrow ones -->
        {#if outline_open}
            <aside class="absolute lg:static inset-y-0 left-0 z-20 w-64 shrink-0 flex flex-col bg-white lg:bg-gray-50 border-r border-gray-200 shadow-lg lg:shadow-none"
                aria-label="Document outline">
                <div class="flex items-center justify-between px-4 pt-4 pb-2">
                    <p class="text-xs font-bold uppercase tracking-wide text-gray-400">Outline</p>
                    <button class="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200 cursor-pointer"
                        aria-label="Hide outline" title="Hide outline" onclick={() => set_outline_open(false)}>
                        <ClosePaneIcon class="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>
                <nav class="flex-1 overflow-y-auto px-2 pb-4">
                    {#each outline as item, i (item.index)}
                        <button class="block w-full text-left rounded-md py-1.5 pr-2 truncate cursor-pointer
                                {item.level === 1 ? 'pl-2 font-bold text-gray-800'
                                    : item.level === 2 ? 'pl-4 font-semibold text-gray-700' : 'pl-7 text-sm text-gray-600'}
                                {i === active_heading ? 'bg-yellow-100' : 'hover:bg-gray-200'}"
                            title={item.text} aria-current={i === active_heading ? 'location' : undefined}
                            onclick={() => go_to_heading(item)}>
                            {item.text}
                        </button>
                    {:else}
                        <p class="px-2 text-sm text-gray-400">Titles, headings and subtitles you add will appear here.</p>
                    {/each}
                </nav>
            </aside>
        {:else}
            <!-- wide screens only; narrower ones use the toolbar toggle -->
            <button class="absolute top-3 left-3 z-10 hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                aria-label="Show outline" title="Show outline" onclick={() => set_outline_open(true)}>
                <OutlineIcon class="w-5 h-5" aria-hidden="true" />
                Outline
            </button>
        {/if}

        <!-- grey desk with a white page on it -->
        <div class="flex-1 min-w-0 overflow-y-auto bg-gray-50 px-3 sm:px-6 py-6 sm:py-10">
            <div class="relative max-w-3xl mx-auto bg-white rounded-sm border border-gray-200 shadow-sm min-h-full">
                <div id="editor" class="text-black text-left"></div>
                {#if quill_ready}
                    <RemoteCursors quill={quill_instance} cursors={remote_cursors} />
                {/if}
            </div>
        </div>
    </div>
</div>
