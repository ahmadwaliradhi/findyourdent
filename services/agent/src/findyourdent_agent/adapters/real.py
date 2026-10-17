"""Production adapters. Placeholders in the walking skeleton: the stub Guidance endpoint
never calls them. Each later ticket fills in one adapter behind the same port.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..config import Settings
from . import Adapters


@dataclass(frozen=True, slots=True)
class GoogleGeminiAdapter:
    """Gemini through google-genai on Vertex AI, global endpoint (ADR-0003)."""

    settings: Settings

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
    ) -> dict[str, Any]:
        raise NotImplementedError("Gemini Guidance call lands in a later ticket (spec 01)")


@dataclass(frozen=True, slots=True)
class VertexAgentSearchAdapter:
    settings: Settings

    async def search(self, query: str, *, max_results: int = 5) -> list[dict[str, Any]]:
        raise NotImplementedError("Agent Search grounding lands in a later ticket (spec 01)")


@dataclass(frozen=True, slots=True)
class GooglePlacesAdapter:
    settings: Settings

    async def nearby(
        self,
        *,
        latitude: float,
        longitude: float,
        provider_type: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError("Places lookups land in a later ticket (spec 02)")


def production_adapters(settings: Settings) -> Adapters:
    return Adapters(
        gemini=GoogleGeminiAdapter(settings),
        agent_search=VertexAgentSearchAdapter(settings),
        places=GooglePlacesAdapter(settings),
    )
