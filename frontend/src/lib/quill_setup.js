import Quill, { Delta } from 'quill';
import { insertPageBreak, removePageBreakAt } from './page_break.js';
import { inTable } from './table.js';
import { styleOfFormat, applyStyleToOps } from './text_styles.js';
import { dropDisallowedValues, withScheme } from './format_rules.js';

// Raya's editor, shared by the web app (Editor.svelte) and the desktop app (desktop/frontend): its formats,
// toolbar handlers, keyboard shortcuts, paste rules, link handling and heading spacing. Syncing, saving
// and the toolbar's markup stay with each app.

// Text sizes the style menu uses (text_styles.js): Quill's own small, large and huge, plus Raya's
// xlarge for Heading, between Title (huge) and Subtitle (large)
const SizeClass = /** @type {any} */ (Quill.import('attributors/class/size'));
SizeClass.whitelist = ['small', 'large', 'xlarge', 'huge'];
Quill.register(SizeClass, true);

// the formats "clean" removes from text, and the ones table cells may carry
const INLINE_FORMATS = ['bold', 'italic', 'underline', 'strike', 'script', 'link', 'size', 'color', 'background'];

/**
 * Creates Raya's Quill editor in `container`, using the toolbar markup already in the page at `toolbar`.
 * @param {string | HTMLElement} container
 * @param {{ toolbar: string | HTMLElement, placeholder?: string, openLink?: (href: string) => void }} options
 *   openLink opens a Ctrl+clicked web or email link (a new browser tab by default)
 * @returns {{ quill: Quill, destroy: () => void }} destroy removes what the editor added outside itself
 */
export function createQuill(container, { toolbar, placeholder = 'Start typing...', openLink = (href) => window.open(href, '_blank', 'noopener,noreferrer') })
{
    const quill = new Quill(container, {
        theme: 'snow',
        // Only Raya's own formats exist in this editor (the server allows the same list, doc_syncer.py).
        // Anything else in pasted content (images, fonts, font sizes, quotes, code, headings...) is
        // dropped and only its text kept; pasted headings are mapped to Raya's styles below.
        formats: [
            'bold', 'italic', 'underline', 'strike', 'script', 'link', 'size', 'color', 'background',
            'align', 'list', 'indent', 'table', 'pagebreak',
        ],
        modules: {
            toolbar: {
                container: toolbar,
                handlers: {
                    /** @this {any} */
                    pagebreak() { insertPageBreak(this.quill); },
                    // a list or a cleared line inside a table would turn its cell into a plain line and break
                    // the table, so inside tables these only touch the text, not the line
                    /** @this {any} */
                    list(/** @type {any} */ value) {
                        if(!inTable(this.quill)) this.quill.format('list', value, 'user');
                    },
                    /** @this {any} */
                    clean() {
                        const range = this.quill.getSelection();
                        if(!range) return;
                        if(!range.length)
                        {
                            // like Quill's own: with no selection, only the formats for what's typed next
                            for(const name of INLINE_FORMATS) this.quill.format(name, false, 'user');
                        }
                        else if(inTable(this.quill, range))
                        {
                            this.quill.formatText(range.index, range.length, Object.fromEntries(INLINE_FORMATS.map((n) => [n, false])), 'user');
                        }
                        else
                        {
                            this.quill.removeFormat(range.index, range.length, 'user');
                        }
                    },
                },
            },
            table: true,
            keyboard: {
                bindings: {
                    // Ctrl+Enter (Cmd+Enter on a Mac) inserts a page break, as in Word and Google Docs
                    page_break: {
                        key: 'Enter',
                        shortKey: true,
                        /** @this {any} */
                        handler() {
                            insertPageBreak(this.quill);
                            return false;
                        },
                    },
                    // Backspace at the start of the line after a page break, or Delete at the end of the
                    // line before one, removes just the break. Quill's own handlers would join the lines
                    // and give the text line the break's (empty) formats, losing e.g. a Title's centring.
                    page_break_backspace: {
                        key: 'Backspace',
                        collapsed: true,
                        offset: 0,
                        /** @this {any} */
                        handler(/** @type {any} */ range) {
                            return !removePageBreakAt(this.quill, range.index - 1);
                        },
                    },
                    page_break_delete: {
                        key: 'Delete',
                        collapsed: true,
                        suffix: /^$/,
                        /** @this {any} */
                        handler(/** @type {any} */ range) {
                            return !removePageBreakAt(this.quill, range.index + 1);
                        },
                    },
                    // Enter at the end of a Title or Subtitle line starts a plain Text line instead of
                    // carrying the heading on, like headings in other editors. (Enter in the middle of a
                    // heading keeps both halves as heading.) Runs before Quill's own Enter handler.
                    heading_enter: {
                        key: 'Enter',
                        collapsed: true,
                        suffix: /^$/,
                        /** @this {any} */
                        handler(/** @type {any} */ range, /** @type {any} */ context) {
                            const style = styleOfFormat(context.format);
                            if (style !== 'title' && style !== 'heading' && style !== 'subtitle') return true;   // Quill's default
                            const editor = this.quill;
                            // the heading line keeps its line formats (e.g. Title's centring) ...
                            const keep = context.format.align ? { align: context.format.align } : {};
                            // ... and the new line gets none of the heading's formatting
                            const clear = { align: null, size: null, bold: null, italic: null };
                            editor.updateContents(new Delta().retain(range.index).insert('\n', keep).retain(1, clear), 'user');
                            editor.setSelection(range.index + 1, 0, 'silent');
                            return false;
                        },
                    },
                },
            },
        },
        placeholder,
    });

    // pasted headings become Raya's styles instead of plain text: <h1> a Heading, <h2>/<h3> a Subtitle
    for(const [tag, style] of [['H1', 'heading'], ['H2', 'subtitle'], ['H3', 'subtitle']])
    {
        quill.clipboard.addMatcher(tag, (/** @type {Node} */ _node, /** @type {any} */ delta) => new Delta(applyStyleToOps(delta.ops, style)));
    }
    // ...and links and colours the server wouldn't keep (a javascript: link, a colour named "red") are dropped
    quill.clipboard.addMatcher(Node.ELEMENT_NODE, (/** @type {Node} */ _node, /** @type {any} */ delta) => new Delta(dropDisallowedValues(delta.ops)));

    // a link typed in the link box gets the scheme people leave out ("example.com" -> "https://example.com")
    const tooltip = /** @type {any} */ (quill.theme).tooltip;
    const save_tooltip = tooltip.save.bind(tooltip);
    tooltip.save = () => {
        if(tooltip.root.getAttribute('data-mode') === 'link') tooltip.textbox.value = withScheme(tooltip.textbox.value);
        save_tooltip();
    };

    // Ctrl+click (Cmd+click on a Mac) opens a link, as in Word and Google Docs. A plain click still
    // just places the cursor and shows Quill's link bubble. Only web and email links open.
    quill.root.addEventListener('click', (/** @type {MouseEvent} */ event) => {
        if(!(event.ctrlKey || event.metaKey)) return;
        const link = /** @type {Element} */ (event.target).closest?.('a[href]');
        if(!link || !quill.root.contains(link)) return;
        const href = withScheme(link.getAttribute('href') ?? '');    // links saved before schemes were added
        if(!/^(https?:|mailto:)/i.test(href)) return;
        event.preventDefault();
        openLink(href);
    });
    // while Ctrl/Cmd is held, links show the hand pointer (quill-editor.css), hinting they can be opened
    const set_links_openable = (/** @type {boolean} */ on) => quill.container.classList.toggle('links-openable', on);
    const on_modifier = (/** @type {KeyboardEvent} */ event) => set_links_openable(event.ctrlKey || event.metaKey);
    const on_blur = () => set_links_openable(false);
    window.addEventListener('keydown', on_modifier);
    window.addEventListener('keyup', on_modifier);
    window.addEventListener('blur', on_blur);

    /**
     * 'title', 'heading' or 'subtitle' when the line's first text is huge, xlarge or large (as the outline
     * and the style menu decide), otherwise null. Big words later in a normal line don't make it a heading.
     * @param {Element} el a line of the editor
     */
    function heading_level(el)
    {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while((node = walker.nextNode()) && !node.textContent) {}
        const sized = node?.parentElement?.closest('.ql-size-huge, .ql-size-xlarge, .ql-size-large');
        if(!sized || !el.contains(sized)) return null;
        return sized.classList.contains('ql-size-huge') ? 'title'
            : sized.classList.contains('ql-size-xlarge') ? 'heading' : 'subtitle';
    }

    // Space around Title, Heading and Subtitle lines, more above (a new section) than below (its own text);
    // a heading at the top of a page sits flush with the page margin. CSS alone can't tell
    // whether a line *starts* with big text, so the lines are picked here, into a stylesheet of their own.
    // The rules are scoped to this editor's container, which must have an id.
    const container_id = quill.container.id;
    /** @type {Record<string, [string, string]>} */
    const HEADING_SPACE = { title: ['1.75rem', '0.75rem'], heading: ['1.5rem', '0.6rem'], subtitle: ['1.25rem', '0.5rem'] };
    const heading_style = document.createElement('style');
    document.head.appendChild(heading_style);
    function space_headings()
    {
        const rules = [...quill.root.children].flatMap((el, i) => {
            const level = el.tagName === 'P' ? heading_level(el) : null;
            if(!level) return [];
            const [above, below] = HEADING_SPACE[level];
            // at the top of the first page or of a page after a page break it sits flush with the margin
            const page_top = i === 0 || el.previousElementSibling?.classList.contains('page-break');
            return [`#${container_id} .ql-editor > :nth-child(${i + 1}) { margin-top: ${page_top ? '0' : above}; margin-bottom: ${below}; }`];
        }).join('\n');
        if(heading_style.textContent !== rules) heading_style.textContent = rules;
    }

    // Quill updates the page before it reports a change, so spacing the headings right away means the
    // screen never shows the old spacing on the new lines (e.g. after Enter shifts every line's position)
    quill.on('text-change', space_headings);

    return {
        quill,
        destroy() {
            heading_style.remove();
            window.removeEventListener('keydown', on_modifier);
            window.removeEventListener('keyup', on_modifier);
            window.removeEventListener('blur', on_blur);
        },
    };
}
