# Source locator status and integration notes

Status: Node geometry boundary **IMPLEMENTED + CONTRACT/LOCAL TESTED**; the bounded
LlamaParse probe result is **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**;
Python geometry and precise FE highlight are **OPTIONAL/LATER + NOT VERIFIED**. This is a supporting
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
No metadata field, page convention or production mapping has been selected.
Positional/heuristic mapping must not be adopted as a repair merely to make documentation
or tests agree.

### Bounded live probe — 2026-08-11

**CURRENT_VERIFIED for this fixture/options only:** two successful parse submissions used
identical PDF bytes (SHA-256
`26c48289921665384e8455ca5435c634f403a9f0465ecb04cc1528ef38e174bc`),
`llama-parse==0.6.4`, the probe environment's transitive
`llama-cloud-services==0.6.94`, `pypdf==5.6.0`, and the repository call
`LlamaParse.aload_data(file_path)` with `split_by_page=True`. The transitive package
version is environment evidence, not a repository pin.

| Physical page | Synthetic content | Output ordinal in both runs | Legacy metadata in both runs | Observation |
|---:|---|---:|---|---|
| 1 | Selectable `PHYSICAL_PAGE_1` | 1 | `{}` | Marker returned |
| 2 | Completely blank | 2 | `{}` | Provider returned `NO_CONTENT_HERE` sentinel |
| 3 | Raster-only `PHYSICAL_PAGE_3`, no text layer | 3 | `{}` | Marker returned by OCR |
| 4 | Selectable `PHYSICAL_PAGE_4` | 4 | `{}` | Marker returned |

Both runs returned four items in the same order. No item exposed `page`, `page_number`,
`pageNumber` or an equivalent explicit identity through this supported legacy result
path. The call also exposed no public same-job handle through which the adapter could
retrieve a structured page model without changing workflow/client path.

The matching runs establish observed repeatability and blank/image handling for this
one fixture. Because no output was omitted or merged, they do not establish that output
ordinal remains the canonical physical page for sparse/skipped provider output, and they
do not create a documented provider guarantee. The parser was not changed and no data
was re-ingested. General provider-output-to-physical-page identity therefore remains
**UNVERIFIED** whenever output cardinality/order differs from the canonical PDF.

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
`sourceLocator=null` is expected and does not mean highlight is implemented. Source text
can still be displayed as an immutable citation snapshot; physical-page navigation is
permitted only when the page itself is trustworthy. If Owner
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
