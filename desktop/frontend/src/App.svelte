<script>
    import { onMount } from 'svelte';
    import DesktopEditor from './DesktopEditor.svelte';
    import logo from '$web_static/favicon.svg';
    import { StartupFile, SetDirty, Quit, OpenDialog, Open, Save, SaveAs, ExportDocx, RecentFiles, ForgetRecent, ShowInFolder } from '../wailsjs/go/main/App.js';
    import { EventsOn, WindowSetTitle } from '../wailsjs/runtime/runtime.js';

    import AddIcon from '@iconify-svelte/material-symbols/add-rounded';
    import FolderOpenIcon from '@iconify-svelte/material-symbols/folder-open-outline-rounded';
    import DocIcon from '@iconify-svelte/material-symbols/description-outline-rounded';
    import SaveIcon from '@iconify-svelte/material-symbols/save-outline-rounded';
    import DownloadIcon from '@iconify-svelte/material-symbols/download-rounded';
    import SavedIcon from '@iconify-svelte/material-symbols/check-circle-outline-rounded';
    import EditedIcon from '@iconify-svelte/material-symbols/edit-outline-rounded';
    import CloseIcon from '@iconify-svelte/material-symbols/close-rounded';

    /**
     * The open document, or null on the start screen. path is '' until a new document is first saved.
     * @type {{ path: string, name: string, ops: any[] } | null}
     */
    let doc = $state(null);
    // changes on screen that aren't in the file yet
    let dirty = $state(false);
    let busy = $state(false);
    // a new editor for every document opened, so nothing (e.g. undo history) carries over
    let doc_key = $state(0);
    /** @type {any} the editor component, for its contents */
    let editor = $state();

    /** @type {{ path: string, name: string, opened: string }[]} */
    let recent = $state([]);
    let error_message = $state('');
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let error_timer;

    /** @param {unknown} error */
    function show_error(error)
    {
        error_message = String(error);
        clearTimeout(error_timer);
        error_timer = setTimeout(() => error_message = '', 6000);
    }

    // the window title, as other editors show it: the name, with a dot while there are unsaved changes
    $effect(() => {
        WindowSetTitle(doc ? `${dirty ? '• ' : ''}${doc.name} — Raya` : 'Raya');
    });
    // the app asks before closing the window while this is set
    $effect(() => {
        SetDirty(dirty);
    });

    async function load_recent()
    {
        try { recent = await RecentFiles(); }
        catch(ex) { recent = []; }
    }

    /** @param {{ path: string, name: string, ops: any }} opened */
    function show(opened)
    {
        doc = { path: opened.path, name: opened.name, ops: Array.isArray(opened.ops) ? opened.ops : [] };
        dirty = false;
        doc_key++;
    }

    // ---- leaving a document with unsaved changes ----

    /** @type {HTMLDialogElement} */
    let unsaved_dialog;
    /** @type {((choice: 'save' | 'discard' | 'cancel') => void) | null} */
    let unsaved_answer = null;

    /**
     * Whether the current document can be left: true straight away when everything is saved, otherwise
     * once the person saves it or chooses not to
     */
    async function can_leave()
    {
        if(!doc || !dirty) return true;
        const choice = await new Promise((resolve) => {
            unsaved_answer = resolve;
            unsaved_dialog.showModal();
        });
        if(choice === 'cancel') return false;
        if(choice === 'discard') return true;
        return await save();
    }

    /** @param {'save' | 'discard' | 'cancel'} choice */
    function answer_unsaved(choice)
    {
        const answer = unsaved_answer;
        unsaved_answer = null;
        unsaved_dialog.close();
        answer?.(choice);
    }

    // ---- file actions ----

    async function new_doc()
    {
        if(busy || !(await can_leave())) return;
        show({ path: '', name: 'Untitled', ops: [] });
    }

    async function open_doc()
    {
        if(busy || !(await can_leave())) return;
        try
        {
            const opened = await OpenDialog();
            if(opened) show(opened);
        }
        catch(ex) { show_error(ex); }
    }

    /** @param {string} path */
    async function open_recent(path)
    {
        if(busy || !(await can_leave())) return;
        try { show(await Open(path)); }
        catch(ex)
        {
            show_error(ex);
            load_recent();
        }
    }

    async function go_home()
    {
        if(busy || !(await can_leave())) return;
        doc = null;
        dirty = false;
        load_recent();
    }

    /**
     * Saves to the document's file, asking where first for a new document
     * @returns {Promise<boolean>} whether it was saved
     */
    async function save()
    {
        if(!doc || !editor) return false;
        if(!doc.path) return save_as();
        busy = true;
        try
        {
            await Save(doc.path, editor.get_contents());
            dirty = false;
            return true;
        }
        catch(ex)
        {
            show_error(`Could not save: ${ex}`);
            return false;
        }
        finally { busy = false; }
    }

    async function save_as()
    {
        if(!doc || !editor) return false;
        busy = true;
        try
        {
            const saved = await SaveAs(doc.name, editor.get_contents());
            if(!saved) return false;
            doc.path = saved.path;
            doc.name = saved.name;
            dirty = false;
            return true;
        }
        catch(ex)
        {
            show_error(`Could not save: ${ex}`);
            return false;
        }
        finally
        {
            busy = false;
            editor?.focus();
        }
    }

    // Word file of the document as it is on screen; the converter loads only when first used
    async function export_docx()
    {
        if(!doc || !editor || busy) return;
        busy = true;
        try
        {
            const { docxBlob } = await import('$lib/export_docx.js');
            const blob = await docxBlob(editor.get_contents(), doc.name);
            await ExportDocx(doc.name, await blob_base64(blob));
        }
        catch(ex)
        {
            console.error('Export failed:', ex);
            show_error('Could not create the Word file.');
        }
        finally
        {
            busy = false;
            editor?.focus();
        }
    }

    /** @param {Blob} blob */
    function blob_base64(blob)
    {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    /** @param {string} path */
    async function forget(path)
    {
        await ForgetRecent(path);
        load_recent();
    }

    // ---- keyboard shortcuts, as in other editors ----

    /** @param {KeyboardEvent} event */
    function on_keydown(event)
    {
        if(!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = event.key.toLowerCase();
        /** @type {(() => any) | null} */
        const action = key === 's' ? (event.shiftKey ? save_as : save)
            : key === 'o' && !event.shiftKey ? open_doc
            : key === 'n' && !event.shiftKey ? new_doc
            : null;
        if(!action) return;
        event.preventDefault();
        if(unsaved_dialog.open) return;
        action();
    }

    /** @param {string} path */
    function folder_of(path)
    {
        const at = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
        return at > 0 ? path.slice(0, at) : path;
    }

    /** @param {string} iso */
    function when(iso)
    {
        const date = new Date(iso);
        if(isNaN(date.getTime())) return '';
        const today = new Date();
        if(date.toDateString() === today.toDateString())
            return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    }

    onMount(() => {
        // closing the window with unsaved changes: the app waits for this to say it can quit
        const stop_close = EventsOn('close-requested', async () => {
            if(await can_leave()) Quit();
        });

        (async () => {
            try
            {
                const path = await StartupFile();
                if(path) show(await Open(path));
            }
            catch(ex) { show_error(ex); }
            load_recent();
        })();

        return stop_close;
    });
</script>

<svelte:window onkeydown={on_keydown} />

<div class="h-screen flex flex-col font-nunito text-gray-800 bg-white select-none">
    {#if doc}
        <header class="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5">
            <button class="shrink-0 text-3xl p-1 -m-1 rounded-lg hover:bg-gray-100 cursor-pointer" onclick={go_home}
                aria-label="All documents" title="All documents">
                <img src={logo} alt="" class="h-[1.25em] w-[1.25em]" />
            </button>

            <div class="flex flex-col min-w-0 flex-1">
                <span class="text-lg font-bold truncate" title={doc.path || 'Not saved yet'}>{doc.name}</span>
                <span class="flex items-center gap-1 text-xs text-gray-400" role="status">
                    {#if dirty || !doc.path}
                        <EditedIcon class="w-3.5 h-3.5" aria-hidden="true" />
                        {doc.path ? 'Unsaved changes' : 'Not saved yet'}
                    {:else}
                        <SavedIcon class="w-3.5 h-3.5" aria-hidden="true" />
                        Saved
                    {/if}
                </span>
            </div>

            <button onclick={open_doc} disabled={busy} aria-label="Open" title="Open (Ctrl+O)"
                class="p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer shrink-0 disabled:opacity-50">
                <FolderOpenIcon class="w-5 h-5" aria-hidden="true" />
            </button>
            <button onclick={export_docx} disabled={busy} aria-label="Export as Word document" title="Export as Word (.docx)"
                class="p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer shrink-0 disabled:opacity-50">
                <DownloadIcon class="w-5 h-5" aria-hidden="true" />
            </button>
            <button onclick={save} disabled={busy} title="Save (Ctrl+S) · Save as (Ctrl+Shift+S)"
                class="flex items-center gap-1.5 font-bold py-2 px-3 sm:pl-3 sm:pr-4 bg-yellow-300 hover:bg-yellow-400 text-gray-900 rounded-xl cursor-pointer shrink-0 disabled:opacity-60">
                <SaveIcon class="w-5 h-5" aria-hidden="true" />
                <span class="hidden sm:inline">Save</span>
            </button>
        </header>

        <div class="flex-1 min-h-0 flex flex-col select-text">
            {#key doc_key}
                <DesktopEditor bind:this={editor} ops={doc.ops} onchange={() => dirty = true} />
            {/key}
        </div>
    {:else}
        <!-- start screen: new, open, and the documents used lately -->
        <main class="flex-1 min-h-0 overflow-y-auto bg-gray-50">
            <div class="max-w-2xl mx-auto px-6 py-14 flex flex-col gap-10">
                <div class="flex items-center gap-3">
                    <img src={logo} alt="" class="w-11 h-11" />
                    <div>
                        <h1 class="text-3xl font-extrabold">Raya</h1>
                        <p class="text-sm text-gray-500">Documents on this computer</p>
                    </div>
                </div>

                <div class="flex flex-wrap gap-3">
                    <button onclick={new_doc} title="New document (Ctrl+N)"
                        class="flex items-center gap-2 font-bold py-2.5 pl-3 pr-5 bg-yellow-300 hover:bg-yellow-400 rounded-xl cursor-pointer">
                        <AddIcon class="w-5 h-5" aria-hidden="true" />
                        New document
                    </button>
                    <button onclick={open_doc} title="Open (Ctrl+O)"
                        class="flex items-center gap-2 font-bold py-2.5 pl-3 pr-5 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-100 rounded-xl cursor-pointer">
                        <FolderOpenIcon class="w-5 h-5" aria-hidden="true" />
                        Open…
                    </button>
                </div>

                <section class="flex flex-col gap-2">
                    <h2 class="text-xs font-bold uppercase tracking-wide text-gray-400">Recent</h2>
                    {#each recent as file (file.path)}
                        <div class="group flex items-center gap-1 rounded-xl bg-white border border-gray-200 hover:border-yellow-400">
                            <button class="flex-1 min-w-0 flex items-center gap-3 text-left px-4 py-3 cursor-pointer"
                                onclick={() => open_recent(file.path)} title={file.path}>
                                <DocIcon class="w-6 h-6 shrink-0 text-yellow-500" aria-hidden="true" />
                                <span class="min-w-0 flex-1">
                                    <span class="block font-bold truncate">{file.name}</span>
                                    <span class="block text-xs text-gray-400 truncate">{folder_of(file.path)}</span>
                                </span>
                                <span class="text-xs text-gray-400 shrink-0">{when(file.opened)}</span>
                            </button>
                            <button class="p-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-gray-800 hover:bg-gray-100 cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
                                onclick={() => ShowInFolder(file.path).catch(show_error)} title="Show in folder">
                                <FolderOpenIcon class="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button class="p-1.5 mr-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
                                onclick={() => forget(file.path)} aria-label="Remove {file.name} from the list" title="Remove from list (keeps the file)">
                                <CloseIcon class="w-4 h-4" aria-hidden="true" />
                            </button>
                        </div>
                    {:else}
                        <p class="text-sm text-gray-400">Documents you open or save will appear here.</p>
                    {/each}
                </section>
            </div>
        </main>
    {/if}
</div>

{#if error_message}
    <div class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-nunito shadow-lg" role="alert">
        <span class="min-w-0">{error_message}</span>
        <button class="p-0.5 rounded-md text-gray-400 hover:text-white cursor-pointer" aria-label="Dismiss" onclick={() => error_message = ''}>
            <CloseIcon class="w-4 h-4" aria-hidden="true" />
        </button>
    </div>
{/if}

<!-- Unsaved changes: Escape or clicking away is the same as Cancel -->
<dialog class="m-auto rounded-2xl w-[min(26rem,calc(100vw-2rem))]" bind:this={unsaved_dialog}
    oncancel={(e) => { e.preventDefault(); answer_unsaved('cancel'); }}>
    <div class="p-6 flex flex-col gap-4 font-nunito text-gray-800">
        <div>
            <p class="font-bold text-xl">Save changes to “{doc?.name}”?</p>
            <p class="text-sm text-gray-500 mt-1">Your changes will be lost if you don't save them.</p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
            <button class="px-4 py-2 rounded-lg font-semibold text-gray-600 hover:bg-gray-100 cursor-pointer" onclick={() => answer_unsaved('discard')}>Don't save</button>
            <button class="px-4 py-2 rounded-lg font-semibold text-gray-600 hover:bg-gray-100 cursor-pointer" onclick={() => answer_unsaved('cancel')}>Cancel</button>
            <!-- svelte-ignore a11y_autofocus -->
            <button class="px-4 py-2 rounded-lg bg-yellow-300 hover:bg-yellow-400 font-bold cursor-pointer" autofocus onclick={() => answer_unsaved('save')}>Save</button>
        </div>
    </div>
</dialog>
