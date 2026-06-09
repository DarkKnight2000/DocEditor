# from changeset import Delta, Op, INSERT, delta_from_list
from enum import Enum
from fastapi import WebSocket
import db_utils
import delta

class MessageType(Enum):
    CLIENT_ID = 0   # To send client ID to server
    CLIENT_REV = 1  # Send changes made in client to server
    SERVER_REV = 2  # Send other client changes to a client
    SERVER_ACK = 3  # Send an acknowledge signal
    SERVER_INIT = 4 # Send the initial data to newly connected client

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
        self.clients:dict[int, WebSocket] = {}
        self.doc_id = doc_id
        # self.rev_record: list[RevNode] = []
        # self.headtext:Delta = Delta([Op(INSERT, "Hello World!")]) # current state of document
        # self.head_record_id = 0     # record ID of head
        
    def connect(self, id:str, websocket:WebSocket):
        if id not in self.clients:
            self.clients[id] = websocket
        
    def disconnect(self, client_id):
        del self.clients[client_id]
        
    async def add_revision(self, db_handle, client_id, rev_changes, reference_id):
        print(rev_changes)
        
        # Get data and CAS from database, update is successful if CAS matches before updating
        while True:
            cas, content = await db_utils.get_doc_info(db_handle, self.doc_id)
            start_sync = False
            for record in content['history']:
                if start_sync:
                    rev_changes = delta.transform(record, rev_changes, True)
                elif reference_id == record['rev_id']: # Found current client record, start syncing with future records
                    start_sync = True
            
            next_rev_id = 0
            if len(content['history']):
                next_rev_id = content['history'][-1]['rev_id'] + 1
            edit_ts = db_utils.get_current_timestamp()
            # content['clients'][client_id] = {
            #     'sync_rev_id': next_rev_id,
            #     'sync_timestamp': edit_ts
            # }
            content['history'].append({
                'rev_id': next_rev_id,
                'delta': rev_changes
            })
            content['head'] = {
                'rev_id': next_rev_id,
                'delta': delta.compose(content['head']['delta'], rev_changes)
            }
            content['last_edit'] = edit_ts
            
            if await db_utils.try_update_doc(db_handle, self.doc_id, content, cas):
                break
            
        
        for cl, sock in self.clients.items():
            if cl == client_id:
                await sock.send_json({
                    "type": MessageType.SERVER_ACK.value,
                    "rev": next_rev_id
                })
            else:
                await sock.send_json({
                    "type": MessageType.SERVER_REV.value,
                    "rev": next_rev_id,
                    "content": str(rev_changes)
                })

        # revnode = RevNode()
        # revnode.client_id = client_id
        # revnode.rev_id = self.head_record_id + 1
        # revnode.changeset = rev_changes
        # self.rev_record.append(revnode)
        # self.head_record_id = revnode.rev_id
        # self.headtext = self.headtext.compose(rev_changes)
        # print(self.headtext)
        
        # for cl, sock in self.clients.items():
        #     if cl == client_id:
        #         await sock.send_json({
        #             "type": MessageType.SERVER_ACK.value,
        #             "rev": self.head_record_id
        #         })
        #     else:
        #         await sock.send_json({
        #             "type": MessageType.SERVER_REV.value,
        #             "rev": self.head_record_id,
        #             "content": str(rev_changes)
        #         })
