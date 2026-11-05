// Manual page breaks: an item in the document, { insert: { pagebreak: true } }, that sits on a line of
// its own and starts a new page. It's one character long, so the sync, cursors and character count treat
// it like any other character. quill-editor.css draws it as the gap between two pages; the Word export
// turns it into a real page break.
import Quill, { Delta } from 'quill';

/** @type {any} */
const BlockEmbed = Quill.import('blots/block/embed');

class PageBreak extends BlockEmbed
{
    static blotName = 'pagebreak';
    static tagName = 'HR';
    static className = 'page-break';

    static create()
    {
        const node = super.create();
        // the break is an object, not text to type into
        node.setAttribute('contenteditable', 'false');
        return node;
    }

    static value()
    {
        return true;
    }
}

Quill.register(PageBreak);

/**
 * Inserts a page break at the selection (replacing any selected text) and puts the cursor at the start
 * of the new page. One change, so it's a single step to undo.
 * @param {any} quill
 */
export function insertPageBreak(quill)
{
    const range = quill.getSelection(true);
    // a page break can't go inside a table cell: it would split the table
    if(quill.getFormat(range).table) return;
    quill.updateContents(new Delta().retain(range.index).delete(range.length).insert({ pagebreak: true }), 'user');
    quill.setSelection(range.index + 1, 0, 'silent');
}

/**
 * Whether an element's own style starts a new page before or after it. Word and LibreOffice mark page
 * breaks this way (page-break-before: always; break-before: page also allows left/right pages).
 * @param {any} node an element of pasted HTML
 */
export function pageBreakSides(node)
{
    const style = node.style;
    const breaks = (/** @type {string} */ legacy, /** @type {string} */ modern) =>
        legacy === 'always' || legacy === 'left' || legacy === 'right' || ['page', 'left', 'right', 'recto', 'verso'].includes(modern);
    return {
        before: !!style && breaks(style.pageBreakBefore, style.breakBefore),
        after: !!style && breaks(style.pageBreakAfter, style.breakAfter),
    };
}

/**
 * Turns the page breaks in pasted HTML into Raya's, for a clipboard matcher on every element:
 * - an <hr> is a page break when it is one: Raya's own (class page-break) or a styled one (Google Docs
 *   pastes a hidden <hr style="page-break-before: always">). A plain horizontal line from a web page isn't
 *   one, and Raya has no horizontal lines, so it's dropped.
 * - a <br> styled as a page break (Word) becomes one
 * - any other element whose style breaks the page (Word, LibreOffice) gets a page break before or after it
 * Inside a table there are no page breaks (one would split the table), so they're dropped.
 * @param {any} node the pasted element
 * @param {Delta} delta what Quill made of it
 * @param {boolean} inTable whether the paste goes into a table cell
 */
export function withPastedPageBreaks(node, delta, inTable)
{
    const tag = node.tagName;
    const { before, after } = pageBreakSides(node);
    const pageBreak = () => (inTable ? new Delta() : new Delta().insert({ pagebreak: true }));
    if(tag === 'HR') return node.classList.contains('page-break') || before || after ? pageBreak() : new Delta();
    if(tag === 'BR') return before || after ? pageBreak() : delta;
    let out = before ? pageBreak().concat(delta) : delta;
    if(after) out = out.concat(pageBreak());
    return tidyPageBreaks(out);
}

/**
 * Keeps pasted page breaks on lines of their own, without adding empty lines:
 * - an element that held only a page break (Word's <span><br style="page-break-before: always"></span>)
 *   gets its line ended by Quill, which would leave an empty line after the break
 * - a break in the middle of a line ends that line first, so the text before it keeps its own line
 * @param {Delta} delta
 */
function tidyPageBreaks(delta)
{
    const ops = delta.ops;
    const isBreak = (/** @type {any} */ op) => op?.insert?.pagebreak === true;
    if(ops.length === 2 && isBreak(ops[0]) && ops[1].insert === '\n' && !ops[1].attributes) return new Delta([ops[0]]);
    if(!ops.some(isBreak)) return delta;
    const out = new Delta();
    ops.forEach((op, i) => {
        const prev = ops[i - 1]?.insert;
        if(isBreak(op) && typeof prev === 'string' && !prev.endsWith('\n')) out.insert('\n');
        out.push(op);
    });
    return out;
}

/**
 * Removes the page break at `index`, if there is one there. Returns whether it did.
 * @param {any} quill
 * @param {number} index
 */
export function removePageBreakAt(quill, index)
{
    if(index < 0) return false;
    const [blot] = quill.getLine(index);
    if(blot?.statics.blotName !== 'pagebreak') return false;
    quill.deleteText(index, 1, 'user');
    return true;
}
