# Python/RAG OCR và rich Markdown handoff

Tài liệu này là backlog bàn giao cho Python upstream. Node contract canonical vẫn ở
[internal RAG contract](../api/internal-rag-contract.md); patch trong snapshot phải được
upstream, và unit/mock PASS không phải provider/live E2E PASS.

## A. Quyết định đã chốt

- Rich answer là Markdown subset/GFM-compatible trong `answer` string; không có
  `edurag-chart`, bar/line/pie, chart JSON hoặc `visualizations`.
- OCR phải có flag explicit, mặc định **OFF**; không tự bật chỉ vì có API key.
- Không đổi Node public API, MySQL schema, complete-manifest hay lifecycle
  hidden upsert → Node transaction/ACK → activate.
- Ingest giữ whole-document success/failure; không partial success hoặc automatic retry.
- Corpus cũ tiếp tục query-compatible; chỉ re-ingest có chọn lọc để hưởng OCR/chunking mới.

## B. Findings đã kiểm chứng

| ID / severity | Bằng chứng và hành vi hiện tại | Rủi ro | Hướng sửa và test bắt buộc |
|---|---|---|---|
| **PY-MD-001 / HIGH** | `services/rag_engine.py::_extract_citations()` regex mọi `[N]` trong toàn answer. Offline probe xác nhận ``array[3]`` và fenced-code `values[0]` làm citation set bị reject; marker thưa còn có thể bị renumber. | Code/indexing bị nhận nhầm là citation; answer hợp lệ thành no-answer hoặc citation sai. | Parse marker theo Markdown context: prose/table cell có citation; bỏ qua inline/fenced code và array indexing. Test prose, table, code, repeated/sparse/invalid marker theo canonical order contract. |
| **PY-MD-002 / HIGH** | Prompt tại `services/rag_engine.py::_build_rag_prompt()` trước patch yêu cầu `edurag-chart`; Node/FE không có chart contract. Patch snapshot hiện chỉ bỏ instruction này, chưa sửa citation parser. | Output ngoài contract và không có renderer/validator. | Không sinh chart protocol mặc định; regression assert prompt/output không chứa chart JSON hoặc `visualizations`. |
| **PY-OCR-001 / HIGH** | `services/parser.py::_parse_with_llamaparse()` đặt `premium_mode=True`; `parse_document()` chọn LlamaParse chỉ theo sự tồn tại của `LLAMA_CLOUD_API_KEY`, catch rộng rồi fallback local. | OCR tự bật, chi phí/privacy khó kiểm soát; scanned/mixed PDF có thể mất nội dung bắt buộc nhưng vẫn đi tiếp. | Thêm flag explicit default OFF; giữ provenance/page mapping và whole-document failure. Mock/fixture test digital, scanned, mixed, rotation, tiếng Việt, timeout/failure; redact provider error/secret. |
| **PY-EVAL-001 / HIGH** | `scripts/evaluate_rag.py::ingest_test_doc()` upsert Qdrant với `is_hidden=False`, không qua Node job/ACK; image hiện tại còn thiếu direct dependency `pandas`. | Có thể mutate collection canonical và tạo active orphan; script/report có thể báo sai thành công. | Chỉ cho disposable collection, từ chối canonical target mặc định, yêu cầu confirmation explicit, assertion/safety failure trả exit code khác 0. Test không provider. |
| **PY-CHUNK-001 / MEDIUM** | `services/ingestion.py` thêm `MarkdownNodeParser`; offline probe giữ page metadata nhưng `header_path` không đi vào payload/manifest và ingest tests đang mock parser. | Claim bảo toàn heading chưa được chứng minh; chunk/text/hash có thể đổi khi re-ingest. | Test heading/table/code/page metadata và deterministic chunk/hash. Không thêm contract field chỉ để lưu `header_path`. |

## C. Backlog đề xuất

### P0 — Citation và Markdown

- Citation trong prose và Markdown table phải hoạt động.
- Bỏ qua `[N]` trong inline code, fenced code và array indexing như `array[0]`.
- Xử lý citation lặp, citation thưa và marker không hợp lệ theo canonical contract; không
  tự giả định contiguous order nếu contract phiên bản đang kiểm thử không yêu cầu.
- Loại `edurag-chart` khỏi output mặc định.

### P1 — OCR

- OCR flag explicit, default OFF; không tự bật Premium OCR theo API key.
- Giữ page mapping, provenance và whole-document success/failure.
- Không callback success nếu OCR làm mất nội dung bắt buộc; redact provider error/secret.
- Test digital/scanned/mixed/rotation/tiếng Việt/timeout/failure bằng fixture hoặc mock
  trước khi bật demo.

### P1 — Evaluation safety

- Không mutate canonical Qdrant theo mặc định; evaluation ingest chỉ dùng disposable collection.
- Từ chối canonical target, yêu cầu explicit confirmation và trả exit code khác 0 khi safety
  check/assertion thất bại.

### P2 — Chunking/tooling

- Kiểm tra Markdown parser với heading, table, code và page metadata; xác nhận chunk/hash
  deterministic; không thêm field contract chỉ để lưu `header_path`.
- Rà direct dependency, random seed, assertions và exit code; loại dependency nặng không cần thiết.

## D. Acceptance criteria

- Citation regression PASS trong prose/table; code/indexing không bị nhận nhầm.
- Không còn chart protocol trong output mặc định.
- OCR không tự bật theo API key; OCR OFF giữ luồng PDF/DOCX/TXT hiện hành.
- Không mất page/citation metadata; unit/contract tests không gọi provider thật.
- Evaluation không thể ghi canonical Qdrant theo mặc định.
- Không đổi Node API/schema/lifecycle; corpus cũ vẫn query-compatible.

## E. OPTIONAL/LATER

- Provider live OCR/E2E và production policy cho scanned/mixed/rotation/Vietnamese OCR.
- Figure extraction, crop storage và structured visualizations.
- Re-ingest có chọn lọc để hưởng OCR/chunking mới.
