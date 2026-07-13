# Usage and dashboard

Một assistant message có thể có nhiều `llm_usage_logs` rows qua `(request_id, call_index)`. NodeJS chỉ persist usage metadata đã normalize đủ operation/provider/model/token/status; invalid metadata làm completion transaction rollback và assistant chuyển `FAILED`.

`GET /api/admin/dashboard/summary` là ADMIN-only, optional UTC `from` inclusive và `to` exclusive. Response gồm document counts theo processing/visibility, session/message/citation counts và LLM usage breakdown theo provider/model/status/currency.

Scope luôn là `LLM_CALLS_ONLY`. Dashboard không tuyên bố embedding, rerank, OCR hoặc total AI cost khi schema không lưu dữ liệu đó. Empty tables trả count/token bằng 0; optional cost có thể null.
