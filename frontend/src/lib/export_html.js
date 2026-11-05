// A document as HTML, for the PDF (print) and EPUB exports. The HTML is also well-formed XML (void
// elements closed, text escaped), which EPUB's XHTML needs. Kept free of Quill/DOM so it can be unit tested.
//
// Mapping, as in the Word export: Title, Heading and Subtitle lines become h1, h2 and h3; Tiny text a
// smaller paragraph; bold, italic, underline, strikethrough, superscript/subscript, links, alignment,
// lists (nested by indent), text and highlight colours their HTML equivalents; tables HTML tables, and
// manual page breaks a page break for print.
import { safeLink } from './document_lines.js';
import { colorAllowed } from './format_rules.js';

/** @typedef {import('./document_lines.js').Line} Line */
/** @typedef {import('./document_lines.js').Run} Run */
/** @typedef {import('./document_lines.js').Block} Block */

// the formats each style gives its text, so its runs don't repeat them
const STYLE_FORMATS = {
    title: { size: 'huge', bold: true },
    heading: { size: 'xlarge', bold: true },
    subtitle: { size: 'large', bold: true, italic: true },
    tiny: { size: 'small' },
    text: {},
};
const TAGS = { title: 'h1', heading: 'h2', subtitle: 'h3' };

/**
 * Text for HTML/XML, without the control characters XML doesn't allow
 * @param {string} text
 */
export function escapeXml(text)
{
    return text
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * @param {Run} run
 * @param {string} style the run's line style
 */
function runHtml(run, style)
{
    const a = run.attributes;
    const given = /** @type {Record<string, any>} */ (STYLE_FORMATS[/** @type {keyof typeof STYLE_FORMATS} */ (style)] ?? {});
    let html = escapeXml(run.text);
    if(a.script === 'super') html = `<sup>${html}</sup>`;
    if(a.script === 'sub') html = `<sub>${html}</sub>`;
    if(a.strike) html = `<s>${html}</s>`;
    if(a.underline) html = `<u>${html}</u>`;
    if(a.italic && !given.italic) html = `<em>${html}</em>`;
    if(a.bold && !given.bold) html = `<strong>${html}</strong>`;

    const css = [];
    if(colorAllowed(a.color)) css.push(`color: ${a.color}`);
    if(colorAllowed(a.background)) css.push(`background-color: ${a.background}`);
    const size = a.size && a.size !== given.size && ['small', 'large', 'xlarge', 'huge'].includes(a.size) ? a.size : null;
    if(css.length || size)
    {
        html = `<span${size ? ` class="size-${size}"` : ''}${css.length ? ` style="${css.join('; ')}"` : ''}>${html}</span>`;
    }
    const link = safeLink(a.link);
    if(link) html = `<a href="${escapeXml(link)}">${html}</a>`;
    return html;
}

/**
 * The line's text as HTML; an empty line keeps its height
 * @param {Line} line
 */
function contentHtml(line)
{
    return line.runs.map((run) => runHtml(run, line.style)).join('') || '<br/>';
}

/** @param {Line} line */
function alignClass(line)
{
    const align = line.attributes.align;
    return ['center', 'right', 'justify'].includes(align) ? `align-${align}` : '';
}

/**
 * @param {Line} line
 * @param {string | null} id
 */
function lineHtml(line, id)
{
    if(line.pageBreak) return '<div class="page-break"></div>';
    const tag = TAGS[/** @type {keyof typeof TAGS} */ (line.style)] ?? 'p';
    const classes = [alignClass(line), line.style === 'tiny' ? 'tiny' : ''].filter(Boolean).join(' ');
    return `<${tag}${id ? ` id="${escapeXml(id)}"` : ''}${classes ? ` class="${classes}"` : ''}>${contentHtml(line)}</${tag}>`;
}

/** @param {Line[][]} rows */
function tableHtml(rows)
{
    const columns = Math.max(...rows.map((row) => row.length));
    const body = rows.map((row) => '<tr>' + Array.from({ length: columns }, (_, c) => {
        const cell = row[c];
        const align = cell ? alignClass(cell) : '';
        return `<td${align ? ` class="${align}"` : ''}>${cell ? cell.runs.map((run) => runHtml(run, 'text')).join('') : ''}</td>`;
    }).join('') + '</tr>').join('');
    return `<table><tbody>${body}</tbody></table>`;
}

/**
 * The blocks as HTML.
 * @param {Block[]} blocks
 * @param {(line: Line) => string | null} [idOf] an id for a line (the EPUB table of contents links to them)
 */
export function blocksToHtml(blocks, idOf = () => null)
{
    const out = [];
    // open lists, innermost last: their tag and indent level
    /** @type {Array<{ tag: string, level: number }>} */
    const lists = [];
    const closeListsTo = (/** @type {number} */ level) => {
        while(lists.length && lists[lists.length - 1].level >= level) out.push(`</li></${lists.pop()?.tag}>`);
    };

    for(const block of blocks)
    {
        const line = block.type === 'line' ? block.line : null;
        const list = line?.attributes.list === 'ordered' ? 'ol' : line?.attributes.list === 'bullet' ? 'ul' : null;
        if(!line || !list)
        {
            closeListsTo(0);
            out.push(line ? lineHtml(line, idOf(line)) : tableHtml(/** @type {any} */ (block).rows));
            continue;
        }
        const level = Math.min(Math.max(Number(line.attributes.indent) || 0, 0), 8);
        // leave deeper lists, and a list of the other kind at this level
        closeListsTo(level + 1);
        const top = lists[lists.length - 1];
        if(top && top.level === level && top.tag !== list) closeListsTo(level);
        const current = lists[lists.length - 1];
        if(current && current.level === level)
        {
            out.push(`</li><li${alignClass(line) ? ` class="${alignClass(line)}"` : ''}>${contentHtml(line)}`);
        }
        else
        {
            // a new list, possibly nested in the item before it
            out.push(`<${list}><li${alignClass(line) ? ` class="${alignClass(line)}"` : ''}>${contentHtml(line)}`);
            lists.push({ tag: list, level });
        }
    }
    closeListsTo(0);
    return out.join('\n');
}

/**
 * The plain text of a line, e.g. for a chapter title
 * @param {Line} line
 */
export function lineText(line)
{
    return line.runs.map((run) => run.text).join('').trim();
}

// Styles for exported documents, the editor's look on paper or an e-reader (quill-editor.css): sizes
// relative to the body text, so readers can change the text size. `scope` is put before each selector.
// List markers and link underlines are set outright: printed from the app's page, the print copy would
// otherwise get the app's CSS reset, which removes them.
/** @param {string} scope */
export function exportCss(scope = '')
{
    const s = (/** @type {string} */ selector) => selector.split(',').map((part) => `${scope}${part.trim()}`).join(', ');
    return `
${s('h1, h2, h3')} { margin: 1.2em 0 0.5em; line-height: 1.25; font-weight: bold; }
${s('h1')} { font-size: 2.25em; }
${s('h2')} { font-size: 1.6em; }
${s('h3')} { font-size: 1.35em; font-style: italic; }
${s('p')} { margin: 0 0 0.4em; }
${s('.tiny')} { font-size: 0.85em; }
${s('.size-huge')} { font-size: 2.25em; }
${s('.size-xlarge')} { font-size: 1.6em; }
${s('.size-large')} { font-size: 1.35em; }
${s('.size-small')} { font-size: 0.85em; }
${s('.align-center')} { text-align: center; }
${s('.align-right')} { text-align: right; }
${s('.align-justify')} { text-align: justify; }
${s('ol, ul')} { margin: 0 0 0.4em; padding-left: 1.5em; }
${s('ol')} { list-style: decimal; }
${s('ul')} { list-style: disc; }
${s('a')} { color: #1d4ed8; text-decoration: underline; }
${s('table')} { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 0.8em 0; }
${s('td')} { border: 1px solid #d1d5db; padding: 0.3em 0.6em; vertical-align: top; }
${s('.page-break')} { break-after: page; page-break-after: always; }
`;
}
