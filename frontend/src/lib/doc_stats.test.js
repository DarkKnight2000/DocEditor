// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentStats } from './doc_stats.js';

test('an empty document', () => {
    assert.deepEqual(documentStats([{ insert: '\n' }]), { words: 0, characters: 0, charactersNoSpaces: 0 });
    assert.deepEqual(documentStats([]), { words: 0, characters: 0, charactersNoSpaces: 0 });
});

test('words and characters, with formatting split across ops', () => {
    const ops = [{ insert: 'Hello, ' }, { insert: 'world', attributes: { bold: true } }, { insert: '!\nIt\'s 3.5 km.\n' }];
    // "Hello, world!" is 13 characters, "It's 3.5 km." is 12, with 3 spaces between them; line breaks don't count
    assert.deepEqual(documentStats(ops), { words: 5, characters: 25, charactersNoSpaces: 22 });
});

test('page breaks separate words and are not characters', () => {
    assert.deepEqual(documentStats([{ insert: 'one' }, { insert: { pagebreak: true } }, { insert: 'two\n' }]),
        { words: 2, characters: 6, charactersNoSpaces: 6 });
});

test('an emoji or accented letter is one character', () => {
    assert.equal(documentStats([{ insert: 'é 👍🏽\n' }]).characters, 3);
});

test('Japanese is counted by words, not by spaces', () => {
    assert.equal(documentStats([{ insert: '日本語の文章です。\n' }]).words, 4);
});
