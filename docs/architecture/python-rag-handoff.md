# Bàn giao Python/Data-RAG

Cập nhật: 2026-08-12. Đây là authority hiện hành cho Python delivery, cross-runtime
acceptance và các gap do Python sở hữu. Exact wire shape thuộc
[internal RAG contract v0.1](../api/internal-rag-contract.md); `python-service/` chỉ là
snapshot quan sát, không phải upstream source of truth.

## Baseline và ranh giới bằng chứng

- Exact upstream branch/commit của snapshot hiện tại: `UNKNOWN`.
- `OBSERVED IN SNAPSHOT` chỉ có nghĩa code tồn tại trong bản copy được track.
- Offline/mock test không phải live Node → Python → Qdrant/provider evidence.
- Commit `23afbec` lưu recorded isolated evidence cho revision/scope của lần chạy đó:
  `PREVIOUS_REPORT_ONLY`, không phải current rerun.
- Python delivery cần exact upstream SHA; Owner-run integration và operational acceptance
  là hai gate riêng.

Node schema, public API và business lifecycle không được đổi để che Python mismatch nếu
chưa có quyết định chung.

## Danh sách action

| ID | Trạng thái | Kết quả/giới hạn cần giữ |
|---|---|---|
| `PY-PAGE-001` | Investigation complete; residual risk | Fixture bốn trang không tái hiện lệch; legacy path không có explicit page field. Không repair bằng ordinal/heuristic. |
| `PY-MD-001` | Đã có trong snapshot; offline PASS được ghi, chưa rerun | Markdown-aware citation extraction; exact upstream delivery vẫn chưa có. |
| `PY-OCR-001` | Đã có trong snapshot; bounded live observation | Explicit `OFF|AUTO`, key không tự bật parser/OCR; full provider acceptance chưa current verified. |
| `PY-EVAL-001` | Đã có trong snapshot; offline PASS được ghi, chưa rerun | Evaluator chỉ dùng disposable collection và không tạo metric mô phỏng như evidence. |
| `RAG-REC-001` | Đã có bounded subset; operational gate unresolved | Exact-attempt recovery/reconciliation có bounded implementation; owner và acceptance gate chưa chốt. |
| `RAG-VIS-001` | Unresolved | Late document-wide hide/unhide có thể mutate Qdrant trước stale callback rejection; chưa chọn ordering/wire strategy. |
| `INT-E2E-001` | Deferred | `23afbec` là isolated historical evidence; current full-stack rerun chưa có. |
| `PY-LOC-001` | `OPTIONAL-LATER` | Chỉ làm trustworthy occurrence geometry nếu precise highlight được promote. |

## Quyền sở hữu và artifact

Node sở hữu original, persistent derived artifact, storage key, auth, document/job/
attempt state, MySQL, citation snapshot và usage. Python sở hữu parse/OCR, chunk,
embedding, Qdrant, retrieval/generation và exact-attempt point lifecycle.

| Upload | Artifact Python nhận | Page/locator semantics |
|---|---|---|
| PDF | Validated uploaded PDF | Physical page chỉ được claim khi identity đáng tin cậy |
| DOCX | Persistent PDF do Node tạo trước ingest | Page/locator quy chiếu đúng derived PDF đó |
| TXT | Uploaded UTF-8 text | Không claim physical PDF page/geometry |

Python không convert lại DOCX, không mutate shared upload volume, không dùng filename làm
path và không log/public private path hoặc document content không cần thiết.

## Operations và vòng đời exact attempt

Business routes dùng internal Bearer, JSON `snake_case`:

| Operation | Method/path |
|---|---|
| Ingest | `POST /api/ingest` |
| Query | `POST /api/query` |
| Visibility | `PATCH /api/docs/{doc_id}/visibility` |
| Delete | `DELETE /api/ingest/{doc_id}` |

`202` chỉ nghĩa request đã authenticate, validate và được nhận; không phải terminal
success. `job_id + attempt_count` định danh exact immutable attempt và phải được bảo toàn
qua callback/retry.

Success invariant:

```text
parse/OCR → page-bounded chunk → embed
→ retrieval-disabled upsert (`is_active=false`)
→ complete manifest → Node transaction + machine ACK
→ activate vectors của exact attempt
```

`is_hidden` là document visibility flag riêng, không phải pre-ACK retrieval state.
Python chỉ activate khi ACK match exact identity, terminal `SUCCEEDED`, accepted/exact
replay và `canActivate=true`. Missing/unreadable/mismatched ACK không cho phép activation.
Whole-document success/failure vẫn bắt buộc; cleanup không được chạm attempt khác.

## Gap recovery và visibility

Snapshot có idempotent activation retry, consistency inspection và explicit exact-attempt
manual recovery. CLI không đọc MySQL nên operator vẫn phải xác nhận supplied attempt là
current Node `READY` attempt. Restart trước callback/ACK chưa tự resume; durable queue hay
scheduler chưa được chọn hoặc bắt buộc.

Node chặn operation thứ hai khi job active và từ chối stale callback, nhưng Python
hide/unhide theo toàn bộ `doc_id`. Vì Qdrant mutation xảy ra trước callback, Node rejection
không chứng minh ordering an toàn. Không tự thêm version field, endpoint hoặc policy trong
documentation.

## Manifest, nguồn gốc và page identity

Mỗi chunk manifest bắt buộc có unique `chunk_index`, UUID `vector_node_id`, exact
`chunk_text` và lowercase SHA-256 `content_hash`. Optional page/heading/locator chỉ được
gửi khi đáng tin. External `vector_node_id` phải đồng nhất giữa manifest, Qdrant point,
query citation và Node resolution.

Khi claim `page_number`, Python phải:

- dùng 1-based physical page của canonical PDF;
- không chunk xuyên page;
- không gán physical page cho TXT hoặc synthetic/legacy index chưa xác minh;
- dùng exact cited source fragment và đúng retrieved vector;
- gửi `source_locator=null` nếu geometry vắng hoặc không đáng tin.

Hai LlamaParse jobs ngày 2026-08-11 dùng cùng four-page fixture và options, đều trả marker
page 1, blank sentinel, OCR page 3, marker page 4; mọi metadata `{}`. Fixture trả đủ output
nên không kiểm tra sparse/omitted/merged case. Kết luận duy nhất:
**FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**. Không sửa parser, không chọn
metadata/page convention/heuristic và không re-ingest. Evidence chi tiết nằm tại
[source locator](source-locator-handoff.md).

## Geometry

Node contract chấp nhận nullable ordered `boxes[]` normalized 0–1, top-left, positive và
nằm trọn trong canonical page. Python snapshot chưa có production path sinh trustworthy
geometry. Không gửi full-page placeholder, box bịa, fuzzy-matched occurrence hoặc geometry
của artifact khác. Baseline citation vẫn dùng document, trustworthy page nếu có và source
text; precise highlight là `OPTIONAL-LATER`.

## Parser/OCR, citation và usage

- Provider key không được tự bật premium parser hoặc OCR. `OCR_MODE=OFF|AUTO`, default
  `OFF`; invalid mode fail rõ.
- Digital page ưu tiên native text; image-only page có thể OCR; required OCR failure phải
  fail whole ingest. Blank page không tự là OCR failure.
- `answer` là string Markdown/GFM subset. Raw HTML/chart/`visualizations` không thuộc
  CURRENT contract.
- `no_answer=false` cần structured citation; Python không yêu cầu Node parse marker.
- Citation parser không coi inline/fenced code, `array[0]`, invalid/out-of-range marker là
  citation; giữ first valid appearance order và không bịa missing source.
- `usage_calls[]` dùng contiguous 1-based `call_index` và actual provider/model usage;
  aggregate `usage` chỉ là compatibility fallback.

## An toàn evaluation

Week 5 random simulation không phải retrieval-quality evidence. Evaluator chỉ được chấp
nhận khi target là disposable/test collection, fail closed với protected/ambiguous target,
không publish retrieval-active points vào corpus thật, khai báo dependency, exit non-zero
khi assertion/safety fail và phân biệt simulation với measured result.

## Acceptance và bàn giao

Python delivery cần trả exact upstream branch/SHA, file thay đổi, config/default, commands
đã chạy và từng kết quả `PASS|FAIL|BLOCKED|NOT RUN`. Owner-run integration phải pin Node/
Python revision, provider/model/parser mode, disposable collection và kiểm tra upload →
ACK/activate → query/citation/usage → hide/unhide/delete, gồm failure/replay path.

Không gọi mock/offline/historical result là live E2E. Operational acceptance còn phụ
thuộc recovery ownership, reconciliation gate và stale visibility ordering. Geometry chỉ
thành acceptance requirement khi Owner promote precise highlighting.
