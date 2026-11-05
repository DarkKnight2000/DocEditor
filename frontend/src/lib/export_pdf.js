// PDF export through the system print dialog ("Save as PDF"), shared by the web and desktop apps.
// The document is rendered into a print-only part of this same page rather than a new window, so it uses
// the fonts the editor already has (Nunito, and the system's fonts for Japanese and other scripts) and
// looks like the editor. The page's title becomes the PDF's suggested file name.
import { deltaToLines, linesToBlocks, exportFileName } from './document_lines.js';
import { blocksToHtml, exportCss } from './export_html.js';

const ROOT_ID = 'raya-print';

const PRINT_CSS = `
#${ROOT_ID} { display: none; }
@media print {
    @page { margin: 2cm; }
    /* only the document prints; the app's own layout fixes its height, which would cut it to one page */
    html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
    body > *:not(#${ROOT_ID}) { display: none !important; }
    #${ROOT_ID} {
        display: block; color: #111827; font-size: 12pt; line-height: 1.5;
        font-family: "Nunito Variable", "Nunito", ui-sans-serif, system-ui, sans-serif;
        print-color-adjust: exact; -webkit-print-color-adjust: exact;
    }
    #${ROOT_ID} h1, #${ROOT_ID} h2, #${ROOT_ID} h3 { break-after: avoid; }
    #${ROOT_ID} tr { break-inside: avoid; }
}
${exportCss(`#${ROOT_ID} `)}
`;

/**
 * Opens the print dialog with the document, ready to save as a PDF.
 * @param {Array<{insert?: any, attributes?: Record<string, any>}>} ops document contents
 * @param {string} title document name, the PDF's suggested file name
 */
export function printDocument(ops, title)
{
    document.getElementById(ROOT_ID)?.remove();
    const style = document.createElement('style');
    style.textContent = PRINT_CSS;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = blocksToHtml(linesToBlocks(deltaToLines(ops)));
    document.head.appendChild(style);
    document.body.appendChild(root);

    const pageTitle = document.title;
    document.title = exportFileName(title, 'pdf').replace(/\.pdf$/, '');
    let cleaned = false;
    const cleanup = () => {
        if(cleaned) return;
        cleaned = true;
        document.title = pageTitle;
        root.remove();
        style.remove();
        window.removeEventListener('afterprint', cleanup);
    };
    // afterprint comes once the dialog is closed; if it never does, the print copy stays hidden on screen
    // and the next print replaces it
    window.addEventListener('afterprint', cleanup);
    window.print();
}
