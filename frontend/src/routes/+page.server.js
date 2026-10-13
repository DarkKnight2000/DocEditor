import { redirect } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ locals })
{
	if(locals.user_id)
    {
        redirect(303, '/myhome');
    }
}