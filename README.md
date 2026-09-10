# DocEditor

A real-time collaborative document editor. Multiple users can edit the same document simultaneously with changes synced live via WebSockets.

![DocEditor demo](./frontend/src/lib/assets/demo.gif)

## Stack

| Layer         | Technology                |
|---------------|---------------------------|
| Frontend      | SvelteKit (Node adapter)  |
| Backend       | FastAPI                   |
| Database      | PostgreSQL                |
| Reverse proxy | Nginx                     |
| Auth          | Google Sign-In            |
| Containers    | Docker + Docker Compose   |

## Architecture

```
Browser
   │
   ▼
Nginx :8000
   ├── /api/*  ──────► FastAPI :8000
   │                       │
   │                       ▼
   │                   PostgreSQL :5432
   │
   └── /*      ──────► SvelteKit :3000
```

WebSocket connections (`/api/edit-socket/*`) are routed to FastAPI and kept alive for real-time collaboration.

## Prerequisites

- Docker Desktop
- Make
- Node.js 20+ (for local dev without Docker)
- Python 3.12+ (for local dev without Docker)

## Environment Variables

### `frontend/.env`

```bash
PUBLIC_GOOGLE_CLIENT_ID=        # Google OAuth client ID
INTERNAL_JWT_SECRET=            # Secret for internal SvelteKit, used to encrypt cookies data
SHARED_JWT_SECRET=              # Secret shared between frontend and backend
```

### `backend/.env`

```bash
POSTGRES_HOST=                  # "postgres" when running via Docker Compose, "localhost" when running the backend outside Docker
POSTGRES_PORT=5432
POSTGRES_USER=
POSTGRES_PASSWORD=
POSTGRES_DB=
SHARED_JWT_SECRET=              # Must match frontend
```

### `postgres/postgres.env`

```bash
POSTGRES_USER=                  # Must match backend/.env
POSTGRES_PASSWORD=              # Must match backend/.env
POSTGRES_DB=                    # Must match backend/.env
```

## Running Locally

### With Docker (recommended)

```bash
# Build images
make build

# Start all services
make up

# Or build and start with file watching (hot reload)
make dev
```

App is available at `http://localhost:8000`.

### Without Docker (tested with an older commit)

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`. Vite proxies `/api` requests to the backend.

**Backend**

Requires Postgres to be reachable. Easiest way is to keep just the database in Docker and run the backend directly:

```bash
docker compose up postgres
```

Then, with `POSTGRES_HOST=localhost` set in `backend/.env` (Postgres' container port is published to the host):

```bash
cd backend
uv pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Makefile Reference

| Command           | Description                                           |
|-------------------|-------------------------------------------------------|
| `make build`      | Build all Docker images                               |
| `make up`         | Start all containers detached                         |
| `make dev`        | Build and start with file watching                    |
| `make rebuild`    | Force rebuild from scratch and start                  |
| `make down`       | Stop all containers                                   |
| `make logs`       | Tail logs from all services                           |
| `make ps`         | Show running containers                               |
| `make clean`      | Stop containers, remove volumes and dangling images   |


## Deployment

### Environment

Set real values in `frontend/.env` and `backend/.env` before deploying.

For production with HTTPS terminating upstream (load balancer, Cloudflare etc.), add to the Nginx `frontend` location block:

```nginx
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host $http_host;
```

### Build and deploy

```bash
make rebuild
```

### Updating a single service

```bash
docker compose build frontend
docker compose up -d --no-deps frontend
```

`--no-deps` restarts only the target service without touching others.


## Learning points about Docker

- --env-file argument to docker compose only the ${} inside docker-compose.yml file
- Top-level "env_file:" inside compose.yml are used only during run-time
- "env_file:" inside "build:" are used during build-time
- args: passed to Dockerfile. They are available inside docker process but not reliably for the commands inside RUN.
   - They are supposed to be set as env vars in the process but for consistency in Node projects upgrade them to ENV.
   - For example `vite build` starts a new process, and it doesnt see ARGS. It sees ENV because it is the same system.
   - For some reason, `vite build` is ok to have private env vars as ARG but needs public env vars as ENV
   - From what I understand, ARG are env vars inside the container build process.
- environment: List each env var instead of Top-level "env_file:"

- init.sql placed at specific location is loaded only once during build. Not during every run.
  - Expected place to create databases during build.
  - This is executed during the runtime. So need env vars. Executed only on first boot/run
- AI response for the Postgres build and boot process
```
Right — for Postgres there's no build step involved at all in the first place, since your compose file uses image: postgres:18.6-alpine3.24 (a pre-built image pulled from Docker Hub), not build:. There's no Dockerfile being compiled for this service, so "build time" isn't even part of this picture the way it is for your frontend/backend.

What actually happens is entirely at container startup:

docker compose up starts a container from that image.
The image's entrypoint script (docker-entrypoint.sh, baked into the postgres image itself) runs first, before Postgres itself starts.
That script checks whether /var/lib/postgresql/data (your pgdata volume) is empty.
If empty (first-ever boot, or a wiped volume): it reads POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB from the container's environment (however they got there — environment:, env_file:, doesn't matter, both are runtime injection either way) and runs initdb to create a brand-new database cluster with that user/password/database.
If not empty (volume already has data from a previous run): the entrypoint script skips initdb entirely and just starts Postgres against the existing data. At this point, POSTGRES_USER/PASSWORD/DB are read but ignored for bootstrapping purposes — the role and database already exist from whenever they were first created, with whatever password was set back then.
```