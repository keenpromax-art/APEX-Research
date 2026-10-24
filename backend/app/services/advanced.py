from __future__ import annotations

import math
from typing import Any


def _f(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def lbo(
    entry_ebitda: float,
    entry_multiple: float,
    exit_multiple: float,
    hold_years: int,
    revenue_growth: float,
    ebitda_margin: float,
    tax_rate: float,
    interest_rate: float,
    debt_paydown_pct: float,
    fees_pct: float = 0.02,
    sponsor_equity_pct: float | None = None,
) -> dict[str, Any]:
    """Annual LBO sweep model with a transparent debt schedule.

    ``revenue_growth`` drives EBITDA growth (EBITDA is supplied directly, so
    ``ebitda_margin`` is recorded but not re-applied). ``debt_paydown_pct`` is
    the share of cash available after interest that sweeps to debt.
    """
    entry_ebitda = _f(entry_ebitda)
    entry_multiple = _f(entry_multiple)
    exit_multiple = _f(exit_multiple)
    years = max(1, int(_f(hold_years, 1)))
    growth = max(-0.99, _f(revenue_growth))
    margin = _f(ebitda_margin)
    tax_rate = max(0.0, min(1.0, _f(tax_rate)))
    interest_rate = max(0.0, _f(interest_rate))
    paydown_pct = max(0.0, min(1.0, _f(debt_paydown_pct, 1.0)))
    fees_pct = max(0.0, _f(fees_pct))
    if entry_ebitda <= 0 or entry_multiple <= 0 or exit_multiple <= 0:
        return {"error": "entry EBITDA and multiples must be positive"}

    purchase_price = entry_ebitda * entry_multiple
    fees = purchase_price * fees_pct
    total_sources = purchase_price + fees
    debt_pct = 0.6
    if sponsor_equity_pct is not None:
        debt_pct = 1 - max(0.0, min(1.0, _f(sponsor_equity_pct, 0.4)))
    debt_balance = total_sources * debt_pct
    initial_equity = total_sources - debt_balance

    schedule: list[dict[str, Any]] = []
    for year in range(1, years + 1):
        ebitda = entry_ebitda * (1 + growth) ** year
        nopat = ebitda * (1 - tax_rate)
        interest = debt_balance * interest_rate
        cash_available = nopat - interest
        paydown = min(debt_balance, max(0.0, cash_available) * paydown_pct)
        debt_balance -= paydown
        schedule.append(
            {
                "year": year,
                "ebitda": ebitda,
                "nopat": nopat,
                "interest": interest,
                "cash_available": cash_available,
                "debt_paydown": paydown,
                "debt_balance": debt_balance,
            }
        )

    exit_ebitda = entry_ebitda * (1 + growth) ** years
    exit_value = exit_ebitda * exit_multiple
    exit_fees = exit_value * 0.01
    net_exit = exit_value - exit_fees - debt_balance
    moic = net_exit / initial_equity if initial_equity > 0 else None
    irr = moic ** (1 / years) - 1 if moic is not None and moic > 0 else None

    return {
        "purchase_price": purchase_price,
        "fees": fees,
        "total_sources": total_sources,
        "debt": total_sources * debt_pct,
        "equity": initial_equity,
        "debt_pct": debt_pct,
        "sponsor_equity_pct": 1 - debt_pct,
        "debt_balance_exit": debt_balance,
        "exit_ebitda": exit_ebitda,
        "exit_value": exit_value,
        "exit_fees": exit_fees,
        "net_exit_proceeds": net_exit,
        "moic": moic,
        "irr": irr,
        "hold_years": years,
        "ebitda_margin": margin,
        "schedule": schedule,
    }


def black_scholes(S, K, T, r, sigma, q=0.0, option_type="call"):
    spot = _f(S)
    strike = _f(K)
    expiry = _f(T)
    rate = _f(r)
    vol = _f(sigma)
    dividend = _f(q)
    kind = str(option_type or "call").lower()
    if kind not in {"call", "put"}:
        return {"error": "option_type must be call or put"}
    if spot <= 0 or strike <= 0:
        return {"error": "spot and strike must be positive"}

    def norm_cdf(x: float) -> float:
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))

    def norm_pdf(x: float) -> float:
        return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

    intrinsic = max(spot - strike, 0.0) if kind == "call" else max(strike - spot, 0.0)
    if expiry <= 0:
        return {
            "price": intrinsic,
            "intrinsic": intrinsic,
            "time_value": 0.0,
            "d1": None,
            "d2": None,
            "delta": 1.0 if (kind == "call" and spot > strike) else (-1.0 if (kind == "put" and spot < strike) else 0.0),
            "gamma": 0.0,
            "vega": 0.0,
            "theta": 0.0,
            "rho": 0.0,
        }

    if vol <= 0:
        forward_value = spot * math.exp(-dividend * expiry) - strike * math.exp(-rate * expiry)
        price = max(forward_value, 0.0) if kind == "call" else max(-forward_value, 0.0)
        return {
            "price": price,
            "intrinsic": intrinsic,
            "time_value": price - intrinsic,
            "d1": None,
            "d2": None,
            "delta": None,
            "gamma": None,
            "vega": None,
            "theta": None,
            "rho": None,
            "warning": "zero volatility: option is a forward",
        }

    sqrt_t = math.sqrt(expiry)
    d1 = (math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * expiry) / (vol * sqrt_t)
    d2 = d1 - vol * sqrt_t
    discount_r = math.exp(-rate * expiry)
    discount_q = math.exp(-dividend * expiry)

    if kind == "call":
        price = spot * discount_q * norm_cdf(d1) - strike * discount_r * norm_cdf(d2)
        delta = discount_q * norm_cdf(d1)
        theta = (
            -spot * discount_q * norm_pdf(d1) * vol / (2 * sqrt_t)
            + dividend * spot * discount_q * norm_cdf(d1)
            - rate * strike * discount_r * norm_cdf(d2)
        )
        rho = strike * expiry * discount_r * norm_cdf(d2)
    else:
        price = strike * discount_r * norm_cdf(-d2) - spot * discount_q * norm_cdf(-d1)
        delta = discount_q * (norm_cdf(d1) - 1)
        theta = (
            -spot * discount_q * norm_pdf(d1) * vol / (2 * sqrt_t)
            - dividend * spot * discount_q * norm_cdf(-d1)
            + rate * strike * discount_r * norm_cdf(-d2)
        )
        rho = -strike * expiry * discount_r * norm_cdf(-d2)

    gamma = discount_q * norm_pdf(d1) / (spot * vol * sqrt_t)
    vega = spot * discount_q * norm_pdf(d1) * sqrt_t

    return {
        "price": price,
        "intrinsic": intrinsic,
        "time_value": price - intrinsic,
        "d1": d1,
        "d2": d2,
        "delta": delta,
        "gamma": gamma,
        "vega": vega,
        "theta": theta,
        "rho": rho,
        "d1_probability": norm_cdf(d1),
        "d2_probability": norm_cdf(d2),
    }


def bond_price(face, coupon_rate, ytm, years, freq=2):
    face_value = _f(face)
    coupon_rate = _f(coupon_rate)
    yield_to_maturity = _f(ytm)
    maturity = _f(years)
    frequency = max(1, int(_f(freq, 2)))
    if face_value <= 0 or maturity <= 0:
        return {"error": "face value and years must be positive"}
    periods = int(round(maturity * frequency))
    if periods <= 0:
        return {"error": "maturity must contain at least one coupon period"}
    if yield_to_maturity / frequency <= -1:
        return {"error": "yield to maturity is below the valid range"}

    coupon = face_value * coupon_rate / frequency
    periodic_yield = yield_to_maturity / frequency
    price = 0.0
    weighted_time = 0.0
    convexity_numerator = 0.0
    for index in range(1, periods + 1):
        cash_flow = coupon if index < periods else coupon + face_value
        present_value = cash_flow / ((1 + periodic_yield) ** index)
        price += present_value
        time_years = index / frequency
        weighted_time += time_years * present_value
        convexity_numerator += time_years * (time_years + 1 / frequency) * present_value
    if price <= 0:
        return {"error": "bond price is not positive"}

    macaulay = weighted_time / price
    modified = macaulay / (1 + periodic_yield)
    convexity = convexity_numerator / (price * (1 + periodic_yield) ** 2)
    current_yield = (coupon * frequency) / price if price else None

    return {
        "price": price,
        "duration": macaulay,
        "macaulay_duration": macaulay,
        "modified_duration": modified,
        "convexity": convexity,
        "current_yield": current_yield,
        "ytm": yield_to_maturity,
        "coupon_payment": coupon,
        "periods": periods,
    }
