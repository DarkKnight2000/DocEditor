<script>
    import Quill from "quill";
    import { Delta } from "quill";
    import "quill/dist/quill.snow.css";
    import { onDestroy, onMount, tick } from "svelte";
    import "$lib/styles/quill-editor.css";
    import { page } from "$app/state";
    import { dev } from "$app/environment";
    import { createClientState, applyInit, applyLocalChange, takeOutgoing, applyAck, applyServerRev, exceedsCharLimit } from "$lib/sync_client.js";
    import { TEXT_STYLES, styleOfFormat, formatsForStyle } from "$lib/text_styles.js";

    // sync status to show in nav bar
    let { sync_status = $bindable('Connecting…'), doc_id, ws_token, doc_name = $bindable(), noperm_dialog } = $props();

    const MessageTypes = {
        CLIENT_ID: 0,
        CLIENT_REV: 1,
        SERVER_REV: 2,
        SERVER_ACK: 3,
        SERVER_INIT: 4,
        SERVER_DOC_RENAME: 5,
        SERVER_DROP_ACCESS: 6,
        SERVER_DOC_LIMIT: 7
    };

    const ClientState = createClientState();

    // document length limit, sent by the server in SERVER_INIT
    let max_chars = $state(Infinity);
    let char_count = $state(0);
    let limit_hit = $state(false);
    let limit_hit_timer = -1;
    function flash_limit()
    {
        limit_hit = true;
        clearTimeout(limit_hit_timer);
        limit_hit_timer = setTimeout(() => limit_hit = false, 2500);
    }

    /** @type {Quill | null} */
    let quill_instance = null;
    // style of the line(s) at the cursor, shown in the style dropdown ('' when mixed)
    let current_style = $state('text');
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
        let interval_id = -1;
        let ws_server_address = `ws://${page.url.host}/api`;
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
                },
                keyboard: {
                    bindings: {
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
                                if (style !== "title" && style !== "subtitle") return true;   // Quill's default
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

        // keep the style dropdown in step with the line at the cursor
        quill.on("editor-change", () => {
            const range = quill.getSelection();
            if(range) current_style = styleOfFormat(quill.getFormat(range));
        });

        // characters typed, not counting the newline Quill always keeps at the end
        const text_length = () => quill.getLength() - 1;

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
        <!-- Text style: presets of size, bold, italic and alignment (see text_styles.js) -->
        <span class="ql-formats">
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
            <!-- <button class="ql-color" title="Clean button" value="super"></button>
            <button class="ql-background" title="Clean button" value="super"></button> -->
            <button class="ql-clean" title="Clean button" value="super"></button>
        </span>
        {#if max_chars !== Infinity}
            <span class="ql-formats text-xs whitespace-nowrap {limit_hit ? 'text-red-600 font-bold' : 'text-gray-400'}"
                title="Documents can have up to {max_chars} characters">
                {char_count} / {max_chars}{limit_hit ? ' (limit reached)' : ''}
            </span>
        {/if}
    </div>
    </div>
    <!-- grey desk with a white page on it -->
    <div class="flex-1 overflow-y-auto bg-gray-50 px-3 sm:px-6 py-6 sm:py-10">
        <div class="max-w-3xl mx-auto bg-white rounded-sm border border-gray-200 shadow-sm min-h-full">
            <div id="editor" class="text-black text-left"></div>
        </div>
    </div>
</div>
