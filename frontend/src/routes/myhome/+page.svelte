<script>
    import { goto } from '$app/navigation';

    const { data } = $props();

    async function remote_create_doc()
    {
        const response = await fetch('/myhome', {
            'method': 'POST'
        });
        if(response.ok)
        {
            // open document edit page
            const res_json = await response.json();
            console.log(res_json);
            goto(`/edit/${res_json['doc_id']}`);
        }
    }

    /**
     * @param {string} doc_id
     */
    function open_doc_edit(doc_id)
    {
        console.log('clicked edit', doc_id);
        goto(`/edit/${doc_id}`);
    }

    /**
     * @param {string} datetime_str
     */
    function get_display_datetime(datetime_str)
    {
        const date_obj = new Date(datetime_str);
        if(isNaN(date_obj.valueOf())) return "Unknown!";
        const cur_date = new Date();
        let result = "";
        if(date_obj.toDateString() === cur_date.toDateString())
        {
            result += `Today at ${date_obj.getHours()}:${String(date_obj.getMinutes()).padStart(2, '0')}`;
        }
        else result += date_obj.toDateString();
        return result;
    }
</script>

<div class="flex flex-col font-nunito items-center w-full">

    <!-- Nav bar -->
    <div class="flex flex-row self-stretch items-center justify-between border-b-gray-300 border-b-2 px-5 py-2 sticky top-0 bg-white">
        <p class="text-2xl text-gray-800 font-bold ml-30">Doc Editor</p>
        <div id="home-profile-info" class="justify-self-end mr-30">
            <img src="{data.profile_pic}" alt="User profile pic" class="w-10 h-10 m-auto mt-2 mb-1 rounded-full"/>
            <p>{data.user_name}</p>
        </div>
    </div>

    <!-- Title -->
     <div class="flex flex-col items-center bg-gray-100 py-25 self-stretch">
        <p class="text-6xl text-gray-800 font-bold my-5">Collaborative Document Editing</p>
        <p class="text-2xl text-gray-800 font-medium m-1">Minimal & Open Source</p>
    </div>

    <!-- Body -->
     <div class="mx-60 self-stretch flex flex-col">
        <!-- Filter -->
        <div class="mt-3 px-5 py-3 flex flex-row justify-between">
            <p class="font-nunito self-start font-bold text-md py-2">Your Documents</p>
            <button
                class="font-nunito self-end font-bold text-md py-2 px-9 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl"
                onclick={remote_create_doc}>
                + New Doc
            </button>
        </div>
        <!-- Documents list -->
        <div class="grid lg:grid-cols-3 md:grid-cols-2 sm:grid-cols-1 justify-evenly justify-items-center p-5">
            {#if data.docs_info.length}
                {#each data.docs_info as each_doc}
                    <button
                        class="py-8 px-15 mx-7 my-4 text-lg font-semibold border-2 border-gray-200 rounded-2xl hover:bg-gray-200"
                        onclick={() => open_doc_edit(each_doc.doc_id)}>
                        <div class="grid-cols-4">
                            <div class="col-span-full">{each_doc.doc_name}</div>
                            <div class="col-span-2 text-gray-600 mt-5 text-sm">{each_doc.owner_name}</div>
                            <div class="col-span-1 text-gray-400 text-sm">{get_display_datetime(each_doc.last_edit)}</div>
                        </div>
                    </button>
                {/each}
            {/if}
            
        </div>
     </div>

</div>
