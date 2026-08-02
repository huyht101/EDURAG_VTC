# Week 3 integration readiness

> **HISTORICAL / SUPERSEDED.** This file records the Week 3 gate and must not be used as
> current readiness or data-approval status. Use the
> [project handoff](../../PROJECT_HANDOFF.md), [MVP gap matrix](mvp-gap-matrix.md) and
> [issue register](issue-quality-register.md).

## Current status

**NODE CORPUS TOOLING HARDENED — LIVE/CANONICAL CORPUS BLOCKED BY DATA APPROVAL — PYTHON HANDOFF REQUIRED**

Đây là development/integration readiness, chưa production-ready. Lượt hardening hiện tại không publish/restore cloud thật, không ingest/re-embed và không gọi paid provider.

## Implemented in current branch

- Corpus identity v2 bao phủ canonical scoped MySQL data, Qdrant vectors/payload và originals; timestamp/temp path/export order/DDL auto-increment không tham gia identity.
- `auto` chỉ restore khi MySQL/Qdrant/uploads đều `EMPTY`; `PRESENT`/partial/in-progress được giữ, `UNKNOWN/ERROR` không bị coi là empty. `required` vẫn strict; `off` không truy cập cloud.
- Publish dry-run chỉ đọc running stores và metadata privacy của GCS target; không writer lifecycle/snapshot/staging/upload/ACL/pointer mutation. Publish thật create-only, manifest-last, verify-before-pointer và giữ writer pause đến khi kết thúc.
- Restore verify trước apply, chỉ áp dụng trên empty stores, có recovery MySQL/Qdrant/originals và không có implicit force/replace.
- Logout là logout-all bằng concurrency-safe `auth_version`; JWT khóa algorithm/issuer/audience/purpose/sub/jti/version/expiry. Reset token giả bị loại trước bcrypt; token hết hạn cleanup theo bounded batch.
- Internal callback auth chạy trước large JSON parser. Helmet/CORS/rate limits, sanitized error boundary, bounded DB pool/query timeout và graceful shutdown đã có targeted regression.
- DOCX yêu cầu bounded OOXML ZIP members; citation/session ownership và soft-delete behavior fail closed.
- Normal RAG answer bắt buộc structured citation; Node lưu ordered multi-call usage. Stale assistant `PENDING` được conditional terminalize khi cùng idempotency key được retry, không tự gọi paid provider.
- Runtime mock được giữ có chủ đích cho local/Part 2 regression; nó là deterministic stub nhỏ và không fallback từ remote. Remote Python vẫn là integration path chính.

## Evidence

| Gate | Result |
|---|---|
| `test:corpus` | Unit simulation only — fake transport/staged fixtures; validation/rollback/zero cloud mutation |
| `test:corpus:partial` | Phải chạy trên project `edurag_corpus_partial_*` mới; từ chối resource có sẵn và cleanup đúng namespace |
| Approved corpus source | **BLOCKED BY DATA APPROVAL** |
| Canonical `content-v2` release | **BLOCKED BY DATA APPROVAL**; pointer không phải approval |
| Live restore/query/citation | **NOT RUN** trong lượt hiện tại nếu chưa có approved bundle/credential |
| `test:contract` | PASS — Node boundary fixtures/mock transport, không phải remote runtime |
| `test:node-consolidation` | PASS — Node runtime units/local HTTP |
| `test:part2` | PASS — real Node/MySQL HTTP with deterministic RAG mock; includes concurrent idempotency |
| Paid provider calls in current work | 0 |

Full syntax/OpenAPI/docs/audit/Compose verification phải được ghi theo kết quả cuối của worktree, không suy ra từ historical live evidence.

## Open handoff and limitations

- Tracked Python snapshot hiện có UUID5 deterministic, hidden upsert và activate sau machine-readable Node ACK; offline tests đi kèm không thay thế upstream acceptance hoặc live NodeJS → Python → Qdrant verification.
- Các thay đổi snapshot nhỏ ở `services/ingestion.py`, `services/rag_engine.py` và test vẫn phải upstream trước snapshot refresh; snapshot không phải nguồn sở hữu Python.
- Tracked snapshot đã khai báo ordered `usage_calls[]` cho router/answer; tính đúng đắn với provider/runtime thật vẫn là open integration evidence.
- FastAPI `BackgroundTasks` không phải durable queue. Stale processing `RUNNING` chưa được Node tự retry để tránh duplicate points/cost.
- Corpus coordinated recovery không phải distributed transaction. `CORPUS_RESTORE_ROLLBACK_FAILED` cần operator intervention; tool không tự merge partial stores.
- In-memory rate limit chỉ phù hợp single Node instance; multi-instance cần shared store. HSTS phải do trusted HTTPS proxy/deployment quyết định.
- Hai archive `.rar` mã hóa dưới `secrets/` được track theo quyết định owner; password phân phối ngoài Git. Tooling/Docker/Corpus không đọc hoặc package chúng.

Chi tiết: [Python/Data-RAG handoff](../architecture/python-rag-handoff.md), [internal RAG contract](../api/internal-rag-contract.md), [Corpus architecture](../architecture/corpus-portability.md) và [independent test plan](../testing/week3-remote-test-plan.md).
