/** @type {import('./$types').PageServerLoad} */

import { GetAuthHeader } from '$lib/server/server_auth';
import { HTTP_SERVER_ADDRESS } from '$lib/server/server_creds';
import { redirect } from '@sveltejs/kit';

// This is only on server because "cookies" can only be accessed on server
export async function load({ cookies, locals, fetch, url })
{
	if(!locals.user_id)
    {
        redirect(303, '/');
    }

	const profile_pic = cookies.get('user_pic');
	const user_name = cookies.get('user_name');
	const auth_header = await GetAuthHeader(locals.user_id, 30);

	try
	{
		const [response, limits_response] = await Promise.all([
			fetch(`${HTTP_SERVER_ADDRESS}/get-user-docs`, { headers: { 'Authorization': auth_header } }),
			fetch(`${HTTP_SERVER_ADDRESS}/limits`, { headers: { 'Authorization': auth_header } }),
		]);
		const docs_info = JSON.parse(await response.json());
		// the limits line is optional, the page works without it
		const limits = limits_response.ok ? await limits_response.json() : null;

		return {
			profile_pic, user_name, docs_info, limits
		};
	}
	catch(ex)
	{
		console.log(`Error fetching user details from server ${ex}`);
		cookies.delete('user_id', {'path': '/'});
		redirect(303, '/');
	}

}