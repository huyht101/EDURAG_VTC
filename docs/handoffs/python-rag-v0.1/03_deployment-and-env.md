# Deployment and environment

Remote E2E is not part of this handoff build. Before Phase 2, choose one topology.

## Shared rules

- Node `RAG_INTERNAL_TOKEN` equals Python `INTERNAL_SECRET`.
- Token length: at least 32 characters.
- Node owns MySQL and upload writes.
- Python mounts the upload root read-only.
- Python alone owns one Qdrant instance.
- JSON `file_path` is the path as seen by Python, never a Windows host path passed into a Linux container.
- `RAG_DEFAULT_SUBJECT_ID=mvp-global` is only a compatibility shim.

## A. Python on host, Node in Docker

Typical settings:

```text
Node RAG_SERVICE_URL=http://host.docker.internal:8000
Node RAG_CALLBACK_URL=http://localhost:5001/api/internal/rag/processing-callback
```

The Python host process must be able to read the same physical upload directory. Configure `RAG_SHARED_UPLOAD_DIR` to the Python-visible absolute path. Do not send the Node container path if the host cannot resolve it.

Windows firewall and Docker Desktop host routing must permit both directions.

## B. Node and Python on one Docker network

Typical settings:

```text
Node RAG_SERVICE_URL=http://rag-service:8000
Node RAG_CALLBACK_URL=http://app:5000/api/internal/rag/processing-callback
Node RAG_SHARED_UPLOAD_DIR=/shared/uploads
```

Both services mount the same named volume:

- Node: read/write at its configured upload root.
- Python: read-only at `/shared/uploads`.

Do not use `localhost` between containers.

If Node and Python use separate Compose projects:

- create an explicit external network;
- create/reference an explicit external upload volume;
- use stable service/network aliases;
- ensure only the Python project owns Qdrant.

## Relevant environment

Node:

- `RAG_MODE=remote`
- `RAG_SERVICE_URL`
- `RAG_CALLBACK_URL`
- `RAG_INTERNAL_TOKEN`
- `RAG_SHARED_UPLOAD_DIR`
- `RAG_REQUEST_TIMEOUT_MS`
- `RAG_QUERY_TIMEOUT_MS`
- `RAG_DEFAULT_SUBJECT_ID`

Python:

- `INTERNAL_SECRET`
- `QDRANT_URL`
- `QDRANT_COLLECTION_NAME`
- `GOOGLE_API_KEY`
- optional `LLAMA_CLOUD_API_KEY`
- `CALLBACK_TIMEOUT`
- `CALLBACK_MAX_RETRIES`

Set `INTERNAL_SECRET` explicitly. The current snapshot's `core/config.py` has a weak fallback; confirm the latest upstream behavior before integration and never rely on that fallback.
