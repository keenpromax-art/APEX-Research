# ============================================================
# APEX RESEARCH — 1-Year Backtest (Google Colab ready)
# Rewinds 1 year, rebuilds what the model would have recommended THEN
# (mirroring src/lib/*.ts), and checks how it stands NOW.
#
# HOW TO RUN IN GOOGLE COLAB:
#   1. Upload this file to Colab (Files pane) OR paste into a cell.
#   2. To test YOUR tickers: fill the EXTRA_TICKERS box at the top
#      (e.g. "SBIN.NS, BAJFINANCE.NS, NVDA"), tick USE_ONLY_CUSTOM
#      for only-yours. Or locally: main(tickers=["SBIN.NS","NVDA"]).
#   3. Runtime > Run all. Read the table + win rate + charts.
#
# MIRRORED SOURCE RULES (re-read Sep-2026):
#   recommendation.ts  -> BUY > +12% | SELL < -12% | else HOLD | NR if
#                         FV<=0 or upside>+150% / <-80% (confidence bound)
#   calculations.ts    -> Blume beta (0.67*raw+0.33, clamp 0.5-1.8, raw sanity
#                         0.35-2.50 default 0.85); WACC = CoE*wE + 5.625%*wD
#                         + distress spread (+200bps DISTRESSED, +150bps
#                         EARLY_PLATFORM), clamp 8.5-16%; g=4%; winsorized growth
#                         blend 0.55*CAGR + 0.45*live (live 4-35%, CAGR 4-30%);
#                         capex 2.5-8%, depr 2-6%, NWC 2% (platform: capex<=3%,
#                         NWC 3.5%; cyclical: capex>=6.5%); TV capped at 25x FCFF;
#                         ebit margin steps +1/+1.8/+2.4/+2.8/+3.0pp caps .26-.30
#   valuation/selector + residual-income.ts -> banks/NBFC/insurers use
#                         Justified P/B = (ROE-g)/(Ke-g), g=5%, Ke 9.5-14.5%
#                         (Blume clamp 0.65-1.35), P/B floor 0.4 cap 4.5,
#                         sustainable ROE = max(latest, hist avg, reported, floor:
#                         22% ratings / 15% insurance / 14.5% banks)
#   company-archetype.ts -> DISTRESSED (ND/EBITDA>6 or debt>1.5*rev+loss),
#                         EARLY_PLATFORM (platform keywords / loss+growth>15% /
#                         neg EBITDA), CYCLICAL (energy/auto/renewables or
#                         debt>0.35*rev), else MATURE_COMPOUNDER
#   scenarios.ts / ledger -> Bull=FV*1.25 Base=FV Bear=FV*0.75 (25/60/15),
#                         impliedReturn = target/CMP - 1 (shown for reference)
#   Win judged on realized 1y: BUY>+12%, SELL<-12%, HOLD inside band.
#
# HONEST LIMITATIONS (also printed):
#   - Yahoo field names vary; historical beta/shares use current info()
#     values when point-in-time unavailable (flagged in output).
#   - Bank FV uses residual-income with sustainable ROE (approximate).
#   - SWIGGY.NS IPO Nov-2024 -> insufficient annuals at signal -> NR.
# ============================================================

# ---- 0. Install (Colab only; harmless locally) ----
try:
    import google.colab  # noqa
    IN_COLAB = True
except Exception:
    IN_COLAB = False

import subprocess, sys, time, warnings
warnings.filterwarnings("ignore")
try:
    import yfinance
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "yfinance", "pandas", "matplotlib", "numpy"])
    import yfinance

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from datetime import date, timedelta

# ================= CONFIG =================
TICKERS = [
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS",
    "TATAMOTORS.NS", "SUNPHARMA.NS", "CIPLA.NS", "ITC.NS", "LT.NS",
    "AAPL", "MSFT",
    "SWIGGY.NS",  # IPO Nov-2024 -> expect NR/insufficient (edge-case demo)
]
# ---- Colab ticker picker (text box + checkbox in Colab) ----
EXTRA_TICKERS = ""  # @param {type:"string", description:"Extra tickers to ADD (comma/space separated)"}
USE_ONLY_CUSTOM = False  # @param {type:"boolean", description:"Tick to test ONLY your custom tickers (ignore default list)"}

def parse_custom_tickers(raw):
    parts = str(raw or "").replace(";", ",").replace("\n", ",").split(",")
    out, seen = [], set()
    for p in parts:
        t = p.strip().upper()
        if not t:
            continue
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out

def get_test_list():
    """Merge default TICKERS with Colab-box tickers (dedupe, preserve order)."""
    custom = parse_custom_tickers(EXTRA_TICKERS)
    if USE_ONLY_CUSTOM and len(custom):
        return custom
    base = [t.strip().upper() for t in TICKERS]
    seen = set(base)
    for t in custom:
        if t not in seen:
            seen.add(t)
            base.append(t)
    return base

def prompt_for_tickers_fallback(current):
    """Local-terminal option: type more tickers at runtime (skipped in Colab)."""
    try:
        if IN_COLAB:
            return current
        import sys as _sys
        if not _sys.stdin.isatty():
            return current
        ans = input("Add tickers to test (comma separated, Enter to skip): ").strip()
        if not ans:
            return current
        extra = parse_custom_tickers(ans)
        return current + [t for t in extra if t not in set(current)]
    except Exception:
        return current

SIGNAL_OFFSET_DAYS = 365
BUY_THRESH, SELL_THRESH = 0.12, -0.12
MAX_UP, MIN_UP = 1.50, -0.80          # recommendation.ts confidence bounds -> NR
BENCH_IN, BENCH_US = "^NSEI", "^GSPC"
SLEEP_BETWEEN = 1.0
# ==============================================================

RF, ERP = 0.0685, 0.060
PRETAX_DEBT, TAX = 0.075, 0.25
TG, TG_BANK = 0.04, 0.05

BANK_TICKER_HINTS = ("HDFCBANK", "ICICIBANK", "SBIN", "KOTAK", "AXISBANK",
                     "BAJFINANCE", "BAJAJFINSV", "CHOLAFIN", "SHRIRAMFIN", "BANK", "FINANCE")

def bench_for(t):
    return BENCH_IN if (t.upper().endswith(".NS") or t.upper().endswith(".BO")) else BENCH_US

def is_bank_like(ticker, sector="", industry="", desc=""):
    text = f"{ticker} {sector} {industry} {desc}".lower()
    if any(h.lower() in ticker.upper() for h in BANK_TICKER_HINTS):
        return True
    return any(k in text for k in ["bank", "nbfc", "microfinance", "lending", "insurance", "credit"])

def pick(series, keys):
    if series is None:
        return np.nan
    idx = {str(i).strip().lower(): i for i in series.index}
    for k in keys:
        if k.strip().lower() in idx:
            try:
                v = float(series[idx[k.strip().lower()]])
                if np.isfinite(v):
                    return v
            except Exception:
                continue
    return np.nan

def col_before(df, signal, n=4):
    if df is None or df.empty:
        return []
    cols = sorted([c for c in df.columns if pd.to_datetime(c) <= pd.to_datetime(signal)])
    return cols[-n:] if cols else []

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def blume_beta(raw, lo=0.5, hi=1.8):
    """calculations.ts: sanity [0.35,2.50] default 0.85, Blume 0.67*raw+0.33, clamp."""
    try:
        r = float(raw)
    except Exception:
        r = np.nan
    if not np.isfinite(r) or r <= 0:
        r = 0.85
    elif r < 0.35:
        r = 0.35
    elif r > 2.50:
        r = 2.50
    return clamp(0.67 * r + 0.33 * 1.0, lo, hi)

def classify_archetype_lite(ticker, rev, net_income, net_margin, ebitda, ebitda_margin,
                            total_debt, revenue_growth, sector_text=""):
    """Lightweight mirror of company-archetype.ts step 3 (no Yahoo profile needed)."""
    net_debt = max(0, (total_debt or 0))
    nd_ebitda = (net_debt / ebitda) if (ebitda and ebitda > 0) else (999 if (total_debt or 0) > 0 else 0)
    is_loss = (net_income is not None and np.isfinite(net_income) and net_income < 0) or \
              (net_margin is not None and np.isfinite(net_margin) and net_margin < -0.01)
    is_ebitda_neg = (ebitda is not None and np.isfinite(ebitda) and ebitda <= 0) or \
                    (ebitda_margin is not None and np.isfinite(ebitda_margin) and ebitda_margin < 0)
    st = (sector_text or "").lower()
    if nd_ebitda > 6.0 or ((total_debt or 0) > (rev or 0) * 1.5 and is_loss):
        return "DISTRESSED", nd_ebitda
    if ("swiggy" in ticker.lower() or "zomato" in ticker.lower() or "platform" in st or
            (is_loss and np.isfinite(revenue_growth) and revenue_growth > 0.15) or
            (is_ebitda_neg and (rev or 0) > 0)):
        return "EARLY_PLATFORM_GROWTH", nd_ebitda
    if any(k in st for k in ["energy", "oil", "petro", "auto", "renewable"]) or \
            ((total_debt or 0) > (rev or 0) * 0.35 and not is_loss and (rev or 0) > 0):
        return "CYCLICAL_CAPITAL_INTENSIVE", nd_ebitda
    return "MATURE_COMPOUNDER", nd_ebitda

def deterministic_rating(cmp, fv):
    """recommendation.ts mirror incl. NR confidence bounds."""
    if cmp is None or fv is None or cmp <= 0 or fv <= 0 or not np.isfinite([cmp, fv]).all():
        return "NR", np.nan
    upside = fv / cmp - 1.0
    if upside > MAX_UP or upside < MIN_UP:
        return "NR", upside
    if upside > BUY_THRESH:
        return "BUY", upside
    if upside < SELL_THRESH:
        return "SELL", upside
    return "HOLD", upside

def fcff_dcf_then(fin_years, beta_raw, mktcap_then, total_debt_then, archetype,
                  live_growth=np.nan):
    """Mirror calculations.ts computeWACC/computeDCF (winsorized growth, TV cap)."""
    revs = [f["rev"] for f in fin_years]
    if len(revs) < 2 or revs[0] <= 0 or revs[-1] <= 0:
        return None, "need >=2 positive-revenue annuals"
    cagr = (revs[-1] / revs[0]) ** (1 / (len(revs) - 1)) - 1
    has_live = np.isfinite(live_growth) and live_growth != 0
    w_live = clamp(live_growth, 0.04, 0.35) if has_live else np.nan
    w_cagr = clamp(cagr if cagr > 0 else 0.14, 0.04, 0.30)
    base_growth = (0.55 * w_cagr + 0.45 * w_live) if has_live else w_cagr
    g_rates = [base_growth, base_growth * 0.90, base_growth * 0.82,
               base_growth * 0.74, base_growth * 0.66]

    cap = [abs(f["capex"]) / f["rev"] for f in fin_years if f["rev"] > 0]
    dep = [f["depr"] / f["rev"] for f in fin_years if f["rev"] > 0]
    avg_capex = clamp(np.mean(cap) if len(cap) else 0.04, 0.025, 0.08)
    avg_depr = clamp(np.mean(dep) if len(dep) else 0.035, 0.020, 0.06)
    avg_nwc = 0.02
    if archetype == "CYCLICAL_CAPITAL_INTENSIVE":
        avg_capex = max(avg_capex, 0.065)
    elif archetype == "EARLY_PLATFORM_GROWTH":
        avg_capex = min(avg_capex, 0.030)
        avg_nwc = 0.035

    beta = blume_beta(beta_raw)
    coe = RF + beta * ERP
    post_debt = PRETAX_DEBT * (1 - TAX)
    tot = (mktcap_then or 0) + (total_debt_then or 0)
    ew = (mktcap_then / tot) if tot and tot > 0 else 0.95
    spread = 0.020 if archetype == "DISTRESSED" else (0.015 if archetype == "EARLY_PLATFORM_GROWTH" else 0.0)
    wacc = clamp(coe * ew + post_debt * (1 - ew) + spread, 0.085, 0.16)

    last = fin_years[-1]
    # archetype base margin override only if positive (calculations.ts:199)
    eff_margin = last["ebit"] / last["rev"] if last["rev"] else 0.14
    if not np.isfinite(eff_margin) or eff_margin <= 0.03:
        eff_margin = 0.14
    ebit_margins = [min(eff_margin + d, capv) for d, capv in
                    [(0.010, 0.26), (0.018, 0.27), (0.024, 0.28), (0.028, 0.29), (0.030, 0.30)]]

    rev, pv_sum, last_fcff = last["rev"], 0.0, 0.0
    for i in range(5):
        rev = rev * (1 + g_rates[i])
        ebit = rev * ebit_margins[i]
        nopat = ebit * (1 - TAX)
        depr = rev * avg_depr
        capex = rev * max(avg_capex, avg_depr * 1.1)
        nwc = rev * avg_nwc
        fcff = nopat + depr - capex - nwc
        last_fcff = fcff
        pv_sum += fcff * (1 + wacc) ** (-(i + 0.5))
    raw_tv = (last_fcff * (1 + TG)) / max(0.02, wacc - TG)
    tv = min(raw_tv, max(0, last_fcff * 25.0)) if last_fcff > 0 else raw_tv  # 25x TV cap
    ev = pv_sum + tv * (1 + wacc) ** (-5)
    return {"ev": ev, "wacc": wacc, "beta_used": beta, "base_growth": base_growth,
            "cagr_hist": cagr, "live_growth_used": w_live if has_live else np.nan,
            "tv_capped": bool(last_fcff > 0 and raw_tv > last_fcff * 25.0)}, ""

def residual_income_then(total_equity_then, net_income_then, roe_hist_avg, roe_reported,
                         beta_raw, shares, sub_sector="bank"):
    """Mirror valuation/residual-income.ts + selector.ts bank branch."""
    if not (np.isfinite(shares) and shares and shares > 0):
        return None, "bad shares"
    if not (np.isfinite(total_equity_then) and total_equity_then > 0):
        return None, "non-positive book equity"
    bvps = total_equity_then / shares
    latest_roe = total_equity_then and net_income_then / total_equity_then
    floor = 0.220 if sub_sector == "ratings" else (0.150 if sub_sector == "insurance" else 0.145)
    cands = [x for x in [latest_roe, roe_hist_avg, roe_reported, floor] if np.isfinite(x)]
    sus_roe = max(cands) if len(cands) else floor
    # selector.ts bank beta: Blume then clamp [0.65,1.35], Ke clamp [9.5%,14.5%]
    try:
        rb = float(beta_raw)
    except Exception:
        rb = np.nan
    if not np.isfinite(rb) or rb <= 0:
        rb = 0.85
    rb = min(2.50, max(0.35, rb))
    blume = 0.67 * rb + 0.33 * 1.0
    beta_eff = min(1.35, max(0.65, blume))
    ke = min(0.145, max(0.095, 0.0685 + beta_eff * 0.060))
    denom = max(0.02, ke - TG_BANK)
    raw_pb = (sus_roe - TG_BANK) / denom
    jpb = min(4.5, max(0.4, raw_pb if np.isfinite(raw_pb) and raw_pb > 0 else 1.0))
    fv = round(bvps * jpb, 2)
    return {"fv": fv, "bvps": round(bvps, 2), "sus_roe": sus_roe, "ke": ke,
            "jpb": jpb, "beta_eff": beta_eff}, ""

def fetch_one(ticker, signal_date, today):
    t = yfinance.Ticker(ticker)
    px = t.history(start=signal_date - timedelta(days=15), end=today + timedelta(days=5), auto_adjust=True)
    if px is None or px.empty:
        return {"ticker": ticker, "status": "NO_PRICE_DATA"}
    px.index = pd.to_datetime(px.index).tz_localize(None)
    closes = px["Close"].dropna()
    sig = pd.to_datetime(signal_date)
    after = closes[closes.index >= sig]
    if after.empty:
        return {"ticker": ticker, "status": "NO_SIGNAL_PRICE"}
    d0 = after.index[0]
    if (d0 - sig).days > 10:
        return {"ticker": ticker, "status": "SIGNAL_GAP_TOO_BIG"}
    cmp_then, cmp_now = float(after.iloc[0]), float(closes.iloc[-1])
    realized = cmp_now / cmp_then - 1 if cmp_then > 0 else np.nan

    try:
        fin_is, fin_bs, fin_cf = t.financials, t.balance_sheet, t.cashflow
        info = t.info or {}
    except Exception as e:
        return {"ticker": ticker, "status": f"FETCH_ERROR: {e}"}
    sector = str(info.get("sector", "") or "")
    industry = str(info.get("industry", "") or "")
    desc = str(info.get("longBusinessSummary", "") or "")[:500]
    bank_like = is_bank_like(ticker, sector, industry, desc)

    cols = col_before(fin_is, signal_date, 4)
    if len(cols) < 2 and not bank_like:
        return {"ticker": ticker, "status": "INSUFFICIENT_HISTORY (need >=2 annuals before signal)",
                "cmp_then": cmp_then, "cmp_now": cmp_now, "realized_1y": realized}

    beta_raw = info.get("beta", np.nan)
    try:
        beta_raw = float(beta_raw)
    except Exception:
        beta_raw = np.nan
    shares = info.get("sharesOutstanding", np.nan)
    live_g = info.get("revenueGrowth", np.nan)  # current point-in-time proxy (flagged)
    try:
        live_g = float(live_g)
    except Exception:
        live_g = np.nan
    roe_reported = info.get("returnOnEquity", np.nan)
    try:
        roe_reported = float(roe_reported)
    except Exception:
        roe_reported = np.nan

    # ---------- BANK / NBFC branch: residual income ----------
    if bank_like:
        bcols = col_before(fin_bs, signal_date, 4)
        if len(bcols) < 1:
            return {"ticker": ticker, "status": "INSUFFICIENT_BALANCE_HISTORY",
                    "cmp_then": cmp_then, "cmp_now": cmp_now, "realized_1y": realized}
        b = fin_bs[bcols[-1]]
        teq = pick(b, ["Total Stockholder Equity", "Total Stockholders Equity", "Total Equity"])
        # net income from matching income column (latest <= signal)
        icols = col_before(fin_is, signal_date, 1)
        ni = pick(fin_is[icols[-1]], ["Net Income", "NetIncome"]) if len(icols) else np.nan
        roes = []
        for c in bcols:
            bb = fin_bs[c]
            e = pick(bb, ["Total Stockholder Equity", "Total Stockholders Equity", "Total Equity"])
            ii = fin_is[c] if (fin_is is not None and c in fin_is.columns) else None
            n = pick(ii, ["Net Income", "NetIncome"])
            if np.isfinite(e) and e > 0 and np.isfinite(n) and n > 0:
                roes.append(n / e)
        avg_roe = float(np.mean(roes)) if len(roes) else np.nan
        sub = "insurance" if "insurance" in f"{sector} {industry}".lower() else "bank"
        ri, err = residual_income_then(teq, ni, avg_roe, roe_reported, beta_raw, shares, sub)
        if ri is None:
            return {"ticker": ticker, "status": f"RI_FAILED: {err}", "cmp_then": cmp_then,
                    "cmp_now": cmp_now, "realized_1y": realized, "model": "PB_RESIDUAL_INCOME"}
        rating, upside = deterministic_rating(cmp_then, ri["fv"])
        bull, bear = round(ri["fv"] * 1.25, 2), round(ri["fv"] * 0.75, 2)
        return {"ticker": ticker, "status": "OK", "model": "PB_RESIDUAL_INCOME",
                "cmp_then": cmp_then, "cmp_now": cmp_now, "fv_then": ri["fv"],
                "upside_then": upside, "rating_then": rating, "realized_1y": realized,
                "ke": ri["ke"], "jpb": ri["jpb"], "sus_roe": ri["sus_roe"],
                "beta_used": ri["beta_eff"], "bull_then": bull, "bear_then": bear,
                "annuals_used": len(bcols), "signal_price_date": d0.date().isoformat(),
                "live_growth_proxy": live_g, "beta_point_in_time": False}

    # ---------- Non-bank branch: FCFF DCF ----------
    years, equities, incomes = [], [], []
    for c in cols:
        is_c = fin_is[c] if c in fin_is.columns else None
        bs_c = fin_bs[c] if (fin_bs is not None and c in fin_bs.columns) else None
        cf_c = fin_cf[c] if (fin_cf is not None and c in fin_cf.columns) else None
        rev = pick(is_c, ["Total Revenue", "TotalRevenue", "Revenue", "Sales"])
        ebit = pick(is_c, ["Operating Income", "OperatingIncome", "EBIT"])
        if not np.isfinite(ebit):
            ni = pick(is_c, ["Net Income", "NetIncome"])
            ebit = ni / 0.75 if np.isfinite(ni) and ni != 0 else np.nan
        depr = pick(cf_c, ["Depreciation Amortization Depletion", "Depreciation And Amortization",
                           "Depreciation", "DepreciationAmortizationDepletion"])
        capex = pick(cf_c, ["Capital Expenditure", "CapitalExpenditure"])
        if not (np.isfinite(rev) and rev > 0 and np.isfinite(ebit)):
            continue
        years.append({"rev": rev, "ebit": ebit,
                      "depr": depr if np.isfinite(depr) else rev * 0.035,
                      "capex": capex if np.isfinite(capex) else -rev * 0.04})
        e = pick(bs_c, ["Total Stockholder Equity", "Total Stockholders Equity", "Total Equity"])
        n = pick(is_c, ["Net Income", "NetIncome"])
        if np.isfinite(e):
            equities.append(e)
        if np.isfinite(n):
            incomes.append(n)
    if len(years) < 2:
        return {"ticker": ticker, "status": "INSUFFICIENT_CLEAN_ANNUALS",
                "cmp_then": cmp_then, "cmp_now": cmp_now, "realized_1y": realized}

    last = years[-1]
    ebitda_proxy = last["ebit"] + last["depr"]
    ni_last = incomes[-1] if len(incomes) else np.nan
    nm_last = (ni_last / last["rev"]) if np.isfinite(ni_last) else np.nan
    bs_cols = col_before(fin_bs, signal_date, 1)
    debt_then = 0.0
    if len(bs_cols):
        b = fin_bs[bs_cols[-1]]
        debt_then = pick(b, ["Total Debt", "TotalDebt"])
        if not np.isfinite(debt_then):
            ltd = pick(b, ["Long Term Debt", "LongTermDebt"])
            st = pick(b, ["Short Term Debt", "ShortTermDebt", "Current Debt", "Short Long Term Debt"])
            debt_then = (ltd if np.isfinite(ltd) else 0) + (st if np.isfinite(st) else 0)
    arch, _ = classify_archetype_lite(ticker, last["rev"], ni_last, nm_last, ebitda_proxy,
                                      ebitda_proxy / last["rev"] if last["rev"] else np.nan,
                                      debt_then if np.isfinite(debt_then) else 0, live_g,
                                      f"{sector} {industry} {desc}")
    mktcap_then = cmp_then * shares if np.isfinite(shares) and shares and shares > 0 else np.nan
    dcf, err = fcff_dcf_then(years, beta_raw, mktcap_then,
                             debt_then if np.isfinite(debt_then) else 0, arch, live_g)
    if dcf is None:
        return {"ticker": ticker, "status": err, "cmp_then": cmp_then, "cmp_now": cmp_now,
                "realized_1y": realized, "model": "FCFF_DCF", "archetype": arch}
    cash_then = 0.0
    if len(bs_cols):
        b = fin_bs[bs_cols[-1]]
        cash_then = pick(b, ["Cash And Cash Equivalents", "Cash"])
        sti = pick(b, ["Short Term Investments", "Other Short Term Investments"])
        cash_then = (cash_then if np.isfinite(cash_then) else 0) + (sti if np.isfinite(sti) else 0)
    net_debt = (debt_then if np.isfinite(debt_then) else 0) - (cash_then if np.isfinite(cash_then) else 0)
    equity = dcf["ev"] - net_debt
    if not (np.isfinite(shares) and shares and shares > 0 and np.isfinite(equity) and equity > 0):
        return {"ticker": ticker, "status": "INVALID_EQUITY_OR_SHARES", "cmp_then": cmp_then,
                "cmp_now": cmp_now, "realized_1y": realized, "model": "FCFF_DCF", "archetype": arch}
    fv_then = round(equity / shares, 2)
    rating, upside = deterministic_rating(cmp_then, fv_then)
    bull, bear = round(fv_then * 1.25, 2), round(fv_then * 0.75, 2)
    return {"ticker": ticker, "status": "OK", "model": "FCFF_DCF", "archetype": arch,
            "cmp_then": cmp_then, "cmp_now": cmp_now, "fv_then": fv_then,
            "upside_then": upside, "rating_then": rating, "realized_1y": realized,
            "wacc": dcf["wacc"], "base_growth": dcf["base_growth"],
            "hist_cagr": dcf["cagr_hist"], "live_growth_proxy": dcf["live_growth_used"],
            "beta_used": dcf["beta_used"], "tv_capped": dcf["tv_capped"],
            "bull_then": bull, "bear_then": bear,
            "annuals_used": len(years), "signal_price_date": d0.date().isoformat(),
            "beta_point_in_time": False}

def judge(rating, fwd):
    if rating not in ("BUY", "HOLD", "SELL") or not np.isfinite(fwd):
        return "PENDING"
    if rating == "BUY":
        return "WIN" if fwd > BUY_THRESH else "LOSS"
    if rating == "SELL":
        return "WIN" if fwd < SELL_THRESH else "LOSS"
    return "WIN" if (SELL_THRESH <= fwd <= BUY_THRESH) else "LOSS"

def main(tickers=None):
    today = date.today()
    signal = today - timedelta(days=SIGNAL_OFFSET_DAYS)
    test_list = list(tickers) if tickers else get_test_list()
    test_list = prompt_for_tickers_fallback(test_list)
    print("=" * 78)
    print(f"1-YEAR BACKTEST | signal ~= {signal} -> now {today} | n={len(test_list)}")
    print(f"Tickers: {', '.join(test_list)}")
    print("Rating: BUY>+12%, SELL<-12%, else HOLD; NR if FV<=0 or upside>+150%/<-80%")
    print("Win on realized 1y with same bands. Banks -> residual-income P/B (not FCFF).")
    print("Tip (Colab): EXTRA_TICKERS box adds tickers, no code edit needed.")
    print("=" * 78)
    rows = []
    for i, tk in enumerate(test_list, 1):
        print(f"[{i}/{len(test_list)}] {tk} ...")
        try:
            r = fetch_one(tk, signal, today)
        except Exception as e:
            r = {"ticker": tk, "status": f"ERROR: {e}"}
        try:
            b = yfinance.Ticker(bench_for(tk)).history(
                start=signal - timedelta(days=15), end=today + timedelta(days=5), auto_adjust=True)["Close"]
            b.index = pd.to_datetime(b.index).tz_localize(None)
            b0 = b[b.index >= pd.to_datetime(signal)].iloc[0]
            breal = float(b.iloc[-1]) / float(b0) - 1
            r["bench_1y"] = breal
            r["excess_1y"] = (r.get("realized_1y", np.nan) - breal) if np.isfinite(r.get("realized_1y", np.nan)) else np.nan
        except Exception:
            r["bench_1y"], r["excess_1y"] = np.nan, np.nan
        r["verdict"] = judge(r.get("rating_then"), r.get("realized_1y", np.nan)) if r.get("status") == "OK" else "PENDING"
        r["exp_price_pw"] = round(r["bull_then"] * 0.25 + r["fv_then"] * 0.60 + r["bear_then"] * 0.15, 2) \
            if all(k in r and np.isfinite(r[k]) for k in ("bull_then", "fv_then", "bear_then")) else np.nan
        rows.append(r)
        time.sleep(SLEEP_BETWEEN)
    res = pd.DataFrame(rows)

    ok = res[res["status"] == "OK"].copy()
    print("\n--- Per-ticker: THEN vs NOW ---")
    if len(ok):
        cols = ["ticker", "model", "cmp_then", "fv_then", "upside_then", "rating_then",
                "bull_then", "bear_then", "cmp_now", "realized_1y", "excess_1y", "verdict"]
        cols = [c for c in cols if c in ok.columns]
        print(ok[cols].to_string(index=False, formatters={
            "upside_then": "{:.1%}".format, "realized_1y": "{:+.1%}".format, "excess_1y": "{:+.1%}".format}))
        print("\nDetail: archetype / WACC-or-Ke / growth / annuals (beta+shares are current-info proxies):")
        dcols = [c for c in ["ticker", "archetype", "wacc", "ke", "base_growth", "sus_roe",
                             "annuals_used", "tv_capped"] if c in ok.columns]
        print(ok[dcols].to_string(index=False, formatters={
            "wacc": "{:.2%}".format, "ke": "{:.2%}".format, "base_growth": "{:.1%}".format,
            "sus_roe": "{:.1%}".format}))
    bad = res[res["status"] != "OK"]
    if len(bad):
        print("\n--- Skipped (NOT counted in win rate) ---")
        print(bad[["ticker", "status"]].to_string(index=False))

    settled = ok[ok["verdict"].isin(["WIN", "LOSS"])]
    if len(settled):
        wr = (settled["verdict"] == "WIN").mean()
        print(f"\nSTRICT 1Y WIN RATE: {wr:.1%}  ({(settled['verdict']=='WIN').sum()}/{len(settled)} settled)")
        by = settled.groupby("rating_then").agg(
            n=("rating_then", "size"),
            win_rate=("verdict", lambda x: (x == "WIN").mean()),
            avg_realized=("realized_1y", "mean"),
            avg_predicted=("upside_then", "mean")).round(4)
        print("\nBy rating_then (expect BUY avg > HOLD avg > SELL avg):")
        print(by.to_string(formatters={"win_rate": "{:.0%}".format, "avg_realized": "{:+.1%}".format,
                                       "avg_predicted": "{:+.1%}".format}))
        cal = settled[["upside_then", "realized_1y"]].dropna()
        if len(cal) >= 3:
            print(f"\nCalibration: corr={cal.corr().iloc[0,1]:.2f} | "
                  f"MAE={(cal['upside_then']-cal['realized_1y']).abs().mean():.1%} | "
                  f"bias(realized-predicted)={(cal['realized_1y']-cal['upside_then']).mean():+.1%}")
    else:
        print("\nNo settled signals.")

    try:
        res.to_csv("backtest_1y_results.csv", index=False)
        print("\nSaved -> backtest_1y_results.csv")
    except Exception as e:
        print("Save failed:", e)

    if len(settled):
        fig, ax = plt.subplots(1, 3, figsize=(15, 4))
        settled.groupby("rating_then")["verdict"].apply(lambda x: (x == "WIN").mean()).plot(
            kind="bar", ax=ax[0], color=["#16a34a", "#64748b", "#dc2626"])
        ax[0].set_title("Win rate by THEN-rating"); ax[0].set_ylim(0, 1); ax[0].axhline(0.5, c="k", ls="--", lw=0.8)
        order = [x for x in ["BUY", "HOLD", "SELL"] if x in settled["rating_then"].unique()]
        settled.groupby("rating_then")["realized_1y"].mean().reindex(order).plot(
            kind="bar", ax=ax[1], color="#1d4ed8")
        ax[1].set_title("Avg realized 1y"); ax[1].axhline(0, c="k", lw=0.8)
        cal = settled[["upside_then", "realized_1y"]].dropna()
        if len(cal):
            ax[2].scatter(cal["upside_then"], cal["realized_1y"])
            lim = [min(ax[2].get_xlim()[0], ax[2].get_ylim()[0]), max(ax[2].get_xlim()[1], ax[2].get_ylim()[1])]
            ax[2].plot(lim, lim, "k--", lw=0.8)
            ax[2].axhline(0, c="gray", lw=0.6); ax[2].axvline(0, c="gray", lw=0.6)
            ax[2].set_xlabel("Predicted upside THEN"); ax[2].set_ylabel("Realized 1y")
            ax[2].set_title("Calibration")
        plt.tight_layout(); plt.show()
    print("\nSynced to: recommendation.ts (incl. NR bounds), calculations.ts (Blume/WACC/growth/TV-cap), "
          "valuation/selector+residual-income.ts (banks), company-archetype.ts (lite), scenarios.ts (25/60/15).")
    return res

if __name__ == "__main__":
    main()
