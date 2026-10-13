// Text styles offered in the editor's style dropdown. Each is a preset of ordinary Quill
// formats, so the result is plain formatting the toolbar buttons can still change:
//   size  - Quill's size attributor ('huge', 'large', 'small'; false = normal), sized in quill-editor.css
//   bold, italic - inline formats
//   align - line format ('center'; false = left). Title centres, Text left-aligns.

export const TEXT_STYLES = [
    { id: 'title', label: 'Title' },
    { id: 'subtitle', label: 'Subtitle' },
    { id: 'text', label: 'Text' },
    { id: 'tiny', label: 'Tiny' },
];

/** @type {Record<string, string | false>} */
const SIZE_OF_STYLE = { title: 'huge', subtitle: 'large', text: false, tiny: 'small' };

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
    if(size === 'large') return 'subtitle';
    if(size === 'small') return 'tiny';
    if(format?.align) return '';
    return 'text';
}

/**
 * Formats to apply when switching lines from currentStyle to style.
 * Title and Subtitle add their emphasis; switching back to Text or Tiny removes only what those
 * styles added, so words the user bolded in ordinary text keep their formatting.
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

    if(style === 'title')
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
    const leavingHeading = currentStyle === 'title' || currentStyle === 'subtitle' || currentStyle === '';
    if((style === 'text' || style === 'tiny') && leavingHeading)
    {
        inline.bold = false;
        inline.italic = false;
    }
    if(style === 'text' || (style !== 'title' && (currentStyle === 'title' || currentStyle === '')))
    {
        align = false;      // Text is always left-aligned, and only Title is centred
    }
    return { inline, align };
}
