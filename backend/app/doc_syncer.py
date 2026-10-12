# from changeset import Delta, Op, INSERT, delta_from_list
from enum import Enum
import asyncio
import copy
import json
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
        self.doc_id = doc_id
        # Serializes connect/disconnect/add_revision for this doc, so every client gets
        # SERVER_INIT and then every later revision exactly once and in order.
        # Fine because active_docs lives in a single backend process.
        self.lock = asyncio.Lock()

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

            self.clients[client_id] = websocket
            self.client_users[client_id] = user_id
            await websocket.send_json({
                "type": MessageType.SERVER_INIT.value,
                "rev": head['rev_id'],
                "content": head['delta']
            })
            return True

    async def disconnect(self, client_id, db_handle: db_utils.DB_Handle):
        # Safe to call more than once: the socket handler also calls it when the socket closes
        async with self.lock:
            if self.clients.pop(client_id, None) is None:
                return
            self.client_users.pop(client_id, None)
            await db_utils.delete_client_rev(db_handle, self.doc_id, client_id)

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

                next_rev_id = head_rev + 1
                content['clients'][client_id] = next_rev_id
                history.append({'rev_id': next_rev_id, 'delta': changes})
                content['head'] = {
                    'rev_id': next_rev_id,
                    'delta': delta.compose(content['head']['delta'], changes)
                }
                db_utils.prune_history(content)
                result['rev'], result['changes'] = next_rev_id, changes

            # Retries only race with writers outside this lock (rename, collaborator changes)
            if not await db_utils.update_doc_with_retry(db_handle, self.doc_id, mutate, edited=True):
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
