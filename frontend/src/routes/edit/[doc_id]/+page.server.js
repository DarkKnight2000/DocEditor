import { GetAuthHeader, MakeFetchRequest } from "$lib/server/server_auth.js";
import { HTTP_SERVER_ADDRESS } from "$lib/server/server_creds.js";
import { redirect } from "@sveltejs/kit";

export const ssr = false;

export async function load({ params, cookies })
{
    if(!cookies.get('user_id'))
    {
        console.log('User not logged in. Redirecting to login page...')
        redirect(303, '/');
    }

    try
    {
        const response = await MakeFetchRequest(
            `${HTTP_SERVER_ADDRESS}/get-doc-info?doc_id=${params.doc_id}`,
            cookies)
        if(response.ok)
        {
            console.log('Success')
            const doc_info = JSON.parse(await response.json());
            return {
                'doc_id': params.doc_id,
                'doc_name': doc_info.doc_name,
                'user_pic': cookies.get('user_pic')
            }
        }
        else
        {
            console.log('Error response from server: ', response.status);
            return {};
        };
    }
    catch (ex)
    {
        console.error("Exception caught: ", ex);
        return {};
    }
    
}