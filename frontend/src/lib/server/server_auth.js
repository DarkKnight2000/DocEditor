import { env } from '$env/dynamic/private';
import * as jose from 'jose'


/**
 * @param {any} sub
 * @param {any} expire_time
 * @param {string | undefined} [secret]
 * @param {Record<string, any>} [claims] extra claims to include
 */
export async function EncryptUserID(sub, expire_time, secret, claims = {})
{
    const INTERNAL_SECRET = new TextEncoder().encode(secret);
    return await new jose.SignJWT({...claims, sub})
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(`${expire_time}s`)
    .sign(INTERNAL_SECRET);
}

/**
 * Verifies the signature and expiry of the "user_id" cookie.
 * @param {string} user_id_cookie
 * @returns {Promise<string | null>} user id, or null if the cookie is invalid
 */
export async function VerifyUserCookie(user_id_cookie)
{
    try
    {
        const secret = new TextEncoder().encode(env.INTERNAL_JWT_SECRET);
        const { payload } = await jose.jwtVerify(user_id_cookie, secret, { algorithms: ['HS256'] });
        return typeof payload.sub === 'string' ? payload.sub : null;
    }
    catch
    {
        return null;
    }
}

/**
 * @param {string} user_id verified user id (event.locals.user_id)
 * @param {any} expire_time
 */
export async function GetAuthHeader(user_id, expire_time)
{
    const enc_token = await EncryptUserID(user_id, expire_time, env.SHARED_JWT_SECRET);
    return `Bearer ${enc_token}`;
}

/**
 * Short-lived token the browser sends when opening the edit socket.
 * The audience and doc_id claims stop it being used as an API token or for another doc.
 * @param {string} user_id verified user id (event.locals.user_id)
 * @param {string} doc_id
 */
export async function GetSocketToken(user_id, doc_id)
{
    return await EncryptUserID(user_id, 60, env.SHARED_JWT_SECRET, { aud: 'edit-socket', doc_id });
}

/**
 * @param {string} url
 * @param {string} user_id verified user id (event.locals.user_id)
 */
export async function MakeFetchRequest(url, user_id)
{
    const auth_header = await GetAuthHeader(user_id, 30);

    return fetch(
        url,
        {
            headers: {
                'Authorization': auth_header
            }
        }
    );
}
