"""Manual provider/write scripts must refuse default execution."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


SERVICE_ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.parametrize(
    ("script", "expected"),
    [
        ("test_api_key.py", "Refusing provider call"),
        ("test_local.py", "Refusing manual parser run"),
        ("test_real.py", "Refusing live ingest"),
        ("test_search.py", "Refusing live provider query"),
        ("test_all.py", "Refusing live test"),
    ],
)
def test_manual_script_refuses_default_execution(script, expected):
    environment = os.environ.copy()
    environment.pop("RAG_MANUAL_LIVE_CONFIRM", None)
    result = subprocess.run(
        [sys.executable, "-B", script],
        cwd=SERVICE_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    output = f"{result.stdout}\n{result.stderr}"
    assert result.returncode != 0
    assert expected in output
