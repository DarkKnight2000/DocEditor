<script>
    // Word and character counts of a document (doc_stats.js), shared by the web and desktop apps.
    // open(ops, selection) counts the document as it is then, and the selection beside it when there is one.
    import CloseIcon from '@iconify-svelte/material-symbols/close-rounded';
    import { documentStats } from '$lib/doc_stats.js';

    /** @type {{ title: string }} the document's name, shown under the heading */
    const { title } = $props();

    /** @type {HTMLDialogElement} */
    let dialog;
    /** @typedef {ReturnType<typeof documentStats>} Stats */
    /** @type {Stats} */
    let stats = $state({ words: 0, characters: 0, charactersNoSpaces: 0 });
    /** @type {Stats | null} */
    let selection_stats = $state(null);

    /**
     * @param {Array<{insert?: any}>} ops the document, as Quill delta ops
     * @param {Array<{insert?: any}> | null} [selection] the selected part of it, if anything is selected
     */
    export function open(ops, selection = null)
    {
        stats = documentStats(ops);
        selection_stats = selection ? documentStats(selection) : null;
        dialog.showModal();
    }

    /** @type {Array<[string, keyof Stats]>} */
    const ROWS = [['Words', 'words'], ['Characters', 'characters'], ['Characters without spaces', 'charactersNoSpaces']];
</script>

<dialog class="m-auto rounded-2xl {selection_stats ? 'w-[min(26rem,calc(100vw-2rem))]' : 'w-[min(22rem,calc(100vw-2rem))]'}" closedby="any" bind:this={dialog}>
    <div class="p-6 flex flex-col gap-4 font-nunito text-gray-800">
        <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
                <p class="font-bold text-xl">Stats</p>
                <p class="text-sm text-gray-500 truncate">"{title}"</p>
            </div>
            <button class="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                aria-label="Close" onclick={() => dialog.close()}>
                <CloseIcon class="w-5 h-5" aria-hidden="true" />
            </button>
        </div>
        <table class="w-full">
            {#if selection_stats}
                <thead>
                    <tr class="text-xs text-gray-400">
                        <th class="text-left font-normal pb-1"><span class="sr-only">Count</span></th>
                        <th class="text-right font-semibold pb-1 pl-4">Selection</th>
                        <th class="text-right font-semibold pb-1 pl-4">Document</th>
                    </tr>
                </thead>
            {/if}
            <tbody class="divide-y divide-gray-100">
                {#each ROWS as [label, key] (key)}
                    <tr>
                        <th scope="row" class="text-left font-normal text-gray-600 py-2">{label}</th>
                        {#if selection_stats}
                            <td class="text-right font-bold tabular-nums py-2 pl-4">{selection_stats[key].toLocaleString()}</td>
                        {/if}
                        <td class="text-right font-bold tabular-nums py-2 pl-4 {selection_stats ? 'text-gray-500' : ''}">{stats[key].toLocaleString()}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</dialog>
