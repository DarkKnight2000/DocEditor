import { error, redirect } from '@sveltejs/kit';
import { OAuth2Client } from 'google-auth-library';
import { EncryptUserID } from '$lib/server/server_auth.js';
import { env } from '$env/dynamic/private'
import { env as public_env } from '$env/dynamic/public'
import { HTTP_SERVER_ADDRESS } from '$lib/server/server_creds';

/**
 * @param {string} [token]
 */
async function authorize(token)
{
    if(!token) return;
    
    let payload;
    try
    {
        const client = new OAuth2Client(public_env.PUBLIC_GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: public_env.PUBLIC_GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
    }
    catch (e)
    {
        return new Response('Invalid token', {status: 401});
    }

    if(!payload)
    {
        return new Response('Empty token', {status: 401});
    }

    // no need to verify or get access token because we are using only basic details, which we already got
    return payload;
}

// Reference: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

export async function POST({ request, cookies, url, fetch })
{
    const cookie_g_csrf = cookies.get("g_csrf_token");
    const reqJson = await request.formData();
    const credential_str = reqJson.get("credential")?.toString() ?? "";

    if(!credential_str || typeof credential_str !== 'string')
    {
        return new Response("Missing credential", {status: 400});
    }

    // CSRF attack verification
    if(reqJson.get("g_csrf_token") !== cookie_g_csrf)
    {
        redirect(303, "/");
    }

    const payload = await authorize(credential_str);
    if(!payload) redirect(302, "/");
    if(payload instanceof Response) return payload;

    // tell backend to create/update the user first; only log in if that worked,
    // otherwise the user would have cookies but no account (e.g. "New Doc" would fail)
    const shared_user_id = await EncryptUserID(payload.sub, 30, env.SHARED_JWT_SECRET);
    let response;
    try {
        response = await fetch(`${HTTP_SERVER_ADDRESS}/user-login`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${shared_user_id}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: payload.name ?? "",
                // collaborators are found by email, so only store it once Google has verified it
                email: payload.email_verified ? payload.email : null,
                // shown to the others editing the same document
                picture: payload.picture ?? null
            })
        });
    }
    catch(ex) {
        console.log("Couldn't reach server. Is the server running? Server at", HTTP_SERVER_ADDRESS);
        console.log("Details: ", ex);
    };
    if(!response?.ok)
    {
        console.log('User login failed on the server:', response?.status);
        error(502, 'Could not complete sign-in. Please try again.');
    }

    // encrypt 'sub' before storing in cookies
    const expire_time = 60 * 60 * 24 * 7;
    const enc_user_id = await EncryptUserID(payload.sub, expire_time, env.INTERNAL_JWT_SECRET);

    const cookies_props = {path: "/", httpOnly: true, secure: true, maxAge: expire_time};
    cookies.set("user_id", enc_user_id, cookies_props);
    cookies.set("user_name", payload?.name ?? "", cookies_props);
    cookies.set("user_pic", payload?.picture ?? "", cookies_props);

    // return to myhome page
    redirect(303, "/myhome");
}