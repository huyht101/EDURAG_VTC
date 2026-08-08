"""Offline-only FastAPI harness: real HTTP/Qdrant, deterministic local providers."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from fastapi import FastAPI

import services.ingestion as ingestion
import services.rag_engine as rag_engine
from api.routes import public_router, router


class OfflineEmbedding:
    async def aget_text_embedding_batch(self, texts):
        return [[1.0] + [0.0] * 767 for _text in texts]

    async def aget_text_embedding(self, _text):
        return [1.0] + [0.0] * 767


class OfflineLlmResponse:
    def __init__(self, text):
        self.text = text
        self.raw = None


class OfflineLlm:
    async def acomplete(self, prompt):
        if '"intent": "CHIT_CHAT"' in prompt:
            return OfflineLlmResponse('{"intent":"RAG_REQUIRED"}')
        return OfflineLlmResponse("Offline answer grounded in the retrieved source [1].")


class PassThroughNodeParser:
    def get_nodes_from_documents(self, documents):
        return documents


async def parse_offline_fixture(file_path):
    fixture = Path(file_path)
    if fixture.is_file():
        content = fixture.read_text(encoding="utf-8")
    elif str(fixture) == "/offline/canonical.pdf":
        # The narrow callback-harness test has no shared upload volume. The
        # production offline E2E always exercises a real Node-written file.
        content = "Offline callback harness canonical fixture."
    else:
        raise FileNotFoundError("offline ingest fixture is unavailable")
    if "OFFLINE_FAIL_BEFORE_ACK" in content:
        raise ValueError("offline injected pre-ACK parse failure")
    return [{
        "page_number": 1,
        "text": content,
        "chapter": "Offline",
        "section": "Lifecycle",
    }]


ingestion.parse_document = parse_offline_fixture
ingestion.get_embedding_model = lambda: OfflineEmbedding()
ingestion.MarkdownNodeParser = PassThroughNodeParser
ingestion.SentenceSplitter = lambda **_kwargs: PassThroughNodeParser()
rag_engine.get_embedding_model = lambda: OfflineEmbedding()
rag_engine.get_llm = lambda: OfflineLlm()
rag_engine.get_router_llm = lambda: OfflineLlm()

activation_failures = int(os.environ.get("OFFLINE_ACTIVATION_FAILURES", "0"))
if activation_failures:
    real_activate = ingestion._activate_attempt_points
    activation_calls = 0

    async def injected_activation(*args, **kwargs):
        global activation_calls
        activation_calls += 1
        if activation_calls <= activation_failures:
            raise RuntimeError("offline injected activation failure")
        return await real_activate(*args, **kwargs)

    ingestion._activate_attempt_points = injected_activation

app = FastAPI(title="EDURAG offline RAG E2E")
app.include_router(public_router)
app.include_router(router)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
