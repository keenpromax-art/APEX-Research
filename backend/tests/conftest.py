from __future__ import annotations

import pytest

from app.db import init_db


@pytest.fixture(scope="session", autouse=True)
def _db():
    init_db()
    yield
