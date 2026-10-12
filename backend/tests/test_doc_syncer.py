"""DocSyncer: the server side of real-time editing, run against an in-memory database."""
import asyncio
import json
import random

import pytest

import app.delta as D
from app.doc_syncer import DocSyncer, MessageType
from tests.fakes import FakeDB, FakeSocket, SimClient, normalize, random_edit, text_of

INIT, ACK, REV, DROP = (MessageType.SERVER_INIT.value, MessageType.SERVER_ACK.value,
                        MessageType.SERVER_REV.value, MessageType.SERVER_DROP_ACCESS.value)


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
        assert sock.sent == [{'type': INIT, 'rev': 4, 'content': [{'insert': 'hello'}]}]
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
