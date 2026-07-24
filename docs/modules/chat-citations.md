# Chat and citations

Mọi ACTIVE user có thể tạo session, list/history và gửi question trong session của chính mình. Session soft-delete bằng `deleted_at`; messages/citations/usage không hard-delete.

Send question normalize `clientRequestId`: omit/null/empty/whitespace thì server sinh UUID, UUID do client cung cấp được dùng làm idempotency key. Service khóa session, cấp ordered USER/ASSISTANT pair và commit trước RAG call. Concurrent same-ID preparation retry bounded khi MySQL chọn deadlock victim, nhưng chỉ trước network call; unique/duplicate postcondition vẫn quyết định kết quả. Cùng ID trong cùng session trả pair hiện có; dùng ID đó ở session khác trả 409. NodeJS gửi bounded history từ MySQL; Python không sở hữu durable memory. Completion transaction lưu assistant, structured citation snapshots, usage rows và session timestamp; response luôn trả ID cuối cùng đã dùng.

RAG timeout/failure chuyển assistant `FAILED`; không tự retry question. Client retry cùng request ID trả kết quả hiện có. `no_answer=true` không tạo citation giả. `no_answer=false` bắt buộc có ít nhất một structured citation hợp lệ; answer thiếu nguồn fail closed và không được persist `COMPLETED`.

Citation source phải map internal `vectorNodeId` tới chunk `READY + VISIBLE` tại thời điểm trả lời; public serializer không trả internal ID này. Page là 1-based khi có; với TXT/DOCX nó có thể là synthetic segment thay vì trang vật lý. Node lưu/trả optional `sourceLocator` object, nhưng current Python snapshot không tạo locator hay bounding boxes nên FE dùng `sourceText` làm fallback. Snapshot fragment/title/page/section/locator/scores vẫn đọc được sau khi document hide/delete. Citation API chỉ cho session owner, kể cả khi user có role ADMIN. Original file chỉ stream sau ownership check và current source authorization; `storage_key` không public. Một approved private corpus restore có thể đưa reviewed original về local upload volume, nhưng pointer hiện có không tự chứng minh approval và GCS detail không public. Nếu fresh setup không restore approved corpus thì original unavailable, còn citation snapshot chỉ dùng được khi structured local state đã tồn tại.

Public JSON shape và viewer behavior canonical: [Frontend integration contract](../api/frontend-integration.md).

Flows: [chat/RAG notes](../flows/notes/chat-rag-flows.md).
