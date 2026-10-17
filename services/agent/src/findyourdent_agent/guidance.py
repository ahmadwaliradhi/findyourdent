"""One Patient turn of the Guidance flow (spec 01).

Order of checks:

1. Emergency Escalation, deterministic layer: no model call.
2. Prompt-injection phrases: the fixed polite redirect, no model call.
3. One Gemini call. Its output is validated; off-topic gets the redirect; the model can
   raise urgency (to the emergency kind) but never lower it below a deterministic red
   flag; a follow-up question is asked at most once; text that names a medicine, gives
   a dose, discourages a dentist or quotes the Patient is replaced with the safe
   fallback.
4. The Cost Estimate, BPJS answer, sources and disclaimer come from the knowledge files.

Complaint text stays in memory for the length of the request. Nothing here logs it.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache

from pydantic import ValidationError

from .adapters import GeminiAdapter, ModelUnavailableError
from .agents.guidance import (
    ModelTurn,
    UrgencyTier,
    guidance_contents,
    guidance_instruction,
    model_response_schema,
)
from .config import Settings
from .contracts.guidance_request import GuidanceRequest1, GuidanceRequest2
from .contracts.guidance_response import (
    EmergencyResponse,
    FollowUpResponse,
    Guidance,
    GuidanceCardResponse,
    HospitalSearch,
    Journey,
    LikelyCategory,
    Visit,
)
from .data import load_procedures, procedure_codes
from .escalation import RedFlag, RedFlagMatcher
from .knowledge import (
    Language,
    bpjs_answer,
    cost_estimate,
    guidance_safety,
    is_injection,
    is_unsafe_output,
    quotes,
    sources,
)

Response = EmergencyResponse | FollowUpResponse | GuidanceCardResponse
GuidanceTurn = GuidanceRequest1 | GuidanceRequest2

_URGENCY_ORDER: dict[UrgencyTier, int] = {"rutin": 0, "terjadwal": 1, "segera": 2, "darurat": 3}
# A red flag without an escalation rule (swelling alone, fever alone) still means a
# dentist within days: the model cannot answer "terjadwal" or "rutin" for it.
_RED_FLAG_FLOOR: UrgencyTier = "segera"


class InvalidModelOutputError(ModelUnavailableError):
    """Gemini returned JSON that does not match the ModelTurn schema."""


class AudioNotSupportedError(Exception):
    """Voice notes land with T07; this ticket handles typed complaints."""


@dataclass(frozen=True, slots=True)
class Outcome:
    response: Response
    outcome: str
    """Logged instead of any content: emergency, emergency_model, followUp, redirect,
    guidance or guidance_fallback."""


@cache
def _diagnostic_codes() -> frozenset[str]:
    return frozenset(
        str(p.code) for p in load_procedures().procedures if p.category == "diagnostic"
    )


def _redirect(language: Language) -> FollowUpResponse:
    return FollowUpResponse(kind="followUp", question=guidance_safety().redirect(language))


def _emergency(reason: str, red_flags: set[RedFlag]) -> EmergencyResponse:
    return EmergencyResponse(
        kind="emergency",
        reason=reason,
        redFlags=sorted(red_flags),
        hospitalSearch=HospitalSearch(providerType="hospital", requiresEmergencyDepartment=True),
    )


def _model_texts(turn: ModelTurn) -> list[str]:
    texts = [*turn.whyPricesVary]
    if turn.likelyCategory:
        texts.append(turn.likelyCategory.explanation)
    if turn.journey:
        texts += [v.purpose for v in turn.journey.visits]
    if turn.followUp:
        texts += [turn.followUp.question, *turn.followUp.quickReplies]
    if turn.emergencyReason:
        texts.append(turn.emergencyReason)
    return texts


def _procedures(turn: ModelTurn) -> list[str]:
    known = procedure_codes()
    codes = [c for c in dict.fromkeys(turn.likelyProcedures) if c in known]
    return codes or ["consultation"]


def _card(
    turn: ModelTurn,
    urgency: UrgencyTier,
    *,
    safe: bool,
) -> GuidanceCardResponse:
    language: Language = turn.language
    procedures = _procedures(turn)
    bpjs, source_keys = bpjs_answer(procedures, _diagnostic_codes(), language)
    if turn.likelyCategory is None or turn.journey is None:  # ModelTurn rules this out
        raise InvalidModelOutputError("likelyCategory or journey missing")
    if safe:
        category, journey, why = turn.likelyCategory, turn.journey, turn.whyPricesVary
    else:
        fallback = guidance_safety().fallback[language]
        category = LikelyCategory(code=turn.likelyCategory.code, explanation=fallback.explanation)
        journey = Journey(type="single", visits=[Visit(order=1, purpose=fallback.visit)])
        why = fallback.whyPricesVary
    guidance = Guidance(
        urgencyTier=urgency,
        likelyCategory=category,
        journey=journey,
        likelyProcedures=procedures,
        whyPricesVary=why,
        costEstimate=cost_estimate(procedures, language)
        or cost_estimate(["consultation"], language),
        bpjs=bpjs,
        sources=sources(source_keys),
        disclaimer=guidance_safety().disclaimer(language),
    )
    return GuidanceCardResponse(kind="guidance", guidance=guidance)


async def answer_turn(
    turn: GuidanceTurn,
    *,
    gemini: GeminiAdapter,
    red_flags: RedFlagMatcher,
    settings: Settings,
) -> Outcome:
    texts = (turn.complaintText, turn.followUpAnswer)
    emergency = red_flags.check(*texts, language=turn.language)
    if emergency:
        return Outcome(emergency, "emergency")
    if turn.complaintText is None:
        raise AudioNotSupportedError
    if any(is_injection(t) for t in texts if t):
        return Outcome(_redirect(turn.language), "redirect")

    raw = await gemini.generate_structured(
        model=settings.guidance_model,
        instruction=guidance_instruction(),
        contents=guidance_contents(turn.complaintText, turn.followUpAnswer),
        response_schema=model_response_schema(),
    )
    try:
        model = ModelTurn.model_validate(raw)
    except ValidationError as error:
        # Never chain the error: its message can quote model text.
        raise InvalidModelOutputError(f"{error.error_count()} validation errors") from None

    if model.offTopic:
        return Outcome(_redirect(model.language), "redirect")

    patient_texts = [t for t in texts if t]
    safe = not any(
        is_unsafe_output(t) or any(quotes(t, said) for said in patient_texts)
        for t in _model_texts(model)
    )
    deterministic = red_flags.flags(*texts)
    if model.urgencyTier == "darurat" and (deterministic or model.redFlags):
        reason = model.emergencyReason if safe and model.emergencyReason else None
        reason = reason or guidance_safety().emergencyReason(model.language)
        return Outcome(_emergency(reason, deterministic | set(model.redFlags)), "emergency_model")

    if model.followUp and not turn.followUpAnswer and safe:
        follow_up = FollowUpResponse(
            kind="followUp",
            question=model.followUp.question,
            quickReplies=model.followUp.quickReplies or None,
        )
        return Outcome(follow_up, "followUp")

    if model.urgencyTier is None:  # ModelTurn rules this out unless off-topic
        raise InvalidModelOutputError("urgencyTier missing")
    urgency = min(model.urgencyTier, "segera", key=_URGENCY_ORDER.__getitem__)
    if deterministic or model.redFlags:
        urgency = max(urgency, _RED_FLAG_FLOOR, key=_URGENCY_ORDER.__getitem__)
    card = _card(model, urgency, safe=safe)
    return Outcome(card, "guidance" if safe else "guidance_fallback")
