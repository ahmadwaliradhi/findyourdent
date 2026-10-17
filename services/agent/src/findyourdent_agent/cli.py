"""Console entry points.

``uv run --directory services/agent agent-dev``   reload server on http://127.0.0.1:8000
``uv run --directory services/agent agent-serve`` production-style server on 0.0.0.0:$PORT
"""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from .config import Settings
from .logging_config import configure_logging

APP_FACTORY = "findyourdent_agent.cli:app_from_env"
PACKAGE_DIR = Path(__file__).resolve().parent


def app_from_env() -> FastAPI:
    from .app import create_app

    settings = Settings.from_env()
    configure_logging(settings.log_level)
    return create_app(settings=settings)


def dev() -> None:
    configure_logging(Settings.from_env().log_level)
    uvicorn.run(
        APP_FACTORY,
        factory=True,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        reload=True,
        reload_dirs=[str(PACKAGE_DIR)],
        access_log=False,
        log_config=None,
    )


def serve() -> None:
    configure_logging(Settings.from_env().log_level)
    uvicorn.run(
        APP_FACTORY,
        factory=True,
        host="0.0.0.0",  # noqa: S104 - Cloud Run requires binding all interfaces
        port=int(os.environ.get("PORT", "8080")),
        access_log=False,
        log_config=None,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
