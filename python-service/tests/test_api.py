"""
tests/test_api.py
-----------------
Test các API endpoints bằng FastAPI TestClient.
Chúng ta sẽ mock các background tasks để không cần Qdrant thực.
"""

import os
import sys
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

TEST_INTERNAL_SECRET = "test-only-internal-secret-0123456789abcdef"
os.environ["GOOGLE_API_KEY"] = "test-google-api-key"
os.environ["LLAMA_CLOUD_API_KEY"] = "test-llama-cloud-api-key"
os.environ["INTERNAL_SECRET"] = TEST_INTERNAL_SECRET
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_INTERNAL_SECRET}"}

# Mock llama_parse
sys.modules['llama_parse'] = MagicMock()

# Mock llama_index and its submodules
llama_index_mock = MagicMock()
sys.modules['llama_index'] = llama_index_mock
sys.modules['llama_index.core'] = MagicMock()
sys.modules['llama_index.core.node_parser'] = MagicMock()
sys.modules['llama_index.core.schema'] = MagicMock()
sys.modules['llama_index.llms'] = MagicMock()
sys.modules['llama_index.llms.google_genai'] = MagicMock()
sys.modules['llama_index.embeddings'] = MagicMock()
sys.modules['llama_index.embeddings.google_genai'] = MagicMock()

from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_business_route_rejects_missing_token():
    response = client.post("/api/query", json={})
    assert response.status_code == 401

def test_business_route_rejects_malformed_token():
    response = client.post("/api/query", json={}, headers={"Authorization": "Basic invalid"})
    assert response.status_code == 401

def test_business_route_rejects_incorrect_token():
    response = client.post("/api/query", json={}, headers={"Authorization": "Bearer incorrect"})
    assert response.status_code == 401

@patch("api.routes.ingest_document_background")
def test_ingest_accepted(mock_bg_task):
    payload = {
        "doc_id": "doc1",
        "job_id": "job1",
        "attempt_count": 1,
        "subject_id": "sub1",
        "file_path": "/tests/file.pdf",
        "callback_url": "http://test/cb"
    }
    response = client.post("/api/ingest", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 202
    assert response.json()["status"] == "accepted"
    assert response.json()["job_id"] == "job1"
    # Verify background task was called
    mock_bg_task.assert_called_once()

@patch("api.routes.hide_document_background")
def test_hide_document_accepted(mock_bg_task):
    payload = {
        "job_id": "job2",
        "attempt_count": 1,
        "action": "hide",
        "callback_url": "http://test/cb"
    }
    response = client.patch("/api/docs/doc1/visibility", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 202
    assert response.json()["job_id"] == "job2"
    mock_bg_task.assert_called_once()

@patch("api.routes.delete_document_background")
def test_delete_document_accepted(mock_bg_task):
    payload = {
        "job_id": "job3",
        "attempt_count": 1,
        "callback_url": "http://test/cb"
    }
    # Using json via request body is correct for DELETE here (httpx supports it)
    response = client.request("DELETE", "/api/ingest/doc1", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 202
    assert response.json()["job_id"] == "job3"
    mock_bg_task.assert_called_once()

@patch("api.routes.process_query")
def test_query_endpoint(mock_process_query):
    # Mock return value for process_query
    from models.schemas import QueryResponse
    mock_process_query.return_value = QueryResponse(
        answer="Mocked answer",
        citations=[],
        confidence="high",
        no_answer=False,
    )
    
    payload = {
        "question": "What is AI?",
        "request_id": "request-1",
        "user_id": "user-1",
        "conversation_id": "conv1",
        "history": []
    }
    
    import asyncio
    
    # We need to mock the async function properly. TestClient runs async endpoints using run_in_threadpool.
    # So we can just mock it as an async function.
    async def mock_pq(*args, **kwargs):
        return mock_process_query.return_value
        
    with patch("api.routes.process_query", new=mock_pq):
        response = client.post("/api/query", json=payload, headers=AUTH_HEADERS)
        
    assert response.status_code == 200
    assert response.json()["answer"] == "Mocked answer"
