<script>
    // Shared layout for the privacy policy and terms of service
    let { title, updated, children } = $props();
</script>

<svelte:head>
    <title>{title} · Raya</title>
</svelte:head>

<div class="font-nunito text-gray-800 max-w-3xl mx-auto px-6 py-12 leading-relaxed legal">
    <a href="/" class="text-blue-600 underline text-sm">← <span class="font-extrabold">Raya</span></a>
    <h1 class="text-4xl font-bold mt-6">{title}</h1>
    <p class="text-sm text-gray-500 mt-2 mb-8">Last updated: {updated}</p>
    {@render children()}
    <p class="text-sm text-gray-500 mt-12">
        See also: <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>
    </p>
</div>

<style>
    .legal :global(h2) { font-size: 1.4rem; font-weight: 700; margin-top: 2rem; margin-bottom: 0.5rem; }
    .legal :global(p) { margin-bottom: 0.75rem; }
    .legal :global(ul) { list-style: disc; padding-left: 1.5rem; margin-bottom: 0.75rem; }
    .legal :global(li) { margin-bottom: 0.35rem; }
    .legal :global(a) { color: #2563eb; text-decoration: underline; }
    .legal :global(code) { background: #f3f4f6; padding: 0 0.25rem; border-radius: 0.25rem; }
</style>
