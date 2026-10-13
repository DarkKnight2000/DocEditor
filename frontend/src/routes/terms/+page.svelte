<script>
    import { env } from '$env/dynamic/public';
    import LegalPage from '$lib/LegalPage.svelte';

    // Set PUBLIC_CONTACT_EMAIL in frontend/.env to the address that handles requests for this site
    const contact = env.PUBLIC_CONTACT_EMAIL;
</script>

<LegalPage title="Terms of Service" updated="October 13, 2026">
    <p>
        These terms apply to your use of Raya on this site. This is a small service run privately by
        an individual ("we"), not a company. By signing in, you agree to these terms and to the
        <a href="/privacy">Privacy Policy</a>.
    </p>

    <h2>Using Raya</h2>
    <ul>
        <li>You need a Google account to sign in, and must be at least 13, or the minimum age required to have
            a Google account where you live.</li>
        <li>The service is offered for personal use by a small number of people. We may limit who can use it,
            and may refuse or end access at any time.</li>
        <li>You're responsible for activity on your account. Keep your Google account secure, and sign out on
            shared computers.</li>
    </ul>

    <h2>Your documents</h2>
    <ul>
        <li>You keep ownership of everything you write. You give us permission to store, copy and display
            your documents only as needed to run the service for you and the people you share them with.</li>
        <li>When you add someone to a document, they can read and edit all of it and see who else has access.
            Only the owner can rename a document or change who it's shared with.</li>
        <li>You're responsible for what you write and share, and for having the right to share it.</li>
    </ul>

    <h2>Acceptable use</h2>
    <p>Don't use Raya to:</p>
    <ul>
        <li>break the law or infringe anyone else's rights;</li>
        <li>store or share malware, or content that is abusive, harassing or exploits anyone;</li>
        <li>try to access documents or accounts that aren't yours, or interfere with the service, for example
            by probing for vulnerabilities, overloading it or automating heavy traffic;</li>
        <li>impersonate other people.</li>
    </ul>
    <p>We may remove content or suspend accounts that break these rules.</p>

    <h2>No guarantees: keep your own copies</h2>
    <p>
        Raya is provided free and "as is". We don't promise that it will always be available, error-free or
        secure, or that your documents will never be lost. The service may change, be interrupted or shut down at
        any time. <strong>Keep your own copy of anything important.</strong>
    </p>

    <h2>Liability</h2>
    <p>
        To the extent the law allows, we aren't liable for any loss or damage from using or being unable to use
        Raya, including lost data. Nothing in these terms limits liability that can't be limited by law.
    </p>

    <h2>Ending your use</h2>
    <p>
        You can stop using Raya at any time and ask us to delete your account, as described in the
        <a href="/privacy">Privacy Policy</a>. We may suspend or end your access, especially if these terms are
        broken, and will try to give notice where reasonable.
    </p>

    <h2>Open source</h2>
    <p>
        Raya's source code is available under the MIT License on
        <a href="https://github.com/DarkKnight2000/DocEditor" target="_blank" rel="noopener noreferrer">GitHub</a>.
        That license covers the code. These terms cover your use of this hosted site.
    </p>

    <h2>Changes</h2>
    <p>
        We may update these terms. The new version will be posted here with a new "Last updated" date.
        Continuing to use Raya after a change means you accept the updated terms.
    </p>

    <h2>Contact</h2>
    {#if contact}
        <p>Questions about these terms: <a href="mailto:{contact}">{contact}</a>.</p>
    {:else}
        <p>Questions about these terms: contact the person who runs this site.</p>
    {/if}
</LegalPage>
