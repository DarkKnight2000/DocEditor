// Word (.docx) export of a document, built from its Quill contents with the "docx" package.
// Kept free of Quill/DOM so it can be unit tested; Editor.svelte loads it only when someone downloads.
//
// Mapping: the Title line becomes Word's Title, Heading and Subtitle lines Heading 1 and Heading 2 (so Word's
// navigation pane shows the same sections as the editor's outline), Tiny text a smaller size, and the
// toolbar formats their Word equivalents: bold, italic, underline, strikethrough, superscript/subscript, links, alignment,
// numbered and bulleted lists. Manual page breaks become Word page breaks, and tables Word tables.
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, PageBreak, Paragraph, Table, TableCell,
    TableRow, TextRun, WidthType } from 'docx';
import { styleOfFormat } from './text_styles.js';

/**
 * @typedef {{ text: string, attributes: Record<string, any> }} Run
 * @typedef {{ runs: Run[], attributes: Record<string, any>, style: string, pageBreak?: boolean }} Line
 *   attributes: the line's formats (align, list, indent), from the newline that ends it
 *   style: 'title' | 'subtitle' | 'text' | 'tiny', from the size of the line's first character
 *   pageBreak: a manual page break (page_break.js) instead of text
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
    return new TextRun({
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
 * Only http(s) and mailto links are kept as links; anything else becomes plain text.
 * @param {any} link
 */
function safeLink(link)
{
    return typeof link === 'string' && /^(https?:|mailto:)/i.test(link) ? link : null;
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
    const blocks = [];
    for(let i = 0; i < lines.length;)
    {
        if(!lines[i].attributes.table)
        {
            blocks.push(paragraphOf(lines[i++]));
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
        inNumberedList = false;
        blocks.push(tableOf(rows));
    }

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
    const clean = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    return `${clean || 'Untitled'}.docx`;
}
