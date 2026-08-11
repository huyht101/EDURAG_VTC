# Chat and citations

Mọi ACTIVE user có thể tạo session, list/history và gửi question trong session của chính mình. Session soft-delete bằng `deleted_at`; messages/citations/usage không hard-delete.

Send question normalize `clientRequestId`: omit/null/empty/whitespace thì server sinh UUID, UUID do client cung cấp được dùng làm idempotency key. Service khóa session, cấp ordered USER/ASSISTANT pair và commit trước RAG call. Concurrent same-ID preparation retry bounded khi MySQL chọn deadlock victim, nhưng chỉ trước network call; unique/duplicate postcondition vẫn quyết định kết quả. Cùng ID trong cùng session trả pair hiện có; dùng ID đó ở session khác trả 409. NodeJS gửi bounded history từ MySQL; Python không sở hữu durable memory. Completion transaction lưu assistant, structured citation snapshots, usage rows và session timestamp; response luôn trả ID cuối cùng đã dùng.

RAG timeout/failure chuyển assistant `FAILED`; không tự retry question. Client retry cùng request ID trả kết quả hiện có. `no_answer=true` không tạo citation giả. `no_answer=false` bắt buộc có ít nhất một structured citation hợp lệ; answer thiếu nguồn fail closed và không được persist `COMPLETED`.

Citation source phải map internal `vectorNodeId` tới chunk `READY + VISIBLE` tại thời điểm trả lời; public serializer không trả internal ID này. `sourceText` phải có nội dung; page là 1-based khi có và chỉ được trình bày như physical page khi identity đáng tin cậy. Node chỉ nhận `sourceLocator=null` hoặc ordered line `boxes[]` normalized 0–1, top-left, nằm trọn trong canonical PDF page; locator sai bị reject, Node không tự tạo/sửa geometry. Snapshot fragment/title/page/section/locator/scores vẫn bất biến sau hide/delete. `previewUrl` và `originalFileUrl` được sinh động theo current document/actor: Student dùng canonical PDF preview cho PDF/DOCX, original PDF/DOCX chỉ uploader Teacher/Admin; TXT giữ authenticated Library fallback. Citation API vẫn chỉ cho session owner và không public `storage_key`.

Public JSON shape và viewer behavior canonical: [Frontend integration contract](../api/frontend-integration.md).

Flows: [chat/RAG notes](../flows/notes/chat-rag-flows.md).
