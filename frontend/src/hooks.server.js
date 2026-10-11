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

    return resolve(event);
}
