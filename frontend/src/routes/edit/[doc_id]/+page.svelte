<script>
    import Editor from './Editor.svelte'
    const { data } = $props();
    let sync_status = $state('');
</script>

<!-- <div class="bg-gray-800 grid grid-cols-7 font-nunito h-screen grid-rows-[auto_1fr] text-center">
    <div class="px-5 py-3 text-white col-span-full text-3xl font-bold">Doc Editor</div>
    <div class="px-5 py-3 text-white bg-gray-700">Nav</div>
    <div class="px-5 py-3 text-white bg-gray-700 col-span-5">
        <Editor />
    </div>
    <div class="px-5 py-3 text-white bg-gray-700">Info</div>
    <div class="px-5 py-1 text-white col-span-full text-center text-sm font-bold">Footer</div>
</div> -->

<!-- Whole page -->
<div class="h-screen font-nunito flex flex-col items-stretch">

    <!-- Nav bar -->
    <div class="flex flex-row p-5">

        <!-- Nav at start -->
        <div class="pl-8 justify-self-start self-center">
            <span class="text-2xl">
                {data.doc_name}
            </span>
            <span class="text-sm text-gray-400 underline ml-5">
                {sync_status}
            </span>
        </div>

        <!-- Nav at end -->
        <div class="justify-self-end ml-auto">
        <!-- Profile pic -->
            <img src="{data.user_pic}" alt="Profile of the user" class="w-12 h-12 m-auto rounded-full select-none border-2 border-white hover:border-gray-300">
        </div>
    </div>

    <!-- Editor -->
    <Editor bind:sync_status={sync_status} doc_id={data.doc_id}/>
</div>