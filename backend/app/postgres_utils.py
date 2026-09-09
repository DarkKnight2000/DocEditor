import asyncpg
import uuid
import os
import json
from datetime import datetime, UTC

DATETIME_FORMAT = '%Y-%m-%dT%H:%M:%S%:z'

# A single asyncpg pool stands in for the old (cluster, bucket) tuple.
type DB_Handle = asyncpg.Pool


class CASMismatchException(Exception):
    """Raised when an optimistic-concurrency check (version match) fails."""
    pass


def _to_serializable(value):
    """Recursively convert asyncpg-native types (UUID, datetime, etc.) into
    plain JSON-serializable equivalents, so callers can json.dumps() results
    from this module directly without needing a custom encoder."""
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _to_serializable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_serializable(v) for v in value]
    return value


def _row_to_dict(row: asyncpg.Record) -> dict:
    return _to_serializable(dict(row))


def get_current_timestamp():
    return datetime.now(UTC).astimezone().strftime(DATETIME_FORMAT)


def parse_timestamp(ts_str: str) -> datetime:
    return datetime.strptime(ts_str, DATETIME_FORMAT)


async def db_connect(retries: int = 10, delay: float = 1.5) -> DB_Handle:
    dsn = os.environ.get('POSTGRES_DSN')
    if not dsn:
        host = os.environ['POSTGRES_HOST']
        port = os.environ.get('POSTGRES_PORT', '5432')
        user = os.environ['POSTGRES_USER']
        password = os.environ['POSTGRES_PASSWORD']
        database = os.environ.get('POSTGRES_DB', 'docsdb')
        dsn = f'postgresql://{user}:{password}@{host}:{port}/{database}'

    last_error = None
    for attempt in range(1, retries + 1):
        try:
            pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=10, command_timeout=5)
            async with pool.acquire() as conn:
                await conn.execute('SELECT 1')
            return pool
        except (OSError, asyncpg.exceptions.CannotConnectNowError,
                asyncpg.exceptions.ConnectionDoesNotExistError) as ex:
            last_error = ex
            print(f'Database not ready yet (attempt {attempt}/{retries}): {ex}')
            await asyncio.sleep(delay)

    print(f'Database unreachable after {retries} attempts. Last error: {last_error}')
    raise last_error


async def db_disconnect(db_handle: DB_Handle):
    await db_handle.close()


# ---------------------------------------------------------------------------
# Schema (run once, e.g. via a migration tool):
#
# CREATE TABLE users (
#     user_id    TEXT PRIMARY KEY,
#     name       TEXT NOT NULL,
#     email      TEXT NOT NULL UNIQUE
# );
#
# CREATE TABLE documents (
#     doc_id      UUID PRIMARY KEY,
#     doc_name    TEXT NOT NULL DEFAULT 'New Document',
#     owner       TEXT NOT NULL REFERENCES users(user_id),
#     edit_collab TEXT[] NOT NULL DEFAULT '{}',
#     clients     JSONB NOT NULL DEFAULT '{}',
#     history     JSONB NOT NULL DEFAULT '[]',
#     head        JSONB NOT NULL DEFAULT '{"rev_id": 0, "delta": []}',
#     last_edit   TIMESTAMPTZ NOT NULL DEFAULT now(),
#     version     BIGINT NOT NULL DEFAULT 0
# );
#
# The `version` column plays the role Couchbase's CAS token played: every
# update bumps it, and updates are conditioned on the caller having read the
# version they intend to overwrite (see try_update_doc below).
# ---------------------------------------------------------------------------


async def upsert_user_info(db_handle: DB_Handle, user_id: str, user_name: str, user_email: str):
    async with db_handle.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO users (user_id, name, email)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO NOTHING
            ''',
            user_id, user_name, user_email
        )


async def get_user_docs(db_handle: DB_Handle, user_id: str):
    ret = []
    try:
        async with db_handle.acquire() as conn:
            rows = await conn.fetch(
                '''
                SELECT ds.doc_id AS doc_id, ds.doc_name, u.name AS owner_name, ds.last_edit
                FROM documents ds
                JOIN users u ON u.user_id = ds.owner
                WHERE ds.owner = $1 OR $1 = ANY(ds.edit_collab)
                ''',
                user_id
            )
        ret = [_row_to_dict(row) for row in rows]
        ret.sort(key=lambda x: x['last_edit'], reverse=True)
    except asyncpg.exceptions.PostgresSyntaxError as ex:
        print('Failed parsing query string, Details: ', ex)
    return ret


async def check_doc_exists(db_handle: DB_Handle, doc_id: str) -> bool:
    async with db_handle.acquire() as conn:
        row = await conn.fetchrow('SELECT 1 FROM documents WHERE doc_id = $1', doc_id)
    return row is not None


'''
doc_id:
        doc_name
        owner
        edit_collab
        clients:
            user_id:
                sync_rev_id
        history:
            rev_id
            delta
        head:
            rev_id
            delta <- All deltas combined, new clients use this immediately
'''


async def create_new_doc(db_handle: DB_Handle, user_id: str):
    doc_id = str(uuid.uuid4())
    async with db_handle.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO documents
                (doc_id, doc_name, owner, edit_collab, clients, history, head, last_edit, version)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 0)
            ''',
            doc_id, 'New Document', user_id, [], json.dumps({}), json.dumps([]),
            json.dumps({'rev_id': 0, 'delta': []})
        )
    return doc_id


async def get_doc_info_masked(db_handle: DB_Handle, doc_id: str, user_id: str):
    async with db_handle.acquire() as conn:
        row = await conn.fetchrow(
            'SELECT doc_name, owner, edit_collab, last_edit FROM documents WHERE doc_id = $1',
            doc_id
        )
    if row is None:
        return {}
    docs_content = _row_to_dict(row)
    if docs_content['owner'] == user_id:
        return docs_content
    elif user_id in (docs_content['edit_collab'] or []):
        return docs_content
    return {}


async def get_doc_info(db_handle: DB_Handle, doc_id: str):
    async with db_handle.acquire() as conn:
        row = await conn.fetchrow(
            '''
            SELECT doc_name, owner, edit_collab, clients, history, head, last_edit, version
            FROM documents WHERE doc_id = $1
            ''',
            doc_id
        )
    if row is None:
        raise LookupError(f'No document found with id {doc_id}')
    content = dict(row)
    version = content.pop('version')
    # clients/history/head come back as JSON text from asyncpg unless a codec
    # is registered; decode them here so callers see plain dict/list, as before.
    for key in ('clients', 'history', 'head'):
        if isinstance(content[key], str):
            content[key] = json.loads(content[key])
    # owner/edit_collab are already plain text; last_edit (datetime) is the
    # only field here needing conversion so the result is JSON-serializable.
    content = _to_serializable(content)
    return version, content


async def rename_doc(db_handle: DB_Handle, doc_id: str, doc_name: str, user_id: str):
    version, content = await get_doc_info(db_handle, doc_id)
    if content['owner'] != user_id:
        return False
    content['doc_name'] = doc_name
    # Try 5 times to rename
    for _ in range(5):
        try:
            success = await try_update_doc(db_handle, doc_id, content, version)
            if success:
                return True
        except CASMismatchException:
            version, content = await get_doc_info(db_handle, doc_id)
            if content['owner'] != user_id:
                return False
            content['doc_name'] = doc_name
            continue
    return False


async def try_update_doc(db_handle: DB_Handle, doc_id: str, new_doc, old_version):
    async with db_handle.acquire() as conn:
        result = await conn.execute(
            '''
            UPDATE documents
            SET doc_name = $1,
                owner = $2,
                edit_collab = $3,
                clients = $4,
                history = $5,
                head = $6,
                last_edit = now(),
                version = version + 1
            WHERE doc_id = $7 AND version = $8
            ''',
            new_doc['doc_name'], new_doc['owner'], new_doc['edit_collab'],
            json.dumps(new_doc['clients']), json.dumps(new_doc['history']), json.dumps(new_doc['head']),
            doc_id, old_version
        )
    # asyncpg returns a string like "UPDATE 1" or "UPDATE 0"
    updated = result.split()[-1] == '1'
    return updated


async def update_client_rev(db_handle: DB_Handle, doc_id: str, user_id: str, rev_id: str):
    version, content = await get_doc_info(db_handle, doc_id)
    content['clients'][user_id] = rev_id

    # delete old history behind all clients
    min_rev_id = min(content['clients'].values()) if len(content['clients']) else content['head']['rev_id']
    content['history'] = [i for i in content['history'] if i['rev_id'] >= min_rev_id]
    return await try_update_doc(db_handle, doc_id, content, version)


async def delete_client_rev(db_handle: DB_Handle, doc_id: str, user_id: str):
    version, content = await get_doc_info(db_handle, doc_id)
    del content['clients'][user_id]

    # delete old history behind all clients
    min_rev_id = min(content['clients'].values()) if len(content['clients']) else content['head']['rev_id']
    content['history'] = [i for i in content['history'] if i['rev_id'] >= min_rev_id]
    return await try_update_doc(db_handle, doc_id, content, version)


async def get_collab_info(db_handle: DB_Handle, doc_id: str, user_id: str):
    _, content = await get_doc_info(db_handle, doc_id)
    collabs_ids = content['edit_collab']
    collab_info = []
    async with db_handle.acquire() as conn:
        for cid in collabs_ids:
            row = await conn.fetchrow('SELECT name, email FROM users WHERE user_id = $1', cid)
            if row is not None:
                collab_info.append({'id': cid, **_row_to_dict(row)})
            else:
                print('Error: Unknown user ID', cid, 'in collaborator list of doc', doc_id)
    return collab_info


async def edit_collab(db_handle: DB_Handle, doc_id: str, req_user: str, new_user_email: str, remove: bool = False):
    version, content = await get_doc_info(db_handle, doc_id)

    if content['owner'] != req_user:
        return False, None

    new_user_info = {}
    try:
        async with db_handle.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT user_id, name FROM users WHERE email = $1', new_user_email
            )
        if row is not None:
            new_user_info = _row_to_dict(row)
    except asyncpg.exceptions.PostgresSyntaxError as ex:
        print('Failed parsing query string, Details: ', ex)

    if not new_user_info:
        return False, None

    if remove:
        if new_user_info['user_id'] not in content['edit_collab']:
            return True, new_user_info['user_id']
        content['edit_collab'].remove(new_user_info['user_id'])
    else:
        if new_user_info['user_id'] in content['edit_collab']:
            return True, new_user_info['user_id']
        content['edit_collab'].append(new_user_info['user_id'])

    success = await try_update_doc(db_handle, doc_id, content, version)
    return success, new_user_info['user_id']


if __name__ == "__main__":
    import asyncio
    import dotenv
    dotenv.load_dotenv()

    async def _main():
        pool = await db_connect()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                '''
                UPDATE documents
                SET last_edit = now()
                RETURNING doc_id, last_edit
                '''
            )
            for row in rows:
                print(dict(row))

        docs = await get_user_docs(pool, "109476422127426141073")
        print(docs)
        await db_disconnect(pool)

    asyncio.run(_main())