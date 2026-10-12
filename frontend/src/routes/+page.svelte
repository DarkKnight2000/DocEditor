<svelte:head>
    <script src="https://accounts.google.com/gsi/client" async></script>
</svelte:head>

<script>
    import { env } from "$env/dynamic/public";
    import AppLogo from "$lib/AppLogo.svelte";
</script>

<div class="flex flex-col font-nunito items-center">

    <p class="text-4xl text-gray-800 font-semibold mx-20 my-10 self-start flex items-center gap-3 whitespace-nowrap"><AppLogo />Doc Editor</p>
    <p class="text-6xl text-gray-800 font-bold mt-10 mb-5">Collaborative Document Editing</p>
    <p class="text-2xl text-gray-800 font-medium m-1">Minimal & Open Source</p>

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
</div>
