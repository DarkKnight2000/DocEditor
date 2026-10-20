// Document outline: the Title, Heading and Subtitle lines of a document, for the editor's left pane.
import { styleOfFormat } from './text_styles.js';

/**
 * @typedef {{ index: number, text: string, level: 1 | 2 | 3 }} OutlineItem
 *   index: position of the line's first character in the document
 *   level: 1 for a Title, 2 for a Heading, 3 for a Subtitle
 */

/** @type {Record<string, 1 | 2 | 3>} */
const LEVELS = { title: 1, heading: 2, subtitle: 3 };

/**
 * Lists the Title, Heading and Subtitle lines of a document. A line's style comes from the size of its
 * first character, the same way the style dropdown applies a style to whole lines.
 * Empty headings are left out.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops document contents (quill.getContents().ops)
 * @returns {OutlineItem[]}
 */
export function buildOutline(ops)
{
    /** @type {OutlineItem[]} */
    const outline = [];
    let index = 0;          // position in the document
    let lineStart = 0;
    let text = '';
    /** @type {any} */
    let lineSize;           // size of the line's first character; undefined until one is seen

    const endLine = () => {
        const style = styleOfFormat({ size: lineSize ?? undefined });
        const title = text.replace(/\s+/g, ' ').trim();
        const level = LEVELS[style];
        if(title && level)
        {
            outline.push({ index: lineStart, text: title, level });
        }
        text = '';
        lineSize = undefined;
    };

    for(const op of ops)
    {
        if(typeof op.insert !== 'string')
        {
            // an embed (e.g. an image) counts as one character
            if(op.insert?.pagebreak)
            {
                // a page break is a line of its own: the next line starts after it
                index += 1;
                lineStart = index;
            }
            else if(op.insert !== undefined)
            {
                if(lineSize === undefined) lineSize = op.attributes?.size ?? null;
                index += 1;
            }
            continue;
        }
        const parts = op.insert.split('\n');
        parts.forEach((part, i) => {
            if(part)
            {
                if(lineSize === undefined) lineSize = op.attributes?.size ?? null;
                text += part;
                index += part.length;
            }
            if(i < parts.length - 1)
            {
                // a newline ends the line
                endLine();
                index += 1;
                lineStart = index;
            }
        });
    }
    return outline;
}

/**
 * The outline item the cursor is in: the last heading at or before the cursor
 * @param {OutlineItem[]} outline
 * @param {number} cursor
 * @returns {number} position of that item in the outline, or -1 if the cursor is above every heading
 */
export function activeOutlineItem(outline, cursor)
{
    let active = -1;
    for(let i = 0; i < outline.length && outline[i].index <= cursor; i++) active = i;
    return active;
}
