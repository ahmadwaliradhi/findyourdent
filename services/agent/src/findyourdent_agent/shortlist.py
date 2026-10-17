"""Shortlist reasons (spec 02): one Gemini call writes one reason per ranked Provider.

The web service owns the order and the membership of the Shortlist. The model's answer
must name exactly the request's placeIds, each once; every reason must fit the contract
and pass the same medicine, dose and discouragement check as Guidance text. Anything
else is an error, never a partial answer, and the web service falls back to its
templated reasons. The response is built in request order, so the model cannot reorder.

Provider names and reasons stay in memory for the length of the request. Nothing here
logs them.
"""

from __future__ import annotations

from pydantic import ValidationError

from .adapters import GeminiAdapter, ModelUnavailableError
from .agents.shortlist import (
    MODEL_OUTPUT_SCHEMA,
    ModelReasons,
    shortlist_contents,
    shortlist_instruction,
)
from .config import Settings
from .contracts.shortlist_reasons_request import ShortlistReasonsRequest
from .contracts.shortlist_reasons_response import ShortlistReason, ShortlistReasonsResponse
from .knowledge import is_unsafe_output

# The contract's limit; the instruction asks for 120 characters.
MAX_REASON_LENGTH = 200


class InvalidModelOutputError(ModelUnavailableError):
    """Gemini's reasons do not match the request's Providers or break a safety rule."""


async def write_reasons(
    request: ShortlistReasonsRequest, *, gemini: GeminiAdapter, settings: Settings
) -> ShortlistReasonsResponse:
    raw = await gemini.generate_structured(
        model=settings.shortlist_model,
        instruction=shortlist_instruction(),
        contents=shortlist_contents(request),
        response_schema=MODEL_OUTPUT_SCHEMA,
        temperature=settings.shortlist_temperature,
        max_output_tokens=settings.shortlist_max_output_tokens,
        thinking_level=settings.shortlist_thinking_level,
    )
    try:
        output = ModelReasons.model_validate(raw)
    except ValidationError as error:
        # Never chain the error: its message can quote model text.
        raise InvalidModelOutputError(f"{error.error_count()} validation errors") from None

    reasons = {r.placeId: r.reason.strip() for r in output.reasons}
    expected = [p.placeId for p in request.providers]
    if len(output.reasons) != len(expected) or set(reasons) != set(expected):
        raise InvalidModelOutputError("placeIds differ from the request")
    for reason in reasons.values():
        if not reason or len(reason) > MAX_REASON_LENGTH:
            raise InvalidModelOutputError("reason is empty or too long")
        if is_unsafe_output(reason):
            raise InvalidModelOutputError("reason breaks a safety rule")
    return ShortlistReasonsResponse(
        reasons=[ShortlistReason(placeId=p, reason=reasons[p]) for p in expected]
    )
