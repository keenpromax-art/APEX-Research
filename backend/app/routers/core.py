from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..exceptions import DataError, TickerNotFoundError
from ..services.data_access import load_normalized, refresh
from ..services.yfinance_adapter import RateLimitedError
from ..services.calc_engine import build_three_statement, last_historical
from ..services.valuation import dcf, reverse_dcf, sensitivity_table, wacc
from ..services.advanced import bond_price, black_scholes, lbo

router = APIRouter(prefix="/api", tags=["core"])

ASSUMPTION_KEYS = [
    "revenue_growth",
    "gross_margin",
    "opex_ratio",
    "tax_rate",
    "da_pct",
    "capex_pct",
    "nwc_pct",
    "interest_rate",
    "dividend_payout",
    "minimum_cash",
    "excess_cash_sweep",
    "share_dilution",
]


def _err(error: Exception) -> HTTPException:
    if isinstance(error, RateLimitedError):
        return HTTPException(status_code=503, detail=str(error))
    if isinstance(error, TickerNotFoundError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, DataError):
        return HTTPException(status_code=502, detail=str(error))
    return HTTPException(status_code=500, detail=f"internal error: {error}")


def _load(ticker: str, force_refresh: bool = False):
    try:
        return refresh(ticker) if force_refresh else _fetch_normalized(ticker)
    except DataError as error:
        raise _err(error)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"internal error: {error}")


def _fetch_normalized(ticker: str):
    return load_normalized(ticker)


class ForecastIn(BaseModel):
    years: int = Field(default=5, ge=1, le=25)
    assumptions: dict[str, Any] = Field(default_factory=dict)


class DcfIn(BaseModel):
    fcf: list[float] = Field(default_factory=list)
    wacc: float = 0.10
    terminal_growth: float | None = None
    exit_multiple: float | None = None
    final_ebitda: float | None = None
    net_debt: float = 0.0
    shares: float = 1.0


class SensitivityIn(BaseModel):
    fcf: list[float] = Field(default_factory=list)
    shares: float = 1.0
    net_debt: float = 0.0
    final_ebitda: float = 0.0
    wacc_values: list[float] = Field(default_factory=list)
    terminal_values: list[float] = Field(default_factory=list)
    mode: str = "growth"


class ReverseDcfIn(BaseModel):
    fcf: list[float] = Field(default_factory=list)
    current_price: float
    shares: float = 1.0
    net_debt: float = 0.0
    terminal_growth: float = 0.025


class WaccIn(BaseModel):
    risk_free: float = 0.04
    beta: float = 1.0
    market_premium: float = 0.055
    cost_of_debt: float = 0.06
    tax_rate: float = 0.25
    equity_weight: float = 0.7
    debt_weight: float = 0.3


class LboIn(BaseModel):
    entry_ebitda: float
    entry_multiple: float
    exit_multiple: float
    hold_years: int = 5
    revenue_growth: float = 0.05
    ebitda_margin: float = 0.25
    tax_rate: float = 0.25
    interest_rate: float = 0.07
    debt_paydown_pct: float = 0.5
    fees_pct: float = 0.02
    sponsor_equity_pct: float | None = None


class OptionIn(BaseModel):
    S: float
    K: float
    T: float = 1.0
    r: float = 0.05
    sigma: float = 0.2
    q: float = 0.0
    option_type: str = "call"


class BondIn(BaseModel):
    face: float = 1000.0
    coupon_rate: float = 0.05
    ytm: float = 0.05
    years: float = 10.0
    freq: int = 2


@router.get("/company/{ticker}")
def company(ticker: str, refresh_data: bool = Query(default=False, alias="refresh")):
    normalized, _metrics = _load(ticker, force_refresh=refresh_data)
    info = normalized.get("info", {}) or {}
    income = (normalized.get("annual", {}) or {}).get("income_statement", []) or []
    return {
        "ticker": ticker.upper(),
        "name": info.get("longName") or info.get("shortName"),
        "exchange": info.get("exchange"),
        "currency": info.get("currency"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "website": info.get("website"),
        "summary": info.get("longBusinessSummary"),
        "market_cap": info.get("marketCap"),
        "last_data_date": income[0]["period_end"] if income else None,
        "price_summary": normalized.get("price_summary"),
        "retrieved_at": normalized.get("retrieved_at"),
        "demo": bool(normalized.get("demo")),
        "data_quality": normalized.get("data_quality"),
    }


@router.get("/data/{ticker}")
def data(ticker: str, refresh_data: bool = Query(default=False, alias="refresh")):
    normalized, metrics = _load(ticker, force_refresh=refresh_data)
    return {"normalized": normalized, "metrics": metrics}


@router.get("/metrics/{ticker}")
def metrics(ticker: str, refresh_data: bool = Query(default=False, alias="refresh")):
    _normalized, calculated = _load(ticker, force_refresh=refresh_data)
    return calculated


@router.post("/forecast/{ticker}")
def forecast(ticker: str, body: ForecastIn):
    normalized, calculated = _load(ticker)
    base = last_historical(normalized, calculated)
    if not base:
        raise HTTPException(status_code=422, detail="Not enough historical data to build a forecast.")
    assumptions = {key: value for key, value in body.assumptions.items() if value is not None}
    merged = {**base, **{key: assumptions[key] for key in ASSUMPTION_KEYS if key in assumptions}}
    result = build_three_statement(base, merged, body.years)
    return result


@router.post("/valuation/dcf")
def valuation_dcf(body: DcfIn):
    return dcf(
        body.fcf,
        body.wacc,
        terminal_growth=body.terminal_growth,
        exit_multiple=body.exit_multiple,
        final_ebitda=body.final_ebitda,
        net_debt=body.net_debt,
        shares=body.shares,
    )


@router.post("/valuation/reverse-dcf")
def valuation_reverse_dcf(body: ReverseDcfIn):
    return reverse_dcf(
        body.fcf,
        body.current_price,
        body.shares,
        net_debt=body.net_debt,
        terminal_growth=body.terminal_growth,
    )


@router.post("/valuation/sensitivity")
def val_sensitivity(body: SensitivityIn):
    if body.mode not in {"growth", "multiple"}:
        raise HTTPException(status_code=422, detail="mode must be 'growth' or 'multiple'")
    table = sensitivity_table(
        body.fcf,
        body.shares,
        body.net_debt,
        body.final_ebitda,
        body.wacc_values,
        body.terminal_values,
        body.mode,
    )
    return {
        "table": table,
        "wacc_values": body.wacc_values,
        "terminal_values": body.terminal_values,
        "mode": body.mode,
    }


@router.post("/advanced/lbo")
def adv_lbo(body: LboIn):
    result = lbo(**body.model_dump())
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@router.post("/advanced/option")
def adv_option(body: OptionIn):
    result = black_scholes(**body.model_dump())
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@router.post("/advanced/bond")
def adv_bond(body: BondIn):
    result = bond_price(**body.model_dump())
    if "error" in result:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@router.post("/wacc")
def calc_wacc(body: WaccIn):
    value = wacc(**body.model_dump())
    return {"wacc": value}
