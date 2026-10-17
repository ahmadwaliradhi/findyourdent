"""FastAPI app factory for the agent service HTTP contract."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .adapters import Adapters
from .config import Settings
from .contracts.guidance_request import GuidanceRequest
from .contracts.guidance_response import GuidanceResponse
from .data import procedure_codes
from .stub import PROCEDURES, stub_guidance

log = logging.getLogger("findyourdent_agent")

REQUEST_ID_HEADER = "X-Request-Id"


def create_app(adapters: Adapters | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if adapters is None:
        from .adapters.real import production_adapters

        adapters = production_adapters(settings)

    known = procedure_codes()
    if known and not set(PROCEDURES) <= known:
        missing = sorted(set(PROCEDURES) - known)
        log.warning("stub procedure codes missing from procedures.json: %s", missing)

    app = FastAPI(
        title="FindYourDent agent service",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
    )
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

    # Not /healthz: Cloud Run reserves some paths ending in "z".
    @app.get("/health")
    async def health(request: Request) -> dict[str, str]:
        request.state.outcome = "ok"
        return {"status": "ok"}

    @app.post(
        "/v1/guidance",
        response_model=GuidanceResponse,
        response_model_exclude_none=True,
    )
    async def guidance(body: GuidanceRequest, request: Request) -> GuidanceResponse:
        # Walking skeleton: fixed card, no model, Agent Search or Places call.
        card = stub_guidance(body.root.language)
        request.state.outcome = card.kind
        return GuidanceResponse(root=card)

    return app
