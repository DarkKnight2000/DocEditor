import { GetAuthHeader } from "$lib/server/server_auth";
import { HTTP_SERVER_ADDRESS } from "$lib/server/server_creds";

export async function POST({ request, cookies})
{
    const auth_header = await GetAuthHeader(cookies.get('user_id') ?? "", 30);

	const response = await fetch(`${HTTP_SERVER_ADDRESS}/create-new-doc`, {
		method: 'POST',
		headers: {
			'Authorization': auth_header
		}
	});
    if(response.ok) return new Response(await response.json(), {status: 200});
    else return new Response('Create failed', {status: 401});
}