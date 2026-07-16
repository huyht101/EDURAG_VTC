# Python RAG service

FastAPI service sở hữu parsing, embeddings, retrieval/generation và Qdrant. NodeJS/Core sở hữu public API, authorization, MySQL và durable chat history.

Canonical internal contract: [`../docs/api/internal-rag-contract.md`](../docs/api/internal-rag-contract.md).

## Runtime

- Entry point: `main.py::app`.
- Python: 3.11.
- Framework: FastAPI.
- Qdrant client, LlamaIndex, Gemini.
- Parsers: PDF, DOCX/DOC, TXT; optional LlamaParse.

Endpoints:

| Method/path | Purpose |
|---|---|
| `POST /api/ingest` | Async ingest and callback |
| `POST /api/query` | Synchronous query |
| `PATCH /api/docs/{doc_id}/visibility` | Async hide/unhide |
| `DELETE /api/ingest/{doc_id}` | Async vector deletion |
| `GET /api/health` | Health |

## Local setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Required environment:

- `GOOGLE_API_KEY`
- optional `LLAMA_CLOUD_API_KEY`
- `QDRANT_URL`
- `QDRANT_COLLECTION_NAME`
- `INTERNAL_SECRET`: same value as Node `RAG_INTERNAL_TOKEN`, at least 32 characters

Never commit `.env`.

## Tests

```powershell
python -m compileall .
python -m pytest tests -q
```

Tests mock Qdrant/LlamaIndex-heavy imports. They do not prove live Gemini, Qdrant or remote Node integration.

## Docker

The service-local Compose is development-only and owns its Qdrant. It does not currently mount the Node upload volume.

For Node/Python integration, select a topology and shared-volume mapping from [`03_deployment-and-env.md`](../docs/handoffs/python-rag-v0.1/03_deployment-and-env.md). Do not use `localhost` between containers.

## Known contract blockers

- Processing `attempt_count` is overwritten by callback delivery retry.
- Ingest callback has preview-only chunks.
- Citation lacks Qdrant point ID.
- Inbound routes do not verify internal Bearer.

Current release gate: [`week3-integration-readiness.md`](../docs/status/week3-integration-readiness.md).
