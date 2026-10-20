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
