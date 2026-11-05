// Word and character counts of a document, for the Stats dialog. Counted as Word and Google Docs do:
// line breaks and page breaks aren't characters, and an emoji or an accented letter is one character
// however many code points it takes. Words come from the browser's own word splitter, so text without
// spaces between words (Japanese, Chinese) is counted by words too.

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * @param {Array<{insert?: any}>} ops the document, as Quill delta ops
 * @returns {{ words: number, characters: number, charactersNoSpaces: number }}
 */
export function documentStats(ops)
{
    // the text, one line per line; embeds such as page breaks end a line and add nothing else
    const text = ops.map((op) => (typeof op.insert === 'string' ? op.insert : '\n')).join('');
    let characters = 0;
    let charactersNoSpaces = 0;
    for(const { segment } of graphemes.segment(text))
    {
        if(segment === '\n' || segment === '\r\n') continue;
        characters++;
        if(!/^\s+$/.test(segment)) charactersNoSpaces++;
    }
    let wordCount = 0;
    for(const segment of words.segment(text))
    {
        if(segment.isWordLike) wordCount++;
    }
    return { words: wordCount, characters, charactersNoSpaces };
}
