# EDURAG NodeJS/Core

Backend MVP cho trợ lý học tập dùng Retrieval-Augmented Generation (RAG). Repository
gốc chứa NodeJS/Core; `python-service/` là snapshot tích hợp từ repository riêng của
nhóm Python/Data-RAG, không phải nguồn upstream chính thức.

## Kiến trúc

- NodeJS/Express sở hữu public API, xác thực/phân quyền, vòng đời tài liệu và job, chat,
  citation, usage và giao dịch MySQL.
- Python sở hữu parse/OCR, chunk, embedding, retrieval/generation và Qdrant.
- Node không truy cập Qdrant; Python không ghi MySQL.
- GCS chỉ được host-side corpus tooling dùng để phân phối immutable release; runtime
  Node/Python không dùng GCS làm storage trực tiếp.

Chi tiết: [tổng quan kiến trúc](docs/architecture/system-overview.md) và
[ranh giới Node–Python](docs/api/internal-rag-contract.md).

## Chạy project

Yêu cầu Node.js 20+, Docker Desktop và Docker Compose.

```powershell
npm ci
Copy-Item .env.example .env
npm run docker:remote:dev
```

Điền cấu hình bắt buộc trong root `.env`; không commit environment file hoặc credential.
Full topology, corpus bootstrap và troubleshooting nằm tại
[Remote Docker RAG](docs/setup/remote-rag-e2e.md). Node chạy trực tiếp và các kiểm tra
local nằm tại [phát triển local](docs/setup/local-development.md).

Các URL mặc định:

- Swagger: <http://localhost:5001/api-docs>
- OpenAPI: <http://localhost:5001/api-docs.json>
- Liveness: <http://localhost:5001/health>
- Readiness Node + MySQL: <http://localhost:5001/ready>

Demo Admin local: `admin@example.com` / `123456`. Sau login, lấy OTP development từ app
log rồi gọi `POST /api/auth/admin/verify-otp`.

Database hiện hữu phải backup rồi chạy `npm run db:migrate`. Backfill preview/page metadata
được kiểm tra trước bằng `npm run documents:backfill -- --dry-run`; không tự coi dry-run
hoặc disposable database là production migration evidence.

## Phạm vi và trạng thái

CURRENT/MVP gồm account/auth, Teacher approval, Document Management và Library,
PDF/DOCX/TXT processing, chat RAG, immutable citation snapshot, usage dashboard, internal
Node–Python boundary và portable private corpus tooling.

Project đang ở giai đoạn integration/demo và chuẩn bị báo cáo, chưa production-ready.
Live full-stack hiện hành, FE/Mobile implementation, general LlamaParse physical-page
identity và current remote corpus state vẫn phải được báo đúng mức evidence. Geometry/
precise highlight, image chat, subject/course/class, durable queue và các hạng mục mở rộng
là `OPTIONAL-LATER` hoặc còn quyết định riêng.

Điểm bắt đầu đọc tài liệu:

- [Bản đồ tài liệu](docs/README.md)
- [Trạng thái project hiện hành](PROJECT_HANDOFF.md)
- [Tổng quan kỹ thuật phục vụ báo cáo](docs/report/technical-overview.vi.md)
- [Ma trận phạm vi MVP](docs/status/mvp-gap-matrix.md)

---

## Phụ lục — Mock mode (REFERENCE ONLY)

Mock chỉ dành cho regression nhanh; không kiểm chứng Python/Qdrant/provider thật và không
phải fallback khi remote lỗi.

```powershell
npm run docker:mock:up
```
