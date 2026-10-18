<script>
    // A person's profile picture, or the first letter of their name when there's none or it fails to load.
    // The letter gets the person's colour (user_colors.js), which their cursor in the editor shares.
    import { userColor } from '$lib/user_colors.js';

    /** @type {{ id: string, name?: string, picture?: string | null, class?: string }} */
    let { id, name = '', picture = null, class: size_class = 'w-8 h-8 text-sm' } = $props();

    let failed = $state(false);
    let initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
</script>

{#if picture && !failed}
    <img src={picture} alt="" referrerpolicy="no-referrer" onerror={() => failed = true}
        class="{size_class} rounded-full block shrink-0" />
{:else}
    <span class="{size_class} rounded-full shrink-0 flex items-center justify-center font-bold {userColor(id).avatar}"
        aria-hidden="true">{initial}</span>
{/if}
