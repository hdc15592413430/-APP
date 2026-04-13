import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_port(value: str | None, *, default: int) -> int:
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_env: str
    api_host: str
    api_port: int
    public_base_url: str
    cors_allow_origins: list[str]
    cors_allow_credentials: bool

    @property
    def effective_cors_allow_credentials(self) -> bool:
        if self.cors_allow_origins == ["*"]:
            return False
        return self.cors_allow_credentials


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    configured_origins = _parse_csv(os.getenv("CORS_ALLOW_ORIGINS"))
    return Settings(
        app_env=os.getenv("APP_ENV", "development").strip().lower() or "development",
        api_host=os.getenv("API_HOST", "0.0.0.0").strip() or "0.0.0.0",
        api_port=_parse_port(os.getenv("PORT") or os.getenv("API_PORT"), default=8000),
        public_base_url=os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/"),
        cors_allow_origins=configured_origins or ["*"],
        cors_allow_credentials=_parse_bool(
            os.getenv("CORS_ALLOW_CREDENTIALS"),
            default=False,
        ),
    )
