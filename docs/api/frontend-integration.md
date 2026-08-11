# Hướng dẫn tích hợp Frontend/Mobile

Tài liệu này là nguồn canonical cho Web/Mobile khi tích hợp chat, citation và source viewer. Endpoint-level schema vẫn nằm ở Swagger `/api-docs`; khi có khác biệt, runtime NodeJS/Core là nguồn ưu tiên.

“Có thể triển khai ngay” trong tài liệu này chỉ nghĩa là public contract và integration
guidance phía Node đã sẵn sàng. Repository này không chứa implementation Web/Mobile và
audit hiện tại không chạy test UI/Mobile. Student Library cũng mới có evidence từ Node
contract/local tests, chưa có Web/Mobile integration evidence.

## Chat

### Gửi message chat

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

### Câu trả lời Markdown

`assistantMessage.content` và history `message.content` vẫn là string. Với assistant
`COMPLETED`, string có thể chứa Markdown subset/GFM-compatible: đoạn văn, heading nhẹ,
bold/italic, danh sách, bảng, inline code và fenced code. Node lưu/trả nguyên văn; không
chuyển Markdown thành HTML/JSON và không cung cấp `visualizations` hay chart protocol.

FE/Web/Mobile cần dùng renderer hỗ trợ GFM và table. Tắt raw HTML hoặc sanitize bằng thư
viện đáng tin cậy; bảng rộng cần horizontal scroll; Markdown malformed phải fallback về
plain text an toàn. Citation `[N]` trong đoạn văn hoặc ô bảng phải click được, nhưng `[N]`
trong inline/fenced code và array indexing như `array[0]` không phải citation. Không cần
chart library.

Trạng thái assistant trong MySQL là `PENDING`, `COMPLETED` hoặc `FAILED`; `COMPLETED` và `FAILED` là terminal. FE không poll cho response `duplicate=false` thành công. Nếu duplicate trả `PENDING`, poll `GET /api/chat/sessions/{id}/messages` và match `assistantMessage.id`; sau timeout có thể retry cùng request ID để stale recovery chuyển row cũ sang `FAILED`. Timeout/upstream/contract failure của request mới trả HTTP error và best-effort chuyển row sang `FAILED`. Nếu process crash đúng khoảng này, row có thể còn `PENDING`. Không có SSE/WebSocket hoặc assistant-status endpoint riêng.

### Lịch sử chat

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

## Trạng thái gửi ảnh trong chat

`NOT IMPLEMENTED`: supported contract của chat route là JSON `content` và optional `clientRequestId`; route không có multipart parser. Không có image field, image storage, image metadata hoặc truyền ảnh sang Python/model. `content` luôn bắt buộc và không rỗng. Document upload `POST /api/documents` không phải chat-image API.

Vì server chưa có image contract, hiện không có MIME/extension/magic-byte, số lượng hoặc dung lượng ảnh được cam kết. Nếu UC 11 được ưu tiên, BA/owner cần chốt multi-image, text-only/image-only semantics, retention/authorization và model vision trước khi Node/Python cùng triển khai.

## Avatar hồ sơ

`POST /api/profile/avatar` nhận multipart field `avatar`; `GET /api/profile/avatar` stream ảnh của chính user; `DELETE /api/profile/avatar` xóa reference theo kiểu idempotent. Cả ba route bắt buộc Bearer token và không có URL public cho avatar người khác. Profile trả `avatarAvailable`, `avatarMimeType` và `avatarUrl` là relative endpoint `/api/profile/avatar`, không trả storage key.

FE fetch `avatarUrl` với `Authorization`, nhận Blob, tạo object URL và revoke URL khi ảnh đổi hoặc component unmount. Không gắn URL trực tiếp nếu image loader không gửi Authorization; không suy ra `/uploads/...` vì Node không mount storage thành static route. Upload chỉ nên gửi JPEG/PNG/WebP một frame tối đa 5 MiB; server vẫn xác minh bằng nội dung thực, không tin filename/MIME client và từ chối ảnh động/multi-page.

## Trình xem nguồn và file gốc

### Điều hướng Library/citation

`STUDENT`, `TEACHER` và `ADMIN` dùng `/api/library` để đọc public document. `/api/documents` chỉ là management API; Student không được chuyển sang management source khi Library từ chối.

Luồng FE khi người dùng mở citation:

1. Gọi `GET /api/citations/{citationId}` bằng user Bearer token.
2. Đọc `documentId`, `documentTitle`, `pageNumber` (1-based khi có), `sourceText`, nullable `sourceLocator` và dynamic `previewUrl`/`originalFileUrl`.
3. Fetch `previewUrl` bằng Bearer để mở đúng canonical PDF mà Python đã ingest. Chỉ fetch `originalFileUrl` khi khác null; Student không nhận original URL cho PDF/DOCX.
4. Dùng `fetch` nhận `Blob`/`ArrayBuffer`; không gắn URL source được bảo vệ trực tiếp vào viewer nếu viewer không gửi `Authorization`.
5. Với PDF, tạo object URL từ Blob. Chỉ điều hướng tới `pageNumber` khi physical-page
   identity đã đáng tin cậy; nếu chưa, vẫn có thể mở PDF và hiển thị citation snapshot.
   Gọi `URL.revokeObjectURL()` khi đóng viewer hoặc thay file.

Fallback và lỗi:

- Không có locator từ Python: vẫn hiển thị/search `sourceText` từ immutable citation
  snapshot. Chỉ điều hướng tới physical PDF page khi `pageNumber` có trustworthy
  canonical physical-page identity. Geometry không phải điều kiện để page identity đúng;
  precise highlight vẫn là **OPTIONAL/LATER / NOT VERIFIED**.
- `originalAvailable=false`, `409 ORIGINAL_SOURCE_UNAVAILABLE`, hoặc original bị thiếu: vẫn hiển thị immutable citation snapshot.
- Document `HIDDEN`/`DELETED`: Library detail/source trả `404`; không nới scope và không retry qua `/api/documents` hay management source.
- `401`: xử lý session/login; `403`: hiển thị lỗi quyền, không đổi sang management API.
- DOCX `previewStatus=READY` có authenticated generated-PDF preview; Student `downloadUrl` cũng tải derived PDF, còn original DOCX chỉ dành cho owner Teacher/Admin. TXT stream/download uploaded TXT hiện hành.
- `sourceLocator` là null hoặc `{boxes:[{x,y,width,height}, ...]}`. Box theo thứ tự dòng,
  normalized 0–1, top-left trên canonical PDF page; FE không tự tạo box khi null. Node
  bình thường reject locator invalid; nếu client gặp dữ liệu malformed/legacy thì bỏ
  overlay và giữ `sourceText`; chỉ dùng `pageNumber` để điều hướng khi page identity đã
  được xác minh.

Node tạo PDF preview bất đồng bộ cho DOCX bằng durable preview job. Không có generated HTML; TXT không convert. Citation source endpoint vẫn trả immutable JSON snapshot để FE fallback, độc lập với current file availability.

| File/source | Endpoint | Response | Auth và state |
|---|---|---|---|
| Document Library metadata | `GET /api/library/documents`, `GET /api/library/documents/{id}` | JSON allowlist; `fileType` là loại artifact phân phối (`DOCX` đã có canonical PDF hiển thị là `PDF`); list có `q`, `fileType`, `author`, `page`, `limit`, `sort` và trả `offset/page/limit/total/totalPages/documents` | User JWT; STUDENT/TEACHER/ADMIN nhận cùng DTO; server cố định `READY + VISIBLE`. |
| Document Library original | `GET /api/library/documents/{id}/source` | Binary attachment, `Content-Length`, `Content-Disposition` | PDF/DOCX: owner TEACHER hoặc ADMIN; Student nhận `403`. TXT giữ authenticated Library fallback. Mọi record vẫn phải `READY + VISIBLE`. |
| Document Library preview | `GET /api/library/documents/{id}/preview` | PDF inline; original PDF hoặc generated DOCX PDF; tên UTF-8 ở `filename*` theo RFC 5987, kèm ASCII fallback | STUDENT/TEACHER/ADMIN; cùng fixed Library scope; `409` nếu pending/failed/not applicable/missing. |
| Document Library canonical download | `GET /api/library/documents/{id}/download` (DTO `downloadUrl`) | Attachment; PDF upload → chính PDF đó, DOCX → persistent derived PDF, TXT → uploaded TXT; UTF-8 `filename*` + ASCII fallback | STUDENT/TEACHER/ADMIN; luôn re-check `READY + VISIBLE`; URL đã lưu không bypass được hide/state change. Fetch bằng Bearer, endpoint không regenerate artifact. |
| PDF/DOCX/TXT original của document | `GET /api/documents/{id}/file` | `200`, MIME suy ra từ filename, `Content-Length`, `Content-Disposition: attachment` | User JWT; TEACHER uploader hoặc ADMIN. HIDDEN vẫn mở được; DELETED trả `404`. |
| Management preview | `GET /api/documents/{id}/preview` | PDF inline; tên UTF-8 ở `filename*` theo RFC 5987, kèm ASCII fallback | TEACHER uploader hoặc ADMIN; không mở cho Student. |
| Citation snapshot | `GET /api/citations/{id}/source` hoặc `GET /api/citations/{id}` | JSON gồm immutable snapshot, `originalAvailable`, dynamic `previewUrl`/`originalFileUrl` | User JWT và owner của chat session; snapshot vẫn tồn tại sau hide/delete, URL phản ánh quyền/state hiện tại. |
| Original qua citation | `GET /api/citations/{id}/file` | Binary attachment như original | Session owner trước, sau đó current source authorization. `DELETED` luôn unavailable; `HIDDEN` chỉ uploader/Admin được mở trong session của chính họ; file thiếu trả `409 ORIGINAL_SOURCE_UNAVAILABLE`. |

Upload document dùng Multer memory storage và cùng giới hạn `FILE_MAX_SIZE_BYTES` cho PDF/DOCX/TXT; default là `20 MiB`. Sai định dạng/signature trả `400`; quá giới hạn trả `413 FILE_TOO_LARGE`.

Document Library không dùng management DTO. Public metadata/preview giống nhau cho STUDENT/TEACHER/ADMIN; original availability/URL được tính theo actor. PDF `pageCount` là số trang vật lý original; DOCX là page count canonical PDF khi READY; TXT và DOCX pending/failed là `null`. Teacher/Admin có thể đọc public document của uploader khác qua Library nhưng chỉ owner Teacher/Admin được tải original PDF/DOCX. Không dựa vào query client để quyết định owner, processing, visibility, deletion hoặc job state.

List UI/Mobile nên gửi `page` (mặc định 1), `limit` (mặc định 20, tối đa 100) và một trong `newest`, `oldest`, `title_asc`, `title_desc`. `q` của Library tìm OR trên title/description/author; `fileType` lọc theo artifact phân phối (`PDF` gồm PDF upload và DOCX đã publish canonical PDF), còn partial `author` kết hợp AND. Management `fileType` vẫn là định dạng upload gốc; Management `q` tìm thêm original filename, status filters kết hợp AND và chỉ ADMIN được gửi `ownerId`. Server trim chuỗi và coi chuỗi whitespace là không truyền. `%`, `_`, `\` trong `q`/`author` là literal, nên FE không cần tự escape wildcard; URL encoding thông thường vẫn bắt buộc.

`q`/`page` là canonical. `search` là alias cũ của `q`: có thể gửi cả hai trong giai đoạn chuyển đổi nếu giá trị sau trim giống nhau; khác nhau trả `400`. `offset` là exact legacy offset: khi gửi riêng, response giữ nguyên `offset` và tính `page=floor(offset/limit)+1`; khi gửi cùng `page`, offset phải bằng `(page-1)*limit`, nếu không trả `400`. Client mới nên chỉ gửi `q` và `page`.

Download/preview dùng filesystem stream và có `Content-Length`, nhưng chưa implement byte `Range`, `206`, `Accept-Ranges` hoặc cache policy riêng. FE phải `fetch` Blob/ArrayBuffer với Bearer, tạo object URL cho PDF viewer và revoke khi đóng/thay file; không gắn protected URL trực tiếp nếu viewer không gửi Authorization. DOCX preview/Library download là derived PDF khi READY; original DOCX chỉ qua original-authorized route, còn TXT giữ uploaded TXT.

## Nguồn gốc trang và highlight

- Node chỉ chấp nhận `pageNumber >= 1` khi field tồn tại.
- Python PDF fallback dùng trang vật lý 1-based.
- Upload DOCX mới được Node convert trước ingest; Python nhận đúng canonical PDF nên `pageNumber`/locator hợp lệ phải quy chiếu PDF đó. DOCX legacy chưa được re-ingest không được mặc định là page-aligned. TXT vẫn có thể dùng synthetic segment nội bộ.
- LlamaParse primary đánh số theo thứ tự document fragment trả về; không có contract đảm bảo đó là physical page cho mọi format. Hai live runs ngày 2026-08-11 giữ đủ bốn output của fixture (gồm blank sentinel và image-only OCR), nên fixture đó không tái hiện lệch trang. Legacy metadata vẫn rỗng và không có explicit page field; kết luận là **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**, không phải production guarantee. Chưa có metadata field, page convention hoặc heuristic production mapping nào được chọn.
- `pageCount` là document preview metadata do Node sở hữu, không phải citation `pageNumber`; chưa có public paragraph index, character range hoặc chunk index.

Node hiện validate/lưu/trả `sourceLocator` là null hoặc ordered `boxes[]` normalized 0–1, top-left, nằm trọn trong trang. Node không sinh/clamp/fuzzy-search geometry. Python snapshot hiện chưa có runtime path sinh locator đúng occurrence, nên FE chỉ highlight khi field khác null. `sourceText` vẫn hiển thị được từ citation snapshot; điều hướng bằng `pageNumber` chỉ đáng tin cậy khi canonical physical-page identity đã được xác minh. Geometry không sửa hoặc thay thế page identity. Precise geometry/highlight là **OPTIONAL/LATER**; physical-page correctness là baseline riêng. Theo dõi acceptance phía Python tại [Python/Data-RAG handoff](../architecture/python-rag-handoff.md).

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

## CORS và xác thực

- Cross-origin browser phải dùng exact origin trong `CORS_ALLOWED_ORIGINS`; runtime default khi không cấu hình là empty allowlist.
- Local `.env.example` gợi ý `http://localhost:3000,http://localhost:5173`.
- Preflight `OPTIONS` hỗ trợ `Authorization` và `Content-Type`; credentials/cookie mode tắt.
- File routes nằm sau user Bearer authentication.
- `Content-Length` là CORS-safelisted response header. `Content-Disposition` hiện chưa nằm trong `Access-Control-Expose-Headers`, nên JavaScript cross-origin không đọc được filename header dù vẫn fetch được blob.

Nếu FE cần lấy filename trực tiếp từ `Content-Disposition`, Node cần một thay đổi nhỏ để expose header. Cho tới lúc đó dùng metadata đã biết hoặc filename fallback phía client.

## Miền email của Student

Runtime chỉ enforce cú pháp email chung. Service trim và lowercase email trước khi lưu/login; rule áp dụng giống nhau cho STUDENT và TEACHER. Không có server rule cho `@student.edu.vn`, và TEACHER không có domain riêng.

Requirement `@student.edu.vn` không có BA document canonical trong repository hiện tại. FE có thể cảnh báo theo UX nếu BA đã yêu cầu, nhưng không nên coi đó là server guarantee. Owner/BA cần chốt domain, subdomain/alias, case và migration cho account hiện hữu trước khi Node thêm enforcement.

## Ma trận hành động FE/Mobile

| Nhóm | Behavior hiện hành | Hành động FE/Mobile | Giới hạn/phụ thuộc |
|---|---|---|---|
| **Có thể triển khai ngay** | Request mới synchronous; duplicate có thể trả current `PENDING` | Loading đến khi HTTP xong; chỉ poll history cho duplicate-pending | Không streaming token/status endpoint riêng |
| **Có thể triển khai ngay** | History trả `messages` theo `messageOrder` | Render `senderType`, status và embedded citations | Usage không nằm trong history |
| **Có thể triển khai ngay** | Original là attachment; canonical preview/download dùng protected routes | Fetch Blob với Bearer; use URL only when non-null; revoke object URL | Không byte Range; cross-origin JS chưa đọc được `Content-Disposition` |
| **Có thể triển khai ngay** | New DOCX preview/download dùng cùng canonical derived PDF | Viewer mở PDF; chỉ điều hướng page khi identity đáng tin cậy | Legacy DOCX trước canonical flow không được mặc định page-aligned |
| **Citation snapshot sẵn sàng** | Locator thường `null`; shape/unit đã fixed ở Node contract | Hiển thị/search `sourceText`; không overlay khi locator null/invalid | Page navigation còn phụ thuộc trustworthy physical-page identity |
| **Baseline provenance còn residual risk** | Fixture bốn trang trả đủ output qua hai run, nhưng legacy path không có explicit page identity | Không mô tả `pageNumber` navigation là production-ready khi output có thể bị bỏ/gộp | Không chọn metadata, page convention hoặc heuristic mapping ở FE |
| **OPTIONAL/LATER UI** | Precise geometry/highlight chưa verified | Chỉ chờ geometry nếu sản phẩm chọn precise highlight | Geometry không phải điều kiện để page identity đúng |
| **Decision required** | Image chat chưa có | Chỉ gửi JSON text | Vision/image upload cần joint Node/Python/product contract |
| **Decision required** | Email domain chỉ format chung | Normalize UI và chỉ hiển thị BA warning nếu cần | Server enforcement cần BA/owner decision |
