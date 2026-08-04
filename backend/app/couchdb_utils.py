from couchbase.auth import PasswordAuthenticator
from couchbase.options import ClusterOptions, QueryOptions
from couchbase.exceptions import CouchbaseException, UnAmbiguousTimeoutException, ParsingFailedException, CASMismatchException
from datetime import timedelta
from couchbase.options import ReplaceOptions
from acouchbase.cluster import AsyncCluster, AsyncBucket
import uuid
import os
from datetime import datetime, UTC


CB_Bucket = "DocsBucket"
CB_Scope = "DocsScope"
CB_Docs_Collection = "documents"
CB_Users_Collection = "users"
DATETIME_FORMAT = '%Y-%m-%dT%H:%M:%S%:z'
type DB_Handle = tuple[AsyncCluster, AsyncBucket]

# query_options = QueryOptions(named_parameters={})

async def _safe_shutdown(cluster: AsyncCluster):
    if cluster:
        try:
            await cluster.close()
        except Exception:
            pass

def get_current_timestamp():
    return datetime.now(UTC).astimezone().strftime(DATETIME_FORMAT)

def parse_timestamp(ts_str: str)->datetime:
    return datetime.strptime(ts_str, DATETIME_FORMAT)

async def db_connect() -> DB_Handle:

    endpoint = os.environ['COUCHBASE_ENDPOINT']
    username = os.environ['COUCHBASE_USERNAME']
    password = os.environ['COUCHBASE_PASSWORD']
    # User Input ends here.

    # Connect options - authentication
    auth = PasswordAuthenticator(username, password)
    # Get a reference to our cluster
    options = ClusterOptions(auth)
    # Use the pre-configured profile below to avoid latency issues with your connection.
    options.apply_profile("wan_development")
    cluster = None
    
    try:
        cluster = await AsyncCluster.connect(endpoint, options)
        # Wait until the cluster is ready for use.
        await cluster.wait_until_ready(timedelta(seconds=5))
        docs_bucket = cluster.bucket(CB_Bucket)
        await docs_bucket.on_connect()
        return cluster, docs_bucket
    except UnAmbiguousTimeoutException as ex:
        print(f'Database Server timeout. Database might be shutdown. Details {ex.error_context}')
        await _safe_shutdown(cluster)
        raise(ex)
    except CouchbaseException as ex:
        print(f'Database connection error. Details {ex.error_context}')
        await _safe_shutdown(cluster)
        raise(ex)
    except Exception as ex:
        print(f'Database unknown error. Details {ex}')
        await _safe_shutdown(cluster)
        raise(ex)
    
async def db_disconnect(db_handle: DB_Handle):
    await db_handle[0].close()

async def upsert_user_info(db_handle: DB_Handle, user_id: str, user_name: str, user_email: str):
    db_Scope = db_handle[1].scope(CB_Scope)
    users_collection = db_Scope.collection(CB_Users_Collection)
    user_doc = await users_collection.exists(user_id)
    if not user_doc.exists:
        await users_collection.upsert(user_id, {'name': user_name, 'email':  user_email})

async def get_user_docs(db_handle: DB_Handle, user_id: str):
    try:
        result = db_handle[0].query("\
            SELECT META(ds).id AS doc_id, ds.doc_name, user.name AS owner_name, ds.last_edit \
            FROM DocsBucket.DocsScope.documents ds \
            JOIN DocsBucket.DocsScope.users user \
            ON KEYS ds.owner\
            WHERE ds.owner = $1 OR ANY collab_id in ds.edit_collab SATISFIES collab_id = $2 END", user_id, user_id)
        ret = []
        async for row in result.rows():
            ret.append(row)
        ret.sort(key = lambda x: x['last_edit'], reverse=True)
        
    except ParsingFailedException as ex:
        print('Failed parsing query string, Details: ', ex.error_context)
    return ret

async def check_doc_exists(db_handle: DB_Handle, doc_id: str) -> bool:
    db_Scope = db_handle[1].scope(CB_Scope)
    docs_collection = db_Scope.collection(CB_Docs_Collection)
    doc = await docs_collection.exists(doc_id)
    return doc.exists

'''
doc_id:
        doc_name
        owner
        edit_collab
        clients:
            user_id
            sync_rev_id
            sync_timestamp
        history:
            rev_id
            delta
        head:
            rev_id
            delta <- All deltas combined, new clients use this immediately
'''

async def create_new_doc(db_handle: DB_Handle, user_id: str):
    db_Scope = db_handle[1].scope(CB_Scope)
    docs_collection = db_Scope.collection(CB_Docs_Collection)
    doc_id = str(uuid.uuid4())
    result = await docs_collection.insert(doc_id, {
        'doc_name': 'New Document',
        'owner': user_id,
        'edit_collab': [],
        'clients': [],
        'history': [],
        'head': {'rev_id': 0, 'delta': []},
        'last_edit': get_current_timestamp()})
    # print(result.key)
    return doc_id


async def get_doc_info_masked(db_handle: DB_Handle, doc_id: str, user_id: str):
    db_Scope = db_handle[1].scope(CB_Scope)
    docs_collection = db_Scope.collection(CB_Docs_Collection)
    # TODO change query to get only required from database
    docs_value = await docs_collection.get(doc_id)
    docs_content: dict = docs_value.content_as[dict]
    docs_content = {
        k:v for k,v in docs_content.items() \
            if k in ['doc_name', 'owner', 'edit_collab', 'last_edit']}
    if docs_content['owner'] == user_id:
        return docs_content
    elif user_id in docs_content['edit_collab']:
        return docs_content
    return {}

async def get_doc_info(db_handle: DB_Handle, doc_id: str):
    docs_collection = db_handle[1].scope('DocsScope').collection('documents')
    docs_value = await docs_collection.get(doc_id)
    docs_content: dict = docs_value.content_as[dict]
    return docs_value.cas, docs_content

async def rename_doc(db_handle: DB_Handle, doc_id: str, doc_name: str, user_id: str):
    docs_collection = db_handle[1].scope('DocsScope').collection('documents')
    cas, content = await get_doc_info(db_handle, doc_id)
    if content['owner'] != user_id:
        return False
    content['doc_name'] = doc_name
    # Try 5 times to rename
    for _ in range(5):
        try:
            res = await docs_collection.replace(doc_id, content, ReplaceOptions(cas=cas))
            if res.success: return True
        except CASMismatchException as ex:
            continue
    return False
    
async def try_update_doc(db_handle: DB_Handle, doc_id: str, new_doc, old_cas):
    docs_collection = db_handle[1].scope('DocsScope').collection('documents')
    try:
        res = await docs_collection.replace(doc_id, new_doc, ReplaceOptions(cas=old_cas))
    except CASMismatchException as ex:
        return False
    return True
        
async def get_collab_info(db_handle: DB_Handle, doc_id: str, user_id: str):
    _, content = await get_doc_info(db_handle, doc_id)
    collabs_ids = content['edit_collab']
    collab_info = []
    users_collection = db_handle[1].scope(CB_Scope).collection(CB_Users_Collection)
    for cid in collabs_ids:
        res = await users_collection.get(cid)
        if res.success:
            collab_info.append({'id': cid, **res.content_as[dict]})
        else:
            print('Error: Unknown user ID', cid, 'in collaborator list of doc', doc_id)
    return collab_info

async def edit_collab(db_handle: DB_Handle, doc_id: str, req_user: str, new_user_email: str, remove: bool = False):
    cas, content = await get_doc_info(db_handle, doc_id)
    
    if content['owner'] != req_user: return False
    
    new_user_info = {}
    try:
        result = db_handle[0].query("\
            SELECT META(user).id AS user_id, user.name \
            FROM DocsBucket.DocsScope.users user \
            WHERE user.email = $1", new_user_email)
        async for row in result.rows():
            new_user_info = (row)
            break
    except ParsingFailedException as ex:
        print('Failed parsing query string, Details: ', ex.error_context)
        
    if remove:
        if new_user_info['user_id'] not in content['edit_collab']: return True
        content['edit_collab'].remove(new_user_info['user_id'])
    else:
        if new_user_info['user_id'] in content['edit_collab']: return True
        content['edit_collab'].append(new_user_info['user_id'])
    
    return await try_update_doc(db_handle, doc_id, content, cas)
    

if __name__ == "__main__":

    import dotenv
    dotenv.load_dotenv()
    _cluster = db_connect()
    
    result = _cluster.query("""
        UPDATE DocsBucket.DocsScope.documents doc
        SET doc.last_edit = $1
        RETURNING META(doc).id, doc.last_edit
    """, datetime.now(UTC).astimezone().strftime(DATETIME_FORMAT))
    for row in result.rows():
        print(row)

    # docs_collection = db_Scope.collection(CB_Docs_Collection)

    # # docs_bucket.collection(CB_Docs_Collection).insert("234", {"head":"tail"})

    # result = docs_collection.upsert("324", {"delta": [{"insert": "234"}]})

    # print(result)
    get_user_docs("109476422127426141073")