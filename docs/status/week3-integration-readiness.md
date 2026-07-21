# Week 3 integration readiness

## Current status

**CORPUS REMEDIATED — NODEJS SECURITY/RELIABILITY HARDENED — PYTHON HANDOFF REQUIRED**

Đây là development/integration readiness, chưa production-ready. Lượt hardening hiện tại không publish/restore cloud thật, không ingest/re-embed và không gọi paid provider.

## Implemented in current worktree

- Corpus identity v2 bao phủ canonical scoped MySQL data, Qdrant vectors/payload và originals; timestamp/temp path/export order/DDL auto-increment không tham gia identity.
- `auto` chỉ restore khi MySQL/Qdrant/uploads đều `EMPTY`; `PRESENT`/partial/in-progress được giữ, `UNKNOWN/ERROR` không bị coi là empty. `required` vẫn strict; `off` không truy cập cloud.
- Publish dry-run chỉ đọc running stores, không writer lifecycle/snapshot/staging/credential/GCS/pointer mutation. Publish thật create-only, manifest-last, verify-before-pointer và giữ writer pause đến khi kết thúc.
- Restore verify trước apply, chỉ áp dụng trên empty stores, có recovery MySQL/Qdrant/originals và không có implicit force/replace.
- Logout là logout-all bằng concurrency-safe `auth_version`; JWT khóa algorithm/issuer/audience/purpose/sub/jti/version/expiry. Reset token giả bị loại trước bcrypt; token hết hạn cleanup theo bounded batch.
- Internal callback auth chạy trước large JSON parser. Helmet/CORS/rate limits, sanitized error boundary, bounded DB pool/query timeout và graceful shutdown đã có targeted regression.
- DOCX yêu cầu bounded OOXML ZIP members; citation/session ownership và soft-delete behavior fail closed.
- Normal RAG answer bắt buộc structured citation; Node lưu ordered multi-call usage. Stale assistant `PENDING` được conditional terminalize khi cùng idempotency key được retry, không tự gọi paid provider.
- Runtime mock được giữ có chủ đích cho local/Part 2 regression; nó là deterministic stub nhỏ và không fallback từ remote. Remote Python vẫn là integration path chính.

## Evidence

| Gate | Result |
|---|---|
| `test:corpus` | PASS — fake transport/staged fixtures; zero cloud mutation |
| `test:contract` | PASS — Node boundary fixtures/mock transport, không phải remote runtime |
| `test:node-consolidation` | PASS — Node runtime units/local HTTP |
| `test:part2` | PASS — real Node/MySQL HTTP with deterministic RAG mock; includes concurrent idempotency |
| Historical Reader-only GCS restore/API and Qdrant acceptance | PASS ở lượt trước; không chạy lại vì task này cấm cloud mutation/heavy acceptance |
| Paid provider calls in current work | 0 |

Full syntax/OpenAPI/docs/audit/Compose verification phải được ghi theo kết quả cuối của worktree, không suy ra từ historical live evidence.

## Open handoff and limitations

- Python snapshot vẫn upsert retrieval-enabled random point IDs trước Node ACK; callback/partial batch failure có thể để orphan. Cần activation protocol + deterministic retry/cleanup; có thể cần payload/point-ID migration và re-ingest.
- Python overlay nhỏ ở `services/ingestion.py`, `services/rag_engine.py` và test phải upstream trước snapshot refresh; overlay không thay thế upstream acceptance.
- Python hiện chỉ trả một final `usage`; Node đã backward-compatibly hỗ trợ `usage_calls[]`, instrumentation router/answer còn mở.
- FastAPI `BackgroundTasks` không phải durable queue. Stale processing `RUNNING` chưa được Node tự retry để tránh duplicate points/cost.
- Corpus coordinated recovery không phải distributed transaction. `CORPUS_RESTORE_ROLLBACK_FAILED` cần operator intervention; tool không tự merge partial stores.
- In-memory rate limit chỉ phù hợp single Node instance; multi-instance cần shared store. HSTS phải do trusted HTTPS proxy/deployment quyết định.
- Hai archive `.rar` mã hóa dưới `secrets/` được track theo quyết định owner; password phân phối ngoài Git. Tooling/Docker/Corpus không đọc hoặc package chúng.

Chi tiết: [Python/Data-RAG handoff](../architecture/python-rag-handoff.md), [internal RAG contract](../api/internal-rag-contract.md), [Corpus architecture](../architecture/corpus-portability.md) và [independent test plan](../testing/week3-remote-test-plan.md).
