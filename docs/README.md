# EDURAG documentation

Tài liệu hiện hành của NodeJS/Core. Khi có khác biệt, ưu tiên runtime code, [`schema.sql`](../src/database/schema.sql), automated tests và OpenAPI.

| Mục đích | Tài liệu canonical |
|---|---|
| Trạng thái/handoff hiện hành | [Project handoff](../PROJECT_HANDOFF.md) |
| Coverage và remaining work | [MVP gap matrix](status/mvp-gap-matrix.md) |
| Defect/contract gap/quality debt | [Issue and quality register](status/issue-quality-register.md) |
| Chạy nhanh | [Root README](../README.md) |
| Chạy full Docker remote, optional approved cloud restore và Swagger | [Remote Docker RAG](setup/remote-rag-e2e.md) |
| Node local và mock reference | [Local development](setup/local-development.md) |
| Hiểu system ownership | [System overview](architecture/system-overview.md) |
| Hiểu cloud corpus release | [Corpus portability](architecture/corpus-portability.md) |
| Tích hợp Web/Mobile | [Frontend integration contract](api/frontend-integration.md) |
| Tra public role/workflow | [Public API](api/public-api.md); endpoint detail ở Swagger |
| Tích hợp NodeJS–Python | [Internal RAG contract](api/internal-rag-contract.md) |
| Bàn giao implementation phía Python | [Python/Data-RAG handoff](architecture/python-rag-handoff.md) |
| Tra database | [Database index](database/README.md) |
| Kiểm thử remote độc lập | [Week 3 test plan](testing/week3-remote-test-plan.md) |
| Phase 2 live acceptance (Owner-run) | [Phase 2 runbook](testing/phase2-live-acceptance-runbook.md) |
| Refresh Python snapshot | [Python snapshot](architecture/python-rag.md) và [refresh guide](setup/python-snapshot-refresh.md) |

Tài liệu module: [Account/Auth](modules/account-auth.md), [Documents](modules/documents.md), [Chat/Citations](modules/chat-citations.md), [Usage/Dashboard](modules/usage-dashboard.md). Mermaid sources nằm tại [flow index](flows/README.md).

Nguồn chi tiết duy nhất:

- Public endpoint/request/response/error: `/api-docs` và `/api-docs.json`.
- Database constraints/status/indexes: [`src/database/schema.sql`](../src/database/schema.sql).
- Internal JSON boundary: [contract v0.1](api/internal-rag-contract.md).
- Python implementation actions: [Python/Data-RAG handoff](architecture/python-rag-handoff.md).
- Selected-release pointer (metadata, không tự chứng minh remote availability): [`bootstrap/corpus-release.json`](../bootstrap/corpus-release.json).
- Credential placement: [`secrets/README.md`](../secrets/README.md).

## Phân loại tài liệu

- **Canonical:** các mục trong bảng trên, runtime OpenAPI và database DDL.
- **Supporting:** `architecture/nodejs-core.md`, `architecture/rag-boundary.md`, module,
  flow notes, setup và `architecture/source-locator-handoff.md`.
- **Historical:** `status/week3-*`, `status/week4-*` và các test report ghi rõ
  historical/simulation. Chúng không được dùng để nâng trạng thái hiện hành.
- **Python snapshot-local:** README/docs dưới `python-service/` chỉ phản ánh bản copy tại
  thời điểm refresh và có thể bị upstream thay thế.
