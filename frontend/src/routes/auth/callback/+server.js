import { redirect } from '@sveltejs/kit';
import { OAuth2Client } from 'google-auth-library';
import { HTTP_SERVER_ADDRESS } from '$lib/server/server_creds.js'
import * as jose from 'jose';
import { EncryptUserID } from '$lib/server/server_auth.js';
import {INTERNAL_JWT_SECRET, SHARED_JWT_SECRET} from '$env/static/private'
import { PUBLIC_GOOGLE_CLIENT_ID } from '$env/static/public'

/**
 * @param {string} [token]
 */
async function authorize(token)
{
    if(!token) return;
    
    let payload;
    try
    {
        const client = new OAuth2Client(PUBLIC_GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: PUBLIC_GOOGLE_CLIENT_ID,
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

export async function POST({ request, cookies })
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

    // encrypt 'sub' before storing in cookies
    const expire_time = 60 * 60 * 24 * 7;
    const enc_user_id = await EncryptUserID(payload.sub, expire_time, INTERNAL_JWT_SECRET);

    const cookies_props = {path: "/", httpOnly: true, secure: true, maxAge: expire_time};
    cookies.set("user_id", enc_user_id, cookies_props);
    cookies.set("user_name", payload?.name ?? "", cookies_props);
    cookies.set("user_email", payload?.email ?? "", cookies_props);
    cookies.set("user_pic", payload?.picture ?? "", cookies_props);
    // console.log(payload.sub)

    // tell backend to create user
    const shared_user_id = await EncryptUserID(payload.sub, 30, SHARED_JWT_SECRET);

    const response = await fetch(`${HTTP_SERVER_ADDRESS}/user-login`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${shared_user_id}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({name: payload.name ?? ""})
    }).catch(() => {
        console.log("Couldn't reach server. Is the server running?");
        redirect(303, "/");
    });

    // return to myhome page
    redirect(303, "/myhome");
}