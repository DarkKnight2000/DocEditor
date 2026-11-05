// Personal view settings for the editor: text size, line spacing and character spacing. They change only how
// documents look on this screen, not the documents (collaborators and the Word export don't see them),
// and are remembered in this browser (or the desktop app's webview).
//
// They apply as CSS variables on the page, which quill-editor.css uses for the editor's text. Text size
// scales all of it: the text styles (Title, Heading, Subtitle, Tiny) are sized relative to it.

const STORAGE_KEY = 'raya.view_settings';

export const TEXT_SIZE_OPTIONS = [75, 90, 100, 110, 125, 150, 175, 200].map((value) => ({ value, label: `${value}%` }));
export const LINE_SPACING_OPTIONS = [
    { value: 1.2, label: 'Single' },
    { value: 1.5, label: '1.5' },
    { value: 1.625, label: 'Default' },
    { value: 2, label: 'Double' },
    { value: 2.5, label: '2.5' },
];
export const CHAR_SPACING_OPTIONS = [
    { value: -0.02, label: 'Tight' },
    { value: 0, label: 'Normal' },
    { value: 0.05, label: 'Wide' },
    { value: 0.1, label: 'Wider' },
];

/** @typedef {{ textSize: number, lineSpacing: number, charSpacing: number }} ViewSettings */

/** @type {ViewSettings} */
export const DEFAULT_VIEW_SETTINGS = { textSize: 100, lineSpacing: 1.625, charSpacing: 0 };

/**
 * Settings with every value one of the options, falling back to the default for anything missing or
 * unknown (an old or hand-edited saved value)
 * @param {any} saved
 * @returns {ViewSettings}
 */
export function normalizeViewSettings(saved)
{
    /** @param {Array<{value: number}>} options @param {any} value @param {number} fallback */
    const pick = (options, value, fallback) => (options.some((o) => o.value === value) ? value : fallback);
    return {
        textSize: pick(TEXT_SIZE_OPTIONS, saved?.textSize, DEFAULT_VIEW_SETTINGS.textSize),
        lineSpacing: pick(LINE_SPACING_OPTIONS, saved?.lineSpacing, DEFAULT_VIEW_SETTINGS.lineSpacing),
        charSpacing: pick(CHAR_SPACING_OPTIONS, saved?.charSpacing, DEFAULT_VIEW_SETTINGS.charSpacing),
    };
}

/** The saved settings, or the defaults (storage can be unavailable, e.g. in a private window) */
export function loadViewSettings()
{
    try { return normalizeViewSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
    catch { return { ...DEFAULT_VIEW_SETTINGS }; }
}

/** @param {ViewSettings} settings */
export function saveViewSettings(settings)
{
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

/** Fired on window when the settings change the editor's layout, for things placed over the text */
export const VIEW_SETTINGS_EVENT = 'raya:view-settings';

/**
 * Shows the editor with these settings
 * @param {ViewSettings} settings
 */
export function applyViewSettings(settings)
{
    const style = document.documentElement.style;
    style.setProperty('--raya-text-scale', String(settings.textSize / 100));
    style.setProperty('--raya-line-height', String(settings.lineSpacing));
    style.setProperty('--raya-letter-spacing', `${settings.charSpacing}em`);
    window.dispatchEvent(new Event(VIEW_SETTINGS_EVENT));
}
