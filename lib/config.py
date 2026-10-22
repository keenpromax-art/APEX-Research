import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    ai_provider: str
    openrouter_api_key: str | None
    openrouter_model: str
    groq_api_key: str | None
    groq_model: str
    cache_ttl_seconds: float
    yfinance_timeout_seconds: float
    ai_timeout_seconds: float
    ai_max_output_retries: int = 1


def load_settings() -> Settings:
    return Settings(
        ai_provider=os.getenv("AI_PROVIDER", "openrouter"),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
        openrouter_model=os.getenv("OPENROUTER_MODEL", "google/gemini-flash-1.5"),
        groq_api_key=os.getenv("GROQ_API_KEY"),
        groq_model=os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b"),
        cache_ttl_seconds=float(os.getenv("CACHE_TTL_SECONDS", "900")),
        yfinance_timeout_seconds=float(os.getenv("YFINANCE_TIMEOUT_SECONDS", "30")),
        ai_timeout_seconds=float(os.getenv("AI_TIMEOUT_SECONDS", "120")),
    )
