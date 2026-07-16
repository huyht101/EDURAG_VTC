# Refresh the Python integration snapshot

`python-service/` is a tracked integration snapshot. The Python/Data-RAG team's separate upstream repository is the Python source of truth.

## Refresh workflow

1. Agree with the Python team on the upstream repository and exact commit/tag to import.
2. Obtain that source without its `.git` directory.
3. Replace the contents under stable folder `python-service/`; flatten a single archive wrapper if necessary.
4. Do not import `.env`, secrets, venvs, caches, Qdrant data, downloaded models, uploads or the source ZIP.
5. Preserve/import upstream source, tests, requirements, Dockerfile, Compose and service docs as snapshot evidence.
6. Review the Git diff and distinguish:
   - upstream snapshot changes;
   - any Node compatibility overlay already present.
7. Assume every local Python patch can be overwritten. Upstream necessary fixes before the next refresh.
8. Re-audit routes, Pydantic schemas, processing attempt, callback manifest, citation IDs, usage and internal auth.
9. Run available checks:

   ```powershell
   python -m compileall python-service
   python -m pytest python-service/tests -q
   npm run test:contract
   npm run check
   ```

   Do not install large dependencies or call live Gemini/Qdrant merely to refresh the snapshot.

10. Update [`week3-integration-readiness.md`](../status/week3-integration-readiness.md) and the canonical [internal contract](../api/internal-rag-contract.md) when observed capability changes.
11. Check Markdown links, ignored artifacts, nested `.git` and `git diff --check`.
12. When possible, commit a snapshot refresh separately from Node feature changes and record the imported upstream commit in the commit message/status document.

Never modify Node database schema or public API to hide a snapshot mismatch.
