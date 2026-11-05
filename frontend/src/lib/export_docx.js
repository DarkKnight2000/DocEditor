// Word (.docx) export of a document, built from its Quill contents with the "docx" package.
// Kept free of Quill/DOM so it can be unit tested; Editor.svelte loads it only when someone downloads.
//
// Mapping: the Title line becomes Word's Title, Heading and Subtitle lines Heading 1 and Heading 2 (so Word's
// navigation pane shows the same sections as the editor's outline), Tiny text a smaller size, and the
// toolbar formats their Word equivalents: bold, italic, underline, strikethrough, superscript/subscript, links, alignment,
// numbered and bulleted lists, text and highlight colours. Manual page breaks become Word page breaks,
// and tables Word tables.
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell,
    TableRow, TextRun, WidthType } from 'docx';
import { deltaToLines, linesToBlocks, safeLink, exportFileName } from './document_lines.js';

/** @typedef {import('./document_lines.js').Line} Line */
/** @typedef {import('./document_lines.js').Run} Run */

// the line splitting is shared with the PDF and EPUB exports; re-exported for the existing tests
export { deltaToLines };

// Word sizes are in half-points. Body text is 12pt; the others keep the editor's proportions
// (quill-editor.css: Title 2em, Subtitle 1.35em, Tiny 0.85em).
const SIZE = { huge: 54, xlarge: 38, large: 32, small: 20 };
// sizes that come from a heading's paragraph style, so its text runs don't repeat them
const STYLE_SIZE = { title: 'huge', heading: 'xlarge', subtitle: 'large', tiny: undefined, text: undefined };

const ALIGNMENT = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

/**
 * @param {Run} run
 * @param {string} lineStyle the run's size is left to the paragraph style when it matches the line's
 */
function textRun(run, lineStyle)
{
    const a = run.attributes;
    const size = a.size && a.size !== STYLE_SIZE[/** @type {keyof typeof STYLE_SIZE} */ (lineStyle)]
        ? SIZE[/** @type {keyof typeof SIZE} */ (a.size)] : undefined;
    const color = wordColor(a.color);
    const highlight = wordColor(a.background);
    return new TextRun({
        color,
        shading: highlight ? { type: ShadingType.CLEAR, color: 'auto', fill: highlight } : undefined,
        text: run.text,
        bold: a.bold || undefined,
        italics: a.italic || undefined,
        underline: a.underline ? {} : undefined,
        strike: a.strike || undefined,
        superScript: a.script === 'super' || undefined,
        subScript: a.script === 'sub' || undefined,
        size,
        style: a.link ? 'Hyperlink' : undefined,
    });
}

/**
 * A colour as Word wants it (six hex digits, no #), from the forms Quill stores: '#rrggbb', '#rgb' or
 * 'rgb(r, g, b)' (pasted content). Anything else, like a colour name, is left out.
 * @param {any} value
 * @returns {string | undefined}
 */
export function wordColor(value)
{
    if(typeof value !== 'string') return undefined;
    const v = value.trim().toLowerCase();
    let m = v.match(/^#([0-9a-f]{6})$/);
    if(m) return m[1].toUpperCase();
    m = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if(m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = v.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
    if(m) return m.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();
    return undefined;
}

/**
 * Builds the Word document.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops document contents
 * @param {string} title document name, stored in the file's properties
 */
export function buildDocx(ops, title)
{
    const lines = deltaToLines(ops);
    // a numbered list restarts at 1 after anything that isn't part of it
    let listInstance = 0;
    let inNumberedList = false;

    /** @param {Line} line */
    const paragraphOf = (line) => {
        if(line.pageBreak)
        {
            inNumberedList = false;
            return new Paragraph({ children: [new PageBreak()] });
        }
        /** @type {(TextRun | ExternalHyperlink)[]} */
        const children = line.runs.map((run) => {
            const link = safeLink(run.attributes.link);
            const text = textRun(run, line.style);
            return link ? new ExternalHyperlink({ link, children: [text] }) : text;
        });

        const a = line.attributes;
        const level = Math.min(Number(a.indent) || 0, 8);
        const numbered = a.list === 'ordered';
        if(numbered && !inNumberedList) listInstance += 1;
        inNumberedList = numbered;

        return new Paragraph({
            children,
            heading: line.style === 'title' ? HeadingLevel.TITLE
                : line.style === 'heading' ? HeadingLevel.HEADING_1
                : line.style === 'subtitle' ? HeadingLevel.HEADING_2 : undefined,
            alignment: ALIGNMENT[/** @type {keyof typeof ALIGNMENT} */ (a.align)],
            numbering: numbered ? { reference: 'numbered', level, instance: listInstance } : undefined,
            bullet: a.list === 'bullet' ? { level } : undefined,
        });
    };

    /**
     * A Word table from rows of cell lines (table.js: each cell is a line, a row is the run of cells that
     * share a row id). Rows with fewer cells are padded, and the columns share the page width equally.
     * @param {Line[][]} rows
     */
    const tableOf = (rows) => {
        const columns = Math.max(...rows.map((row) => row.length));
        return new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: Array(columns).fill(Math.floor(9000 / columns)),
            rows: rows.map((row) => new TableRow({
                children: Array.from({ length: columns }, (_, c) => new TableCell({
                    children: [row[c] ? paragraphOf(row[c]) : new Paragraph('')],
                })),
            })),
        });
    };

    /** @type {(Paragraph | Table)[]} */
    const blocks = linesToBlocks(lines).map((block) => {
        if(block.type === 'line') return paragraphOf(block.line);
        inNumberedList = false;
        return tableOf(block.rows);
    });

    return new Document({
        title: title || 'Untitled',
        creator: 'Raya',
        styles: {
            default: { document: { run: { size: 24 }, paragraph: { spacing: { after: 120 } } } },
            paragraphStyles: [
                {
                    id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
                    run: { size: SIZE.huge, bold: true, color: '111827' },
                    paragraph: { spacing: { after: 200 }, keepNext: true },
                },
                {
                    id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
                    run: { size: SIZE.xlarge, bold: true, color: '111827' },
                    paragraph: { spacing: { before: 360, after: 160 }, keepNext: true },
                },
                {
                    id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
                    run: { size: SIZE.large, bold: true, italics: true, color: '111827' },
                    paragraph: { spacing: { before: 240, after: 100 }, keepNext: true },
                },
            ],
        },
        numbering: {
            config: [{
                reference: 'numbered',
                levels: Array.from({ length: 9 }, (_, level) => ({
                    level,
                    format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
                    text: `%${level + 1}.`,
                    alignment: AlignmentType.START,
                    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
                })),
            }],
        },
        sections: [{ children: blocks }],
    });
}

/**
 * The document as a .docx file, ready to download.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops
 * @param {string} title
 */
export function docxBlob(ops, title)
{
    return Packer.toBlob(buildDocx(ops, title));
}

/**
 * A safe file name for the download: the document name without characters file systems reject.
 * @param {string} name
 */
export function docxFileName(name)
{
    return exportFileName(name, 'docx');
}
