# from changeset import Delta, Op, INSERT, delta_from_list
from enum import Enum
import asyncio
import copy
import json
import os
from fastapi import WebSocket
import app.postgres_utils as db_utils
import app.delta as delta

class MessageType(Enum):
    CLIENT_ID = 0   # To send client ID to server
    CLIENT_REV = 1  # Send changes made in client to server
    SERVER_REV = 2  # Send other client changes to a client
    SERVER_ACK = 3  # Send an acknowledge signal
    SERVER_INIT = 4 # Send the initial data to newly connected client
    
    SERVER_DOC_RENAME = 5
    SERVER_DROP_ACCESS = 6 # Client removed as a collaborator
    SERVER_DOC_LIMIT = 7   # Client's change was rejected: document would exceed its size limit
    SERVER_PRESENCE = 8    # The other people who have the document open
    CLIENT_CURSOR = 9      # Client's cursor/selection moved (index, length, at revision rev)
    SERVER_CURSOR = 10     # Another client's cursor, relayed as is; index None when it left
    SERVER_RESYNC = 11     # Client's change didn't fit the document, so it was refused: reload to resync

# Maximum length in characters of documents owned by guest users ('known' owners have no limit);
# self-hosted copies can raise it through the environment
MAX_DOC_CHARS = int(os.environ.get('MAX_DOC_CHARS', 2000))


def text_length(doc) -> int:
    """Characters in a document, not counting the newline Quill keeps at the end"""
    length = delta.length(doc)
    if doc and isinstance(doc[-1].get('insert'), str) and doc[-1]['insert'].endswith('\n'):
        length -= 1
    return length


class DocTooLong(Exception):
    pass


class DocMismatch(Exception):
    """A client's change doesn't fit the document: its copy has drifted from the server's"""


def change_base_length(change) -> int:
    """Length of the document a change applies to, at least: the characters it keeps or deletes"""
    return sum(delta.op_length(op) for op in change if delta.INSERT not in op)

"""
Compose - Add one after another
Merge   - Two deltas to the same document
Follow/Transform  - The delta required to compose with A, to make it into merge(A, B), or, "transform" B according A
"""

# class RevNode:
#     def __init__(self):
#         self.client_id = -1
#         self.rev_id = -1
#         self.changeset:Delta = None

class DocSyncer:
    def __init__(self, doc_id: str):
        self.clients:dict[str, WebSocket] = {}
        self.client_users:dict[str, str] = {}   # client id -> user id that opened it
        self.user_cards:dict[str, dict] = {}    # user id -> name and picture, for users connected now
        self.doc_id = doc_id
        # Serializes connect/disconnect/add_revision for this doc, so every client gets
        # SERVER_INIT and then every later revision exactly once and in order.
        # Fine because active_docs lives in a single backend process.
        self.lock = asyncio.Lock()
        # size limit for this document, or None for no limit; refreshed whenever a client connects
        self.max_chars = MAX_DOC_CHARS

    async def _send(self, websocket: WebSocket, message: dict):
        # A peer that just disconnected must not break the sender; its own handler cleans it up
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    async def connect(self, client_id: str, user_id: str, websocket: WebSocket, db_handle: db_utils.DB_Handle) -> bool:
        """Returns False if the client id is already connected or the doc can't be loaded."""
        async with self.lock:
            if client_id in self.clients:
                return False

            try:
                _, doc_content = await db_utils.get_doc_info(db_handle, self.doc_id)
            except LookupError:
                await websocket.send_json({'error': f'Document with ID {self.doc_id} doesnt exist!'})
                return False

            # Register the client's revision before sending anything, so history it still
            # needs is never pruned. The head can't move meanwhile because we hold the lock.
            head = doc_content['head']
            if not await db_utils.update_client_rev(db_handle, self.doc_id, client_id, head['rev_id']):
                return False

            # the owner's type decides the limit for everyone editing this document
            owner_type = await db_utils.get_doc_owner_type(db_handle, self.doc_id)
            self.max_chars = None if owner_type == 'known' else MAX_DOC_CHARS

            if user_id not in self.user_cards:
                self.user_cards[user_id] = await db_utils.get_user_card(db_handle, user_id)

            self.clients[client_id] = websocket
            self.client_users[client_id] = user_id
            await websocket.send_json({
                "type": MessageType.SERVER_INIT.value,
                "rev": head['rev_id'],
                "content": head['delta'],
                "max_chars": self.max_chars
            })
            await self._send_presence()
            return True

    async def disconnect(self, client_id, db_handle: db_utils.DB_Handle):
        # Safe to call more than once: the socket handler also calls it when the socket closes
        async with self.lock:
            if self.clients.pop(client_id, None) is None:
                return
            user_id = self.client_users.pop(client_id, None)
            # forget the card when their last tab closes, so a new name or picture shows next time
            if user_id not in self.client_users.values():
                self.user_cards.pop(user_id, None)
            await db_utils.delete_client_rev(db_handle, self.doc_id, client_id)
            await self._send_presence()
            await self._send_to_others(client_id, {
                "type": MessageType.SERVER_CURSOR.value, "client": client_id, "index": None
            })

    async def _send_to_others(self, client_id, message):
        for other, sock in list(self.clients.items()):
            if other != client_id:
                await self._send(sock, message)

    async def relay_cursor(self, client_id: str, index: int, length: int, rev: int):
        """Passes a client's cursor on to everyone else on the document; nothing is stored.
        The position is in the document as of revision rev. Holding the lock means every client
        already has revision rev when the cursor reaches it: a client only knows of rev after
        add_revision has sent it to everyone, and that sending happens under this lock."""
        async with self.lock:
            user_id = self.client_users.get(client_id)
            if user_id is None:
                return
            await self._send_to_others(client_id, {
                "type": MessageType.SERVER_CURSOR.value,
                "client": client_id,
                "user": user_id,
                "name": self.user_cards.get(user_id, {}).get('name', ''),
                "index": index, "length": length, "rev": rev,
            })

    async def _send_presence(self):
        """Tells every client who else has the document open: each person once, however many
        tabs they use, in the order they joined, and never the client's own user."""
        users = list(dict.fromkeys(self.client_users.values()))
        for client_id, sock in list(self.clients.items()):
            me = self.client_users.get(client_id)
            await self._send(sock, {
                "type": MessageType.SERVER_PRESENCE.value,
                "users": [{"id": u, **self.user_cards.get(u, {'name': '', 'picture': None})} for u in users if u != me]
            })

    async def disconnect_user(self, user_id: str, db_handle: db_utils.DB_Handle):
        """Drops every connection opened by user_id, e.g. after they're removed as a collaborator."""
        for client_id in [c for c, u in self.client_users.items() if u == user_id]:
            sock = self.clients.get(client_id)
            await self.disconnect(client_id, db_handle)
            if sock is None:
                continue
            try:
                await sock.send_json({"type": MessageType.SERVER_DROP_ACCESS.value})
                await sock.close(code=1008)
            except Exception:
                pass    # already closed by the client
        
    async def drop_everyone(self):
        """Closes every connection after the document was deleted. The document row is gone,
        so unlike disconnect() this doesn't touch the database."""
        async with self.lock:
            sockets = list(self.clients.values())
            self.clients.clear()
            self.client_users.clear()
        for sock in sockets:
            try:
                await sock.send_json({"type": MessageType.SERVER_DROP_ACCESS.value, "reason": "deleted"})
                await sock.close(code=1008)
            except Exception:
                pass    # already closed by the client

    async def send_doc_rename(self, new_doc_name):
        for csocket in list(self.clients.values()):
            await self._send(csocket, {
                "type": MessageType.SERVER_DOC_RENAME.value,
                "name": new_doc_name
            })
        
    async def add_revision(self, db_handle, client_id, rev_changes, reference_id: int):
        """Applies a client's change made on top of revision reference_id."""
        async with self.lock:
            result = {}

            def mutate(content):
                head_rev = content['head']['rev_id']
                history = content['history']
                # The client must have seen a revision we know, and we must still have every
                # revision after it, otherwise the change can't be transformed correctly
                if reference_id > head_rev or (reference_id < head_rev and (not history or history[0]['rev_id'] > reference_id + 1)):
                    raise ValueError(f'Client {client_id} is out of sync: based on rev {reference_id}, head is {head_rev}')

                # Start from the client's original change on every attempt, and bring it up to date
                # with each revision it hasn't seen. Those happened first, so they get priority.
                changes = copy.deepcopy(rev_changes)
                for record in history:
                    if record['rev_id'] > reference_id:
                        changes = delta.transform(record['delta'], changes, True)

                # A change can't reach past the end of the document. If it does, the client's copy no
                # longer matches the server's (it was made against a document we don't have), and
                # composing it would leave a retain in the stored document. Refuse it instead.
                if change_base_length(changes) > delta.length(content['head']['delta']):
                    raise DocMismatch()

                new_doc = delta.compose(content['head']['delta'], changes)
                # Browsers stop edits past the limit, but concurrent edits can still add up past it.
                # Only growth is refused, so a document that's already too long can be shortened.
                if self.max_chars is not None:
                    new_length = text_length(new_doc)
                    if new_length > self.max_chars and new_length > text_length(content['head']['delta']):
                        raise DocTooLong()

                next_rev_id = head_rev + 1
                content['clients'][client_id] = next_rev_id
                history.append({'rev_id': next_rev_id, 'delta': changes})
                content['head'] = {'rev_id': next_rev_id, 'delta': new_doc}
                db_utils.prune_history(content)
                result['rev'], result['changes'] = next_rev_id, changes

            # Retries only race with writers outside this lock (rename, collaborator changes)
            try:
                saved = await db_utils.update_doc_with_retry(db_handle, self.doc_id, mutate, edited=True)
            except DocTooLong:
                # Nothing was saved or broadcast; the sender reloads the document to get back in sync
                if client_id in self.clients:
                    await self._send(self.clients[client_id], {
                        "type": MessageType.SERVER_DOC_LIMIT.value,
                        "max_chars": self.max_chars
                    })
                return
            except DocMismatch:
                # Nothing was saved or broadcast; the sender reloads to start again from the saved document
                print(f'Refused a change from client {client_id} on doc {self.doc_id}: it doesn\'t fit the document')
                if client_id in self.clients:
                    await self._send(self.clients[client_id], {"type": MessageType.SERVER_RESYNC.value})
                return
            if not saved:
                raise RuntimeError(f'Could not save revision for doc {self.doc_id}')

            for cl, sock in list(self.clients.items()):
                if cl == client_id:
                    await self._send(sock, {
                        "type": MessageType.SERVER_ACK.value,
                        "rev": result['rev']
                    })
                else:
                    await self._send(sock, {
                        "type": MessageType.SERVER_REV.value,
                        "rev": result['rev'],
                        "content": json.dumps(result['changes'])
                    })
