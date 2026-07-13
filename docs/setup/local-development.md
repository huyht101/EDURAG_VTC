# Local development

## Yêu cầu

- Node.js 20+
- npm tương thích lockfile
- MySQL 8.4, có thể chạy bằng Docker

```powershell
Copy-Item .env.example .env
npm ci
npm run check
npm start
```

`.env.example` chứa credential demo local. Thay secret khi làm ngoài demo và không commit `.env`.

Nếu chỉ cần MySQL:

```powershell
docker compose up -d db
```

Bootstrap thủ công trên database sạch:

```powershell
Get-Content src/database/schema.sql | mysql -uroot -p123456
Get-Content src/database/demo_seed.sql | mysql -uroot -p123456
```

Demo seed chỉ insert Admin khi email chưa tồn tại; không overwrite password hoặc profile khi chạy lại.

## Checks

```powershell
npm run check
npm run test:part2
docker compose config --quiet
```

Smoke suite cần database đã bootstrap, Demo Admin và các env bắt buộc. Nó tạo dữ liệu test có suffix ngẫu nhiên và dùng HTTP thật trên một cổng tạm; chỉ chạy trên development database.
