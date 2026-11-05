// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deltaToLines, linesToBlocks } from './document_lines.js';
import { blocksToHtml, escapeXml } from './export_html.js';

const html = (/** @type {any[]} */ ops) => blocksToHtml(linesToBlocks(deltaToLines(ops)));

test('text styles become headings, without repeating the formats they give', () => {
    assert.equal(html([
        { insert: 'Book', attributes: { size: 'huge', bold: true } }, { insert: '\n', attributes: { align: 'center' } },
        { insert: 'Part', attributes: { size: 'xlarge', bold: true } }, { insert: '\n', attributes: { align: 'center' } },
        { insert: 'Section', attributes: { size: 'large', bold: true, italic: true } }, { insert: '\n' },
        { insert: 'fine print', attributes: { size: 'small' } }, { insert: '\n' },
    ]), [
        '<h1 class="align-center">Book</h1>',
        '<h2 class="align-center">Part</h2>',
        '<h3>Section</h3>',
        '<p class="tiny">fine print</p>',
    ].join('\n'));
});

test('inline formats, colours and links; unsafe values are left out', () => {
    assert.equal(html([
        { insert: 'b', attributes: { bold: true, italic: true, underline: true, strike: true } },
        { insert: '2', attributes: { script: 'super' } },
        { insert: 'red', attributes: { color: '#dc2626', background: 'url(x)' } },
        { insert: 'site', attributes: { link: 'example.com' } },
        { insert: 'bad', attributes: { link: 'javascript:alert(1)' } },
        { insert: 'big', attributes: { size: 'huge' } },
        { insert: '\n' },
    ]), '<p><strong><em><u><s>b</s></u></em></strong><sup>2</sup><span style="color: #dc2626">red</span>'
        + '<a href="https://example.com">site</a>bad<span class="size-huge">big</span></p>');
});

test('text is escaped, and characters XML forbids are dropped', () => {
    assert.equal(escapeXml('a < b & "c" \'d\' \u0001'), 'a &lt; b &amp; &quot;c&quot; &#39;d&#39; ');
    assert.equal(html([{ insert: '<script>x</script>\n' }]), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
});

test('empty lines keep their height, and page breaks become print page breaks', () => {
    assert.equal(html([{ insert: 'a\n\n' }, { insert: { pagebreak: true } }, { insert: 'b\n' }]),
        '<p>a</p>\n<p><br/></p>\n<div class="page-break"></div>\n<p>b</p>');
});

test('lists, nested by indent, and switching kind', () => {
    assert.equal(html([
        { insert: 'one' }, { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'one.a' }, { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
        { insert: 'two' }, { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'dot' }, { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'after\n' },
    ]).replace(/\n/g, ''), '<ol><li>one<ol><li>one.a</li></ol></li><li>two</li></ol><ul><li>dot</li></ul><p>after</p>');
});

test('tables, with short rows padded', () => {
    assert.equal(html([
        { insert: 'a' }, { insert: '\n', attributes: { table: 'r1' } }, { insert: 'b' }, { insert: '\n', attributes: { table: 'r1' } },
        { insert: 'c' }, { insert: '\n', attributes: { table: 'r2' } },
        { insert: '\n' },
    ]), '<table><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td></td></tr></tbody></table>\n<p><br/></p>');
});
