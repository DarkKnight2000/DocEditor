from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, Response, HTTPException, Depends, APIRouter
from contextlib import asynccontextmanager
from app.doc_syncer import DocSyncer, MessageType
from pydantic import BaseModel
import app.postgres_utils as db_utils
from typing import Annotated
from jose import jwt, JWTError
import os
import json
import sys

db_handle: db_utils.DB_Handle = None

@asynccontextmanager
async def server_lifespan(app: FastAPI):
    global db_handle
    db_handle = await db_utils.db_connect()
    # if not db_handle:
    #     print('Database connection failed during server initialization')
    #     raise Exception('Database connection failed during server initialization')
    yield
    await db_utils.db_disconnect(db_handle)

app = FastAPI(lifespan=server_lifespan)
router = APIRouter(prefix="/api")


@router.get("/")
async def root():
    return {"message": "Hello World!"}


SHARED_JWT_SECRET = os.environ['SHARED_JWT_SECRET']
def get_internal_user(authorization: Annotated[str | None, Header()]):
    # print(authorization)
    try:
        token = authorization.removeprefix("Bearer ").strip()
        payload = jwt.decode(token, SHARED_JWT_SECRET, algorithms=['HS256'])
        # print(payload)
        return payload['sub']
    except JWTError:
        raise HTTPException(status_code=401, detail='Invalid internal token')

class UserInfo(BaseModel):
    name: str
    email: str

@router.post("/user-login")
async def user_login(user_info: UserInfo, user_id: str = Depends(get_internal_user)):
    # return upsert_user_info("", "")
    await db_utils.upsert_user_info(db_handle, user_id, user_info.name, user_info.email)
    return Response("Ok")

@router.get("/get-user-docs")
async def get_user_docs(user_id: str = Depends(get_internal_user)):
    return json.dumps(await db_utils.get_user_docs(db_handle, user_id))

@router.post("/create-new-doc")
async def create_new_doc(user_id: str = Depends(get_internal_user)):
    return json.dumps({'doc_id': await db_utils.create_new_doc(db_handle, user_id)})

@router.get("/get-doc-info")
async def get_doc_info(doc_id: str, user_id: str = Depends(get_internal_user)):
    doc_info = await db_utils.get_doc_info_masked(db_handle, doc_id, user_id)
    if not doc_info:
        return Response('You do not have permission to access this document!', status_code=403)
    return json.dumps(doc_info)


class RenameReqBody(BaseModel):
    id: str
    name: str
@router.post("/rename-doc")
async def rename_doc(req_body: RenameReqBody, user_id: str = Depends(get_internal_user)):
    if await db_utils.rename_doc(db_handle, req_body.id, req_body.name, user_id):
        await active_docs[req_body.id].send_doc_rename(req_body.name)
        return Response('ok', status_code=200)
    return Response('failed', status_code=403)


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
    
    if not await db_utils.check_doc_exists(db_handle, doc_id):
        await websocket.close("Document doesn't exist! Login and create a new document to start editing")
        return
    
    await websocket.accept()
    my_id = None
    doc_syncer: DocSyncer = None
    
    if doc_id not in active_docs:
        active_docs[doc_id] = DocSyncer(doc_id)
    doc_syncer = active_docs[doc_id]
    
    # wait for messages on this socket
    # since it is async-await, other things are done while waiting for message from client
    # so every client has its own "green-thread"
    try:
        while True:
            data = await websocket.receive_json()
            # print("Received data: ", data)
            if data["type"] == MessageType.CLIENT_ID.value:
                my_id = data["id"]
                await doc_syncer.connect(my_id, websocket, db_handle)
            elif data["type"] == MessageType.CLIENT_REV.value:
                C = data["content"]
                r_c = data["rev"]
                await doc_syncer.add_revision(db_handle, my_id, C, r_c)
    except WebSocketDisconnect:
        if my_id:
            await doc_syncer.disconnect(my_id, db_handle)
        if not len(active_docs[doc_id].clients):
            del active_docs[doc_id]
    
    
# Collaborators section
@router.get("/get-collab-info")
async def get_collab_info(doc_id: str, user_id: str = Depends(get_internal_user)):
    collab_info = await db_utils.get_collab_info(db_handle, doc_id, user_id)
    return Response(json.dumps(collab_info))

class EditCollabReqBody(BaseModel):
    doc_id: str
    user_email: str
    op: bool
@router.post("/edit-collab")
async def edit_collab(req_body: EditCollabReqBody, user_id: str = Depends(get_internal_user)):
    res, collab_uid = await db_utils.edit_collab(db_handle, req_body.doc_id, user_id, req_body.user_email, req_body.op)
    if not res: return Response('failed', status_code=403)

    # if removing, disconnect active connections
    if req_body.op and req_body.doc_id in active_docs:
        await active_docs[req_body.doc_id].disconnect(collab_uid, db_handle, True)
    return Response('ok', status_code=200)
    
    
app.include_router(router)