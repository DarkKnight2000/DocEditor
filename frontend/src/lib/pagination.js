// Page layout for the editor: where pages break, and how far to push blocks so none is cut by a page
// edge. Works on measured block positions only (no DOM), so it can be unit tested; Editor.svelte
// measures the blocks and applies the result.

/**
 * @typedef {{ top: number, height: number, keepWithNext?: boolean }} Block
 *   a paragraph or list item, measured from the top of the sheet without any pushes applied.
 *   keepWithNext: a heading, which moves to the next page with the block after it rather than
 *   being left alone at the bottom of a page
 * @typedef {{ y: number, cut: boolean }} PageBreak
 *   y: where the page ends. cut: a block too tall for one page runs across this edge, so there's no
 *   gap here, just a line; otherwise a gap of `gap` px follows
 * @typedef {{ pushes: { index: number, px: number }[], breaks: PageBreak[], height: number }} Layout
 *   pushes: extra space above these blocks, moving them to the top of the next page
 *   height: total height of all pages, gaps included
 */

/**
 * Lays blocks out on pages of pageHeight px with `padding` px of margin at the top and bottom of each
 * page and `gap` px between pages. A block that would run past the bottom margin moves to the next page,
 * unless it's taller than a page's writing area; then it runs across the edge. Headings right before
 * a moved block move with it.
 * @param {Block[]} blocks in document order
 * @param {{ pageHeight: number, padding: number, gap: number }} page
 * @returns {Layout}
 */
export function paginate(blocks, { pageHeight, padding, gap })
{
    const usable = pageHeight - 2 * padding;
    /** @type {Layout['pushes']} */
    const pushes = [];
    /** @type {PageBreak[]} */
    const breaks = [];
    let pageTop = 0;        // top of the current page
    let shift = 0;          // how far pushes so far have moved everything below them
    /** @type {number[]} */
    const tops = [];        // where each block ended up

    /** @param {boolean} cut */
    const nextPage = (cut) => {
        breaks.push({ y: pageTop + pageHeight, cut });
        pageTop += pageHeight + (cut ? 0 : gap);
    };

    blocks.forEach((block, index) => {
        let top = block.top + shift;
        // a block that ends past the bottom margin moves to the next page, if it fits on one
        if(top + block.height > pageTop + pageHeight - padding && block.height <= usable && top > pageTop + padding)
        {
            // take the headings just before it along, unless that would leave their page empty
            let first = index;
            while(first > 0 && blocks[first - 1].keepWithNext && tops[first - 1] > pageTop + padding) first--;
            nextPage(false);
            const px = pageTop + padding - (first < index ? tops[first] : top);
            pushes.push({ index: first, px });
            shift += px;
            top += px;
            for(let j = first; j < index; j++) tops[j] += px;
        }
        // whatever still runs past page edges (a block taller than a page) crosses them with a cut
        while(top + block.height > pageTop + pageHeight - padding)
        {
            nextPage(true);
        }
        tops.push(top);
    });

    return { pushes, breaks, height: pageTop + pageHeight };
}
