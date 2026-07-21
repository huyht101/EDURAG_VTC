# Python/Data-RAG handoff

Đây là danh sách debt quan sát từ tracked snapshot ngày 2026-07-21. Nó không khẳng định upstream Python mới nhất còn giống snapshot và không đánh dấu các mục dưới đây là đã sửa. Node contract vẫn ở [internal RAG contract](../api/internal-rag-contract.md).

| Vấn đề và evidence | Ảnh hưởng / Node đang enforce | Thay đổi Python tối thiểu và acceptance |
|---|---|---|
| `services/ingestion.py:129-187` tạo point `is_hidden=False`, upsert trước callback | Point có thể retrieval trước khi Node persist manifest và chuyển document `READY`; Node chỉ accept citation map tới `READY + VISIBLE` | Stage point fail-closed theo processing attempt; chỉ enable sau Node ACK, có reconciliation khi activation sau ACK lỗi. Test query đồng thời không thấy point trước ACK. |
| `send_succeeded_ingest()` trả boolean nhưng caller không xử lý failure | Callback hết retry có thể để vector của document chưa `READY` | Kiểm tra ACK result; cleanup/disable exact attempt khi delivery thất bại. Test Node unavailable để không còn retrieval-enabled orphan. |
| Batch `client.upsert` chạy tuần tự, exception chỉ gửi FAILED | Partial batch có thể để orphan/duplicate point | Gắn `doc_id + job_id + attempt_count`, cleanup exact attempt khi bất kỳ batch/callback nào fail. Test fail ở batch giữa rồi retry. |
| Snapshot overlay tại `services/ingestion.py` đã chặn `len(nodes) != len(embeddings)` trước tạo point; upstream chưa được xác nhận | Node không thể nhìn thấy raw embeddings; overlay tránh `zip` cắt im lặng nhưng chưa giải quyết partial batch/activation | **SMALL, cần upstream:** giữ guard + offline test mismatch phải FAILED và zero point. Không cần re-ingest cho dữ liệu đã hợp lệ; risk thấp. |
| Mỗi retry tạo random `uuid4()` | Retry có thể tạo duplicate identities | Dùng deterministic/idempotent identity hoặc cleanup attempt cũ trước retry; test cùng job/attempt lặp không tăng point count. |
| Snapshot overlay tại `services/rag_engine.py` đổi CHIT_CHAT và RAG answer không có valid marker thành `no_answer=true`; upstream chưa được xác nhận | Node vẫn trả `502 RAG_CITATIONS_REQUIRED` và assistant `FAILED` nếu normal answer không nguồn lọt qua | **SMALL, cần upstream:** giữ fail-closed conversion và test CHIT_CHAT/RAG answer không marker. Không re-ingest; response behavior backward-compatible với `no_answer` contract. |
| Query response chỉ mang một final `usage`; router/rewrite call không được tổng hợp | `llm_usage_logs` thiếu một số LLM calls | Trả ordered `usage_calls[]` cho mọi LLM call (router/rewrite/answer) với operation/status/model/tokens. Test nhiều call và failure metadata. |
| `api/routes.py:85-102` dùng FastAPI `BackgroundTasks` | Restart process làm mất in-flight work; Node có thể giữ job `RUNNING` | Chọn durable queue/idempotent worker ở phase production. Acceptance restart worker giữa ingest rồi resume/terminalize đúng một lần. |
| Live provider/Qdrant utility entrypoints không có boundary rõ trong snapshot | CI/dev có nguy cơ gọi paid provider hoặc mutate collection ngoài ý muốn | Upstream tách/đặt tên `live-*`, yêu cầu explicit confirmation và isolated collection; CI mặc định chỉ mock. |
| Snapshot chỉ có `requirements.txt`, không có resolved lock/provenance artifact | Build có thể drift dependency/model adapter | Upstream pin/lock resolved dependency set và ghi build provenance; clean install + Python tests + contract tests phải tái lập được. |

## Ước lượng handoff bắt buộc

- **RAG-001 activation protocol — LARGE, compatibility risk high.** Current Python upsert `is_hidden=false` trước Node ACK; Node chỉ safeguard bằng complete-manifest/stale-attempt validation và citation mapping `READY + VISIBLE`. Desired: point theo attempt phải inactive trước ACK, activate đúng attempt sau ACK, callback failure cleanup/disable. Existing points có thể cần payload migration hoặc canonical re-ingest; team Python phải quyết định. Acceptance: query đồng thời trước ACK/failed/stale attempt trả zero point, hide/delete fail closed.
- **RAG-002 deterministic retry/partial cleanup — LARGE, compatibility risk high.** Length guard overlay là phần nhỏ đã làm; random point ID và sequential batch vẫn còn. Desired: deterministic identity theo document/chunk/attempt hoặc exact attempt cleanup, retry không tăng active point count. Có khả năng cần point-ID migration và re-ingest. Acceptance: fail batch giữa, retry hai lần, stale callback và duplicate dispatch đều không để orphan/duplicate enabled point.
- **RAG-004 complete usage — MEDIUM, compatibility risk low.** Node đã accept/persist ordered `usage_calls[]` và vẫn đọc legacy single `usage`. Python cần instrument router/classifier + answer calls thật, không bịa token. Không cần re-ingest. Acceptance: one row per real LLM call, stable `call_index`, failure metadata và tổng không double-count.
- **Durable ingest worker — LARGE, architecture decision.** FastAPI `BackgroundTasks` không survive restart. Không cần re-ingest nếu idempotent lease/attempt protocol được chốt; nếu chưa có deterministic point identity thì phụ thuộc RAG-002. Acceptance: kill/restart worker giữa từng stage và terminalize đúng một lần.

## Deferred joint recovery

Stale processing job `RUNNING` chưa có safe automatic retry design. Node không tự retry vì ingest có external side effect và có thể duplicate point. Assistant `PENDING` hiện được conditional chuyển `FAILED/RAG_PENDING_TIMEOUT` khi client retry cùng `clientRequestId`; Node không tự gọi lại paid provider và không tạo message thứ hai. Scheduler/automatic provider retry vẫn cần lease/idempotency design chung.

Acceptance chung: không cho Python ghi MySQL, không cho Node truy cập Qdrant, không đổi schema/public ownership, và kiểm tra failure/restart/concurrency trên isolated topology trước live provider run.
