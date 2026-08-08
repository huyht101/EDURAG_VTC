# Python/Data-RAG handoff

Updated: 2026-08-03.

This is the canonical implementation and acceptance handoff for the Python/Data-RAG upstream team. [`python-service/`](../../python-service/) is only the tracked integration snapshot. Changes must be implemented, tested and accepted in the Python-owned repository, then refreshed deliberately into the integration snapshot.

The authoritative wire contract is [internal RAG contract v0.1](../api/internal-rag-contract.md). Contract fixtures and tests in the same repository revision are authoritative where this handoff provides only a summary.

Node schema, public API and business lifecycle must not be changed to accommodate a Python mismatch without joint approval. Offline tests, mock RAG results and historical runs are not current live Node → Python → Qdrant/provider evidence.

## Authority and baseline

The baseline for the canonical handoff is the repository revision containing:

* this document;
* `internal-rag-contract.md`;
* the associated contract fixtures and tests;
* the tracked `python-service/` snapshot.

The Python team must report the exact upstream branch and commit used for implementation and acceptance.

A delivery copy sent outside the repository must pin the exact Node and Python revisions. If a delivery copy conflicts with the repository at its pinned revision, the repository version is authoritative.

## Status vocabulary

* **NODE VERIFIED**: the Node boundary, validation or persistence behavior has passing local/contract tests.
* **OBSERVED IN SNAPSHOT**: code exists in the tracked `python-service/` snapshot; its presence does not prove the current upstream or deployed runtime.
* **REQUIRED FROM PYTHON**: implementation and tests are assigned to Python.
* **PROPOSAL REQUIRED / JOINT DECISION**: Python must provide a technical proposal, but implementation requires Node/Core and Python/RAG approval.
* **INTEGRATION VERIFICATION**: behavior must be demonstrated across the exact current runtimes; failure is not assumed to belong to either team until diagnosed.
* **NOT VERIFIED**: no sufficient current evidence exists.
* **OPTIONAL/LATER**: outside baseline MVP unless explicitly promoted.
* **DECISION REQUIRED**: a product, provider or cross-team policy remains open.

## Current assignment register

| ID            | Classification                                                  | Required outcome                                                                           |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PY-MD-001`   | P0 — **IMPLEMENTED + OFFLINE TESTED IN SNAPSHOT**                | Markdown-aware citation resolution; upstream delivery still required                        |
| `RAG-REC-001` | P0 — **MVP IMPLEMENTED + OFFLINE TESTED IN SNAPSHOT**            | Bounded activation retry, residual log, consistency check and exact manual recovery         |
| `INT-E2E-001` | P0 — **INTEGRATION VERIFICATION**                               | Run isolated live Node → Python → Qdrant/provider acceptance on pinned revisions           |
| `PY-OCR-001`  | P1 MVP — **IMPLEMENTED + OFFLINE TESTED IN SNAPSHOT**             | Explicit `OFF|AUTO`, safe key handling and deterministic digital/scanned/mixed-page OCR     |
| `PY-EVAL-001` | P1 — **IMPLEMENTED + OFFLINE TESTED IN SNAPSHOT**                | Disposable-only evaluator guard and behavioral tests                                       |
| `PY-LOC-001`  | P2 — **OPTIONAL/LATER**                                         | Implement trustworthy page-bounded geometry only if precise highlighting is promoted       |

The recovery proposal must not block `PY-MD-001`, safe current integration verification or other independently assigned work.

## Ownership and artifact mapping

Node owns:

* uploaded originals and persistent derived artifacts;
* storage keys and contained path resolution;
* DOCX-to-PDF conversion;
* authorization;
* document, job and attempt business state;
* MySQL persistence;
* citation snapshots;
* usage persistence.

Python owns:

* parsing and OCR;
* chunking;
* embeddings;
* Qdrant points and payloads;
* retrieval;
* answer generation;
* exact-attempt vector activation and cleanup.

Python never writes MySQL. Node never reads Qdrant.

| Upload | Artifact managed by Node                                | `file_path` received by Python              | Viewer/download consequence                                                                                           | Evidence                                                                                                                        |
| ------ | ------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| PDF    | Validated uploaded PDF                                  | Uploaded PDF in the shared volume           | The same artifact is used for canonical preview/download                                                              | **NODE VERIFIED**                                                                                                               |
| DOCX   | Immutable uploaded DOCX and persistent Node-derived PDF | Derived PDF, only after conversion succeeds | Derived PDF is used for preview and Student download; original DOCX remains available only to the owner Teacher/Admin | Node implementation and contract/local tests exist; current LibreOffice runtime and Python page provenance are **NOT VERIFIED** |
| TXT    | Uploaded UTF-8 text                                     | Uploaded TXT                                | No derived PDF or PDF geometry guarantee                                                                              | **NODE VERIFIED**                                                                                                               |

Python must not:

* convert DOCX itself;
* regenerate or replace the canonical derived PDF;
* treat the original filename as a filesystem path;
* mutate the shared upload volume;
* claim physical PDF page provenance for TXT or unverified legacy data.

The shared upload mount is read-only to Python.

## Node → Python operations

All business routes require:

```http
Authorization: Bearer <internal secret>
```

Health remains public. JSON uses `snake_case`.

| Operation  | Method/path                           | Required request fields                                                                               |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ingest     | `POST /api/ingest`                    | `doc_id`, `job_id`, `attempt_count`, `subject_id`, `file_path`, `callback_url`; `teacher_metadata={}` |
| Query      | `POST /api/query`                     | `request_id`, `user_id`, `conversation_id`, `question`, bounded `history[]`                           |
| Visibility | `PATCH /api/docs/{doc_id}/visibility` | `job_id`, `attempt_count`, `action=hide\|unhide`, `callback_url`                                      |
| Delete     | `DELETE /api/ingest/{doc_id}`         | `job_id`, `attempt_count`, `callback_url`                                                             |

Python returns `202` only after synchronous authentication, request-shape validation and acceptance for processing. `202` does not mean ingest, visibility or deletion has completed successfully.

For document operations:

* `doc_id` identifies the document.
* `job_id` and `attempt_count` identify the exact immutable processing attempt.
* Python must preserve these identifiers unchanged in callbacks and attempt-scoped Qdrant operations.
* Cleanup, activation, retry and replay must never affect another attempt.

`file_path` is an absolute Python-visible path derived by Node from a contained storage key. It is not a public URL and must not be exposed through a public response or unsafe log.

## Whole-document ingest lifecycle

The required success flow is:

```text
parse/OCR
→ page-bounded chunk when canonical pages are available
→ embed
→ hidden upsert
→ complete-manifest callback
→ Node transaction and machine ACK
→ activate exact-attempt vectors
```

### Verified and observed behavior

* **OBSERVED IN SNAPSHOT**:

  * deterministic UUID5 point identities include document/job/attempt/chunk information;
  * point payloads include attempt identity;
  * initial upsert is hidden;
  * callback code parses the machine ACK;
  * exact-attempt cleanup exists.
* **NODE VERIFIED**:

  * complete manifest persistence is transactional;
  * stale and conflicting attempts are rejected;
  * exact replay is idempotent;
  * activation is authorized only by an accepted machine ACK.

Python may activate vectors only when the ACK:

* is machine-readable;
* matches `doc_id`, `job_id` and `attempt_count`;
* reports `SUCCEEDED`;
* has status `ACCEPTED` or `IDEMPOTENT_REPLAY`;
* explicitly returns `canActivate=true`.

An absent, unreadable, incomplete or mismatched ACK is not permission to activate.

### Whole-document failure and compensation

Whole-document success/failure remains mandatory. Partial business success is not supported.

A required parser, OCR, chunking, embedding, upsert or activation failure must fail the exact attempt. Python must not return or callback success when required Qdrant/provider work failed.

When Python knows that an attempt failed:

* perform best-effort cleanup of hidden points belonging to the exact `job_id + attempt_count`;
* never delete points belonging to another attempt;
* send the existing failure callback when the current contract and runtime state permit it;
* preserve enough safe diagnostics to identify the failure category;
* do not expose secrets, provider internals or private filesystem paths.

Activation failure after an accepted ACK must clean the exact attempt and use the compensation behavior defined by the current contract. Any unresolved or ambiguous post-ACK state must also be covered by `RAG-REC-001`; Python must not invent a new endpoint or state transition.

A Node dispatch timeout is an unknown transport outcome. It does not by itself authorize Python or Node to create a different effective attempt.

## `RAG-REC-001`: bounded MVP recovery

FastAPI `BackgroundTasks` is not a durable execution mechanism. The current snapshot keeps the wire contract unchanged and implements the approved MVP subset: idempotent exact-attempt activation, bounded retry after valid ACK, machine-readable residual logging, READY-versus-active consistency inspection and explicit exact-attempt manual recovery. A durable queue/reconciler remains later work.

### Required invariants

The proposal must preserve all of the following:

* Node remains authoritative for document, job, attempt and terminal business state.
* Recovery is scoped to the exact `job_id + attempt_count`.
* Whole-document success/failure remains unchanged.
* No partial-success lifecycle is introduced.
* Cleanup never removes another attempt’s points.
* Duplicate, stale, conflicting and late callbacks remain safe and idempotent.
* An unreadable or missing ACK never permits activation.
* Retry and reconciliation are bounded.
* A `RUNNING` attempt must not remain unresolved indefinitely.
* No Node database schema, public API or terminal-state transition changes without joint approval.
* Queue or infrastructure vendor selection remains OPTIONAL/LATER unless separately approved.

### Operational limits and later work

The recovery CLI never reads MySQL and therefore requires an operator to verify that the supplied `document_id + job_id + attempt_count` is the exact current Node `READY` attempt. It refuses missing points, partially active points and any other-attempt points for that document. Restart before callback/ACK is still not automatically resumed; a durable queue or scheduler remains OPTIONAL/LATER and would require joint design. New endpoints, callback shapes or state transitions remain prohibited without approval.

## Complete manifest and source provenance

Every manifest chunk must contain:

* `chunk_index`;
* UUID `vector_node_id`;
* full `chunk_text`;
* lowercase SHA-256 `content_hash` calculated over the UTF-8 bytes of exactly `chunk_text`.

Optional fields include:

* `token_count`;
* 1-based `page_number`;
* heading metadata;
* `source_locator`.

`vector_node_id` is the external identity shared by:

* the complete manifest;
* the actual Qdrant point;
* query citations;
* Node citation resolution.

A Python-private `chunk_id` may exist internally, but it must not replace `vector_node_id` or represent a different external point identity. If both names appear in legacy code, the implementation must normalize to the canonical `vector_node_id` contract and reject conflicting values.

For the same attempt and the same input, Python must keep chunk content, hashes, ordering and point identities deterministic.

### Baseline provenance requirements

Python must:

1. associate every citation with the correct document and retrieved vector;
2. return source text taken from the actual cited chunk or relevant fragment, not fabricated text;
3. preserve source text order;
4. keep a chunk inside one canonical PDF page whenever a physical `page_number` or geometry is claimed;
5. use 1-based physical page numbers for canonical PDF artifacts;
6. omit physical page claims for TXT and unverified synthetic/legacy indices;
7. send `source_locator=null` when geometry is absent or untrusted.

These source correctness requirements are part of the baseline citation behavior. They are separate from precise bounding-box occurrence mapping.

### Geometry contract

When present, Node accepts exactly:

```json
{
  "boxes": [
    {
      "x": 0.0,
      "y": 0.0,
      "width": 0.0,
      "height": 0.0
    }
  ]
}
```

Boxes must be:

* ordered in source reading order;
* finite;
* normalized from `0` to `1`;
* relative to a top-left origin;
* positive-sized;
* contained inside the canonical page.

Python must not send:

* full-page placeholder boxes;
* fabricated coordinates;
* one shared box for unrelated chunks;
* geometry derived from a different artifact;
* boxes whose page occurrence is uncertain.

Node validates geometry at manifest and query-citation boundaries. It does not clamp, search, synthesize or backfill invalid geometry.

Node persists accepted chunk geometry and immutable citation snapshot geometry.

### Current geometry scope

No production Python path generating trustworthy `source_locator` has been verified in the tracked snapshot.

This does not block baseline MVP citations, which use:

* document name;
* 1-based page number when trustworthy and available;
* source text.

Precise occurrence-to-box mapping, Qdrant locator preservation and visual highlighting remain **OPTIONAL/LATER** until the Owner explicitly promotes that capability. Only then does `PY-LOC-001` become an implementation and UI acceptance requirement.

## Parser-mode guard and MVP OCR policy

The presence of a provider/API key must not silently change the parser or enable a premium mode. OCR behavior is an MVP requirement; live provider acceptance remains a separate gate because offline tests must not use real credentials.

**Current repair candidate `PY-OCR-001` (uncommitted):**

* `core/config.py` validates explicit `OCR_MODE=OFF|AUTO`; key presence alone leaves `OFF` unchanged;
* `services/parser.py` uses native text for digital pages and calls the OCR provider only for image pages below the configured native-text threshold;
* required OCR timeout, provider failure or empty output raises `OCRProcessingError` and fails the whole ingest;
* `tests/test_parser_ocr.py` provides offline deterministic coverage. Live provider behavior remains **NOT VERIFIED**.

### P1 MVP requirement

Python must add an explicit parser-mode setting with a safe default that does not enable LlamaParse, premium parsing or OCR merely because an API key exists.

Tests must prove, without a real provider, that:

* no relevant key means the safe default;
* key presence alone still means the same safe default;
* the alternate/premium parser runs only when explicitly selected;
* invalid parser mode fails configuration clearly;
* secrets are not exposed in responses or logs.

### OCR policy

The following invariants apply:

* OCR remains Python-owned.
* OCR consumes only the canonical PDF artifact.
* OCR has explicit configuration and defaults OFF.
* Digital pages use native extraction.
* Scan/image-only pages may use OCR.
* Mixed documents are evaluated per page.
* Region OCR inside an otherwise digital page remains OPTIONAL/LATER.
* A genuinely required OCR page that errors or returns invalid output fails the whole ingest.
* A blank or no-text page is not automatically an OCR failure.
* OCR text without trustworthy geometry is valid only with `source_locator=null`.
* Provider errors, secrets and private paths must not cross the public boundary or be logged unsafely.
* OCR cost is not recorded as a chat `llm_usage_logs` row.

Before live OCR acceptance, Owner and Python must verify provider privacy/cost, quota, timeout and file/page limits. These operational decisions do not permit silent fallback or weaken the offline MVP invariants above.

## Query, Markdown, citations and usage

`answer` remains a string containing the supported Markdown/GFM subset.

The following are not CURRENT:

* raw HTML as an output contract;
* chart JSON;
* `edurag-chart`;
* `visualizations`.

`no_answer=false` requires structured citations with:

* stable `vector_node_id`;
* `doc_id`;
* relevant source text.

Node resolves query citations fail-closed against chunks belonging to documents that are `READY + VISIBLE` when message completion is persisted.

Python must not require Node to parse citation markers from answer text. Python remains responsible for converting supported answer markers into structured citations.

`usage_calls[]` must:

* use contiguous 1-based `call_index`;
* record the actual `operation_type`;
* contain actual provider/model usage for each call.

Legacy aggregate `usage` remains compatibility-only and must not replace detailed `usage_calls[]`.

## `PY-MD-001`: Markdown-aware citation extraction

The current `_extract_citations()` scans numeric bracket markers globally. That incorrectly treats syntax such as `array[0]` and markers inside code as citations.

The corrected parser must recognize citation markers only in supported Markdown prose and GFM table cells.

Citation marker numbering is 1-based. `[0]`, negative values, non-numeric brackets and out-of-range values are not valid source references.

The extractor must not globally strip brackets or move citation parsing into Node.

### Required behavior

| Case                                     | Required extraction behavior                                   |
| ---------------------------------------- | -------------------------------------------------------------- |
| Prose: `A supported fact [1].`           | Resolve source 1                                               |
| GFM table cell containing `[2]`          | Resolve source 2                                               |
| Repeated `[1] ... [1]`                   | Return source 1 once; preserve first valid appearance order    |
| Sparse `[3] ... [1]`                     | Resolve sources 3 then 1; do not require contiguous marker use |
| Inline code: `` `value[1]` ``            | Do not treat `[1]` as a citation                               |
| Fenced code containing `[1]`             | Do not treat `[1]` as a citation                               |
| Array/index syntax such as `array[0]`    | Do not treat it as a citation                                  |
| Invalid or out-of-range `[9]`            | Do not fabricate or map a citation                             |
| Mixed valid and invalid markers          | Resolve only valid references                                  |
| Valid marker whose source is unavailable | Do not fabricate a structured citation                         |
| Malformed Markdown                       | Do not crash; produce deterministic extraction                 |
| `no_answer=true`                         | Return no structured citations                                 |

The extractor must preserve the answer string unless answer normalization is separately defined by the canonical contract. Citation extraction itself must not rewrite arbitrary prose, code or bracket syntax.

Tests must cover:

* repeated markers;
* sparse markers;
* mixed valid/invalid markers;
* missing sources;
* Markdown tables;
* inline code;
* fenced code;
* array indexing;
* malformed Markdown;
* stable citation ordering.

## `PY-EVAL-001`: evaluation safety

`python-service/scripts/evaluate_rag.py` must not be used against a non-disposable Qdrant collection in its current form.

The current script can:

* upsert retrieval-active test points;
* import undeclared `pandas`;
* produce random simulation output that is not retrieval-quality evidence.

Before the evaluator is accepted, it must:

* require a disposable test collection;
* reject protected/non-test targets by default;
* require explicit confirmation for any ambiguous target;
* avoid publishing retrieval-active test data outside the disposable environment;
* declare all runtime dependencies;
* exit non-zero on safety or assertion failure;
* distinguish simulation output from actual retrieval evaluation.

## Acceptance scope

### Required now: `PY-MD-001`

Acceptance requires:

* deterministic unit tests without a real provider;
* all required Markdown/citation cases passing;
* no regression in structured citation fields;
* no Node schema, public API or wire-contract change;
* exact Python upstream commit reported.

### MVP acceptance: `RAG-REC-001`

Acceptance requires bounded exact-attempt activation retry, stable failure logging,
fail-closed consistency inspection, explicit manual recovery confirmation and tests that
prove stale/conflicting attempts are never activated. The current snapshot satisfies
this offline; upstreaming and live operational acceptance remain.

### Integration verification: `INT-E2E-001`

Run isolated Node, Python, Qdrant and MySQL runtimes using pinned revisions and disposable test data.

The acceptance flow must prove:

```text
upload
→ job RUNNING
→ Python parse/chunk/embed
→ hidden Qdrant upsert
→ complete-manifest callback
→ Node transaction and ACK
→ exact-attempt activation
→ query
→ structured citation and usage persistence
→ hide
→ retrieval exclusion
→ unhide
→ retrieval inclusion
→ delete
→ retrieval exclusion
```

The run must also verify:

* current PDF path;
* current TXT path;
* DOCX runtime conversion to a persistent canonical PDF;
* Python ingesting the derived PDF rather than the original DOCX;
* physical page numbering and citation behavior where applicable;
* exact retry/idempotent callback behavior;
* no enabled orphan points after the tested terminal paths.

Record:

* Node commit;
* Python upstream commit;
* tracked snapshot revision;
* provider and model;
* parser mode;
* disposable Qdrant collection;
* test commands;
* PASS/FAIL/BLOCKED result;
* relevant sanitized logs or assertions.

Mock RAG, offline fixtures and historical E2E results must be labelled separately and do not satisfy this live gate.

### Required OCR acceptance and conditional geometry acceptance

**OCR (required MVP, provider mocked for default tests):**

* digital PDF;
* scan-only PDF;
* mixed PDF;
* blank page;
* rotated page;
* Vietnamese OCR;
* timeout;
* provider error;
* invalid OCR-empty output.

**Geometry and precise highlighting:**

* repeated text on one page;
* multi-line citation;
* multiple ordered boxes;
* crop and rotation handling;
* locator-null fallback;
* visual overlay verification against the canonical PDF.

Geometry fixtures remain conditional because precise highlighting is OPTIONAL/LATER. OCR fixtures are required; a live provider run may remain `NOT RUN` until an approved credential/quota environment exists.

## Expected return from the Python team

For every completed or proposed action, return:

1. Python upstream repository branch and exact commit.
2. Files changed.
3. Short implementation summary.
4. Test commands executed.
5. Result for each command: `PASS`, `FAIL`, `BLOCKED` or `NOT RUN`.
6. Contract fixture results.
7. Live integration evidence, or an explicit `NOT RUN`.
8. Provider, model, parser mode and disposable Qdrant collection when applicable.
9. Known limitations or remaining risks.
10. Decisions required from Node/Core or Owner.
11. Confirmation that Node schema, public API and approved wire contract were not changed, or an explicit list of proposed changes awaiting approval.

Do not present snapshot inspection, mock tests or historical results as current upstream/live acceptance.

## Action order

1. **P0 delivery:** upstream the verified `PY-MD-001` and `RAG-REC-001` snapshot changes.
2. **P0 integration:** run `INT-E2E-001` on exact pinned revisions with the real Node app/provider after the offline repair is accepted.
3. **P1 MVP:** upstream `PY-OCR-001`; keep live-provider evidence separate.
4. **P1 Python tooling:** upstream `PY-EVAL-001` and retain the canonical-target refusal test.
5. **P2 OPTIONAL/LATER:** implement `PY-LOC-001` only if the Owner promotes precise highlighting.

The earlier [OCR/Markdown handoff](python-rag-ocr-markdown-handoff.md) remains a supporting findings record. Where it differs from this canonical action register, this document takes precedence.
