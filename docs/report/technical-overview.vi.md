# Tổng quan kỹ thuật EDURAG phục vụ viết báo cáo

Tài liệu này là bản tóm tắt dẫn đường, không phải authority thứ hai. Exact behavior thuộc
OpenAPI/runtime, database thuộc executable schema, Node–Python payload thuộc internal
contract; current state thuộc [project handoff](../../PROJECT_HANDOFF.md).

## 1. Mục tiêu và phạm vi

EDURAG là backend MVP cho trợ lý học tập dùng RAG. Repository gốc chứa NodeJS/Core;
`python-service/` là integration snapshot từ upstream riêng của nhóm Python/Data-RAG.

CURRENT/MVP gồm:

- account/auth, Teacher approval, lock/unlock, profile/avatar và Admin user export;
- Document Management và Library cho PDF/DOCX/TXT;
- asynchronous processing job và Node–Python callback;
- chat/history/idempotency, structured citation snapshot và LLM usage;
- Swagger/OpenAPI, local/remote Docker topology và portable private corpus tooling.

Project phù hợp integration/demo và viết báo cáo, chưa production-ready. Scope chi tiết và
Owner action nằm tại [MVP matrix](../status/mvp-gap-matrix.md) và
[issue register](../status/issue-quality-register.md).

## 2. Kiến trúc

```text
Web/Mobile → NodeJS/Core → MySQL + local file artifacts
                  │
                  └─ internal Bearer → Python RAG → Qdrant/providers
```

Node sở hữu public API, auth/authorization, business lifecycle, artifact, chat/citation/
usage và MySQL. Python sở hữu parse/OCR, chunk, embedding, retrieval/generation và Qdrant.
Node không truy cập Qdrant; Python không ghi MySQL. GCS chỉ phục vụ host-side immutable
corpus distribution.

Authority: [tổng quan hệ thống](../architecture/system-overview.md).

## 3. Quy tắc nghiệp vụ chính

- Mỗi user có một role `STUDENT|TEACHER|ADMIN`; Teacher cần Admin approve.
- Teacher quản lý document mình upload; Admin quản lý mọi document. Library cho mọi user
  `ACTIVE` nhưng luôn cố định `READY + VISIBLE`.
- Thay file tạo document mới; metadata update không tự re-ingest.
- Delete là soft delete business state và xóa vector qua Python; lịch sử/citation snapshot
  vẫn được giữ theo authorization hiện hành.
- Chat thuộc session owner. `no_answer=true` là success không có citation; normal answer
  phải có structured source map được về chunk/document hợp lệ.
- CURRENT không có subject/course/class access scope, image chat hoặc public reprocess.

Chi tiết: [Account/Auth](../modules/account-auth.md), [Documents](../modules/documents.md),
[Chat/Citations](../modules/chat-citations.md), [Usage/Dashboard](../modules/usage-dashboard.md).

## 4. Database và vòng đời dữ liệu

`src/database/schema.sql` là executable authority cho fresh database; migrations versioned
áp dụng database hiện hữu. Schema có 12 business table và `schema_migrations`. Node là
MySQL writer duy nhất.

PDF dùng uploaded bytes làm canonical preview/ingest; DOCX giữ original nhưng Node tạo
persistent canonical PDF trước ingest; TXT không có physical-PDF semantics. Citation giữ
immutable title/page/section/source/locator snapshot. Usage có một row cho mỗi LLM call.

Xem [database index](../database/README.md), [ERD/design](../database/design.md) và
[data dictionary](../database/data-dictionary.md).

## 5. Ingest, retrieval và chat

```text
Node upload/job → Python parse/chunk/embed
→ Qdrant retrieval-disabled (`is_active=false`)
→ complete manifest → Node transaction + machine ACK
→ activate exact attempt
```

`is_hidden` là visibility state riêng. MySQL–Qdrant không có distributed transaction;
exact attempt, fail-closed state, idempotent callback và bounded compensation giữ
consistency. Recovery ownership và stale visibility ordering vẫn chưa operationally
accepted.

Chat commit USER/ASSISTANT `PENDING` trước RAG call, gửi bounded history rồi persist
assistant/citations/usage transactionally. `clientRequestId` chống duplicate logical
request. Node không parse `[N]` trong answer để tạo citation.

Authority: [internal RAG contract](../api/internal-rag-contract.md) và
[Python handoff](../architecture/python-rag-handoff.md).

## 6. API, tích hợp và demo

- Public endpoint/shape/status/error: runtime `/api-docs.json` và
  [public API overview](../api/public-api.md).
- Web/Mobile viewer, protected Blob và fallback: [frontend integration](../api/frontend-integration.md).
- Setup/demo: [root README](../../README.md) và [Remote Docker RAG](../setup/remote-rag-e2e.md).
- Live acceptance chỉ chạy theo [Phase 2 runbook](../testing/phase2-live-acceptance-runbook.md)
  khi Owner cấp scope, credential và disposable target.

Mock/local regression không phải live Python/provider evidence.

## 7. Mức bằng chứng hiện hành

| Mức | Nội dung |
|---|---|
| `CURRENT_VERIFIED` ở repository boundary | Node behavior/schema/OpenAPI/contracts và các regression được chạy cho exact workstream tương ứng |
| Đã triển khai nhưng live E2E chưa current verified | Topology Node → Python → Qdrant/provider hiện hành; FE/Mobile implementation; exact Python upstream delivery |
| `PREVIOUS_REPORT_ONLY` | Isolated provider/corpus acceptance tại commit `23afbec` cho exact revision/release/scope của lần đó |
| Bounded page probe | Hai LlamaParse jobs cùng fixture trả đủ bốn output nhất quán, nhưng không có explicit page field |
| `OPTIONAL-LATER` | Precise geometry/highlight và các feature mở rộng ngoài MVP |

Không dùng report/test cũ để nâng current external state.

## 8. Rủi ro tồn dư cần ghi trong báo cáo

- **Physical-page identity:** fixture không tái hiện lệch, nhưng legacy LlamaParse output
  không có explicit physical-page metadata; ordinal không phải general provider guarantee.
  Xem [source locator](../architecture/source-locator-handoff.md).
- **Visibility/recovery:** stale hide/unhide ordering và recovery/reconciliation owner/
  acceptance gate chưa chốt.
- **Python provenance:** upstream branch/commit của snapshot là `UNKNOWN`.
- **Corpus:** `CORPUS-EQ-001` vẫn unresolved; `CORPUS-ACC-001` chỉ là isolated evidence;
  current exact-key/GCS/archive-key/remote state chưa verified.
- **Migration:** interrupted multi-statement MySQL DDL cần inspect/repair, không blind rerun.
- **Product/production:** FE/Mobile integration, durable queue, full OCR quality/privacy,
  distributed rate limit, precise highlight và production hardening chưa current verified.

Các risk trên không làm mất giá trị integration/demo, nhưng không được đổi thành completed
chỉ để hoàn thiện báo cáo.
