# Database documentation

## Source of truth

- [`src/database/schema.sql`](../../src/database/schema.sql): executable schema 1.0.0,
  12 business tables plus the `schema_migrations` ledger, constraints/indexes and role seed.
- [`src/database/demo_seed.sql`](../../src/database/demo_seed.sql): local Demo Admin; không phải business schema.
- [Design](design.md): ownership, relationships và lifecycle.
- [Data dictionary](data-dictionary.md): column/key/status theo domain.

Khi Markdown lệch DDL/runtime repository, ưu tiên `schema.sql` và sửa tài liệu. Không có DDL copy thứ hai trong `docs/`.

## Bootstrap

MySQL 8.4 container chạy schema rồi demo seed trên fresh volume. Setup command và reset safety nằm tại [Local/mock development](../setup/local-development.md) và [Remote Docker RAG](../setup/remote-rag-e2e.md); không chạy raw destructive Compose command từ tài liệu database.

Demo Admin `admin@example.com / 123456` chỉ dành cho local. Seed idempotent theo email và không overwrite user đã tồn tại.

## Migration and recovery limitation

`CREATE TABLE IF NOT EXISTS` hỗ trợ bootstrap lặp nhưng không phải migration. Khi có dữ liệu cần giữ, thay đổi schema phải dùng migration versioned; chỉnh DDL không tự ALTER database cũ.

Fresh bootstrap inserts both existing migration names into the ledger because their
result is already present in `schema.sql`. For an existing database, `npm run db:migrate`
uses a named MySQL lock and applies lexically sorted pending files. MySQL DDL auto-commits;
the current runner records the ledger only after all statements complete. Therefore an
interrupted multi-statement migration requires schema inspection and an explicit repair
plan before rerun; do not assume the missing ledger row means no DDL ran. See `DB-MIG-001`
in the [issue register](../status/issue-quality-register.md).
