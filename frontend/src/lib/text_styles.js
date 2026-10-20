// Text styles offered in the editor's style dropdown. Each is a preset of ordinary Quill
// formats, so the result is plain formatting the toolbar buttons can still change:
//   size  - Quill's size attributor ('huge', 'xlarge', 'large', 'small'; false = normal), sized in
//           quill-editor.css ('xlarge' is Raya's own, registered in Editor.svelte)
//   bold, italic - inline formats
//   align - line format ('center'; false = left). Title and Heading centre, Text left-aligns.

export const TEXT_STYLES = [
    { id: 'title', label: 'Title' },
    { id: 'heading', label: 'Heading' },
    { id: 'subtitle', label: 'Subtitle' },
    { id: 'text', label: 'Text' },
    { id: 'tiny', label: 'Tiny' },
];

/** @type {Record<string, string | false>} */
const SIZE_OF_STYLE = { title: 'huge', heading: 'xlarge', subtitle: 'large', text: false, tiny: 'small' };

// the styles that are centred and bold; the others are left-aligned
const CENTRED = ['title', 'heading'];
// the styles that add emphasis (bold, italic), which switching to Text or Tiny removes again
const HEADINGS = ['title', 'heading', 'subtitle'];

/**
 * Which style a selection has, from quill.getFormat(). '' means none of the styles (shown as
 * "Custom"): mixed sizes, or normal-size text that isn't left-aligned (Text is always left-aligned).
 * Returning '' there also lets the user pick Text to reset it, since picking the option a dropdown
 * already shows does nothing.
 * @param {Record<string, any>} format
 */
export function styleOfFormat(format)
{
    const size = format?.size;
    if(Array.isArray(size)) return '';
    if(size === 'huge') return 'title';
    if(size === 'xlarge') return 'heading';
    if(size === 'large') return 'subtitle';
    if(size === 'small') return 'tiny';
    if(format?.align) return '';
    return 'text';
}

/**
 * Formats to apply when switching lines from currentStyle to style.
 * Title, Heading and Subtitle add their emphasis; switching back to Text or Tiny removes only what
 * those styles added, so words the user bolded in ordinary text keep their formatting.
 * @param {string} style one of TEXT_STYLES ids
 * @param {string} currentStyle style the lines have now ('' if mixed)
 * @returns {{ inline: Record<string, any>, align?: string | false }}
 */
export function formatsForStyle(style, currentStyle)
{
    /** @type {Record<string, any>} */
    const inline = { size: SIZE_OF_STYLE[style] ?? false };
    /** @type {string | false | undefined} */
    let align;

    if(CENTRED.includes(style))
    {
        inline.bold = true;
        inline.italic = false;
        align = 'center';
    }
    else if(style === 'subtitle')
    {
        inline.bold = true;
        inline.italic = true;
    }

    // leaving a styled heading: drop the emphasis that style added
    const leavingHeading = HEADINGS.includes(currentStyle) || currentStyle === '';
    if((style === 'text' || style === 'tiny') && leavingHeading)
    {
        inline.bold = false;
        inline.italic = false;
    }
    // Text is always left-aligned; other styles that aren't centred drop the centring of a centred style
    if(style === 'text' || (!CENTRED.includes(style) && (CENTRED.includes(currentStyle) || currentStyle === '')))
    {
        align = false;
    }
    return { inline, align };
}

/**
 * Gives pasted content one of the styles, e.g. a pasted <h1> becomes a Heading: the style's inline formats go
 * on the text (over what was pasted), its alignment on the line endings. Formats the style turns off
 * (italic for Heading, say) are removed.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops the pasted content (Quill delta ops)
 * @param {string} style one of TEXT_STYLES ids
 */
export function applyStyleToOps(ops, style)
{
    const { inline, align } = formatsForStyle(style, 'text');
    /** @param {Record<string, any>} attrs */
    const tidy = (attrs) => {
        const kept = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== false && v != null));
        return Object.keys(kept).length ? kept : undefined;
    };
    /** @type {Array<{insert: any, attributes?: Record<string, any>}>} */
    const out = [];
    for(const op of ops)
    {
        if(typeof op.insert !== 'string')
        {
            out.push(/** @type {any} */ (op));
            continue;
        }
        for(const part of op.insert.split(/(\n)/))
        {
            if(!part) continue;
            const attributes = part === '\n'
                ? tidy({ ...op.attributes, ...(align ? { align } : {}) })
                : tidy({ ...op.attributes, ...inline });
            out.push(attributes ? { insert: part, attributes } : { insert: part });
        }
    }
    return out;
}
