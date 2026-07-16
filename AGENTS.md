# Repository instructions

- Repository root is the NodeJS/Core project and owns Node business semantics, MySQL persistence and public APIs.
- `python-service/` is a tracked, periodically refreshed integration snapshot from the Python/Data-RAG team's separate upstream repository. Treat it as read-only reference by default; it may be overwritten by the next refresh.
- Do not broadly refactor, rename, reformat or patch Python runtime merely to make Node contract tests pass. Audit, compile, run tests and compare contracts without changing Python unless the prompt explicitly authorizes a narrowly scoped patch.
- Light snapshot edits are limited to requested metadata, ignore/hygiene or integration documentation. Prefer root documentation because snapshot-local files may be replaced.
- If changing Python `.py`, requirements, Dockerfile, Compose or tests is explicitly required, keep the smallest diff, report exact files/symbols and state that the change must be upstreamed to the Python repository.
- Do not delete or replace the whole snapshot unless explicitly requested. Never copy a nested `.git`, `.env`, secret, venv, cache, Qdrant data or source ZIP into Git.
- Do not change the database schema, Node public API or ownership rules to accommodate a Python mismatch.
- Python must not write MySQL. NodeJS must not access Qdrant.
