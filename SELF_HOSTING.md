# Running your own copy of Raya

Raya is [MIT licensed](LICENSE), so you can run your own copy for yourself and the people you work with.
This guide covers configuration, running it locally, tests and deploying to a server.

## Prerequisites

- Docker Desktop (or Docker Engine with the Compose plugin, version 2.24 or later)
- Make
- A Google account for Google Cloud, to create the OAuth clients for sign-in
- For development without Docker: Node.js 20+ and [uv](https://docs.astral.sh/uv/) (Python 3.12+)

## Development and production

Development and production use separate env files, so the two never share a Google OAuth client, a
secret or a database password:

| Service | Development | Production |
|---|---|---|
| Frontend | `frontend/.env` | `frontend/.env.prod` |
| Backend | `backend/.env` | `backend/.env.prod` |
| Postgres | `postgres/postgres.env` | `postgres/postgres.env.prod` |
| Caddy | (none: plain HTTP) | `caddy/caddy.env.prod` |

Each service has a `*.env.example` to copy from. All of these files are git-ignored and excluded from
Docker build contexts. The production names aren't `.env.production`, so Vite never loads them by itself.

`docker-compose.yml` is the development setup. `docker-compose.prod.yml` is layered on top of it for
production: it switches every service to its `.prod` env file, gives Caddy the domain with ports 80 and 443,
stops publishing the Postgres port, and adds restart policies and log rotation.

The server never builds images: a 1 GB server is slow at it and can run out of memory. Instead, you build
the frontend and backend images on your own computer and push them to Docker Hub, and the server pulls them
(see [Deploying to a server](#deploying-to-a-server)).

### Google sign-in: one OAuth client per environment

Google recommends keeping testing and production apart, ideally as separate Google Cloud projects. Then a
mistake while testing can't affect the client real users sign in with, and each consent screen shows the
right name and domain.

1. In the [Google Cloud console](https://console.cloud.google.com/), create two projects, for example
   **Raya Dev** and **Raya**.
2. In each, configure the OAuth consent screen (Google Auth Platform). Sign-in only uses the basic
   `openid`, `email` and `profile` scopes, so no verification is needed.
   - **Dev:** leave it in *Testing* and add yourself, and anyone else who tests, as test users.
   - **Production:** add the domain, the links to `https://<your domain>/privacy` and `/terms`, then publish
     it (*In production*) so anyone with a Google account can sign in.
3. In each, create an OAuth client ID of type *Web application*:

   | | Authorized JavaScript origins | Authorized redirect URIs |
   |---|---|---|
   | Dev | `http://localhost:5173`, `http://localhost:8000` | `http://localhost:5173/auth/callback`, `http://localhost:8000/auth/callback` |
   | Production | `https://<your domain>` | `https://<your domain>/auth/callback` |

4. Put the dev client ID in `frontend/.env` and the production one in `frontend/.env.prod`, as
   `PUBLIC_GOOGLE_CLIENT_ID`. Sign-in only needs the client ID; the client secret isn't used.

## Environment variables

### `frontend/.env` and `frontend/.env.prod`

```bash
INTERNAL_JWT_SECRET=            # Signs the login cookie
SHARED_JWT_SECRET=              # Signs requests to the backend; must match the backend's
PUBLIC_GOOGLE_CLIENT_ID=        # This environment's Google OAuth client ID (see above)
PUBLIC_CONTACT_EMAIL=           # Contact shown on /privacy and /terms (optional)
```

Generate each secret with `openssl rand -base64 48`, and use different ones in development and production.

These are runtime only. Docker Compose injects them into the container with `env_file:`. The frontend
reads them through `$env/dynamic/*`, so they're never inlined into the build and the image contains no
secrets. After changing a value, restart the container; no rebuild needed. With `npm run dev`, SvelteKit
loads `frontend/.env` directly.

### `backend/.env` and `backend/.env.prod`

```bash
SHARED_JWT_SECRET=              # Must match the frontend's
POSTGRES_HOST=                  # "postgres" inside Docker Compose (always in production), "localhost" for uvicorn
POSTGRES_PORT=5432
POSTGRES_USER=                  # Must match the postgres env file
POSTGRES_PASSWORD=
POSTGRES_DB=
MAX_DOCS_PER_USER=2             # Optional: documents each guest account can own (shared docs don't count)
MAX_DOC_CHARS=2000              # Optional: characters per document owned by a guest
```

These are runtime only too: injected by `env_file:` and read with `os.environ`.

### `postgres/postgres.env` and `postgres/postgres.env.prod`

```bash
POSTGRES_USER=                  # Must match the backend's
POSTGRES_PASSWORD=              # Use a long random password in production
POSTGRES_DB=
```

These are only used to create the database on first boot, when the `pgdata` volume is empty. Changing them
later has no effect unless you wipe the volume (`make clean`, which deletes all data).

### `caddy/caddy.env.prod`

```bash
SITE_ADDRESS=raya.example.com   # The domain to serve; Caddy gets its HTTPS certificate for this name
```

## Running locally

### With Docker

```bash
make build      # build images
make up         # start all services
make dev        # or: build and start with file watching
```

In `make dev`, backend changes under `backend/app` are synced into the container and the backend restarts.
Frontend changes rebuild the frontend image, because the container runs the compiled build.

The app is available at `http://localhost:8000`, through Caddy.

### Without Docker (faster for development)

Keep only the database in Docker:

```bash
docker compose up -d postgres
```

Set `POSTGRES_HOST=localhost` in `backend/.env` (the Postgres port is published to the host in
development), then start the backend:

```bash
uv run --directory backend uvicorn app.main:app --reload --port 8000 --env-file .env
```

And the frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`. In development, it calls the backend at `localhost:8000` directly.

## Makefile reference

Add `PROD=1` to run a command against production, for example `make logs PROD=1`.

| Command | Description |
|---|---|
| `make build` | Build all Docker images |
| `make up` | Start all containers in the foreground |
| `make up-build` | `make build` then `make up` |
| `make dev` | Build and start with file watching (development only) |
| `make rebuild` | Force rebuild from scratch and start |
| `make down` | Stop all containers |
| `make logs` | Tail logs from all services |
| `make ps` | Show running containers |
| `make clean` | Stop containers, **remove volumes (all data)** and dangling images |
| `make test` | Run backend and frontend tests |
| `make push` | Build the frontend and backend images and push them to Docker Hub (on your computer) |
| `make deploy` | Pull the images and start production in the background (on the server) |
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

## Deploying to a server

### 1. Server and domain

- **Server:** a Linux server with Docker Engine, the Compose plugin, Git and Make. A small VPS with
  1 GB of RAM is enough for a few users, since it doesn't build anything.
- **DNS:** point the domain (an `A` record, and `AAAA` for IPv6) at the server.
- **Firewall:** open ports 80 and 443, including UDP 443 for HTTP/3. Caddy uses port 80 to get the
  certificate and to redirect HTTP to HTTPS.
- **Database:** nothing else needs to be reachable from outside. Postgres isn't published in production.

### 2. Docker Hub

The images go through [Docker Hub](https://hub.docker.com). They contain no secrets (everything sensitive
is in the `.prod` env files on the server), so public repositories are fine. The image names come from
`docker-compose.yml`: `rishikaley72/raya-frontend` and `rishikaley72/raya-backend`. To use your own
account, set `IMAGE_PREFIX=<your username>` wherever you run `make push` and `make deploy`.

1. Create two access tokens under Account settings → Personal access tokens: one with *Read & Write*
   access for your computer and one with *Read-only* access for the server.
2. Log in on each machine with its token as the password:
   ```bash
   docker login -u rishikaley72
   ```
3. On your computer, after committing your changes, build and push:
   ```bash
   make push
   ```
   On Windows, MinGW's make is `mingw32-make push`; it works from PowerShell, cmd or Git Bash. The images
   are built for `linux/amd64` and tagged with the commit (e.g. `1a2b3c4`) and `latest`. The first push
   uploads a few hundred MB; later ones only the layers that changed.

### 3. Configure

On the server:

```bash
git clone https://github.com/DarkKnight2000/DocEditor.git
cd DocEditor
cp frontend/.env.example frontend/.env.prod
cp backend/.env.example backend/.env.prod
cp postgres/postgres.env.example postgres/postgres.env.prod
cp caddy/caddy.env.example caddy/caddy.env.prod
```

Fill them in:
- the production Google client ID;
- new secrets (`openssl rand -base64 48`);
- `POSTGRES_HOST=postgres` and a strong database password;
- `SITE_ADDRESS`, your domain.

Keep the files readable only by you, for example `chmod 600 */.env.prod */*.env.prod`.

### 4. Start

```bash
make deploy
```

This pulls the images and starts everything. Caddy then gets a certificate from Let's Encrypt,
and the site is live at `https://<your domain>`. To check on it:

```bash
make ps PROD=1
make logs PROD=1
```

### Updating

On your computer, commit and push the code, then push the images:

```bash
make push
```

On the server:

```bash
git pull
make deploy
```

`git pull` brings the Compose files and config that go with the new images. The backend applies any
database changes itself when it starts.

To go back to an earlier version, or to pin one, deploy its commit's images:

```bash
make deploy TAG=1a2b3c4
```

### Backups

The documents live in the `pgdata` Docker volume. To dump the database to a file:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > raya-$(date +%F).sql
```

Copy dumps off the server, for example with a daily cron job. If you keep backups, mention them in the
privacy policy.

### User types

Every account starts as a `guest`. A guest can own `MAX_DOCS_PER_USER` documents of up to `MAX_DOC_CHARS`
characters each. `known` accounts have no limits. The character limit follows the document's owner, so a
known user's documents are unlimited for everyone editing them.

To make someone a known user (they need to have signed in once):

```bash
make upgrade-user EMAIL=someone@example.com PROD=1
```

### Privacy policy and terms

The app serves a privacy policy at `/privacy` and terms of service at `/terms`, linked from the sign-in page.

- Set `PUBLIC_CONTACT_EMAIL` in `frontend/.env.prod`, so people know where to send requests such as
  deleting an account.
- Add both URLs to the production OAuth consent screen (see above).
- Both pages are written for a small, privately run instance. Review them if you run it differently, for
  example if you add analytics or backups.
