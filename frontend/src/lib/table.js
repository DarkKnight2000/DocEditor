// Basic tables, using Quill's own table module. In the document a table is just lines: each cell is a line
// whose newline carries { table: <row id> }, so consecutive cells with the same row id form a row. That
// keeps tables plain Quill deltas, which the sync, cursors and character count already handle.
// Cells hold one line of text each (Enter doesn't add lines inside a cell); Tab moves between cells.
import { Delta } from 'quill';

/** A new row id, in the same form as Quill's own */
function rowId()
{
    return `row-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Whether the selection (or the given range) is inside a table
 * @param {any} quill
 * @param {{ index: number, length: number } | null} [range]
 */
export function inTable(quill, range = quill.getSelection())
{
    return !!range && !!quill.getFormat(range).table;
}

/**
 * Inserts an empty rows x cols table after the line with the cursor, so that line isn't split, and
 * leaves an empty line after the table to carry on writing. On an empty line, the table takes its place.
 * Does nothing inside a table: tables can't be nested.
 * @param {any} quill
 * @param {number} [rows]
 * @param {number} [cols]
 */
export function insertTable(quill, rows = 3, cols = 3)
{
    const range = quill.getSelection(true);
    if(inTable(quill, range)) return;
    const [line, offset] = quill.getLine(range.index);
    const lineStart = range.index - offset;
    const empty = line.length() <= 1;
    const at = empty ? lineStart : lineStart + line.length();

    let delta = new Delta().retain(at);
    for(let r = 0; r < rows; r++) delta = delta.insert('\n'.repeat(cols), { table: rowId() });
    if(!empty) delta = delta.insert('\n');
    quill.updateContents(delta, 'user');
    quill.setSelection(at, 0, 'silent');
}

/**
 * A pasted table cell (<td> or <th>) as the one line Raya's cells hold. Quill marks every line of a pasted
 * row as a cell, so a cell with several lines (paragraphs, line breaks, empty lines) would become several
 * cells, adding columns. Its lines are joined with a space instead, and empty ones dropped (blank or only
 * spaces: Word fills empty paragraphs with a non-breaking space). Page breaks are dropped too, since a
 * cell can't hold one.
 * @param {Delta} delta what Quill made of the cell
 */
export function cellAsOneLine(delta)
{
    // the cell's lines, each a list of [text, attributes] pieces
    /** @type {Array<Array<[string, any]>>} */
    const lines = [[]];
    for(const op of delta.ops)
    {
        if(typeof op.insert !== 'string') continue;
        op.insert.split('\n').forEach((text, i) => {
            if(i > 0) lines.push([]);
            if(text) lines[lines.length - 1].push([text, op.attributes]);
        });
    }
    const out = new Delta();
    for(const line of lines)
    {
        if(line.every(([text]) => !text.trim())) continue;
        if(out.length() > 0) out.insert(' ');
        line.forEach(([text, attributes], i) => {
            if(i === 0) text = text.trimStart();
            if(i === line.length - 1) text = text.trimEnd();
            if(text) out.insert(text, attributes);
        });
    }
    return out.insert('\n');
}

/**
 * A pasted table row with a row id of its own. Quill numbers the rows of a pasted table 1, 2, 3..., and
 * neighbouring cells with the same id form one row, so a pasted table next to another pasted table (or
 * pasted twice) would merge its rows with that table's.
 * @param {Delta} delta what Quill made of the <tr>
 */
export function withNewRowId(delta)
{
    const id = rowId();
    return new Delta(delta.ops.map((op) => (op.attributes?.table == null ? op : { ...op, attributes: { ...op.attributes, table: id } })));
}

// the actions of the toolbar's Table menu, as names of Quill's table module methods
export const TABLE_ACTIONS = [
    { id: 'insertRowAbove', label: 'Add row above' },
    { id: 'insertRowBelow', label: 'Add row below' },
    { id: 'insertColumnLeft', label: 'Add column left' },
    { id: 'insertColumnRight', label: 'Add column right' },
    { id: 'deleteRow', label: 'Delete row' },
    { id: 'deleteColumn', label: 'Delete column' },
    { id: 'deleteTable', label: 'Delete table' },
];

/**
 * Runs a Table menu action on the table at `range`. The menu takes the focus from the editor, so the
 * selection is put back first: Quill's table module works from the current selection.
 * @param {any} quill
 * @param {string} action one of TABLE_ACTIONS' ids
 * @param {{ index: number, length: number }} range
 */
export function runTableAction(quill, action, range)
{
    if(!TABLE_ACTIONS.some((a) => a.id === action)) return;
    quill.setSelection(range, 'silent');
    if(!inTable(quill, range)) return;
    quill.getModule('table')[action]();
}
