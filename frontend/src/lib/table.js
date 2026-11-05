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

// formats of a whole line, which pasted text going into a cell mustn't bring (a pasted table's text carries
// its own row id, which would move the cell to another row)
const LINE_FORMATS = ['table', 'align', 'list', 'indent'];

/**
 * Content pasted into a table cell, as text for that cell. A cell holds one line, and Quill would turn
 * each pasted line into a cell of its own (adding columns, or splitting the table), so everything pasted
 * becomes one line (cellAsOneLine). The cell keeps its own line end, so the pasted text has none.
 * @param {Delta} delta the pasted content, as Quill converted it
 */
export function asCellText(delta)
{
    const line = cellAsOneLine(delta);
    return new Delta(line.slice(0, line.length() - 1).ops.map((op) => {
        if(!op.attributes) return op;
        const attributes = Object.fromEntries(Object.entries(op.attributes).filter(([name]) => !LINE_FORMATS.includes(name)));
        return Object.keys(attributes).length ? { ...op, attributes } : { insert: op.insert };
    }));
}

/**
 * The change that keeps the document from ending inside a table, or null when it doesn't. A table at the
 * very end leaves no line below it to write on, and it happens after deleting from a table to the end of
 * the document (the line left over keeps the table's format, as one empty cell) or pasting a table last.
 * - one empty cell left on its own in its row: it becomes an ordinary empty line
 * - a real table: an empty line goes after it
 * @param {any} quill
 */
export function tableEndFix(quill)
{
    const length = quill.getLength();
    // the document's final newline, and the character before it (the end of the line before, if the last
    // line is empty)
    const last = quill.getContents(length - 1, 1).ops[0];
    const row = last?.attributes?.table;
    if(!row) return null;
    const before = length >= 2 ? quill.getContents(length - 2, 1).ops[0] : null;
    const lastLineEmpty = !before || typeof before.insert !== 'string' || before.insert.endsWith('\n');
    const onlyCellInRow = !before || before.attributes?.table !== row;
    if(lastLineEmpty && onlyCellInRow) return new Delta().retain(length - 1).retain(1, { table: null });
    return new Delta().retain(length - 1).insert('\n', { table: row }).retain(1, { table: null });
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
