# Runbook live acceptance Phase 2

Chỉ Owner được chạy. Runbook này không tự cấp quyền dùng provider, mutate canonical data,
đổi IAM, publish pointer hoặc xóa/overwrite immutable release.

## Điều kiện trước khi chạy

- Review và pin exact Node/Python revision; ghi cả hai SHA.
- Dùng Compose project, port, database, uploads volume và Qdrant collection mới, đã xác
  nhận không trùng environment hiện hữu.
- Corpus reader chỉ có Storage Object Viewer; giữ JSON ngoài Git và không in credential.
- Live OCR/embedding/LLM credential đi qua approved secret channel; chỉ ghi provider/model.
- Owner phê duyệt cost, private-document processing và exact digital/scanned/mixed/blank
  fixture.

## Gate 1 — Xác minh release trước mutation

```powershell
npm ci
npm run corpus:verify
npm run corpus:reset -- --dry-run
```

PASS khi release ID/manifest checksum khớp `bootstrap/corpus-release.json`, mọi artifact
checksum/schema/embedding compatibility hợp lệ, và disposable-Qdrant preflight chứng minh
`is_active`, `is_hidden`, `ingest_attempt_key` trước mutation. Dừng khi thiếu lifecycle
payload, target/key/permission/integrity/compatibility không đúng.

## Gate 2 — Isolated restore và health

```powershell
npm run docker:remote:dev
npm run preflight:remote
```

PASS khi MySQL document/chunk, originals và Qdrant point identity/count đồng nhất; local
marker release/checksum khớp dynamic inventory. Không re-ingest để che mismatch.

## Gate 3 — Cross-runtime acceptance

Chạy repository remote acceptance với approved providers. Bao phủ upload →
retrieval-disabled upsert (`is_active=false`, không phải `is_hidden=true`) → callback/ACK/
activate → query/citation/usage → hide/unhide/delete cho digital, scanned, mixed và blank
PDF. Inject pre-ACK failure, post-ACK activation failure và uncertain ACK; xác minh không
có false READY/wrong-attempt activation và exact manual recovery idempotent.

PASS khi citation map đúng document/trustworthy page/source text, scanned page bắt buộc
không biến mất, blank page không thành false OCR failure, usage không âm và provider error
được sanitize. Dừng khi có fallback model/provider, partial success, stale activation,
invalid citation hoặc residual inconsistency.

## Legacy release

Nếu selected release thiếu `is_active` hoặc fail compatibility, không sửa release đó.
Corpus writer chỉ tạo immutable release mới sau Owner approval; upload artifact, read-back,
verify checksum/equivalence và chỉ update pointer sau verification. Private-target guard
phải xác minh Public Access Prevention/IAM. Least-privilege metadata 403 chỉ được dùng
exact-target `GCS_PRIVATE_TARGET_OWNER_ATTESTATION` sau khi Owner kiểm tra Cloud Console;
fallback vẫn fail closed với missing/mismatch, wrong credential, public target hoặc object
collision và không áp dụng cho reader-only identity.

## Cleanup và evidence

- Chỉ lưu sanitized SHA, release ID/checksum, model, count và actual `PASS|FAIL`.
- Chỉ stop/remove exact isolated project và volumes sau khi capture evidence.
- Xác nhận pre-existing containers/networks/volumes, canonical database/originals/Qdrant
  và remote release không đổi.
- Không attach credential, signed URL, private content hoặc raw provider response.
- Ghi provider cost/quota anomaly và residual resource nếu có.
