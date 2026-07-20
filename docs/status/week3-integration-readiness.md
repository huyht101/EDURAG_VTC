# Week 3 integration readiness

## Current status

**WEEK 3 NODEJS/CORE READY FOR INDEPENDENT TEST WITH PORTABLE CORPUS**

Áp dụng cho isolated development topology tại baseline `18ddf20417ab7b214b0bf6eb6d7e03e4f937d706` cùng worktree changes hiện tại. Đây không phải production readiness.

## Implemented

- Public Auth/Profile/Admin, Document, Chat, Citation và basic Dashboard APIs.
- RAG `mock|remote` adapter; internal Bearer hai chiều.
- Upload/shared storage, processing jobs, complete-manifest callback và stale/duplicate guard.
- Chat idempotency với optional `clientRequestId`, immutable citation snapshot và multi-row usage.
- Foreground Docker lifecycle qua `docker:remote:dev`.
- Portable sanitized MySQL + Qdrant corpus, exact-checksum approval, verify/restore/auto-bootstrap.
- Host-side private GCS publish/restore cho exact-approved originals; runtime storage vẫn LOCAL và credential không vào containers.
- Canonical corpus: schema/bundle `1.0.0`, 1 document, 2 chunks, 2 Qdrant points, `gemini-embedding-001` dimension 768; original binary không nằm trong Git.

## Verification evidence

| Gate | Result |
|---|---|
| Syntax/OpenAPI/contract | PASS |
| Part 2 mock regression | PASS |
| Remote preflight and live upload/callback/chat/hide/unhide/delete | PASS, 2026-07-17 |
| Python 3.11 compile/tests without provider calls | PASS |
| Corpus PII/secret/path scan and checksums | PASS |
| Isolated MySQL + Qdrant restore/reconciliation | PASS |
| One restored live query with mapped citation and usage | PASS; no ingest/chunk/point increase |
| Auto-bootstrap empty/existing/partial/required behavior | PASS |
| Foreground controlled shutdown and volume retention | PASS |
| GCS create-only publish + download-back checksum | PASS, 2026-07-21; 1 object, second publish skipped |
| Isolated GCS original restore + document/citation file APIs | PASS, 2026-07-21; second restore skipped |
| Missing-key `auto`/`required` | PASS; auto preserved Chat/citation snapshot, required failed closed |

## Known limitations

- Runtime vẫn là local shared-volume storage; GCS chỉ là one-way original-file distribution, không phải runtime provider hoặc bidirectional sync.
- Không có reader key/object thì file download unavailable nhưng Chat/RAG/citation snapshot vẫn dùng được; reprocess cần upload theo flow hiện tại.
- Failed jobs không có durable queue/scheduler hoặc public retry API.
- Query vẫn dùng provider; live `no_answer` không deterministic.
- Qdrant client `1.14.2` emits compatibility warning với server `1.18.2`; verified integration vẫn PASS.
- Current Python upstream commit chưa được ghi nhận chính xác.

## Python upstream debt

- Upstream explicit internal-secret/Bearer tests và constant-time verification overlay.
- Upstream `google_genai` adapter requirements và embedding output dimension 768.
- Record exact upstream commit và align supported Qdrant client/server versions.

## Next gate

Thành viên NodeJS thứ hai chạy [independent test plan](../testing/week3-remote-test-plan.md) từ fresh clone và ghi evidence đã redact. Setup canonical: [Remote Docker RAG](../setup/remote-rag-e2e.md).
