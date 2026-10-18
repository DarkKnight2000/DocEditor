// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Delta from 'quill-delta';
import { createClientState, applyInit, applyLocalChange, takeOutgoing, applyAck, applyServerRev, exceedsCharLimit, cursorForServer, cursorFromServer } from './sync_client.js';

/** Document the client should be showing */
const docOf = (/** @type {any} */ s) => s.A.compose(s.X).compose(s.Y);
const sameDoc = (/** @type {Delta} */ a, /** @type {Delta} */ b) => assert.deepEqual(new Delta().compose(a).ops, new Delta().compose(b).ops);

/** Small seeded PRNG so failures are reproducible */
function rng(seed)
{
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Random edit on a document of length len: insert, delete or format at a random position */
function randomEdit(/** @type {() => number} */ rand, /** @type {number} */ len, /** @type {string} */ tag)
{
    const pos = Math.floor(rand() * (len + 1));
    const edit = new Delta().retain(pos);
    const r = rand();
    if(r < 0.55 || pos === len) return edit.insert(tag + 'xyz'[Math.floor(rand() * 3)]);
    if(r < 0.8) return edit.delete(1 + Math.floor(rand() * Math.min(3, len - pos)));
    const attrs = [{ bold: true }, { italic: true }, { bold: null }][Math.floor(rand() * 3)];
    return edit.retain(1 + Math.floor(rand() * (len - pos)), attrs);
}

/**
 * In-memory model of the server in backend/app/doc_syncer.py: transforms an incoming change
 * against every revision the client hasn't seen (those have priority) and broadcasts it.
 */
class ModelServer
{
    constructor() { this.head = new Delta(); this.rev = 0; this.history = []; }
    /** @returns {{ rev: number, change: Delta }} */
    submit(/** @type {Delta} */ change, /** @type {number} */ baseRev)
    {
        for(const record of this.history)
        {
            if(record.rev > baseRev) change = record.change.transform(change, true);
        }
        this.rev += 1;
        this.history.push({ rev: this.rev, change });
        this.head = this.head.compose(change);
        return { rev: this.rev, change };
    }
}

test('takeOutgoing sends local changes once, and waits for the acknowledgement', () => {
    const s = createClientState();
    applyInit(s, [{ insert: 'hi' }], 3);
    assert.equal(takeOutgoing(s), null, 'nothing to send yet');

    applyLocalChange(s, new Delta().retain(2).insert('!'));
    const out = takeOutgoing(s);
    assert.deepEqual(out, { content: [{ retain: 2 }, { insert: '!' }], rev: 3 });

    applyLocalChange(s, new Delta().insert('>'));
    assert.equal(takeOutgoing(s), null, 'previous change not acknowledged yet');

    applyAck(s, 4);
    assert.equal(s.rev_id, 4);
    sameDoc(s.A, new Delta().insert('hi!'));
    assert.deepEqual(takeOutgoing(s)?.rev, 4, 'queued change goes out after the ack');
});

test('exceedsCharLimit refuses only growth past the limit', () => {
    assert.equal(exceedsCharLimit(1999, 2000, 2000), false, 'reaching the limit is fine');
    assert.equal(exceedsCharLimit(2000, 2001, 2000), true, 'going over is refused');
    assert.equal(exceedsCharLimit(1500, 2500, 2000), true, 'a big paste is refused');
    assert.equal(exceedsCharLimit(2500, 2400, 2000), false, 'an over-limit document can be shortened');
    assert.equal(exceedsCharLimit(2500, 2500, 2000), false, 'formatting an over-limit document is fine');
    assert.equal(exceedsCharLimit(10, 99999, Infinity), false, 'no limit before SERVER_INIT');
});

test('applyInit replaces the document and revision', () => {
    const s = createClientState();
    applyInit(s, [{ insert: 'hello', attributes: { bold: true } }], 7);
    assert.equal(s.rev_id, 7);
    sameDoc(docOf(s), new Delta().insert('hello', { bold: true }));
});

test('applyServerRev keeps the screen equal to A ∘ X ∘ Y', () => {
    const s = createClientState();
    applyInit(s, [{ insert: 'abc' }], 1);
    let screen = new Delta().insert('abc');

    const local1 = new Delta().retain(3).insert('1');      // sent, unacknowledged
    applyLocalChange(s, local1); screen = screen.compose(local1);
    takeOutgoing(s);
    const local2 = new Delta().insert('2');                // not sent yet
    applyLocalChange(s, local2); screen = screen.compose(local2);

    const remote = new Delta().retain(1).insert('R');      // another user, made on "abc"
    screen = screen.compose(applyServerRev(s, remote, 2));

    sameDoc(screen, docOf(s));
    assert.equal(new Delta().compose(screen).ops.map(op => op.insert).join(''), '2aRbc1');
});

test('regression: local unsent text and a remote insert at the same spot', () => {
    // Before the fix the screen put the remote text first while the saved state put the local text first
    const s = createClientState();
    applyInit(s, [], 0);
    let screen = new Delta();
    const local = new Delta().insert('mine');
    applyLocalChange(s, local); screen = screen.compose(local);
    screen = screen.compose(applyServerRev(s, new Delta().insert('theirs'), 1));
    sameDoc(screen, docOf(s));
});

test('random concurrent editing converges for every client, on screen and in state', () => {
    for(let seed = 1; seed <= 40; seed++)
    {
        const rand = rng(seed);
        const server = new ModelServer();
        const clients = Array.from({ length: 2 + (seed % 4) }, (_, i) => {
            const s = createClientState();
            applyInit(s, [], 0);
            return { id: `c${i}`, s, screen: new Delta(), inbox: /** @type {any[]} */ ([]) };
        });

        // Messages are delivered in order per client but interleaved randomly between clients
        for(let step = 0; step < 300; step++)
        {
            const c = clients[Math.floor(rand() * clients.length)];
            const action = rand();
            if(action < 0.45)
            {
                const edit = randomEdit(rand, c.screen.length(), c.id);
                applyLocalChange(c.s, edit);
                c.screen = c.screen.compose(edit);
            }
            else if(action < 0.7)
            {
                const out = takeOutgoing(c.s);
                if(out)
                {
                    const { rev, change } = server.submit(new Delta(out.content), out.rev);
                    for(const other of clients)
                    {
                        other.inbox.push(other === c ? { type: 'ack', rev } : { type: 'rev', rev, change });
                    }
                }
            }
            else if(c.inbox.length)
            {
                const msg = c.inbox.shift();
                if(msg.type === 'ack') applyAck(c.s, msg.rev);
                else c.screen = c.screen.compose(applyServerRev(c.s, msg.change, msg.rev));
            }
        }

        // Drain: deliver everything and send what's left until all clients are idle
        for(let busy = true; busy;)
        {
            busy = false;
            for(const c of clients)
            {
                while(c.inbox.length)
                {
                    busy = true;
                    const msg = c.inbox.shift();
                    if(msg.type === 'ack') applyAck(c.s, msg.rev);
                    else c.screen = c.screen.compose(applyServerRev(c.s, msg.change, msg.rev));
                }
                const out = takeOutgoing(c.s);
                if(out)
                {
                    busy = true;
                    const { rev, change } = server.submit(new Delta(out.content), out.rev);
                    for(const other of clients)
                    {
                        other.inbox.push(other === c ? { type: 'ack', rev } : { type: 'rev', rev, change });
                    }
                }
            }
        }

        for(const c of clients)
        {
            sameDoc(c.screen, server.head);
            sameDoc(docOf(c.s), server.head);
        }
    }
});

// --- other people's cursors ------------------------------------------------------

/** Client showing `text` (plus Quill's final newline) at revision rev, with nothing unsent */
function clientAt(text, rev)
{
    const s = createClientState();
    applyInit(s, [{ insert: text + '\n' }], rev);
    return s;
}

test('with nothing unsent, a cursor is sent and placed as is', () => {
    const sender = clientAt('hello world', 4);
    const cursor = cursorForServer(sender, { index: 6, length: 5 });
    assert.deepEqual(cursor, { index: 6, length: 5, rev: 4 });
    assert.deepEqual(cursorFromServer(clientAt('hello world', 4), cursor), { index: 6, length: 5 });
});

test("the sender's unsent text maps to where it will be inserted", () => {
    const sender = clientAt('hello', 1);
    applyLocalChange(sender, new Delta().retain(5).insert(' there'));   // typed, not sent yet
    takeOutgoing(sender);                                                 // in flight
    applyLocalChange(sender, new Delta().retain(11).insert('!'));         // typed after sending
    // cursor after "hello there!" on the sender's screen = after "hello" in the saved document
    assert.deepEqual(cursorForServer(sender, { index: 12, length: 0 }), { index: 5, length: 0, rev: 1 });
});

test('a selection over unsent text shrinks to its insertion point, the rest is kept', () => {
    const sender = clientAt('abcdef', 0);
    applyLocalChange(sender, new Delta().retain(3).insert('XYZ'));        // abcXYZdef
    // selecting "cXYZd" (2..7) covers "cd" in the saved document
    assert.deepEqual(cursorForServer(sender, { index: 2, length: 5 }), { index: 2, length: 2, rev: 0 });
});

test('a receiver further ahead moves the cursor through the revisions since', () => {
    const receiver = clientAt('hello world', 3);
    applyServerRev(receiver, new Delta().insert('>> '), 4);               // someone typed at the start
    applyLocalChange(receiver, new Delta().retain(5).insert('[me]'));     // own edit, sent and saved
    takeOutgoing(receiver);
    applyAck(receiver, 5);
    // a cursor on "world" (6..11) as of revision 3
    assert.deepEqual(cursorFromServer(receiver, { index: 6, length: 5, rev: 3 }), { index: 13, length: 5 });
});

test("the receiver's own unsent edits move the cursor too", () => {
    const receiver = clientAt('hello world', 2);
    applyLocalChange(receiver, new Delta().insert('Hey, '));               // not sent yet
    assert.deepEqual(cursorFromServer(receiver, { index: 6, length: 0, rev: 2 }), { index: 11, length: 0 });
});

test('cursors from unknown or forgotten revisions are not placed', () => {
    const receiver = clientAt('text', 5);
    assert.equal(cursorFromServer(receiver, { index: 0, length: 0, rev: 6 }), null, 'from the future');
    assert.equal(cursorFromServer(receiver, { index: 0, length: 0, rev: 2 }), null, 'revisions 3-5 not logged');
});

test('a cursor sent with unsent text lands after that text once it arrives', () => {
    // sender typed "big " before "cat" and its cursor sits after it; the receiver hasn't got the text yet
    const sender = clientAt('the cat', 0);
    applyLocalChange(sender, new Delta().retain(4).insert('big '));
    const cursor = cursorForServer(sender, { index: 8, length: 0 });
    const receiver = clientAt('the cat', 0);
    let { index } = cursorFromServer(receiver, cursor);
    assert.equal(index, 4, 'at the insertion point while the text is on its way');
    // the text arrives; the editor moves remote cursors along with each screen change
    const shown = applyServerRev(receiver, new Delta().retain(4).insert('big '), 1);
    index = shown.transformPosition(index);
    assert.equal(index, 8, "after 'big ', like on the sender's screen");
});
