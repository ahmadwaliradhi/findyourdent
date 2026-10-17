from __future__ import annotations

import json
import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from findyourdent_agent.adapters.fakes import (
    FakeAgentSearchAdapter,
    FakeGeminiAdapter,
    FakePlacesAdapter,
)
from findyourdent_agent.contracts.guidance_response import (
    GuidanceCardResponse,
    GuidanceResponse,
)
from findyourdent_agent.data import contracts_dir, procedure_codes

COMPLAINT_ID = (
    "Gigi geraham kiri bawah nyut-nyutan sejak tiga hari, makin sakit kalau minum dingin."
)


def load_schema(name: str) -> dict[str, Any]:
    return json.loads((contracts_dir() / "schemas" / name).read_text(encoding="utf-8"))


def response_validator() -> Draft202012Validator:
    schema = load_schema("guidance-response.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


@pytest.mark.parametrize("language", ["id", "en"])
def test_complaint_returns_guidance_card_matching_the_contract(
    client: TestClient,
    fake_gemini: FakeGeminiAdapter,
    fake_agent_search: FakeAgentSearchAdapter,
    fake_places: FakePlacesAdapter,
    language: str,
) -> None:
    response = client.post(
        "/v1/guidance",
        json={"sessionId": "sess-0001-abcd", "language": language, "complaintText": COMPLAINT_ID},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "guidance"

    errors = sorted(response_validator().iter_errors(body), key=lambda e: list(e.path))
    assert errors == [], [e.message for e in errors]

    parsed = GuidanceResponse.model_validate(body)
    assert isinstance(parsed.root, GuidanceCardResponse)

    # Procedure codes come from the shared list in packages/contracts/data.
    known_codes = procedure_codes()
    guidance = body["guidance"]
    assert set(guidance["likelyProcedures"]) <= known_codes
    assert {c["procedureCode"] for c in guidance["costEstimate"]} <= known_codes

    # The stub never reaches a paid adapter.
    assert fake_gemini.calls == []
    assert fake_agent_search.calls == []
    assert fake_places.calls == []


def test_card_language_follows_request_language(client: TestClient) -> None:
    def disclaimer(language: str) -> str:
        body = client.post(
            "/v1/guidance",
            json={"sessionId": "sess-0001-abcd", "language": language, "complaintText": "sakit"},
        ).json()
        return body["guidance"]["disclaimer"]

    assert disclaimer("id") != disclaimer("en")
    assert "bukan diagnosis" in disclaimer("id")
    assert "not a diagnosis" in disclaimer("en")


@pytest.mark.parametrize(
    "body",
    [
        {"language": "id", "complaintText": "sakit gigi"},  # no sessionId
        {"sessionId": "sess-0001-abcd", "language": "fr", "complaintText": "x"},  # bad language
        {"sessionId": "sess-0001-abcd", "language": "id"},  # neither complaintText nor audio
        {"sessionId": "sess-0001-abcd", "language": "id", "complaintText": "x", "extra": 1},
    ],
)
def test_invalid_request_returns_422(client: TestClient, body: dict[str, object]) -> None:
    response = client.post("/v1/guidance", json=body)

    assert response.status_code == 422


def test_complaint_text_never_reaches_logs(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    complaint = "RAHASIA-KELUHAN-bengkak-pipi-kanan"
    with caplog.at_level(logging.DEBUG):
        ok = client.post(
            "/v1/guidance",
            json={"sessionId": "sess-0001-abcd", "language": "id", "complaintText": complaint},
        )
        bad = client.post(
            "/v1/guidance",
            json={"sessionId": "x", "language": "id", "complaintText": complaint},
        )

    assert ok.status_code == 200
    assert bad.status_code == 422
    assert complaint not in bad.text
    assert all(complaint not in record.getMessage() for record in caplog.records)
    assert all(complaint not in str(record.__dict__) for record in caplog.records)


def test_health(client: TestClient) -> None:
    # Not /healthz: Cloud Run reserves some paths ending in "z".
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
