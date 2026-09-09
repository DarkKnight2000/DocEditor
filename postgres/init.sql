-- init.sql
-- Automatically executed by the official postgres image on first startup
-- (any *.sql file mounted into /docker-entrypoint-initdb.d/ runs once,
-- only when the data directory is empty).

CREATE TABLE IF NOT EXISTS users (
    user_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS documents (
    doc_id      UUID PRIMARY KEY,
    doc_name    TEXT NOT NULL DEFAULT 'New Document',
    owner       TEXT NOT NULL REFERENCES users(user_id),
    edit_collab TEXT[] NOT NULL DEFAULT '{}',
    clients     JSONB NOT NULL DEFAULT '{}',
    history     JSONB NOT NULL DEFAULT '[]',
    head        JSONB NOT NULL DEFAULT '{"rev_id": 0, "delta": []}',
    last_edit   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     BIGINT NOT NULL DEFAULT 0
);

-- Speeds up get_user_docs (owner lookup and collaborator-array membership)
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner);
CREATE INDEX IF NOT EXISTS idx_documents_edit_collab ON documents USING GIN (edit_collab);