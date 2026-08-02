# Week 5 RAG evaluation note — HISTORICAL / INVALID AS QUALITY EVIDENCE

The values previously recorded in this file were randomly simulated without a real
retrieval/provider run. They must not be interpreted as hit rate, no-answer accuracy,
latency evidence, or as justification for `TOP_K`/threshold configuration.

Do not run `python-service/scripts/evaluate_rag.py` against a canonical Qdrant collection
in its current form. Static inspection on 2026-08-02 found that its evaluation ingest can
write retrieval-active points directly and it imports `pandas` without declaring the
dependency. This is tracked as `PY-EVAL-001` in the
[issue/quality register](../status/issue-quality-register.md).

A replacement evaluation result is valid only when it records:

- a versioned, reviewed dataset and deterministic selection method;
- a disposable Qdrant collection and zero canonical mutation;
- explicit provider/model/configuration or a clear offline label;
- actual per-case assertions and a non-zero process exit on failure;
- measured, reproducible metrics rather than random simulation.

Until the evaluator is hardened and rerun, Week 5 retrieval quality is **NOT VERIFIED**.
The Python repair and acceptance owner is defined in the
[Python/Data-RAG handoff](../architecture/python-rag-handoff.md).
