# Data dictionary

Dictionary được chia theo domain để review dễ hơn:

- [Account and authentication](dictionary/account.md)
- [Documents and processing](dictionary/documents.md)
- [Chat, citations and usage](dictionary/chat-citations-usage.md)

## `schema_migrations` migration ledger

`schema_migrations` không phải business table nhưng là một phần của executable schema:

| Column | Type/null/default | Key/index | Meaning |
|---|---|---|---|
| `name` | VARCHAR(255) ASCII binary, required | PK | Tên migration đã apply; append-only |
| `applied_at` | DATETIME(3), default `CURRENT_TIMESTAMP(3)` | — | Thời điểm ghi ledger UTC |

Fresh bootstrap ghi tên các migration đã được fold vào `schema.sql`; database hiện hữu
dùng `npm run db:migrate`. MySQL DDL auto-commit limitation được ghi tại
[database index](README.md#migration-and-recovery-limitation).

Conventions:

- Timestamps là `DATETIME(3)` và application dùng UTC.
- ID nghiệp vụ là unsigned integer; vector/request IDs là UUID `CHAR(36)`.
- Status/code dùng ASCII binary collation và giá trị uppercase.
- `NULL` thể hiện dữ liệu chưa có/không áp dụng; generated/default ghi rõ trong từng bảng.
- Mọi FK/UNIQUE/CHECK/index canonical nằm trong [`schema.sql`](../../src/database/schema.sql).
