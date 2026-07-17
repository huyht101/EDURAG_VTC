# Week 3 remote independent test plan

This checklist is for the second NodeJS/Core member to verify a fresh clone independently. It does not authorize production credentials, shared-volume deletion or Python runtime changes.

## Prepare

- Confirm the expected branch/commit and a reviewed worktree.
- Use Node.js 20+, Docker and the tracked `python-service/` snapshot.
- Copy `.env.example` to the single ignored root `.env`. Add `GOOGLE_API_KEY`, `LLAMA_CLOUD_API_KEY` and a 32+ character `RAG_INTERNAL_TOKEN` through the approved secret channel. Do not create a second integrated credential file; remote Compose injects the root token into Python as `INTERNAL_SECRET`.
- Confirm `GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001` and record the resolved Flash generation model name without recording keys.
- Select a unique `REMOTE_COMPOSE_PROJECT` and unused host ports.
- Leave `REMOTE_E2E_CLEANUP=true` so the runner removes only that confirmed isolated project in `finally`.

## Static and mock baseline

```powershell
npm ci
npm run check
npm run test:contract
docker compose config --quiet
docker compose --profile rag -f docker-compose.yml -f docker-compose.remote.yml config --quiet
```

Run `npm run test:part2` only against a disposable, bootstrapped MySQL 8.4 database. Preserve the console output and remove only resources created for that run.

## Live topology

Follow [Remote RAG E2E setup](../setup/remote-rag-e2e.md), then record results for:

- preflight health, Bearer in both directions and shared-volume probe;
- TXT ingest accepted, callback succeeded, document `READY`, complete chunk manifest persisted;
- chunk UUID, full text and matching SHA-256 hash;
- duplicate/stale/mismatched/unauthorized/invalid callbacks and rollback;
- chat answer with `vector_node_id` citation mapping and at least one usage row;
- hide prevents retrieval, unhide restores retrieval, delete prevents retrieval;
- existing citation/history snapshot remains readable after delete;
- Python unavailable and upstream failure do not leave MySQL in a false-success state.

Live `no_answer` is not deterministic; rely on the contract test unless the provider returns it naturally.

## Python snapshot checks

- Build/import with the Python 3.11 Docker target and run `compileall`.
- Run snapshot pytest without provider calls. Report stale tests as upstream debt; do not weaken the Node contract or patch Python merely to make old tests green.
- Confirm no secret, `.env`, upload, Qdrant data, database dump or generated log is staged.

## Completion record

Record command, timestamp, commit, provider/model names (never credentials), PASS/FAIL/BLOCKED status and the first safe error code. For a bug, include expected/actual behavior, the redacted request/response shape and redacted logs. Run the documented isolated cleanup and confirm no upload/log/database dump or secret artifact appears in Git status. `REMOTE E2E READY` requires all real-service lifecycle and persistence checks to pass; mocked HTTP tests are not sufficient.
