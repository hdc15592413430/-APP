import json
import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field

from app.models import AdmissionRecord, UserProfile


DEFAULT_DATA_FILE = Path(__file__).resolve().parent / "data" / "admissions.demo.json"


class DataCatalog(BaseModel):
    source_name: str = "内置演示数据"
    source_type: str = "demo"
    updated_at: str | None = None
    notes: str | None = None
    records: list[AdmissionRecord] = Field(default_factory=list)


def get_catalog_path() -> Path:
    configured = os.getenv("ADMISSIONS_DATA_FILE", "").strip()
    return Path(configured) if configured else DEFAULT_DATA_FILE


@lru_cache(maxsize=1)
def load_catalog() -> DataCatalog:
    path = get_catalog_path()
    payload = json.loads(path.read_text(encoding="utf-8"))
    return DataCatalog.model_validate(payload)


def refresh_catalog() -> DataCatalog:
    load_catalog.cache_clear()
    return load_catalog()


def list_relevant_records(profile: UserProfile) -> tuple[DataCatalog, list[AdmissionRecord]]:
    catalog = load_catalog()
    matched = [
        record
        for record in catalog.records
        if _matches_province(profile.province, record.provinces)
        and _matches_track(profile.subject_track, record.subject_tracks)
    ]
    return catalog, matched


def _matches_province(user_province: str, record_provinces: list[str]) -> bool:
    if not record_provinces:
        return True
    return user_province in record_provinces or "全国演示" in record_provinces


def _matches_track(user_track: str, record_tracks: list[str]) -> bool:
    if not record_tracks:
        return True
    return user_track in record_tracks or "不限" in record_tracks

