<script>
    // The other people who have the document open (SERVER_PRESENCE), as a row of overlapping avatars.
    // Wide screens show up to three and a "+N" for the rest; phones show one and a count.
    import Avatar from '$lib/Avatar.svelte';

    /** @type {{ users: {id: string, name: string, picture: string | null}[] }} */
    let { users = [] } = $props();

    const MAX_SHOWN = 3;

    /** @param {string} name */
    const display_name = (name) => name.trim() || 'Someone';

    let shown = $derived(users.slice(0, MAX_SHOWN));
    let label = $derived(`Also here: ${users.map(u => display_name(u.name)).join(', ')}`);
    /** @param {number} from */
    const names_from = (from) => users.slice(from).map(u => display_name(u.name)).join(', ');
</script>

{#if users.length}
    <div class="flex items-center shrink-0" role="group" aria-label={label} title={label}>
        {#each shown as user, i (user.id)}
            <!-- phones show only the first avatar -->
            <span class="{i > 0 ? 'hidden sm:block -ml-2' : ''} rounded-full ring-2 ring-white" title={display_name(user.name)}>
                <Avatar id={user.id} name={user.name} picture={user.picture} />
            </span>
        {/each}
        {#if users.length > 1}
            <span class="sm:hidden -ml-2 w-8 h-8 rounded-full ring-2 ring-white bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center"
                title={names_from(1)} aria-hidden="true">+{users.length - 1}</span>
        {/if}
        {#if users.length > MAX_SHOWN}
            <span class="hidden sm:flex -ml-2 w-8 h-8 rounded-full ring-2 ring-white bg-gray-100 text-gray-600 text-xs font-bold items-center justify-center"
                title={names_from(MAX_SHOWN)} aria-hidden="true">+{users.length - MAX_SHOWN}</span>
        {/if}
    </div>
{/if}
