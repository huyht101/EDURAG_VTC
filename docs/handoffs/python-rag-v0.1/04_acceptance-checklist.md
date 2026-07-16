# Acceptance checklist

## Static

- [ ] Python compiles.
- [ ] Python tests pass without live Gemini/Qdrant.
- [ ] No real secret or `.env` is added.
- [ ] No database/public Node API change.

## Inbound API

- [ ] All Node → Python routes reject missing/invalid Bearer with 401.
- [ ] Correct token is accepted.
- [ ] Visibility accepts `action=hide|unhide`.
- [ ] Delete accepts its request body.
- [ ] Processing `attempt_count` is accepted for ingest/visibility/delete.

## Callback

- [ ] Processing attempt remains unchanged across HTTP delivery retries.
- [ ] Successful ingest returns `chunk_manifest`.
- [ ] Every manifest item has full text and matching SHA-256.
- [ ] UUID is the actual Qdrant point ID.
- [ ] Failure/progress callbacks retain processing attempt.

## Query

- [ ] History roles remain lowercase.
- [ ] Confidence remains `high|medium|low`.
- [ ] No-answer returns success with zero citations.
- [ ] Every citation has `vector_node_id` and `snippet`/`source_text`.
- [ ] Usage only reports fields actually available.

## Contract evidence

- [ ] Shared fixtures parse.
- [ ] Python boundary tests cover valid and invalid tokens.
- [ ] Tests cover callback delivery retry without changing processing attempt.
- [ ] Tests cover complete manifest/hash.
- [ ] Tests cover citation point ID.

## Before remote E2E

- [ ] Deployment topology selected.
- [ ] Shared read-only Python upload mount verified.
- [ ] Service/callback URLs resolve in both directions.
- [ ] One Qdrant owner confirmed.
