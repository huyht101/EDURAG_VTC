# Documents and processing dictionary

## `documents`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Document ID; Python receives `String(id)` |
| `uploaded_by` | BIGINT UNSIGNED, required | FK `users.id` RESTRICT; owner index | Teacher/Admin owner |
| `title` | VARCHAR(255), required | — | Mutable display title |
| `original_filename` | VARCHAR(255), required | — | Sanitized original name |
| `storage_type` | VARCHAR(20), default `LOCAL` | UNIQUE with key, CHECK | `LOCAL` or future `OBJECT` |
| `storage_key` | VARCHAR(512), required | UNIQUE with type | Relative case-sensitive key; never public |
| `file_type` | VARCHAR(20), required | CHECK | Schema: `TXT`, `DOCX`, `PDF`, `PPTX`; service currently accepts first three |
| `mime_type` | VARCHAR(127), required | — | Validated MIME |
| `file_size_bytes` | BIGINT UNSIGNED, required | CHECK `>0` | Original size |
| `checksum_sha256` | CHAR(64), required | index | File digest; not unique |
| `processing_status` | VARCHAR(20), default `UPLOADED` | retrieval index, CHECK | `UPLOADED`, `PROCESSING`, `READY`, `FAILED`, `CANCELLED` |
| `visibility_status` | VARCHAR(20), default `VISIBLE` | owner/retrieval indexes, CHECK | `VISIBLE`, `HIDDEN`, `DELETED` |
| `processed_at` | DATETIME(3), nullable | CHECK with READY | Current successful processing time |
| `deleted_at` | DATETIME(3), nullable | CHECK with DELETED | Soft-delete time |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | list indexes include created | Audit timestamps |

`READY` requires `processed_at`. `DELETED` requires `deleted_at`; non-DELETED requires it null. MVP retains the original file and history after soft delete.

## `document_processing_jobs`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Job ID |
| `document_id` | BIGINT UNSIGNED, required | FK `documents.id` RESTRICT; history index | Target document |
| `job_type` | VARCHAR(32), required | CHECK | `INGEST`, `REPROCESS`, `SET_RETRIEVAL`, `DELETE_VECTORS` |
| `status` | VARCHAR(20), default `QUEUED` | status index, CHECK | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| `current_stage` | VARCHAR(32), nullable | — | High-level Python stage |
| `attempt_count` | TINYINT UNSIGNED, default 0 | CHECK with max | Incremented before dispatch; callback stale guard |
| `max_attempts` | TINYINT UNSIGNED, default 3 | CHECK `>=1` | Retry ceiling; no scheduler in MVP |
| `pipeline_version` | VARCHAR(50), nullable | — | Pipeline identity |
| `parser_name` | VARCHAR(100), nullable | — | Parser result metadata |
| `embedding_model` | VARCHAR(150), nullable | — | Model metadata from Python |
| `embedding_dimension` | SMALLINT UNSIGNED, nullable | CHECK positive | Vector dimension metadata |
| `vector_collection` | VARCHAR(128), nullable | — | Collection metadata, not used by NodeJS directly |
| `job_config` | JSON, nullable | — | Operation target/config |
| `total_chunks` | INT UNSIGNED, nullable | — | Persisted manifest size |
| `error_code` | VARCHAR(64), nullable | — | Stable failure code |
| `error_message` | VARCHAR(2000), nullable | — | Diagnostic message |
| `started_at`, `finished_at` | DATETIME(3), nullable | — | Attempt lifecycle UTC |
| `callback_received_at` | DATETIME(3), nullable | — | Last callback UTC |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | history/status indexes | Audit timestamps |

## `document_chunks`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | MySQL source chunk ID |
| `document_id` | BIGINT UNSIGNED, required | FK `documents.id` RESTRICT; UNIQUE with index | Parent document |
| `processing_job_id` | BIGINT UNSIGNED, required | FK `document_processing_jobs.id` RESTRICT; index | Producing job |
| `chunk_index` | INT UNSIGNED, required | UNIQUE with document | Zero-based manifest order |
| `vector_node_id` | CHAR(36), required | UNIQUE | LlamaIndex node ID and Qdrant point ID |
| `chunk_text` | TEXT, required | — | Parent source chunk snapshot |
| `content_hash` | CHAR(64), required | — | Chunk SHA-256 |
| `token_count` | INT UNSIGNED, nullable | CHECK positive | Optional count |
| `page_number` | INT UNSIGNED, nullable | CHECK `>=1` | PDF page, 1-based |
| `section_title` | VARCHAR(500), nullable | — | DOCX/TXT/PDF section |
| `source_locator` | JSON, nullable | — | Paragraph/offset/bounding metadata extension |
| `created_at` | DATETIME(3), auto UTC | — | Persist time |

`document_chunks` is the only MySQL vector mapping table in MVP. NodeJS does not store embeddings.
