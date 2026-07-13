# Database

## Nguồn sự thật

- [`src/database/schema.sql`](../../src/database/schema.sql): executable DDL, schema version 1.0.0, 12 bảng, constraints, indexes và ba role.
- [`src/database/demo_seed.sql`](../../src/database/demo_seed.sql): dữ liệu **DEMO ONLY**, không phải business schema.
- [Design](design.md): quan hệ, ownership và lifecycle.
- [Data dictionary](data-dictionary.md): kiểu cột, key, index và allowed values.

Nếu Markdown và SQL mâu thuẫn, kiểm tra DDL/runtime repository trước và sửa tài liệu. Không có bản DDL thứ hai trong `docs/`.

## Docker bootstrap

```powershell
docker compose down -v
docker compose up --build
```

MySQL image tự chạy schema rồi demo seed trên fresh volume. Demo MySQL dùng `root / 123456`; Demo Admin dùng `admin@example.com / 123456`. Đây là credential local/demo không an toàn cho production.

Chạy seed lại thủ công không tạo duplicate và không overwrite Admin hiện có:

```powershell
docker compose exec -T db mysql -uroot -p123456 edurag -e "source /docker-entrypoint-initdb.d/02_demo_seed.sql"
```

## Migration limitation

`CREATE TABLE IF NOT EXISTS` giúp bootstrap không phá bảng hiện có nhưng không phải migration. Sau khi có dữ liệu cần giữ, mọi thay đổi schema phải dùng migration versioned; không chỉnh DDL rồi kỳ vọng nó ALTER database cũ.
