# Tài liệu EDURAG NodeJS/Core

Tài liệu hiện hành được tổ chức theo nguồn sự thật, không phụ thuộc thư mục tham chiếu local hoặc đường dẫn máy cá nhân.

## Bắt đầu

- [Local development](setup/local-development.md)
- [Docker demo](setup/docker-demo.md)
- [Database bootstrap](database/README.md)
- OpenAPI runtime: `/api-docs` và `/api-docs.json`

## Kiến trúc

- [NodeJS/Core architecture](architecture/nodejs-core.md)
- [NodeJS–Python RAG boundary](architecture/rag-boundary.md)
- [Database design](database/design.md)
- [Database data dictionary](database/data-dictionary.md)

## API và module

- [Public API conventions](api/public-api.md)
- [Internal RAG contract](api/internal-rag-contract.md)
- [Account/Auth](modules/account-auth.md)
- [Documents](modules/documents.md)
- [Chat/Citations](modules/chat-citations.md)
- [Usage/Dashboard](modules/usage-dashboard.md)

## Flow

- [Mermaid flow index](flows/README.md)

`src/database/schema.sql` là executable database source of truth. OpenAPI là danh mục endpoint/request/response chi tiết. Markdown chỉ giải thích boundary, lifecycle, transaction và giới hạn MVP để tránh lặp tài liệu.
