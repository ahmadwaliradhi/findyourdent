"""FastAPI app factory for the agent service HTTP contract."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .adapters import Adapters, ModelQuotaExhaustedError, ModelUnavailableError
from .config import Settings
from .contracts.guidance_request import GuidanceRequest
from .contracts.guidance_response import GuidanceResponse
from .data import procedure_codes
from .escalation import default_matcher
from .guidance import AudioNotSupportedError, answer_turn
from .knowledge import bpjs_coverage, cost_estimates, guidance_safety

log = logging.getLogger("findyourdent_agent")

REQUEST_ID_HEADER = "X-Request-Id"


def _error(request: Request, status: int, code: str) -> JSONResponse:
    """A friendly retry state for the web app. Never carries Patient text."""
    request.state.outcome = code
    return JSONResponse(status_code=status, content={"error": code})


def create_app(adapters: Adapters | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if adapters is None:
        from .adapters.real import production_adapters

        adapters = production_adapters(settings)

    # Fail at startup, not on a Patient's request, if a knowledge file is broken or
    # misses a procedure code from the shared list.
    known = procedure_codes()
    for name, covered in (
        ("cost_estimates.json", set(cost_estimates().ranges)),
        ("bpjs_coverage.json", set(bpjs_coverage().procedures)),
    ):
        if known - covered:
            log.warning("%s misses procedure codes: %s", name, sorted(known - covered))
    guidance_safety()

    app = FastAPI(
        title="FindYourDent agent service",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
    )
    red_flags = default_matcher()
    app.state.adapters = adapters
    app.state.settings = settings

    @app.middleware("http")
    async def access_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            log.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": status,
                    "outcome": getattr(request.state, "outcome", "error"),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo input values back: they can hold complaint text.
        request.state.outcome = "invalid_request"
        detail = [
            {"type": e.get("type"), "loc": list(e.get("loc", ())), "msg": e.get("msg")}
            for e in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": detail})

    @app.get("/healthz")
    async def healthz(request: Request) -> dict[str, str]:
        request.state.outcome = "ok"
        return {"status": "ok"}

    @app.post(
        "/v1/guidance",
        response_model=GuidanceResponse,
        response_model_exclude_none=True,
    )
    async def guidance(body: GuidanceRequest, request: Request) -> Response:
        try:
            result = await answer_turn(
                body.root, gemini=adapters.gemini, red_flags=red_flags, settings=settings
            )
        except AudioNotSupportedError:
            return _error(request, 501, "audio_not_supported")
        except ModelQuotaExhaustedError:
            return _error(request, 503, "model_quota_exhausted")
        except ModelUnavailableError as error:
            log.error("gemini unavailable: %s", type(error).__name__)
            return _error(request, 503, "model_unavailable")
        request.state.outcome = result.outcome
        return JSONResponse(
            GuidanceResponse(root=result.response).model_dump(mode="json", exclude_none=True)
        )

    return app
