<script>
    // A person's profile picture, or the first letter of their name when there's none or it fails to load.
    // The letter gets a colour from the person's id, so they look the same everywhere.

    /** @type {{ id: string, name?: string, picture?: string | null, class?: string }} */
    let { id, name = '', picture = null, class: size_class = 'w-8 h-8 text-sm' } = $props();

    const COLORS = [
        'bg-sky-100 text-sky-800', 'bg-pink-100 text-pink-800', 'bg-emerald-100 text-emerald-800',
        'bg-violet-100 text-violet-800', 'bg-orange-100 text-orange-800', 'bg-teal-100 text-teal-800',
    ];

    function color_of(/** @type {string} */ key)
    {
        let hash = 0;
        for(const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        return COLORS[hash % COLORS.length];
    }

    let failed = $state(false);
    let initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
</script>

{#if picture && !failed}
    <img src={picture} alt="" referrerpolicy="no-referrer" onerror={() => failed = true}
        class="{size_class} rounded-full block shrink-0" />
{:else}
    <span class="{size_class} rounded-full shrink-0 flex items-center justify-center font-bold {color_of(id)}"
        aria-hidden="true">{initial}</span>
{/if}
