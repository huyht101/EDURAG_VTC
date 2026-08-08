"""Check or recover one exact Qdrant ingest attempt without touching MySQL."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.attempt_recovery import (
    AttemptRecoveryError,
    inspect_ready_attempt,
    recover_ready_attempt,
    runtime_client_and_collection,
)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--attempt-count", required=True, type=int)
    parser.add_argument("--expected-node-status", required=True, choices=["READY"])
    parser.add_argument("--recover", action="store_true")
    parser.add_argument("--confirm-ready-exact-attempt", action="store_true")
    return parser.parse_args()


async def main() -> int:
    args = parse_args()
    if args.recover and not args.confirm_ready_exact_attempt:
        raise AttemptRecoveryError(
            "RECOVERY_CONFIRMATION_REQUIRED",
            "Recovery requires --confirm-ready-exact-attempt after checking Node state.",
        )
    client, collection = await runtime_client_and_collection()
    operation = recover_ready_attempt if args.recover else inspect_ready_attempt
    result = operation(
        client,
        collection,
        args.document_id,
        args.job_id,
        args.attempt_count,
        args.expected_node_status,
    )
    print(json.dumps({"event": "RAG_ATTEMPT_CONSISTENCY", **result.to_dict()}, sort_keys=True))
    return 0 if result.status == "CONSISTENT" else 2


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except AttemptRecoveryError as error:
        print(json.dumps({
            "event": "RAG_ATTEMPT_RECOVERY_REFUSED",
            "code": error.code,
            "message": str(error),
        }, sort_keys=True))
        raise SystemExit(2)
