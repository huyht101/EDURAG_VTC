# Python Codex implementation prompt

Bạn đang làm việc trực tiếp trong repository Python RAG service của EDURAG.

## Mục tiêu

Audit runtime Python hiện tại, sau đó chỉ sửa service boundary cần thiết để tương thích contract v0.1 và fixtures trong package handoff này.

Không sửa NodeJS repository hoặc database schema. Không commit, push, stage hoặc tạo PR nếu chưa được yêu cầu.

## Source of truth

1. Python runtime code/tests hiện tại.
2. `01_internal-rag-contract-v0.1.md`.
3. JSON fixtures trong `fixtures/`.
4. `02_required-python-changes.md`.

Khi runtime và contract khác nhau, ghi rõ mismatch trước khi sửa.

## Audit bắt buộc

Đọc tối thiểu:

- `main.py::app`;
- `api/routes.py`;
- `models/schemas.py`;
- `services/ingestion.py`;
- `services/callback.py::send_callback`;
- `services/doc_manager.py`;
- `services/rag_engine.py::process_query`;
- `services/rag_engine.py::_extract_citations`;
- `services/rag_engine.py::_extract_usage`;
- `core/config.py`;
- tests và Docker/env.

## Thay đổi bắt buộc

1. Accept processing `attempt_count` từ ingest/visibility/delete và preserve bất biến trong mọi callback.
2. Không dùng HTTP delivery retry làm `attempt_count`; delivery retry là biến nội bộ riêng.
3. Successful ingest callback trả complete `chunk_manifest` với:
   - `chunk_index`;
   - actual Qdrant UUID point ID qua `chunk_id` hoặc `vector_node_id`;
   - full `chunk_text`;
   - SHA-256 `content_hash`.
4. Citation trả actual Qdrant point ID qua `vector_node_id` cùng source fragment.
5. Mọi inbound NodeJS route verify `Authorization: Bearer <INTERNAL_SECRET>` bằng constant-time comparison.
6. Visibility dùng exact DTO `job_id`, `attempt_count`, `action=hide|unhide`, `callback_url`.
7. Delete dùng `job_id`, `attempt_count`, `callback_url`.
8. Giữ query response:
   - `confidence` dạng `high|medium|low`;
   - no-answer là success và zero citations;
   - usage chỉ dùng metadata thực có.
9. Không yêu cầu teacher/user/email/role metadata; Node gửi `{}`.

## Không làm

- Không sửa Node/database/public API.
- Không thay retrieval quality, prompt strategy, model selection hoặc similarity tuning ngoài điều cần cho boundary.
- Không thêm OCR, PPTX, queue, retry worker, object storage hoặc production infrastructure.
- Không cho Python ghi MySQL.
- Không tạo vector ID giả.
- Không parse/match citation ID bằng doc/page/snippet.

## Tests

Thêm hoặc cập nhật tests cho:

- exact request schemas;
- valid/invalid internal Bearer;
- attempt preservation qua callback delivery retry;
- full manifest and SHA-256;
- citation vector ID;
- visibility/delete DTO;
- query confidence/no-answer/usage;
- fixture compatibility.

Không gọi live Gemini hoặc Qdrant trong unit tests.

Chạy:

- `python -m compileall .`
- test command thực tế của repository.

## Báo cáo cuối

Trả:

1. File/symbol đã audit.
2. Mismatch phát hiện.
3. File tạo/sửa/xóa.
4. Contract changes implemented.
5. Tests và kết quả cụ thể.
6. Git diff summary.
7. Blocker còn lại.
8. Xác nhận không sửa Node/database và không commit/push/stage.
