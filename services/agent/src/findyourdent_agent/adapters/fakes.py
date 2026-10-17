"""In-memory fakes for the adapter ports. They record calls so tests can assert on them."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from . import GroundingDoc


@dataclass
class FakeGeminiAdapter:
    """Returns queued outputs in order, raising any queued exception; ``calls`` records
    each request."""

    outputs: list[dict[str, Any] | Exception] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
        temperature: float,
        max_output_tokens: int | None = None,
        thinking_level: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "model": model,
                "instruction": instruction,
                "contents": contents,
                "response_schema": response_schema,
                "temperature": temperature,
                "max_output_tokens": max_output_tokens,
                "thinking_level": thinking_level,
            }
        )
        if not self.outputs:
            raise AssertionError("FakeGeminiAdapter called with no queued output")
        output = self.outputs.pop(0)
        if isinstance(output, Exception):
            raise output
        return output


@dataclass
class FakeAgentSearchAdapter:
    """Returns ``results`` on every search, or raises ``error`` when set; ``calls``
    records each request. Empty by default, so Guidance uses the curated sources."""

    results: list[GroundingDoc] = field(default_factory=list)
    error: Exception | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def search(self, query: str, *, max_results: int = 5) -> list[GroundingDoc]:
        self.calls.append({"query": query, "max_results": max_results})
        if self.error:
            raise self.error
        return self.results[:max_results]


@dataclass
class FakePlacesAdapter:
    places: list[dict[str, Any]] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def nearby(
        self,
        *,
        latitude: float,
        longitude: float,
        provider_type: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        self.calls.append(
            {
                "latitude": latitude,
                "longitude": longitude,
                "provider_type": provider_type,
                "max_results": max_results,
            }
        )
        return self.places[:max_results]


def guidance_model_output(**overrides: Any) -> dict[str, Any]:
    """A valid Gemini Guidance output for a deep-caries complaint, in Indonesian."""
    output: dict[str, Any] = {
        "language": "id",
        "offTopic": False,
        "redFlags": [],
        "emergencyReason": None,
        "urgencyTier": "segera",
        "followUp": None,
        "likelyCategory": {
            "code": "deep_caries_or_pulpitis",
            "explanation": (
                "Ngilu saat minum dingin dan nyeri berdenyut bisa jadi tanda lubang gigi yang "
                "dalam atau peradangan saraf gigi. Dokter gigi perlu memeriksa untuk memastikan."
            ),
        },
        "journey": {
            "type": "multi",
            "visits": [
                {"order": 1, "purpose": "Pemeriksaan dan rontgen gigi."},
                {"order": 2, "purpose": "Penambalan atau perawatan saluran akar."},
            ],
        },
        "likelyProcedures": ["dental_xray_periapical", "tooth_filling", "root_canal_treatment"],
        "whyPricesVary": [
            "Bahan tambalan berbeda harganya.",
            "Gigi geraham punya lebih banyak saluran akar.",
        ],
    }
    return output | overrides


def shortlist_model_output(reasons: dict[str, str]) -> dict[str, Any]:
    """A Gemini Shortlist reasons output: one reason per placeId, in the dict's order."""
    return {"reasons": [{"placeId": p, "reason": r} for p, r in reasons.items()]}


def _canned_reasons(contents: list[Any]) -> dict[str, Any]:
    """One stock reason for every Provider in the tagged data block (agents/shortlist.py)."""
    from ..agents.shortlist import SHORTLIST_TAG

    text = "".join(part.text or "" for content in contents for part in content.parts)
    data = json.loads(text.split(f"<{SHORTLIST_TAG}>", 1)[1].split(f"</{SHORTLIST_TAG}>", 1)[0])
    reason = {
        "id": "Dekat dari lokasi Anda dan dapat menangani keluhan ini.",
        "en": "Close to you and able to handle this problem.",
    }[data["language"]]
    return shortlist_model_output({p["placeId"]: reason for p in data["providers"]})


_CANNED_TRANSCRIPT = "Transkrip contoh: suara tidak dikirim ke Gemini saat GEMINI_ADAPTER=fake."


@dataclass(frozen=True, slots=True)
class CannedGeminiAdapter:
    """Local development without Google Cloud credentials (GEMINI_ADAPTER=fake):
    every complaint gets the same deep-caries Guidance (a voice note with a stock
    transcript), and every Shortlist Provider the same stock reason. The output schema
    tells the two calls apart, since both can use the same model."""

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
        temperature: float,
        max_output_tokens: int | None = None,
        thinking_level: str | None = None,
    ) -> dict[str, Any]:
        if "reasons" in response_schema.get("properties", {}):
            return _canned_reasons(contents)
        voice = any(part.inline_data for content in contents for part in content.parts)
        return guidance_model_output(transcript=_CANNED_TRANSCRIPT if voice else None)
