# Cloud corpus portability

Portable corpus là immutable release trên private GCS, không phải database synchronization và không phải runtime cloud storage.

## Thành phần và ownership

- MySQL giữ document/job/chunk mapping, chat history, citation snapshot và usage.
- Qdrant giữ vectors/retrieval payload do Python sở hữu.
- Upload volume giữ original PDF/DOCX/TXT mà NodeJS stream qua public API.
- GCS chỉ phân phối release để phục hồi ba nhóm dữ liệu trên về Docker local.

NodeJS/Python runtime không đọc GCS; chỉ host-side corpus tooling dùng credential. Một máy có thể diverge sau khi upload document mới. Dữ liệu không tự merge hoặc đồng bộ sang máy khác.

## Immutable release và integrity

```text
{GCS_OBJECT_PREFIX}/releases/{releaseId}/
  mysql/corpus.sql.gz
  qdrant/education_docs.snapshot
  documents/{documentId}/{sha256}/{safeFilename}
  manifest.json
```

Artifacts dùng create-only precondition và được download-back verify. `manifest.json` được upload cuối. Toàn bộ package được verify trước khi [`corpus-release.json`](../../bootstrap/corpus-release.json) đổi pointer. Retry cùng release chỉ skip object có metadata/content khớp; collision khác checksum/size phải fail, không overwrite.

Release identity v2 băm canonical scoped MySQL data (gồm chat/messages/citation snapshots/usage, loại `auth_tokens`), nội dung Qdrant gồm vector + payload và checksum/size của mọi original. Identity không dùng export timestamp, temp path, dump order hoặc DDL `AUTO_INCREMENT`; cùng content cho cùng ID, thay đổi bất kỳ scoped store nào cho ID khác. Release v1 cũ vẫn được verify theo manifest cũ để backward compatibility.

Các guard luôn được giữ:

- manifest, artifact SHA-256/size, inventory và compatibility;
- MySQL–Qdrant mapping tại thời điểm export/strict verify;
- document phải `READY`, `VISIBLE` hoặc `HIDDEN`, chưa soft-delete;
- original phải tồn tại và khớp checksum/size trong MySQL;
- path containment và secret/credential scan;
- auth-token rows bị loại khỏi dump;
- restore không ghi đè non-empty/ambiguous local stores.

Release hiện tại là `v1-be5f3fc5669b25984d2333ca`: schema 1.0.0, MySQL 8.4, Qdrant 1.18.2, collection `education_docs`, embedding `gemini-embedding-001` dimension 768; 1 document, 1 job, 2 chunks, 2 citations, 2 points và 1 original.

## Bootstrap modes

| Mode | Hành vi |
|---|---|
| `auto` | Chỉ restore selected release khi cả MySQL business state, Qdrant và uploads đều `EMPTY`. `PRESENT` (kể cả partial/in-progress) được giữ, cảnh báo và không exact-compare. `UNKNOWN/ERROR` không bao giờ bị coi là empty: không restore, trả diagnostic và tiếp tục local startup. |
| `required` | Acceptance mode: selected release/credential/artifacts phải hợp lệ và local non-empty phải khớp exact release. Mismatch fail closed. |
| `off` | Không đọc/restore/so sánh cloud release. Local startup tiếp tục độc lập. |

`auto` chỉ fail hard sau khi restore đã thực sự bắt đầu mà package/integrity/apply/rollback lỗi. Cloud/config/credential unavailable và local-state `UNKNOWN/ERROR` không kích hoạt restore; log stable reason code để operator xử lý. Job/document đang xử lý và partial local stores là `PRESENT`, không bị gọi nhầm là cloud fingerprint corruption và không bị overwrite. `required` vẫn fail với unknown/partial/mismatch.

`auto` không chạy deep exact-release verification mỗi lần dev startup. Dùng `required` hoặc `npm run corpus:verify` khi cần acceptance strict.

## Publish một release mới

Target phải là private/internal. Publish kiểm tra Public Access Prevention/IAM trước upload và chặn public hoặc unverifiable target. Reader credential dùng restore/verify; writer credential mới publish.

```powershell
npm run corpus:publish -- --dry-run
npm run corpus:publish -- --confirm-reviewed
npm run corpus:verify
```

`--dry-run` yêu cầu MySQL/Qdrant hiện đang chạy và chỉ dùng read-only dump/scroll/stat. Nó không start/stop writer, không tạo/xóa Qdrant snapshot, không tạo staging artifact, không đọc credential, không gọi GCS và không đổi pointer hay persistent state. Plan gồm document ID, title/filename, processing/visibility, checksum, size và provisional release ID; final ID chỉ chốt sau frozen export.

`--confirm-reviewed` là xác nhận rõ ràng của operator rằng đã review PII/personal data, credential/secret, quyền chia sẻ và project scope. Đây không phải automated PII scanner. Tool vẫn chạy heuristic secret/path scan và mọi integrity guard nêu trên. Không còn tracked-fixture hoặc approval registry theo `documentId + checksum`.

`--dry-run` không được kết hợp với `--confirm-reviewed`; thiếu confirmation hoặc option lạ đều fail. Publish interruption trước pointer có thể để lại immutable incomplete package làm cleanup candidate, nhưng release hiện hành không đổi và retry không được silently overwrite.

## Restore và giới hạn

Restore download/stage/verify toàn bộ trước apply và chỉ chạy khi local `EMPTY`. Trong apply, tool giữ writer pause, tạo in-memory recovery dump cho empty MySQL state, phục hồi exact empty Qdrant config và xóa đúng originals vừa materialize nếu bước sau thất bại. Đây là coordinated recovery, không phải distributed transaction; rollback failure trả `CORPUS_RESTORE_ROLLBACK_FAILED` và không được tự merge/overwrite tiếp. Không có hidden `--force` hoặc replace-local command; thay corpus phải dùng project/volumes disposable được operator xác nhận ngoài tool.

Restore không ingest, LlamaParse hoặc document-embed lại. Mỗi live query vẫn cần query embedding và có thể cần LLM generation. Thay model/dimension hoặc incompatible pipeline semantics có thể yêu cầu corpus mới.

Private GCS preconditions/checksum: [request preconditions](https://cloud.google.com/storage/docs/request-preconditions), [data validation](https://cloud.google.com/storage/docs/data-validation).
