// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from './pagination.js';

// pages of 1000px with 100px margins (writing area 100..900) and 20px gaps
const PAGE = { pageHeight: 1000, padding: 100, gap: 20 };

/** blocks of the given heights stacked from the top margin, 10px apart */
function stack(...heights)
{
    let top = 100;
    return heights.map((height) => {
        const block = { top, height };
        top += height + 10;
        return block;
    });
}

test('a short document is one page with no pushes', () => {
    assert.deepEqual(paginate(stack(50, 50, 50), PAGE), { pushes: [], breaks: [], height: 1000 });
});

test('a block that would cross the bottom margin moves to the top of the next page', () => {
    // blocks at 100, 410, 720: the third ends at 920, past the margin at 900
    const layout = paginate(stack(300, 300, 200), PAGE);
    // the next page starts at 1020 (1000 + 20 gap); its writing area at 1120
    assert.deepEqual(layout.pushes, [{ index: 2, px: 1120 - 720 }]);
    assert.deepEqual(layout.breaks, [{ y: 1000, cut: false }]);
    assert.equal(layout.height, 2020);
});

test('pushes add up: later blocks follow the moved ones onto later pages', () => {
    // each block nearly fills a page, so every one after the first gets its own page
    const layout = paginate(stack(700, 700, 700), PAGE);
    assert.deepEqual(layout.pushes.map((p) => p.index), [1, 2]);
    assert.deepEqual(layout.breaks.map((b) => b.y), [1000, 2020]);
    assert.equal(layout.height, 3040);
    // the third block lands at the top of the third page's writing area
    const third = stack(700, 700, 700)[2].top + layout.pushes.reduce((sum, p) => sum + p.px, 0);
    assert.equal(third, 2040 + 100);
});

test('a block taller than a page runs across the edge, with no gap', () => {
    const layout = paginate(stack(1200), PAGE);
    assert.deepEqual(layout.pushes, []);
    assert.deepEqual(layout.breaks, [{ y: 1000, cut: true }]);
    // two pages back to back (no gap), the block ends at 1300, inside the second page's writing area
    assert.equal(layout.height, 2000);
});

test('blocks after a cut continue on the page the tall block ended on', () => {
    const layout = paginate(stack(1200, 650), PAGE);
    // the 650px block would start at 1310 and end at 1960, past the second page's margin at 1900
    assert.deepEqual(layout.pushes, [{ index: 1, px: 2120 - 1310 }]);
    assert.deepEqual(layout.breaks, [{ y: 1000, cut: true }, { y: 2000, cut: false }]);
});

test('nothing to lay out is still one empty page', () => {
    assert.deepEqual(paginate([], PAGE), { pushes: [], breaks: [], height: 1000 });
});

test('a heading moves to the next page with the block after it', () => {
    // a heading (100..140) then a paragraph that doesn't fit: the heading must not stay behind alone
    const blocks = [{ top: 100, height: 700 }, { top: 810, height: 40, keepWithNext: true }, { top: 860, height: 200 }];
    const layout = paginate(blocks, PAGE);
    assert.deepEqual(layout.pushes, [{ index: 1, px: 1120 - 810 }]);
    assert.deepEqual(layout.breaks, [{ y: 1000, cut: false }]);
});

test('a title and subtitle in a row both move with the paragraph', () => {
    const blocks = [
        { top: 100, height: 600 },
        { top: 710, height: 60, keepWithNext: true },     // title
        { top: 780, height: 40, keepWithNext: true },     // subtitle
        { top: 830, height: 200 },
    ];
    assert.deepEqual(paginate(blocks, PAGE).pushes, [{ index: 1, px: 1120 - 710 }]);
});

test('a heading at the top of its page stays, so the page is not left empty', () => {
    // the heading starts the page; only the paragraph moves (it doesn't fit beside it)
    const blocks = [{ top: 100, height: 40, keepWithNext: true }, { top: 150, height: 760 }];
    assert.deepEqual(paginate(blocks, PAGE).pushes, [{ index: 1, px: 1120 - 150 }]);
});

