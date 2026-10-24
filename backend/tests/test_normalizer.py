from __future__ import annotations

import pandas as pd
import pytest

from app.services.normalizer import normalize_statements, _df_to_periods, INCOME_MAP
from app.services.yfinance_adapter import RawTickerData


def test_df_to_periods_maps_and_preserves_none():
    df = pd.DataFrame(
        {
            pd.Timestamp("2024-12-31"): {"Total Revenue": 100.0, "Gross Profit": 40.0, "Cost Of Revenue": 60.0, "Net Income": float("nan")},
            pd.Timestamp("2023-12-31"): {"Total Revenue": 90.0, "Gross Profit": 36.0, "Cost Of Revenue": 54.0, "Net Income": 10.0},
        }
    )
    periods = _df_to_periods(df, INCOME_MAP)
    assert periods[0]["period_end"] == "2024-12-31"
    assert periods[0]["items"]["revenue"] == 100.0
    assert periods[0]["items"]["net_income"] is None
    assert periods[1]["items"]["net_income"] == 10.0


def test_normalize_statements_shape():
    df = pd.DataFrame({pd.Timestamp("2024-12-31"): {"Total Revenue": 100.0, "Gross Profit": 40.0}})
    raw = RawTickerData(
        ticker="TEST",
        retrieved_at="2026-01-01",
        info={"longName": "Test Co"},
        income_statement=df,
        balance_sheet=None,
        cash_flow=None,
        data_quality={"alerts": []},
    )
    norm = normalize_statements(raw)
    assert norm["ticker"] == "TEST"
    assert norm["info"]["longName"] == "Test Co"
    assert len(norm["annual"]["income_statement"]) == 1
    assert norm["annual"]["balance_sheet"] == []
    assert norm["quarterly"]["income_statement"] == []
