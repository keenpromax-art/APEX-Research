import time
from threading import Lock
from typing import Any


class TTLCache:
    def __init__(self, ttl_seconds: float = 900):
        self._ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if time.monotonic() >= expires_at:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = time.monotonic() + self._ttl, value

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
