# Week 3 integration readiness

## Current status

**POST-MIGRATION HARDENING COMPLETE — READY FOR INDEPENDENT RETEST**

Baseline: `c3fa1c7763bb03ba763b09b47677a756bebec535` cùng worktree changes hiện tại. Đây là development/integration readiness, không phải production readiness.

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

## Evidence

| Gate | Result |
|---|---|
| Syntax/OpenAPI/contract/corpus tests | PASS |
| Part 2 mock regression | PASS |
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
- Two tracked `.rar` files under `secrets/` appear credential-related by filename. They were not opened, changed or deleted. Repository owner must verify, revoke/rotate if needed, remove them from Git/history, then run a secret scan. New `.rar` files are ignored.
- Python snapshot changes in `core/database.py`, `main.py`, `requirements.txt` and tests must be upstreamed to the Python repository before the next snapshot refresh.

Next gate: run the [independent test plan](../testing/week3-remote-test-plan.md) on a fresh clone.
