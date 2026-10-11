import { GetAuthHeader } from "$lib/server/server_auth";
import { HTTP_SERVER_ADDRESS } from "$lib/server/server_creds";

export async function POST({ request, cookies, locals, url, fetch})
{
	const body = await request.json();
	if(!body.func) return new Response('Request failed, Need function key', {status: 401});

	if(body.func === 'create_doc')
	{
		if(!locals.user_id) return new Response('Not logged in', {status: 401});
		const auth_header = await GetAuthHeader(locals.user_id, 30);

		const response = await fetch(`${HTTP_SERVER_ADDRESS}/create-new-doc`, {
			method: 'POST',
			headers: {
				'Authorization': auth_header
			}
		});
		if(response.ok) return new Response(await response.json(), {status: 200});
		else return new Response('Create failed', {status: 401});
	}
	else if(body.func === 'logout')
	{
		cookies.delete('user_id', {'path': '/'});
		return new Response('ok');
	}
    return new Response('Not allowed', {status: 404});
}