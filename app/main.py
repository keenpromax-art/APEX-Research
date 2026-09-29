from fastapi import FastAPI

from app.api import create_app
from lib.config import load_settings


def build_app() -> FastAPI:
    return create_app(load_settings())


app = build_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False, access_log=False)
