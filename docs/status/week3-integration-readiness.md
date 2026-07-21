# Week 3 integration readiness

## Current status

**NODEJS/CORE CONSOLIDATION COMPLETE — PYTHON/RAG HANDOFF REMAINS**

Baseline code trước consolidation: `8e7c1f620adf1f81387875977a0855b76423168a` cùng worktree changes hiện tại. Đây là development/integration readiness, không phải production readiness.

## Completed

- Public Auth/Profile/Admin, Document, Chat, Citation và Dashboard APIs.
- Remote NodeJS–Python contract, internal Bearer, complete-manifest callback và stale/duplicate guards.
- Optional `clientRequestId`, immutable citation snapshots và multi-row usage.
- Foreground Docker lifecycle và retained volumes.
- Immutable cloud corpus release `v1-be5f3fc5669b25984d2333ca`: sanitized MySQL, Qdrant snapshot, exact-approved original và canonical manifest.
- Reader-only credential được xác minh chỉ có `storage.objects.get/list`; không có create/update/delete.
- Qdrant collection startup validate exact unnamed cosine vector `768`; concurrent create chỉ chấp nhận exact HTTP `409`, sau đó kiểm tra postcondition có bounded retry.
- `qdrant-client==1.17.1` chạy với Qdrant server `1.18.2`, nằm trong một minor version và không còn compatibility warning.
- Legacy pre-release object đã được xóa đúng generation bằng generation-match. Bucket tắt versioning và bật soft delete 7 ngày; object không còn live nhưng còn ở trạng thái soft-deleted trong retention window.
- Mock Compose luôn dùng `RAG_MODE=mock`; remote override là opt-in.
- Public citation chỉ cho chat-session owner, kể cả ADMIN; normal RAG answer bắt buộc có structured citation.
- Auth rate limit, constant-time password-reset verification without mismatch attempts, CORS allowlist, generic unknown `500` và Node/MySQL readiness đã được harden.
- Node CI chỉ chạy non-paid/static/contract/corpus checks.

## Evidence

| Gate | Result |
|---|---|
| Syntax/OpenAPI/contract/corpus tests | PASS |
| Node security consolidation tests | PASS; rate limit/CORS/reset/citation/error sanitization/bcrypt compatibility |
| Part 2 mock regression | PASS |
| Production dependency audit | PASS; 0 vulnerability with `--omit=dev` |
| Canonical GCS inspect/verify | PASS; 3 artifacts, 4,432,575 bytes |
| Independent Reader-only isolated restore | PASS; 1 document, 1 job, 2 chunks, 2 citations, 2 points, 1 original |
| Document/citation original API | PASS; HTTP `200`, checksum verified |
| Retained-volume restart/second restore | PASS; `mysql=0`, `qdrant=0`, original skipped idempotently |
| Qdrant race unit tests | PASS |
| Real two-worker empty-collection startup | PASS; expected `409` followed by compatible postcondition |
| Restored collection startup | PASS; collection reused without mutation |
| Legacy cleanup postcondition | PASS; canonical release still verifies, legacy live object absent |
| Paid provider calls during hardening | 0 |

## Known limitations and follow-up

- Fresh no-key `auto` can start without canonical corpus; existing compatible local volumes remain usable.
- Cloud release is not bidirectional sync. New corpus data requires a new immutable manager publish.
- Runtime still uses local MySQL/Qdrant/uploads; GCS is not a runtime provider.
- Live retrieval/generation was intentionally not rerun in this hardening pass.
- Theo quyết định owner, hai `.rar` mã hóa dưới `secrets/` tiếp tục được track và mật khẩu phân phối ngoài Git. Codex không mở nên không xác minh nội dung/thuật toán/mật khẩu; quyết định không áp dụng cho archive mới.
- Python snapshot changes in `core/database.py`, `main.py`, `requirements.txt` and tests must be upstreamed to the Python repository before the next snapshot refresh.
- Python ingest/callback/citation/usage/durability debt còn mở tại [Python/Data-RAG handoff](../architecture/python-rag-handoff.md); Node không đánh dấu các mục này là fixed.

Next gate: run the [independent test plan](../testing/week3-remote-test-plan.md) on a fresh clone.
