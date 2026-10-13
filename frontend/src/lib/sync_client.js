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
    };
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

    state.A = state.A.compose(B);
    state.X = Xn;
    state.Y = Yn;
    state.rev_id = rev;
    return D;
}
