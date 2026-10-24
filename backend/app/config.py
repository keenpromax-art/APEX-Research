from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env", Path(".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "APEX Terminal"
    app_env: str = "development"
    database_url: str = "sqlite:///./apex.db"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me-in-production-please-32chars"
    cors_origins: str = "http://localhost:3000"

    # AI provider keys (optional, server-side only)
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    groq_api_key: str | None = None
    groq_base_url: str = "https://api.groq.com/openai/v1"
    nvidia_api_key: str | None = None
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"

    # Defaults
    default_ai_provider: str = "openrouter"
    default_ai_model: str = "openai/gpt-4o-mini"

    # Cache
    cache_ttl_seconds: int = 3600
    yfinance_timeout: float = 30.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


ENV_EXAMPLE = BASE_DIR / ".env.example"
