# Data dictionary

Dictionary được chia theo domain để review dễ hơn:

- [Account and authentication](dictionary/account.md)
- [Documents and processing](dictionary/documents.md)
- [Chat, citations and usage](dictionary/chat-citations-usage.md)

Conventions:

- Timestamps là `DATETIME(3)` và application dùng UTC.
- ID nghiệp vụ là unsigned integer; vector/request IDs là UUID `CHAR(36)`.
- Status/code dùng ASCII binary collation và giá trị uppercase.
- `NULL` thể hiện dữ liệu chưa có/không áp dụng; generated/default ghi rõ trong từng bảng.
- Mọi FK/UNIQUE/CHECK/index canonical nằm trong [`schema.sql`](../../src/database/schema.sql).
