# Source locator status and integration notes

Status: Node geometry boundary **IMPLEMENTED + CONTRACT/LOCAL TESTED**; canonical
physical-page alignment is **CURRENT INVESTIGATION / UNVERIFIED**; Python geometry and
precise FE highlight are **OPTIONAL/LATER + NOT VERIFIED**. This is a supporting
explanation. The wire shape is canonical in
[internal RAG contract](../api/internal-rag-contract.md), current state is in the
[project handoff](../../PROJECT_HANDOFF.md), and Python actions are in the
[Python/Data-RAG handoff](python-rag-handoff.md).

## Canonical physical-page identity — baseline requirement

A citation may claim a 1-based `pageNumber` only when it can be mapped to the physical
page of the canonical PDF artifact. This requirement applies even when
`sourceLocator=null`; absence of geometry does not resolve page-alignment uncertainty.

The current adapter uses LlamaParse `split_by_page=True` and numbers provider documents
by output position. It does not use a canonical physical-page identity from metadata.
Whether the SDK/provider supplies a trustworthy identity for sparse, blank or skipped
output remains **UNVERIFIED**. No metadata field, page convention or production mapping
has been selected. Positional/heuristic mapping must not be adopted as a repair merely to
make documentation or tests agree.

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

## Optional precise geometry and highlight

Geometry is nullable and optional for baseline citation display. If provided, it must be
trustworthy for the already-established canonical physical page; geometry cannot repair
or substitute for uncertain page identity.

### Data path required only for precise highlight

```text
canonical PDF parser/word geometry
→ page-bounded, occurrence-aware chunking
→ Qdrant payload + complete manifest
→ retrieval citation response
→ Node immutable snapshot
→ FE authenticated viewer overlay
```

The tracked Python snapshot currently does not generate `source_locator`. Therefore
`sourceLocator=null` is expected and does not mean highlight is implemented. It permits
the page/source-text fallback only when the page itself is trustworthy. If Owner
prioritizes precise highlight, Python must derive boxes from the same word/span
occurrence used to build the chunk; post-hoc fuzzy search, fabricated full-page boxes,
or one shared box for repeated chunks is not acceptable.

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
