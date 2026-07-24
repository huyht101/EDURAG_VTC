# Frontend integration contract

Tài liệu này là nguồn canonical cho Web/Mobile khi tích hợp chat, citation và source viewer. Endpoint-level schema vẫn nằm ở Swagger `/api-docs`; khi có khác biệt, runtime NodeJS/Core là nguồn ưu tiên.

## Chat

### Gửi message

`POST /api/chat/sessions/{id}/messages` nhận `application/json`:

```json
{
  "content": "Tài liệu mô tả nội dung chính nào?"
}
```

`clientRequestId` là optional. Omit, `null`, empty hoặc whitespace làm server sinh UUID; FE nên tự sinh và giữ UUID khi cần retry đúng logical request.

Với logical request mới, đây là synchronous HTTP: Node tạo USER và ASSISTANT `PENDING`, gọi RAG, rồi trả `200` sau khi assistant đã `COMPLETED`. Riêng retry trùng `clientRequestId` trả ngay pair hiện hữu với `duplicate=true`, nên `assistantMessage.status` có thể là `PENDING`, `COMPLETED` hoặc `FAILED`.

```json
{
  "success": true,
  "message": "Chat response completed.",
  "data": {
    "duplicate": false,
    "clientRequestId": "35ad0d0e-a423-4b06-a643-9a8391a6a4da",
    "userMessageId": 41,
    "assistantMessage": {
      "id": 42,
      "status": "COMPLETED",
      "content": "Câu trả lời có nguồn.",
      "noAnswer": false,
      "citations": [
        {
          "id": 43,
          "messageId": 42,
          "documentId": 12,
          "chunkId": 88,
          "citationOrder": 1,
          "documentTitle": "Tài liệu demo",
          "pageNumber": 1,
          "sectionTitle": null,
          "sourceText": "Structured source fragment.",
          "sourceLocator": null,
          "retrievalScore": 0.91,
          "rerankScore": null
        }
      ]
    }
  }
}
```

Trạng thái assistant trong MySQL là `PENDING`, `COMPLETED` hoặc `FAILED`; `COMPLETED` và `FAILED` là terminal. FE không poll cho response `duplicate=false` thành công. Nếu duplicate trả `PENDING`, poll `GET /api/chat/sessions/{id}/messages` và match `assistantMessage.id`; sau timeout có thể retry cùng request ID để stale recovery chuyển row cũ sang `FAILED`. Timeout/upstream/contract failure của request mới trả HTTP error và best-effort chuyển row sang `FAILED`. Nếu process crash đúng khoảng này, row có thể còn `PENDING`. Không có SSE/WebSocket hoặc assistant-status endpoint riêng.

### Chat history

Route đầy đủ:

```text
GET /api/chat/sessions/{id}/messages?offset=0&limit=50
```

`GET /api/chat/sessions/{id}` hiện trả cùng history shape. Default `offset=0`, `limit=50`, maximum `100`. Messages được sắp theo `messageOrder ASC`; cả `PENDING`, `COMPLETED` và `FAILED` đều xuất hiện. Session đã soft-delete trả `404`.

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "session": {
      "id": 9,
      "title": "Demo chat",
      "lastMessageAt": "2026-07-22T08:30:00.000Z",
      "createdAt": "2026-07-22T08:00:00.000Z",
      "updatedAt": "2026-07-22T08:30:00.000Z"
    },
    "offset": 0,
    "limit": 50,
    "total": 2,
    "messages": [
      {
        "id": 41,
        "sessionId": 9,
        "senderType": "USER",
        "messageOrder": 1,
        "content": "Tài liệu mô tả nội dung chính nào?",
        "status": "COMPLETED",
        "noAnswer": false,
        "clientRequestId": "35ad0d0e-a423-4b06-a643-9a8391a6a4da",
        "errorCode": null,
        "completedAt": "2026-07-22T08:30:00.000Z",
        "createdAt": "2026-07-22T08:30:00.000Z",
        "citations": []
      },
      {
        "id": 42,
        "sessionId": 9,
        "senderType": "ASSISTANT",
        "messageOrder": 2,
        "content": "Câu trả lời có nguồn.",
        "status": "COMPLETED",
        "noAnswer": false,
        "clientRequestId": null,
        "errorCode": null,
        "completedAt": "2026-07-22T08:30:02.000Z",
        "createdAt": "2026-07-22T08:30:00.000Z",
        "citations": [
          {
            "id": 43,
            "messageId": 42,
            "documentId": 12,
            "chunkId": 88,
            "citationOrder": 1,
            "documentTitle": "Tài liệu demo",
            "pageNumber": 1,
            "sectionTitle": null,
            "sourceText": "Structured source fragment.",
            "sourceLocator": null,
            "retrievalScore": 0.91,
            "rerankScore": null
          }
        ]
      }
    ]
  }
}
```

Citation snapshots được nhúng vào assistant message khi có; usage rows không được nhúng. Field là `senderType`, không phải `role`.

## Chat image status

`NOT IMPLEMENTED`: supported contract của chat route là JSON `content` và optional `clientRequestId`; route không có multipart parser. Không có image field, image storage, image metadata hoặc truyền ảnh sang Python/model. `content` luôn bắt buộc và không rỗng. Document upload `POST /api/documents` không phải chat-image API.

Vì server chưa có image contract, hiện không có MIME/extension/magic-byte, số lượng hoặc dung lượng ảnh được cam kết. Nếu UC 11 được ưu tiên, BA/owner cần chốt multi-image, text-only/image-only semantics, retention/authorization và model vision trước khi Node/Python cùng triển khai.

## Source viewer và original file

Node không convert DOCX/TXT sang PDF/HTML và không lưu generated preview. File endpoints stream original dưới dạng `attachment`; citation source endpoint trả JSON snapshot để FE dùng fallback.

| File/source | Endpoint | Response | Auth và state |
|---|---|---|---|
| Student Library metadata | `GET /api/library/documents`, `GET /api/library/documents/{id}` | JSON allowlist; list có offset/limit và optional title search | User JWT; chỉ STUDENT; server cố định `READY + VISIBLE`. |
| Student Library original | `GET /api/library/documents/{id}/source` | Binary attachment, `Content-Length`, `Content-Disposition` | Chỉ STUDENT; `404` nếu không còn `READY + VISIBLE`, `409` nếu record hợp lệ nhưng original thiếu. |
| PDF/DOCX/TXT original của document | `GET /api/documents/{id}/file` | `200`, MIME suy ra từ filename, `Content-Length`, `Content-Disposition: attachment` | User JWT; TEACHER uploader hoặc ADMIN. HIDDEN vẫn mở được; DELETED trả `404`. |
| Citation snapshot | `GET /api/citations/{id}/source` hoặc `GET /api/citations/{id}` | JSON gồm snapshot và `originalAvailable` | User JWT và owner của chat session; snapshot vẫn tồn tại sau hide/delete. |
| Original qua citation | `GET /api/citations/{id}/file` | Binary attachment như original | Session owner trước, sau đó current source authorization. Student thường nhận `409 ORIGINAL_SOURCE_UNAVAILABLE` khi source hidden/deleted/missing; uploader/Admin chỉ được hưởng quyền này trong session của chính họ. |

Upload document dùng Multer memory storage và cùng giới hạn `FILE_MAX_SIZE_BYTES` cho PDF/DOCX/TXT; default là `20 MiB`. Sai định dạng/signature trả `400`; quá giới hạn trả `413 FILE_TOO_LARGE`.

Student Library không dùng management DTO. Object public gồm `id`, `title`, `fileType`, `fileSize`, `pageCount` (hiện `null` vì Node chưa duy trì page count authoritative), `createdAt` và `originalAvailable`. Không dựa vào query client để quyết định owner, processing, visibility, deletion hoặc job state.

Download dùng filesystem stream và có `Content-Length`, nhưng chưa implement byte `Range`, `206`, `Accept-Ranges` hoặc cache policy riêng. FE nên hiển thị loading/progress theo `Content-Length`, không giả định seek server-side. PDF viewer có thể fetch blob rồi render phía client; DOCX/TXT cần client-side renderer/download hoặc hiển thị `sourceText`. Trả DOCX gốc không đồng nghĩa server có inline DOCX viewer.

## Page và highlight

- Node chỉ chấp nhận `pageNumber >= 1` khi field tồn tại.
- Python PDF fallback dùng trang vật lý 1-based.
- Python DOCX/TXT fallback chia synthetic segment khoảng 3.000 ký tự và đánh số 1-based; đây không phải trang in.
- LlamaParse primary đánh số theo thứ tự document fragment trả về; không có contract đảm bảo đó là physical page cho mọi format.
- Không có `totalPages`, paragraph index, character offset/range hoặc public `chunkIndex`.

Node có thể nhận/lưu/trả `sourceLocator` dạng object hoặc `null`, nhưng không định nghĩa schema tọa độ. Fixture hiện không có locator và Python snapshot không tạo `source_locator` hay `boxes[]`. Vì vậy FE chưa thể highlight chính xác bằng normalized coordinate, pixel hoặc PDF point. Fallback đáng tin cậy là `sourceText` kết hợp text search; `pageNumber` và `sectionTitle` chỉ dùng best-effort navigation.

Public citation object hiện là:

```json
{
  "id": 43,
  "messageId": 42,
  "documentId": 12,
  "chunkId": 88,
  "citationOrder": 1,
  "documentTitle": "Tài liệu demo",
  "pageNumber": 1,
  "sectionTitle": null,
  "sourceText": "Structured source fragment.",
  "sourceLocator": null,
  "retrievalScore": 0.91,
  "rerankScore": null
}
```

`vectorNodeId` là internal mapping key và không được public serializer trả về.

## CORS và authentication

- Cross-origin browser phải dùng exact origin trong `CORS_ALLOWED_ORIGINS`; runtime default khi không cấu hình là empty allowlist.
- Local `.env.example` gợi ý `http://localhost:3000,http://localhost:5173`.
- Preflight `OPTIONS` hỗ trợ `Authorization` và `Content-Type`; credentials/cookie mode tắt.
- File routes nằm sau user Bearer authentication.
- `Content-Length` là CORS-safelisted response header. `Content-Disposition` hiện chưa nằm trong `Access-Control-Expose-Headers`, nên JavaScript cross-origin không đọc được filename header dù vẫn fetch được blob.

Nếu FE cần lấy filename trực tiếp từ `Content-Disposition`, Node cần một thay đổi nhỏ để expose header. Cho tới lúc đó dùng metadata đã biết hoặc filename fallback phía client.

## Student email domain

Runtime chỉ enforce cú pháp email chung. Service trim và lowercase email trước khi lưu/login; rule áp dụng giống nhau cho STUDENT và TEACHER. Không có server rule cho `@student.edu.vn`, và TEACHER không có domain riêng.

Requirement `@student.edu.vn` không có BA document canonical trong repository hiện tại. FE có thể cảnh báo theo UX nếu BA đã yêu cầu, nhưng không nên coi đó là server guarantee. Owner/BA cần chốt domain, subdomain/alias, case và migration cho account hiện hữu trước khi Node thêm enforcement.

## FE action matrix

| Current behavior | FE action | Limitation | Future/proposed |
|---|---|---|---|
| Request mới synchronous; duplicate có thể trả current `PENDING` | Loading đến khi HTTP xong; chỉ poll history cho duplicate-pending | Không streaming token/status endpoint riêng | SSE/WebSocket chỉ khi có product decision |
| History trả `messages` theo `messageOrder` | Render `senderType`, status và embedded citations | Usage không nằm trong history | Không cần thêm call nếu chỉ hiển thị chat |
| Image chat chưa có | Chỉ gửi JSON text | Không vision/image upload | Joint Node/Python contract |
| Original là attachment stream | Fetch blob với Bearer hoặc download | Không Range/derived preview | Expose filename header, preview/range nếu cần |
| Locator thường `null` | Highlight bằng text search | Không boxes/coordinate units | Python locator schema + public contract |
| Email domain chỉ format chung | Normalize UI và hiển thị BA warning nếu cần | Server chưa enforce student domain | BA decision rồi Node validation |
