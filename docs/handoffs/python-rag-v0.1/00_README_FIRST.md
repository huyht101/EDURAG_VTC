# Python RAG v0.1 handoff

Mục tiêu: giúp team Python hoàn tất boundary compatibility trước remote E2E.

Đọc theo thứ tự:

1. `01_internal-rag-contract-v0.1.md` — canonical contract được copy vào ZIP lúc build.
2. `02_required-python-changes.md`.
3. `03_deployment-and-env.md`.
4. `04_acceptance-checklist.md`.
5. `05_python-codex-prompt.md`.
6. `fixtures/`.

Baseline NodeJS: `c66bf056d0bea40542c2a3ce558e7ea641523c4d`.

Source Python đã audit: `python-service/`.

Handoff này không yêu cầu thay đổi retrieval quality, database schema hoặc public NodeJS API. Remote E2E chưa được chạy.

Canonical source trong repository vẫn là `docs/api/internal-rag-contract.md`; không chỉnh bản contract bên trong ZIP rồi để drift.
