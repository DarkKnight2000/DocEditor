import { SHARED_JWT_SECRET } from '$env/static/private';
import * as jose from 'jose'


/**
 * @param {any} sub
 * @param {any} expire_time
 * @param {string | undefined} [secret]
 */
export async function EncryptUserID(sub, expire_time, secret)
{
    const INTERNAL_SECRET = new TextEncoder().encode(secret);
    return await new jose.SignJWT({sub})
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(`${expire_time}s`)
    .sign(INTERNAL_SECRET);
}

/**
 * @param {string} user_id_cookie
 * @param {any} expire_time
 */
export async function GetAuthHeader(user_id_cookie, expire_time)
{
    const payload = jose.decodeJwt(user_id_cookie);
    const enc_token = await EncryptUserID(payload.sub, expire_time, SHARED_JWT_SECRET);
    return `Bearer ${enc_token}`;
}

/**
 * @param {string} url
 * @param {{ get: (arg0: string) => any; }} cookies
 */
export async function MakeFetchRequest(url, cookies)
{
    const auth_header = await GetAuthHeader(cookies.get('user_id') ?? "", 30);
    
    return fetch(
        url,
        {
            headers: {
                'Authorization': auth_header
            }
        }
    );
}