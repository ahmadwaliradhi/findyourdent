"""Ports to the paid outside world. Tests replace each with a fake (spec 01 seam)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


class ModelUnavailableError(Exception):
    """Gemini could not answer (network, server error, safety block)."""


class ModelQuotaExhaustedError(ModelUnavailableError):
    """Gemini returned RESOURCE_EXHAUSTED / HTTP 429: the daily token cap is reached."""


@runtime_checkable
class GeminiAdapter(Protocol):
    """Structured-output call to a Gemini model on the global endpoint (ADR-0003)."""

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
    ) -> dict[str, Any]:
        """The parsed JSON object Gemini returned. ``contents`` holds
        ``{"role": ..., "text": ...}`` turns. Raises ModelUnavailableError."""
        ...


@runtime_checkable
class AgentSearchAdapter(Protocol):
    """Grounding search over the Agent Search (formerly Vertex AI Search) data store."""

    async def search(self, query: str, *, max_results: int = 5) -> list[dict[str, Any]]: ...


@runtime_checkable
class PlacesAdapter(Protocol):
    """Google Places lookups (spec 02). Only place_id and coordinates may be kept."""

    async def nearby(
        self,
        *,
        latitude: float,
        longitude: float,
        provider_type: str,
        max_results: int = 5,
    ) -> list[dict[str, Any]]: ...


@dataclass(frozen=True, slots=True)
class Adapters:
    gemini: GeminiAdapter
    agent_search: AgentSearchAdapter
    places: PlacesAdapter


__all__ = [
    "Adapters",
    "AgentSearchAdapter",
    "GeminiAdapter",
    "ModelQuotaExhaustedError",
    "ModelUnavailableError",
    "PlacesAdapter",
]
