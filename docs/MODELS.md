# Financial Model Documentation

Conventions used across APEX Terminal engines. All percentages are decimals
(0.15 = 15%). Missing data is `None` (rendered "—"), never silently zero.

## Metric formulas (services/metrics.py)

| Metric                | Formula                                                        |
|-----------------------|----------------------------------------------------------------|
| revenue_growth        | (rev_t − rev_{t−1}) / rev_{t−1}                                 |
| gross_margin          | gross_profit / revenue                                          |
| operating_margin      | operating_income / revenue (falls back to ebit / revenue)       |
| ebitda_margin         | ebitda / revenue                                                |
| net_margin            | net_income / revenue                                            |
| tax_rate              | tax_expense / pretax_income                                     |
| interest_coverage     | ebit / interest_expense                                         |
| current_ratio         | current_assets / current_liabilities                            |
| quick_ratio           | (current_assets − inventory) / current_liabilities              |
| net_debt              | total_debt − cash                                               |
| roa                   | net_income / total_assets                                       |
| roe                   | net_income / equity                                             |
| roic                  | ebit × (1 − tax_rate) / (debt + equity − cash)                   |
| debt_to_equity        | total_debt / equity                                             |
| fcf                   | free_cash_flow or ocf − abs(capex)                              |
| ocf_margin / fcf_margin | ocf (fcf) / revenue                                           |
| capex_intensity       | abs(capex) / revenue                                            |
| cash_conversion       | ocf / net_income                                                |
| DSO / DIO / DPO       | 365 × (AR or inventory or AP) / (revenue or COGS)               |

## Three-statement engine (services/calc_engine.py)

Annual driver-based model. Inputs from last historical year: revenue scale,
gross margin, opex ratio, tax rate, D&A % revenue, capex % revenue, net working
capital, PP&E, debt, cash, equity, shares.

Every assumption may be a scalar or a per-year list (the list repeats its last value
if shorter than the forecast).

Per forecast year (t):
```
revenue_t   = revenue_{t−1} × (1 + growth_t)
cogs        = revenue × (1 − gross_margin)
opex        = revenue × opex_ratio
da          = revenue × da_pct
ebit        = gross_profit − opex − da
interest    = beginning_debt × interest_rate
ebt         = ebit − interest
tax         = ebt × tax_rate            (if ebt ≤ 0, tax = 0)
net_income  = ebt − tax
Δ nwc       = Δ revenue × nwc_pct
capex       = revenue × capex_pct
ppe         = ppe_{t−1} + capex − da
ocf         = net_income + da − Δ nwc
fcf         = ocf − capex
dividends   = net_income × payout       (0 if net_income ≤ 0)

cash_before = cash_{t−1} + fcf − dividends
revolver    = max(0, minimum_cash − cash_before)      # deficit financing
debt        = debt_{t−1} + revolver
cash        = cash_before + revolver
sweep       = min(debt, max(0, cash − minimum_cash) × excess_cash_sweep)
debt        = debt − sweep
cash        = cash − sweep
equity      = equity_{t−1} + net_income − dividends
shares      = shares_{t−1} × (1 + share_dilution)
eps         = net_income / shares

total_assets      = cash + ppe + nwc + other_assets
total_liabilities = debt + other_net_liabilities
balance_check     = total_assets − (total_liabilities + equity)
```
`other_assets` and `other_net_liabilities` are the base-year residuals needed to make
the opening balance sheet tie; they are held constant. The model therefore reports a
balance check every year (`bs_check`, also `balance_check`) and `summary.balance_ok`
uses a relative tolerance on total assets. Nothing is plugged silently.

The base year (`last_historical`) is matched by `period_end`, not by list position,
so companion statements with different coverage cannot be paired with the wrong year.
Operating NWC is computed as current assets less cash, less current liabilities
(less short-term debt when exposed). Missing base-year drivers are not silently
zero-filled: they use explicit engine defaults and are recorded in
`assumption_provenance` and `model_input_gaps`.

## DCF (services/valuation.py)

```
PV(CF)  = Σ CF_t / (1+WACC)^t
TV      = FCF_n × (1+g) / (WACC − g)                       [perpetuity growth]
TV      = exit_multiple × final_ebitda                     [exit multiple]
EV      = PV(CF) + TV / (1+WACC)^n
Equity  = EV − net_debt
Shares  → value per share
```
`net_debt` is signed: debt minus cash. A negative value is net cash and is added to
equity value. If `WACC ≤ g`, the terminal value is omitted and the result carries a
warning rather than returning an infinite or negative denominator. Empty or
non-finite cash flows return an error.

WACC = w_e × (risk_free + β × ERP) + w_d × cost_of_debt × (1 − tax_rate).

Sensitivity: `mode="growth"` → rows WACC × cols terminal growth;
`mode="multiple"` → rows WACC × cols exit multiple.

Reverse DCF solves for the WACC implied by the current share price. APEX does not
assume monotonicity: it brackets the root on a deterministic rate grid, then uses
bisection. The solver reports reproduced value, residual, tolerance and whether the
observed price was actually reproduced. A separate reverse-growth solver follows the
same discipline when WACC is fixed.

## LBO (services/advanced.py)

Annual single-tranche sweep model with a transparent schedule:
```
purchase_price = entry_ebitda × entry_multiple
fees           = purchase_price × fees_pct
total_sources  = purchase_price + fees
debt           = total_sources × (1 − sponsor_equity_pct)   # 60% debt unless overridden
equity         = total_sources − debt
each year t    : ebitda_t = entry_ebitda × (1 + growth)^t
                 nopat     = ebitda_t × (1 − tax)
                 interest  = beginning_debt × interest_rate
                 available = nopat − interest
                 paydown   = min(debt, max(0, available) × debt_paydown_pct)
exit           : exit_value = exit_ebitda × exit_multiple
                 exit_fees  = exit_value × 1%
                 net_exit   = exit_value − exit_fees − remaining_debt
MOIC           = net_exit / equity ; IRR = MOIC^(1/years) − 1
```
`ebitda_margin` is recorded but not re-applied because entry EBITDA is supplied
directly. No dividends, management rollover or tranche-level covenants are modelled;
treat the output as a screening model.

## Options (Black–Scholes–Merton, services/advanced.py)

```
d1 = [ln(S/K) + (r − q + σ²/2)T] / (σ√T) ; d2 = d1 − σ√T
call = S e^{−qT} Φ(d1) − K e^{−rT} Φ(d2)
put  = K e^{−rT} Φ(−d2) − S e^{−qT} Φ(−d1)
Δ = e^{−qT} Φ(d1) (call) ; Γ = e^{−qT} φ(d1) / (Sσ√T) ; ve = S e^{−qT} φ(d1) √T
Θ_call = −S e^{−qT} φ(d1) σ/(2√T) + qS e^{−qT} Φ(d1) − rK e^{−rT} Φ(d2)
ρ_call = K T e^{−rT} Φ(d2) ; ρ_put = −K T e^{−rT} Φ(−d2)
```
Theta is per year and rho per 1.00 change in the risk-free rate. Time value =
price − intrinsic. Zero volatility returns the discounted-forward value with a
warning; zero expiry returns intrinsic value.

## Bonds

```
price = Σ coupon/(1+y/f)^i + face/(1+y/f)^n
current_yield = annual_coupon / price
duration (Macaulay) = Σ t·PV(CF_t)/price
modified duration   = Macaulay / (1 + y/f)
convexity = Σ t(t+1/f)·PV(CF_t) / (price·(1+y/f)²)
```
Duration is in years; convexity is the second-order price-yield term. Accrued
interest is not modelled.

## Benchmarks

- DCF: single-year perpetuity at WACC 10%, g 0% → EV 1000, VPS 100; net-debt bridge
  500→400→40; exit-multiple TV; net cash adds to equity; WACC ≤ g warns and omits TV.
- Reverse DCF: round-trips a known DCF value back to its input WACC; unreachable price errors.
- Black–Scholes: ATM zero-rate call = 7.9656 (σ=0.2, T=1); put–call parity; theta/rho/vega
  signs; zero-volatility forward value.
- Bond: par bond priced at face; discount bond below par; modified duration approximates a
  1 bp price change; duration/convexity relationships.
- LBO: schedule ties to the exit bridge; MOIC/IRR identities; sponsor equity controls leverage.
- Three-statement: revenue compounding (scalar and per-year lists), NI = EBT − tax,
  equity/cash roll-forwards, revolver covers minimum cash, cash sweep pays down debt,
  share dilution, balance check, and period-end alignment.
- Metrics: mapping, null preservation, period ordering.
- Engine: forecast balance, reverse DCF, WACC, LBO validation, bond, saved-model CRUD,
  XLSX/PDF bytes, report versioning and PDF download.
