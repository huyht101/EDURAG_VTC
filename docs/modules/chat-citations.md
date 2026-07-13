# Chat and citations

Mọi ACTIVE user có thể tạo session, list/history và gửi question trong session của chính mình. Session soft-delete bằng `deleted_at`; messages/citations/usage không hard-delete.

Send question khóa session, kiểm tra `client_request_id`, cấp ordered USER/ASSISTANT pair và commit trước RAG call. NodeJS gửi bounded history từ MySQL; Python không sở hữu durable memory. Completion transaction lưu assistant, structured citation snapshots, usage rows và session timestamp.

RAG timeout/failure chuyển assistant `FAILED`; không tự retry question. Client retry cùng request ID trả kết quả hiện có. `no_answer` không tạo citation giả.

Citation source phải map `vectorNodeId` tới chunk `READY + VISIBLE` tại thời điểm trả lời. Snapshot fragment/title/page/section/locator/scores vẫn đọc được sau khi document hide/delete. Original file chỉ stream khi session ownership và current source authorization cho phép; `storage_key` không public.

Flows: [chat/RAG notes](../flows/notes/chat-rag-flows.md).
