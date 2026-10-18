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
from .contracts.moderation_decision import ModerationDecision
from .contracts.moderation_request import ModerationProofOfVisit, ModerationRequest
from .contracts.price_list_extraction_request import PriceListExtractionRequest
from .contracts.price_list_extraction_response import PriceListExtractionResponse
from .contracts.proof_check_request import ProofCheckRequest
from .contracts.proof_check_response import ProofCheckResponse
from .contracts.shortlist_reasons_request import ShortlistReasonsRequest
from .contracts.shortlist_reasons_response import ShortlistReasonsResponse
from .data import procedure_codes
from .escalation import default_matcher
from .guidance import InvalidAudioError, NoSpeechError, answer_turn
from .knowledge import bpjs_coverage, cost_estimates, guidance_safety
from .moderation import InvalidAttachmentError, extract_proof, moderate
from .price_list import InvalidDocumentError, extract_price_list
from .shortlist import write_reasons

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
            extra = {
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": status,
                "outcome": getattr(request.state, "outcome", "error"),
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            }
            # Guidance only: whether Agent Search or the curated files grounded it.
            if grounding := getattr(request.state, "grounding", None):
                extra["grounding"] = grounding
            # Moderation with a Proof of Visit: whether its facts were read (never the facts).
            if proof := getattr(request.state, "proof", None):
                extra["proof"] = proof
            log.info("request", extra=extra)

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
    async def guidance(body: GuidanceRequest, request: Request) -> Response:
        try:
            result = await answer_turn(
                body.root,
                gemini=adapters.gemini,
                agent_search=adapters.agent_search,
                red_flags=red_flags,
                settings=settings,
            )
        except InvalidAudioError:
            request.state.outcome = "invalid_request"
            detail = {
                "type": "invalid_base64",
                "loc": ["body", "audio"],
                "msg": "audio is not base64",
            }
            return JSONResponse(status_code=422, content={"detail": [detail]})
        except NoSpeechError:
            return _error(request, 422, "no_speech")
        except ModelQuotaExhaustedError:
            return _error(request, 503, "model_quota_exhausted")
        except ModelUnavailableError as error:
            log.error("gemini unavailable: %s", type(error).__name__)
            return _error(request, 503, "model_unavailable")
        request.state.outcome = result.outcome
        request.state.grounding = result.grounding
        return JSONResponse(
            GuidanceResponse(root=result.response).model_dump(mode="json", exclude_none=True)
        )

    @app.post(
        "/v1/moderation",
        response_model=ModerationDecision,
        response_model_exclude_none=True,
    )
    async def moderation(
        body: ModerationRequest, request: Request
    ) -> ModerationDecision | JSONResponse:
        try:
            result = await moderate(body, adapters.gemini, settings)
        except InvalidAttachmentError:
            request.state.outcome = "invalid_request"
            detail = {"type": "invalid_base64", "loc": ["body"], "msg": "attachment is not base64"}
            return JSONResponse(status_code=422, content={"detail": [detail]})
        request.state.outcome = result.outcome
        if result.proof_outcome:
            request.state.proof = result.proof_outcome
        return result.decision

    @app.post(
        "/v1/moderation/proof-check",
        response_model=ProofCheckResponse,
        response_model_exclude_none=True,
    )
    async def proof_check(
        body: ProofCheckRequest, request: Request
    ) -> ProofCheckResponse | JSONResponse:
        """Moderation in proof-only mode (spec 09): a Proof of Visit attached later is read
        on its own. No text or photos come in, so nothing else is screened, and there is no
        decision. When the model gives no usable answer the proof is not checked: 503."""
        try:
            checked = await extract_proof(
                ModerationProofOfVisit.model_validate(body.proofOfVisit.model_dump()),
                typed_provider_name=body.typedProviderName,
                google_display_name=body.googleDisplayName,
                gemini=adapters.gemini,
                settings=settings,
            )
        except InvalidAttachmentError:
            request.state.outcome = "invalid_request"
            detail = {"type": "invalid_base64", "loc": ["body"], "msg": "attachment is not base64"}
            return JSONResponse(status_code=422, content={"detail": [detail]})
        if checked.extraction is None:
            return _error(request, 503, checked.outcome)
        request.state.outcome = checked.outcome
        return ProofCheckResponse.model_validate(
            {"proofExtraction": checked.extraction.model_dump(exclude_none=True)}
        )

    @app.post(
        "/v1/price-list-extraction",
        response_model=PriceListExtractionResponse,
        response_model_exclude_none=True,
    )
    async def price_list_extraction(body: PriceListExtractionRequest, request: Request) -> Response:
        # The documents and the rows read from them are never logged.
        try:
            result = await extract_price_list(body, adapters.gemini, settings)
        except InvalidDocumentError:
            request.state.outcome = "invalid_request"
            detail = {"type": "invalid_base64", "loc": ["body"], "msg": "document is not base64"}
            return JSONResponse(status_code=422, content={"detail": [detail]})
        request.state.outcome = result.outcome
        return JSONResponse(result.response.model_dump(mode="json", exclude_none=True))

    @app.post("/v1/shortlist-reasons", response_model=ShortlistReasonsResponse)
    async def shortlist_reasons(body: ShortlistReasonsRequest, request: Request) -> Response:
        # Provider names and reasons are never logged; the web service shows its
        # templated reasons on any error.
        try:
            result = await write_reasons(body, gemini=adapters.gemini, settings=settings)
        except ModelQuotaExhaustedError:
            return _error(request, 503, "model_quota_exhausted")
        except ModelUnavailableError as error:
            log.error("gemini unavailable: %s", type(error).__name__)
            return _error(request, 503, "model_unavailable")
        request.state.outcome = "reasons"
        return JSONResponse(result.model_dump(mode="json"))

    return app
