"""In-memory fakes for the adapter ports. They record calls so tests can assert on them."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FakeGeminiAdapter:
    """Returns queued outputs in order; ``calls`` records each request."""

    outputs: list[dict[str, Any]] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def generate_structured(
        self,
        *,
        model: str,
        instruction: str,
        contents: list[Any],
        response_schema: dict[str, Any],
        temperature: float,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "model": model,
                "instruction": instruction,
                "contents": contents,
                "response_schema": response_schema,
                "temperature": temperature,
            }
        )
        if not self.outputs:
            raise AssertionError("FakeGeminiAdapter called with no queued output")
        return self.outputs.pop(0)


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
