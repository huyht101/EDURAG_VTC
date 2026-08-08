"""Evaluation tooling must be offline by default and refuse canonical targets."""

import pytest

from scripts.evaluate_rag import (
    _live_evaluation_enabled,
    _resolve_evaluation_collection,
    evaluate,
)


def test_live_evaluation_is_opt_in():
    assert _live_evaluation_enabled({}) is False
    assert _live_evaluation_enabled({"EVAL_LIVE_MODE": "false"}) is False
    assert _live_evaluation_enabled({"EVAL_LIVE_MODE": "true"}) is True


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {"EVAL_QDRANT_COLLECTION": "education_docs"},
        {"EVAL_QDRANT_COLLECTION": "arbitrary_shared_collection"},
    ],
)
def test_live_evaluation_fails_closed_for_missing_canonical_or_unscoped_target(environment):
    with pytest.raises(RuntimeError):
        _resolve_evaluation_collection("education_docs", environment)


def test_live_evaluation_accepts_only_recognizable_disposable_target():
    target = _resolve_evaluation_collection(
        "education_docs",
        {"EVAL_QDRANT_COLLECTION": "edurag_eval_offline_fixture"},
    )
    assert target == "edurag_eval_offline_fixture"


@pytest.mark.asyncio
async def test_default_evaluation_path_is_simulation_and_does_not_require_provider():
    rows = await evaluate({"TOP_K": 3, "SIMILARITY_THRESHOLD": 0.3}, live_mode=False)
    assert rows
    assert {row["mode"] for row in rows} == {"SIMULATION_ONLY"}
    assert all(row["correct_no_answer"] for row in rows)
