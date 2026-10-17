"""Service configuration, read from environment variables.

Model names live in configuration so they can change without code changes (spec 00).
Gemini is called on the global endpoint (ADR-0003).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Settings:
    guidance_model: str = "gemini-3.8-flash"
    shortlist_model: str = "gemini-3.8-flash"
    moderation_model: str = "gemini-3.5-flash-lite"
    extraction_model: str = "gemini-3.5-flash-lite"
    moderation_timeout_seconds: float = 20.0
    # Below this, a Testimony with no rule hit is held instead of published (ADR-0004).
    moderation_publish_confidence: float = 0.8
    google_cloud_project: str | None = None
    # ADR-0003: Gemini runs on the global endpoint; stored data stays in asia-southeast2.
    google_cloud_location: str = "global"
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> Settings:
        defaults = cls()
        return cls(
            guidance_model=os.environ.get("GUIDANCE_MODEL", defaults.guidance_model),
            shortlist_model=os.environ.get("SHORTLIST_MODEL", defaults.shortlist_model),
            moderation_model=os.environ.get("MODERATION_MODEL", defaults.moderation_model),
            extraction_model=os.environ.get("EXTRACTION_MODEL", defaults.extraction_model),
            moderation_timeout_seconds=float(
                os.environ.get("MODERATION_TIMEOUT_SECONDS", defaults.moderation_timeout_seconds)
            ),
            moderation_publish_confidence=float(
                os.environ.get(
                    "MODERATION_PUBLISH_CONFIDENCE", defaults.moderation_publish_confidence
                )
            ),
            google_cloud_project=os.environ.get("GOOGLE_CLOUD_PROJECT") or None,
            google_cloud_location=os.environ.get(
                "GOOGLE_CLOUD_LOCATION", defaults.google_cloud_location
            ),
            log_level=os.environ.get("LOG_LEVEL", defaults.log_level).upper(),
        )
