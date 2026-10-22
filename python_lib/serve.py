"""Local development server for the yfinance data function.

`next dev` cannot execute the Python serverless function, so the dev server proxies
`/api/fetch/<TICKER>` to this process (see the rewrite in `next.config.ts`).

It loads the very same entrypoint file that Vercel runs, so local and deployed
behaviour cannot drift apart.

    python python_lib/serve.py          # http://127.0.0.1:8010/api/fetch/<TICKER>
"""

from __future__ import annotations

import importlib.util
import os
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCTION_FILE = os.path.join(ROOT, "api", "fetch", "[ticker].py")

HOST = os.environ.get("DATA_HOST", "127.0.0.1")
PORT = int(os.environ.get("DATA_PORT", "8010"))


def load_handler():
    """Loads the Vercel entrypoint module and returns its `handler` class."""
    spec = importlib.util.spec_from_file_location("vercel_fetch_function", FUNCTION_FILE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load the fetch function at {FUNCTION_FILE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.handler


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), load_handler())
    print(f"[data] yfinance adapter ready on http://{HOST}:{PORT}/api/fetch/<TICKER>", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
