# Running your own copy of Raya

Raya is [MIT licensed](LICENSE), so you can run your own copy for yourself and the people you work with.
This guide covers configuration, running it locally, tests and deploying.

## Prerequisites

- Docker Desktop (or Docker Engine with the Compose plugin)
- Make
- A Google OAuth client ID ([Google Cloud console](https://console.cloud.google.com/apis/credentials), type *Web application*)
- For development without Docker: Node.js 20+ and [uv](https://docs.astral.sh/uv/) (Python 3.12+)

## Environment variables

Copy each `*.env.example` to the matching `.env` file and fill it in. The `.env` files are git-ignored and
excluded from Docker build contexts.

### `frontend/.env`

```bash
PUBLIC_GOOGLE_CLIENT_ID=        # Google OAuth client ID
INTERNAL_JWT_SECRET=            # Secret for internal SvelteKit, used to sign the login cookie
SHARED_JWT_SECRET=              # Secret shared between frontend and backend
PUBLIC_CONTACT_EMAIL=           # Contact shown on /privacy and /terms (optional)
```

These are runtime only. Docker Compose injects them into the container with `env_file:`. The frontend
reads them through `$env/dynamic/*`, so they're never inlined into the build and the image contains no
secrets. After changing a value, restart the container (`docker compose up -d frontend`); no rebuild
needed. With `npm run dev`, SvelteKit loads them from this file directly.

### `backend/.env`

```bash
POSTGRES_HOST=                  # "postgres" when running via Docker Compose, "localhost" when running the backend outside Docker
POSTGRES_PORT=5432
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
SHARED_JWT_SECRET=              # Must match frontend
MAX_DOCS_PER_USER=2             # Optional: documents each guest account can own (shared docs don't count)
MAX_DOC_CHARS=2000              # Optional: characters per document owned by a guest
```

These are runtime only too: injected by `env_file:` and read with `os.environ`.

### `postgres/postgres.env`

```bash
POSTGRES_USER=                  # Must match backend/.env
POSTGRES_PASSWORD=              # Must match backend/.env
POSTGRES_DB=                    # Must match backend/.env
```

Docker Compose injects these with `env_file:`, and the healthcheck reads them from the container's
environment too. They're only used to create the database on first boot, when the `pgdata` volume is
empty. Changing them later has no effect unless you wipe the volume (`make clean`).

## Running locally

### With Docker

```bash
make build      # build images
make up         # start all services
make dev        # or: build and start with file watching
```

In `make dev`, backend changes under `backend/app` are synced into the container and the backend restarts.
Frontend changes rebuild the frontend image, because the container runs the compiled build.

The app is available at `http://localhost:8000`.

### Without Docker (faster for development)

Keep only the database in Docker:

```bash
docker compose up -d postgres
```

Set `POSTGRES_HOST=localhost` in `backend/.env` (the Postgres port is published to the host), then start
the backend:

```bash
uv run --directory backend uvicorn app.main:app --reload --port 8000 --env-file .env
```

And the frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`, and Vite proxies `/api` requests to the backend.

## Makefile reference

| Command | Description |
|---|---|
| `make build` | Build all Docker images |
| `make up` | Start all containers in the foreground |
| `make up-build` | `make build` then `make up` |
| `make dev` | Build and start with file watching |
| `make rebuild` | Force rebuild from scratch and start |
| `make down` | Stop all containers |
| `make logs` | Tail logs from all services |
| `make ps` | Show running containers |
| `make clean` | Stop containers, remove volumes and dangling images |
| `make test` | Run backend and frontend tests |
| `make upgrade-user EMAIL=…` | Remove the guest limits from an account |

## Tests

```bash
make test
```

This needs `uv`, Node.js, and `npm install` run in `frontend/`. Pytest runs through
`uv run --with pytest`, so it's never installed into `backend/.venv` and stays out of `requirements.txt`.

- The differential test against `quill-delta` runs Node. It's skipped if Node or `frontend/node_modules`
  is missing.
- The database tests need Postgres and are skipped unless `TEST_POSTGRES_DSN` is set. They create tables
  in a temporary schema and drop it afterwards, so they can run against the Docker Compose database:
  ```bash
  cd backend
  TEST_POSTGRES_DSN=postgresql://USER:PASSWORD@localhost:5432/DB uv run --with pytest pytest
  ```

## Deployment

### Environment

Set real values in `frontend/.env`, `backend/.env` and `postgres/postgres.env` before starting. They're
all runtime config, so the same images work in any environment.

When HTTPS ends upstream of Nginx (at a load balancer, Cloudflare and so on), add these lines to the
Nginx `frontend` location block:

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host $http_host;
```

In the Google OAuth client, add your domain to the authorized JavaScript origins, and
`https://<your domain>/auth/callback` to the authorized redirect URIs.

### User types

Every account starts as a `guest`. A guest can own `MAX_DOCS_PER_USER` documents of up to `MAX_DOC_CHARS`
characters each. `known` accounts have no limits. The character limit follows the document's owner, so a
known user's documents are unlimited for everyone editing them.

To make someone a known user (they need to have signed in once):

```bash
make upgrade-user EMAIL=someone@example.com
```

### Privacy policy and terms

The app serves a privacy policy at `/privacy` and terms of service at `/terms`, linked from the sign-in page.

- Set `PUBLIC_CONTACT_EMAIL` in `frontend/.env`, so people know where to send requests such as deleting an account.
- Add both URLs (`https://<your domain>/privacy` and `/terms`) to the Google OAuth consent screen.
- Both pages are written for a small, privately run instance. Review them if you run it differently, for
  example if you add analytics or backups.

### Build and deploy

```bash
make rebuild
```

To update a single service:

```bash
docker compose build frontend
docker compose up -d --no-deps frontend
```

`--no-deps` restarts only the target service without touching the others.
