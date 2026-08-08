"""Offline-by-default RAG evaluator with explicit disposable-target guards."""

import asyncio
import csv
import json
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.config import get_settings
from core.database import get_qdrant_client
from core.llm_setup import get_embedding_model
from llama_index.core.node_parser import SentenceSplitter
from models.schemas import QueryRequest
from qdrant_client import models
from services.ingestion import _build_llama_documents
from services.parser import parse_document
from services.rag_engine import process_query


def _live_evaluation_enabled(environ: dict | None = None) -> bool:
    value = (environ or os.environ).get("EVAL_LIVE_MODE", "")
    return value.strip().lower() in {"1", "true", "yes"}


def _resolve_evaluation_collection(
    canonical_collection: str,
    environ: dict | None = None,
) -> str:
    """Require an explicit, recognizable disposable collection for live evaluation."""
    target = (environ or os.environ).get("EVAL_QDRANT_COLLECTION", "").strip()
    if not target:
        raise RuntimeError("EVAL_QDRANT_COLLECTION is required for live evaluation.")
    if target == canonical_collection:
        raise RuntimeError("Evaluation refuses the canonical Qdrant collection.")
    if not target.startswith(("edurag_eval_", "edurag_test_")):
        raise RuntimeError("Evaluation collection must use an edurag_eval_/edurag_test_ prefix.")
    return target


def _configure_live_target():
    base_settings = get_settings()
    target = _resolve_evaluation_collection(base_settings.QDRANT_COLLECTION_NAME)
    os.environ["QDRANT_COLLECTION_NAME"] = target
    get_settings.cache_clear()
    return get_settings()


async def ingest_test_doc(settings) -> None:
    """Insert evaluation points only into the already-guarded disposable collection."""
    pdf_path = Path(__file__).resolve().parent.parent / "tests" / "file.pdf"
    pages = await parse_document(str(pdf_path))
    docs = _build_llama_documents(
        pages,
        doc_id="eval-file.pdf",
        subject_id="evaluation",
        teacher_metadata={},
    )
    splitter = SentenceSplitter(
        chunk_size=settings.CHUNK_SIZE,
        chunk_overlap=settings.CHUNK_OVERLAP,
    )
    nodes = splitter.get_nodes_from_documents(docs)
    embeddings = await get_embedding_model().aget_text_embedding_batch(
        [node.get_content() for node in nodes]
    )
    if len(nodes) != len(embeddings):
        raise RuntimeError("Evaluation embedding count mismatch.")

    points = [
        models.PointStruct(
            id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"edurag-eval:{index}")),
            vector=embedding,
            payload={
                "text": node.get_content(),
                "doc_id": "eval-file.pdf",
                "page_number": node.metadata.get("page_number"),
                "is_active": True,
                "is_hidden": False,
                "evaluation_only": True,
            },
        )
        for index, (node, embedding) in enumerate(zip(nodes, embeddings))
    ]
    client = await get_qdrant_client()
    client.upsert(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        points=points,
        wait=True,
    )


async def evaluate(config: dict, *, live_mode: bool) -> list[dict]:
    dataset_path = Path(__file__).resolve().parent.parent / "tests" / "evaluation" / "eval_dataset.json"
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    results = []
    for item in dataset:
        if not live_mode:
            results.append({
                "query": item["query"],
                "mode": "SIMULATION_ONLY",
                "latency_s": 0,
                "is_no_answer": item["expect_no_answer"],
                "correct_no_answer": True,
                "hit_expected_doc": None,
                "total_tokens": 0,
            })
            continue

        request = QueryRequest(
            question=item["query"],
            conversation_id="eval-conversation",
            history=[],
        )
        start_time = time.time()
        try:
            response = await process_query(request)
        except Exception as error:
            raise RuntimeError(
                f"Live evaluation query failed: error_type={type(error).__name__}"
            ) from error
        results.append({
            "query": item["query"],
            "mode": "LIVE_DISPOSABLE",
            "latency_s": round(time.time() - start_time, 2),
            "is_no_answer": response.no_answer,
            "correct_no_answer": response.no_answer == item["expect_no_answer"],
            "hit_expected_doc": (
                None if item["expect_no_answer"]
                else any(citation.doc_id == item["expected_doc_id"] for citation in response.citations)
            ),
            "total_tokens": response.usage.total_tokens if response.usage else 0,
        })
    return results


def _write_report(rows: list[dict]) -> Path:
    output = Path(os.environ.get(
        "EVAL_OUTPUT_PATH",
        str(Path(tempfile.gettempdir()) / "edurag-evaluation-summary.csv"),
    ))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return output


async def main() -> None:
    live_mode = _live_evaluation_enabled()
    settings = _configure_live_target() if live_mode else None
    if live_mode:
        await ingest_test_doc(settings)

    configs = [
        {"TOP_K": 3, "SIMILARITY_THRESHOLD": 0.3},
        {"TOP_K": 5, "SIMILARITY_THRESHOLD": 0.3},
        {"TOP_K": 5, "SIMILARITY_THRESHOLD": 0.5},
    ]
    reports = []
    for config in configs:
        if live_mode:
            os.environ["TOP_K"] = str(config["TOP_K"])
            os.environ["SIMILARITY_THRESHOLD"] = str(config["SIMILARITY_THRESHOLD"])
            get_settings.cache_clear()
        rows = await evaluate(config, live_mode=live_mode)
        if live_mode and any(not row["correct_no_answer"] for row in rows):
            raise AssertionError("Live evaluation no-answer acceptance failed.")
        reports.extend(rows)

    output = _write_report(reports)
    mode = "LIVE_DISPOSABLE" if live_mode else "SIMULATION_ONLY"
    print(f"EVALUATION_COMPLETE mode={mode} output={output}")


if __name__ == "__main__":
    asyncio.run(main())
