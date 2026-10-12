<script>
    import { asset } from '$app/paths';

    // Sized relative to the header's font (1.25em), so it scales with the title and stands
    // a little taller than the letters, which balances better than an exact match
    let { class: className = '' } = $props();
</script>

<a href="/myhome" class="inline-flex shrink-0 items-center {className}" aria-label="My documents" title="My documents">
    <img src={asset('/favicon.svg')} alt="" class="h-[1.25em] w-[1.25em]" />
</a>
