"""DocSyncer: the server side of real-time editing, run against an in-memory database."""
import asyncio
import json
import random

import pytest

import app.delta as D
import app.doc_syncer as doc_syncer
from app.doc_syncer import DocSyncer, MessageType, text_length
from tests.fakes import FakeDB, FakeSocket, SimClient, normalize, random_edit, text_of

INIT, ACK, REV, DROP, LIMIT, PRESENCE = (MessageType.SERVER_INIT.value, MessageType.SERVER_ACK.value,
                                         MessageType.SERVER_REV.value, MessageType.SERVER_DROP_ACCESS.value,
                                         MessageType.SERVER_DOC_LIMIT.value, MessageType.SERVER_PRESENCE.value)
CURSOR = MessageType.SERVER_CURSOR.value


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def db(monkeypatch):
    return FakeDB(monkeypatch)


async def join(syncer, client_id, user_id='owner'):
    sock = FakeSocket()
    assert await syncer.connect(client_id, user_id, sock, None)
    return sock


def test_connect_sends_document_and_registers_client(db):
    db.add_doc(text='hello', rev=4)

    async def scenario():
        syncer = DocSyncer('doc')
        sock = await join(syncer, 'c1')
        assert sock.sent == [{'type': INIT, 'rev': 4, 'content': [{'insert': 'hello'}],
                              'max_chars': doc_syncer.MAX_DOC_CHARS},
                             {'type': PRESENCE, 'users': []}]
        assert db.docs['doc']['clients'] == {'c1': 4}
    run(scenario())


def test_connect_rejects_a_client_id_already_connected(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'c1')
        assert not await syncer.connect('c1', 'owner', FakeSocket(), None)
    run(scenario())


def test_revision_numbers_follow_the_head(db):
    db.add_doc(text='xy', rev=0)

    async def scenario():
        syncer = DocSyncer('doc')
        a, b = await join(syncer, 'a'), await join(syncer, 'b')
        await syncer.add_revision(None, 'a', [{'insert': '1'}], 0)
        await syncer.add_revision(None, 'a', [{'insert': '2'}], 1)
        # regression: the first edit used to get rev 0, the same as the initial document
        assert [m['rev'] for m in a.of_type(ACK)] == [1, 2]
        assert [m['rev'] for m in b.of_type(REV)] == [1, 2]
        assert db.docs['doc']['head']['rev_id'] == 2
        assert db.text() == '21xy'
    run(scenario())


def test_concurrent_edit_is_transformed_against_revisions_the_client_missed(db):
    db.add_doc(text='xy', rev=0)

    async def scenario():
        syncer = DocSyncer('doc')
        a, b = await join(syncer, 'a'), await join(syncer, 'b')
        await syncer.add_revision(None, 'a', [{'insert': 'aaa'}], 0)                 # rev 1
        # b appends at the end of "xy" without having seen rev 1
        await syncer.add_revision(None, 'b', [{'retain': 2}, {'insert': 'B'}], 0)    # rev 2
        assert db.text() == 'aaaxyB'
        assert b.of_type(ACK) == [{'type': ACK, 'rev': 2}]
        # a receives b's change shifted past the 3 characters a inserted
        assert json.loads(a.of_type(REV)[-1]['content']) == [{'retain': 5}, {'insert': 'B'}]
    run(scenario())


def test_page_break_is_one_character_for_concurrent_edits(db):
    # a page break is an embed, { insert: { pagebreak: true } }; edits after it must shift by exactly one
    db.add_doc(text='Page one. Page two.\n', rev=0)

    async def scenario():
        syncer = DocSyncer('doc')
        a, b = await join(syncer, 'a'), await join(syncer, 'b')
        await syncer.add_revision(None, 'a', [{'retain': 10}, {'insert': {'pagebreak': True}}], 0)      # rev 1
        # b types at the end of "Page two" without having seen the break
        await syncer.add_revision(None, 'b', [{'retain': 18}, {'insert': '!'}], 0)                     # rev 2
        assert db.docs['doc']['head']['delta'] == [
            {'insert': 'Page one. '}, {'insert': {'pagebreak': True}}, {'insert': 'Page two!.\n'}]
        assert json.loads(a.of_type(REV)[-1]['content']) == [{'retain': 19}, {'insert': '!'}]
        # the break counts as one character towards the size limit
        assert text_length(db.docs['doc']['head']['delta']) == 21
    run(scenario())


def test_edit_based_on_unknown_revision_is_rejected(db):
    db.add_doc(text='xy', rev=3)

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'a')
        with pytest.raises(ValueError, match='out of sync'):
            await syncer.add_revision(None, 'a', [{'insert': '!'}], 7)   # newer than the head
        assert db.text() == 'xy'
    run(scenario())


def test_edit_whose_missed_revisions_were_pruned_is_rejected(db):
    db.add_doc(text='xy', rev=5)                   # history before rev 5 is gone

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'a')
        with pytest.raises(ValueError, match='out of sync'):
            await syncer.add_revision(None, 'a', [{'insert': '!'}], 2)
        assert db.text() == 'xy'
    run(scenario())


def test_retry_after_write_conflict_transforms_the_change_only_once(db):
    db.add_doc(text='xy', rev=0)

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'a'), await join(syncer, 'b')
        await syncer.add_revision(None, 'a', [{'insert': 'aaa'}], 0)
        db.conflicts_to_inject = 2                  # the next two writes lose a race
        await syncer.add_revision(None, 'b', [{'retain': 2}, {'insert': 'B'}], 0)
        # regression: retries used to re-transform the already transformed change
        assert db.text() == 'aaaxyB'
    run(scenario())


def test_history_is_pruned_once_every_client_has_seen_it(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'a'), await join(syncer, 'b')
        for rev in range(3):
            await syncer.add_revision(None, 'a', [{'insert': 'x'}], rev)
        # b is still at rev 0, so every revision after it is kept
        assert [r['rev_id'] for r in db.docs['doc']['history']] == [1, 2, 3]
        await syncer.disconnect('b', None)
        assert db.docs['doc']['clients'] == {'a': 3}
        assert db.docs['doc']['history'] == []
    run(scenario())


def test_disconnect_is_safe_to_call_twice(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'a')
        await syncer.disconnect('a', None)
        await syncer.disconnect('a', None)
        assert syncer.clients == {} and db.docs['doc']['clients'] == {}
    run(scenario())


def test_disconnect_user_drops_only_that_users_connections(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        owner_sock = await join(syncer, 'tab1', 'owner')
        collab_tabs = [await join(syncer, 'tab2', 'collab'), await join(syncer, 'tab3', 'collab')]
        await syncer.disconnect_user('collab', None)
        for sock in collab_tabs:
            assert sock.of_type(DROP) and sock.closed_with == 1008
        assert owner_sock.closed_with is None and not owner_sock.of_type(DROP)
        assert set(syncer.clients) == {'tab1'}
    run(scenario())


def others(sock):
    """Names in the latest presence message a client received"""
    return [u['name'] for u in sock.of_type(PRESENCE)[-1]['users']]


def test_presence_lists_everyone_else_once_in_join_order(db):
    db.add_doc()
    db.user_cards['ann'] = {'name': 'Ann', 'picture': 'https://example.test/ann.png'}

    async def scenario():
        syncer = DocSyncer('doc')
        ann = await join(syncer, 'a1', 'ann')
        bob = await join(syncer, 'b1', 'bob')
        bob_phone = await join(syncer, 'b2', 'bob')     # a second tab doesn't add Bob twice
        cat = await join(syncer, 'c1', 'cat')
        assert others(ann) == ['Bob', 'Cat']
        assert others(bob) == others(bob_phone) == ['Ann', 'Cat']
        assert others(cat) == ['Ann', 'Bob']
        assert cat.of_type(PRESENCE)[-1]['users'][0] == {'id': 'ann', 'name': 'Ann', 'picture': 'https://example.test/ann.png'}
    run(scenario())


def test_presence_updates_when_people_leave(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        ann = await join(syncer, 'a1', 'ann')
        await join(syncer, 'b1', 'bob')
        await join(syncer, 'b2', 'bob')
        await syncer.disconnect('b1', None)
        assert others(ann) == ['Bob'], 'Bob still has a tab open'
        await syncer.disconnect('b2', None)
        assert others(ann) == []
        assert 'bob' not in syncer.user_cards
    run(scenario())


def test_removed_collaborator_disappears_from_presence(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        owner = await join(syncer, 'tab1', 'owner')
        await join(syncer, 'tab2', 'collab')
        assert others(owner) == ['Collab']
        await syncer.disconnect_user('collab', None)
        assert others(owner) == []
    run(scenario())


def test_cursor_is_relayed_to_everyone_else_with_the_senders_name(db):
    db.add_doc(text='hello')
    db.user_cards['ann'] = {'name': 'Ann', 'picture': None}

    async def scenario():
        syncer = DocSyncer('doc')
        ann = await join(syncer, 'a1', 'ann')
        bob = await join(syncer, 'b1', 'bob')
        ann_phone = await join(syncer, 'a2', 'ann')     # Ann's other tab sees her cursor too
        await syncer.relay_cursor('a1', 2, 3, 0)
        expected = {'type': CURSOR, 'client': 'a1', 'user': 'ann', 'name': 'Ann', 'index': 2, 'length': 3, 'rev': 0}
        assert bob.of_type(CURSOR) == [expected]
        assert ann_phone.of_type(CURSOR) == [expected]
        assert ann.of_type(CURSOR) == [], 'never sent back to its own tab'
    run(scenario())


def test_leaving_removes_the_cursor_for_the_others(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        ann = await join(syncer, 'a1', 'ann')
        await join(syncer, 'b1', 'bob')
        await syncer.disconnect('b1', None)
        assert ann.of_type(CURSOR) == [{'type': CURSOR, 'client': 'b1', 'index': None}]
    run(scenario())


def test_cursor_of_a_client_that_already_left_is_dropped(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        ann = await join(syncer, 'a1', 'ann')
        await syncer.relay_cursor('gone', 0, 0, 0)
        assert ann.of_type(CURSOR) == []
    run(scenario())


def test_deleted_document_drops_every_connection_without_touching_the_db(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        tabs = [await join(syncer, 'tab1', 'owner'), await join(syncer, 'tab2', 'collab')]
        del db.docs['doc']                              # the row is already gone
        await syncer.drop_everyone()
        for sock in tabs:
            assert sock.of_type(DROP) == [{'type': DROP, 'reason': 'deleted'}]
            assert sock.closed_with == 1008
        assert syncer.clients == {} and syncer.client_users == {}
        await syncer.disconnect('tab1', None)           # the socket handler's cleanup must not fail
    run(scenario())


def test_broken_peer_socket_does_not_break_the_sender(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        sender = await join(syncer, 'a')
        assert await syncer.connect('dead', 'owner', FakeSocket(), None)
        syncer.clients['dead'].fail = True
        await syncer.add_revision(None, 'a', [{'insert': 'hi'}], 0)
        assert sender.of_type(ACK) == [{'type': ACK, 'rev': 1}]
    run(scenario())


def test_only_edits_change_last_edit(db):
    db.add_doc()

    async def scenario():
        syncer = DocSyncer('doc')
        await join(syncer, 'a')
        await join(syncer, 'b')
        await syncer.disconnect('b', None)
        assert db.docs['doc']['last_edit'] == 0      # opening/closing isn't an edit
        await syncer.add_revision(None, 'a', [{'insert': 'hi'}], 0)
        assert db.docs['doc']['last_edit'] == 1
    run(scenario())


# --- document length limit -----------------------------------------------------

def test_text_length_ignores_quills_trailing_newline():
    assert text_length([]) == 0
    assert text_length([{'insert': 'hello\n'}]) == 5
    assert text_length([{'insert': 'a\nb'}]) == 3
    assert text_length([{'insert': 'hi', 'attributes': {'bold': True}}, {'insert': '\n'}]) == 2


def test_edit_reaching_the_limit_is_accepted(db, monkeypatch):
    monkeypatch.setattr(doc_syncer, 'MAX_DOC_CHARS', 10)
    db.add_doc(text='12345\n')

    async def scenario():
        syncer = DocSyncer('doc')
        a = await join(syncer, 'a')
        await syncer.add_revision(None, 'a', [{'insert': '67890'}], 0)    # exactly 10
        assert a.of_type(ACK) and not a.of_type(LIMIT)
        assert text_length(db.docs['doc']['head']['delta']) == 10
    run(scenario())


def test_edit_growing_past_the_limit_is_refused_and_not_broadcast(db, monkeypatch):
    monkeypatch.setattr(doc_syncer, 'MAX_DOC_CHARS', 10)
    db.add_doc(text='12345\n')

    async def scenario():
        syncer = DocSyncer('doc')
        a, b = await join(syncer, 'a'), await join(syncer, 'b')
        writes_before = db.writes
        await syncer.add_revision(None, 'a', [{'insert': '678901'}], 0)   # would be 11
        assert a.of_type(LIMIT) == [{'type': LIMIT, 'max_chars': 10}]
        assert not a.of_type(ACK) and not b.of_type(REV)
        assert db.text() == '12345\n' and db.writes == writes_before
    run(scenario())


def test_concurrent_edits_cannot_add_up_past_the_limit(db, monkeypatch):
    monkeypatch.setattr(doc_syncer, 'MAX_DOC_CHARS', 10)
    db.add_doc(text='12345\n')

    async def scenario():
        syncer = DocSyncer('doc')
        a, b = await join(syncer, 'a'), await join(syncer, 'b')
        # each edit is fine on its own (5 + 4 = 9), but not together (13)
        await syncer.add_revision(None, 'a', [{'insert': 'aaaa'}], 0)
        await syncer.add_revision(None, 'b', [{'insert': 'bbbb'}], 0)
        assert a.of_type(ACK) and b.of_type(LIMIT)
        assert db.text() == 'aaaa12345\n'
    run(scenario())


def test_document_over_the_limit_can_still_be_shortened(db, monkeypatch):
    monkeypatch.setattr(doc_syncer, 'MAX_DOC_CHARS', 10)
    db.add_doc(text='0123456789abcdef\n')       # 16, e.g. created before the limit existed

    async def scenario():
        syncer = DocSyncer('doc')
        a = await join(syncer, 'a')
        await syncer.add_revision(None, 'a', [{'delete': 3}], 0)
        await syncer.add_revision(None, 'a', [{'retain': 2, 'attributes': {'bold': True}}], 1)   # same length
        assert len(a.of_type(ACK)) == 2 and not a.of_type(LIMIT)
        await syncer.add_revision(None, 'a', [{'insert': 'x'}], 2)                               # grows
        assert a.of_type(LIMIT)
        assert text_length(db.docs['doc']['head']['delta']) == 13
    run(scenario())


def test_documents_of_known_owners_have_no_size_limit(db, monkeypatch):
    monkeypatch.setattr(doc_syncer, 'MAX_DOC_CHARS', 10)
    db.add_doc(text='12345\n')
    db.owner_types['doc'] = 'known'

    async def scenario():
        syncer = DocSyncer('doc')
        a = await join(syncer, 'a')                     # e.g. a guest collaborator
        assert a.sent[0]['max_chars'] is None
        await syncer.add_revision(None, 'a', [{'insert': 'x' * 50}], 0)
        assert a.of_type(ACK) and not a.of_type(LIMIT)
        assert text_length(db.docs['doc']['head']['delta']) == 55
    run(scenario())


@pytest.mark.parametrize('seed', range(25))
def test_random_concurrent_editing_converges(db, seed):
    """Several simulated browsers (same algorithm as sync_client.js) edit at random with
    messages delayed and interleaved; afterwards every screen equals the saved document."""
    db.add_doc()
    rand = random.Random(seed)

    async def scenario():
        syncer = DocSyncer('doc')
        clients = []
        for i in range(2 + seed % 5):
            client, sock = SimClient(f'c{i}'), await join(syncer, f'c{i}')
            client.init(sock.sent[0]['content'], sock.sent[0]['rev'])
            clients.append((client, sock, [0]))      # [0] = index of next unread message

        def deliver_one(client, sock, read):
            msg = sock.sent[read[0]]
            read[0] += 1
            if msg['type'] == ACK:
                client.ack(msg['rev'])
            elif msg['type'] == REV:
                client.server_rev(json.loads(msg['content']), msg['rev'])

        async def send(client):
            out = client.take_outgoing()
            if out:
                await syncer.add_revision(None, client.client_id, *out)

        for _ in range(250):
            client, sock, read = rand.choice(clients)
            r = rand.random()
            if r < 0.45:
                client.local_change(random_edit(rand, D.length(client.screen), client.client_id))
            elif r < 0.7:
                await send(client)
            elif read[0] < len(sock.sent):
                deliver_one(client, sock, read)

        # deliver everything and flush what's left
        busy = True
        while busy:
            busy = False
            for client, sock, read in clients:
                while read[0] < len(sock.sent):
                    deliver_one(client, sock, read); busy = True
                if client.Y and not client.X:
                    await send(client); busy = True

        saved = normalize(db.docs['doc']['head']['delta'])
        for client, _, _ in clients:
            assert normalize(client.screen) == saved, f'{client.client_id} screen differs'
            assert normalize(client.doc()) == saved, f'{client.client_id} state differs'
    run(scenario())
