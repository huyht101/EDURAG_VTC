# Python/Data-RAG handoff

Đây là danh sách debt quan sát từ tracked snapshot ngày 2026-07-21. Nó không khẳng định upstream Python mới nhất còn giống snapshot và không đánh dấu các mục dưới đây là đã sửa. Node contract vẫn ở [internal RAG contract](../api/internal-rag-contract.md).

| Vấn đề và evidence | Ảnh hưởng / Node đang enforce | Thay đổi Python tối thiểu và acceptance |
|---|---|---|
| `services/ingestion.py:129-187` tạo point `is_hidden=False`, upsert trước callback | Point có thể retrieval trước khi Node persist manifest và chuyển document `READY`; Node chỉ accept citation map tới `READY + VISIBLE` | Stage point fail-closed theo processing attempt; chỉ enable sau Node ACK, có reconciliation khi activation sau ACK lỗi. Test query đồng thời không thấy point trước ACK. |
| `send_succeeded_ingest()` trả boolean nhưng caller không xử lý failure | Callback hết retry có thể để vector của document chưa `READY` | Kiểm tra ACK result; cleanup/disable exact attempt khi delivery thất bại. Test Node unavailable để không còn retrieval-enabled orphan. |
| Batch `client.upsert` chạy tuần tự, exception chỉ gửi FAILED | Partial batch có thể để orphan/duplicate point | Gắn `doc_id + job_id + attempt_count`, cleanup exact attempt khi bất kỳ batch/callback nào fail. Test fail ở batch giữa rồi retry. |
| `zip(nodes, embeddings)` tại `services/ingestion.py:129` không kiểm tra length | `zip` cắt im lặng, manifest/point count thiếu | Assert `len(nodes) == len(embeddings) > 0` trước tạo point; test mismatch phải FAILED và zero enabled point. |
| Mỗi retry tạo random `uuid4()` | Retry có thể tạo duplicate identities | Dùng deterministic/idempotent identity hoặc cleanup attempt cũ trước retry; test cùng job/attempt lặp không tăng point count. |
| `services/rag_engine.py:129-135` trả CHIT_CHAT `no_answer=False, citations=[]`; marker extraction ở `:338-367` cũng có thể rỗng | Node nay trả `502 RAG_CITATIONS_REQUIRED` và assistant `FAILED` cho normal answer không nguồn | Mọi `no_answer=false` phải có structured citation, nếu không chuyển thành `no_answer=true`. Test CHIT_CHAT và answer không có marker theo target contract. |
| Query response chỉ mang một final `usage`; router/rewrite call không được tổng hợp | `llm_usage_logs` thiếu một số LLM calls | Trả ordered `usage_calls[]` cho mọi LLM call (router/rewrite/answer) với operation/status/model/tokens. Test nhiều call và failure metadata. |
| `api/routes.py:85-102` dùng FastAPI `BackgroundTasks` | Restart process làm mất in-flight work; Node có thể giữ job `RUNNING` | Chọn durable queue/idempotent worker ở phase production. Acceptance restart worker giữa ingest rồi resume/terminalize đúng một lần. |
| Live provider/Qdrant utility entrypoints không có boundary rõ trong snapshot | CI/dev có nguy cơ gọi paid provider hoặc mutate collection ngoài ý muốn | Upstream tách/đặt tên `live-*`, yêu cầu explicit confirmation và isolated collection; CI mặc định chỉ mock. |
| Snapshot chỉ có `requirements.txt`, không có resolved lock/provenance artifact | Build có thể drift dependency/model adapter | Upstream pin/lock resolved dependency set và ghi build provenance; clean install + Python tests + contract tests phải tái lập được. |

## Deferred joint recovery

Stale processing job `RUNNING` và assistant `PENDING` chưa có safe automatic retry design. Node không tự retry vì ingest/query có external side effect và có thể duplicate point/message/cost. Hai team cần thống nhất lease/heartbeat, idempotency key, terminal reconciliation và operator recovery trước khi triển khai scheduler.

Acceptance chung: không cho Python ghi MySQL, không cho Node truy cập Qdrant, không đổi schema/public ownership, và kiểm tra failure/restart/concurrency trên isolated topology trước live provider run.
