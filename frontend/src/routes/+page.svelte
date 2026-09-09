<svelte:head>
    <script src="https://accounts.google.com/gsi/client" async></script>
</svelte:head>

<script>
    import { PUBLIC_GOOGLE_CLIENT_ID } from "$env/static/public";
    import demo_gif from '$lib/assets/demo.gif';
</script>

<div class="flex flex-col font-nunito items-center">

    <p class="text-4xl text-gray-800 font-semibold mx-20 my-10 self-start">Doc Editor</p>
    <p class="text-6xl text-gray-800 font-bold mt-10 mb-5">Collaborative Document Editing</p>
    <p class="text-2xl text-gray-800 font-medium m-1">Minimal & Open Source</p>

    <!-- Google sign in button -->
    <div id="g_id_onload"
        data-client_id={PUBLIC_GOOGLE_CLIENT_ID}
        data-login_uri={`auth/callback`}>
    </div>

    <div class="g_id_signin mt-10"
        data-type="standard"
        data-shape="rectangular"
        data-theme="outline"
        data-text="signin_with"
        data-size="large"
        data-logo_alignment="right"></div>

    <div class="mt-35 gap-2 flex flex-col">
        <p class="font-bold text-xl font-nunito self-start">Demo</p>
        <img src="{demo_gif}" class="mt-2 mh-auto max-w-md h-auto border-2 rounded-2xl" alt="Description of the animation">
    </div>
</div>
