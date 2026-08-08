import asyncio
from services.ingestion import ingest_document_background
from models.schemas import IngestRequest
import os
import logging

logging.basicConfig(level=logging.INFO)

async def main():
    cwd = os.getcwd()
    pdf_path = os.path.join(cwd, "tests", "file.pdf")
    req = IngestRequest(
        doc_id="doc_real_test",
        job_id="job_real_1",
        attempt_count=1,
        subject_id="sub_test",
        file_path=pdf_path,
        callback_url="http://localhost:3000/callback" 
    )
    print("Bắt đầu xử lý fixture ingest.")
    await ingest_document_background(req)
    print("Tiến trình đã chạy xong!")

if __name__ == "__main__":
    collection = os.environ.get("QDRANT_COLLECTION_NAME", "")
    if os.environ.get("RAG_MANUAL_LIVE_CONFIRM") != "true":
        raise SystemExit("Refusing live ingest without RAG_MANUAL_LIVE_CONFIRM=true.")
    if not collection.startswith(("edurag_test_", "edurag_eval_")):
        raise SystemExit("Refusing non-disposable Qdrant collection for live ingest.")
    asyncio.run(main())
