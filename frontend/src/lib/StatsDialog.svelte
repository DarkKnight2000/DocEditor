<script>
    // Word and character counts of a document (doc_stats.js), shared by the web and desktop apps.
    // open(ops) counts the document as it is then and shows the dialog.
    import CloseIcon from '@iconify-svelte/material-symbols/close-rounded';
    import { documentStats } from '$lib/doc_stats.js';

    /** @type {{ title: string }} the document's name, shown under the heading */
    const { title } = $props();

    /** @type {HTMLDialogElement} */
    let dialog;
    let stats = $state({ words: 0, characters: 0, charactersNoSpaces: 0 });

    /** @param {Array<{insert?: any}>} ops the document, as Quill delta ops */
    export function open(ops)
    {
        stats = documentStats(ops);
        dialog.showModal();
    }

    const rows = $derived([
        ['Words', stats.words],
        ['Characters', stats.characters],
        ['Characters without spaces', stats.charactersNoSpaces],
    ]);
</script>

<dialog class="m-auto rounded-2xl w-[min(22rem,calc(100vw-2rem))]" closedby="any" bind:this={dialog}>
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
        <dl class="flex flex-col divide-y divide-gray-100">
            {#each rows as [label, count] (label)}
                <div class="flex justify-between gap-4 py-2">
                    <dt class="text-gray-600">{label}</dt>
                    <dd class="font-bold tabular-nums">{count.toLocaleString()}</dd>
                </div>
            {/each}
        </dl>
    </div>
</dialog>
