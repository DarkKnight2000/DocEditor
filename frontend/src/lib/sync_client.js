// Client side of the real-time sync protocol, kept free of Quill/DOM so it can be unit tested.
//
// The document the user sees is always A ∘ X ∘ Y:
//   A: the latest server state this client knows (revision rev_id)
//   X: the change sent to the server and not acknowledged yet (at most one in flight)
//   Y: local changes not sent yet
// backend/app/doc_syncer.py is the server side; backend/tests/test_doc_syncer.py simulates
// clients with the same algorithm, so keep the two in step.
import Delta from 'quill-delta';

export function createClientState()
{
    return {
        A: new Delta(),
        X: new Delta(),
        Y: new Delta(),
        rev_id: 0,
        // recent revisions (rev -> the change it made to A), to bring other people's cursors up to date
        log: new Map(),
    };
}

// how many recent revisions to keep for cursors; an older cursor is dropped until its next move
const LOG_SIZE = 200;

/**
 * @param {ReturnType<typeof createClientState>} state
 * @param {number} rev
 * @param {Delta} change
 */
function logRevision(state, rev, change)
{
    state.log.set(rev, change);
    if(state.log.size > LOG_SIZE) state.log.delete(state.log.keys().next().value);
}

/**
 * Whether a change that takes the document from oldLength to newLength characters must be refused.
 * Only growth past the limit is refused, so a document that's already too long can still be shortened.
 * backend/app/doc_syncer.py applies the same rule.
 * @param {number} oldLength
 * @param {number} newLength
 * @param {number} maxChars
 */
export function exceedsCharLimit(oldLength, newLength, maxChars)
{
    return newLength > maxChars && newLength > oldLength;
}

/**
 * SERVER_INIT: the full document at revision rev
 * @param {ReturnType<typeof createClientState>} state
 * @param {any[]} content
 * @param {number} rev
 */
export function applyInit(state, content, rev)
{
    state.A = new Delta(content);
    state.X = new Delta();
    state.Y = new Delta();
    state.rev_id = rev;
    state.log = new Map();
}

/**
 * The user changed the document
 * @param {ReturnType<typeof createClientState>} state
 * @param {Delta} delta
 */
export function applyLocalChange(state, delta)
{
    state.Y = state.Y.compose(delta);
}

/**
 * Returns the message to send (CLIENT_REV content and base revision) or null if there's
 * nothing to send or a change is still waiting for its acknowledgement
 * @param {ReturnType<typeof createClientState>} state
 */
export function takeOutgoing(state)
{
    if(state.Y.length() === 0 || state.X.length() !== 0) return null;
    state.X = state.Y;
    state.Y = new Delta();
    return { content: state.X.ops, rev: state.rev_id };
}

/**
 * SERVER_ACK: the server accepted X as revision rev
 * @param {ReturnType<typeof createClientState>} state
 * @param {number} rev
 */
export function applyAck(state, rev)
{
    logRevision(state, rev, state.X);
    state.A = state.A.compose(state.X);
    state.X = new Delta();
    state.rev_id = rev;
}

/**
 * SERVER_REV: another client's change B, committed by the server as revision rev.
 * Returns the delta to apply to the editor so the screen stays equal to A ∘ X ∘ Y.
 * @param {ReturnType<typeof createClientState>} state
 * @param {Delta} B
 * @param {number} rev
 */
export function applyServerRev(state, B, rev)
{
    // B was committed before X reaches the server, so B has priority over X
    const Xn = B.transform(state.X, true);
    // B rewritten to apply after X
    const B_after_X = state.X.transform(B, false);
    // Local unsent edits win ties against B: Y stays first in Yn, and D must agree (priority true),
    // otherwise the screen drifts from what gets saved
    const Yn = B_after_X.transform(state.Y, false);
    const D = state.Y.transform(B_after_X, true);

    logRevision(state, rev, B);
    state.A = state.A.compose(B);
    state.X = Xn;
    state.Y = Yn;
    state.rev_id = rev;
    return D;
}

// Other people's cursors
//
// A cursor travels as a position in the server's document at a revision: { index, length, rev }.
// The sender maps its on-screen selection back to its latest server revision (A); each receiver
// brings it forward to its own screen through the revisions since rev and its own unsent edits.
// After that the editor moves remote cursors along with every change on screen.

/**
 * The local selection as a position in the server's document, ready to send.
 * Text typed but not yet saved maps to where it will be inserted.
 * @param {ReturnType<typeof createClientState>} state
 * @param {{ index: number, length: number }} range selection on screen
 */
export function cursorForServer(state, range)
{
    let start = range.index;
    let end = range.index + range.length;
    const pending = state.X.compose(state.Y);
    if(pending.length() !== 0)
    {
        // undoing the unsent edits takes screen positions back to A's
        const back = pending.invert(state.A);
        start = back.transformPosition(start);
        end = back.transformPosition(end);
    }
    return { index: start, length: Math.max(0, end - start), rev: state.rev_id };
}

/**
 * Where another person's cursor is on this screen, or null if it can't be placed
 * (it refers to a revision this client doesn't have, or one too old to still be logged).
 * @param {ReturnType<typeof createClientState>} state
 * @param {{ index: number, length: number, rev: number }} cursor
 */
export function cursorFromServer(state, cursor)
{
    if(cursor.rev > state.rev_id) return null;
    let start = cursor.index;
    let end = cursor.index + cursor.length;
    for(let rev = cursor.rev + 1; rev <= state.rev_id; rev++)
    {
        const change = state.log.get(rev);
        if(!change) return null;
        start = change.transformPosition(start);
        end = change.transformPosition(end);
    }
    // the screen also shows this client's unsent edits
    const pending = state.X.compose(state.Y);
    start = pending.transformPosition(start);
    end = pending.transformPosition(end);
    return { index: start, length: Math.max(0, end - start) };
}
