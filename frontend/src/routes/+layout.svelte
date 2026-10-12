<script>
	import '$lib/styles/layout.css';

	let { children } = $props();

</script>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</svelte:head>
{@render children()}
