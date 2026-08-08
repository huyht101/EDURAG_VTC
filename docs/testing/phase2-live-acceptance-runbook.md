# Phase 2 live acceptance runbook

Owner-run only. Phase 1 proved the production Node/MySQL/Python/Qdrant boundary with
deterministic local providers and synthetic corpus. Publication, pointer changes and local
reset require explicit Owner authorization for the exact target/release. This runbook never
authorizes IAM changes or deletion/overwrite of an immutable cloud release.

## Preconditions

- Review/commit the exact Node and Python revisions; record both SHAs.
- Use a new isolated Compose project, ports, database, uploads volume and Qdrant
  collection. Confirm they do not match an existing project before startup.
- Corpus reader: private GCS service account with Storage Object Viewer only. Keep its
  JSON outside Git and do not print it. Live OCR/embedding/LLM credentials are supplied
  through the approved secret channel; record provider/model names, never values.
- Owner approves expected provider cost, private-document processing and the exact test
  fixtures (digital, scanned, mixed and blank PDF).

## Commands and gates

1. Read/download/verify the selected immutable release without changing the pointer:

   ```powershell
   npm ci
   npm run corpus:verify
   ```

   PASS: release ID and manifest checksum equal `bootstrap/corpus-release.json`; every
   artifact checksum, schema compatibility and embedding model/dimension pass. Then run
   `npm run corpus:reset -- --dry-run` against the isolated project: its disposable-Qdrant
   preflight must prove `is_active`, `is_hidden` and `ingest_attempt_key` before any local
   mutation. FAIL: stop on missing legacy lifecycle payload, mismatch, permission,
   integrity or compatibility error.

2. Restore only into the isolated project, then run health and cross-store checks:

   ```powershell
   npm run docker:remote:dev
   npm run preflight:remote
   ```

   PASS: MySQL documents/chunks, originals and Qdrant point identities/counts agree;
   marker release/checksum agrees with dynamic inventory. Do not re-ingest to hide a
   mismatch.

3. Run the repository remote acceptance against live approved providers. Cover upload
   through hidden upsert, callback/ACK/activate, query/citation/usage and hide/unhide/delete
   for digital, scanned, mixed and blank PDFs. Inject pre-ACK failure, post-ACK activation
   failure and an uncertain ACK; verify no false READY/wrong-attempt activation and that
   exact manual recovery is idempotent.

   PASS: citations resolve to the correct document/page/source text; required scanned
   pages do not silently disappear; blank pages are not false OCR failures; usage is
   non-negative and provider errors are sanitized. FAIL: stop on fallback provider/model,
   partial success, stale activation, invalid citation or residual inconsistency.

## Legacy release decision

If the selected release lacks `is_active` or fails compatibility, do not modify it. A
corpus writer may create and verify a new immutable release only after Owner approval.
Upload all artifacts, read them back, verify checksums/equivalence, and update the pointer
only after that verification passes and the Owner explicitly approves the new release.
The writer configuration must satisfy the private-target guard. Normally the tool verifies
Public Access Prevention or IAM metadata directly. If a least-privilege `corpus-writer`
has object Viewer + Creator but bucket-metadata introspection returns 403, an Owner may set
`GCS_PRIVATE_TARGET_OWNER_ATTESTATION` to the exact `project-id/bucket-name` after checking
that target in Cloud Console. The fallback is exact-target and writer-identity bound, is
logged, and remains fail-closed for missing/mismatched attestation, unauthenticated or
wrong credentials, public targets and object-prefix collisions. It must not be used with
a reader-only identity.

## Cleanup and evidence

- Save only sanitized SHAs, release ID/checksum, model names, counts and PASS/FAIL results.
- Stop and remove only the exact isolated project and its volumes after evidence capture.
- Confirm pre-existing containers, networks, volumes, canonical database, originals,
  Qdrant collection and remote releases are unchanged.
- Record provider cost/quota anomalies and residual resources. Never attach credentials,
  signed URLs, document content or raw provider responses.
