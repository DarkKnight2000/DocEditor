<script>
    // The export button and its menu of formats, shared by the web and desktop apps; each app does the
    // exporting (a download, or the desktop app's save dialog) in onpick.
    import DownloadIcon from '@iconify-svelte/material-symbols/download-rounded';

    /** @type {{ onpick: (format: 'docx' | 'pdf' | 'epub') => void, disabled?: boolean, label?: string }} */
    const { onpick, disabled = false, label = 'Download' } = $props();

    const FORMATS = /** @type {const} */ ([
        { id: 'docx', name: 'Word', detail: '.docx, to edit in Word' },
        { id: 'pdf', name: 'PDF', detail: 'print, then Save as PDF' },
        { id: 'epub', name: 'EPUB', detail: '.epub, for e-readers' },
    ]);

    let open = $state(false);
    /** @type {HTMLDivElement} */
    let menu;

    /** @param {'docx' | 'pdf' | 'epub'} format */
    function pick(format)
    {
        open = false;
        onpick(format);
    }
</script>

<svelte:window
    onclick={(e) => { if(open && !menu.contains(/** @type {Node} */ (e.target))) open = false; }}
    onkeydown={(e) => { if(open && e.key === 'Escape') open = false; }} />

<div class="relative shrink-0" bind:this={menu}>
    <button onclick={() => open = !open} {disabled} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        class="p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer disabled:opacity-50 disabled:cursor-wait {open ? 'bg-gray-100 text-gray-900' : ''}">
        <DownloadIcon class="w-5 h-5" aria-hidden="true" />
    </button>
    {#if open}
        <div role="menu" class="absolute right-0 top-full mt-1 z-30 w-56 py-1 rounded-xl bg-white border border-gray-200 shadow-lg font-nunito">
            {#each FORMATS as format (format.id)}
                <button role="menuitem" class="w-full text-left px-3 py-2 hover:bg-gray-100 cursor-pointer flex flex-col" onclick={() => pick(format.id)}>
                    <span class="text-sm font-semibold text-gray-800">{format.name}</span>
                    <span class="text-xs text-gray-500">{format.detail}</span>
                </button>
            {/each}
        </div>
    {/if}
</div>
