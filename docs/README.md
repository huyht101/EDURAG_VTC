# EDURAG documentation

Tài liệu hiện hành được tổ chức theo nguồn sự thật, không phụ thuộc thư mục tham chiếu local hoặc đường dẫn máy cá nhân.

## Bắt đầu

- [System overview](architecture/system-overview.md)
- [Local development](setup/local-development.md)
- [Docker demo](setup/docker-demo.md)
- [Database bootstrap](database/README.md)
- OpenAPI runtime: `/api-docs` và `/api-docs.json`

## Kiến trúc

- [NodeJS/Core architecture](architecture/nodejs-core.md)
- [Python RAG integration snapshot](architecture/python-rag.md)
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

## Status và snapshot

- [Week 3 integration readiness](status/week3-integration-readiness.md)
- [Python snapshot provenance](status/python-snapshot-source.md)
- [Python snapshot refresh guide](setup/python-snapshot-refresh.md)

`src/database/schema.sql` là executable database source of truth. OpenAPI là danh mục public endpoint chi tiết. [`api/internal-rag-contract.md`](api/internal-rag-contract.md) là contract nội bộ canonical duy nhất.
