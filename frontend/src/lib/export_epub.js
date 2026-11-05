// EPUB 3 export of a document, an e-book file built with JSZip. Kept free of Quill/DOM so it can be unit
// tested; the apps load it only when someone exports.
//
// Each Title or Heading line starts a chapter; text before the first one is a chapter of its own, named
// after the document. The e-reader's table of contents lists the chapters, with the Subtitles of each
// under it, like the editor's outline. Manual page breaks inside a chapter start a new page where the
// reader supports it.
import JSZip from 'jszip';
import { deltaToLines, linesToBlocks, exportFileName } from './document_lines.js';
import { blocksToHtml, escapeXml, exportCss, lineText } from './export_html.js';

/** @typedef {import('./document_lines.js').Line} Line */
/** @typedef {import('./document_lines.js').Block} Block */
/** @typedef {{ title: string, blocks: Block[], subtitles: Array<{ id: string, title: string }> }} Chapter */

/**
 * The document split into chapters at its Title and Heading lines.
 * @param {Block[]} blocks
 * @param {string} docTitle the name of the chapter before the first Title or Heading
 * @returns {Chapter[]}
 */
export function splitChapters(blocks, docTitle)
{
    /** @type {Chapter[]} */
    const chapters = [];
    /** @type {Chapter | null} */
    let current = null;
    for(const block of blocks)
    {
        const line = block.type === 'line' ? block.line : null;
        if(line && (line.style === 'title' || line.style === 'heading'))
        {
            current = { title: lineText(line), blocks: [block], subtitles: [] };
            chapters.push(current);
            continue;
        }
        if(!current)
        {
            current = { title: docTitle, blocks: [], subtitles: [] };
            chapters.push(current);
        }
        current.blocks.push(block);
    }
    for(const [c, chapter] of chapters.entries())
    {
        // a chapter starts on a new page anyway, so page breaks at its edges add nothing
        const isBreak = (/** @type {Block | undefined} */ b) => b?.type === 'line' && !!b.line.pageBreak;
        while(isBreak(chapter.blocks[chapter.blocks.length - 1])) chapter.blocks.pop();
        while(isBreak(chapter.blocks[0])) chapter.blocks.shift();
        chapter.title ||= `Chapter ${c + 1}`;
    }
    // a document of nothing but page breaks has no chapter left with anything in it; keep one, empty
    const kept = chapters.filter((chapter) => chapter.blocks.length);
    return kept.length ? kept : [{ title: docTitle, blocks: [], subtitles: [] }];
}

/**
 * @param {string} title
 * @param {string} lang
 * @param {string} body
 */
function xhtml(title, lang, body)
{
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

/** A random id for the book, as EPUB wants one */
function bookId()
{
    const uuid = globalThis.crypto?.randomUUID?.();
    return `urn:uuid:${uuid ?? Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
}

/**
 * Builds the EPUB file.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops document contents
 * @param {string} title document name, the book's title
 * @param {{ lang?: string, modified?: Date, id?: string }} [options] the book's language (a BCP 47 tag), and
 *   for tests a fixed time and id
 * @returns {JSZip}
 */
export function buildEpub(ops, title, { lang = 'en', modified = new Date(), id = bookId() } = {})
{
    const bookTitle = (title ?? '').replace(/\s+/g, ' ').trim() || 'Untitled';
    const chapters = splitChapters(linesToBlocks(deltaToLines(ops)), bookTitle);
    const zip = new JSZip();
    // the mimetype file comes first and uncompressed, so readers can recognise the file
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);
    zip.file('EPUB/style.css', `body { font-family: sans-serif; line-height: 1.5; }\n${exportCss()}`);

    chapters.forEach((chapter, c) => {
        let s = 0;
        const body = blocksToHtml(chapter.blocks, (line) => {
            if(line.style !== 'subtitle') return null;
            const sid = `s${++s}`;
            chapter.subtitles.push({ id: sid, title: lineText(line) || `Section ${s}` });
            return sid;
        });
        zip.file(`EPUB/chapter-${c + 1}.xhtml`, xhtml(chapter.title, lang, body));
    });

    const toc = chapters.map((chapter, c) => {
        const file = `chapter-${c + 1}.xhtml`;
        const subs = chapter.subtitles.length
            ? `<ol>${chapter.subtitles.map((sub) => `<li><a href="${file}#${sub.id}">${escapeXml(sub.title)}</a></li>`).join('')}</ol>` : '';
        return `<li><a href="${file}">${escapeXml(chapter.title)}</a>${subs}</li>`;
    }).join('\n');
    zip.file('EPUB/nav.xhtml', xhtml(bookTitle, lang, `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n${toc}\n</ol></nav>`));

    const items = chapters.map((_, c) => `<item id="chapter-${c + 1}" href="chapter-${c + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
    const spine = chapters.map((_, c) => `<itemref idref="chapter-${c + 1}"/>`).join('\n');
    zip.file('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeXml(id)}</dc:identifier>
<dc:title>${escapeXml(bookTitle)}</dc:title>
<dc:language>${escapeXml(lang)}</dc:language>
<meta property="dcterms:modified">${modified.toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="style" href="style.css" media-type="text/css"/>
${items}
</manifest>
<spine>
${spine}
</spine>
</package>
`);
    return zip;
}

/**
 * The document as an .epub file, ready to download.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops
 * @param {string} title
 * @param {string} [lang] the book's language, e.g. navigator.language
 */
export function epubBlob(ops, title, lang)
{
    return buildEpub(ops, title, { lang: lang || 'en' }).generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

/** @param {string} name */
export function epubFileName(name)
{
    return exportFileName(name, 'epub');
}
