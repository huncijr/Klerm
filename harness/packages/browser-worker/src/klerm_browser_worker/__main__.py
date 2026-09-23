"""Process entry point with stdout reserved exclusively for protocol events."""

from __future__ import annotations

import asyncio
import os
import sys

from .protocol import EventWriter
from .worker import Worker


def main() -> None:
    protocol_output = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
    devnull = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull, sys.stdout.fileno())
        os.dup2(devnull, sys.stderr.fileno())
    finally:
        os.close(devnull)
    asyncio.run(Worker(sys.stdin, EventWriter(protocol_output)).serve())


if __name__ == "__main__":
    main()
