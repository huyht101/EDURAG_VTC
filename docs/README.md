# EDURAG documentation

Tài liệu hiện hành của NodeJS/Core. Khi có khác biệt, ưu tiên runtime code, [`schema.sql`](../src/database/schema.sql), automated tests và OpenAPI.

| Mục đích | Tài liệu canonical |
|---|---|
| Chạy nhanh | [Root README](../README.md) |
| Chạy mock/Node local | [Local development](setup/local-development.md) |
| Chạy full Docker, cloud restore và Swagger | [Remote Docker RAG](setup/remote-rag-e2e.md) |
| Hiểu system ownership | [System overview](architecture/system-overview.md) |
| Hiểu cloud corpus release | [Corpus portability](architecture/corpus-portability.md) |
| Tra public role/workflow | [Public API](api/public-api.md); endpoint detail ở Swagger |
| Tích hợp NodeJS–Python | [Internal RAG contract](api/internal-rag-contract.md) |
| Theo dõi debt phía Python | [Python/Data-RAG handoff](architecture/python-rag-handoff.md) |
| Tra database | [Database index](database/README.md) |
| Kiểm thử độc lập | [Week 3 test plan](testing/week3-remote-test-plan.md) |
| Xem readiness hiện tại | [Week 3 readiness](status/week3-integration-readiness.md) |
| Refresh Python snapshot | [Python snapshot](architecture/python-rag.md) và [refresh guide](setup/python-snapshot-refresh.md) |

Tài liệu module: [Account/Auth](modules/account-auth.md), [Documents](modules/documents.md), [Chat/Citations](modules/chat-citations.md), [Usage/Dashboard](modules/usage-dashboard.md). Mermaid sources nằm tại [flow index](flows/README.md).

Nguồn chi tiết duy nhất:

- Public endpoint/request/response/error: `/api-docs` và `/api-docs.json`.
- Database constraints/status/indexes: [`src/database/schema.sql`](../src/database/schema.sql).
- Internal JSON boundary: [contract v0.1](api/internal-rag-contract.md).
- Default cloud release: [`bootstrap/corpus-release.json`](../bootstrap/corpus-release.json).
- Credential placement: [`secrets/README.md`](../secrets/README.md).
