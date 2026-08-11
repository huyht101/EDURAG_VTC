# Từ điển dữ liệu

Dictionary được chia theo domain để review dễ hơn:

- [Account và xác thực](dictionary/account.md)
- [Document và processing](dictionary/documents.md)
- [Chat, citation và usage](dictionary/chat-citations-usage.md)

## Migration ledger `schema_migrations`

`schema_migrations` không phải business table nhưng là một phần của executable schema:

| Column | Kiểu/null/default | Khóa/index | Ý nghĩa |
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
