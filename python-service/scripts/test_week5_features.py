"""Compatibility wrapper for the behavioral Week 5 regression tests."""

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    service_root = Path(__file__).resolve().parent.parent
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    command = [
        sys.executable,
        "-m",
        "pytest",
        "tests/test_ingestion.py",
        "tests/test_qdrant_lifecycle.py",
        "tests/test_rag_engine.py",
        "-q",
        "-p",
        "no:cacheprovider",
    ]
    return subprocess.run(command, cwd=service_root, env=environment, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
