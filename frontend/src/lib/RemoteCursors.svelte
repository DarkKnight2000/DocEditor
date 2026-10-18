<script>
    // Other people's cursors and selections, drawn over the page. Sits in the same positioned box as
    // the editor and doesn't take clicks. Positions are measured from the editor's layout, so they're
    // redrawn whenever the cursors change (the editor moves them with every edit) or the page resizes.
    import { onMount } from 'svelte';
    import { userColor } from '$lib/user_colors.js';

    /** @typedef {{ client: string, user: string, name: string, index: number, length: number, moved: number }} RemoteCursor */

    /** @type {{ quill: any, cursors: RemoteCursor[] }} */
    let { quill, cursors = [] } = $props();

    /** @type {HTMLDivElement} */
    let overlay;
    let layout_tick = $state(0);

    /**
     * @typedef {{ left: number, top: number, width: number, height: number }} Box
     * @type {(RemoteCursor & { color: string, caret: Box, boxes: Box[] })[]}
     */
    let shapes = $state([]);

    /**
     * Sets one end of a DOM range at a document position inside a Quill leaf
     * @param {Range} range
     * @param {'setStart' | 'setEnd'} which
     * @param {number} index
     */
    function place(range, which, index)
    {
        const [leaf, offset] = quill.getLeaf(index);
        const node = leaf?.domNode;
        if(!node) return false;
        if(node.nodeType === Node.TEXT_NODE)
        {
            range[which](node, Math.min(offset, node.length));
        }
        else
        {
            // a break or embed: before or after the element
            const parent = node.parentNode;
            range[which](parent, Array.prototype.indexOf.call(parent.childNodes, node) + (offset > 0 ? 1 : 0));
        }
        return true;
    }

    /**
     * Highlight boxes for a selection, one per visual line it covers
     * @param {number} index
     * @param {number} length
     * @param {DOMRect} base
     */
    function selection_boxes(index, length, base)
    {
        const range = document.createRange();
        if(!place(range, 'setStart', index) || !place(range, 'setEnd', index + length)) return [];
        return [...range.getClientRects()]
            .filter((r) => r.width > 0.5)
            .map((r) => ({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height }));
    }

    function measure()
    {
        if(!quill || !overlay || !cursors.length) return [];
        const base = overlay.getBoundingClientRect();
        const container = quill.container.getBoundingClientRect();
        const last = quill.getLength() - 1;     // the final newline can't hold a cursor after it
        return cursors.flatMap((c) => {
            const index = Math.max(0, Math.min(c.index, last));
            const length = Math.max(0, Math.min(c.length, last - index));
            // the caret goes at the end of the selection
            const bounds = quill.getBounds(index + length, 0);
            if(!bounds) return [];
            return [{
                ...c,
                color: userColor(c.user).cursor,
                caret: { left: container.left - base.left + bounds.left, top: container.top - base.top + bounds.top, width: 2, height: bounds.height },
                boxes: length > 0 ? selection_boxes(index, length, base) : [],
            }];
        });
    }

    $effect(() => {
        cursors;
        layout_tick;
        shapes = measure();
    });

    onMount(() => {
        // text reflows when the page width changes (window size, outline pane, fonts loading)
        const observer = new ResizeObserver(() => layout_tick++);
        observer.observe(quill.root);
        return () => observer.disconnect();
    });
</script>

<div bind:this={overlay} class="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
    {#each shapes as s (s.client)}
        {#each s.boxes as b}
            <div class="absolute rounded-[2px]" style="left:{b.left}px; top:{b.top}px; width:{b.width}px; height:{b.height}px; background:{s.color}; opacity:0.18"></div>
        {/each}
        <div class="absolute" style="left:{s.caret.left - 1}px; top:{s.caret.top}px; width:2px; height:{s.caret.height}px; background:{s.color}">
            <!-- a dot marks the caret; the name shows for a few seconds after each move -->
            <span class="absolute -top-1 -left-[2px] w-1.5 h-1.5 rounded-full" style="background:{s.color}"></span>
            {#key s.moved}
                <span class="remote-cursor-name absolute bottom-full left-0 mb-0.5 px-1.5 py-px rounded rounded-bl-none text-[11px] font-semibold leading-4 text-white whitespace-nowrap font-nunito"
                    style="background:{s.color}">{s.name || 'Someone'}</span>
            {/key}
        </div>
    {/each}
</div>

<style>
    .remote-cursor-name {
        animation: remote-cursor-name-fade 3.5s forwards;
    }

    @keyframes remote-cursor-name-fade {
        0%, 80% { opacity: 1; }
        100% { opacity: 0; }
    }
</style>
