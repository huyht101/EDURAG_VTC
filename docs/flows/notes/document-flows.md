# Document flow implementation notes

- Public Document routes, local storage, complete-manifest callback and mock/remote adapter are implemented.
- Remote ingest serializes `POST /api/ingest` in snake_case, derives a contained Python-visible `file_path` from `storage_key`, and uses the `mvp-global` subject compatibility shim.
- TEACHER ownership and ADMIN global access are enforced in both route and service layers.
- Upload writes the generated local file before the document/job transaction and compensates by deleting that file if the transaction fails.
- Ingest dispatch happens after commit. Remote failure marks job/document `FAILED`, retains the original file and returns 503; no durable retry is promised.
- Mock ingest is accepted but still requires the internal callback to make the document `READY`.
- Callback normalizes snake_case at the boundary, locks job/document rows, checks `jobId + attemptCount`, acknowledges duplicate/stale callbacks, and persists one complete manifest transactionally. Preview-only manifests remain invalid.
- Hide/unhide/delete use existing operation job types. Mock operations complete immediately; remote operations stay `RUNNING` until callback.
- Hide preserves vectors; delete soft-deletes MySQL metadata and preserves file/history.
- Public DTOs and file responses never expose `storage_key`.

Public reprocess, batching, durable scheduling and parallel generations remain outside MVP.

Python must still fix processing-attempt semantics, emit full manifest fields and verify inbound internal Bearer. Visibility/delete async request details remain provisional.
