// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkAllowed, withScheme, colorAllowed, dropDisallowedValues } from './format_rules.js';

test('links: web, email and phone links, and ones without a scheme', () => {
    for(const ok of ['https://example.com', 'HTTP://x', 'mailto:a@b.c', 'tel:+123', 'example.com', '/docs', '#top'])
        assert.ok(linkAllowed(ok), ok);
    for(const bad of ['javascript:alert(1)', 'JavaScript:x', 'data:text/html,x', ' javascript:x', 'java\tscript:x',
                      'about:blank', 'x'.repeat(2049), null, 5])
        assert.ok(!linkAllowed(bad), String(bad));
});

test('withScheme adds the scheme people leave out', () => {
    assert.equal(withScheme('example.com'), 'https://example.com');
    assert.equal(withScheme('  www.example.com/a?b=1 '), 'https://www.example.com/a?b=1');
    assert.equal(withScheme('localhost:3000/x'), 'https://localhost:3000/x');
    assert.equal(withScheme('me@example.com'), 'mailto:me@example.com');
    for(const same of ['https://example.com', 'HTTP://x', 'mailto:a@b.c', 'tel:+123', 'javascript:x', '#top', '/docs', ''])
        assert.equal(withScheme(same), same);
});

test('colours: hex and rgb only', () => {
    for(const ok of ['#fff', '#DC2626', 'rgb(1, 2, 3)']) assert.ok(colorAllowed(ok), ok);
    for(const bad of ['red', '#ffff', 'rgba(1,2,3,0.5)', 'url(x)', 'var(--c)', null]) assert.ok(!colorAllowed(bad), String(bad));
});

test('dropDisallowedValues keeps everything else', () => {
    assert.deepEqual(dropDisallowedValues([
        { insert: 'a', attributes: { link: 'javascript:x', bold: true } },
        { insert: 'b', attributes: { color: 'red', background: '#fef08a' } },
        { insert: 'c', attributes: { link: 'x.org' } },
        { insert: 'd', attributes: { color: 'red' } },
        { insert: '\n' },
        { retain: 1, attributes: { link: null } },
    ]), [
        { insert: 'a', attributes: { bold: true } },
        { insert: 'b', attributes: { background: '#fef08a' } },
        { insert: 'c', attributes: { link: 'https://x.org' } },
        { insert: 'd' },
        { insert: '\n' },
        { retain: 1, attributes: { link: null } },
    ]);
});
