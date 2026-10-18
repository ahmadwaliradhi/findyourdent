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
        max_output_tokens: int | None = None,
        thinking_level: str | None = None,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        """The parsed JSON object Gemini returned. ``contents`` holds google-genai parts
        or contents. Output tokens are always bounded: ``max_output_tokens`` defaults to
        the adapter's cap. ``timeout_seconds`` is the whole call's budget, retries
        included; it defaults to the adapter's. Raises ModelUnavailableError."""
        ...


class AgentSearchUnavailableError(Exception):
    """The Agent Search data store could not answer (network, auth, server error, a
    response that does not parse). Guidance falls back to the curated knowledge files."""


@dataclass(frozen=True, slots=True)
class GroundingDoc:
    """One retrieved source document and the excerpt that matched the complaint."""

    title: str
    snippet: str
    url: str | None = None
    publisher: str | None = None


@runtime_checkable
class AgentSearchAdapter(Protocol):
    """Grounding search over the Agent Search (formerly Vertex AI Search) data store."""

    async def search(self, query: str, *, max_results: int = 5) -> list[GroundingDoc]:
        """One entry per source document, best match first, at most ``max_results``.
        Raises AgentSearchUnavailableError."""
        ...


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
    "AgentSearchUnavailableError",
    "GeminiAdapter",
    "GroundingDoc",
    "ModelQuotaExhaustedError",
    "ModelUnavailableError",
    "PlacesAdapter",
]
