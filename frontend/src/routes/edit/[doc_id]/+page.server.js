import { GetSocketToken, MakeFetchRequest } from "$lib/server/server_auth.js";
import { HTTP_SERVER_ADDRESS } from "$lib/server/server_creds";
import { error, redirect } from "@sveltejs/kit";

export const ssr = false;

export async function load({ params, cookies, locals })
{
    if(!locals.user_id)
    {
        redirect(303, '/');
    }

    try
    {
        const response = await MakeFetchRequest(
            `${HTTP_SERVER_ADDRESS}/get-doc-info?doc_id=${params.doc_id}`,
            locals.user_id)
        if(response.ok)
        {
            const doc_info = JSON.parse(await response.json());
            return {
                'doc_id': params.doc_id,
                'doc_name': doc_info.doc_name,
                'user_pic': cookies.get('user_pic'),
                'user_name': cookies.get('user_name'),
                'ws_token': await GetSocketToken(locals.user_id, params.doc_id)
            }
        }
        else
        {
            return {
                'doc_name': '',
                'doc_id': params.doc_id,
                'user_pic': cookies.get('user_pic'),
                'user_name': cookies.get('user_name'),
                'hidden': true
            };
        };
    }
    catch (ex)
    {
        // Without doc info the editor can't open; show the error page instead
        console.error("Exception caught: ", ex);
        error(503, 'Could not reach the server. Please try again in a moment.');
    }
    
}