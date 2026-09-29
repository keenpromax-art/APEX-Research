import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler

_HERE = os.path.dirname(os.path.abspath(__file__))
for _candidate in (
    os.path.join(_HERE, "..", "..", "python_lib"),
    os.path.join(_HERE, "python_lib"),
    os.path.join(_HERE, "..", "python_lib"),
):
    if os.path.isdir(_candidate):
        sys.path.insert(0, os.path.abspath(_candidate))
        break

from adapter import TickerNotFoundError, fetch_ticker  # noqa: E402

TICKER_RE = re.compile(r"^[A-Za-z0-9.\-^=]{1,25}$")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ticker = self.path.rstrip("/").split("/")[-1].upper()
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
