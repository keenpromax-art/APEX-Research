import json
import os
import re
import sys

from http.server import BaseHTTPRequestHandler

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT = os.path.dirname(os.path.dirname(_HERE))
for _candidate in (
    os.path.join(_PROJECT, "python_lib"),
    os.path.join(_HERE, "python_lib"),
    os.path.join(os.getcwd(), "python_lib"),
):
    _resolved = os.path.abspath(_candidate)
    if os.path.isdir(_resolved) and _resolved not in sys.path:
        sys.path.insert(0, _resolved)

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-^=]{1,25}$")


class handler(BaseHTTPRequestHandler):
    """Vercel entrypoint for /api/fetch/<TICKER>.

    Vercel detects a Python function by a top-level class named `handler` that
    subclasses BaseHTTPRequestHandler, so this stays a class definition. The
    local dev server (python_lib/serve.py) loads this same file, so the two
    cannot drift apart.
    """

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        ticker = path.split("/")[-1].upper()
        if not ticker or not TICKER_RE.match(ticker):
            self._send(400, {"error": f"Invalid ticker format: '{ticker}'."})
            return
        try:
            from adapter import (
                DataUnavailableError,
                TickerNotFoundError,
                fetch_ticker,
            )
        except Exception as exc:
            detail = f"{type(exc).__name__}: {str(exc)[:200]}"
            self._send(502, {"error": f"Data layer failed to initialize: {detail}"})
            return
        try:
            data = fetch_ticker(ticker)
        except TickerNotFoundError:
            self._send(404, {"error": f"Unable to retrieve data for ticker '{ticker}'."})
            return
        except DataUnavailableError as exc:
            self._send(502, {"error": f"Data service unavailable for '{ticker}': {str(exc)[:200]}"})
            return
        except Exception as exc:
            detail = f"{type(exc).__name__}: {str(exc)[:140]}"
            self._send(502, {"error": f"Data retrieval failed for '{ticker}': {detail}"})
            return
        self._send(200, data)

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=900")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass
