# Document flow implementation notes

- Public Document routes, local storage, complete-manifest callback and mock/remote adapter are implemented.
- Remote ingest serializes `POST /api/ingest` in snake_case, derives a contained Python-visible `file_path` from `storage_key`, uses the `mvp-global` subject compatibility shim and sends empty `teacher_metadata`.
- TEACHER ownership and ADMIN global access are enforced in both route and service layers.
- Upload writes the generated local file before the document/job transaction and compensates by deleting that file if the transaction fails.
- Ingest dispatch happens after commit. Remote failure marks job/document `FAILED`, retains the original file and returns 503; no durable retry is promised.
- Mock ingest is accepted but still requires the internal callback to make the document `READY`.
- Callback normalizes Python `chunk_manifest` or compatibility alias `chunks`, locks job/document rows, checks `jobId + attemptCount`, acknowledges duplicate/stale callbacks, and persists one complete manifest transactionally. Preview-only manifests remain invalid.
- Hide/unhide/delete use existing operation job types. Mock operations complete immediately; remote operations stay `RUNNING` until callback.
- Hide preserves vectors; delete soft-deletes MySQL metadata and preserves file/history.
- Public DTOs and file responses never expose `storage_key`.

Public reprocess, batching, durable scheduling and parallel generations remain outside MVP.

Visibility uses `action=hide|unhide`; delete uses methods/paths verified against the current snapshot. Release evidence and remaining upstream debt are tracked in the Week 3 readiness document.
