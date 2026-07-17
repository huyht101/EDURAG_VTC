# EDURAG portable corpus

This directory is a coordinated, sanitized MySQL + Qdrant export. It is not bidirectional synchronization.

- Original PDF/DOCX/TXT files are intentionally excluded.
- Restore only into bootstrap-empty MySQL/Qdrant volumes with `npm run corpus:restore`.
- Validate checksums and compatibility with `npm run corpus:verify`.
- Query/citation snapshots remain available; original-file download and reprocess require a new upload.

See [corpus portability](../../docs/architecture/corpus-portability.md) for lifecycle and limitations.
