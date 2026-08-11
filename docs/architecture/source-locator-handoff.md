# Nguồn gốc trang và source locator

Đây là authority diễn giải physical-page identity và geometry. Exact wire shape thuộc
[internal RAG contract](../api/internal-rag-contract.md).

## Trạng thái

- Node geometry boundary: đã triển khai và có contract/local tests.
- LlamaParse page identity: **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**.
- Python occurrence geometry và precise FE highlight: `OPTIONAL-LATER`, chưa verified.

## Baseline định danh trang vật lý

Citation chỉ được claim 1-based `pageNumber` khi map được tới physical page của canonical
PDF artifact. `sourceLocator=null` không làm page uncertainty biến mất.

Adapter hiện dùng `LlamaParse.aload_data(file_path)` với `split_by_page=True`, sau đó đánh
số theo output ordinal. Supported legacy result không cung cấp explicit canonical page
metadata. Không có metadata field, page convention hoặc production heuristic nào được
chọn; không dùng output position, text matching hay geometry làm repair.

## Probe có giới hạn ngày 2026-08-11

Hai successful submissions dùng cùng PDF bốn trang, cùng bytes (SHA-256
`26c48289921665384e8455ca5435c634f403a9f0465ecb04cc1528ef38e174bc`),
`llama-parse==0.6.4`, cùng method/options. Probe environment có transitive
`llama-cloud-services==0.6.94` và `pypdf==5.6.0`; đây không phải repository pin.

| Physical page | Fixture | Output ở cả hai run | Legacy metadata |
|---:|---|---|---|
| 1 | Selectable `PHYSICAL_PAGE_1` | Marker tại ordinal 1 | `{}` |
| 2 | Blank | `NO_CONTENT_HERE` tại ordinal 2 | `{}` |
| 3 | Raster-only `PHYSICAL_PAGE_3` | OCR marker tại ordinal 3 | `{}` |
| 4 | Selectable `PHYSICAL_PAGE_4` | Marker tại ordinal 4 | `{}` |

Cả hai run trả đủ bốn item theo cùng thứ tự; không có `page`, `page_number`, `pageNumber`
hoặc equivalent field. Legacy call cũng không expose same-job structured-result handle.

Evidence chứng minh repeatability và blank/image handling cho fixture này. Vì không có
output bị omit/merge, nó không chứng minh ordinal luôn là physical page cho sparse output
và không tạo provider guarantee. Parser không sửa; không re-ingest.

## Contract Node hiện hành

- Public `pageNumber` là 1-based khi có.
- `sourceLocator` là `null` hoặc `{boxes:[{x,y,width,height}, ...]}`.
- Boxes ordered, finite, normalized 0–1, top-left, positive và nằm trong page.
- Node reject geometry sai; không clamp, fuzzy-search, tạo hoặc backfill box.
- Locator là immutable source snapshot; role-dependent file URLs được sinh động riêng.

Node evidence nằm tại source-locator utility, RAG contract adapter, callback validator,
chunk/citation repositories và contract/node consolidation tests.

## Geometry và trình xem nguồn

Geometry nullable và không phải điều kiện để page identity đúng. Python snapshot hiện
không sinh `source_locator`, nên `null` là expected behavior, không phải precise highlight
implementation.

Source text vẫn hiển thị được như citation snapshot. Chỉ điều hướng tới physical PDF page
khi page identity đáng tin. Nếu precise highlight được promote, Python phải lấy box từ
chính word/span occurrence dùng tạo chunk; không dùng full-page placeholder, post-hoc
fuzzy match hoặc một box chung cho repeated text.

DOCX mới quy chiếu persistent Node-derived PDF; legacy DOCX không tự được coi page-aligned.
TXT không có physical-PDF page/geometry semantics.
