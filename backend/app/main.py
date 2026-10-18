from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, Response, HTTPException, Depends, APIRouter
from contextlib import asynccontextmanager
from app.doc_syncer import DocSyncer, MessageType, MAX_DOC_CHARS
from pydantic import BaseModel
import app.postgres_utils as db_utils
from typing import Annotated
from jose import jwt, JWTError
import os
import json
import asyncio
import sys

db_handle: db_utils.DB_Handle = None

@asynccontextmanager
async def server_lifespan(app: FastAPI):
    global db_handle
    db_handle = await db_utils.db_connect()
    await db_utils.migrate(db_handle)
    yield
    await db_utils.db_disconnect(db_handle)

app = FastAPI(lifespan=server_lifespan)
router = APIRouter(prefix="/api")


@router.get("/")
async def root():
    return {"message": "Hello World!"}


SHARED_JWT_SECRET = os.environ['SHARED_JWT_SECRET']
# Per-account limits; self-hosted copies can raise them through the environment
MAX_DOCS_PER_USER = int(os.environ.get('MAX_DOCS_PER_USER', 2))
def get_internal_user(authorization: Annotated[str | None, Header()]):
    try:
        token = authorization.removeprefix("Bearer ").strip()
        payload = jwt.decode(token, SHARED_JWT_SECRET, algorithms=['HS256'])
        return payload['sub']
    except JWTError:
        raise HTTPException(status_code=401, detail='Invalid internal token')

def get_socket_user(token: str | None, doc_id: str) -> str | None:
    """Returns the user id from an edit-socket token, or None if it's invalid or for another doc."""
    if not isinstance(token, str):
        return None
    try:
        payload = jwt.decode(token, SHARED_JWT_SECRET, algorithms=['HS256'], audience='edit-socket')
    except JWTError:
        return None
    # jose skips the audience check when the claim is missing, so check it explicitly
    # (otherwise a regular API token would also open a socket)
    if payload.get('aud') != 'edit-socket' or payload.get('doc_id') != doc_id:
        return None
    return payload.get('sub')

class UserInfo(BaseModel):
    name: str
    email: str | None = None    # only sent when Google has verified it
    picture: str | None = None  # Google profile picture link

@router.post("/user-login")
async def user_login(user_info: UserInfo, user_id: str = Depends(get_internal_user)):
    await db_utils.upsert_user_info(db_handle, user_id, user_info.name, user_info.email, user_info.picture)
    return Response("Ok")

@router.get("/get-user-docs")
async def get_user_docs(user_id: str = Depends(get_internal_user)):
    return json.dumps(await db_utils.get_user_docs(db_handle, user_id))

@router.get("/limits")
async def limits(user_id: str = Depends(get_internal_user)):
    # shown on the documents page; known users have no limits
    if await db_utils.get_user_type(db_handle, user_id) == 'known':
        return {'user_type': 'known', 'max_docs': None, 'max_chars': None}
    return {'user_type': 'guest', 'max_docs': MAX_DOCS_PER_USER, 'max_chars': MAX_DOC_CHARS}

@router.post("/create-new-doc")
async def create_new_doc(user_id: str = Depends(get_internal_user)):
    try:
        doc_id = await db_utils.create_new_doc(db_handle, user_id, MAX_DOCS_PER_USER)
    except db_utils.DocError as ex:
        raise HTTPException(status_code=ex.status, detail=ex.message)
    return json.dumps({'doc_id': doc_id})

@router.get("/get-doc-info")
async def get_doc_info(doc_id: str, user_id: str = Depends(get_internal_user)):
    doc_info = await db_utils.get_doc_info_masked(db_handle, doc_id, user_id)
    if not doc_info:
        return Response('You do not have permission to access this document!', status_code=403)
    return json.dumps(doc_info)


MAX_DOC_NAME_LENGTH = 200

class DeleteReqBody(BaseModel):
    id: str
@router.post("/delete-doc")
async def delete_doc(req_body: DeleteReqBody, user_id: str = Depends(get_internal_user)):
    try:
        await db_utils.delete_doc(db_handle, req_body.id, user_id)
    except db_utils.DocError as ex:
        raise HTTPException(status_code=ex.status, detail=ex.message)
    # anyone with the document open is told it was deleted and disconnected
    doc_syncer = active_docs.pop(req_body.id, None)
    if doc_syncer:
        await doc_syncer.drop_everyone()
    return Response('ok', status_code=200)


class RenameReqBody(BaseModel):
    id: str
    name: str
@router.post("/rename-doc")
async def rename_doc(req_body: RenameReqBody, user_id: str = Depends(get_internal_user)):
    name = ' '.join(req_body.name.split())    # collapse newlines and repeated spaces
    if not name or len(name) > MAX_DOC_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f'Document name must be 1 to {MAX_DOC_NAME_LENGTH} characters.')
    try:
        await db_utils.rename_doc(db_handle, req_body.id, name, user_id)
    except db_utils.DocError as ex:
        raise HTTPException(status_code=ex.status, detail=ex.message)
    # only docs with open editors are in active_docs
    if req_body.id in active_docs:
        await active_docs[req_body.id].send_doc_rename(name)
    return Response(name, status_code=200)


active_docs: dict[str, DocSyncer] = {}

"""
    CLIENT_ID = 0   # To send client ID to server
    type: 0, id: client_id
    
    CLIENT_REV = 1  # Send changes made in client to server
    type: 1, content: List of ops, rev: rev id
    
    SERVER_REV = 2  # Send other client changes to a client
    type: 2, content: List of ops, rev: rev id
    
    SERVER_ACK = 3  # Send an acknowledge signal
    type: 3, rev: rev id
    
    SERVER_INIT = 4 # Send the initial data to newly connected client
    type: 4, content: List of ops, rev: rev id
"""
@router.websocket("/edit-socket/{doc_id}")
async def edit_socket(websocket: WebSocket, doc_id: str):
    await websocket.accept()

    # The first message must be CLIENT_ID with a valid socket token for this doc
    try:
        data = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await websocket.close(code=1008)
        return

    user_id = None
    if isinstance(data, dict) and data.get("type") == MessageType.CLIENT_ID.value:
        user_id = get_socket_user(data.get("token"), doc_id)
    # get_doc_info_masked is empty if the doc doesn't exist or the user is neither owner nor collaborator
    if not user_id or not await db_utils.get_doc_info_masked(db_handle, doc_id, user_id):
        await websocket.close(code=1008, reason="Not allowed to edit this document")
        return

    my_id = data.get("id")
    if not isinstance(my_id, str) or not my_id:
        await websocket.close(code=1008)
        return

    if doc_id not in active_docs:
        active_docs[doc_id] = DocSyncer(doc_id)
    doc_syncer = active_docs[doc_id]

    if not await doc_syncer.connect(my_id, user_id, websocket, db_handle):
        await websocket.close(code=1008)
        if not doc_syncer.clients:
            active_docs.pop(doc_id, None)
        return

    # wait for messages on this socket
    # since it is async-await, other things are done while waiting for message from client
    # so every client has its own "green-thread"
    try:
        while True:
            data = await websocket.receive_json()
            if data["type"] == MessageType.CLIENT_REV.value:
                C = data["content"]
                r_c = data["rev"]
                if not isinstance(C, list) or not isinstance(r_c, int) or isinstance(r_c, bool):
                    break
                await doc_syncer.add_revision(db_handle, my_id, C, r_c)
            elif data["type"] == MessageType.CLIENT_CURSOR.value:
                position = [data.get(k) for k in ("index", "length", "rev")]
                # malformed cursors are ignored rather than closing the socket: they're only cosmetic
                if all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 10_000_000 for v in position):
                    await doc_syncer.relay_cursor(my_id, *position)
    except WebSocketDisconnect:
        pass
    finally:
        await doc_syncer.disconnect(my_id, db_handle)
        if not doc_syncer.clients and active_docs.get(doc_id) is doc_syncer:
            del active_docs[doc_id]
    
    
# Collaborators section
@router.get("/get-collab-info")
async def get_collab_info(doc_id: str, user_id: str = Depends(get_internal_user)):
    if not await db_utils.get_doc_info_masked(db_handle, doc_id, user_id):
        return Response('You do not have permission to access this document!', status_code=403)
    collab_info = await db_utils.get_collab_info(db_handle, doc_id, user_id)
    return Response(json.dumps(collab_info))

class EditCollabReqBody(BaseModel):
    doc_id: str
    user_email: str
    op: bool
@router.post("/edit-collab")
async def edit_collab(req_body: EditCollabReqBody, user_id: str = Depends(get_internal_user)):
    try:
        collab_uid = await db_utils.edit_collab(db_handle, req_body.doc_id, user_id, req_body.user_email, req_body.op)
    except db_utils.DocError as ex:
        raise HTTPException(status_code=ex.status, detail=ex.message)

    # if removing, disconnect all of that user's active connections
    if req_body.op and req_body.doc_id in active_docs:
        await active_docs[req_body.doc_id].disconnect_user(collab_uid, db_handle)
    return Response('ok', status_code=200)
    
    
app.include_router(router)