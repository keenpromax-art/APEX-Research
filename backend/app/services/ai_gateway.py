from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..exceptions import AIProviderError, AITimeoutError


@dataclass
class ModelConfig:
    name: str
    provider: str  # openrouter, groq, nvidia, openai_compatible
    model_id: str
    base_url: str | None = None
    api_key: str | None = None
    capabilities: dict[str, bool] = field(default_factory=lambda: {
        "streaming": True,
        "json_mode": True,
        "tool_calling": False,
    })
    params: dict[str, Any] = field(default_factory=dict)
    enabled: bool = True
    source: str = "db"


PROVIDER_BASES = {
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "nvidia": "https://integrate.api.nvidia.com/v1",
}


def resolve_base_url(cfg: ModelConfig) -> str:
    if cfg.base_url:
        return cfg.base_url.rstrip("/")
    return PROVIDER_BASES.get(cfg.provider, "").rstrip("/")


class AIGateway:
    def __init__(self):
        self._models: dict[str, ModelConfig] = {}

    def register(self, cfg: ModelConfig) -> None:
        self._models[cfg.name] = cfg

    def unregister(self, name: str) -> None:
        self._models.pop(name, None)

    def list_models(self) -> list[dict[str, Any]]:
        return [
            {
                "name": m.name,
                "provider": m.provider,
                "model_id": m.model_id,
                "base_url": resolve_base_url(m),
                "capabilities": m.capabilities,
                "params": m.params,
                "enabled": m.enabled,
                "has_key": bool(m.api_key),
                "source": m.source,
            }
            for m in self._models.values()
        ]

    def get(self, name: str) -> ModelConfig | None:
        return self._models.get(name)

    def test_connection(self, cfg: ModelConfig, timeout: float = 20.0) -> dict[str, Any]:
        t0 = time.time()
        try:
            resp = self.generate(
                cfg,
                [{"role": "user", "content": "Reply with the single word: ok"}],
                temperature=0.0,
                max_tokens=8,
                timeout=timeout,
                json_mode=False,
            )
            return {"ok": True, "latency_ms": int((time.time() - t0) * 1000), "sample": resp[:120]}
        except Exception as e:
            return {"ok": False, "latency_ms": int((time.time() - t0) * 1000), "error": str(e)}

    def generate(
        self,
        cfg: ModelConfig,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        timeout: float = 120.0,
        json_mode: bool = True,
        stream: bool = False,
    ) -> str:
        if not cfg.enabled:
            raise AIProviderError(cfg.provider, "model disabled")
        if not cfg.api_key:
            raise AIProviderError(cfg.provider, "missing api key")
        if not messages:
            raise AIProviderError(cfg.provider, "messages must not be empty")
        base = resolve_base_url(cfg)
        if not base:
            raise AIProviderError(cfg.provider, "missing base url")
        url = f"{base}/chat/completions"
        payload: dict[str, Any] = {
            "model": cfg.model_id,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode and cfg.capabilities.get("json_mode", True):
            payload["response_format"] = {"type": "json_object"}
        headers = {
            "Authorization": f"Bearer {cfg.api_key}",
            "Content-Type": "application/json",
        }
        # provider-specific headers
        if cfg.provider == "openrouter":
            headers["HTTP-Referer"] = "http://localhost:3000"
            headers["X-Title"] = "APEX Terminal"

        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = httpx.post(url, headers=headers, json=payload, timeout=timeout)
            except httpx.TimeoutException:
                raise AITimeoutError(cfg.provider, timeout)
            except Exception as exc:
                raise AIProviderError(cfg.provider, str(exc))
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    if not isinstance(content, str):
                        raise ValueError("content is not text")
                    return content
                except (KeyError, IndexError, TypeError, ValueError) as exc:
                    raise AIProviderError(cfg.provider, f"unexpected response: {exc}")
            # retry on 429/5xx
            last_error = AIProviderError(cfg.provider, f"HTTP {resp.status_code}: {resp.text[:300]}")
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            # if json_mode caused 400, retry once without response_format
            if resp.status_code == 400 and "response_format" in payload:
                payload.pop("response_format", None)
                try:
                    resp2 = httpx.post(url, headers=headers, json=payload, timeout=timeout)
                    if resp2.status_code == 200:
                        data = resp2.json()
                        content = data["choices"][0]["message"]["content"]
                        if isinstance(content, str):
                            return content
                except Exception:
                    pass
            raise last_error
        raise last_error or AIProviderError(cfg.provider, "unknown error")

    def generate_stream(self, cfg, messages, **kwargs):
        if not cfg.enabled:
            raise AIProviderError(cfg.provider, "model disabled")
        if not cfg.api_key:
            raise AIProviderError(cfg.provider, "missing api key")
        base = resolve_base_url(cfg)
        if not base:
            raise AIProviderError(cfg.provider, "missing base url")
        url = f"{base}/chat/completions"
        payload = {
            "model": cfg.model_id,
            "messages": messages,
            "temperature": kwargs.get("temperature", 0.2),
            "max_tokens": kwargs.get("max_tokens", 2048),
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {cfg.api_key}", "Content-Type": "application/json"}
        if cfg.provider == "openrouter":
            headers["HTTP-Referer"] = "http://localhost:3000"
            headers["X-Title"] = "APEX Terminal"
        with httpx.stream("POST", url, headers=headers, json=payload, timeout=kwargs.get("timeout", 120.0)) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                    delta = obj["choices"][0].get("delta", {}).get("content")
                    if delta:
                        yield delta
                except Exception:
                    continue
