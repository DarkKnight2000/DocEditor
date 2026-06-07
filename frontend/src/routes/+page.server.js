import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ cookies })
{
	if(cookies.get('user_id'))
    {
        console.log('User already logged in. Redirecting...')
        redirect(303, '/myhome');
    }
}