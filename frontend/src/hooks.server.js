import { VerifyUserCookie } from '$lib/server/server_auth.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve })
{
    // Verify the login cookie once per request. Routes use event.locals.user_id,
    // never the raw cookie, so a forged or expired cookie can't act as a user.
    const cookie = event.cookies.get('user_id');
    event.locals.user_id = cookie ? await VerifyUserCookie(cookie) : null;

    if(cookie && !event.locals.user_id)
    {
        event.cookies.delete('user_id', { path: '/' });
    }

    // app.html's preview tags need absolute URLs. url.origin is the address the visitor used
    // (behind Caddy it comes from the X-Forwarded-Proto/Host headers), so this works on any domain.
    return resolve(event, {
        transformPageChunk: ({ html }) => html.replaceAll('%raya.origin%', event.url.origin)
    });
}
