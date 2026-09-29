import type { DerivedMetrics, FinancialData, Metric, Statement } from "./types";

const ALIASES: Record<string, string[]> = {
  revenue: ["Total Revenue", "Revenue"],
  cost_of_revenue: ["Cost Of Revenue", "Cost of Revenue"],
  gross_profit: ["Gross Profit"],
  operating_income: ["Operating Income", "EBIT"],
  ebitda: ["EBITDA"],
  net_income: ["Net Income", "Net Income Common Stockholders"],
  diluted_eps: ["Diluted EPS", "Basic EPS"],
  diluted_shares: ["Diluted Average Shares", "Basic Average Shares"],
  interest_expense: ["Interest Expense"],
  pretax_income: ["Pretax Income"],
  tax_provision: ["Tax Provision"],
  total_assets: ["Total Assets"],
  total_debt: ["Total Debt", "Net Debt"],
  stockholders_equity: ["Stockholders Equity", "Total Stockholder Equity", "Common Stock Equity"],
  cash_and_equivalents: ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"],
  current_assets: ["Total Current Assets"],
  current_liabilities: ["Total Current Liabilities"],
  inventory: ["Inventory"],
  receivables: ["Receivables"],
  goodwill: ["Goodwill"],
  intangible_assets: ["Intangible Assets"],
  retained_earnings: ["Retained Earnings"],
  common_shares_outstanding: ["Common Stock Shares Outstanding", "Share Issued"],
  operating_cash_flow: ["Operating Cash Flow"],
  capital_expenditure: ["Capital Expenditure"],
  free_cash_flow: ["Free Cash Flow"],
  depreciation_amortization: ["Depreciation And Amortization", "Depreciation Amortization Depletion"],
  working_capital_change: ["Change In Working Capital", "Changes In Working Capital"],
  working_capital: ["Working Capital"],
  cash_dividends_paid: ["Cash Dividends Paid", "Common Stock Dividend Paid"],
  repurchase_of_capital_stock: ["Repurchase Of Capital Stock"],
  stock_based_compensation: ["Stock Based Compensation"],
  end_cash_position: ["End Cash Position"],
};

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

class StatementReader {
  private resolved = new Map<string, string>();
  constructor(private statement: Statement | null) {
    if (statement) {
      for (const [canonical, aliases] of Object.entries(ALIASES)) {
        for (const alias of aliases) {
          const target = this.find(alias);
          if (target) {
            this.resolved.set(canonical, target);
            break;
          }
        }
      }
    }
  }

  private find(alias: string): string | null {
    if (!this.statement) return null;
    const target = norm(alias);
    for (const item of Object.keys(this.statement.lineItems)) {
      if (norm(item) === target) return item;
    }
    for (const item of Object.keys(this.statement.lineItems)) {
      if (norm(item).includes(target)) return item;
    }
    return null;
  }

  has(canonical: string): boolean {
    return this.resolved.has(canonical);
  }

  series(canonical: string): Record<string, number | null> {
    if (!this.has(canonical) || !this.statement) return {};
    return this.statement.lineItems[this.resolved.get(canonical)!] ?? {};
  }

  value(canonical: string, period: string): number | null {
    return this.series(canonical)[period] ?? null;
  }

  periods(): string[] {
    return this.statement ? this.statement.periods : [];
  }

  sourcePath(canonical: string): string {
    const item = this.resolved.get(canonical) ?? canonical;
    return `${this.statement!.provenance.normalizedField}[${item}]`;
  }

  path(canonical: string, period: string): string {
    return `${this.sourcePath(canonical)}[${period}]`;
  }
}

function safeDiv(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return current / previous - 1;
}

function cagr(end: number | null, start: number | null, years: number): number | null {
  if (end === null || start === null || years <= 0 || start <= 0 || end <= 0) return null;
  return (end / start) ** (1 / years) - 1;
}

function growthMetrics(
  key: string,
  label: string,
  series: Record<string, number | null>,
  periods: string[]
): Metric[] {
  const metrics: Metric[] = [];
  const byPeriod: Record<string, number | null> = {};
  for (let i = 0; i < periods.length - 1; i++) {
    const previous = periods[i + 1];
    const current = periods[i];
    const value = pctChange(series[current] ?? null, series[previous] ?? null);
    byPeriod[current] = value;
    metrics.push({
      key: `${key}_${current}`,
      label: `${label} ${current.slice(0, 4)}`,
      value,
      unit: "percent",
      formula: `${current} / ${previous} - 1`,
      inputs: [],
    });
  }
  if (periods.length > 0) {
    const latest = periods[0];
    metrics.push({
      key,
      label,
      value: byPeriod[latest] ?? null,
      unit: "percent",
      formula: "latest period / previous period - 1",
      inputs: [],
      byPeriod,
    });
  }
  return metrics;
}

function ratioSeries(
  key: string,
  label: string,
  numerator: Record<string, number | null>,
  denominator: Record<string, number | null>,
  periods: string[],
  unit = "percent"
): Metric {
  const byPeriod: Record<string, number | null> = {};
  for (const period of periods) {
    byPeriod[period] = safeDiv(numerator[period] ?? null, denominator[period] ?? null);
  }
  const latest = periods[0] ?? null;
  return {
    key,
    label,
    value: latest ? byPeriod[latest] ?? null : null,
    unit,
    formula: "numerator / denominator per period",
    inputs: [],
    byPeriod,
  };
}

function point(key: string, label: string, value: number | null, unit: string, formula: string, inputs: string[]): Metric {
  return { key, label, value, unit, formula, inputs };
}

function fcfValue(ocf: number | null, capex: number | null): number | null {
  if (ocf === null || capex === null) return null;
  return ocf + capex;
}

function fcfSeries(reader: StatementReader, periods: string[]): Record<string, number | null> {
  const ocf = reader.series("operating_cash_flow");
  const capex = reader.series("capital_expenditure");
  const direct = reader.series("free_cash_flow");
  const out: Record<string, number | null> = {};
  for (const period of periods) {
    const computed = fcfValue(ocf[period] ?? null, capex[period] ?? null);
    out[period] = computed ?? direct[period] ?? null;
  }
  return out;
}

function workingCapital(reader: StatementReader, period: string): number | null {
  const ca = reader.value("current_assets", period);
  const cl = reader.value("current_liabilities", period);
  if (ca === null || cl === null) return null;
  return ca - cl;
}

function cagrOverPeriods(series: Record<string, number | null>, periods: string[], years: number): number | null {
  if (periods.length < years + 1) return null;
  return cagr(series[periods[0]] ?? null, series[periods[years]] ?? null, years);
}

function indexNMonthsBack(dates: string[], months: number): number | null {
  if (dates.length === 0) return null;
  const last = new Date(dates[dates.length - 1]);
  let targetYear = last.getFullYear() - Math.floor(months / 12);
  let targetMonth = last.getMonth() - (months % 12);
  if (targetMonth < 0) {
    targetMonth += 12;
    targetYear -= 1;
  }
  const target = new Date(targetYear, targetMonth, Math.min(last.getDate(), 28));
  let best: number | null = null;
  for (let i = 0; i < dates.length; i++) {
    if (new Date(dates[i]) <= target) best = i;
  }
  return best === null ? 0 : best;
}

function annualizedVolatility(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const recent = closes.slice(-(window + 1));
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1] !== 0) returns.push(recent[i] / recent[i - 1] - 1);
  }
  if (returns.length < 30) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function maxDrawdown(closes: number[]): number | null {
  if (closes.length === 0) return null;
  let peak = closes[0];
  let maxDd = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    if (peak > 0) {
      const dd = close / peak - 1;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function calculate(data: FinancialData): DerivedMetrics {
  const income = new StatementReader(data.incomeStatement);
  const balance = new StatementReader(data.balanceSheet);
  const cashflow = new StatementReader(data.cashFlow);

  const incomePeriods = income.periods();
  const balancePeriods = balance.periods();
  const cashflowPeriods = cashflow.periods();

  const metrics = new Map<string, Metric>();
  const add = (m: Metric) => metrics.set(m.key, m);

  for (const [canonical, key, label] of [
    ["revenue", "revenue_growth", "Revenue growth"],
    ["gross_profit", "gross_profit_growth", "Gross profit growth"],
    ["operating_income", "operating_income_growth", "Operating income growth"],
    ["ebitda", "ebitda_growth", "EBITDA growth"],
    ["net_income", "net_income_growth", "Net income growth"],
    ["diluted_eps", "eps_growth", "EPS growth"],
  ] as const) {
    const series = income.series(canonical);
    for (const m of growthMetrics(key, label, series, incomePeriods)) {
      m.inputs = [`income_statement[${canonical}]`];
      add(m);
    }
  }

  const fcf = fcfSeries(cashflow, cashflowPeriods);
  for (const m of growthMetrics("fcf_growth", "Free cash flow growth", fcf, cashflowPeriods)) {
    m.inputs = ["cash_flow[operating_cash_flow + capital_expenditure]"];
    add(m);
  }

  add(ratioSeries("gross_margin", "Gross margin", income.series("gross_profit"), income.series("revenue"), incomePeriods));
  add(ratioSeries("operating_margin", "Operating margin", income.series("operating_income"), income.series("revenue"), incomePeriods));
  add(ratioSeries("ebitda_margin", "EBITDA margin", income.series("ebitda"), income.series("revenue"), incomePeriods));
  add(ratioSeries("net_margin", "Net margin", income.series("net_income"), income.series("revenue"), incomePeriods));
  add(ratioSeries("fcf_margin", "FCF margin", fcf, income.series("revenue"), incomePeriods));

  const latestIncome = incomePeriods[0] ?? null;
  const latestBalance = balancePeriods[0] ?? null;
  const latestCashflow = cashflowPeriods[0] ?? null;

  if (latestIncome && latestBalance) {
    const netIncome = income.value("net_income", latestIncome);
    const equity = balance.value("stockholders_equity", latestBalance);
    const assets = balance.value("total_assets", latestBalance);
    add(point("roe", "Return on equity (latest)", safeDiv(netIncome, equity), "percent", "net_income / stockholders_equity", [income.path("net_income", latestIncome), balance.path("stockholders_equity", latestBalance)]));
    add(point("roa", "Return on assets (latest)", safeDiv(netIncome, assets), "percent", "net_income / total_assets", [income.path("net_income", latestIncome), balance.path("total_assets", latestBalance)]));

    const ebit = income.value("operating_income", latestIncome);
    const tax = income.value("tax_provision", latestIncome);
    const pretax = income.value("pretax_income", latestIncome);
    const debt = balance.value("total_debt", latestBalance);
    const cash = balance.value("cash_and_equivalents", latestBalance);
    const investedCapital = debt !== null && equity !== null ? debt + equity - (cash ?? 0) : null;
    let nopat: number | null = null;
    if (ebit !== null && pretax !== null && pretax !== 0) {
      const effectiveTax = safeDiv(tax, pretax);
      if (effectiveTax !== null) nopat = ebit * (1 - effectiveTax);
    }
    add(point("roic", "Return on invested capital (latest)", safeDiv(nopat, investedCapital), "percent", "NOPAT / (total_debt + equity - cash)", [income.path("operating_income", latestIncome), balance.path("total_debt", latestBalance), balance.path("stockholders_equity", latestBalance)]));
  }

  if (latestBalance) {
    const debt = balance.value("total_debt", latestBalance);
    const equity = balance.value("stockholders_equity", latestBalance);
    const cash = balance.value("cash_and_equivalents", latestBalance);
    const currentAssets = balance.value("current_assets", latestBalance);
    const currentLiabilities = balance.value("current_liabilities", latestBalance);
    const inventory = balance.value("inventory", latestBalance);
    add(point("debt_to_equity", "Debt-to-equity (latest)", safeDiv(debt, equity), "ratio", "total_debt / stockholders_equity", [balance.path("total_debt", latestBalance), balance.path("stockholders_equity", latestBalance)]));
    if (debt !== null && cash !== null) {
      add(point("net_debt", "Net debt (latest)", debt - cash, "currency", "total_debt - cash_and_equivalents", [balance.path("total_debt", latestBalance), balance.path("cash_and_equivalents", latestBalance)]));
    }
    add(point("current_ratio", "Current ratio (latest)", safeDiv(currentAssets, currentLiabilities), "ratio", "current_assets / current_liabilities", [balance.path("current_assets", latestBalance), balance.path("current_liabilities", latestBalance)]));
    if (currentAssets !== null && inventory !== null && currentLiabilities !== null) {
      add(point("quick_ratio", "Quick ratio (latest)", (currentAssets - inventory) / currentLiabilities, "ratio", "(current_assets - inventory) / current_liabilities", [balance.path("current_assets", latestBalance), balance.path("inventory", latestBalance), balance.path("current_liabilities", latestBalance)]));
    }
  }

  if (latestBalance && latestIncome) {
    const ebitda = income.value("ebitda", latestIncome);
    const debt = balance.value("total_debt", latestBalance);
    const cash = balance.value("cash_and_equivalents", latestBalance);
    if (ebitda !== null && debt !== null && cash !== null) {
      add(point("net_debt_to_ebitda", "Net debt / EBITDA (latest)", (debt - cash) / ebitda, "ratio", "(total_debt - cash) / ebitda", [balance.path("total_debt", latestBalance), balance.path("cash_and_equivalents", latestBalance), income.path("ebitda", latestIncome)]));
    }
  }

  if (latestCashflow && latestIncome) {
    const ocf = cashflow.value("operating_cash_flow", latestCashflow);
    const capex = cashflow.value("capital_expenditure", latestCashflow);
    const fcfVal = fcfValue(ocf, capex);
    const netIncome = income.value("net_income", latestIncome);
    const revenue = income.value("revenue", latestIncome);
    add(point("cash_conversion", "Cash conversion (FCF / net income, latest)", safeDiv(fcfVal, netIncome), "ratio", "free_cashflow / net_income", ["cash_flow[operating_cash_flow + capital_expenditure]", income.path("net_income", latestIncome)]));
    add(point("capex_to_revenue", "Capex / revenue (latest)", safeDiv(capex !== null ? Math.abs(capex) : null, revenue), "percent", "abs(capital_expenditure) / revenue", [cashflow.path("capital_expenditure", latestCashflow), income.path("revenue", latestIncome)]));
    let wcChange = cashflow.value("working_capital_change", latestCashflow);
    if (wcChange === null && balancePeriods.length >= 2) {
      const wcNow = workingCapital(balance, latestBalance);
      const wcPrev = workingCapital(balance, balancePeriods[1]);
      if (wcNow !== null && wcPrev !== null) wcChange = wcNow - wcPrev;
    }
    if (wcChange !== null) {
      add(point("working_capital_change", "Working capital change (latest)", wcChange, "currency", "change in (current_assets - current_liabilities)", [balance.path("current_assets", latestBalance), balance.path("current_liabilities", latestBalance)]));
    }
  }

  for (const [canonical, key, label, years] of [
    ["revenue", "revenue_cagr_3y", "Revenue CAGR (3y)", 3],
    ["revenue", "revenue_cagr_5y", "Revenue CAGR (5y)", 5],
    ["diluted_eps", "eps_cagr_3y", "EPS CAGR (3y)", 3],
    ["diluted_eps", "eps_cagr_5y", "EPS CAGR (5y)", 5],
  ] as const) {
    const series = income.series(canonical);
    add(point(key, label, cagrOverPeriods(series, incomePeriods, years), "percent", `CAGR over ${years} years`, [`income_statement[${canonical}]`]));
  }
  add(point("fcf_cagr_3y", "FCF CAGR (3y)", cagrOverPeriods(fcf, cashflowPeriods, 3), "percent", "CAGR over 3 years", ["cash_flow[operating_cash_flow + capital_expenditure]"]));

  const incomeKeys = new Set(["revenue", "gross_profit", "operating_income", "ebitda", "net_income", "diluted_eps"]);
  for (const [canonical, key, label] of [
    ["revenue", "revenue", "Revenue"],
    ["gross_profit", "gross_profit", "Gross profit"],
    ["operating_income", "operating_income", "Operating income"],
    ["ebitda", "ebitda", "EBITDA"],
    ["net_income", "net_income", "Net income"],
    ["diluted_eps", "diluted_eps", "Diluted EPS"],
    ["operating_cash_flow", "operating_cash_flow", "Operating cash flow"],
    ["total_debt", "total_debt", "Total debt"],
    ["cash_and_equivalents", "cash_and_equivalents", "Cash and equivalents"],
    ["stockholders_equity", "stockholders_equity", "Stockholders equity"],
    ["total_assets", "total_assets", "Total assets"],
  ] as const) {
    const reader = incomeKeys.has(canonical) ? income : canonical === "operating_cash_flow" ? cashflow : balance;
    const series = reader.series(canonical);
    const readerPeriods = reader.periods();
    if (Object.keys(series).length > 0) {
      const latest = readerPeriods[0] ?? null;
      add({
        key,
        label,
        value: latest ? series[latest] ?? null : null,
        unit: canonical === "diluted_eps" ? "number" : "currency",
        formula: "as reported",
        inputs: [reader.sourcePath(canonical)],
        byPeriod: series,
      });
    }
  }

  const fcfByPeriod: Record<string, number | null> = {};
  for (const p of cashflowPeriods) fcfByPeriod[p] = fcf[p] ?? null;
  if (Object.keys(fcfByPeriod).length > 0) {
    add({
      key: "free_cash_flow",
      label: "Free cash flow",
      value: latestCashflow ? fcfByPeriod[latestCashflow] ?? null : null,
      unit: "currency",
      formula: "operating_cash_flow + capital_expenditure",
      inputs: ["cash_flow[operating_cash_flow + capital_expenditure]"],
      byPeriod: fcfByPeriod,
    });
  }

  addMarketMetrics(metrics, data, income, balance, incomePeriods, balancePeriods);

  return { ticker: data.ticker, metrics };
}

function addMarketMetrics(
  metrics: Map<string, Metric>,
  data: FinancialData,
  income: StatementReader,
  balance: StatementReader,
  incomePeriods: string[],
  balancePeriods: string[]
) {
  const closes = data.historicalPrices.map((r) => r.close).filter((v): v is number => v !== null);
  const dates = data.historicalPrices.map((r) => r.date);
  const price = (data.price?.price as number) ?? null;
  const marketCap = (data.market?.market_cap as number) ?? null;
  const shares = (data.market?.shares_outstanding as number) ?? null;

  const add = (key: string, label: string, value: number | null, unit: string, formula: string, inputs: string[]) => {
    metrics.set(key, point(key, label, value, unit, formula, inputs));
  };

  if (closes.length > 0 && dates.length > 0) {
    for (const [months, key, label] of [
      [1, "price_return_1m", "1-month price return"],
      [3, "price_return_3m", "3-month price return"],
      [6, "price_return_6m", "6-month price return"],
      [12, "price_return_1y", "1-year price return"],
      [36, "price_return_3y", "3-year price return"],
      [60, "price_return_5y", "5-year price return"],
    ] as const) {
      const idx = indexNMonthsBack(dates, months);
      if (idx !== null && closes[idx] !== 0) {
        add(key, label, closes[closes.length - 1] / closes[idx] - 1, "percent", `close[t] / close[t-${months}m] - 1`, ["historical_prices.close"]);
      }
    }
    for (const [window, key, label] of [
      [252, "volatility_1y", "Annualized volatility (1y)"],
      [756, "volatility_3y", "Annualized volatility (3y)"],
    ] as const) {
      add(key, label, annualizedVolatility(closes, window), "percent", "std(daily returns) * sqrt(252)", ["historical_prices.close"]);
    }
    add("max_drawdown_5y", "Max drawdown (5y)", maxDrawdown(closes), "percent", "min(close / running_max(close) - 1)", ["historical_prices.close"]);
  }

  const latestIncome = incomePeriods[0] ?? null;
  const latestBalance = balancePeriods[0] ?? null;

  if (price !== null && latestIncome) {
    const eps = income.value("diluted_eps", latestIncome);
    const revenue = income.value("revenue", latestIncome);
    if (eps !== null && eps > 0) {
      add("pe_current", "P/E (price / latest annual EPS)", price / eps, "ratio", "price / diluted_eps", ["price", `income_statement[diluted_eps][${latestIncome}]`]);
    }
    if (revenue !== null && revenue > 0 && marketCap !== null) {
      add("ps_current", "P/S (market cap / revenue)", marketCap / revenue, "ratio", "market_cap / revenue", ["market.market_cap", `income_statement[revenue][${latestIncome}]`]);
    }
  }

  if (price !== null && latestBalance) {
    const equity = balance.value("stockholders_equity", latestBalance);
    const sharesBs = balance.value("common_shares_outstanding", latestBalance);
    const sharesEff = shares ?? sharesBs;
    if (equity !== null && sharesEff !== null && sharesEff > 0) {
      const bvps = equity / sharesEff;
      if (bvps > 0) {
        add("pb_current", "P/B (price / book value per share)", price / bvps, "ratio", "price / (stockholders_equity / shares_outstanding)", ["price", balance.path("stockholders_equity", latestBalance), "market.shares_outstanding"]);
      }
    }
  }

  if (marketCap !== null && latestBalance && latestIncome) {
    const debt = balance.value("total_debt", latestBalance);
    const cash = balance.value("cash_and_equivalents", latestBalance);
    const ebitda = income.value("ebitda", latestIncome);
    const revenue = income.value("revenue", latestIncome);
    if (debt !== null && cash !== null) {
      const ev = marketCap + debt - cash;
      add("ev_current", "Enterprise value", ev, "currency", "market_cap + total_debt - cash", ["market.market_cap", balance.path("total_debt", latestBalance), balance.path("cash_and_equivalents", latestBalance)]);
      if (ebitda !== null && ebitda > 0) {
        add("ev_to_ebitda", "EV / EBITDA", ev / ebitda, "ratio", "ev / ebitda", ["ev_current", `income_statement[ebitda][${latestIncome}]`]);
      }
      if (revenue !== null && revenue > 0) {
        add("ev_to_revenue", "EV / revenue", ev / revenue, "ratio", "ev / revenue", ["ev_current", `income_statement[revenue][${latestIncome}]`]);
      }
    }
  }

  if (marketCap !== null && marketCap > 0 && metrics.has("free_cash_flow")) {
    const fcfMetric = metrics.get("free_cash_flow")!;
    if (fcfMetric.value !== null) {
      add("fcf_yield", "FCF yield (FCF / market cap)", fcfMetric.value / marketCap, "percent", "free_cashflow / market_cap", ["cash_flow[operating_cash_flow + capital_expenditure]", "market.market_cap"]);
    }
  }
}
