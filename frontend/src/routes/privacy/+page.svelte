<script>
    import { env } from '$env/dynamic/public';
    import LegalPage from '$lib/LegalPage.svelte';

    // Set PUBLIC_CONTACT_EMAIL in frontend/.env to the address that handles requests for this site
    const contact = env.PUBLIC_CONTACT_EMAIL;
</script>

<LegalPage title="Privacy Policy" updated="October 13, 2026">
    <p>
        This site runs DocEditor, an open-source collaborative document editor
        (<a href="https://github.com/DarkKnight2000/DocEditor" target="_blank" rel="noopener noreferrer">source code</a>).
        It is a small, privately run service. This policy explains what information the site collects
        when you use it and what happens to it. "We" means the person who runs this site.
    </p>

    <h2>What we collect</h2>
    <p><strong>From Google when you sign in.</strong> You sign in with your Google account. Google tells us:</p>
    <ul>
        <li>your Google account ID, which is how we recognise you;</li>
        <li>your name;</li>
        <li>your email address, but only if Google has verified it;</li>
        <li>a link to your Google profile picture.</li>
    </ul>
    <p>We never see your Google password and get no other access to your Google account.</p>

    <p><strong>What you create.</strong> We store:</p>
    <ul>
        <li>the documents you create and edit, including their names and formatting;</li>
        <li>who owns each document and who it's shared with;</li>
        <li>when each document was last edited;</li>
        <li>recent individual edits, which are kept only until everyone who has the document open
            has received them, then deleted.</li>
    </ul>

    <p><strong>Server logs.</strong> Like most websites, the server records basic information about each request,
        such as your IP address, the page requested and the time. These logs are used to keep the site running
        and to investigate problems.</p>

    <h2>How we use it</h2>
    <p>Only to run DocEditor:</p>
    <ul>
        <li>to sign you in and keep you signed in;</li>
        <li>to show you your documents;</li>
        <li>to sync edits between everyone working on the same document;</li>
        <li>to let document owners share documents with other people by email.</li>
    </ul>
    <p>We don't show ads, don't use analytics or tracking tools, and never sell your information.</p>

    <h2>Who can see your information</h2>
    <ul>
        <li><strong>People you share documents with.</strong> Anyone added to a document can read and edit it.
            They see the owner's name, and the names and email addresses of everyone the document is shared with.</li>
        <li><strong>Google.</strong> The sign-in button and the site's font are loaded from Google, so Google receives
            your IP address and basic browser information when you visit. Google's handling of that is covered by
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google's Privacy Policy</a>.</li>
        <li><strong>The hosting provider</strong> that runs the server stores the data on our behalf.</li>
        <li><strong>Where required by law.</strong> We would disclose information if legally required to.</li>
    </ul>

    <h2>Cookies</h2>
    <p>We only use cookies needed for the site to work:</p>
    <ul>
        <li><code>user_id</code>: keeps you signed in. It holds a signed token, not your Google details, and expires after 7 days.</li>
        <li><code>user_name</code> and <code>user_pic</code>: your name and profile picture link, to show who's signed in. They expire after 7 days.</li>
    </ul>
    <p>Google's sign-in also sets its own cookies, such as <code>g_csrf_token</code>, to protect the sign-in.
        Signing out removes our cookies.</p>

    <h2>How long we keep it</h2>
    <p>Your account and documents are kept until you ask us to delete them. Recent individual edits are removed
        automatically once they're no longer needed for syncing. Server logs are kept only for a limited time.</p>

    <h2>Your choices</h2>
    <p>You can ask us to show you the information we hold about you, correct it, or delete your account.
        Deleting your account deletes the documents you own, including for the people you shared them with,
        and removes you from documents other people shared with you.
        The app doesn't have a delete button yet, so contact us using the details below.</p>

    <h2>Security</h2>
    <p>Sign-in tokens are signed so they can't be forged, and only the owner and collaborators of a document can
        open it. This is a small service run by an individual, so no system is perfectly secure; please don't use
        it for highly sensitive information.</p>

    <h2>Children</h2>
    <p>DocEditor isn't intended for children under 13, or the minimum age required to have a Google account
        where you live.</p>

    <h2>Changes</h2>
    <p>If this policy changes, the new version will be posted here with a new "Last updated" date.</p>

    <h2>Contact</h2>
    {#if contact}
        <p>For questions or requests about your information, email <a href="mailto:{contact}">{contact}</a>.</p>
    {:else}
        <p>For questions or requests about your information, contact the person who runs this site.</p>
    {/if}
</LegalPage>
