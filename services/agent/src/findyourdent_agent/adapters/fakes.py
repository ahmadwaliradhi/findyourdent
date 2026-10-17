"""In-memory fakes for the adapter ports. They record calls so tests can assert on them."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


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
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "model": model,
                "instruction": instruction,
                "contents": contents,
                "response_schema": response_schema,
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
    results: list[dict[str, Any]] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def search(self, query: str, *, max_results: int = 5) -> list[dict[str, Any]]:
        self.calls.append({"query": query, "max_results": max_results})
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


@dataclass(frozen=True, slots=True)
class CannedGeminiAdapter:
    """Local development without Google Cloud credentials (GEMINI_ADAPTER=fake):
    every complaint gets the same deep-caries Guidance."""

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
    ) -> dict[str, Any]:
        return guidance_model_output()
