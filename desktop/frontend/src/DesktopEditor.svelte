<script>
    // The web app's editor (frontend/src/lib/Editor.svelte) for one local file: the same Quill setup,
    // toolbar and outline, without syncing, other people's cursors or the length limit.
    import "quill/dist/quill.snow.css";
    import { onMount } from "svelte";
    import "$lib/styles/quill-editor.css";
    import { createQuill } from "$lib/quill_setup.js";
    import PageBreakIcon from "@iconify-svelte/material-symbols/insert-page-break-outline-rounded";
    import { insertTable, inTable, TABLE_ACTIONS, runTableAction } from "$lib/table.js";
    import TableIcon from "@iconify-svelte/material-symbols/table-outline-rounded";
    import { TEXT_STYLES, styleOfFormat, formatsForStyle } from "$lib/text_styles.js";
    import { buildOutline, activeOutlineItem } from "$lib/outline.js";
    import OutlineIcon from "@iconify-svelte/material-symbols/toc-rounded";
    import ClosePaneIcon from "@iconify-svelte/material-symbols/left-panel-close-outline-rounded";
    import { BrowserOpenURL } from "../wailsjs/runtime/runtime.js";

    /**
     * ops: the document's contents when it opens
     * onchange: called on every edit made here
     * @type {{ ops: any[], onchange: () => void }}
     */
    let { ops, onchange } = $props();

    /** @type {import("quill").default | null} */
    let quill_instance = null;

    /**
     * The document's contents as Quill ops, for saving and exporting (call through bind:this)
     * @returns {any[]}
     */
    export function get_contents()
    {
        return quill_instance?.getContents().ops ?? [];
    }

    export function focus()
    {
        quill_instance?.focus();
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
    // open by default on wide windows; the choice is remembered
    let outline_open = $state(false);
    const OUTLINE_PREF = 'raya.outline_open';

    function set_outline_open(/** @type {boolean} */ open)
    {
        outline_open = open;
        try { localStorage.setItem(OUTLINE_PREF, open ? '1' : '0'); } catch {}
    }

    // rebuild the outline shortly after edits, at most every 150ms while typing
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
        // on narrow windows the pane covers the page, so get it out of the way
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
        // links open in the computer's browser, not inside the app
        const { quill, destroy } = createQuill("#editor", { toolbar: "#editor-toolbar", openLink: BrowserOpenURL });
        quill_instance = quill;
        quill_ready = true;

        quill.setContents(ops, "api");
        quill.history.clear();       // opening the file isn't something to undo

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
        });
        quill.on("text-change", (_delta, _old, source) => {
            if(source === "user") onchange();
        });
        schedule_outline();

        // outline pane: remembered choice, otherwise open on wide windows
        let saved_pref = null;
        try { saved_pref = localStorage.getItem(OUTLINE_PREF); } catch {}
        outline_open = saved_pref !== null ? saved_pref === '1' : matchMedia('(min-width: 1024px)').matches;

        quill.focus();

        return () => {
            if(outline_timer) clearTimeout(outline_timer);
            destroy();
        };
    });
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
        <span class="ql-formats">
            <button class="ql-bold" title="Bold (Ctrl+B)"></button>
            <button class="ql-italic" title="Italic (Ctrl+I)"></button>
            <button class="ql-underline" title="Underline (Ctrl+U)"></button>
            <button class="ql-strike" title="Strikethrough"></button>
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
        <span class="ql-formats">
            <button class="ql-script" title="Superscript" value="super"></button>
            <button class="ql-script" title="Subscript" value="sub"></button>
        </span>
        <span class="ql-formats">
            <select class="ql-align" title="Alignment">
                <option selected></option>
                <option value="center"></option>
                <option value="right"></option>
                <option value="justify"></option>
            </select>
            <button class="ql-list" title="Numbered list" value="ordered"></button>
            <button class="ql-list" title="Bulleted list" value="bullet"></button>
            <button class="ql-link" title="Link (Ctrl+click a link to open it)"></button>
        </span>
        <span class="ql-formats">
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
            <button class="ql-clean" title="Clear formatting"></button>
        </span>
    </div>
    </div>
    <div class="flex-1 min-h-0 flex relative">
        <!-- Outline pane: beside the page on wide windows, over it on narrow ones -->
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
            <!-- wide windows only; narrower ones use the toolbar toggle -->
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
            </div>
        </div>
    </div>
</div>
