"""One Patient turn of the Guidance flow (spec 01).

Order of checks:

1. Emergency Escalation, deterministic layer: no model call.
2. Prompt-injection phrases: the fixed polite redirect, no model call.
3. One Agent Search query with the complaint alone; the documents it returns reach
   Gemini as reference excerpts and head the card's sources. If the data store fails
   or finds nothing, the curated knowledge files ground the card on their own.
4. One Gemini call. Its output is validated; off-topic gets the redirect; the model can
   raise urgency (to the emergency kind) but never lower it below a deterministic red
   flag; a follow-up question is asked at most once; text that names a medicine, gives
   a dose, discourages a dentist or quotes the Patient is replaced with the safe
   fallback.
5. The Cost Estimate, BPJS answer, sources and disclaimer come from the knowledge files.

Complaint text stays in memory for the length of the request. Nothing here logs it.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
from dataclasses import dataclass
from functools import cache

from pydantic import ValidationError

from .adapters import AgentSearchAdapter, GeminiAdapter, GroundingDoc, ModelUnavailableError
from .agents.guidance import (
    ModelTurn,
    UrgencyTier,
    VoiceNote,
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
    Source,
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

log = logging.getLogger("findyourdent_agent")

Response = EmergencyResponse | FollowUpResponse | GuidanceCardResponse
GuidanceTurn = GuidanceRequest1 | GuidanceRequest2

_URGENCY_ORDER: dict[UrgencyTier, int] = {"rutin": 0, "terjadwal": 1, "segera": 2, "darurat": 3}
# A red flag without an escalation rule (swelling alone, fever alone) still means a
# dentist within days: the model cannot answer "terjadwal" or "rutin" for it.
_RED_FLAG_FLOOR: UrgencyTier = "segera"


class InvalidModelOutputError(ModelUnavailableError):
    """Gemini returned JSON that does not match the ModelTurn schema."""


class InvalidAudioError(ValueError):
    """The voice note is not valid base64."""


class NoSpeechError(Exception):
    """Gemini heard no speech in the voice note: the Patient is asked to record again."""


@dataclass(frozen=True, slots=True)
class Outcome:
    response: Response
    outcome: str
    """Logged instead of any content: emergency, emergency_model, followUp, redirect,
    guidance or guidance_fallback."""
    grounding: str | None = None
    """Logged with the outcome when Gemini was called: agent_search or curated."""


def _voice_note(turn: GuidanceTurn) -> VoiceNote | None:
    if turn.audio is None or turn.complaintText is not None:
        return None
    try:
        data = base64.b64decode(turn.audio.dataBase64, validate=True)
    except binascii.Error:
        raise InvalidAudioError from None
    return VoiceNote(data=data, mime_type=turn.audio.mimeType)


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


async def _retrieve(
    agent_search: AgentSearchAdapter, complaint: str, settings: Settings
) -> list[GroundingDoc]:
    """Reference documents for the complaint alone, so the follow-up turn retrieves the
    same ones and keeps the cached prefix. A failing data store never fails Guidance."""
    try:
        return await agent_search.search(complaint, max_results=settings.agent_search_max_results)
    except Exception as error:  # any adapter failure falls back
        # The class name only: the message could echo the query.
        log.warning("agent search unavailable, using curated knowledge: %s", type(error).__name__)
        return []


# "KMK HK.01.07/MENKES/1492/2023", "Permenkes 3/2023", "Perpres No. 59 Tahun 2024".
_REGULATION = re.compile(r"\b(kmk|permenkes|perpres)\b.*?(\d+)(?:/|\s+tahun\s+)(\d{4})\b")


def _regulation(source: Source) -> tuple[str, ...] | None:
    """The regulation a source is, from its citation or title: the data store and the
    curated file name the same regulation with different titles and links."""
    for text in (source.citation, source.title):
        if text and (match := _REGULATION.search(text.lower())):
            return match.groups()
    return None


def _same_source(a: Source, b: Source) -> bool:
    if a.url and b.url and str(a.url).rstrip("/") == str(b.url).rstrip("/"):
        return True
    if (regulation := _regulation(a)) and regulation == _regulation(b):
        return True
    return " ".join(a.title.lower().split()) == " ".join(b.title.lower().split())


def _sources(retrieved: list[GroundingDoc], curated_keys: list[str]) -> list[Source]:
    """The retrieved documents first, then the curated citations they do not already
    cover, so the BPJS answer keeps its sources."""
    cited = [Source(title=d.title, citation=d.publisher, url=d.url) for d in retrieved]
    curated = [s for s in sources(curated_keys) if not any(_same_source(s, c) for c in cited)]
    return cited + curated


def _card(
    turn: ModelTurn,
    urgency: UrgencyTier,
    *,
    safe: bool,
    retrieved: list[GroundingDoc],
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
        sources=_sources(retrieved, source_keys),
        disclaimer=guidance_safety().disclaimer(language),
    )
    return GuidanceCardResponse(kind="guidance", guidance=guidance)


def _with_transcript(response: Response, transcript: str | None) -> Response:
    return response.model_copy(update={"transcript": transcript}) if transcript else response


async def answer_turn(
    turn: GuidanceTurn,
    *,
    gemini: GeminiAdapter,
    agent_search: AgentSearchAdapter,
    red_flags: RedFlagMatcher,
    settings: Settings,
) -> Outcome:
    """One turn. A voice note is heard by Gemini in the Guidance call itself, so its
    Emergency Escalation and injection checks run on the transcript Gemini returns;
    the transcript goes back with whatever the Patient receives."""
    voice = _voice_note(turn)
    texts = (turn.complaintText, turn.followUpAnswer)
    emergency = red_flags.check(*texts, language=turn.language)
    if emergency:
        return Outcome(emergency, "emergency")
    # The question is model text echoed back by the browser, so it is checked for
    # injection like Patient text, but not for red flags it may only ask about.
    if any(is_injection(t) for t in (*texts, turn.followUpQuestion) if t):
        return Outcome(_redirect(turn.language), "redirect")

    # A voice note has no text to search with before Gemini hears it, so the curated
    # knowledge files ground it; a corrected transcript sent back as text is searched.
    complaint = voice or turn.complaintText
    if complaint is None:  # GuidanceRequest rules this out
        raise TypeError("a Guidance turn needs complaintText or audio")
    retrieved = [] if voice else await _retrieve(agent_search, complaint, settings)
    grounding = "agent_search" if retrieved else "curated"
    raw = await gemini.generate_structured(
        model=settings.guidance_model,
        instruction=guidance_instruction(),
        contents=guidance_contents(
            complaint, turn.followUpAnswer, turn.followUpQuestion, retrieved
        ),
        response_schema=model_response_schema(),
        temperature=settings.guidance_temperature,
        max_output_tokens=settings.guidance_max_output_tokens,
        thinking_level=settings.guidance_thinking_level,
    )
    try:
        model = ModelTurn.model_validate(raw)
    except ValidationError as error:
        # Never chain the error: its message can quote model text.
        raise InvalidModelOutputError(f"{error.error_count()} validation errors") from None

    transcript = None
    if voice:
        transcript = (model.transcript or "").strip()
        if not transcript:
            # The model's own red flags still escalate a voice note it could not make out.
            if model.urgencyTier == "darurat" and model.redFlags:
                result = _judge(turn, model, (), red_flags=red_flags, retrieved=[])
                return Outcome(result.response, result.outcome, grounding)
            raise NoSpeechError
        texts = (transcript, turn.followUpAnswer)  # what the Patient said, as if typed
        heard = red_flags.check(*texts, language=model.language)
        if heard:
            return Outcome(_with_transcript(heard, transcript), "emergency")
        if is_injection(transcript):
            return Outcome(
                _with_transcript(_redirect(model.language), transcript), "redirect", grounding
            )
    result = _judge(turn, model, texts, red_flags=red_flags, retrieved=retrieved)
    return Outcome(_with_transcript(result.response, transcript), result.outcome, grounding)


def _judge(
    turn: GuidanceTurn,
    model: ModelTurn,
    texts: tuple[str | None, ...],
    *,
    red_flags: RedFlagMatcher,
    retrieved: list[GroundingDoc],
) -> Outcome:
    """The Patient's response from a validated model turn: ``texts`` are what the
    Patient typed or said."""
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
    card = _card(model, urgency, safe=safe, retrieved=retrieved)
    return Outcome(card, "guidance" if safe else "guidance_fallback")
