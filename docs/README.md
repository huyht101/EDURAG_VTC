# Bản đồ tài liệu EDURAG

Trang này là navigation chính. Mỗi domain chỉ có một tài liệu diễn giải hiện hành; các
nguồn executable vẫn quyết định behavior đã triển khai.

## Điểm bắt đầu

| Nhu cầu | Nguồn hiện hành |
|---|---|
| Chạy project và demo | [README gốc](../README.md) |
| Trạng thái, evidence và residual risk | [Project handoff](../PROJECT_HANDOFF.md) |
| Chuẩn bị viết báo cáo | [Tổng quan kỹ thuật tiếng Việt](report/technical-overview.vi.md) |
| Phạm vi MVP theo thành phần | [Ma trận MVP](status/mvp-gap-matrix.md) |
| Defect và quality debt | [Issue register](status/issue-quality-register.md) |

## Nguồn hiện hành theo domain

| Domain | Tài liệu diễn giải | Nguồn executable xác nhận implementation |
|---|---|---|
| Kiến trúc và ownership | [Tổng quan hệ thống](architecture/system-overview.md) | Runtime Node, root Compose và Python snapshot |
| Public API | [Quy ước public API](api/public-api.md) | `/api-docs.json`, OpenAPI test |
| Web/Mobile integration | [Frontend integration](api/frontend-integration.md) | Public OpenAPI và DTO/runtime hiện hành |
| Node–Python boundary | [Internal RAG contract](api/internal-rag-contract.md) | Contract fixtures/tests và hai runtime snapshot |
| Python delivery/status | [Python/Data-RAG handoff](architecture/python-rag-handoff.md) | Python upstream; snapshot chỉ là evidence quan sát |
| Citation page/geometry | [Source locator](architecture/source-locator-handoff.md) | Contract/runtime validators và probe evidence được ghi |
| Portable corpus | [Corpus portability](architecture/corpus-portability.md) | Corpus scripts, manifest/pointer và regression |
| Database | [Database index](database/README.md) | `src/database/schema.sql` và migrations |
| Account/Auth | [Account/Auth](modules/account-auth.md) | Node runtime, OpenAPI và tests |
| Documents | [Documents](modules/documents.md) | Node runtime, schema, OpenAPI và tests |
| Chat/Citations | [Chat/Citations](modules/chat-citations.md) | Node runtime, contract và tests |
| Usage/Dashboard | [Usage/Dashboard](modules/usage-dashboard.md) | Node runtime, schema, OpenAPI và tests |
| Flows | [Flow index](flows/README.md) | Runtime/contract tương ứng |
| Setup local | [Phát triển local](setup/local-development.md) | Package scripts và Compose |
| Full remote/demo | [Remote Docker RAG](setup/remote-rag-e2e.md) | Package scripts và Compose |
| Live acceptance có kiểm soát | [Phase 2 runbook](testing/phase2-live-acceptance-runbook.md) | Kết quả chỉ có giá trị khi thực sự chạy |

## Quy tắc đọc authority

- Intended scope/business rule: Owner decision và tài liệu canonical hiện hành.
- Behavior đã triển khai: runtime code, executable schema/migrations, OpenAPI, fixtures và
  executable tests.
- Tài liệu report-ready chỉ tóm tắt và liên kết, không thay schema/API/contract.
- Bản Week 4 còn giữ là evidence lịch sử được Python snapshot tham chiếu; nó không phải
  readiness hiện hành.
- `python-service/` là snapshot có thể bị refresh; metadata/provenance nằm tại
  [Python snapshot](architecture/python-rag.md) và quy trình tại
  [hướng dẫn refresh](setup/python-snapshot-refresh.md).
