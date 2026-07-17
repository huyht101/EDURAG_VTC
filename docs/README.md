# EDURAG documentation

Tài liệu hiện hành của NodeJS/Core. Khi tài liệu lệch runtime, ưu tiên code, [`schema.sql`](../src/database/schema.sql), automated tests và OpenAPI.

## Đọc file nào?

| Mục đích | Tài liệu canonical |
|---|---|
| Chạy nhanh project | [Root README](../README.md) |
| Chạy mock hoặc Node local | [Local/mock development](setup/local-development.md) |
| Chạy Docker Node + Python + Qdrant, Swagger và lifecycle | [Remote Docker RAG](setup/remote-rag-e2e.md) |
| Hiểu ownership và data flow | [System overview](architecture/system-overview.md) |
| Tra public role/workflow/conventions | [Public API](api/public-api.md); endpoint detail nằm trong Swagger |
| Tích hợp NodeJS-Python | [Internal RAG contract](api/internal-rag-contract.md) |
| Hiểu/export/restore corpus | [Corpus portability](architecture/corpus-portability.md) |
| Review schema | [Database index](database/README.md) |
| Kiểm thử độc lập | [Independent test plan](testing/week3-remote-test-plan.md) |
| Xem trạng thái hiện tại | [Week 3 readiness](status/week3-integration-readiness.md) |
| Refresh Python snapshot | [Python snapshot](architecture/python-rag.md) và [refresh guide](setup/python-snapshot-refresh.md) |

## Kiến trúc và module

- [NodeJS/Core layering](architecture/nodejs-core.md)
- [NodeJS-Python boundary](architecture/rag-boundary.md)
- [Python integration snapshot](architecture/python-rag.md)
- Modules: [Account/Auth](modules/account-auth.md), [Documents](modules/documents.md), [Chat/Citations](modules/chat-citations.md), [Usage/Dashboard](modules/usage-dashboard.md)
- [Mermaid flow index](flows/README.md)

## Nguồn chi tiết

- Public endpoints/request/response/error: Swagger `/api-docs` và OpenAPI `/api-docs.json`.
- Database constraints/status/indexes: [`src/database/schema.sql`](../src/database/schema.sql).
- NodeJS-Python JSON boundary: [contract v0.1](api/internal-rag-contract.md).
- Corpus files/count/checksum: [`bootstrap/corpus/manifest.json`](../bootstrap/corpus/manifest.json).
- Python production source: upstream repository của team Python; `python-service/` chỉ là tracked snapshot.
