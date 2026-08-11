# Week 5 RAG evaluation note

> **HISTORICAL — NOT CURRENT AUTHORITY.** The simulated values are invalid as retrieval
> quality evidence. The unreferenced companion `evaluation_summary.csv` was removed in
> the final data cleanup so it cannot be mistaken for measured results.

The values previously recorded for this Week 5 activity were randomly simulated without a real
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
