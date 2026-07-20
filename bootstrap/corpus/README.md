# EDURAG portable corpus

This directory is a coordinated, sanitized MySQL + Qdrant export. It is not bidirectional synchronization.

- Original PDF/DOCX/TXT binaries are intentionally excluded from Git; approved files may be restored separately from private GCS.
- Restore only into bootstrap-empty MySQL/Qdrant volumes with `npm run corpus:restore`.
- Validate checksums and compatibility with `npm run corpus:verify`.
- Query/citation snapshots remain available without GCS. Original-file download requires a successful GCS restore or new upload; reprocess still requires upload.

See [corpus portability](../../docs/architecture/corpus-portability.md) for lifecycle and limitations.
