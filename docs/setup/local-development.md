# Local development

## Yêu cầu

- Node.js 20+
- npm tương thích lockfile
- MySQL 8.4, có thể chạy bằng Docker

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run check
npm run test:contract
npm start
```

`.env.example` chứa credential demo local. Thay secret khi làm ngoài demo và không commit `.env`. Integrated stack chỉ đọc root `.env`; `python-service/.env` chỉ dành cho Python standalone và không được root Compose đọc.

Nếu chạy toàn bộ bằng Docker, ưu tiên các script chuẩn thay vì tự ghép Compose flags hoặc đặt biến terminal:

```powershell
npm run docker:mock:up
# hoặc
npm run docker:remote:up
npm run preflight:remote
```

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
npm run test:contract
npm run test:part2
npm run docker:mock:config
```

Smoke suite tự đọc root `.env` và cố định `RAG_MODE=mock`; không cần export biến trong terminal và không gọi Python/provider. Suite cần MySQL đã bootstrap và Demo Admin, tạo dữ liệu test có suffix ngẫu nhiên, rồi dùng HTTP thật trên một cổng tạm. Chỉ chạy trên development database; cách ít lỗi nhất là chạy `npm run docker:mock:up` trước.

## RAG modes

`RAG_MODE=mock` không cần Python và vẫn là default. Với `RAG_MODE=remote`:

- NodeJS và Python phải dùng cùng `RAG_INTERNAL_TOKEN`;
- `RAG_SHARED_UPLOAD_DIR` là absolute path Python nhìn thấy cho cùng upload root;
- `RAG_CALLBACK_URL` phải truy cập được từ Python;
- dispatch dùng `RAG_REQUEST_TIMEOUT_MS`, query dùng `RAG_QUERY_TIMEOUT_MS`;
- `RAG_CALLBACK_BODY_LIMIT` chỉ giới hạn internal complete-manifest callback, mặc định `25mb`;
- `RAG_DEFAULT_SUBJECT_ID=mvp-global` chỉ là compatibility shim, không phải public subject scope.

### Topology A: Node trong Docker, Python trên host

- `RAG_SERVICE_URL=http://host.docker.internal:8000`.
- Python host callback tới `http://localhost:${APP_HOST_PORT}/api/internal/rag/processing-callback`.
- Named upload volume hiện tại không cung cấp host path ổn định. Dùng Compose override để bind một host directory vào Node `UPLOAD_DIR`, rồi đặt `RAG_SHARED_UPLOAD_DIR` thành absolute path của cùng directory theo góc nhìn Python host.
- Không commit path máy cá nhân và không gửi container-only path `/usr/src/app/uploads` cho Python host.

### Topology B: Node và Python trong cùng Docker network

- `RAG_SERVICE_URL=http://rag-service:8000`.
- `RAG_CALLBACK_URL=http://app:5000/api/internal/rag/processing-callback`.
- Dùng một explicit shared volume: Node mount read-write tại `UPLOAD_DIR`; Python mount read-only tại `/shared/uploads`; Node đặt `RAG_SHARED_UPLOAD_DIR=/shared/uploads`.
- Nếu dùng hai Compose project, network và volume phải được khai báo external ở cả hai. Không dùng `localhost` giữa containers.
- Chỉ Python sở hữu Qdrant. Root override [`docker-compose.remote.yml`](../../docker-compose.remote.yml) triển khai topology cô lập này; xem [remote E2E setup](remote-rag-e2e.md).

Topology B là luồng chuẩn của repository. `REMOTE_COMPOSE_PROJECT`, host ports và provider/model settings đều nằm trong root `.env`; các npm script `docker:remote:*` đã chứa Compose files/profile nên không cần `$env:` hay `-p` ở terminal.

Contract tests không gọi Python thật. `npm run preflight:remote` chỉ chứng minh topology; `npm run test:remote` mới chạy lifecycle live. Xem [internal contract v0.1](../api/internal-rag-contract.md) và [independent test plan](../testing/week3-remote-test-plan.md).

`python-service/` chỉ là tracked integration snapshot; xem [refresh guide](python-snapshot-refresh.md). Kiểm tra upstream repository của team Python trước khi kết luận snapshot là bản mới nhất.
