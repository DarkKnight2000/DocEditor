# DocEditor

A real-time collaborative document editor. Multiple users can edit the same document simultaneously with changes synced live via WebSockets.

![DocEditor demo](./demo.gif)

## Stack

| Layer         | Technology                |
|---------------|---------------------------|
| Frontend      | SvelteKit (Node adapter)  |
| Backend       | FastAPI                   |
| Database      | Couchbase                 |
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
   │                   Couchbase
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
COUCHBASE_URL=
COUCHBASE_USERNAME=
COUCHBASE_PASSWORD=
SHARED_JWT_SECRET=              # Must match frontend
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

### Without Docker

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`. Vite proxies `/api` requests to the backend.

**Backend**

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