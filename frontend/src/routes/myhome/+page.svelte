<script>
    import { goto, invalidateAll } from '$app/navigation';
    import LogoutIcon from '@iconify-svelte/material-symbols/logout-rounded';
    import DeleteIcon from '@iconify-svelte/material-symbols/delete-outline-rounded';
    import DocIcon from '@iconify-svelte/material-symbols/description-outline-rounded';
    import AddIcon from '@iconify-svelte/material-symbols/add-rounded';
    import SharedIcon from '@iconify-svelte/material-symbols/group-outline-rounded';
    import AppLogo from '$lib/AppLogo.svelte';

    const { data } = $props();

    // why the last "New document" failed, e.g. the per-account document limit
    let create_error = $state('');
    let creating = $state(false);

    // documents this user owns count towards the limit; shared ones don't
    let owned_count = $derived(data.docs_info.filter((/** @type {any} */ d) => d.is_owner).length);

    // profile picture link can be missing or broken; fall back to the first letter of the name
    let avatar_failed = $state(false);
    let initial = $derived((data.user_name ?? '?').trim().charAt(0).toUpperCase() || '?');

    // document waiting for delete confirmation
    /** @type {{doc_id: string, doc_name: string, shared_with: number} | null} */
    let doc_to_delete = $state(null);
    let delete_error = $state('');
    let deleting = $state(false);
    /** @type {HTMLDialogElement} */
    let delete_dialog_element;

    /**
     * @param {{doc_id: string, doc_name: string, shared_with: number}} doc
     */
    function confirm_delete(doc)
    {
        doc_to_delete = doc;
        delete_error = '';
        delete_dialog_element.showModal();
    }

    async function remote_delete_doc()
    {
        if(!doc_to_delete) return;
        deleting = true;
        const response = await fetch('/myhome', {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({'func': 'delete_doc', 'doc_id': doc_to_delete.doc_id})
        });
        deleting = false;
        if(response.ok)
        {
            delete_dialog_element.close();
            create_error = '';
            await invalidateAll();      // reload the document list
        }
        else
        {
            delete_error = (await response.text()) || 'Could not delete the document.';
        }
    }

    async function remote_create_doc()
    {
        create_error = '';
        creating = true;
        const response = await fetch('/myhome', {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({'func': 'create_doc'})
        });
        if(response.ok)
        {
            // open document edit page
            const res_json = await response.json();
            goto(`/edit/${res_json['doc_id']}`);
        }
        else
        {
            creating = false;
            create_error = (await response.text()) || 'Could not create a document.';
        }
    }

    async function remote_logout()
    {
        const response = await fetch('/myhome', {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({'func': 'logout'})
        });
        if(response.ok)
        {
            // back to the sign-in page
            goto(`/`);
        }
    }

    /**
     * Names saved by older versions can contain newlines; show them on one line
     * @param {string} name
     */
    function display_name(name)
    {
        return (name ?? '').replace(/\s+/g, ' ').trim() || 'Untitled';
    }

    /**
     * @param {string} datetime_str
     */
    function get_display_datetime(datetime_str)
    {
        const date_obj = new Date(datetime_str);
        if(isNaN(date_obj.valueOf())) return "";
        const time = date_obj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const cur_date = new Date();
        if(date_obj.toDateString() === cur_date.toDateString()) return `Edited today at ${time}`;
        const same_year = date_obj.getFullYear() === cur_date.getFullYear();
        return 'Edited ' + date_obj.toLocaleDateString([], { month: 'short', day: 'numeric', year: same_year ? undefined : 'numeric' });
    }

</script>

<svelte:head>
    <title>Raya</title>
</svelte:head>

<div class="min-h-screen flex flex-col font-nunito text-gray-800 bg-white">

    <!-- Header: same layout as the sign-in page -->
    <header class="px-8 md:px-20 py-6 flex items-center justify-between gap-6 border-b border-gray-200">
        <p class="text-2xl sm:text-3xl font-extrabold flex items-center gap-2 sm:gap-3 whitespace-nowrap"><AppLogo />Raya</p>
        <div class="flex items-center gap-5">
            <div class="flex items-center gap-3 min-w-0">
                {#if data.profile_pic && !avatar_failed}
                    <img src={data.profile_pic} alt="" referrerpolicy="no-referrer" onerror={() => avatar_failed = true}
                        class="w-9 h-9 rounded-full shrink-0" />
                {:else}
                    <div class="w-9 h-9 rounded-full shrink-0 bg-yellow-100 text-yellow-800 font-bold flex items-center justify-center" aria-hidden="true">{initial}</div>
                {/if}
                <span class="hidden sm:block font-semibold truncate max-w-48">{data.user_name}</span>
            </div>
            <!-- icon only on small screens -->
            <button onclick={remote_logout} aria-label="Log out" title="Log out"
                class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg px-3 py-2 cursor-pointer whitespace-nowrap">
                <LogoutIcon class="w-5 h-5" aria-hidden="true" />
                <span class="hidden sm:inline">Log out</span>
            </button>
        </div>
    </header>

    <main class="flex-1 w-full max-w-5xl mx-auto px-6 md:px-8 py-12">

        <!-- Title row -->
        <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
                <h1 class="text-2xl sm:text-3xl font-bold">Your documents</h1>
                {#if data.limits?.max_docs != null}
                    <p class="text-xs text-gray-400 mt-2" title="Raya is a personal project with limited space. Documents shared with you don't count.">
                        Using {owned_count} of {data.limits.max_docs} documents · up to {data.limits.max_chars.toLocaleString('en-US')} characters each
                    </p>
                {/if}
            </div>
            <button
                class="flex items-center gap-1.5 font-bold py-2.5 pl-4 pr-5 bg-yellow-300 hover:bg-yellow-400 text-gray-900 rounded-xl cursor-pointer disabled:opacity-60"
                disabled={creating} onclick={remote_create_doc}>
                <AddIcon class="w-5 h-5" aria-hidden="true" />
                New document
            </button>
        </div>
        {#if create_error}
            <p class="mt-3 text-sm text-red-600 text-right" role="alert">{create_error}</p>
        {/if}

        <!-- Documents -->
        {#if data.docs_info.length}
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-8">
                {#each data.docs_info as each_doc (each_doc.doc_id)}
                    <!-- the delete button sits beside the card's link, not inside it -->
                    <div class="relative group">
                        <a href="/edit/{each_doc.doc_id}"
                            class="flex flex-col h-full min-h-40 p-5 rounded-2xl border border-gray-200 hover:border-yellow-400 hover:shadow-md transition">
                            <div class="w-10 h-10 rounded-xl bg-yellow-100 text-yellow-700 flex items-center justify-center">
                                <DocIcon class="w-6 h-6" aria-hidden="true" />
                            </div>
                            <p class="mt-4 font-bold text-lg leading-snug line-clamp-2 break-words pr-6">{display_name(each_doc.doc_name)}</p>
                            <div class="mt-auto pt-4 flex flex-col gap-1 text-sm">
                                {#if !each_doc.is_owner}
                                    <span class="flex items-center gap-1.5 text-gray-600 min-w-0">
                                        <SharedIcon class="w-4 h-4 shrink-0" aria-hidden="true" />
                                        <span class="truncate">Shared by {each_doc.owner_name}</span>
                                    </span>
                                {:else if each_doc.shared_with}
                                    <span class="flex items-center gap-1.5 text-gray-600">
                                        <SharedIcon class="w-4 h-4 shrink-0" aria-hidden="true" />
                                        Shared with {each_doc.shared_with} {each_doc.shared_with === 1 ? 'person' : 'people'}
                                    </span>
                                {/if}
                                <span class="text-gray-400">{get_display_datetime(each_doc.last_edit)}</span>
                            </div>
                        </a>
                        {#if each_doc.is_owner}
                            <button
                                class="absolute top-4 right-4 p-1.5 rounded-full text-gray-300 group-hover:text-gray-400 hover:!text-red-600 hover:bg-red-50 cursor-pointer"
                                aria-label="Delete {display_name(each_doc.doc_name)}" title="Delete document"
                                onclick={() => confirm_delete(each_doc)}>
                                <DeleteIcon class="w-5 h-5" aria-hidden="true" />
                            </button>
                        {/if}
                    </div>
                {/each}
            </div>
        {:else}
            <div class="mt-16 flex flex-col items-center text-center gap-3">
                <div class="w-14 h-14 rounded-2xl bg-yellow-100 text-yellow-700 flex items-center justify-center">
                    <DocIcon class="w-8 h-8" aria-hidden="true" />
                </div>
                <p class="font-bold text-lg">No documents yet</p>
                <p class="text-sm text-gray-500">Create one, or ask someone to share theirs with you.</p>
            </div>
        {/if}
    </main>

    <footer class="px-6 py-6 text-center text-xs text-gray-400">
        <a href="/privacy" class="hover:underline">Privacy</a> ·
        <a href="/terms" class="hover:underline">Terms</a> ·
        <a href="https://github.com/DarkKnight2000/DocEditor" target="_blank" rel="noopener noreferrer" class="hover:underline">GitHub</a>
    </footer>
</div>

<!-- Delete confirmation -->
<dialog class="m-auto rounded-2xl" closedby="any" bind:this={delete_dialog_element}>
    <div class="py-8 px-10 flex flex-col gap-4 font-nunito max-w-md">
        <p class="font-bold text-xl">Delete "{display_name(doc_to_delete?.doc_name ?? '')}"?</p>
        <p class="text-sm text-gray-600">
            {#if doc_to_delete?.shared_with}
                It will also be removed for the {doc_to_delete.shared_with === 1 ? '1 person' : `${doc_to_delete.shared_with} people`} it's shared with.
            {/if}
            This can't be undone.
        </p>
        {#if delete_error}
            <p class="text-sm text-red-600" role="alert">{delete_error}</p>
        {/if}
        <div class="flex justify-end gap-3 mt-2">
            <button class="px-5 py-2 rounded-xl hover:bg-gray-100 cursor-pointer" onclick={() => delete_dialog_element.close()}>Cancel</button>
            <button class="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer disabled:opacity-60"
                disabled={deleting} onclick={remote_delete_doc}>
                {deleting ? 'Deleting...' : 'Delete'}
            </button>
        </div>
    </div>
</dialog>
