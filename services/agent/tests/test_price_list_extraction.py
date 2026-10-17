"""Price List extraction contract (spec 05 Testing Decisions).

Driven through the HTTP API only, with Gemini replaced by a fake at its adapter.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker

from findyourdent_agent.adapters import Adapters, ModelQuotaExhaustedError
from findyourdent_agent.adapters.fakes import (
    FakeAgentSearchAdapter,
    FakeGeminiAdapter,
    FakePlacesAdapter,
)
from findyourdent_agent.app import create_app
from findyourdent_agent.config import Settings
from findyourdent_agent.data import contracts_dir

PDF = {"mimeType": "application/pdf", "dataBase64": base64.b64encode(b"%PDF-1.7 list").decode()}


def response_validator() -> Draft202012Validator:
    path = contracts_dir() / "schemas" / "price-list-extraction-response.schema.json"
    schema = json.loads(path.read_text(encoding="utf-8"))
    return Draft202012Validator(schema, format_checker=FormatChecker())


def a_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "procedureCode": "tooth_filling",
        "procedureText": "Tambal gigi komposit",
        "minRupiah": 250_000,
        "maxRupiah": 450_000,
        "unit": "per_tooth",
        "notes": "Tergantung luas lubang",
        "confidence": 0.92,
    }
    row.update(overrides)
    return row


def extract(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/v1/price-list-extraction", json=body)
    assert response.status_code == 200
    result = response.json()
    assert [e.message for e in response_validator().iter_errors(result)] == []
    return result


def test_rows_read_from_a_pdf_are_returned(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append({"rows": [a_row()]})

    result = extract(client, {"pdf": PDF})

    assert result == {"kind": "ok", "rows": [a_row()]}


def test_uses_extraction_model_and_row_schema_with_documents_as_data(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append({"rows": [a_row()]})

    extract(client, {"pdf": PDF})

    (call,) = fake_gemini.calls
    assert call["model"] == "gemini-3.5-flash-lite"
    assert call["response_schema"]["required"] == ["rows"]
    row = call["response_schema"]["properties"]["rows"]["items"]
    assert row["required"] == ["procedureText", "minRupiah", "maxRupiah", "unit", "confidence"]
    assert call["max_output_tokens"]
    documents = [p.inline_data for p in call["contents"] if p.inline_data]
    assert [(d.mime_type, d.data) for d in documents] == [("application/pdf", b"%PDF-1.7 list")]
    assert "%PDF" not in call["instruction"]


def test_up_to_five_photos_are_read_in_order(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append({"rows": [a_row()]})
    photos = [
        {"mimeType": "image/jpeg", "dataBase64": base64.b64encode(f"page {i}".encode()).decode()}
        for i in range(5)
    ]

    extract(client, {"images": photos})

    (call,) = fake_gemini.calls
    documents = [p.inline_data.data for p in call["contents"] if p.inline_data]
    assert documents == [f"page {i}".encode() for i in range(5)]


def test_six_photos_are_refused(client: TestClient, fake_gemini: FakeGeminiAdapter) -> None:
    photo = {"mimeType": "image/png", "dataBase64": base64.b64encode(b"x").decode()}

    response = client.post("/v1/price-list-extraction", json={"images": [photo] * 6})

    assert response.status_code == 422
    assert fake_gemini.calls == []


def test_document_that_is_not_base64_is_refused(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    response = client.post(
        "/v1/price-list-extraction",
        json={"pdf": {"mimeType": "application/pdf", "dataBase64": "not base64!"}},
    )

    assert response.status_code == 422
    assert "not base64!" not in response.text
    assert fake_gemini.calls == []


def test_row_without_procedure_code_keeps_free_text(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    row = a_row(procedureText="Bleaching laser", minRupiah=1_500_000, maxRupiah=1_500_000)
    del row["procedureCode"], row["notes"]
    fake_gemini.outputs.append({"rows": [row]})

    result = extract(client, {"pdf": PDF})

    assert result["rows"] == [row]


def assert_retry(result: dict[str, Any]) -> None:
    assert result["kind"] == "failed"
    assert result["retryMessage"]
    assert "rows" not in result


@pytest.mark.parametrize(
    "output",
    [
        {"rows": [a_row(), a_row(minRupiah=500_000, maxRupiah=100_000)]},
        {"rows": [a_row(), a_row(procedureCode="made_up_code")]},
        {"rows": [a_row(), a_row(unit="per_hour")]},
        {"rows": [a_row(), a_row(confidence=1.5)]},
        {"rows": [a_row(), {"procedureText": "Scaling"}]},
        {"rows": [a_row()], "extra": True},
        {"rows": []},
    ],
    ids=[
        "min_above_max",
        "unknown_code",
        "unknown_unit",
        "confidence_out_of_range",
        "missing_price",
        "extra_field",
        "no_rows",
    ],
)
def test_invalid_extraction_returns_no_rows_and_a_retry_message(
    client: TestClient, fake_gemini: FakeGeminiAdapter, output: dict[str, Any]
) -> None:
    fake_gemini.outputs.append(output)

    assert_retry(extract(client, {"pdf": PDF}))


def test_model_error_returns_a_retry_message(
    client: TestClient, fake_gemini: FakeGeminiAdapter
) -> None:
    fake_gemini.outputs.append(ModelQuotaExhaustedError("gemini 429"))

    assert_retry(extract(client, {"pdf": PDF}))


class HangingGemini(FakeGeminiAdapter):
    async def generate_structured(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        await asyncio.sleep(60)
        raise AssertionError("timeout should have fired")


def test_model_timeout_returns_a_retry_message() -> None:
    adapters = Adapters(
        gemini=HangingGemini(), agent_search=FakeAgentSearchAdapter(), places=FakePlacesAdapter()
    )
    with TestClient(create_app(adapters, Settings(extraction_timeout_seconds=0.01))) as client:
        assert_retry(extract(client, {"pdf": PDF}))


def test_rows_and_documents_are_never_logged(
    client: TestClient, fake_gemini: FakeGeminiAdapter, caplog: pytest.LogCaptureFixture
) -> None:
    fake_gemini.outputs.append({"rows": [a_row()]})

    with caplog.at_level(logging.DEBUG):
        extract(client, {"pdf": PDF})

    logged = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)
    assert "Tambal gigi" not in logged
    assert PDF["dataBase64"] not in logged
    assert any(getattr(r, "outcome", None) == "ok" for r in caplog.records)
