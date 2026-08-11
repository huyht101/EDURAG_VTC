# Metadata snapshot tích hợp Python RAG

## Nguồn gốc snapshot

Nhóm Python/Data-RAG sở hữu upstream riêng. `python-service/` là tracked integration
snapshot phục vụ audit/debug contract; snapshot có thể stale hoặc bị overwrite khi
refresh.

| Metadata | Giá trị hiện hành |
|---|---|
| Upstream repository | <https://github.com/manh2905/RAG_service> |
| Branch/tag | `UNKNOWN` |
| Upstream commit | `UNKNOWN` |
| Snapshot refresh được ghi | 2026-07-21; chưa có exact upstream export metadata |
| Node-side static/offline audit | 2026-08-02 và các lần đối chiếu documentation sau đó |
| Local integration overlay | Có; phải upstream trước lần refresh kế tiếp |

Không suy upstream SHA từ lịch sử merge của repository Node. Snapshot-local README/docs
là evidence của bản copy, không thay [internal RAG contract](../api/internal-rag-contract.md).

## Khả năng quan sát trong snapshot

- FastAPI app với ingest, query, visibility, delete và public health route.
- Internal Bearer cho business routes; shared-file ingest và authenticated callback.
- Complete manifest với UUID point ID, full text/hash và processing attempt.
- Qdrant point ID được trả làm citation `vector_node_id`.
- Query nhận bounded history/correlation và trả answer/no-answer/citation/usage.
- Exact-attempt retrieval-disabled upsert/ACK/activation, OCR guard, citation parser và
  recovery helpers tồn tại trong snapshot ở mức được Python handoff mô tả.

Đây là `OBSERVED IN SNAPSHOT`, không tự chứng minh upstream delivery hoặc deployed/live
behavior.

## Overlay và giới hạn

Các overlay material gồm internal auth, Gemini dependency/dimension alignment, Qdrant
collection compatibility/race guard, embedding count validation, structured grounding,
OCR/parser guards, exact-attempt lifecycle, Markdown citation handling và evaluator
safety. Danh sách acceptance/action canonical nằm tại
[Python/Data-RAG handoff](python-rag-handoff.md).

`BackgroundTasks` không phải durable queue. Node team không sở hữu retrieval quality,
prompt/model tuning hoặc Python release. Sau mỗi import, làm theo
[quy trình refresh](../setup/python-snapshot-refresh.md) và ghi exact upstream revision.
