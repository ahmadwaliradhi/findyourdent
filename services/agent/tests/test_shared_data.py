from __future__ import annotations

from findyourdent_agent.data import load_procedures, load_regions, procedure_codes


def test_shared_procedure_list_loads() -> None:
    procedures = load_procedures().procedures

    assert procedures
    assert len(procedure_codes()) == len(procedures)


def test_kemendagri_region_list_loads() -> None:
    regions = load_regions()

    assert len(regions.provinces) == 38
    province_codes = {str(p.code) for p in regions.provinces}
    assert all(str(r.provinceCode) in province_codes for r in regions.regencies)
