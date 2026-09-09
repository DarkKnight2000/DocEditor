<script>
    import Editor from '$lib/Editor.svelte';
    
    import PersonAdd from '@iconify-svelte/material-symbols/group-add-outline-rounded';
    import CloseIcon from '@iconify-svelte/material-symbols/close-small-outline-rounded';
    import SinglePersonAdd from '@iconify-svelte/material-symbols/person-add-rounded';

    const { data } = $props();
    
    // sync status with server
    let sync_status = $state('');
    // derived state fo displaying document name
    let shown_doc_name = $derived(data.doc_name);

    async function remote_rename_doc()
    {
        // needed incase of rename error
        let og_doc_name = $state.snapshot(shown_doc_name);

        const response = await fetch(`/edit/${data.doc_id}`,  {
            'method': 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: shown_doc_name,
                func: 'rename-doc'
            })
        });

        if(!response.ok)
        {
            shown_doc_name = og_doc_name;
        }
        else
        {
            og_doc_name = shown_doc_name;
        }
    }

    // collab management
    /**
     * @type {string | any[] | null | undefined}
     */
    let collabs_info = $state([]);
    let input_collab_email = $state('');
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
            console.log('cinf2o', text);
            collabs_info = text ? JSON.parse(text): [];
        }
        if(!collab_dialog_element.open) collab_dialog_element.showModal();
    }

    /**
     * @param {string | string[]} user_email
     * @param {boolean} is_remove
     */
    async function edit_collab(user_email, is_remove)
    {
        if(!user_email || user_email.length === 0 || !user_email.includes("@")) return;

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
    }

    /**
     * @type {HTMLDialogElement}
     */
    let noperm_dialog_element;
    function no_perm_dialog()
    {
        if(!noperm_dialog_element.open) noperm_dialog_element.showModal();
    }
    
    $effect(() => {
        console.log(`User changed doc name to ${shown_doc_name}`);
        if(data.hidden) no_perm_dialog();
    });

</script>

<!-- Whole page -->
<div class="h-screen font-nunito flex flex-col items-stretch">

    <!-- Nav bar -->
    <div class="flex flex-row p-5">

        <!-- Nav at start -->
        <span class="text-2xl ml-10 self-center py-2 px-4"
            contenteditable="true" bind:innerText={shown_doc_name} onblur={remote_rename_doc}>
        </span>
        <span class="text-sm text-gray-400 underline ml-5 self-center">
            {sync_status}
        </span>

        <!-- Show Collab button -->
        <button onclick={display_collabs} class="ml-5">
            <PersonAdd class="w-13 h-13 p-4 self-center cursor-pointer" />
        </button>

        <!-- Nav at end -->
        <div class="justify-self-end ml-auto">
        <!-- Profile pic -->
            <img src="{data.user_pic}" alt="Profile of the user" class="w-12 h-12 m-auto rounded-full select-none border-2 border-white hover:border-gray-300">
        </div>
    </div>

    <!-- Editor -->
    <Editor bind:sync_status={sync_status} doc_id={data.doc_id} bind:doc_name={shown_doc_name} noperm_dialog={no_perm_dialog}/>
</div>

<!-- Collab editor dialog -->
<dialog  id="colab-dialog" class="m-auto rounded-2xl" closedby='any' bind:this={collab_dialog_element}>
    <div class="py-10 px-20 flex flex-col gap-8">
        <p class="font-semibold text-lg">Edit Collaborators</p>
        <div>
            <input class="px-5 py-3 rounded-lg border-2 border-gray-500 text-xl" bind:value="{input_collab_email}">
            <button class="ml-4 p-4 bg-blue-400 rounded-xl cursor-pointer" onclick={() => edit_collab(input_collab_email, false)}>
                <SinglePersonAdd class='w-4 h-4 text-white'/>
            </button>
        </div>
        <div class="flex flex-col gap-6 self-stretch items-center">
            {#each collabs_info as cuser_info}
                <div class="flex flex-row gap-8 align-stretch">
                    <div class="">{cuser_info.name}</div>
                    <div class="text-gray-500">{cuser_info.email}</div>
                    <button aria-label="Remove collaborator {cuser_info.name}" onclick={() => edit_collab(cuser_info.email, true)}
                        class="cursor-pointer">
                        <CloseIcon class="w-6 h-6 hover:bg-gray-200 cursor-pointer" />
                    </button>
                </div>
            {/each}
            {#if collabs_info && collabs_info.length === 0}
                <p class="text-sm text-gray-300">No Collaborators</p>
            {/if}
        </div>
    </div>
</dialog>


<!-- No permission dialog -->
<dialog  id="no-perm-dialog" class="m-auto rounded-2xl" closedby='none' bind:this={noperm_dialog_element}>
    <div class="py-10 px-20 flex flex-col gap-8 font-nunito">
        <p class="font-semibold text-2xl text-center">You do not have permission to edit this document</p>
        <p class="text-sm text-center">If you know the owner of this document, you can request them for access.</p>
    </div>
</dialog>