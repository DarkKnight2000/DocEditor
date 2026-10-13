"""Database helpers. Pure helpers always run; the rest need Postgres and only run when
TEST_POSTGRES_DSN is set, e.g. against the docker-compose database (port 5432 is published):

    TEST_POSTGRES_DSN=postgresql://USER:PASSWORD@localhost:5432/DB uv run --with pytest pytest

Each run creates its tables in a temporary schema from postgres/init.sql and drops it afterwards,
so existing data isn't touched."""
import asyncio
import json
import os
import uuid
from pathlib import Path

import asyncpg
import pytest

import app.postgres_utils as db_utils

INIT_SQL = Path(__file__).resolve().parents[2] / 'postgres' / 'init.sql'
DSN = os.environ.get('TEST_POSTGRES_DSN')


# --- pure helpers -----------------------------------------------------------

@pytest.mark.parametrize('value,ok', [
    (str(uuid.uuid4()), True),
    ('not-a-uuid', False),
    ("1' OR '1'='1", False),
    ('', False),
    (None, False),
])
def test_is_doc_id(value, ok):
    assert db_utils._is_doc_id(value) is ok


def test_prune_history_keeps_revisions_some_client_has_not_seen():
    content = {'clients': {'a': 2, 'b': 4}, 'head': {'rev_id': 5},
               'history': [{'rev_id': r, 'delta': []} for r in range(1, 6)]}
    db_utils.prune_history(content)
    assert [r['rev_id'] for r in content['history']] == [3, 4, 5]


def test_prune_history_with_no_clients_keeps_nothing():
    content = {'clients': {}, 'head': {'rev_id': 5}, 'history': [{'rev_id': 5, 'delta': []}]}
    db_utils.prune_history(content)
    assert content['history'] == []


# --- against Postgres -------------------------------------------------------

needs_db = pytest.mark.skipif(not DSN, reason='set TEST_POSTGRES_DSN to run database tests')


@pytest.fixture(scope='module')
def schema():
    name = f'test_{uuid.uuid4().hex[:12]}'

    async def setup():
        conn = await asyncpg.connect(DSN)
        try:
            await conn.execute(f'CREATE SCHEMA {name}')
            await conn.execute(f'SET search_path TO {name}')
            await conn.execute(INIT_SQL.read_text())
        finally:
            await conn.close()

    async def teardown():
        conn = await asyncpg.connect(DSN)
        try:
            await conn.execute(f'DROP SCHEMA {name} CASCADE')
        finally:
            await conn.close()

    asyncio.run(setup())
    yield name
    asyncio.run(teardown())


@pytest.fixture
def with_pool(schema):
    """Runs an async test body with a pool whose tables live in the temporary schema"""
    def runner(body):
        async def main():
            pool = await asyncpg.create_pool(DSN, min_size=1, max_size=4,
                                             server_settings={'search_path': schema})
            try:
                return await body(pool)
            finally:
                await pool.close()
        return asyncio.run(main())
    return runner


def uid():
    return f'user-{uuid.uuid4().hex[:8]}'


async def email_of(pool, user_id):
    async with pool.acquire() as conn:
        return await conn.fetchval('SELECT email FROM users WHERE user_id = $1', user_id)


@needs_db
def test_migrate_is_idempotent(with_pool):
    async def body(pool):
        await db_utils.migrate(pool)
        await db_utils.migrate(pool)
    with_pool(body)


@needs_db
def test_login_updates_name_and_email_of_the_same_user(with_pool):
    async def body(pool):
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'Old Name', f'{user}@old.test')
        await db_utils.upsert_user_info(pool, user, 'New Name', f'{user}@new.test')
        async with pool.acquire() as conn:
            row = await conn.fetchrow('SELECT name, email FROM users WHERE user_id = $1', user)
        assert (row['name'], row['email']) == ('New Name', f'{user}@new.test')
    with_pool(body)


@needs_db
def test_email_moves_to_the_latest_account_that_logs_in_with_it(with_pool):
    async def body(pool):
        first, second, email = uid(), uid(), f'{uid()}@shared.test'
        await db_utils.upsert_user_info(pool, first, 'First', email)
        # regression: this used to fail with a unique violation (500) and block the login
        await db_utils.upsert_user_info(pool, second, 'Second', email)
        assert await email_of(pool, first) is None
        assert await email_of(pool, second) == email
    with_pool(body)


@needs_db
def test_unverified_email_is_not_stored(with_pool):
    async def body(pool):
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'Someone', None)
        assert await email_of(pool, user) is None
    with_pool(body)


async def make_doc(pool):
    owner, collab = uid(), uid()
    await db_utils.upsert_user_info(pool, owner, 'Owner', f'{owner}@test')
    await db_utils.upsert_user_info(pool, collab, 'Collab', f'{collab}@test')
    doc = await db_utils.create_new_doc(pool, owner, max_docs=10)
    return owner, collab, doc


@needs_db
def test_rename_by_owner(with_pool):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        await db_utils.rename_doc(pool, doc, 'Plan', owner)
        _, content = await db_utils.get_doc_info(pool, doc)
        assert content['doc_name'] == 'Plan'
    with_pool(body)


@needs_db
@pytest.mark.parametrize('who,doc_id,status', [
    ('collab', 'doc', 403),
    ('owner', 'missing', 404),
    ('owner', 'malformed', 404),
])
def test_rename_errors(with_pool, who, doc_id, status):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        target = {'doc': doc, 'missing': str(uuid.uuid4()), 'malformed': 'not-a-uuid'}[doc_id]
        with pytest.raises(db_utils.DocError) as err:
            await db_utils.rename_doc(pool, target, 'x', owner if who == 'owner' else collab)
        assert err.value.status == status
    with_pool(body)


@needs_db
def test_add_and_remove_collaborator(with_pool):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        assert await db_utils.edit_collab(pool, doc, owner, f'{collab}@test') == collab
        assert await db_utils.edit_collab(pool, doc, owner, f'{collab}@test') == collab   # adding twice is fine
        assert (await db_utils.get_doc_info_masked(pool, doc, collab))['edit_collab'] == [collab]
        await db_utils.edit_collab(pool, doc, owner, f'{collab}@test', remove=True)
        assert await db_utils.get_doc_info_masked(pool, doc, collab) == {}
    with_pool(body)


@needs_db
@pytest.mark.parametrize('case,status', [
    ('unknown-email', 404),
    ('owner-adds-self', 400),
    ('not-owner', 403),
    ('malformed-doc', 404),
])
def test_collaborator_errors(with_pool, case, status):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        args = {
            'unknown-email': (doc, owner, 'nobody@test'),
            'owner-adds-self': (doc, owner, f'{owner}@test'),
            'not-owner': (doc, collab, f'{collab}@test'),
            'malformed-doc': ('not-a-uuid', owner, f'{collab}@test'),
        }[case]
        with pytest.raises(db_utils.DocError) as err:
            await db_utils.edit_collab(pool, *args)
        assert err.value.status == status
    with_pool(body)


@needs_db
def test_sync_write_needs_the_current_version_and_leaves_name_alone(with_pool):
    async def body(pool):
        owner, _, doc = await make_doc(pool)
        version, content = await db_utils.get_doc_info(pool, doc)
        await db_utils.rename_doc(pool, doc, 'Renamed meanwhile', owner)   # doesn't bump the version
        content['head'] = {'rev_id': 1, 'delta': [{'insert': 'hi'}]}
        assert await db_utils.try_update_doc(pool, doc, content, version, edited=True)
        assert not await db_utils.try_update_doc(pool, doc, content, version)   # stale version
        _, saved = await db_utils.get_doc_info(pool, doc)
        assert saved['doc_name'] == 'Renamed meanwhile'
        assert saved['head']['delta'] == [{'insert': 'hi'}]
    with_pool(body)


@needs_db
def test_last_edit_only_moves_for_edits(with_pool):
    async def body(pool):
        owner, _, doc = await make_doc(pool)
        _, before = await db_utils.get_doc_info(pool, doc)
        await asyncio.sleep(0.05)
        await db_utils.update_client_rev(pool, doc, 'client1', 0)          # someone opened the doc
        _, opened = await db_utils.get_doc_info(pool, doc)
        assert opened['last_edit'] == before['last_edit']
        await db_utils.update_doc_with_retry(pool, doc, lambda c: None, edited=True)
        _, edited = await db_utils.get_doc_info(pool, doc)
        assert edited['last_edit'] > before['last_edit']
    with_pool(body)


@needs_db
def test_malformed_ids_are_treated_as_missing_docs(with_pool):
    async def body(pool):
        assert await db_utils.get_doc_info_masked(pool, 'not-a-uuid', 'anyone') == {}
        assert not await db_utils.check_doc_exists(pool, 'not-a-uuid')
        with pytest.raises(LookupError):
            await db_utils.get_doc_info(pool, 'not-a-uuid')
    with_pool(body)


@needs_db
def test_document_limit_counts_only_owned_documents(with_pool):
    async def body(pool):
        owner, collab, shared_doc = await make_doc(pool)
        await db_utils.edit_collab(pool, shared_doc, owner, f'{collab}@test')
        # the shared document doesn't count against collab's own limit
        await db_utils.create_new_doc(pool, collab, max_docs=2)
        await db_utils.create_new_doc(pool, collab, max_docs=2)
        with pytest.raises(db_utils.DocError) as err:
            await db_utils.create_new_doc(pool, collab, max_docs=2)
        assert err.value.status == 403 and 'up to 2 documents' in err.value.message
    with_pool(body)


@needs_db
def test_new_users_are_guests_and_login_keeps_the_type(with_pool):
    async def body(pool):
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'New', None)
        assert await db_utils.get_user_type(pool, user) == 'guest'
        async with pool.acquire() as conn:
            await conn.execute("UPDATE users SET user_type = 'known' WHERE user_id = $1", user)
        await db_utils.upsert_user_info(pool, user, 'New name', f'{user}@test')   # signing in again
        assert await db_utils.get_user_type(pool, user) == 'known'
        assert await db_utils.get_user_type(pool, 'nobody') == 'guest'
    with_pool(body)


@needs_db
def test_known_users_have_no_document_limit(with_pool):
    async def body(pool):
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'Known', None)
        async with pool.acquire() as conn:
            await conn.execute("UPDATE users SET user_type = 'known' WHERE user_id = $1", user)
        docs = [await db_utils.create_new_doc(pool, user, max_docs=2) for _ in range(4)]
        assert len(docs) == 4
        assert await db_utils.get_doc_owner_type(pool, docs[0]) == 'known'
    with_pool(body)


@needs_db
def test_user_type_must_be_guest_or_known(with_pool):
    async def body(pool):
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'U', None)
        async with pool.acquire() as conn:
            with pytest.raises(asyncpg.exceptions.CheckViolationError):
                await conn.execute("UPDATE users SET user_type = 'admin' WHERE user_id = $1", user)
    with_pool(body)


@needs_db
def test_document_limit_holds_for_simultaneous_creates(with_pool):
    async def body(pool):
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'Fast clicker', None)
        results = await asyncio.gather(*(db_utils.create_new_doc(pool, user, max_docs=2) for _ in range(6)),
                                       return_exceptions=True)
        created = [r for r in results if isinstance(r, str)]
        assert len(created) == 2
        assert all(isinstance(r, db_utils.DocError) for r in results if not isinstance(r, str))
    with_pool(body)


@needs_db
def test_owner_can_delete_and_frees_a_slot(with_pool):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        await db_utils.edit_collab(pool, doc, owner, f'{collab}@test')
        await db_utils.delete_doc(pool, doc, owner)
        assert not await db_utils.check_doc_exists(pool, doc)
        assert await db_utils.get_user_docs(pool, collab) == []     # gone for collaborators too
        # deleting frees space under the limit
        user = uid()
        await db_utils.upsert_user_info(pool, user, 'U', None)
        first = await db_utils.create_new_doc(pool, user, max_docs=1)
        await db_utils.delete_doc(pool, first, user)
        await db_utils.create_new_doc(pool, user, max_docs=1)
    with_pool(body)


@needs_db
@pytest.mark.parametrize('case,status', [
    ('collaborator', 403),
    ('missing', 404),
    ('malformed', 404),
])
def test_delete_errors(with_pool, case, status):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        await db_utils.edit_collab(pool, doc, owner, f'{collab}@test')
        target, who = {'collaborator': (doc, collab), 'missing': (str(uuid.uuid4()), owner),
                       'malformed': ('not-a-uuid', owner)}[case]
        with pytest.raises(db_utils.DocError) as err:
            await db_utils.delete_doc(pool, target, who)
        assert err.value.status == status
        assert await db_utils.check_doc_exists(pool, doc)          # nothing was deleted
    with_pool(body)


@needs_db
def test_user_docs_say_which_docs_are_owned_and_how_widely_shared(with_pool):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        await db_utils.edit_collab(pool, doc, owner, f'{collab}@test')
        [as_owner] = await db_utils.get_user_docs(pool, owner)
        [as_collab] = await db_utils.get_user_docs(pool, collab)
        assert (as_owner['is_owner'], as_owner['shared_with']) == (True, 1)
        assert as_collab['is_owner'] is False
    with_pool(body)


@needs_db
def test_user_docs_include_shared_docs(with_pool):
    async def body(pool):
        owner, collab, doc = await make_doc(pool)
        await db_utils.edit_collab(pool, doc, owner, f'{collab}@test')
        docs = await db_utils.get_user_docs(pool, collab)
        assert [d['doc_id'] for d in docs] == [doc]
        assert json.dumps(docs)    # result must be JSON-serializable for the API
    with_pool(body)
