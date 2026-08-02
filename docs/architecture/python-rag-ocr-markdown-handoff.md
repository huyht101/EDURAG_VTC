# Python/RAG OCR and Markdown audit record — SUPERSEDED

This file preserves the finding IDs from the focused OCR/Markdown review. It is not a
second contract or backlog. Use:

- [Python/Data-RAG handoff](python-rag-handoff.md) for current actions and acceptance;
- [internal RAG contract](../api/internal-rag-contract.md) for wire semantics;
- [issue/quality register](../status/issue-quality-register.md) for priority/ownership.

## Findings retained for traceability

| ID | Static evidence from the tracked snapshot | Current disposition |
|---|---|---|
| `PY-MD-001` | `services/rag_engine.py::_extract_citations()` globally matches numeric brackets, including code/index contexts. | P0 Python fix and offline Markdown-context regression. |
| `PY-OCR-001` | `services/parser.py::parse_document()` selects LlamaParse from key presence; `_parse_with_llamaparse()` enables premium mode and broad fallback. | P1 explicit default-OFF parser guard before keyed runtime; full OCR provenance/quality tests are P2 OPTIONAL/LATER. |
| `PY-EVAL-001` | `scripts/evaluate_rag.py` can write active test points to the configured collection and imports undeclared `pandas`. | Isolate/refuse canonical target before use. |
| `PY-CHUNK-001` | Markdown parsing/chunking exists, but page/heading/table/code determinism is not proven by real parser fixtures. | Add offline deterministic provenance tests; no Node contract field solely for parser metadata. |

The chart instruction was removed from the tracked snapshot and Node has no chart
contract. Rich answer remains a Markdown/GFM-compatible string. Existing vectors remain
query-compatible; selective re-ingest is optional to gain future OCR/geometry behavior.
