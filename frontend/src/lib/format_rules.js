// Which link and colour values a document may hold. The server keeps to the same rules (doc_syncer.py,
// sanitize_change) and drops anything else, so pasted content is cleaned with them first: otherwise the
// editor would show a format the server never saved.

const LINK_SCHEMES = ['http', 'https', 'mailto', 'tel', 'sms'];

/**
 * A web, email or phone link, or one without a scheme ("example.com", as people often type them).
 * Other schemes, such as javascript:, aren't allowed.
 * @param {any} value
 */
export function linkAllowed(value)
{
    if(typeof value !== 'string' || value.length > 2048) return false;
    // browsers ignore leading spaces and control characters in a link, which could hide its scheme
    if(/[\x00-\x1f\x7f]/.test(value) || value !== value.trimStart()) return false;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
    return !scheme || LINK_SCHEMES.includes(scheme[1].toLowerCase());
}

/**
 * The link with the scheme people leave out: "example.com" becomes "https://example.com" (without one a
 * browser treats it as a page on Raya's own site) and "a@b.com" becomes "mailto:a@b.com". Links that
 * already have a scheme, or point within a page ("#top", "/path"), are left alone.
 * @param {string} link
 */
export function withScheme(link)
{
    const value = link.trim();
    if(!value || /^[/#?.]/.test(value)) return value;
    // "localhost:3000" looks like it has a scheme ("localhost:") but is a host and port
    if(/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z0-9.-]+:\d+(\/|$)/i.test(value)) return value;
    if(/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(value)) return `mailto:${value}`;
    return `https://${value}`;
}

/**
 * A colour written as #rgb, #rrggbb or rgb(r, g, b), the forms the colour pickers and Word export use.
 * @param {any} value
 */
export function colorAllowed(value)
{
    return typeof value === 'string'
        && /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i.test(value);
}

/** @type {Record<string, (value: any) => boolean>} */
const CHECKS = { link: linkAllowed, color: colorAllowed, background: colorAllowed };

/**
 * The ops without link and colour values Raya doesn't allow (a javascript: link, a colour named "red"),
 * and with the scheme added to links that left it out (withScheme).
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops Quill delta ops
 */
export function dropDisallowedValues(ops)
{
    return ops.map((op) => {
        if(!op.attributes) return op;
        const attributes = Object.fromEntries(Object.entries(op.attributes)
            .map(([name, value]) => [name, name === 'link' && typeof value === 'string' ? withScheme(value) : value])
            .filter(([name, value]) => !(name in CHECKS) || value == null || CHECKS[name](value)));
        const { attributes: _, ...rest } = op;
        return Object.keys(attributes).length ? { ...rest, attributes } : rest;
    });
}
