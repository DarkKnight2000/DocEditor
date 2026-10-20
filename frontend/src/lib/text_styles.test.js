// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleOfFormat, formatsForStyle, applyStyleToOps } from './text_styles.js';

test('styleOfFormat reads the style from the size', () => {
    assert.equal(styleOfFormat({ size: 'huge', bold: true, align: 'center' }), 'title');
    assert.equal(styleOfFormat({ size: 'large' }), 'subtitle');
    assert.equal(styleOfFormat({ size: 'small' }), 'tiny');
    assert.equal(styleOfFormat({ bold: true }), 'text');
    assert.equal(styleOfFormat({}), 'text');
    assert.equal(styleOfFormat({ size: ['huge', 'small'] }), '', 'mixed sizes have no single style');
    assert.equal(styleOfFormat({ align: 'center' }), '', 'centred normal text is not the Text style');
    assert.equal(styleOfFormat({ align: 'right', bold: true }), '');
});

test('Title is big, bold and centred', () => {
    assert.deepEqual(formatsForStyle('title', 'text'),
        { inline: { size: 'huge', bold: true, italic: false }, align: 'center' });
});

test('Subtitle is bold and italic, and not centred when coming from Title', () => {
    assert.deepEqual(formatsForStyle('subtitle', 'text'),
        { inline: { size: 'large', bold: true, italic: true }, align: undefined });
    assert.equal(formatsForStyle('subtitle', 'title').align, false);
});

test('back to Text from a heading removes the emphasis the heading added', () => {
    assert.deepEqual(formatsForStyle('text', 'title'),
        { inline: { size: false, bold: false, italic: false }, align: false });
    assert.deepEqual(formatsForStyle('text', 'subtitle'),
        { inline: { size: false, bold: false, italic: false }, align: false });
});

test('Text always left-aligns, even text the user centred', () => {
    assert.deepEqual(formatsForStyle('text', 'text'), { inline: { size: false }, align: false });
    assert.equal(formatsForStyle('text', 'tiny').align, false);
});

test('Text to Tiny keeps the bold and alignment the user set themselves', () => {
    assert.deepEqual(formatsForStyle('tiny', 'text'), { inline: { size: 'small' }, align: undefined });
});

test('a mixed selection is normalised', () => {
    assert.deepEqual(formatsForStyle('text', ''),
        { inline: { size: false, bold: false, italic: false }, align: false });
});

test('Heading sits between Title and Subtitle: bold and centred, one size down from Title', () => {
    assert.equal(styleOfFormat({ size: 'xlarge', bold: true, align: 'center' }), 'heading');
    assert.deepEqual(formatsForStyle('heading', 'text'),
        { inline: { size: 'xlarge', bold: true, italic: false }, align: 'center' });
    // from Subtitle: the italic goes, the centring comes
    assert.deepEqual(formatsForStyle('heading', 'subtitle'),
        { inline: { size: 'xlarge', bold: true, italic: false }, align: 'center' });
});

test('leaving Heading removes its emphasis and centring', () => {
    assert.deepEqual(formatsForStyle('text', 'heading'),
        { inline: { size: false, bold: false, italic: false }, align: false });
    assert.equal(formatsForStyle('subtitle', 'heading').align, false);
    assert.equal(formatsForStyle('tiny', 'heading').align, false);
    // Title and Heading are both centred, so switching between them keeps the centring
    assert.equal(formatsForStyle('title', 'heading').align, 'center');
    assert.equal(formatsForStyle('heading', 'title').align, 'center');
});

test('pasted content can be given a style: inline formats on the text, alignment on the line ending', () => {
    const pasted = [{ insert: 'Plan ' }, { insert: 'B', attributes: { italic: true, color: '#dc2626' } }, { insert: '\n' }];
    assert.deepEqual(applyStyleToOps(pasted, 'heading'), [
        { insert: 'Plan ', attributes: { size: 'xlarge', bold: true } },
        { insert: 'B', attributes: { color: '#dc2626', size: 'xlarge', bold: true } },
        { insert: '\n', attributes: { align: 'center' } },
    ]);
    assert.deepEqual(applyStyleToOps([{ insert: 'Notes' }], 'subtitle'),
        [{ insert: 'Notes', attributes: { size: 'large', bold: true, italic: true } }]);
});
