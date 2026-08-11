# Làm mới snapshot tích hợp Python

`python-service/` là tracked integration snapshot. Repository upstream riêng của nhóm
Python/Data-RAG mới là Python source of truth.

## Quy trình

1. Thống nhất upstream repository và exact commit/tag với nhóm Python.
2. Lấy source không kèm `.git` và không nhập `.env`, secret, venv, cache, Qdrant data,
   downloaded model, uploads hoặc source archive.
3. Thay nội dung dưới stable folder `python-service/`; chỉ flatten một archive wrapper nếu
   cần.
4. Giữ upstream source, tests, requirements, Dockerfile, Compose và service docs làm
   snapshot evidence.
5. Review diff và tách upstream changes khỏi Node compatibility overlay có sẵn. Mọi local
   Python patch có thể bị overwrite, nên fix cần thiết phải upstream trước refresh kế tiếp.
6. Audit lại routes, Pydantic schemas, processing attempt, callback manifest, citation
   identity, usage và internal auth.
7. Chạy checks có sẵn, không cài large dependency hoặc gọi provider chỉ để refresh:

   ```powershell
   python -m compileall python-service
   python -m pytest python-service/tests -q
   npm run test:contract
   npm run check
   ```

8. Cập nhật [snapshot metadata](../architecture/python-rag.md),
   [Python handoff](../architecture/python-rag-handoff.md),
   [project handoff](../../PROJECT_HANDOFF.md), [MVP matrix](../status/mvp-gap-matrix.md)
   và [internal contract](../api/internal-rag-contract.md) nếu observed capability đổi.
9. Kiểm tra Markdown links, ignored artifacts, nested `.git` và `git diff --check`.
10. Khi có thể, commit snapshot refresh tách khỏi Node feature và ghi imported upstream
    SHA trong commit/status.

Không thay Node database schema hoặc public API để che snapshot mismatch.
