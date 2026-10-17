"""Structured JSON logs with request id and outcome only (spec 00, UU 27/2022).

Request bodies, complaint text, audio and model output are never logged. Only the
fields listed in ``_ALLOWED_EXTRA`` ever reach a log line.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime

_ALLOWED_EXTRA = ("request_id", "method", "path", "status", "outcome", "duration_ms")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in _ALLOWED_EXTRA:
            if hasattr(record, key):
                entry[key] = getattr(record, key)
        if record.exc_info:
            # Exception type only: messages can echo request data.
            entry["exception"] = record.exc_info[0].__name__ if record.exc_info[0] else None
        return json.dumps(entry, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # Our middleware writes one access line per request; uvicorn's own is redundant.
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers[:] = []
        logging.getLogger(name).propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers[:] = []
    access.propagate = False
    access.disabled = True
