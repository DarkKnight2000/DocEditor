/** @type {import('./$types').PageServerLoad} */

import { GetAuthHeader } from '$lib/server/server_auth';
import { HTTP_SERVER_ADDRESS } from '$lib/server/server_creds';
import { redirect } from '@sveltejs/kit';

// This is only on server because "cookies" can only be accessed on server
export async function load({ cookies, fetch, url })
{
	if(!cookies.get('user_id'))
    {
        console.log('User not logged in. Redirecting to login page...')
        redirect(303, '/');
    }

	const profile_pic = cookies.get('user_pic');
	const user_name = cookies.get('user_name');
	const auth_header = await GetAuthHeader(cookies.get('user_id') ?? "", 30);

	try
	{
		const response = await fetch(`${HTTP_SERVER_ADDRESS}/get-user-docs`, {
			method: 'GET',
			headers: {
				'Authorization': auth_header
			}
		});
		console.log('finished request');
		const resp = await response.json();
		console.log(resp);
		const docs_info = JSON.parse(resp);
		// console.log(docs_info);

		return {
			profile_pic, user_name, docs_info
		};
	}
	catch(ex)
	{
		console.log(`Error fetching user details from server ${ex}`);
		cookies.delete('user_id', {'path': '/'});
		redirect(303, '/');
	}

}