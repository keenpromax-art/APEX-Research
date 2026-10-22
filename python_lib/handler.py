"""Shared HTTP handler for the yfinance data function.

Used by the Vercel serverless function (`api/fetch/[ticker].py`) and by the local
development server (`python_lib/serve.py`), so both serve identical payloads.
"""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler

from adapter import TickerNotFoundError, fetch_ticker

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-^=]{1,25}$")


class FetchHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        ticker = path.split("/")[-1].upper()
        if not ticker or not TICKER_RE.match(ticker):
            self._send(400, {"error": f"Invalid ticker format: '{ticker}'."})
            return
        try:
            data = fetch_ticker(ticker)
        except TickerNotFoundError:
            self._send(404, {"error": f"Unable to retrieve data for ticker '{ticker}'."})
            return
        except Exception as exc:
            self._send(502, {"error": f"Data retrieval failed for '{ticker}': {str(exc)[:200]}"})
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
