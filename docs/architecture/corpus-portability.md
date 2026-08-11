# Khả năng di chuyển cloud corpus

Portable corpus là immutable release trên private GCS, không phải database synchronization và không phải runtime cloud storage.

## Thành phần và quyền sở hữu

- MySQL giữ document/job/chunk mapping, chat history, citation snapshot và usage.
- Qdrant giữ vectors/retrieval payload do Python sở hữu.
- Upload volume giữ original PDF/DOCX/TXT mà NodeJS stream qua public API.
- GCS chỉ phân phối release để phục hồi ba nhóm dữ liệu trên về Docker local.

NodeJS/Python runtime không đọc GCS; chỉ host-side corpus tooling dùng credential. Một máy có thể diverge sau khi upload document mới. Dữ liệu không tự merge hoặc đồng bộ sang máy khác.

## Immutable release và tính toàn vẹn

```text
{GCS_OBJECT_PREFIX}/releases/{releaseId}/
  mysql/corpus.sql.gz
  qdrant/education_docs.snapshot
  documents/{documentId}/{sha256}/{safeFilename}
  manifest.json
```

Artifacts dùng create-only precondition và được download-back verify. `manifest.json` được upload cuối. Toàn bộ package được verify trước khi [`corpus-release.json`](../../bootstrap/corpus-release.json) đổi pointer. Retry cùng release chỉ skip object có metadata/content khớp; collision khác checksum/size phải fail, không overwrite.

Release identity `content-v2` băm scoped MySQL business data (gồm chat/messages/citation snapshots/usage, loại `auth_tokens`), nội dung Qdrant gồm vector + payload và checksum/size của mọi original. Identity không dùng manifest/export timestamp, temp/export path, snapshot transport name hoặc DDL `AUTO_INCREMENT`. Document/vector IDs chỉ tham gia khi chúng là mapping content cần thiết để nối MySQL–Qdrant; process/container/connection ID không tham gia. Thay đổi bất kỳ scoped content store nào tạo ID khác. Release v1 cũ vẫn được verify theo manifest cũ để backward compatibility.

Các guard luôn được giữ:

- manifest, artifact SHA-256/size, inventory và compatibility;
- MySQL–Qdrant mapping tại thời điểm export/strict verify;
- document phải `READY`, `VISIBLE` hoặc `HIDDEN`, chưa soft-delete;
- original phải tồn tại và khớp checksum/size trong MySQL;
- path containment và secret/credential scan;
- auth-token rows bị loại khỏi dump;
- restore không ghi đè non-empty/ambiguous local stores.

`bootstrap/corpus-release.json` là selected-release transport pointer. Pointer hiện chọn
`v1-d07f526e059e53751402a4f3`; metadata trong Git
không tự chứng minh object remote còn tồn tại, checksum download đúng hoặc local stores
đang khớp release. Data approval không còn được ghi là blocker hiện hành. Exact remote
availability/restore/query phải được kết luận từ `corpus:verify` hoặc isolated acceptance
đã chạy cho đúng release, không từ pointer hay tài liệu này.

Bằng chứng audit lịch sử còn nhắc `v1-7463f169257976a90e65ab7c`. Metadata hiện có trong
repository không chứng minh đây là predecessor, logically equivalent export hay một
canonical state khác. Không gọi ID nào là sai và không suy equivalence MySQL–Qdrant–
original trước khi so sánh read-only manifest/fingerprint tương ứng. Gap này được theo dõi
bằng `CORPUS-EQ-001` trong [issue register](../status/issue-quality-register.md).

## Mức kiểm chứng

| Mức | Bằng chứng được phép kết luận |
|---|---|
| `npm run test:corpus` | Unit/local simulation bằng fake object store và fixture tạm; kiểm tra validation, deterministic identity, rollback và zero external mutation. Không chứng minh live lifecycle. |
| `npm run test:corpus:partial` | Failure/isolation test trên project `edurag_corpus_partial_*` mới, đã xác nhận không có resource cũ; chỉ test local MySQL/Qdrant và tự cleanup. |
| `npm run test:corpus:fresh` | Synthetic immutable release được restore vào MySQL/Qdrant/upload volume của project `edurag_corpus_fresh_*` mới; kiểm tra cross-store consistency, verified release-state marker, exact-release no-op và cleanup. Không gọi GCS/provider thật. |
| `npm run test:corpus:live` | Live restore/query/citation; bị chặn trước mọi preflight/provider call nếu thiếu explicit approved-bundle confirmation, approved release ID/document/query. |
| Selected private release | Pointer chọn release; remote checksum/restore/query chỉ PASS khi workflow verify/acceptance thực sự chạy cho đúng ID. |

## Các mode bootstrap

| Mode | Hành vi |
|---|---|
| `auto` | Nếu cả MySQL business state, Qdrant và uploads đều `EMPTY`, restore đúng selected release. Local complete được verify động: exact selected release no-op; valid different release được retain với warning, không replace. Partial, busy, missing/stale marker, same-release checksum mismatch, cross-store mismatch hoặc `UNKNOWN/ERROR` đều fail closed. Confirmed `EMPTY` chỉ được tiếp tục `DEGRADED` với remote config/credential/permission/missing-object/transport failure ở phase remote read trước local mutation. |
| `required` | Acceptance mode: selected release/credential/artifacts phải hợp lệ và local non-empty phải khớp exact release. Mismatch fail closed. |
| `off` | Không đọc/restore/so sánh cloud release. Local startup tiếp tục độc lập. |

### Thứ tự fresh state và diagnostic Qdrant

**CURRENT_VERIFIED trong phạm vi code/local regression:** bootstrap `auto` mặc định chạy
data-service bootstrap trước khi inspect MySQL/Qdrant. Fix tại `8abff73` giúp fresh local
state không còn fail lần đầu chỉ vì resource cần inspect chưa được tạo. Fix không nới
empty/partial/mismatch guard; rerun vẫn theo exact-release/dynamic-state rule. Các suite
fresh/partial/reset dùng Docker là evidence riêng và không được gọi current PASS nếu chưa rerun.

Commit `f269334` giữ context lỗi Qdrant tại request boundary: phase, HTTP method,
sanitized target path, HTTP status/dòng response đầu tiên nếu có và transport cause.
Diagnostic target loại query string; response/cause được redact. Lỗi HTTP auth/config và
các 4xx khác không bị chuyển thành blind retry.

Regression loopback local bao phủ unavailable endpoint và non-success HTTP response. Nó
chứng minh diagnostic behavior, không chứng minh root cause của member report cũ về
`CORPUS_QDRANT_REQUEST_FAILED`. Vì thiếu original command/log/environment, incident vẫn
**PLAUSIBLE/UNVERIFIED**, không phải reproduced hoặc closed.

Bootstrap theo dõi phase `REMOTE_READ`, `STAGE`, `VERIFY`, `APPLY`, `ROLLBACK`, `FINALIZE` cùng cờ local mutation/rollback. `auto` không degrade integrity/incompatible-manifest, local service/filesystem error, unknown programming error, post-apply failure hoặc rollback failure. Raw `TypeError("fetch failed")`, abort/timeout/network, HTTP availability, permission và missing-object được chuẩn hóa tại remote boundary; log chỉ dùng stable code/sanitized reason. Job/document đang xử lý và partial local stores là `PRESENT`, không bị gọi nhầm là cloud fingerprint corruption và không bị overwrite. `required` luôn fail closed với remote failure và unknown/partial/mismatch.

Sau restore thành công, upload volume ghi `.edurag-corpus-release-state.json` gồm release ID, manifest checksum, compatibility và expected inventory (không chứa credential). Marker chỉ được ghi sau khi MySQL, Qdrant và originals đều verify. Lần `auto` sau dùng marker + dynamic fingerprint để no-op; marker thiếu/không khớp không được coi là bằng chứng local hợp lệ. `required` vẫn download/verify selected release để acceptance strict.

## Publish release mới

Target phải là private/internal. Publish kiểm tra Public Access Prevention/IAM trước upload và chặn public hoặc unverifiable target. Reader credential dùng restore/verify; writer credential mới publish. Với writer least-privilege có Object Viewer + Creator nhưng bị 403 khi đọc bucket metadata, Owner có thể opt-in bằng `GCS_PRIVATE_TARGET_OWNER_ATTESTATION=<exact-project-id>/<exact-bucket-name>` sau khi tự kiểm tra đúng target. Fallback chỉ chấp nhận credential service-account có identity `corpus-writer`, ghi diagnostic không chứa secret và không áp dụng cho 401, target mismatch, public bucket hay collision. Bỏ trống biến này để giữ mặc định fail-closed.

```powershell
npm run corpus:publish -- --dry-run
npm run corpus:publish -- --confirm-reviewed
npm run corpus:verify
```

`npm run corpus:inspect` là local-only: chỉ đọc pointer trong repository và trạng thái local nếu service đang chạy; không đọc credential, không gọi GCS/provider/writer và không verify remote release. `--dry-run` yêu cầu MySQL/Qdrant hiện đang chạy và chỉ dùng read-only dump/scroll/stat. Nó không start/stop writer, không tạo/xóa Qdrant snapshot, không tạo staging artifact và không đổi pointer hay persistent state. Dry-run dùng cloud credential ở chế độ read-only để xác minh target hiện hành là private; nó không upload, đổi IAM/ACL hay gọi provider. Plan gồm document ID, title/filename, processing/visibility, checksum, size và provisional release ID; final ID chỉ chốt sau frozen export.

Private corpus được phép giữ toàn bộ account rows hợp lệ, email canonical và bcrypt password hash cần cho khôi phục đăng nhập. Account count/email là dữ liệu động trong scoped MySQL dump và làm thay đổi fingerprint; không dùng email allowlist và không log account values. Public distribution bị cấm. Plaintext password, reset token, OTP, access/refresh token, API/cloud credential, private key, `.env`, Authorization header, auth-token rows và artifact/bảng ngoài scope vẫn bị chặn.

`--confirm-reviewed` là xác nhận rõ ràng của operator rằng đã review credential/secret, quyền chia sẻ và project scope. Tool vẫn chạy heuristic secret/path scan và mọi integrity guard nêu trên. Không còn tracked-fixture hoặc approval registry theo `documentId + checksum`.

`--dry-run` không được kết hợp với `--confirm-reviewed`; thiếu confirmation hoặc option lạ đều fail. Publish interruption trước pointer có thể để lại immutable incomplete package làm cleanup candidate, nhưng release hiện hành không đổi và retry không được silently overwrite.

Flow canonical: [Corpus publish](../flows/mermaid/10_corpus_publish.mmd). Signal guard hiện best-effort resume writers trước khi thoát; do handler gọi process exit trực tiếp, cleanup staging riêng cho signal chưa được bảo đảm như normal/error `finally`. Pointer cũ vẫn không đổi nếu publish chưa verify hoàn tất.

## Restore và các giới hạn

Restore download/stage/verify toàn bộ trước apply và chỉ chạy khi local `EMPTY`; exact selected-release state chỉ no-op sau dynamic verification. Temporary download/staging được xóa trong normal/error path; upload-volume helper container được xóa trong `finally`. Trong apply, tool giữ writer pause, tạo in-memory recovery dump cho empty MySQL state, phục hồi exact empty Qdrant config và xóa đúng originals vừa materialize nếu bước sau thất bại. Release-state marker chỉ được publish local ở finalize sau full consistency. Đây là coordinated recovery, không phải distributed transaction; rollback failure trả `CORPUS_RESTORE_ROLLBACK_FAILED` và không được tự merge/overwrite tiếp. Không có hidden `--force`. Explicit replacement dùng duy nhất `npm run corpus:reset`: preflight source trước destructive step, nạp snapshot đã verify vào một Qdrant container tạm để kiểm tra mọi point có `is_active=true`, `is_hidden` boolean và `ingest_attempt_key`, resolve exact Compose namespace, một confirmation (`--yes` cho automation), full restore/start/health/consistency rồi mới ghi READY. Snapshot lifecycle không tương thích làm reset dừng trước khi xóa local stores; container preflight tạm luôn được cleanup. `docker:remote:reset` là alias cùng implementation.

Restore không ingest, LlamaParse hoặc document-embed lại. Mỗi live query vẫn cần query embedding và có thể cần LLM generation. Thay model/dimension hoặc incompatible pipeline semantics có thể yêu cầu corpus mới.

Tham khảo GCS: [request preconditions](https://cloud.google.com/storage/docs/request-preconditions), [data validation](https://cloud.google.com/storage/docs/data-validation).
