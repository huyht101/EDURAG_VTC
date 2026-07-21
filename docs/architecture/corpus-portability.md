# Cloud corpus portability

Portable corpus là một immutable release trên private GCS, không phải database synchronization và không phải runtime cloud storage.

## Data ownership

- MySQL giữ document/job/chunk mapping, chat history, citation snapshots và usage.
- Qdrant giữ vectors/retrieval payload do Python sở hữu.
- Upload volume giữ original PDF/DOCX/TXT mà NodeJS stream qua public API.
- GCS chỉ lưu và phân phối release để phục hồi ba nhóm dữ liệu trên vào local Docker volumes.

NodeJS/Python runtime không đọc GCS. Chỉ host-side corpus tooling dùng credential. Vì retrieval cần cả MySQL mapping và Qdrant points, chỉ dump hoặc chỉ snapshot đều không đủ.

## Immutable release

Object layout:

```text
{GCS_OBJECT_PREFIX}/releases/{releaseId}/
  mysql/corpus.sql.gz
  qdrant/education_docs.snapshot
  documents/{documentId}/{sha256}/{safeFilename}
  manifest.json
```

Mọi upload dùng create-only precondition. Data artifacts được upload và download-back verify trước; `manifest.json` luôn upload cuối. Release thiếu manifest là incomplete và không được restore. Object tồn tại cùng checksum/size được skip; khác metadata/content thì fail, không overwrite hoặc delete.

Canonical manifest trên GCS chứa artifact SHA-256/size, document/storage mapping, expected counts, inventory và compatibility. Git chỉ giữ [default release pointer](../../bootstrap/corpus-release.json), không giữ duplicate manifest/dump/snapshot/original binary.

Release hiện tại:

- ID `v1-be5f3fc5669b25984d2333ca`;
- schema `1.0.0`, MySQL 8.4, Qdrant 1.18.2;
- collection `education_docs`;
- embedding `gemini-embedding-001`, dimension 768;
- 1 document, 1 processing job, 2 chunks, 2 citations và 2 Qdrant points;
- 1 exact-approved original document;
- 4,432,575 bytes artifact payload (MySQL gzip 6,412; Qdrant snapshot 411,136; original 4,015,027), chưa tính manifest nhỏ.

Approval nằm tại [`corpus-approved-documents.json`](../../bootstrap/corpus-approved-documents.json), khóa document ID và SHA-256; không phải wildcard. Document/checksum mới phải qua data-owner review.

## Canonical commands

```powershell
npm run corpus:inspect
npm run corpus:publish
npm run corpus:restore
npm run corpus:verify
```

- `inspect`: read-only config/pointer/remote/local state.
- `publish`: manager-only; xuất source corpus đã approve, reconcile MySQL–Qdrant, tạo release và publish manifest-last.
- `restore`: download/verify toàn bộ release trước mutation; restore MySQL/Qdrant vào empty stores và copy originals atomically theo từng file vào upload volume. Đây không phải một cross-store transaction và không rollback đồng thời ba store.
- `verify`: read-only remote verification và local reconciliation nếu services đang chạy.

Future publish vẫn giữ exact-approval, PII/secret/path scan, logical MySQL export và official Qdrant collection snapshot. Không ingest/embed lại để tạo release.

## Restore safety

Restore chỉ chấp nhận:

- cả MySQL và Qdrant đều empty; hoặc
- cả hai đã khớp exact release, khi đó structured restore được skip và original còn thiếu có thể được phục hồi.

Partial/incompatible state, checksum mismatch hoặc local original khác nội dung đều fail closed. Tool không merge, overwrite, xóa volumes hay fallback sang artifact trong Git. Tất cả cloud artifacts được tải vào temp và verify trước khi mutation; temp được dọn cả khi lỗi.

`CORPUS_BOOTSTRAP` có một semantics duy nhất:

| Mode | Hành vi |
|---|---|
| `off` | Không tải/restore cloud release. |
| `auto` | Restore vào fresh stores; skip exact-compatible stores. Thiếu key/GCS tạm lỗi thì start degraded với existing hoặc empty state. Integrity/partial mismatch vẫn hard fail. |
| `required` | Thiếu key/release/artifact hoặc state không tương thích thì fail orchestration và giữ volumes. |

Fresh machine không có reader key không nhận canonical corpus. Existing compatible volumes vẫn dùng được khi không có key.

## Sau restore

MySQL, Qdrant và originals đều local. Chat/retrieval, citation snapshot và document/citation file endpoints hoạt động mà không document ingest, LlamaParse hoặc document embedding. Mỗi live query vẫn cần query embedding và có thể cần LLM generation.

Các máy có copy riêng; không có merge hay bidirectional sync. Dữ liệu mới chỉ được chia sẻ sau khi manager tạo và publish release mới. Đổi embedding model/dimension hoặc incompatible pipeline semantics có thể yêu cầu một corpus mới.

Google Cloud Storage preconditions và checksum validation được dùng để chống overwrite/corruption: [request preconditions](https://cloud.google.com/storage/docs/request-preconditions), [data validation](https://cloud.google.com/storage/docs/data-validation).
