# Required Python changes

Chỉ sửa Python boundary cần thiết.

## 1. Preserve processing attempt

Affected symbols:

- `models/schemas.py::IngestRequest`
- `models/schemas.py::VisibilityRequest`
- `models/schemas.py::DeleteRequest`
- `models/schemas.py::CallbackPayload`
- `services/callback.py::send_callback`

Accept `attempt_count` from Node and preserve it unchanged through progress/terminal callbacks. HTTP delivery retry phải dùng biến/field riêng, không ghi đè processing attempt.

## 2. Complete chunk manifest

Affected symbols:

- `models/schemas.py::ChunkManifestItem`
- `services/ingestion.py::ingest_document_background`
- `services/callback.py::send_succeeded_ingest`

Mỗi `chunk_manifest` item cần:

- `chunk_index`;
- UUID `chunk_id` hoặc `vector_node_id`;
- full `chunk_text`;
- SHA-256 `content_hash` của exact UTF-8 `chunk_text`.

Không dùng `text_preview` thay full text.

## 3. Citation vector ID

Affected symbols:

- `models/schemas.py::Citation`
- `services/rag_engine.py::_extract_citations`

Return Qdrant point ID as `vector_node_id` together with `snippet`. Không tạo ID mới và không suy ra từ doc/page/text.

## 4. Inbound Bearer authentication

Affected symbols:

- `api/routes.py`
- `core/config.py`

Require `Authorization: Bearer <INTERNAL_SECRET>` for ingest/query/visibility/delete. Use constant-time comparison and return 401 for missing/invalid token. Never log token.

## 5. Exact visibility/delete DTO

- Visibility: `job_id`, processing `attempt_count`, `action=hide|unhide`, `callback_url`.
- Delete: `job_id`, processing `attempt_count`, `callback_url`.

Keep current methods and paths.

## Security note

Node sends `teacher_metadata: {}` because Python currently copies every metadata key into Qdrant. Do not require identity/authorization PII in the vector payload.
