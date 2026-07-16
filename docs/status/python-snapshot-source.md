# Python snapshot source

## Purpose and provenance

`python-service/` is a tracked integration snapshot used by the NodeJS team for compatibility audits, contract checks and integration debugging. The Python/Data-RAG team's separate upstream repository remains the Python source of truth; this snapshot may be stale and may be overwritten by a later refresh.

| Field | Current value |
|---|---|
| Upstream repository | <https://github.com/manh2905/RAG_service> |
| Upstream branch/tag | `Unknown` |
| Upstream commit | `Unknown` |
| Snapshot refreshed | `2026-07-16` |
| Import source | GitHub source archive `RAG_service-master.zip` |
| Snapshot directory | `python-service/` |
| Local Python runtime patches | `None` observed in the latest audit |
| Latest compatibility audit | `2026-07-17` |

The archive is a local ignored import artifact, not a canonical source and not a file to commit.

## Current compatibility blockers

The latest snapshot audit found:

1. Ingest, visibility and delete request schemas do not accept the processing-job `attempt_count`.
2. `services/callback.py::send_callback` replaces `attempt_count` with HTTP callback-delivery retry count.
3. The successful ingest manifest contains `text_preview`, not complete `chunk_text` with matching SHA-256 `content_hash`.
4. Query citations do not return the Qdrant point ID as `vector_node_id`.
5. Python inbound routes do not verify the internal Bearer token.
6. `core/config.py` has a weak development fallback for `INTERNAL_SECRET`; deployment must require an explicit strong secret.

These are observations from this imported snapshot, not claims about the latest upstream state. See the [canonical internal RAG contract](../api/internal-rag-contract.md) for the target boundary and [Week 3 integration readiness](week3-integration-readiness.md) for release gates.

## After each refresh

Update the upstream URL, exact branch/tag/commit, refresh date, import source, local patch status, audit date and blocker list. Follow the [Python snapshot refresh guide](../setup/python-snapshot-refresh.md), and do not infer missing upstream metadata from an archive filename.
