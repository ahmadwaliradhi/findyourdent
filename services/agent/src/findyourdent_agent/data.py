"""Shared reference data from packages/contracts/data (procedures and Kemendagri regions).

The contracts directory is found relative to the repository, or set with the
``CONTRACTS_DIR`` environment variable (the Docker image copies the contracts in).
Each file is validated against its generated contract model when loaded.
"""

from __future__ import annotations

import os
from functools import cache
from pathlib import Path

from .contracts.procedures import ProcedureList
from .contracts.regions import RegionList

_REPO_CONTRACTS = Path(__file__).resolve().parents[4] / "packages" / "contracts"


def contracts_dir() -> Path:
    override = os.environ.get("CONTRACTS_DIR")
    return Path(override) if override else _REPO_CONTRACTS


def _data_file(name: str) -> Path:
    return contracts_dir() / "data" / name


@cache
def load_procedures() -> ProcedureList:
    """Shared procedure list used by Guidance, Testimonies and Price Lists."""
    return ProcedureList.model_validate_json(_data_file("procedures.json").read_bytes())


@cache
def load_regions() -> RegionList:
    """Kemendagri region code list (provinces and kota/kabupaten)."""
    return RegionList.model_validate_json(_data_file("regions.json").read_bytes())


def procedure_codes() -> frozenset[str]:
    return frozenset(str(p.code) for p in load_procedures().procedures)
