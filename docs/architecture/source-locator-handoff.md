# Source locator status and integration notes

Status: Node boundary **IMPLEMENTED + CONTRACT/LOCAL TESTED**; Python geometry and
precise FE highlight **OPTIONAL/LATER + NOT VERIFIED**. Baseline MVP citation remains
document name, `pageNumber` and `sourceText`. This is a supporting explanation. The
wire shape is canonical in [internal RAG contract](../api/internal-rag-contract.md), and
the implementation backlog is canonical in [Python/Data-RAG handoff](python-rag-handoff.md).

## Contract already fixed at the Node boundary

- Public `pageNumber` is 1-based.
- `sourceLocator` is `null` or `{boxes:[{x,y,width,height}, ...]}`.
- `boxes` is ordered and non-empty. Coordinates are finite, normalized 0–1, top-left;
  width/height are positive and every box is contained in the page.
- Internal Python JSON may use `source_locator`; public Node JSON uses `sourceLocator`.
- Node rejects invalid geometry and does not clamp, fuzzy-search, create or backfill it.
- Locator data is part of immutable chunk/citation source data. Role-dependent URLs are
  generated separately and are not stored in the snapshot.

Node evidence: `src/utils/source-locator.js`, `src/clients/rag-contract.js`,
`src/validators/processing-callback.js`, chunk/citation repositories, and the RAG
contract/node-consolidation tests.

## Data path required only for precise highlight

```text
canonical PDF parser/word geometry
→ page-bounded, occurrence-aware chunking
→ Qdrant payload + complete manifest
→ retrieval citation response
→ Node immutable snapshot
→ FE authenticated viewer overlay
```

The tracked Python snapshot currently does not generate `source_locator`. Therefore
`sourceLocator=null` is expected and does not mean highlight is implemented. This does
not block baseline MVP citation fallback. If Owner prioritizes precise highlight, Python
must derive boxes from the same word/span occurrence used to build the chunk; post-hoc
fuzzy search, full-page boxes, or one shared box for repeated chunks is not acceptable.

## Fixtures required only if precise highlight is prioritized

- Native-text PDF with an independently verified overlay.
- Repeated text on one page and the selected occurrence.
- Multi-line citation with multiple ordered boxes.
- Rotation and CropBox/MediaBox normalization.
- OCR text with trustworthy geometry and OCR text without geometry (`null`).
- Citation with no locator; FE uses `pageNumber + sourceText` fallback.

Legacy DOCX citations are not automatically page-aligned. New DOCX uploads use the
persistent Node-derived canonical PDF, so any future Python page/box must refer to that
exact artifact. Existing snapshots must not be rewritten or assigned fabricated boxes.
