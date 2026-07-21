# Chat, citations and usage dictionary

## `chat_sessions`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Session ID |
| `user_id` | BIGINT UNSIGNED, required | FK `users.id` RESTRICT; history index | Owner |
| `title` | VARCHAR(255), nullable | — | Optional title |
| `last_message_at` | DATETIME(3), nullable | history index | Last completed interaction time |
| `deleted_at` | DATETIME(3), nullable | history index | Soft delete |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | — | Audit timestamps |

## `chat_messages`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Message ID |
| `session_id` | BIGINT UNSIGNED, required | FK `chat_sessions.id` RESTRICT; UNIQUE with order | Parent session |
| `sender_type` | VARCHAR(20), required | CHECK | `USER` or `ASSISTANT` |
| `message_order` | INT UNSIGNED, required | UNIQUE with session, CHECK `>=1` | Stable linear order |
| `content` | MEDIUMTEXT, nullable | — | Question/answer; pending/failed assistant may be null |
| `status` | VARCHAR(20), default `COMPLETED` | CHECK | `PENDING`, `COMPLETED`, `FAILED` |
| `no_answer` | BOOLEAN, default false | CHECK | True only for assistant |
| `client_request_id` | CHAR(36), nullable | UNIQUE, CHECK USER-only | Client idempotency UUID |
| `error_code` | VARCHAR(64), nullable | — | Assistant failure code |
| `completed_at` | DATETIME(3), nullable | — | Completion/failure time |
| `created_at`, `updated_at` | DATETIME(3), auto UTC | — | Audit timestamps |

Service khóa session row trước khi tính `MAX(message_order)+1`, nên một question luôn tạo cặp USER/ASSISTANT liên tiếp.

## `citations`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Citation ID |
| `message_id` | BIGINT UNSIGNED, required | FK `chat_messages.id` RESTRICT; UNIQUE with order | Assistant message |
| `document_id` | BIGINT UNSIGNED, nullable | FK `documents.id` SET NULL; index | Current document reference |
| `chunk_id` | BIGINT UNSIGNED, nullable | FK `document_chunks.id` SET NULL; index | Parent chunk reference |
| `vector_node_id_snapshot` | CHAR(36), required | — | Immutable source node ID |
| `citation_order` | SMALLINT UNSIGNED, required | UNIQUE with message; CHECK `>=1` | Display order |
| `document_title_snapshot` | VARCHAR(255), required | — | Immutable title |
| `page_number_snapshot` | INT UNSIGNED, nullable | CHECK `>=1` | Immutable 1-based page/synthetic segment |
| `section_title_snapshot` | VARCHAR(500), nullable | — | Immutable section |
| `source_text_snapshot` | TEXT, required | — | Actual cited fragment, not necessarily whole chunk |
| `source_locator_snapshot` | JSON, nullable | — | Immutable locator |
| `retrieval_score`, `rerank_score` | DOUBLE, nullable | — | Scores when Python supplies them |
| `created_at` | DATETIME(3), auto UTC | — | Persist time |

One chunk may produce multiple citation fragments. Only `(message_id, citation_order)` is unique.

## `llm_usage_logs`

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `id` | BIGINT UNSIGNED, auto | PK | Usage row |
| `user_id` | BIGINT UNSIGNED, nullable | FK `users.id` SET NULL; user/time index | Requesting user |
| `message_id` | BIGINT UNSIGNED, nullable | FK `chat_messages.id` SET NULL; index | Assistant message |
| `request_id` | CHAR(36), required | UNIQUE with call index | RAG request UUID |
| `call_index` | SMALLINT UNSIGNED, default 1 | UNIQUE with request; CHECK `>=1` | Per-request call order |
| `operation_type` | VARCHAR(32), required | CHECK | `QUERY_REWRITE`, `ANSWER_GENERATION`, `REFINE`, `OTHER` |
| `provider` | VARCHAR(50), required | — | LLM provider |
| `model` | VARCHAR(150), required | — | Model name |
| `prompt_tokens` | INT UNSIGNED, default 0 | — | Prompt tokens |
| `completion_tokens` | INT UNSIGNED, default 0 | — | Completion tokens |
| `total_tokens` | INT UNSIGNED, generated | — | Prompt + completion |
| `estimated_cost` | DECIMAL(18,8), nullable | CHECK non-negative | Optional estimate |
| `currency` | CHAR(3), default `USD` | — | ISO-like uppercase code |
| `latency_ms` | INT UNSIGNED, nullable | — | Call latency |
| `status` | VARCHAR(20), required | CHECK | `SUCCEEDED` or `FAILED` |
| `error_code` | VARCHAR(64), nullable | — | Failed call code |
| `created_at` | DATETIME(3), auto UTC | time indexes | Persist time |

Rows cover LLM calls only; they are not full OCR/embedding/reranking cost accounting.
