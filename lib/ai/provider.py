from __future__ import annotations

import time
from abc import ABC, abstractmethod

import httpx

from lib.exceptions import AITimeoutError, AIProviderError

_RETRY_DELAYS = (5.0, 15.0)


class AIProvider(ABC):
    """Minimal provider interface. Implementations: OpenRouter, Groq, Gemini."""

    @abstractmethod
    def generate(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        timeout: float = 120.0,
    ) -> str:
        ...


class _OpenAICompatibleProvider(AIProvider):
    """Shared logic for OpenAI-compatible chat-completions endpoints."""

    def __init__(self, api_key: str, model: str, base_url: str):
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")

    def generate(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        timeout: float = 120.0,
    ) -> str:
        payload: dict = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        try:
            return self._post(payload, timeout)
        except AIProviderError:
            payload.pop("response_format", None)
            return self._post(payload, timeout)

    def _post(self, payload: dict, timeout: float) -> str:
        last_error: Exception | None = None
        for attempt in range(len(_RETRY_DELAYS) + 1):
            try:
                resp = httpx.post(
                    f"{self._base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=timeout,
                )
            except httpx.TimeoutException:
                raise AITimeoutError(timeout)
            except Exception as exc:
                raise AIProviderError(str(exc))
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
                except (KeyError, IndexError, ValueError) as exc:
                    raise AIProviderError(f"unexpected provider response: {str(exc)}")
            last_error = AIProviderError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            if resp.status_code in (429, 500, 502, 503) and attempt < len(_RETRY_DELAYS):
                time.sleep(_RETRY_DELAYS[attempt])
                continue
            raise last_error
        raise last_error


class OpenRouterProvider(_OpenAICompatibleProvider):
    def __init__(self, api_key: str, model: str):
        super().__init__(api_key, model, "https://openrouter.ai/api/v1")


class GroqProvider(_OpenAICompatibleProvider):
    def __init__(self, api_key: str, model: str):
        super().__init__(api_key, model, "https://api.groq.com/openai/v1")


class GeminiProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def generate(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        timeout: float = 120.0,
    ) -> str:
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
            if m["role"] != "system"
        ]
        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
            },
        }
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent?key={self._api_key}"
        last_error: Exception | None = None
        for attempt in range(len(_RETRY_DELAYS) + 1):
            try:
                resp = httpx.post(url, json=payload, timeout=timeout)
            except httpx.TimeoutException:
                raise AITimeoutError(timeout)
            except Exception as exc:
                raise AIProviderError(str(exc))
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    parts = data["candidates"][0]["content"]["parts"]
                    return "".join(part.get("text", "") for part in parts)
                except (KeyError, IndexError, TypeError, ValueError) as exc:
                    raise AIProviderError(f"unexpected provider response: {str(exc)}")
            last_error = AIProviderError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            if resp.status_code in (429, 500, 502, 503) and attempt < len(_RETRY_DELAYS):
                time.sleep(_RETRY_DELAYS[attempt])
                continue
            raise last_error
        raise last_error


_PROVIDERS = ("gemini", "openrouter", "groq")


def build_provider(settings: Any) -> AIProvider | None:
    name = settings.ai_provider
    if name not in _PROVIDERS:
        return None
    api_key = getattr(settings, f"{name}_api_key", None)
    model = getattr(settings, f"{name}_model", None)
    if not api_key or not model:
        return None
    if name == "gemini":
        return GeminiProvider(api_key, model)
    if name == "groq":
        return GroqProvider(api_key, model)
    return OpenRouterProvider(api_key, model)
