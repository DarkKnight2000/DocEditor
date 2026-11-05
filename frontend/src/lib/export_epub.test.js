// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildEpub, epubFileName } from './export_epub.js';

const OPS = [
    { insert: 'Before any heading\n' },
    { insert: 'Chapter One', attributes: { size: 'huge', bold: true } }, { insert: '\n', attributes: { align: 'center' } },
    { insert: 'A part', attributes: { size: 'large', bold: true, italic: true } }, { insert: '\n' },
    { insert: 'Text & more\n' },
    { insert: { pagebreak: true } },
    { insert: '第二章', attributes: { size: 'xlarge', bold: true } }, { insert: '\n', attributes: { align: 'center' } },
    { insert: '日本語の文章です。\n' },
];

async function open(ops = OPS, title = 'My Book')
{
    const data = await buildEpub(ops, title, { lang: 'ja', modified: new Date('2026-01-02T03:04:05.678Z'), id: 'urn:uuid:test' })
        .generateAsync({ type: 'uint8array' });
    return { data, zip: await JSZip.loadAsync(data) };
}

test('the file starts with an uncompressed mimetype, as e-readers require', async () => {
    const { data } = await open();
    // a zip entry starts with its header: method at byte 8 (0 = stored), name at byte 30
    assert.equal(new TextDecoder().decode(data.slice(30, 38)), 'mimetype');
    assert.equal(data[8], 0);
    assert.equal(new TextDecoder().decode(data.slice(38, 58)), 'application/epub+zip');
});

test('each Title or Heading starts a chapter; text before the first is named after the book', async () => {
    const { zip } = await open();
    const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort();
    assert.deepEqual(files, ['EPUB/chapter-1.xhtml', 'EPUB/chapter-2.xhtml', 'EPUB/chapter-3.xhtml', 'EPUB/nav.xhtml',
        'EPUB/package.opf', 'EPUB/style.css', 'META-INF/container.xml', 'mimetype']);
    const one = await zip.file('EPUB/chapter-1.xhtml')?.async('string');
    assert.match(one ?? '', /<title>My Book<\/title>[\s\S]*<p>Before any heading<\/p>/);
    const two = await zip.file('EPUB/chapter-2.xhtml')?.async('string');
    assert.match(two ?? '', /<h1 class="align-center">Chapter One<\/h1>\n<h3 id="s1">A part<\/h3>\n<p>Text &amp; more<\/p>\n<\/body>/,
        'the page break before the next chapter is dropped');
    const three = await zip.file('EPUB/chapter-3.xhtml')?.async('string');
    assert.match(three ?? '', /lang="ja" xml:lang="ja"[\s\S]*<h2 class="align-center">第二章<\/h2>\n<p>日本語の文章です。<\/p>/);
});

test('the table of contents lists chapters with their subtitles', async () => {
    const { zip } = await open();
    const nav = await zip.file('EPUB/nav.xhtml')?.async('string') ?? '';
    assert.match(nav, /<nav epub:type="toc" id="toc">/);
    assert.match(nav, /<li><a href="chapter-1.xhtml">My Book<\/a><\/li>/);
    assert.match(nav, /<li><a href="chapter-2.xhtml">Chapter One<\/a><ol><li><a href="chapter-2.xhtml#s1">A part<\/a><\/li><\/ol><\/li>/);
    assert.match(nav, /<li><a href="chapter-3.xhtml">第二章<\/a><\/li>/);
});

test('the package lists every chapter in reading order', async () => {
    const { zip } = await open();
    const opf = await zip.file('EPUB/package.opf')?.async('string') ?? '';
    assert.match(opf, /<dc:title>My Book<\/dc:title>/);
    assert.match(opf, /<dc:language>ja<\/dc:language>/);
    assert.match(opf, /<meta property="dcterms:modified">2026-01-02T03:04:05Z<\/meta>/);
    assert.match(opf, /<itemref idref="chapter-1"\/>\n<itemref idref="chapter-2"\/>\n<itemref idref="chapter-3"\/>/);
    assert.match(opf, /properties="nav"/);
});

test('an empty document still makes a valid book, and the file name is safe', async () => {
    const { zip } = await open([{ insert: '\n' }], '');
    assert.ok(zip.file('EPUB/chapter-1.xhtml'));
    assert.match(await zip.file('EPUB/package.opf')?.async('string') ?? '', /<dc:title>Untitled<\/dc:title>/);
    assert.equal(epubFileName('a/b: c?'), 'a b c.epub');
});
