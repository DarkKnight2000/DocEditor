<script>
    import Editor from '$lib/Editor.svelte';
    import AppLogo from '$lib/AppLogo.svelte';
    import PresenceAvatars from '$lib/PresenceAvatars.svelte';
    import Avatar from '$lib/Avatar.svelte';
    
    import ShareIcon from '@iconify-svelte/material-symbols/group-add-outline-rounded';
    import CloseIcon from '@iconify-svelte/material-symbols/close-rounded';
    import SavedIcon from '@iconify-svelte/material-symbols/cloud-done-outline-rounded';
    import DownloadIcon from '@iconify-svelte/material-symbols/download-rounded';
    import SavingIcon from '@iconify-svelte/material-symbols/sync-rounded';
    import OfflineIcon from '@iconify-svelte/material-symbols/cloud-off-outline-rounded';

    const { data } = $props();
    
    // sync status with server, set by the editor
    let sync_status = $state('');
    // the other people who have the document open, set by the editor
    /** @type {{id: string, name: string, picture: string | null}[]} */
    let others = $state([]);

    /** @type {any} the editor component, for its contents */
    let editor;
    let downloading = $state(false);

    // Word file of the document as it is on screen; the converter loads only when first used
    async function download_docx()
    {
        if(downloading || !editor) return;
        downloading = true;
        try
        {
            const { docxBlob, docxFileName } = await import('$lib/export_docx.js');
            const name = (shown_doc_name ?? '').replace(/\s+/g, ' ').trim();
            const blob = await docxBlob(editor.get_contents(), name);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = docxFileName(name);
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
        catch(ex)
        {
            console.error('Download failed:', ex);
            alert('Could not create the Word file. Please try again.');
        }
        finally
        {
            downloading = false;
        }
    }
    // how the status is shown: problems in red, saved with a cloud tick, everything else in progress
    let status_kind = $derived(
        ['Offline', "Can't connect", 'Error saving', 'Document is full, reloading…'].includes(sync_status) ? 'problem'
        : sync_status === 'Saved' ? 'saved' : 'busy');

    // profile picture link can be missing or broken; fall back to the first letter of the name
    let avatar_failed = $state(false);
    let initial = $derived((data.user_name ?? '?').trim().charAt(0).toUpperCase() || '?');
    // derived state fo displaying document name
    let shown_doc_name = $derived(data.doc_name);
    // browser tab shows the document name; falls back to the app name when there is none to show
    let tab_title = $derived(data.hidden ? 'Raya' : ((shown_doc_name ?? '').replace(/\s+/g, ' ').trim() || 'Raya'));

    // last name the server accepted, restored if a rename fails or is empty
    let saved_doc_name = data.doc_name;

    async function remote_rename_doc()
    {
        // innerText of the editable title can carry newlines and padding
        const new_doc_name = (shown_doc_name ?? '').replace(/\s+/g, ' ').trim();
        if(!new_doc_name || new_doc_name === saved_doc_name)
        {
            shown_doc_name = saved_doc_name;
            return;
        }

        const response = await fetch(`/edit/${data.doc_id}`,  {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: new_doc_name,
                func: 'rename-doc'
            })
        });

        if(!response.ok)
        {
            console.log('Rename failed: ', await response.text());
            shown_doc_name = saved_doc_name;
        }
        else
        {
            // the server returns the name it stored
            saved_doc_name = await response.text();
            shown_doc_name = saved_doc_name;
        }
    }

    /**
     * @param {KeyboardEvent} event
     */
    function title_keydown(event)
    {
        // Enter finishes renaming instead of adding a new line to the title
        if(event.key === 'Enter')
        {
            event.preventDefault();
            /** @type {HTMLElement} */ (event.currentTarget).blur();
        }
    }

    // collab management
    /**
     * @type {string | any[] | null | undefined}
     */
    let collabs_info = $state([]);
    let input_collab_email = $state('');
    // error message shown in the collab dialog, empty when there's nothing to show
    let collab_error = $state('');
    /**
     * @type {HTMLDialogElement}
     */
    let collab_dialog_element;

    async function display_collabs()
    {
        const response = await fetch(`/edit/${data.doc_id}`,  {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                func: 'get-collabs'
            })
        });
        if(response.ok)
        {
            const text = await response.text();
            collabs_info = text ? JSON.parse(text): [];
        }
        if(!collab_dialog_element.open)
        {
            collab_error = '';
            collab_dialog_element.showModal();
        }
    }

    /**
     * @param {string | string[]} user_email
     * @param {boolean} is_remove
     */
    async function edit_collab(user_email, is_remove)
    {
        if(!user_email || user_email.length === 0 || !user_email.includes("@"))
        {
            collab_error = 'Enter a valid email address.';
            return;
        }

        collab_error = '';
        const response = await fetch(`/edit/${data.doc_id}`,  {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                func: 'edit-collab',
                user_email: user_email,
                op: is_remove
            })
        });
        if(response.ok)
        {
            input_collab_email = "";
            display_collabs();
        }
        else
        {
            collab_error = (await response.text()) || 'Could not update collaborators.';
        }
    }

    /**
     * @type {HTMLDialogElement}
     */
    let noperm_dialog_element;
    // why the editor was closed: "deleted" when the owner deleted the document, otherwise no access
    let perm_reason = $state('');

    /**
     * @param {string} [reason]
     */
    function no_perm_dialog(reason = '')
    {
        perm_reason = reason;
        if(!noperm_dialog_element.open) noperm_dialog_element.showModal();
    }
    
    $effect(() => {
        if(data.hidden) no_perm_dialog();
    });

</script>

<svelte:head>
    <title>{tab_title}</title>
</svelte:head>

<!-- Whole page: header and toolbar stay put, the document scrolls -->
<div class="h-screen flex flex-col font-nunito text-gray-800 bg-white">

    <header class="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5">
        <AppLogo class="text-3xl shrink-0" />

        <div class="flex flex-col min-w-0 flex-1">
            <!-- click to rename; Enter or clicking away saves -->
            <span class="text-lg font-bold px-1.5 -mx-1.5 rounded-md truncate outline-none border border-transparent hover:border-gray-300 focus:border-yellow-400 focus:bg-white cursor-text max-w-full self-start"
                contenteditable="true" spellcheck="false" title="Rename document" role="textbox" aria-label="Document name" tabindex="0"
                bind:innerText={shown_doc_name} onblur={remote_rename_doc} onkeydown={title_keydown}>
            </span>
            {#if sync_status && !data.hidden}
                <span class="flex items-center gap-1 text-xs {status_kind === 'problem' ? 'text-red-600 font-semibold' : 'text-gray-400'}" role="status">
                    {#if status_kind === 'saved'}
                        <SavedIcon class="w-3.5 h-3.5" aria-hidden="true" />
                    {:else if status_kind === 'problem'}
                        <OfflineIcon class="w-3.5 h-3.5" aria-hidden="true" />
                    {:else}
                        <SavingIcon class="w-3.5 h-3.5 animate-spin [animation-duration:1.5s]" aria-hidden="true" />
                    {/if}
                    {sync_status}
                </span>
            {/if}
        </div>

        <PresenceAvatars users={others} />

        {#if !data.hidden}
            <button onclick={download_docx} disabled={downloading} aria-label="Download as Word document" title="Download as Word (.docx)"
                class="p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-wait">
                <DownloadIcon class="w-5 h-5" aria-hidden="true" />
            </button>
        {/if}

        <button onclick={display_collabs} aria-label="Share" title="Share"
            class="flex items-center gap-1.5 font-bold py-2 px-3 sm:pl-3 sm:pr-4 bg-yellow-300 hover:bg-yellow-400 text-gray-900 rounded-xl cursor-pointer shrink-0">
            <ShareIcon class="w-5 h-5" aria-hidden="true" />
            <span class="hidden sm:inline">Share</span>
        </button>

        {#if data.user_pic && !avatar_failed}
            <img src={data.user_pic} alt="" referrerpolicy="no-referrer" onerror={() => avatar_failed = true}
                class="w-9 h-9 rounded-full shrink-0" title={data.user_name} />
        {:else}
            <div class="w-9 h-9 rounded-full shrink-0 bg-yellow-100 text-yellow-800 font-bold flex items-center justify-center"
                title={data.user_name} aria-hidden="true">{initial}</div>
        {/if}
    </header>

    <Editor bind:this={editor} bind:sync_status={sync_status} bind:others={others} doc_id={data.doc_id} ws_token={data.ws_token} bind:doc_name={shown_doc_name} noperm_dialog={no_perm_dialog}/>
</div>

<!-- Share dialog -->
<dialog class="m-auto rounded-2xl w-[min(28rem,calc(100vw-2rem))]" closedby="any" bind:this={collab_dialog_element}>
    <div class="p-6 flex flex-col gap-5 font-nunito text-gray-800">
        <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
                <p class="font-bold text-xl">Share document</p>
                <p class="text-sm text-gray-500 truncate">"{tab_title}"</p>
            </div>
            <button class="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                aria-label="Close" onclick={() => collab_dialog_element.close()}>
                <CloseIcon class="w-5 h-5" aria-hidden="true" />
            </button>
        </div>

        <form class="flex flex-col gap-2" onsubmit={(e) => { e.preventDefault(); edit_collab(input_collab_email, false); }}>
            <label for="collab-email" class="text-sm font-semibold">Add people by email</label>
            <div class="flex gap-2">
                <input id="collab-email" type="email" placeholder="name@example.com" autocomplete="off"
                    class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
                    bind:value={input_collab_email} oninput={() => collab_error = ''}>
                <button type="submit" class="px-4 py-2 rounded-lg bg-yellow-300 hover:bg-yellow-400 font-bold cursor-pointer">Add</button>
            </div>
            <p class="text-xs text-gray-400">They need to have signed in to Raya once. They'll be able to read and edit the whole document.</p>
            {#if collab_error}
                <p class="text-sm text-red-600" role="alert">{collab_error}</p>
            {/if}
        </form>

        <div class="flex flex-col gap-1">
            <p class="text-sm font-semibold">People with access</p>
            {#each collabs_info as cuser_info (cuser_info.id)}
                <div class="flex items-center gap-3 py-2">
                    <Avatar id={cuser_info.id} name={cuser_info.name ?? ''} picture={cuser_info.picture} />
                    <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold truncate">{cuser_info.name}</p>
                        <p class="text-xs text-gray-500 truncate">{cuser_info.email ?? 'no email on file'}</p>
                    </div>
                    {#if cuser_info.email}
                        <button class="p-1.5 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            aria-label="Remove {cuser_info.name}" title="Remove access"
                            onclick={() => edit_collab(cuser_info.email, true)}>
                            <CloseIcon class="w-4 h-4" aria-hidden="true" />
                        </button>
                    {/if}
                </div>
            {/each}
            {#if collabs_info && collabs_info.length === 0}
                <p class="text-sm text-gray-400 py-2">Not shared with anyone yet.</p>
            {/if}
        </div>
    </div>
</dialog>


<!-- No permission dialog -->
<dialog class="m-auto rounded-2xl w-[min(26rem,calc(100vw-2rem))]" closedby="none" bind:this={noperm_dialog_element}>
    <div class="p-8 flex flex-col items-center gap-3 font-nunito text-gray-800 text-center">
        {#if perm_reason === 'deleted'}
            <p class="font-bold text-xl">This document was deleted</p>
            <p class="text-sm text-gray-500">The owner deleted it, so it can't be edited any more.</p>
        {:else}
            <p class="font-bold text-xl">You don't have access to this document</p>
            <p class="text-sm text-gray-500">If you know the owner, ask them to share it with you.</p>
        {/if}
        <a href="/myhome" class="mt-3 px-5 py-2 rounded-xl bg-yellow-300 hover:bg-yellow-400 font-bold">Go to my documents</a>
    </div>
</dialog>
