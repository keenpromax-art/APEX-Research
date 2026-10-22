"""Local development server for the yfinance data function.

`next dev` cannot execute the Python serverless function, so the dev server proxies
`/api/fetch/<TICKER>` to this process (see the rewrite in `next.config.ts`).

    python python_lib/serve.py          # http://127.0.0.1:8010/api/fetch/<TICKER>
"""

from __future__ import annotations

import os
import sys
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from handler import FetchHandler

HOST = os.environ.get("DATA_HOST", "127.0.0.1")
PORT = int(os.environ.get("DATA_PORT", "8010"))


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), FetchHandler)
    print(f"[data] yfinance adapter ready on http://{HOST}:{PORT}/api/fetch/<TICKER>", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
