"""In-memory stand-ins for the database and websockets, so DocSyncer can be tested without Postgres."""
import copy
import random

import app.delta as D
import app.postgres_utils as db_utils


class FakeDB:
    """Replaces get_doc_info/try_update_doc with an in-memory table that has the same
    optimistic-concurrency behaviour (version check). update_doc_with_retry, update_client_rev,
    delete_client_rev and prune_history are the real functions running on top of it."""

    def __init__(self, monkeypatch):
        self.docs = {}
        self.writes = 0
        self.conflicts_to_inject = 0
        monkeypatch.setattr(db_utils, 'get_doc_info', self.get_doc_info)
        monkeypatch.setattr(db_utils, 'try_update_doc', self.try_update_doc)

    def add_doc(self, doc_id='doc', text='', rev=0):
        head = {'rev_id': rev, 'delta': [{'insert': text}] if text else []}
        self.docs[doc_id] = {'doc_name': 'Doc', 'owner': 'owner', 'edit_collab': [],
                             'clients': {}, 'history': [], 'head': head,
                             'last_edit': 0, 'version': 0}
        return doc_id

    async def get_doc_info(self, db_handle, doc_id):
        if doc_id not in self.docs:
            raise LookupError(doc_id)
        row = copy.deepcopy(self.docs[doc_id])
        return row.pop('version'), row

    async def try_update_doc(self, db_handle, doc_id, new_doc, old_version, edited=False):
        row = self.docs[doc_id]
        if self.conflicts_to_inject:
            # another writer (e.g. a rename) got in between the read and this write
            self.conflicts_to_inject -= 1
            row['version'] += 1
        if row['version'] != old_version:
            return False
        for key in ('clients', 'history', 'head'):
            row[key] = copy.deepcopy(new_doc[key])
        if edited:
            row['last_edit'] += 1
        row['version'] += 1
        self.writes += 1
        return True

    def text(self, doc_id='doc'):
        return text_of(self.docs[doc_id]['head']['delta'])


class FakeSocket:
    def __init__(self, fail=False):
        self.sent = []
        self.closed_with = None
        self.fail = fail

    async def send_json(self, message):
        if self.fail:
            raise RuntimeError('socket is gone')
        self.sent.append(message)

    async def close(self, code=1000):
        self.closed_with = code

    def of_type(self, type_):
        return [m for m in self.sent if m.get('type') == type_]


def text_of(delta):
    return ''.join(op['insert'] for op in delta if isinstance(op.get('insert'), str))


def normalize(delta):
    """Canonical form of a document, so equal documents compare equal"""
    return D.compose([], copy.deepcopy(delta))


class SimClient:
    """Python twin of frontend/src/lib/sync_client.js (same formulas; app.delta matches quill-delta)."""

    def __init__(self, client_id):
        self.client_id = client_id
        self.A, self.X, self.Y, self.rev = [], [], [], 0
        self.screen = []

    def doc(self):
        return D.compose(D.compose(self.A, self.X), self.Y)

    def init(self, content, rev):
        self.A, self.X, self.Y, self.rev = copy.deepcopy(content), [], [], rev
        self.screen = copy.deepcopy(content)

    def local_change(self, change):
        self.Y = D.compose(self.Y, copy.deepcopy(change))
        self.screen = D.compose(self.screen, copy.deepcopy(change))

    def take_outgoing(self):
        if not self.Y or self.X:
            return None
        self.X, self.Y = self.Y, []
        return copy.deepcopy(self.X), self.rev

    def ack(self, rev):
        self.A = D.compose(self.A, self.X)
        self.X, self.rev = [], rev

    def server_rev(self, B, rev):
        Xn = D.transform(B, self.X, True)
        B_after_X = D.transform(self.X, B, False)
        Yn = D.transform(B_after_X, self.Y, False)
        screen_update = D.transform(self.Y, B_after_X, True)
        self.A = D.compose(self.A, B)
        self.X, self.Y, self.rev = Xn, Yn, rev
        self.screen = D.compose(self.screen, screen_update)


ATTRS = [{'bold': True}, {'italic': True}, {'bold': None}, {'size': 'large'}]


def random_edit(rand: random.Random, doc_len: int, tag: str = ''):
    """Random insert, delete or format on a document of length doc_len"""
    pos = rand.randint(0, doc_len)
    ops = [{'retain': pos}] if pos else []
    r = rand.random()
    if r < 0.55 or pos == doc_len:
        ops.append({'insert': tag + rand.choice('xyz')})
    elif r < 0.8:
        ops.append({'delete': rand.randint(1, min(3, doc_len - pos))})
    else:
        ops.append({'retain': rand.randint(1, doc_len - pos), 'attributes': dict(rand.choice(ATTRS))})
    return ops
