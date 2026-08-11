# HANDOFF triển khai Python/Data-RAG cho EDURAG MVP

> **HISTORICAL — NOT CURRENT AUTHORITY.** Tài liệu này giữ checklist và quyết định triển khai tại
> checkpoint 2026-08-03 để truy vết. Current project state nằm tại
> [root project handoff](../../PROJECT_HANDOFF.md); Python delivery, Owner-run
> integration, exact-attempt/stale-visibility invariants, acceptance checklist và
> out-of-scope hiện hành nằm tại
> [Python/Data-RAG handoff](../architecture/python-rag-handoff.md). Khi có khác biệt,
> hai tài liệu hiện hành đó và exact wire contract được ưu tiên.
> Shorthand “hidden upsert” bên dưới có nghĩa retrieval-disabled `is_active=false`
> trước ACK, không phải document visibility `is_hidden=true`.

Cập nhật: 2026-08-03

## 1. Mục tiêu và vai trò tài liệu

Tài liệu này được gửi kèm repository Python/RAG để team Python hoặc AI có thể đọc và bắt đầu triển khai ngay.

Đây là **implementation handoff**, dùng để xác định:

- phạm vi Python/Data-RAG cần thực hiện;
- behavior và invariant nghiệp vụ phải giữ;
- thứ tự ưu tiên;
- ranh giới ownership giữa Python và NodeJS/Core;
- tiêu chí bàn giao.

Tài liệu này **không tự thay thế exact wire contract**.

Exact field name, casing, enum, nullability và request/response shape được xác định bởi contract/fixtures hiện có trong repository, hiện gồm:

```text
docs/api/internal-rag-contract.md
tests/fixtures/rag-contract/v0.1/
scripts/rag-contract-test.js
```

Ba target tracked trên là authority hiện hành. Nội dung dưới nhãn `Old reference` chỉ mô tả snapshot cũ và không được dùng để thay contract tracked.

Thứ tự áp dụng:

1. Shared contract/fixtures xác định exact wire shape.
2. Handoff này xác định phạm vi, behavior và invariant cần đạt.
3. Code hiện có là implementation đầu vào cần kiểm tra và điều chỉnh.

Nếu handoff yêu cầu một behavior mà contract hiện tại chưa thể biểu diễn:

- không tự sửa Node schema, public API hoặc shared wire contract;
- không tự đoán field/ACK/callback mới;
- tiếp tục hoàn thiện các phần Python độc lập;
- cô lập compatibility adapter nếu có thể;
- ghi rõ shared-contract blocker để Node/Core hoặc Owner quyết định.

Không cần:

- tìm baseline hoặc pin revision để so sánh;
- lập gap matrix hoặc báo cáo hiện trạng dài;
- viết proposal hay thiết kế trung gian;
- dựng đầy đủ NodeJS/MySQL để bắt đầu làm;
- hoàn thành full integration/live E2E nếu chưa có môi trường, credential hoặc quota.

Cách thực hiện:

1. Đọc code, schema, contract, examples, config và test hiện có.
2. Giữ phần đang đúng; sửa hoặc refactor nội bộ phần chưa đáp ứng handoff.
3. Ưu tiên behavior cốt lõi trước việc làm đẹp cấu trúc.
4. Cập nhật đồng bộ code, Python schema, contract/examples, `.env.example` và README liên quan.
5. Chỉ dừng phần bị ảnh hưởng khi bắt buộc phải thay đổi Node schema, public API, MySQL hoặc shared lifecycle. Các phần Python độc lập vẫn tiếp tục hoàn thiện.

Repository được gửi có thể đã được sửa nhẹ so với bản dùng để chuẩn bị handoff. Phải xác minh code thực tế trước khi chỉnh; không ghi đè một implementation mới hơn chỉ vì phụ lục mô tả bản ZIP cũ.

## 2. Phạm vi và thứ tự ưu tiên

| Mức | Nội dung | Kết quả cần đạt |
|---|---|---|
| `P0` | Ingest, Qdrant và attempt isolation | Hidden upsert → callback/ACK → activate đúng attempt; retry/cleanup an toàn |
| `P0` | Provenance, retrieval, answer và citation | Trả đúng nguồn từ retrieved chunk; không dùng hidden/stale/deleted point; không bịa citation |
| `P0` | LLM usage | Báo từng LLM call thực tế theo contract, không bỏ hoặc cộng trùng |
| `P1` | Parsing và OCR `OFF|AUTO` | Default an toàn; key không tự bật OCR/premium parser; giữ đúng provenance |
| `P1` | Error, security, config và data safety | Không lộ secret/dữ liệu riêng; retry có giới hạn; test không làm bẩn corpus thật |
| `REQUIRED TEST` | Unit/offline và service contract trọng yếu | Kiểm tra các invariant/failure path chính, không phụ thuộc live provider |
| `OWNER VERIFY LATER` | Full Node → Python → Qdrant/live E2E | Code phải hỗ trợ; có thể ghi `NOT RUN/BLOCKED` nếu chưa chạy |
| `OPTIONAL/LATER` | Geometry chính xác, durable recovery và tuning nâng cao | Không tự mở rộng trong task này |

Không cần viết lại phần đã đạt yêu cầu. Không ưu tiên các phần nhỏ, refactor rộng hoặc test integration nặng trước khi P0/P1 hoàn tất.

## 3. Kiến trúc và ownership

Luồng tổng thể:

```text
Node upload/chat
→ Python ingest/query
→ parser/OCR + embedding/LLM + Qdrant
→ Python callback/query response
→ Node lưu business state, citation snapshot và usage
```

NodeJS/Core sở hữu:

- authentication/authorization người dùng và public API;
- original file, storage key và persistent derived artifact;
- DOCX-to-PDF conversion trong integrated flow;
- document, job, attempt và business state;
- MySQL, chat, immutable citation snapshot và usage persistence;
- quyết định hide, unhide và delete;
- callback transaction và machine ACK.

Python/Data-RAG sở hữu:

- parse/OCR, chunking và embedding;
- Qdrant collection, point, payload và retrieval state;
- exact-attempt activation/cleanup;
- retrieval, answer/no-answer;
- citation và LLM usage trả về Node;
- retry kỹ thuật nội bộ, error handling và logging.

Python không được:

- ghi MySQL hoặc tự đổi Node document/job state;
- thêm public endpoint hoặc tự thay shared wire contract;
- tự convert DOCX trong integrated flow hoặc thay canonical artifact;
- ghi vào shared upload mount;
- đưa secret, raw provider error, full private content hoặc internal filesystem path ra response, callback hay log.

## 4. Contract và tương thích

Business routes dùng internal bearer authentication; health check có thể public. JSON boundary dùng `snake_case`, trừ khi shared contract hiện hành quy định cụ thể khác.

Các operation cần được giữ:

| Operation | Method/path | Semantics |
|---|---|---|
| Health | `GET /api/health` | Synchronous |
| Ingest | `POST /api/ingest` | Validate/accept rồi trả `202`; kết quả qua callback |
| Query | `POST /api/query` | Synchronous `200` cho answer hoặc no-answer |
| Visibility | `PATCH /api/docs/{doc_id}/visibility` | `202`; kết quả qua callback |
| Delete vectors | `DELETE /api/ingest/{doc_id}` | `202`; kết quả qua callback |

Các identity cốt lõi:

- `doc_id`: document identity;
- `job_id + attempt_count`: processing attempt;
- `vector_node_id`: external vector identity và Qdrant point identity dùng để resolve citation;
- `chunk_index`: thứ tự chunk zero-based trong ingest attempt.

Nếu repository còn dùng `chunk_id` tại boundary:

- chuẩn hóa nội bộ về một vector identity duy nhất;
- sử dụng compatibility adapter nếu cần giữ contract cũ;
- không để `chunk_id` và `vector_node_id` trỏ tới hai point khác nhau;
- không đổi field public/shared nếu chưa được thống nhất.

Exact field name, casing, enum và nullability trong contract/fixtures phải được giữ khi chúng không mâu thuẫn với invariant nghiệp vụ.

Nếu ACK, `usage_calls[]`, manifest hoặc callback hiện tại chưa đủ để biểu diễn behavior bắt buộc:

- không tự tạo wire contract mới;
- hoàn thiện internal model/adapter nếu có thể;
- ghi shared-contract blocker kèm field hoặc behavior còn thiếu.

`202 Accepted` chỉ có nghĩa request đã authenticate, validate và được nhận để xử lý; không có nghĩa operation đã thành công.

## 5. P0 — Ingest và Qdrant lifecycle

Success flow bắt buộc:

```text
Node dispatch ingest
→ Python parse/OCR/chunk/embed
→ Qdrant hidden upsert
→ complete-manifest callback
→ Node transaction và machine ACK
→ Python activate vectors của đúng attempt
```

### 5.1 Invariant

- Whole-document success/failure; không có partial business success.
- Point mới không được retrieval trước ACK hợp lệ.
- Mỗi point giữ:
  - `doc_id`;
  - `job_id`;
  - `attempt_count`;
  - vector identity;
  - `chunk_index`;
  - exact chunk text;
  - retrieval state;
  - provenance cần thiết.
- Point ID phải deterministic cho cùng `doc_id + job_id + attempt_count + chunk_index` hoặc tuple tương đương.
- Replay cùng attempt không tạo duplicate active point.
- Attempt stale/conflicting không được activate, hide/unhide hoặc cleanup point của attempt hiện tại.
- Manifest chỉ chứa đầy đủ point đã upsert thành công của đúng attempt.

### 5.2 Complete manifest

Mỗi manifest item cần biểu diễn:

- `chunk_index` zero-based và không trùng;
- `vector_node_id` hoặc compatibility field tương ứng là actual Qdrant point ID;
- full `chunk_text` đã embedding/index;
- lowercase SHA-256 `content_hash` của exact UTF-8 `chunk_text`;
- optional `token_count`;
- optional physical `page_number` 1-based;
- optional heading;
- optional `source_locator` khi đáng tin cậy và shared contract hỗ trợ.

`text_preview` không thay được `chunk_text`. Ordering, hash và identity phải deterministic cho cùng input và attempt.

Không tự thêm `source_locator` vào shared payload nếu contract hiện hành chưa cho phép. Khi đó giữ provenance nội bộ nếu hữu ích, trả các field đã được contract hỗ trợ và ghi shared-contract blocker nếu locator cần được truyền qua boundary.

### 5.3 ACK và activation

Không coi mọi HTTP `200` là quyền activate.

Chỉ activate khi machine ACK:

- đọc và validate được theo schema hiện hành;
- match đúng document/job/attempt;
- xác nhận terminal success;
- có outcome được contract cho phép;
- explicit cho phép activation nếu contract có field này.

ACK thiếu/sai identity, unreadable, timeout, rejected hoặc stale không được activate.

Callback delivery retry phải giữ nguyên processing `attempt_count`.

Nếu contract hiện tại chưa có machine-readable ACK đủ để quyết định activation, không được tự suy success từ HTTP status. Hãy hoàn thiện phần hidden upsert/attempt isolation có thể làm độc lập và ghi shared-contract blocker.

### 5.4 Failure, retry và cleanup

Khi parse/OCR/chunk/embed/upsert/callback trước ACK thất bại:

- không gửi success callback;
- best-effort cleanup toàn bộ hidden point của exact attempt;
- không xóa point của attempt khác;
- gửi failure callback hiện có khi có thể;
- giữ error category hữu ích nhưng sanitize message.

Partial batch upsert failure phải cleanup cả những batch đã ghi của attempt đó.

Retry phải:

- bounded;
- giữ nguyên attempt identity;
- không tạo duplicate active point;
- không mở rộng cleanup sang attempt khác.

Nếu activation sau ACK thất bại:

- bounded retry nếu an toàn;
- giữ hoặc đưa toàn bộ exact attempt về non-retrievable nếu có thể làm an toàn;
- không tự sửa Node state;
- không tự thêm callback, endpoint hoặc lifecycle mới;
- ghi rõ residual state và shared-lifecycle blocker để Owner/Node/Core xử lý khi integration.

Process restart/lost task không bắt buộc phải được giải quyết bằng durable queue trong task này.

Tối thiểu:

- point chưa ACK không được trở thành retrievable;
- có cleanup exact-attempt có thể kiểm thử;
- limitation khi restart được ghi rõ;
- không tuyên bố recovery hoàn chỉnh chỉ dựa trên deterministic point ID.

### 5.5 Hide, unhide và delete

- Hide loại document khỏi retrieval nhưng không xóa point.
- Unhide chỉ bật lại active ingest attempt hợp lệ.
- Không bật lại hidden-upsert, failed, deleted hoặc stale point.
- Delete xóa đúng vectors của document theo contract; không xóa MySQL hoặc file.
- Callback giữ nguyên `job_id + attempt_count` của visibility/delete operation.
- Phải phân biệt:
  - attempt của operation hide/unhide/delete;
  - ingest attempt đang sở hữu vectors.
- Không dùng nhầm operation attempt để activate, unhide hoặc cleanup vectors.

## 6. P0 — Parse, chunk và provenance

Artifact mapping:

- PDF: xử lý canonical PDF Node cung cấp.
- DOCX: integrated flow xử lý persistent Node-derived PDF; Python không tự convert.
- TXT: đọc UTF-8 và không tạo physical page giả.

Yêu cầu:

- validate file tồn tại, loại file hợp lệ và có thể đọc;
- original filename không được dùng như filesystem path;
- PDF/DOCX-derived PDF dùng physical page 1-based;
- chunk có page provenance không vượt qua ranh giới page;
- blank PDF page không tạo chunk và không làm lệch số trang sau;
- TXT dùng `page_number=null`/omit;
- không chia TXT theo ký tự để tạo synthetic page;
- không tạo chunk rỗng/whitespace;
- chia text trước khi vượt giới hạn embedding model;
- embedding count phải khớp chunk count;
- từ chối vector rỗng, non-finite hoặc sai dimension;
- collection dimension phải khớp embedding model và fail rõ khi mismatch.

Provenance phải được giữ xuyên tuyến:

```text
parse/OCR output
→ chunk metadata
→ Qdrant payload
→ retrieval result
→ query citation
→ Node citation snapshot
```

Không được làm mất hoặc ánh xạ sai:

- `source_text`;
- document/vector identity;
- physical page;
- heading;
- source locator nếu có.

## 7. P0 — Retrieval, answer, citation, locator và usage

### 7.1 Retrieval và answer

- Chỉ retrieve active/enabled point thuộc document hợp lệ.
- Không trả hidden-upsert, failed, stale, deleted hoặc old-attempt point.
- Top-k và similarity threshold phải configurable.
- Empty/under-threshold retrieval trả HTTP `200`, `no_answer=true`, `citations=[]`.
- Answer RAG chỉ dựa trên retrieved context.
- Chat history có thể hỗ trợ hiểu câu hỏi nhưng không phải nguồn citation.
- Provider timeout/error thật là service error đã sanitize; không được biến thành no-answer.
- Không đủ evidence hoặc không map được nguồn đáng tin cậy thì fail closed thành no-answer.

### 7.2 Citation

Mỗi citation phải:

- xuất phát từ retrieved point thực tế;
- giữ đúng vector identity và `doc_id`;
- trả `source_text`/`snippet` trích trực tiếp từ cited chunk hoặc fragment tương ứng;
- chỉ có page 1-based khi có physical page đáng tin cậy;
- không dùng model paraphrase làm source text;
- không fabricate citation hoặc geometry.

Node dùng vector identity để resolve và lưu immutable citation snapshot.

Python không được yêu cầu Node suy identity từ:

- answer marker;
- document/page/text;
- similarity;
- hoặc một lần query lại Qdrant.

Citation marker `[n]` là 1-based reference tới retrieved context.

Extraction phải hiểu Markdown/GFM:

| Case | Expected |
|---|---|
| Prose/table có `[1]` | Resolve source 1 |
| Repeated `[1]` | Chỉ trả một citation, giữ lần xuất hiện đầu |
| Sparse `[3] ... [1]` | Resolve theo thứ tự 3 rồi 1 |
| Inline/fenced code có `[1]` | Bỏ qua |
| `array[0]`, invalid/nonnumeric/out-of-range | Bỏ qua, không fabricate |
| Mixed valid/invalid | Chỉ resolve valid marker |
| Missing source hoặc malformed Markdown | Không crash; deterministic; không fabricate |
| `no_answer=true` | Không có structured citation |

Không rewrite arbitrary Markdown hoặc code chỉ để chuẩn hóa marker.

### 7.3 Quy tắc `source_locator`

`source_locator` là optional.

Chỉ trả locator khi có ánh xạ đáng tin cậy tới:

- đúng đoạn `source_text`;
- đúng physical page;
- đúng source artifact.

Quy tắc:

- PDF và DOCX-derived PDF dùng physical page 1-based.
- TXT trả `source_locator=null` hoặc omit.
- Locator không đáng tin cậy phải trả `null`/omit.
- Không tạo full-page locator hoặc bounding box placeholder.
- Không suy geometry từ page number hoặc toàn bộ page.
- Không dùng geometry của đoạn khác có nội dung gần giống.
- OCR text không có geometry vẫn hợp lệ nếu page/source text đúng; locator để `null`.
- Citation vẫn phải hoạt động bằng vector identity, page và source text khi thiếu locator.

Shape, coordinate unit và coordinate origin phải theo shared contract/fixtures hiện hành.

Nếu contract chưa quy định:

- không tự tạo schema locator mới;
- không tự chọn pixel hoặc normalized `0–1`;
- không tự chọn top-left hoặc bottom-left origin;
- không tự quyết single box hay array boxes;
- giữ `page + source_text`;
- trả locator rỗng nếu schema cho phép;
- ghi shared-contract blocker nếu boundary cần truyền locator.

Precise occurrence geometry và PDF highlighting không thuộc acceptance bắt buộc hiện tại.

### 7.4 LLM usage

Trả từng LLM call thực tế theo `usage_calls[]` nếu target contract hỗ trợ:

- `call_index` liên tục, 1-based;
- đúng `operation_type`, ví dụ router/answer/chit-chat/rewrite, nếu call đó thật sự tồn tại;
- provider, model và token fields lấy từ provider;
- không bỏ router usage;
- không cộng trùng;
- không tạo token giả;
- dùng null/fallback theo schema khi provider thiếu usage và ghi limitation;
- không ghi embedding/OCR cost thành chat LLM usage nếu contract không yêu cầu.

Nếu contract hiện tại chỉ hỗ trợ aggregate `usage`:

- giữ compatibility field theo schema;
- chuẩn bị internal per-call representation nếu thực hiện an toàn;
- không tự thay wire response;
- ghi shared-contract blocker nếu Node cần `usage_calls[]`.

Legacy aggregate `usage` không được dùng để che việc bỏ mất một LLM call thực tế.

## 8. P1 — OCR `OFF|AUTO`

Tối thiểu hỗ trợ:

```text
OCR_MODE=OFF|AUTO
```

Quy tắc:

- Default `OFF`.
- Chỉ explicit `AUTO` mới cho phép OCR.
- Sự hiện diện của `LLAMA_CLOUD_API_KEY` hoặc key khác không được tự bật:
  - LlamaParse;
  - premium parser;
  - OCR;
  - hoặc thay parser mặc định.
- Alternate/premium parser phải có explicit config riêng.
- Invalid mode phải fail rõ.
- Secret không xuất hiện trong log, response hoặc callback.

Trong `AUTO`, quyết định ở mức page:

- digital page đủ text: ưu tiên native extraction, không OCR;
- scan/image-only page: OCR;
- mixed PDF: giữ đúng thứ tự page và nguồn text;
- blank page hợp lệ: không tự làm document fail;
- page bắt buộc OCR nhưng timeout/provider error/output invalid: fail whole document;
- không silent fallback về empty text rồi báo success;
- OCR text không có geometry đáng tin cậy vẫn hợp lệ với locator `null`.

Team Python được tự chọn:

- provider/library;
- digital-vs-scan threshold;
- timeout;
- bounded retry;
- batch strategy.

Các giá trị phải configurable và được ghi trong README/`.env.example`.

Unit test dùng fixture/mock. Không tự gọi paid/live provider trong test mặc định.

## 9. P1 — Error, security, config và data safety

- Từ chối missing/invalid internal secret trên business route.
- Validate request boundary, enum, `attempt_count`, required field và payload hợp lý.
- Retry/provider/callback đều có timeout, backoff và giới hạn.
- Phân loại lỗi tối thiểu:
  - authentication;
  - validation;
  - file/parse/OCR;
  - embedding;
  - Qdrant;
  - callback;
  - LLM provider.
- Không trả raw exception hoặc raw provider response.
- Không log:
  - key/token;
  - full authorization header;
  - full document/source text;
  - unnecessary full question/history.
- Không âm thầm dùng insecure production default.
- `.env.example`/README phải ghi đúng biến đang dùng và không chứa secret thật.
- Không commit:
  - `.env`;
  - credential;
  - corpus riêng tư;
  - Qdrant data;
  - cache sinh ra.

Evaluator/test script:

- chỉ dùng disposable test collection;
- mặc định từ chối canonical/protected/ambiguous target;
- không upsert retrieval-active test point vào corpus thật;
- không tự gọi paid/live provider;
- khai báo đủ dependency;
- exit non-zero khi safety/assertion fail;
- phân biệt simulation với actual retrieval evaluation.

Migration/re-ingest hoặc xóa dữ liệu Qdrant/corpus hiện có không thuộc task này.

Test phải dùng collection mới/disposable. Không tự dọn, chuyển đổi hoặc ghi đè dữ liệu có sẵn.

## 10. Kiểm thử cần thực hiện và phần Owner kiểm tra sau

### 10.1 Team Python cần thực hiện

Ưu tiên test tập trung, deterministic và offline cho các behavior cốt lõi đã chỉnh.

Tối thiểu cần kiểm tra:

- OCR/config guard:
  - `OCR_MODE=OFF`;
  - `OCR_MODE=AUTO`;
  - API key không tự bật OCR/premium parser;
  - OCR failure không silent fallback.
- PDF physical page 1-based.
- TXT không có synthetic page.
- Chunk không cross-page.
- Deterministic point identity, hash và ordering.
- Embedding count/dimension validation.
- Point hidden trước ACK.
- ACK missing/mismatch/rejected không activate.
- Replay/stale attempt không ảnh hưởng current attempt.
- Partial-upsert cleanup đúng exact attempt.
- Hide/unhide không bật stale hoặc hidden-ingest point.
- Query no-answer khác provider error.
- Citation map đúng vector/document/source/page.
- Locator thiếu hoặc không đáng tin cậy trả `null`/omit.
- Không tạo bounding box giả.
- Các Markdown marker case trọng yếu tại Mục 7.2.
- Usage không bỏ hoặc cộng trùng LLM call.
- Authentication, schema validation và sanitized error.

Chạy hoặc bổ sung service/API contract tests trọng yếu cho:

- request/response schema;
- `202 Accepted` semantics;
- complete manifest;
- callback và ACK parsing;
- query answer/no-answer/citation/usage;
- visibility/delete callback identity.

Không cần mở rộng thành bộ integration test liên dịch vụ đầy đủ trong task này.

Mock/fake được dùng cho unit/offline nhưng kết quả phải ghi đúng loại; không gọi đó là live E2E.

### 10.2 Owner có thể kiểm tra sau

Không bắt buộc team Python phải dựng full Node/MySQL hoặc có live credential để hoàn thành phần code.

Các kiểm tra sau có thể để Owner thực hiện sau và ghi `NOT RUN` hoặc `BLOCKED`:

- Node → Python → Qdrant → callback/ACK;
- PDF remote E2E;
- TXT remote E2E;
- DOCX-derived PDF remote E2E;
- live OCR/provider;
- hide/unhide/delete xuyên service;
- Node persistence của citation snapshot;
- Node persistence của từng usage call;
- kiểm tra file/source access phía public API.

Team Python cần giữ code, config và fixture đủ rõ để Owner chạy các kiểm tra này.

Kết quả test sử dụng:

- `PASS`;
- `FAIL`;
- `BLOCKED`;
- `NOT RUN`.

Không dùng unit/mock/contract test để tuyên bố `LIVE E2E PASS`.

## 11. Definition of done

Implementation được coi là hoàn thành khi:

- P0/P1 được triển khai hoặc có shared-contract blocker cụ thể;
- code, Python schema, docs/examples và tests nhất quán;
- hidden-upsert/ACK/activation đúng invariant;
- exact-attempt identity và cleanup đúng;
- parse/OCR/chunk/embedding/provenance đúng;
- retrieval/citation/usage đúng và fail closed;
- locator tuân theo shared contract hoặc trả null/omit an toàn;
- không tạo page, citation, locator hoặc bounding box giả;
- security/config/data safety được đáp ứng;
- unit/offline và service contract test trọng yếu PASS;
- integration/live chưa chạy được ghi rõ;
- không tự thay Node schema, public API, MySQL hoặc shared lifecycle.

Một shared-contract blocker không làm vô hiệu các phần Python độc lập đã hoàn thành.

Không cần giữ task mở chỉ vì Owner chưa chạy full integration.

## 12. Bàn giao cuối

Gửi một lần:

1. Branch/commit Python nếu repository dùng Git.
2. Danh sách file thay đổi chính.
3. Tóm tắt implementation theo P0/P1.
4. Cấu hình mới, default value và cách chạy.
5. Lệnh test và kết quả `PASS|FAIL|BLOCKED|NOT RUN`.
6. Known limitation, residual state/risk và shared-contract blocker.
7. Xác nhận không tự đổi Node schema, public API, MySQL hoặc shared lifecycle.

Không cần proposal hoặc báo cáo trung gian, trừ blocker bắt buộc làm thay đổi shared boundary.

## 13. OPTIONAL/LATER

Không bắt buộc trong task này:

- `OCR_MODE=FORCE`;
- region OCR;
- precise occurrence geometry/PDF highlighting;
- advanced crop/rotation geometry normalization;
- multi-provider failover phức tạp;
- hybrid search;
- reranker hoặc tuning ngoài MVP;
- durable queue/workflow engine;
- cross-service reconciliation lifecycle mới;
- OCR/embedding billing system;
- PPTX/image upload;
- object-storage redesign;
- public reprocess API;
- Node/MySQL schema mới.

Không tự mở rộng các phần này nếu ảnh hưởng P0/P1 hoặc shared contract.

## 14. Phụ lục — điểm bắt đầu đã thấy trong bản ZIP cũ

Phụ lục này chỉ giúp định vị. Phải kiểm tra repository thực tế trước khi sửa.

- `services/ingestion.py` từng dùng UUID ngẫu nhiên, upsert retrieval-visible trước callback và chưa cô lập/cleanup theo attempt.
- `services/callback.py` từng chỉ kiểm tra HTTP `200`, chưa validate machine ACK.
- `services/parser.py` từng chọn LlamaParse theo API key; TXT/DOCX tạo page giả; OCR `AUTO` chưa hoàn chỉnh.
- `services/rag_engine.py` từng extract citation bằng regex global; usage mới ở dạng aggregate và có thể bỏ router usage.
- `services/doc_manager.py` từng hide/unhide theo toàn bộ `doc_id`, có nguy cơ bật lại hidden/stale point.
- `core/config.py` từng có provider key/default internal secret cần làm an toàn và configurable.
- Contract/examples/tests từng phản ánh contract v0.1.1 cũ, gồm `chunk_id` và aggregate `usage`.

Khi repository thực tế đã có implementation tốt hơn các mô tả trên, giữ implementation mới và chỉ kiểm tra lại behavior bằng test phù hợp.

Không cần viết lại toàn bộ repository. Ưu tiên thay đổi nhỏ, có kiểm chứng, tập trung vào behavior cốt lõi và boundary rõ ràng.
