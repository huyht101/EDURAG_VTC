# Database documentation

## Source of truth

- [`src/database/schema.sql`](../../src/database/schema.sql): executable schema 1.0.0, 12 tables, constraints/indexes và role seed.
- [`src/database/demo_seed.sql`](../../src/database/demo_seed.sql): local Demo Admin; không phải business schema.
- [Design](design.md): ownership, relationships và lifecycle.
- [Data dictionary](data-dictionary.md): column/key/status theo domain.

Khi Markdown lệch DDL/runtime repository, ưu tiên `schema.sql` và sửa tài liệu. Không có DDL copy thứ hai trong `docs/`.

## Bootstrap

MySQL 8.4 container chạy schema rồi demo seed trên fresh volume. Setup command và reset safety nằm tại [Local/mock development](../setup/local-development.md) và [Remote Docker RAG](../setup/remote-rag-e2e.md); không chạy raw destructive Compose command từ tài liệu database.

Demo Admin `admin@example.com / 123456` chỉ dành cho local. Seed idempotent theo email và không overwrite user đã tồn tại.

## Migration limitation

`CREATE TABLE IF NOT EXISTS` hỗ trợ bootstrap lặp nhưng không phải migration. Khi có dữ liệu cần giữ, thay đổi schema phải dùng migration versioned; chỉnh DDL không tự ALTER database cũ.
