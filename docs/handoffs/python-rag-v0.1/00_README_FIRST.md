# Internal/historical Python RAG v0.1 handoff notes

> Internal record only. The reduced handoff package is managed outside this repository. These notes and prompts are not a second API contract and may be stale after a Python snapshot refresh.

Mục tiêu: giúp team Python hoàn tất boundary compatibility trước remote E2E.

Đọc theo thứ tự:

1. `01_internal-rag-contract-v0.1.md` — exported packages copied the root canonical contract under this name.
2. `02_required-python-changes.md`.
3. `03_deployment-and-env.md`.
4. `04_acceptance-checklist.md`.
5. `05_python-codex-prompt.md`.
6. `fixtures/`.

Baseline NodeJS: `c66bf056d0bea40542c2a3ce558e7ea641523c4d`.

Python evidence đã audit: `python-service/` snapshot. Repository upstream riêng của team Python mới là source of truth.

Handoff này không yêu cầu thay đổi retrieval quality, database schema hoặc public NodeJS API. Remote E2E chưa được chạy.

Canonical source trong repository vẫn là `docs/api/internal-rag-contract.md`; không chỉnh bản contract bên trong ZIP rồi để drift.
