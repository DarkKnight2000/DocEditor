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

		// pass the backend's reason (e.g. the document limit) and status through to the page
		let message = 'Could not create a document.';
		try { message = (await response.json()).detail ?? message; } catch {}
		return new Response(message, {status: response.status});
	}
	else if(body.func === 'delete_doc')
	{
		if(!locals.user_id) return new Response('Not logged in', {status: 401});
		if(typeof body.doc_id !== 'string') return new Response('Body needs a "doc_id" key', {status: 400});

		const response = await fetch(`${HTTP_SERVER_ADDRESS}/delete-doc`, {
			method: 'POST',
			headers: {
				'Authorization': await GetAuthHeader(locals.user_id, 30),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({id: body.doc_id})
		});
		if(response.ok) return new Response('ok', {status: 200});

		let message = 'Could not delete the document.';
		try { message = (await response.json()).detail ?? message; } catch {}
		return new Response(message, {status: response.status});
	}
	else if(body.func === 'logout')
	{
		// clear everything login stored (user_email is no longer set, but older sessions have it)
		for(const name of ['user_id', 'user_name', 'user_pic', 'user_email'])
		{
			cookies.delete(name, {'path': '/'});
		}
		return new Response('ok');
	}
    return new Response('Not allowed', {status: 404});
}