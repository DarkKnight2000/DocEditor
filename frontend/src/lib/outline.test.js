// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOutline, activeOutlineItem } from './outline.js';

const title = (t) => ({ insert: t, attributes: { size: 'huge', bold: true } });
const subtitle = (t) => ({ insert: t, attributes: { size: 'large', bold: true, italic: true } });

test('lists titles and subtitles with their positions', () => {
    const ops = [
        title('Goa trip'), { insert: '\n', attributes: { align: 'center' } },     // 0..8
        { insert: 'Some intro text\n' },                                            // 9..24
        subtitle('Flights'), { insert: '\n' },                                     // 25..32
        { insert: 'Friday evening.\n' },
        subtitle('Hotels'), { insert: '\n' },
    ];
    assert.deepEqual(buildOutline(ops), [
        { index: 0, text: 'Goa trip', level: 1 },
        { index: 25, text: 'Flights', level: 2 },
        { index: 49, text: 'Hotels', level: 2 },
    ]);
});

test('a line takes the style of its first character', () => {
    // "Day 1" is a subtitle even though a later word on the line is normal size
    const ops = [subtitle('Day 1'), { insert: ': beach\nnormal line with ' }, title('huge'), { insert: ' word\n' }];
    assert.deepEqual(buildOutline(ops), [{ index: 0, text: 'Day 1: beach', level: 2 }]);
});

test('ignores empty headings, plain text and tiny text', () => {
    const ops = [
        title('   '), { insert: '\n' },
        { insert: 'plain\n' },
        { insert: 'small print', attributes: { size: 'small' } }, { insert: '\n' },
    ];
    assert.deepEqual(buildOutline(ops), []);
    assert.deepEqual(buildOutline([]), []);
});

test('counts embeds as one character', () => {
    const ops = [{ insert: { image: 'x.png' } }, { insert: '\n' }, title('After image'), { insert: '\n' }];
    assert.deepEqual(buildOutline(ops), [{ index: 2, text: 'After image', level: 1 }]);
});

test('activeOutlineItem finds the heading the cursor is under', () => {
    const outline = [{ index: 0, text: 'A', level: 1 }, { index: 20, text: 'B', level: 2 }, { index: 40, text: 'C', level: 2 }];
    assert.equal(activeOutlineItem(outline, 0), 0);
    assert.equal(activeOutlineItem(outline, 25), 1);
    assert.equal(activeOutlineItem(outline, 99), 2);
    assert.equal(activeOutlineItem([{ index: 10, text: 'A', level: 1 }], 3), -1, 'above the first heading');
    assert.equal(activeOutlineItem([], 5), -1);
});
