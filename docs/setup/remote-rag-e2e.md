# Remote RAG E2E setup

This guide runs the isolated Week 3 topology defined by `docker-compose.yml` plus `docker-compose.remote.yml`:

- NodeJS/Core and MySQL 8.4;
- the tracked Python integration snapshot;
- one Python-owned Qdrant;
- one shared upload volume, read-write in Node and read-only in Python.

Containers use service names. Node calls `http://rag-service:8000`; Python callbacks use `http://app:5000`. The upload volume is mounted at Node's runtime upload path and at `/shared/uploads`; Node sends only the Python-visible path.

## Required local environment

Copy `.env.example` to the ignored root `.env` for Node/MySQL settings. Provider credentials are loaded from the ignored root file `PythonSevice.env` (or the relative file configured by `PYTHON_ENV_FILE`). It must contain:

- `GOOGLE_API_KEY`;
- `LLAMA_CLOUD_API_KEY`;

The root `.env` still supplies:

- `RAG_INTERNAL_TOKEN` with at least 32 characters; remote Compose injects this same value into Python as `INTERNAL_SECRET` and deliberately overrides a stale or weak snapshot value;
- `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` with the same value for this demo topology.

Never commit or print those values. The current snapshot resolves generation through `GEMINI_LLM_MODEL=models/gemini-3.5-flash` and embeddings through `GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001` with dimension `768`.

## Start and verify

Use a dedicated Compose project. Choose unused host ports if the defaults are occupied.

```powershell
$env:REMOTE_COMPOSE_PROJECT = 'edurag_remote_e2e'
$env:REMOTE_E2E_CONFIRM_ISOLATED = 'true'
docker compose --env-file .env --env-file PythonSevice.env --profile rag -p $env:REMOTE_COMPOSE_PROJECT -f docker-compose.yml -f docker-compose.remote.yml up -d --build
npm run preflight:remote
npm run test:remote
```

`preflight:remote` checks Docker, all four health endpoints, both internal Bearer directions, Qdrant reachability and a write/read probe through the shared volume. It verifies only that provider variables exist; it never prints their values.

`test:remote` uses public/internal HTTP endpoints for ingest, callbacks, chat, hide/unhide/delete and controlled failures. Direct MySQL reads are limited to fixture activation and persistence/rollback assertions in the dedicated test database. Live answer assertions use status, lifecycle, structured citations and persistence rather than exact LLM wording.

## Stop and reset

Normal stop preserves the dedicated data:

```powershell
docker compose --env-file .env --env-file PythonSevice.env --profile rag -p $env:REMOTE_COMPOSE_PROJECT -f docker-compose.yml -f docker-compose.remote.yml down
```

Delete volumes only for the dedicated project after confirming its name:

```powershell
docker compose --env-file .env --env-file PythonSevice.env --profile rag -p $env:REMOTE_COMPOSE_PROJECT -f docker-compose.yml -f docker-compose.remote.yml down -v
```

Do not run the reset command against an existing development or shared project.

## Evidence levels

- Contract tests use mocked HTTP transport.
- A preflight with placeholder provider values proves infrastructure only and must not run the E2E script.
- `REMOTE E2E READY` requires real provider credentials and successful ingest, callback, retrieval, citation, usage and document-operation checks. The isolated topology first reached this state on 2026-07-17; repeat the runner after any snapshot or contract change.

See the [canonical internal contract](../api/internal-rag-contract.md) and the [independent test plan](../testing/week3-remote-test-plan.md).
