<script>
    import { page } from '$app/state';
</script>

<svelte:head>
    <title>Error {page.status} · Raya</title>
</svelte:head>

<div class="flex flex-col items-center gap-4 mt-40 font-nunito">
    <h1 class="text-red-900 text-2xl">Error {page.status}</h1>
    <p class="text-gray-700">{page.error?.message}</p>
    <a href="/" class="text-blue-600 underline">Go home</a>
</div>
