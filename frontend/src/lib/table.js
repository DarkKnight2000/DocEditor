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
