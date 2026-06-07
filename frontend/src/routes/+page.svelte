<svelte:head>
    <script src="https://accounts.google.com/gsi/client" async></script>
</svelte:head>

<script>
    import { PUBLIC_GOOGLE_CLIENT_ID } from "$env/static/public";
</script>

<div class="flex flex-col font-nunito items-center">

    <p class="text-4xl text-gray-800 font-semibold m-20 self-start">Doc Editor</p>
    <p class="text-6xl text-gray-800 font-bold mt-20 mb-5">Collaborative Document Editing</p>
    <p class="text-2xl text-gray-800 font-medium m-1">Minimal & Open Source</p>

    <!-- Google sign in button -->
    <div id="g_id_onload"
        data-client_id={PUBLIC_GOOGLE_CLIENT_ID}
        data-login_uri="/auth/callback">
    </div>

    <div class="g_id_signin mt-10"
        data-type="standard"
        data-shape="rectangular"
        data-theme="outline"
        data-text="signin_with"
        data-size="large"
        data-logo_alignment="right"></div>

</div>
