from __future__ import annotations

from .ai_gateway import AIGateway, ModelConfig

_gateway = AIGateway()
_env_models: list[ModelConfig] = []


def get_gateway() -> AIGateway:
    return _gateway


def seed_from_env() -> None:
    from ..config import get_settings

    settings = get_settings()
    models: list[ModelConfig] = []
    if settings.openrouter_api_key:
        models.append(
            ModelConfig(
                name="OpenRouter (env)",
                provider="openrouter",
                model_id=settings.default_ai_model
                if settings.default_ai_provider == "openrouter"
                else "openai/gpt-4o-mini",
                api_key=settings.openrouter_api_key,
                base_url=settings.openrouter_base_url,
                source="env",
            )
        )
    if settings.groq_api_key:
        models.append(
            ModelConfig(
                name="Groq (env)",
                provider="groq",
                model_id="llama-3.3-70b-versatile",
                api_key=settings.groq_api_key,
                base_url=settings.groq_base_url,
                source="env",
            )
        )
    if settings.nvidia_api_key:
        models.append(
            ModelConfig(
                name="NVIDIA (env)",
                provider="nvidia",
                model_id="meta/llama-3.1-70b-instruct",
                api_key=settings.nvidia_api_key,
                base_url=settings.nvidia_base_url,
                source="env",
            )
        )
    _env_models.clear()
    _env_models.extend(models)
    for model in models:
        _gateway.register(model)


def reseed_env_models() -> None:
    for model in _env_models:
        _gateway.register(model)
