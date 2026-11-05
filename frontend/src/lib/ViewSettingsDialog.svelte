<script>
    // The view settings (view_settings.js): text size, line spacing and character spacing, for this screen only.
    // Shared by the web and desktop apps. The saved settings apply as soon as this is on the page;
    // open() shows the dialog, and changes apply as they're picked.
    import { onMount } from 'svelte';
    import CloseIcon from '@iconify-svelte/material-symbols/close-rounded';
    import { TEXT_SIZE_OPTIONS, LINE_SPACING_OPTIONS, CHAR_SPACING_OPTIONS, DEFAULT_VIEW_SETTINGS,
        loadViewSettings, saveViewSettings, applyViewSettings } from '$lib/view_settings.js';

    /** @type {HTMLDialogElement} */
    let dialog;
    let settings = $state({ ...DEFAULT_VIEW_SETTINGS });

    onMount(() => {
        settings = loadViewSettings();
        applyViewSettings(settings);
    });

    export function open()
    {
        dialog.showModal();
    }

    /** @param {Partial<typeof settings>} change */
    function update(change)
    {
        settings = { ...settings, ...change };
        applyViewSettings(settings);
        saveViewSettings(settings);
    }

    const FIELDS = /** @type {const} */ ([
        { key: 'textSize', label: 'Text size', options: TEXT_SIZE_OPTIONS },
        { key: 'lineSpacing', label: 'Line spacing', options: LINE_SPACING_OPTIONS },
        { key: 'charSpacing', label: 'Character spacing', options: CHAR_SPACING_OPTIONS },
    ]);
    let is_default = $derived(FIELDS.every(({ key }) => settings[key] === DEFAULT_VIEW_SETTINGS[key]));
</script>

<dialog class="m-auto rounded-2xl w-[min(22rem,calc(100vw-2rem))]" closedby="any" bind:this={dialog}>
    <div class="p-6 flex flex-col gap-4 font-nunito text-gray-800">
        <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
                <p class="font-bold text-xl">View settings</p>
                <p class="text-sm text-gray-500">How documents look on this device. Others don't see these.</p>
            </div>
            <button class="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                aria-label="Close" onclick={() => dialog.close()}>
                <CloseIcon class="w-5 h-5" aria-hidden="true" />
            </button>
        </div>
        <div class="flex flex-col divide-y divide-gray-100">
            {#each FIELDS as { key, label, options } (key)}
                <label class="flex items-center justify-between gap-4 py-2">
                    <span class="text-gray-600">{label}</span>
                    <select class="font-nunito text-sm rounded-md px-2 py-1 w-28 cursor-pointer bg-white border border-gray-200 hover:border-gray-300 focus:outline-none focus:border-yellow-400"
                        value={settings[key]} onchange={(e) => update({ [key]: Number(/** @type {HTMLSelectElement} */ (e.currentTarget).value) })}>
                        {#each options as option (option.value)}
                            <option value={option.value}>{option.label}</option>
                        {/each}
                    </select>
                </label>
            {/each}
        </div>
        <div class="flex justify-end">
            <button class="px-4 py-2 rounded-lg font-semibold text-gray-600 hover:bg-gray-100 cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
                disabled={is_default} onclick={() => update({ ...DEFAULT_VIEW_SETTINGS })}>Reset to default</button>
        </div>
    </div>
</dialog>
