import { GetAuthHeader, MakeFetchRequest } from "$lib/server/server_auth.js";
import { HTTP_SERVER_ADDRESS } from "$lib/server/server_creds";


export async function POST({request, cookies, url, fetch})
{
    const body = JSON.parse(await request.text()) ?? {};
    if(body.func === "rename-doc")
    {
        const new_doc_name = body.name;
        if(!new_doc_name)
        {
            return new Response('Body needs a "name" key', {status: 401});
        }
        const doc_id = url.pathname.split('/').at(-1);
        const auth_header = await GetAuthHeader(cookies.get('user_id') ?? "", 30);
        const response = await fetch(`${HTTP_SERVER_ADDRESS}/rename-doc`, {
			method: 'POST',
			headers: {
				'Authorization': auth_header,
                'Content-Type': 'application/json'
			},
            body: JSON.stringify({
                'id': doc_id,
                'name': new_doc_name
            })
		});

		if(response.ok)
        {
            return new Response(await response.text(), {status: 200});
        }
		else return new Response('Rename failed', {status: 401});
    }
    else if(body.func === "get-collabs")
    {
        const doc_id = url.pathname.split('/').at(-1);
        const response = await MakeFetchRequest(
                    `${HTTP_SERVER_ADDRESS}/get-collab-info?doc_id=${doc_id}`,
                    cookies);

		if(response.ok)
        {
            const text = await response.text();
            console.log('cinfo', text);
            return new Response((text), {status: 200});
        }
		else return new Response('GET failed', {status: 401});
    }
    else if(body.func === "edit-collab")
    {
        const user_email = body.user_email;
        const op = body.op;
        if(!user_email)
        {
            return new Response('Body needs a "user_email" key', {status: 401});
        }
        const doc_id = url.pathname.split('/').at(-1);
        const auth_header = await GetAuthHeader(cookies.get('user_id') ?? "", 30);
        const response = await fetch(`${HTTP_SERVER_ADDRESS}/edit-collab`, {
			method: 'POST',
			headers: {
				'Authorization': auth_header,
                'Content-Type': 'application/json'
			},
            body: JSON.stringify({
                'doc_id': doc_id,
                'user_email': user_email,
                'op': op
            })
		});

		if(response.ok) return new Response(await response.text(), {status: 200});
		else return new Response('Rename failed', {status: 401});
    }
    return new Response('Not allowed', {status: 404});
}