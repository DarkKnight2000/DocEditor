<svelte:head>
    <title>Raya</title>
    <script src="https://accounts.google.com/gsi/client" async></script>
</svelte:head>

<script>
    import { env } from "$env/dynamic/public";
    import AppLogo from "$lib/AppLogo.svelte";
    import SyncIcon from '@iconify-svelte/material-symbols/sync-rounded';
    import ShareIcon from '@iconify-svelte/material-symbols/group-add-outline-rounded';
    import SavedIcon from '@iconify-svelte/material-symbols/cloud-done-outline-rounded';

    const GITHUB_URL = 'https://github.com/DarkKnight2000/DocEditor';

    const features = [
        { icon: SyncIcon, title: 'Real-time editing', text: 'Everyone sees changes as they are typed.' },
        { icon: ShareIcon, title: 'Share by email', text: 'Invite people to write with you.' },
        { icon: SavedIcon, title: 'Saved as you go', text: 'No save button, nothing to lose.' },
    ];
</script>

<div class="min-h-screen flex flex-col font-nunito text-gray-800">

    <header class="px-6 md:px-20 py-6 sm:py-8">
        <p class="text-3xl sm:text-4xl font-extrabold flex items-center gap-2 sm:gap-3 whitespace-nowrap"><AppLogo />Raya</p>
    </header>

    <!-- Fills the space between header and footer and centres its content -->
    <main class="flex-1 flex flex-col items-center justify-center px-6 pb-10 text-center">
        <h1 class="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight">
            Collaborative <span class="highlight">Document editor</span>
        </h1>
        <p class="text-xl sm:text-2xl font-medium mt-4 text-gray-600">Minimal & Open source</p>

        <!-- Google sign in button -->
        <div id="g_id_onload"
            data-client_id={env.PUBLIC_GOOGLE_CLIENT_ID}
            data-login_uri={`auth/callback`}>
        </div>

        <div class="g_id_signin mt-10"
            data-type="standard"
            data-shape="rectangular"
            data-theme="outline"
            data-text="signin_with"
            data-size="large"
            data-logo_alignment="right"></div>

        <p class="text-sm text-gray-500 mt-4">
            By signing in, you agree to the <a href="/terms" class="underline">Terms of Service</a>
            and <a href="/privacy" class="underline">Privacy Policy</a>.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-10 mt-12 sm:mt-20 max-w-3xl">
            {#each features as feature}
                <div class="flex flex-col items-center gap-2">
                    <div class="w-12 h-12 rounded-full bg-yellow-100 text-yellow-700 flex items-center justify-center">
                        <feature.icon class="w-6 h-6" aria-hidden="true" />
                    </div>
                    <p class="font-bold mt-1">{feature.title}</p>
                    <p class="text-sm text-gray-500">{feature.text}</p>
                </div>
            {/each}
        </div>
    </main>

    <footer class="px-6 py-6 text-center text-xs text-gray-400 flex flex-col gap-2">
        <p>
            Raya is a personal project with limited space, so each account can keep a few documents.
            It's <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" class="underline">open source</a>, so you're welcome to run your own copy.
        </p>
        <p>
            <a href="/privacy" class="hover:underline">Privacy</a> ·
            <a href="/terms" class="hover:underline">Terms</a> ·
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" class="hover:underline">GitHub</a>
        </p>
    </footer>
</div>

<style>
    /* yellow marker stroke behind the words, matching the app icon */
    .highlight {
        background: linear-gradient(transparent 62%, #fde047 62%, #fde047 92%, transparent 92%);
        padding: 0 0.1em;
    }
</style>
