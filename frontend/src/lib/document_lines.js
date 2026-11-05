// A document as lines and blocks, the shared starting point of the exports (Word, PDF, EPUB).
// Kept free of Quill/DOM so it can be unit tested.
import { styleOfFormat } from './text_styles.js';
import { withScheme } from './format_rules.js';

/**
 * @typedef {{ text: string, attributes: Record<string, any> }} Run
 * @typedef {{ runs: Run[], attributes: Record<string, any>, style: string, pageBreak?: boolean }} Line
 *   attributes: the line's formats (align, list, indent, table), from the newline that ends it
 *   style: 'title' | 'heading' | 'subtitle' | 'text' | 'tiny', from the size of the line's first character
 *   pageBreak: a manual page break (page_break.js) instead of text
 * @typedef {{ type: 'line', line: Line } | { type: 'table', rows: Line[][] }} Block
 */

/**
 * Splits a document into lines of formatted text runs.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops document contents (quill.getContents().ops)
 * @returns {Line[]}
 */
export function deltaToLines(ops)
{
    /** @type {Line[]} */
    const lines = [];
    /** @type {Run[]} */
    let runs = [];

    for(const op of ops)
    {
        if(typeof op.insert !== 'string')
        {
            // a page break is a line of its own; other embeds (pasted images and the like) aren't
            // supported by Raya, so they're left out
            if(op.insert?.pagebreak)
            {
                if(runs.length) lines.push({ runs, attributes: {}, style: 'text' });
                runs = [];
                lines.push({ runs: [], attributes: {}, style: 'text', pageBreak: true });
            }
            continue;
        }
        const parts = op.insert.split('\n');
        parts.forEach((part, i) => {
            if(part) runs.push({ text: part, attributes: op.attributes ?? {} });
            if(i < parts.length - 1)
            {
                // the newline ends the line and carries its line formats
                const size = runs[0]?.attributes.size;
                lines.push({ runs, attributes: op.attributes ?? {}, style: styleOfFormat({ size }) || 'text' });
                runs = [];
            }
        });
    }
    // Quill documents end with a newline; text after the last one (if any) is still a line
    if(runs.length) lines.push({ runs, attributes: {}, style: 'text' });
    return lines;
}

/**
 * Lines grouped into blocks: ordinary lines, and tables (table.js: each cell is a line, and a row is the
 * run of cells that share a row id)
 * @param {Line[]} lines
 * @returns {Block[]}
 */
export function linesToBlocks(lines)
{
    /** @type {Block[]} */
    const blocks = [];
    for(let i = 0; i < lines.length;)
    {
        if(!lines[i].attributes.table)
        {
            blocks.push({ type: 'line', line: lines[i++] });
            continue;
        }
        /** @type {Line[][]} */
        const rows = [];
        while(i < lines.length && lines[i].attributes.table)
        {
            const id = lines[i].attributes.table;
            const row = [];
            while(i < lines.length && lines[i].attributes.table === id) row.push(lines[i++]);
            rows.push(row);
        }
        blocks.push({ type: 'table', rows });
    }
    return blocks;
}

/**
 * Only http(s) and mailto links are kept as links; anything else becomes plain text. A link saved without
 * its scheme ("example.com") gets one.
 * @param {any} link
 * @returns {string | null}
 */
export function safeLink(link)
{
    if(typeof link !== 'string') return null;
    link = withScheme(link);
    return /^(https?:|mailto:)/i.test(link) ? link : null;
}

/**
 * A safe file name for an export: the document name without characters file systems reject.
 * @param {string} name
 * @param {string} extension without the dot
 */
export function exportFileName(name, extension)
{
    const clean = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return `${clean || 'Untitled'}.${extension}`;
}
