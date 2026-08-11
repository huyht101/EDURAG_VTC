# Tài liệu database

## Nguồn executable authority

- [`src/database/schema.sql`](../../src/database/schema.sql): executable schema 1.0.0,
  12 business tables plus the `schema_migrations` ledger, constraints/indexes and role seed.
- [`src/database/demo_seed.sql`](../../src/database/demo_seed.sql): local Demo Admin; không phải business schema.
- [Thiết kế](design.md): ownership, relationship và lifecycle.
- [Data dictionary](data-dictionary.md): column/key/status theo domain.

Khi Markdown lệch DDL/runtime repository, ưu tiên `schema.sql` và sửa tài liệu. Không có DDL copy thứ hai trong `docs/`.

## Bootstrap database

MySQL 8.4 container chạy schema rồi demo seed trên fresh volume. Setup command và reset safety nằm tại [Local/mock development](../setup/local-development.md) và [Remote Docker RAG](../setup/remote-rag-e2e.md); không chạy raw destructive Compose command từ tài liệu database.

Demo Admin `admin@example.com / 123456` chỉ dành cho local. Seed idempotent theo email và không overwrite user đã tồn tại.

## Giới hạn migration và recovery

`CREATE TABLE IF NOT EXISTS` hỗ trợ bootstrap lặp nhưng không phải migration. Khi có dữ liệu cần giữ, thay đổi schema phải dùng migration versioned; chỉnh DDL không tự ALTER database cũ.

Fresh bootstrap ghi tên hai migration hiện có vào ledger vì kết quả của chúng đã nằm
trong `schema.sql`. Với database hiện hữu, `npm run db:migrate` dùng named MySQL lock và
apply pending files theo lexical order. MySQL DDL auto-commit, còn runner chỉ ghi ledger
sau khi mọi statement hoàn tất. Vì vậy multi-statement migration bị ngắt cần inspect
schema và có repair plan trước rerun; thiếu ledger row không có nghĩa chưa statement nào
đã chạy. Xem `DB-MIG-001` trong [issue register](../status/issue-quality-register.md).
