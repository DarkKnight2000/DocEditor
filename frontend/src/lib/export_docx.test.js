// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { Packer } from 'docx';
import { deltaToLines, buildDocx, docxFileName } from './export_docx.js';

const title = (t) => ({ insert: t, attributes: { size: 'huge', bold: true } });
const subtitle = (t) => ({ insert: t, attributes: { size: 'large', bold: true, italic: true } });

/** The main XML part of the generated .docx */
async function documentXml(ops, name = 'Doc')
{
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocx(ops, name)));
    return zip.file('word/document.xml').async('string');
}

test('splits a document into lines with their runs, line formats and style', () => {
    const lines = deltaToLines([
        title('Trip'), { insert: '\n', attributes: { align: 'center' } },
        { insert: 'Pack ' }, { insert: 'light', attributes: { bold: true } }, { insert: '.\n\n' },
        subtitle('Day 1'), { insert: '\n' },
        { insert: 'tiny note', attributes: { size: 'small' } }, { insert: '\n' },
    ]);
    assert.deepEqual(lines.map(l => [l.style, l.runs.map(r => r.text).join(''), l.attributes]), [
        ['title', 'Trip', { align: 'center' }],
        ['text', 'Pack light.', {}],
        ['text', '', {}],
        ['subtitle', 'Day 1', {}],
        ['tiny', 'tiny note', {}],
    ]);
});

test('list items keep their list type and indent', () => {
    const lines = deltaToLines([
        { insert: 'one' }, { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'nested' }, { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
    ]);
    assert.deepEqual(lines.map(l => l.attributes), [{ list: 'ordered' }, { list: 'bullet', indent: 1 }]);
});

test('embeds are skipped', () => {
    const lines = deltaToLines([{ insert: 'a' }, { insert: { image: 'x.png' } }, { insert: 'b\n' }]);
    assert.equal(lines[0].runs.map(r => r.text).join(''), 'ab');
});

test('titles and subtitles become Word headings, with alignment', async () => {
    const xml = await documentXml([
        title('Trip'), { insert: '\n', attributes: { align: 'center' } },
        subtitle('Day 1'), { insert: '\n' },
        { insert: 'Body\n' },
    ]);
    assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
    assert.match(xml, /<w:pStyle w:val="Heading2"\/>/);
    assert.match(xml, /<w:jc w:val="center"\/>/);
    assert.match(xml, /Body/);
});

test('inline formats are kept', async () => {
    const xml = await documentXml([
        { insert: 'b', attributes: { bold: true } },
        { insert: 'i', attributes: { italic: true } },
        { insert: 'u', attributes: { underline: true } },
        { insert: 's', attributes: { strike: true } },
        { insert: '2', attributes: { script: 'super' } },
        { insert: 'tiny', attributes: { size: 'small' } },
        { insert: '\n' },
    ]);
    for(const tag of ['<w:b/>', '<w:i/>', '<w:u w:val="single"/>', '<w:strike/>', '<w:vertAlign w:val="superscript"/>', '<w:sz w:val="20"/>'])
    {
        assert.ok(xml.includes(tag), `missing ${tag}`);
    }
});

test('web links become hyperlinks; other link types are dropped', async () => {
    const ops = [
        { insert: 'site', attributes: { link: 'https://example.com' } },
        { insert: ' and ' },
        { insert: 'bad', attributes: { link: 'javascript:alert(1)' } },
        { insert: '\n' },
    ];
    const zip = await JSZip.loadAsync(await Packer.toBuffer(buildDocx(ops, 'Doc')));
    const xml = await zip.file('word/document.xml').async('string');
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    assert.match(xml, /<w:hyperlink /);
    assert.equal((xml.match(/<w:hyperlink /g) ?? []).length, 1);
    assert.match(rels, /Target="https:\/\/example\.com"/);
    assert.doesNotMatch(rels, /javascript:/);
});

test('numbered lists restart after other text; bullets use bullet numbering', async () => {
    const xml = await documentXml([
        { insert: 'a' }, { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'b' }, { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'break\n' },
        { insert: 'c' }, { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'dot' }, { insert: '\n', attributes: { list: 'bullet' } },
    ]);
    const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(m => m[1]);
    assert.equal(numIds.length, 4);
    assert.equal(numIds[0], numIds[1], 'a and b are one list');
    assert.notEqual(numIds[1], numIds[2], 'c starts a new list');
    assert.notEqual(numIds[3], numIds[2], 'the bullet uses its own numbering');
});

test('file names drop characters file systems reject', () => {
    assert.equal(docxFileName('Trip: Goa / Day 1?'), 'Trip Goa Day 1.docx');
    assert.equal(docxFileName('   '), 'Untitled.docx');
    assert.equal(docxFileName(undefined), 'Untitled.docx');
});
