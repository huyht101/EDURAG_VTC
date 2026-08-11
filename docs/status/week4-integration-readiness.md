# Bằng chứng tích hợp Python RAG — Week 4

> **HISTORICAL — NOT CURRENT AUTHORITY.** File này được giữ vì snapshot-local
> `python-service/README.md` đang tham chiếu nó và vì nó ghi provenance của bộ kiểm thử
> offline Week 4. Trạng thái hiện hành nằm tại
> [Python/Data-RAG handoff](../architecture/python-rag-handoff.md) và
> [project handoff](../../PROJECT_HANDOFF.md).

## Giá trị lịch sử được giữ

Week 4 ghi nhận snapshot có các thay đổi về retrieval-disabled upsert/activation,
deterministic point identity, exact-attempt cleanup, multi-call usage, citation safety và
idempotent hide/unhide/delete. Các Python test được báo cáo PASS trong workstream đó và
không gọi provider trả phí.

Đây là `PREVIOUS_REPORT_ONLY`: không chứng minh exact Python upstream revision, deployed
runtime hoặc current Node → Python → Qdrant compatibility. Cách gọi pre-ACK state trong
bản cũ không còn là terminology authority; contract hiện hành dùng `is_active=false`
trước ACK, còn `is_hidden` là visibility state riêng.

Danh sách action, invariant và acceptance hiện hành đã được hợp nhất vào
[Python/Data-RAG handoff](../architecture/python-rag-handoff.md). Git history giữ toàn bộ
checklist và số lượng test chi tiết của báo cáo Week 4 ban đầu.
