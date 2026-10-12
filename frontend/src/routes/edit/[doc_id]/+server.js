import { GetAuthHeader, MakeFetchRequest } from "$lib/server/server_auth.js";
import { HTTP_SERVER_ADDRESS } from "$lib/server/server_creds";


/**
 * Passes the backend's status and reason ({"detail": "..."}) through to the page
 * @param {Response} response failed backend response
 * @param {string} fallback message to use if the backend didn't give one
 */
async function ForwardError(response, fallback)
{
    let message = fallback;
    try { message = (await response.json()).detail ?? message; } catch {}
    return new Response(message, {status: response.status});
}

/**
 * @param {string} path backend path, e.g. "/rename-doc"
 * @param {string} user_id
 * @param {object} body
 * @param {typeof fetch} fetch
 */
async function PostToBackend(path, user_id, body, fetch)
{
    return fetch(`${HTTP_SERVER_ADDRESS}${path}`, {
        method: 'POST',
        headers: {
            'Authorization': await GetAuthHeader(user_id, 30),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
}

export async function POST({request, locals, params, fetch})
{
    if(!locals.user_id) return new Response('Not logged in', {status: 401});

    let body;
    try { body = await request.json(); }
    catch { return new Response('Body must be JSON', {status: 400}); }

    const doc_id = params.doc_id;
    if(body?.func === "rename-doc")
    {
        const new_doc_name = typeof body.name === 'string' ? body.name.trim() : '';
        if(!new_doc_name)
        {
            return new Response('Document name can\'t be empty.', {status: 400});
        }
        const response = await PostToBackend('/rename-doc', locals.user_id, {'id': doc_id, 'name': new_doc_name}, fetch);
        if(response.ok) return new Response(await response.text(), {status: 200});
        return ForwardError(response, 'Could not rename the document.');
    }
    else if(body?.func === "get-collabs")
    {
        const response = await MakeFetchRequest(
                    `${HTTP_SERVER_ADDRESS}/get-collab-info?doc_id=${doc_id}`,
                    locals.user_id);
        if(response.ok) return new Response(await response.text(), {status: 200});
        return ForwardError(response, 'Could not load collaborators.');
    }
    else if(body?.func === "edit-collab")
    {
        if(!body.user_email)
        {
            return new Response('Body needs a "user_email" key', {status: 400});
        }
        const response = await PostToBackend('/edit-collab', locals.user_id,
            {'doc_id': doc_id, 'user_email': body.user_email, 'op': body.op}, fetch);
        if(response.ok) return new Response(await response.text(), {status: 200});
        return ForwardError(response, 'Could not update collaborators.');
    }
    return new Response('Not allowed', {status: 404});
}
