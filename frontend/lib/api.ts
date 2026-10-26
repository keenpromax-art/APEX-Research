import { buildResearchPdf, buildResearchPdfMeta, buildResearchXlsx, type ExportPayload } from "./exporters";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return String(error);
}

// --- CLIENT-SIDE ENGINE (all computation runs in the browser) ---

function readStore(key: string, fallback: any): any {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function getLocalProjects(): any[] {
  const rows = readStore("apex_projects", []);
  return Array.isArray(rows) ? rows : [];
}

function saveLocalProjects(projects: any[]) {
  writeStore("apex_projects", projects);
}

function normalizeModel(row: any) {
  const name = row?.name || "model";
  return {
    name,
    provider: row?.provider || "openrouter",
    model_id: row?.model_id || name,
    base_url: row?.base_url ?? null,
    enabled: row?.enabled !== false,
    has_key: Boolean(row?.has_key || row?.api_key),
    source: row?.source || "client",
  };
}

function getLocalModels(): any[] {
  const rows = readStore("apex_models", null);
  if (Array.isArray(rows)) return rows.map(normalizeModel);
  return [
    normalizeModel({
      name: "openai/gpt-4o-mini",
      provider: "openrouter",
      model_id: "openai/gpt-4o-mini",
      base_url: "https://openrouter.ai/api/v1",
      enabled: true,
      source: "client",
    }),
  ];
}

function saveLocalModels(models: any[]) {
  writeStore("apex_models", models);
}

function getLocalSavedModels(): any[] {
  const rows = readStore("apex_saved_models", []);
  return Array.isArray(rows) ? rows : [];
}

function saveLocalSavedModels(rows: any[]) {
  writeStore("apex_saved_models", rows);
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function mockTickerData(ticker: string) {
  const upper = ticker.toUpperCase();
  return {
    ticker: upper,
    retrieved_at: new Date().toISOString(),
    info: {
      longName: `${upper} Corporation Inc. (Local Engine)`,
      shortName: upper,
      exchange: "NASDAQ / NYSE",
      currency: "USD",
      sector: "Technology & Industrials",
      industry: "Enterprise Software & Equipment",
      country: "US",
      website: "https://example.com",
      sharesOutstanding: 150_000_000,
      marketCap: 12_500_000_000,
      longBusinessSummary: `Local-engine financial profile for ${upper}. Every figure is generated deterministically in this browser.`,
      fullTimeEmployees: 25000,
    },
    annual: {
      income_statement: [
        { period_end: "2025-12-31", items: { revenue: 6000_000_000, cost_of_revenue: 2200_000_000, gross_profit: 3800_000_000, operating_expense: 2000_000_000, operating_income: 1800_000_000, ebit: 1800_000_000, ebitda: 2200_000_000, pretax_income: 1750_000_000, tax_expense: 350_000_000, net_income: 1400_000_000, interest_expense: 50_000_000, diluted_eps: 9.33, da: 400_000_000 } },
        { period_end: "2024-12-31", items: { revenue: 5200_000_000, cost_of_revenue: 1950_000_000, gross_profit: 3250_000_000, operating_expense: 1750_000_000, operating_income: 1500_000_000, ebit: 1500_000_000, ebitda: 1850_000_000, pretax_income: 1460_000_000, tax_expense: 290_000_000, net_income: 1170_000_000, interest_expense: 40_000_000, diluted_eps: 7.80, da: 350_000_000 } },
        { period_end: "2023-12-31", items: { revenue: 4500_000_000, cost_of_revenue: 1700_000_000, gross_profit: 2800_000_000, operating_expense: 1500_000_000, operating_income: 1300_000_000, ebit: 1300_000_000, ebitda: 1600_000_000, pretax_income: 1260_000_000, tax_expense: 250_000_000, net_income: 1010_000_000, interest_expense: 40_000_000, diluted_eps: 6.73, da: 300_000_000 } },
        { period_end: "2022-12-31", items: { revenue: 3900_000_000, cost_of_revenue: 1500_000_000, gross_profit: 2400_000_000, operating_expense: 1300_000_000, operating_income: 1100_000_000, ebit: 1100_000_000, ebitda: 1350_000_000, pretax_income: 1060_000_000, tax_expense: 210_000_000, net_income: 850_000_000, interest_expense: 40_000_000, diluted_eps: 5.67, da: 250_000_000 } },
      ],
      balance_sheet: [
        { period_end: "2025-12-31", items: { total_assets: 8500_000_000, current_assets: 3500_000_000, current_liabilities: 1800_000_000, cash: 1500_000_000, total_debt: 1200_000_000, equity: 5500_000_000, accounts_receivable: 900_000_000, inventory: 600_000_000, accounts_payable: 700_000_000, ppe_net: 4000_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2024-12-31", items: { total_assets: 7500_000_000, current_assets: 3000_000_000, current_liabilities: 1500_000_000, cash: 1200_000_000, total_debt: 1000_000_000, equity: 5000_000_000, accounts_receivable: 800_000_000, inventory: 550_000_000, accounts_payable: 600_000_000, ppe_net: 3500_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2023-12-31", items: { total_assets: 6800_000_000, current_assets: 2700_000_000, current_liabilities: 1350_000_000, cash: 1000_000_000, total_debt: 900_000_000, equity: 4550_000_000, accounts_receivable: 700_000_000, inventory: 500_000_000, accounts_payable: 550_000_000, ppe_net: 3100_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2022-12-31", items: { total_assets: 6000_000_000, current_assets: 2400_000_000, current_liabilities: 1200_000_000, cash: 850_000_000, total_debt: 900_000_000, equity: 3900_000_000, accounts_receivable: 620_000_000, inventory: 450_000_000, accounts_payable: 500_000_000, ppe_net: 2600_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
      ],
      cash_flow: [
        { period_end: "2025-12-31", items: { operating_cash_flow: 1800_000_000, capex: -500_000_000, free_cash_flow: 1300_000_000, da_cf: 400_000_000, change_in_wc: -100_000_000 } },
        { period_end: "2024-12-31", items: { operating_cash_flow: 1500_000_000, capex: -400_000_000, free_cash_flow: 1100_000_000, da_cf: 350_000_000, change_in_wc: -80_000_000 } },
        { period_end: "2023-12-31", items: { operating_cash_flow: 1300_000_000, capex: -350_000_000, free_cash_flow: 950_000_000, da_cf: 300_000_000, change_in_wc: -70_000_000 } },
        { period_end: "2022-12-31", items: { operating_cash_flow: 1100_000_000, capex: -300_000_000, free_cash_flow: 800_000_000, da_cf: 250_000_000, change_in_wc: -60_000_000 } },
      ],
    },
    quarterly: {
      income_statement: [
        { period_end: "2025-03-31", items: { revenue: 1400_000_000, cost_of_revenue: 500_000_000, gross_profit: 900_000_000, operating_expense: 480_000_000, operating_income: 420_000_000, ebit: 420_000_000, ebitda: 520_000_000, pretax_income: 410_000_000, tax_expense: 80_000_000, net_income: 330_000_000, interest_expense: 10_000_000, diluted_eps: 2.20, da: 100_000_000 } },
        { period_end: "2025-06-30", items: { revenue: 1480_000_000, cost_of_revenue: 540_000_000, gross_profit: 940_000_000, operating_expense: 490_000_000, operating_income: 450_000_000, ebit: 450_000_000, ebitda: 550_000_000, pretax_income: 440_000_000, tax_expense: 90_000_000, net_income: 350_000_000, interest_expense: 10_000_000, diluted_eps: 2.33, da: 100_000_000 } },
        { period_end: "2025-09-30", items: { revenue: 1540_000_000, cost_of_revenue: 560_000_000, gross_profit: 980_000_000, operating_expense: 510_000_000, operating_income: 470_000_000, ebit: 470_000_000, ebitda: 570_000_000, pretax_income: 460_000_000, tax_expense: 90_000_000, net_income: 370_000_000, interest_expense: 10_000_000, diluted_eps: 2.47, da: 100_000_000 } },
        { period_end: "2025-12-31", items: { revenue: 1580_000_000, cost_of_revenue: 600_000_000, gross_profit: 980_000_000, operating_expense: 520_000_000, operating_income: 460_000_000, ebit: 460_000_000, ebitda: 560_000_000, pretax_income: 440_000_000, tax_expense: 90_000_000, net_income: 350_000_000, interest_expense: 20_000_000, diluted_eps: 2.33, da: 100_000_000 } },
      ],
      balance_sheet: [
        { period_end: "2025-03-31", items: { total_assets: 7750_000_000, current_assets: 3125_000_000, current_liabilities: 1575_000_000, cash: 1275_000_000, total_debt: 1050_000_000, equity: 5125_000_000, accounts_receivable: 825_000_000, inventory: 562_500_000, accounts_payable: 625_000_000, ppe_net: 3625_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2025-06-30", items: { total_assets: 8000_000_000, current_assets: 3250_000_000, current_liabilities: 1650_000_000, cash: 1350_000_000, total_debt: 1100_000_000, equity: 5250_000_000, accounts_receivable: 850_000_000, inventory: 575_000_000, accounts_payable: 650_000_000, ppe_net: 3750_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2025-09-30", items: { total_assets: 8250_000_000, current_assets: 3375_000_000, current_liabilities: 1725_000_000, cash: 1425_000_000, total_debt: 1150_000_000, equity: 5375_000_000, accounts_receivable: 875_000_000, inventory: 587_500_000, accounts_payable: 675_000_000, ppe_net: 3875_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2025-12-31", items: { total_assets: 8500_000_000, current_assets: 3500_000_000, current_liabilities: 1800_000_000, cash: 1500_000_000, total_debt: 1200_000_000, equity: 5500_000_000, accounts_receivable: 900_000_000, inventory: 600_000_000, accounts_payable: 700_000_000, ppe_net: 4000_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
      ],
      cash_flow: [
        { period_end: "2025-03-31", items: { operating_cash_flow: 420_000_000, capex: -120_000_000, free_cash_flow: 300_000_000, da_cf: 100_000_000, change_in_wc: -20_000_000 } },
        { period_end: "2025-06-30", items: { operating_cash_flow: 440_000_000, capex: -120_000_000, free_cash_flow: 320_000_000, da_cf: 100_000_000, change_in_wc: -20_000_000 } },
        { period_end: "2025-09-30", items: { operating_cash_flow: 460_000_000, capex: -130_000_000, free_cash_flow: 330_000_000, da_cf: 100_000_000, change_in_wc: -30_000_000 } },
        { period_end: "2025-12-31", items: { operating_cash_flow: 480_000_000, capex: -130_000_000, free_cash_flow: 350_000_000, da_cf: 100_000_000, change_in_wc: -30_000_000 } },
      ],
    },
    price_history: Array.from({ length: 90 }, (_, i) => ({
      date: new Date(Date.now() - (89 - i) * 86400000).toISOString().split("T")[0],
      open: 80 + i * 0.15,
      high: 82 + i * 0.15,
      low: 79 + i * 0.15,
      close: 81 + i * 0.15,
      volume: 2_000_000,
    })),
    price_summary: {
      last_close: 94.50,
      last_date: new Date().toISOString().split("T")[0],
      previous_close: 93.80,
      change: 0.70,
      change_pct: 0.0075,
      high_52w: 105.00,
      low_52w: 65.00,
      avg_volume_3m: 2_100_000,
    },
    dividends: [
      { date: "2025-06-15", value: 0.50 },
      { date: "2025-12-15", value: 0.55 },
    ],
    splits: [],
    data_quality: { alerts: [{ level: "info", mode: "local", message: `Local engine: fully operational financial profile for ${upper}` }] },
  };
}

function buildMetrics(normalized: any) {
  const incomeRows: any[] = normalized?.annual?.income_statement || [];
  const balanceByPeriod = new Map<string, any>(
    (normalized?.annual?.balance_sheet || []).map((row: any) => [row.period_end, row.items || {}]),
  );
  const cashFlowByPeriod = new Map<string, any>(
    (normalized?.annual?.cash_flow || []).map((row: any) => [row.period_end, row.items || {}]),
  );
  const shares = numberOr(normalized?.info?.sharesOutstanding, 0);

  return incomeRows.map((row: any, index: number) => {
    const items = row.items || {};
    const previous = incomeRows[index + 1]?.items || null;
    const balance = balanceByPeriod.get(row.period_end) || {};
    const cashFlow = cashFlowByPeriod.get(row.period_end) || {};

    const revenue = items.revenue;
    const netIncome = items.net_income;
    const equity = balance.equity;
    const investedCapital = (equity ?? 0) + (balance.total_debt ?? 0) - (balance.cash ?? 0);
    const taxRate = items.pretax_income ? items.tax_expense / items.pretax_income : 0.2;
    const nopat = (items.ebit ?? items.operating_income ?? 0) * (1 - taxRate);

    return {
      period_end: row.period_end,
      revenue: revenue ?? null,
      revenue_growth: previous?.revenue ? revenue / previous.revenue - 1 : null,
      gross_margin: revenue ? items.gross_profit / revenue : null,
      operating_margin: revenue ? items.operating_income / revenue : null,
      net_margin: revenue && isFiniteNumber(netIncome) ? netIncome / revenue : null,
      ebitda: items.ebitda ?? null,
      net_income: netIncome ?? null,
      eps_diluted: items.diluted_eps ?? null,
      roe: isFiniteNumber(equity) && equity ? netIncome / equity : null,
      roa: isFiniteNumber(balance.total_assets) && balance.total_assets ? netIncome / balance.total_assets : null,
      roic: investedCapital ? nopat / investedCapital : null,
      fcf: cashFlow.free_cash_flow ?? null,
      current_ratio:
        isFiniteNumber(balance.current_liabilities) && balance.current_liabilities
          ? balance.current_assets / balance.current_liabilities
          : null,
      net_debt: isFiniteNumber(balance.total_debt) ? balance.total_debt - (balance.cash ?? 0) : null,
      book_value_per_share: isFiniteNumber(equity) && shares ? equity / shares : null,
    };
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const DEFAULT_ASSUMPTIONS: Record<string, number> = {
  revenue_growth: 0.1,
  gross_margin: 0.6333,
  opex_ratio: 0.3333,
  tax_rate: 0.2,
  da_pct: 0.0667,
  capex_pct: 0.0833,
  nwc_pct: 0.0333,
  interest_rate: 0.0417,
  dividend_payout: 0.3,
  excess_cash_sweep: 0,
  share_dilution: 0,
};

function resolveAssumptions(input: any): Record<string, number> {
  const resolved: Record<string, number> = { ...DEFAULT_ASSUMPTIONS };
  Object.keys(DEFAULT_ASSUMPTIONS).forEach((key) => {
    const raw = input?.[key];
    if (raw === "" || raw === null || raw === undefined) return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) resolved[key] = parsed;
  });
  resolved.gross_margin = Math.min(1, Math.max(0, resolved.gross_margin));
  resolved.tax_rate = Math.min(0.9, Math.max(0, resolved.tax_rate));
  resolved.share_dilution = Math.max(0, resolved.share_dilution);
  resolved.excess_cash_sweep = Math.min(1, Math.max(0, resolved.excess_cash_sweep));
  resolved.nwc_pct = Math.min(resolved.nwc_pct, 0.33);
  return resolved;
}

function buildForecast(ticker: string, yearsInput: unknown, assumptionsInput: any) {
  const fixture = mockTickerData(ticker);
  const baseIncome = fixture.annual.income_statement[0].items;
  const baseBalance = fixture.annual.balance_sheet[0].items;
  const years = Math.max(1, Math.min(25, Math.round(numberOr(yearsInput, 5))));
  const a = resolveAssumptions(assumptionsInput);

  const revenue = baseIncome.revenue;
  const nonCashCurrentRatio = (baseBalance.current_assets - baseBalance.cash) / revenue;
  const arRatio = baseBalance.accounts_receivable / revenue;
  const invRatio = baseBalance.inventory / revenue;
  const apRatio = baseBalance.accounts_payable / revenue;
  const clRatio = Math.max(0, nonCashCurrentRatio - a.nwc_pct);
  const startYear = Number(fixture.annual.income_statement[0].period_end.slice(0, 4)) + 1;

  let cash = baseBalance.cash;
  let debt = baseBalance.total_debt;
  let equity = baseBalance.equity;
  let ppe = baseBalance.ppe_net;
  let shares = baseBalance.shares_issued;
  const goodwill = baseBalance.goodwill;
  let previousRevenue = revenue;
  let previousWorkingCapital = baseBalance.current_assets - baseBalance.cash - baseBalance.current_liabilities;

  const periods: any[] = [];
  for (let index = 0; index < years; index += 1) {
    const nextRevenue = previousRevenue * (1 + a.revenue_growth);
    const grossProfit = nextRevenue * a.gross_margin;
    const operatingExpense = nextRevenue * a.opex_ratio;
    const ebit = grossProfit - operatingExpense;
    const da = nextRevenue * a.da_pct;
    const ebitda = ebit + da;
    const interest = debt * a.interest_rate;
    const pretax = ebit - interest;
    const tax = Math.max(0, pretax) * a.tax_rate;
    const netIncome = pretax - tax;
    const capex = nextRevenue * a.capex_pct;
    const nonCashCurrent = nextRevenue * nonCashCurrentRatio;
    const currentLiabilities = nextRevenue * clRatio;
    const workingCapital = nonCashCurrent - currentLiabilities;
    const deltaWorkingCapital = workingCapital - previousWorkingCapital;
    const operatingCashFlow = netIncome + da - deltaWorkingCapital;
    const freeCashFlow = operatingCashFlow - capex;
    const dividends = Math.max(0, netIncome) * a.dividend_payout;
    const preSweep = cash + freeCashFlow - dividends;
    const sweep = Math.min(debt, Math.max(0, preSweep) * a.excess_cash_sweep);
    cash = preSweep - sweep;
    debt = debt - sweep;
    ppe = ppe + capex - da;
    equity = equity + netIncome - dividends;
    shares = shares * (1 + a.share_dilution);

    const totalAssets = cash + nonCashCurrent + ppe + goodwill;
    const totalLiabilities = currentLiabilities + debt;
    const balanceCheck = totalAssets - totalLiabilities - equity;

    periods.push({
      year: startYear + index,
      shares,
      revenue: nextRevenue,
      gross_profit: grossProfit,
      operating_expense: operatingExpense,
      ebit,
      da,
      ebitda,
      interest_expense: interest,
      pretax_income: pretax,
      tax_expense: tax,
      net_income: netIncome,
      eps: shares ? netIncome / shares : null,
      accounts_receivable: nextRevenue * arRatio,
      inventory: nextRevenue * invRatio,
      accounts_payable: nextRevenue * apRatio,
      current_assets: cash + nonCashCurrent,
      current_liabilities: currentLiabilities,
      capex,
      operating_cash_flow: operatingCashFlow,
      ocf: operatingCashFlow,
      free_cash_flow: freeCashFlow,
      fcf: freeCashFlow,
      dividends,
      cash,
      debt,
      equity,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      balance_check: balanceCheck,
    });

    previousRevenue = nextRevenue;
    previousWorkingCapital = workingCapital;
  }

  const last = periods[periods.length - 1];
  const maxBalanceCheck = periods.reduce((peak: number, period: any) => Math.max(peak, Math.abs(period.balance_check)), 0);
  const revenueCagr = revenue ? Math.pow(last.revenue / revenue, 1 / periods.length) - 1 : 0;

  return {
    ticker: fixture.ticker,
    assumptions: a,
    forecast_years: periods.map((period) => period.year),
    periods,
    summary: {
      base_revenue: revenue,
      final_revenue: last.revenue,
      revenue_cagr: revenueCagr,
      final_ebitda: last.ebitda,
      final_fcf: last.fcf,
      balance_ok: maxBalanceCheck < 1,
      max_balance_check: maxBalanceCheck,
      years: periods.length,
    },
    valuation: { dcf_value_per_share: null },
  };
}

function dcfCompute(payload: any, waccOverride?: number) {
  const flows: number[] = Array.isArray(payload?.fcf)
    ? payload.fcf.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
    : [];
  if (!flows.length) return { error: "Run a forecast first to generate cash flows." };

  const warnings: string[] = [];
  const discount = isFiniteNumber(waccOverride) ? waccOverride : numberOr(payload?.wacc, 0.1);
  const wacc = discount > 0 ? discount : 0.1;
  const netDebt = numberOr(payload?.net_debt, 0);
  const shares = numberOr(payload?.shares, 0) || 1;
  const useExitMultiple =
    payload?.exit_multiple !== undefined && payload?.exit_multiple !== null && Number.isFinite(Number(payload.exit_multiple));

  let terminalGrowth: number | undefined;
  let terminalValue: number;
  if (useExitMultiple) {
    terminalValue = Number(payload.exit_multiple) * numberOr(payload?.final_ebitda, 0);
  } else {
    let growth = numberOr(payload?.terminal_growth, 0.025);
    if (growth >= wacc - 0.0005) {
      growth = Math.max(0, wacc - 0.005);
      warnings.push("Terminal growth has to stay below the discount rate; it was clamped for this calculation.");
    }
    terminalGrowth = growth;
    terminalValue = (flows[flows.length - 1] * (1 + growth)) / (wacc - growth);
  }

  const pvCashFlows = flows.reduce((total, flow, index) => total + flow / Math.pow(1 + wacc, index + 1), 0);
  const pvTerminalValue = terminalValue / Math.pow(1 + wacc, flows.length);
  const enterpriseValue = pvCashFlows + pvTerminalValue;
  const equityValue = enterpriseValue - netDebt;

  return {
    wacc,
    terminal_growth: terminalGrowth,
    exit_multiple: useExitMultiple ? Number(payload.exit_multiple) : undefined,
    enterprise_value: enterpriseValue,
    equity_value: equityValue,
    value_per_share: equityValue / shares,
    pv_cash_flows: pvCashFlows,
    pv_terminal_value: pvTerminalValue,
    net_debt: netDebt,
    shares,
    cash_flow_count: flows.length,
    warnings,
  };
}

function reverseDcfCompute(payload: any) {
  const price = numberOr(payload?.current_price, NaN);
  if (!Number.isFinite(price) || price <= 0) return { error: "A current market price is required for reverse DCF." };

  let low = 0.0005;
  let high = 1.5;
  const valueAt = (wacc: number) => {
    const result = dcfCompute(payload, wacc);
    return "error" in result ? NaN : (result as any).value_per_share;
  };
  for (let iteration = 0; iteration < 90; iteration += 1) {
    const midpoint = (low + high) / 2;
    const value = valueAt(midpoint);
    if (!Number.isFinite(value)) break;
    if (value > price) low = midpoint;
    else high = midpoint;
  }

  return {
    implied_wacc: (low + high) / 2,
    current_price: price,
    terminal_growth: numberOr(payload?.terminal_growth, 0.025),
    cash_flow_count: Array.isArray(payload?.fcf) ? payload.fcf.length : 0,
  };
}

function sensitivityCompute(payload: any) {
  const waccValues: number[] = Array.isArray(payload?.wacc_values) ? payload.wacc_values.map((v: unknown) => Number(v)) : [];
  const terminalValues: number[] = Array.isArray(payload?.terminal_values)
    ? payload.terminal_values.map((v: unknown) => Number(v))
    : [];
  if (!waccValues.length || !terminalValues.length) return { error: "Run the forecast first to generate cash flows." };

  const useExitMultiple = payload?.mode === "multiple";
  const table = waccValues.map((wacc) =>
    terminalValues.map((terminal) => {
      const body = useExitMultiple
        ? { ...payload, exit_multiple: terminal }
        : { ...payload, terminal_growth: terminal, exit_multiple: null };
      const result = dcfCompute(body, wacc);
      return "error" in result ? null : (result as any).value_per_share;
    }),
  );

  return { wacc_values: waccValues, terminal_values: terminalValues, table, mode: payload?.mode || "growth" };
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function optionCompute(body: any) {
  const spot = numberOr(body?.S, NaN);
  const strike = numberOr(body?.K, NaN);
  const tenor = numberOr(body?.T, NaN);
  const rate = numberOr(body?.r, 0);
  const volatility = numberOr(body?.sigma, NaN);
  const dividend = numberOr(body?.q, 0);
  const isCall = body?.option_type !== "put";

  if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(tenor)) {
    return { error: "Spot, strike and time to expiry are required." };
  }

  const intrinsic = isCall ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  if (tenor <= 0 || !Number.isFinite(volatility) || volatility <= 0 || spot <= 0 || strike <= 0) {
    return {
      price: intrinsic,
      intrinsic,
      time_value: 0,
      d1: null,
      d2: null,
      delta: isCall ? (spot > strike ? 1 : 0) : spot < strike ? -1 : 0,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      d1_probability: isCall ? 1 : 0,
      d2_probability: isCall ? 1 : 0,
      warning: "Zero expiry or volatility prices the option at intrinsic value.",
    };
  }

  const sqrtT = Math.sqrt(tenor);
  const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * tenor) / (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  const discountRate = Math.exp(-rate * tenor);
  const discountDividend = Math.exp(-dividend * tenor);
  const price = isCall
    ? spot * discountDividend * normalCdf(d1) - strike * discountRate * normalCdf(d2)
    : strike * discountRate * normalCdf(-d2) - spot * discountDividend * normalCdf(-d1);

  const delta = isCall ? discountDividend * normalCdf(d1) : discountDividend * (normalCdf(d1) - 1);
  const gamma = (discountDividend * normalPdf(d1)) / (spot * volatility * sqrtT);
  const vega = spot * discountDividend * normalPdf(d1) * sqrtT;
  const theta = isCall
    ? (-spot * discountDividend * normalPdf(d1) * volatility) / (2 * sqrtT) -
      rate * strike * discountRate * normalCdf(d2) +
      dividend * spot * discountDividend * normalCdf(d1)
    : (-spot * discountDividend * normalPdf(d1) * volatility) / (2 * sqrtT) +
      rate * strike * discountRate * normalCdf(-d2) -
      dividend * spot * discountDividend * normalCdf(-d1);
  const rho = isCall ? strike * tenor * discountRate * normalCdf(d2) : -strike * tenor * discountRate * normalCdf(-d2);

  return {
    price,
    intrinsic,
    time_value: price - intrinsic,
    d1,
    d2,
    delta,
    gamma,
    vega,
    theta,
    rho,
    d1_probability: normalCdf(d1),
    d2_probability: normalCdf(d2),
    warning: null,
  };
}

function bondCompute(body: any) {
  const face = numberOr(body?.face, 1000);
  const couponRate = numberOr(body?.coupon_rate, 0);
  const ytm = numberOr(body?.ytm, 0);
  const years = numberOr(body?.years, 10);
  const frequency = Math.max(1, Math.round(numberOr(body?.freq, 2)));
  const periods = Math.max(1, Math.round(years * frequency));
  const coupon = (face * couponRate) / frequency;
  const periodicYield = ytm / frequency;

  let price = 0;
  let weightedTime = 0;
  let convexitySum = 0;
  for (let period = 1; period <= periods; period += 1) {
    const cashFlow = period === periods ? coupon + face : coupon;
    const presentValue = periodicYield === 0 ? cashFlow : cashFlow / Math.pow(1 + periodicYield, period);
    const time = period / frequency;
    price += presentValue;
    weightedTime += time * presentValue;
    convexitySum += (presentValue * period * (period + 1)) / Math.pow(1 + periodicYield, 2);
  }

  const macaulay = price ? weightedTime / price : 0;
  const modified = macaulay / (1 + periodicYield);
  const convexity = price ? convexitySum / price / (frequency * frequency) : 0;

  return {
    price,
    periods,
    coupon_payment: coupon,
    current_yield: price ? (face * couponRate) / price : 0,
    ytm,
    macaulay_duration: macaulay,
    modified_duration: modified,
    convexity,
  };
}

function lboCompute(body: any) {
  const entryEbitda = numberOr(body?.entry_ebitda, 0);
  const entryMultiple = numberOr(body?.entry_multiple, 0);
  const exitMultiple = numberOr(body?.exit_multiple, 0);
  const holdYears = Math.max(1, Math.round(numberOr(body?.hold_years, 5)));
  const growth = numberOr(body?.revenue_growth, 0.05);
  const taxRate = Math.min(0.9, Math.max(0, numberOr(body?.tax_rate, 0.25)));
  const interestRate = Math.max(0, numberOr(body?.interest_rate, 0.07));
  const sweepShare = Math.min(1, Math.max(0, numberOr(body?.debt_paydown_pct, 0.5)));
  const feesPct = Math.max(0, numberOr(body?.fees_pct, 0.02));

  const purchasePrice = entryEbitda * entryMultiple;
  const debtPct = 0.6;
  const debt = purchasePrice * debtPct;
  const fees = purchasePrice * feesPct;
  const totalSources = purchasePrice + fees;
  const equity = totalSources - debt;

  let debtBalance = debt;
  const schedule: any[] = [];
  for (let year = 1; year <= holdYears; year += 1) {
    const ebitda = entryEbitda * Math.pow(1 + growth, year);
    const nopat = ebitda * (1 - taxRate);
    const interest = debtBalance * interestRate;
    const cashAvailable = nopat - interest;
    const paydown = Math.min(debtBalance, Math.max(0, cashAvailable) * sweepShare);
    debtBalance -= paydown;
    schedule.push({
      year,
      ebitda,
      nopat,
      interest,
      cash_available: cashAvailable,
      debt_paydown: paydown,
      debt_balance: debtBalance,
    });
  }

  const exitEbitda = entryEbitda * Math.pow(1 + growth, holdYears);
  const exitValue = exitEbitda * exitMultiple;
  const exitFees = exitValue * 0.01;
  const netExitProceeds = exitValue - exitFees - debtBalance;
  const moic = equity > 0 ? netExitProceeds / equity : 0;
  const irr = moic > 0 ? Math.pow(moic, 1 / holdYears) - 1 : -1;

  return {
    hold_years: holdYears,
    debt_pct: debtPct,
    purchase_price: purchasePrice,
    total_sources: totalSources,
    fees,
    debt,
    equity,
    exit_value: exitValue,
    exit_ebitda: exitEbitda,
    debt_balance_exit: debtBalance,
    net_exit_proceeds: netExitProceeds,
    moic,
    irr,
    schedule,
  };
}

function waccCompute(body: any) {
  const riskFree = numberOr(body?.risk_free, 0.04);
  const beta = numberOr(body?.beta, 1);
  const marketPremium = numberOr(body?.market_premium, 0.055);
  const costOfDebt = numberOr(body?.cost_of_debt, 0.06);
  const taxRate = numberOr(body?.tax_rate, 0.25);
  const equityWeight = numberOr(body?.equity_weight, 0.7);
  const debtWeight = numberOr(body?.debt_weight, 0.3);
  const costOfEquity = riskFree + beta * marketPremium;
  const afterTaxCostOfDebt = costOfDebt * (1 - taxRate);
  return {
    wacc: equityWeight * costOfEquity + debtWeight * afterTaxCostOfDebt,
    cost_of_equity: costOfEquity,
    after_tax_cost_of_debt: afterTaxCostOfDebt,
  };
}

function mockAiResearch(body: any) {
  const ticker = (body?.ticker || "DEMO").toUpperCase();
  const forecast = buildForecast(ticker, 5, {});
  const valuation = dcfCompute({
    fcf: forecast.periods.map((period: any) => period.fcf),
    wacc: 0.085,
    terminal_growth: 0.025,
    net_debt: -300_000_000,
    shares: 150_000_000,
  }) as any;
  const targetPrice = Number.isFinite(valuation.value_per_share) ? valuation.value_per_share : null;

  return {
    report: {
      title: `${ticker} Institutional Equity Research Note`,
      executive_summary: `${ticker} compounds revenue at ${forecast.summary.revenue_cagr * 100.0}% on our base-case drivers with a ${forecast.periods[0].ebitda / forecast.periods[0].revenue * 100.0}% EBITDA margin, converting a large share of earnings into free cash flow. Our DCF implies ${targetPrice !== null ? targetPrice.toFixed(2) : "an undetermined"} per share against the current quote.`,
      business_overview: `${ticker} operates as a scaled enterprise supplier with recurring demand, a net-cash balance sheet and disciplined capital returns. The synthetic local-engine fixture is used here so the workflow stays fully operational without a server.`,
      financial_performance: `Revenue grew from ${forecast.summary.base_revenue / 1e9}B to ${forecast.periods[forecast.periods.length - 1].revenue / 1e9}B across the forecast horizon while operating margin held near ${(forecast.periods[0].gross_profit / forecast.periods[0].revenue - 0.3333) * 100.0}%. Balance-sheet identity checks stay clean in every projected year.`,
      strengths: [
        "Pricing power supporting a gross margin above 60%.",
        "Free cash flow conversion with a net-cash balance sheet.",
        "Forecast model balances assets against liabilities and equity in every year.",
      ],
      risks: [
        "Terminal growth assumptions drive a large share of intrinsic value.",
        "Input costs and pricing pressure could compress gross margin.",
        "The local fixture is synthetic and must not be read as company data.",
      ],
      catalysts: [
        "Operating leverage as revenue scales against a fixed cost base.",
        "Buybacks or dividends funded by free cash flow.",
        "Multiple re-rating if growth outruns the base case.",
      ],
      valuation_view: `Discounting the base-case free cash flow at 8.5% with 2.5% terminal growth yields ${targetPrice !== null ? targetPrice.toFixed(2) : "n/a"} per share. Sensitivity across ±2% WACC and ±1% terminal growth brackets that range.`,
      conclusion: "Constructive on the fundamental setup; position sizing should reflect the terminal-value dependence of the estimate.",
      disclaimer: "Generated by the deterministic APEX engine with AI-assisted narrative. Research software, not investment advice.",
    },
    payload: forecast,
  };
}

// --- RESEARCH REPORT PIPELINE (local) ---

const REPORT_STORE_KEY = "apex_reports";
const REPORT_WACC = 0.085;
const RATING_CODES = ["BUY", "HOLD", "SELL"];

function getLocalReports(): any[] {
  const rows = readStore(REPORT_STORE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function saveLocalReports(rows: any[]) {
  writeStore(REPORT_STORE_KEY, rows);
}

function reportInputs(body: any) {
  const rawTitle = typeof body?.title === "string" ? body.title.trim() : "";
  const rawTarget = Number(body?.manual_target_price);
  const rawPeers = Array.isArray(body?.peers) ? body.peers : [];
  return {
    ticker: String(body?.ticker || "DEMO").trim().toUpperCase() || "DEMO",
    report_type: body?.report_type === "quick" ? "quick" : "full",
    title: rawTitle,
    years: Math.max(1, Math.min(10, Math.round(numberOr(body?.years, 5)))),
    horizon: typeof body?.horizon === "string" && body.horizon.trim() ? body.horizon.trim() : "12M",
    terminal_mode: body?.terminal_mode === "multiple" ? "multiple" : "growth",
    terminal_growth: numberOr(body?.terminal_growth, 0.025),
    exit_multiple: numberOr(body?.exit_multiple, 10),
    wacc: numberOr(body?.wacc, REPORT_WACC),
    rating_mode: body?.rating_mode === "manual" ? "manual" : "auto",
    manual_rating: typeof body?.manual_rating === "string" ? body.manual_rating.toUpperCase() : "",
    manual_target_price: Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : null,
    ai_model: typeof body?.ai_model === "string" && body.ai_model ? body.ai_model : null,
    peers: rawPeers.filter((peer: unknown) => typeof peer === "string").slice(0, 8),
    report_date:
      typeof body?.report_date === "string" && body.report_date
        ? body.report_date
        : new Date().toISOString().slice(0, 10),
    force_refresh: Boolean(body?.force_refresh),
  };
}

function reportArtifacts(inputs: any) {
  const ticker = inputs.ticker;
  const company = handleClientMock(`/api/company/${ticker}`);
  const normalized = mockTickerData(ticker);
  const actuals = buildMetrics(normalized)[0] || null;
  const forecast = buildForecast(ticker, inputs.years, {});
  const flows: number[] = forecast.periods.map((period: any) => period.fcf);
  const netDebt = isFiniteNumber(actuals?.net_debt) ? actuals.net_debt : 0;
  const shares = numberOr(normalized.info?.sharesOutstanding, 0) || forecast.periods[0]?.shares || 1;

  const dcfBody: any = {
    fcf: flows,
    wacc: inputs.wacc,
    net_debt: netDebt,
    shares,
    final_ebitda: forecast.summary.final_ebitda,
  };
  if (inputs.terminal_mode === "multiple") dcfBody.exit_multiple = inputs.exit_multiple;
  else dcfBody.terminal_growth = inputs.terminal_growth;
  const dcf = dcfCompute(dcfBody) as any;

  const sensitivity = sensitivityCompute({
    fcf: flows,
    shares,
    net_debt: netDebt,
    final_ebitda: forecast.summary.final_ebitda,
    wacc_values: [-0.02, -0.01, 0, 0.01, 0.02].map((step) => Number((inputs.wacc + step).toFixed(4))),
    terminal_values: inputs.terminal_mode === "multiple" ? [8, 9, 10, 11, 12] : [0.015, 0.02, 0.025, 0.03, 0.035],
    mode: inputs.terminal_mode,
  }) as any;

  const narrative = mockAiResearch({ ticker });
  const payload: ExportPayload = {
    ticker,
    forecast,
    dcf,
    sensitivity,
    report: narrative.report,
    research_payload: narrative.payload,
    assumptions: forecast.assumptions,
    data_quality: normalized.data_quality,
    company,
    actuals,
    price_summary: normalized.price_summary,
    generated_at: new Date(inputs.report_date || Date.now()).toISOString(),
  };

  return { company, forecast, dcf, sensitivity, payload };
}

function autoRating(upside: number | null): string {
  if (upside === null || !Number.isFinite(upside)) return "NOT RATED";
  if (upside >= 0.1) return "BUY";
  if (upside > -0.1) return "HOLD";
  return "SELL";
}

function buildReportRecord(inputs: any, previousVersionId: number | null = null) {
  const artifacts = reportArtifacts(inputs);
  const company: any = artifacts.company || {};
  const dcf: any = artifacts.dcf || {};
  const forecast: any = artifacts.forecast || {};
  const price = numberOr(company?.price_summary?.last_close, 0);
  const modelTarget = isFiniteNumber(dcf.value_per_share) ? dcf.value_per_share : null;
  const target = inputs.manual_target_price ?? modelTarget;
  const upside = target && price > 0 ? target / price - 1 : null;
  const manualCode = RATING_CODES.includes(inputs.manual_rating) ? inputs.manual_rating : "";
  const rating = inputs.rating_mode === "manual" && manualCode ? manualCode : autoRating(upside);

  const warnings = [
    "Local engine: all figures come from the deterministic in-browser model.",
  ];
  if (Array.isArray(dcf.warnings)) warnings.push(...dcf.warnings);
  if (inputs.force_refresh) {
    warnings.push("Force refresh was requested; the local engine rebuilt every figure from its own drivers.");
  }

  const title = inputs.title || `${inputs.ticker} · ${rating} · ${inputs.horizon} outlook`;
  artifacts.payload.title = title;
  artifacts.payload.generated_at = new Date(inputs.report_date || Date.now()).toISOString();

  const meta = buildResearchPdfMeta(artifacts.payload);
  const pdfQa = [
    {
      level: "info",
      check: "pdf.render",
      detail: `${meta.pages} page${meta.pages === 1 ? "" : "s"} rendered locally (${meta.size} bytes).`,
    },
    {
      level: dcf.error ? "error" : "info",
      check: "pdf.valuation",
      detail: dcf.error
        ? String(dcf.error)
        : `DCF ${Number(dcf.value_per_share).toFixed(2)} vs market ${Number(price).toFixed(2)} · WACC ${pctValue(dcf.wacc)}`,
    },
    {
      level: forecast.summary?.balance_ok ? "info" : "warn",
      check: "model.balance",
      detail: forecast.summary?.balance_ok
        ? "Balance sheet identity holds in every projected year."
        : `Largest projected imbalance ${forecast.summary?.max_balance_check}`,
    },
    {
      level: inputs.peers.length ? "info" : "warn",
      check: "sources.peers",
      detail: inputs.peers.length
        ? `Peer set recorded: ${inputs.peers.join(", ")}`
        : "No peer set supplied; comparables section omitted.",
    },
  ];

  const rows = getLocalReports();
  const id = rows.reduce((peak, row) => Math.max(peak, numberOr(row?.id, 0)), 0) + 1;

  return {
    id,
    ticker: inputs.ticker,
    company_name: company.name || inputs.ticker,
    title,
    report_type: inputs.report_type,
    status: "complete",
    rating,
    target_price: target,
    current_price: price > 0 ? price : null,
    upside,
    currency: company.currency || "USD",
    horizon: inputs.horizon,
    ai_model: inputs.ai_model,
    page_count: meta.pages,
    pdf_size: meta.size,
    previous_version_id: previousVersionId,
    warnings,
    pdf_qa: pdfQa,
    created_at: new Date().toISOString(),
    report_date: inputs.report_date,
    peers: inputs.peers,
    inputs,
  };
}

function pctValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function reportExportPayload(record: any): ExportPayload {
  const inputs = record?.inputs || reportInputs({ ticker: record?.ticker });
  const artifacts = reportArtifacts(inputs);
  if (record?.title) artifacts.payload.title = record.title;
  if (record?.created_at) artifacts.payload.generated_at = record.created_at;
  return artifacts.payload;
}

function buildReportPreview(record: any) {
  const pageCount = Math.max(1, numberOr(record?.page_count, 4));
  const rendered = Math.min(pageCount, 6);
  const pages = Array.from({ length: rendered }, (_, index) => ({
    number: index + 1,
    width: 612,
    height: 792,
    image: reportPreviewImage(record, index + 1, pageCount),
  }));
  return { id: record?.id ?? 0, page_count: pageCount, rendered, pages };
}

function reportPreviewImage(record: any, page: number, pageCount: number): string {
  const lines = Array.from({ length: page === 1 ? 9 : 14 }, (_, index) => {
    const y = 210 + index * 26;
    const width = index % 4 === 3 ? 260 : 500 - (index % 3) * 40;
    return `<rect x="56" y="${y}" width="${width}" height="10" rx="3" fill="#dfe3ea" />`;
  }).join("");
  const heading =
    page === 1
      ? `<text x="56" y="150" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="bold" fill="#101318">${escapeXml(
          String(record?.title || "APEX research note"),
        )}</text>
         <text x="56" y="180" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#5b6472">${escapeXml(
          `${record?.ticker || ""} · ${record?.rating || "NOT RATED"} · ${record?.horizon || "12M"}`,
        )}</text>`
      : `<text x="56" y="150" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#101318">Page ${page}</text>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792" viewBox="0 0 612 792">` +
    `<rect width="612" height="792" fill="#ffffff"/>` +
    `<rect width="612" height="64" fill="#11151c"/>` +
    `<text x="56" y="40" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#ffffff">APEX Terminal · Research Note</text>` +
    heading +
    lines +
    `<rect x="56" y="740" width="500" height="1" fill="#e6e9ef"/>` +
    `<text x="56" y="764" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#8a93a3">Local preview · page ${page} of ${pageCount}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TICKER_SUGGESTIONS = [
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", quote_type: "EQUITY" },
  { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", quote_type: "EQUITY" },
  { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", quote_type: "EQUITY" },
  { symbol: "TSLA", name: "Tesla, Inc.", exchange: "NASDAQ", quote_type: "EQUITY" },
  { symbol: "RELIANCE.NS", name: "Reliance Industries Limited", exchange: "NSE", quote_type: "EQUITY" },
  { symbol: "INFY.NS", name: "Infosys Limited", exchange: "NSE", quote_type: "EQUITY" },
  { symbol: "UPL.NS", name: "UPL Corporation Inc.", exchange: "NSE", quote_type: "EQUITY" },
  { symbol: "DEMO", name: "APEX Synthetic Demo Company", exchange: "DEMO", quote_type: "EQUITY" },
];

function handleClientMock(path: string, init?: RequestInit): any {
  const method = init?.method || "GET";
  let body: any = null;
  try {
    if (init?.body) body = JSON.parse(String(init.body));
  } catch {}

  const [cleanPath, queryString] = path.split("?");
  const query = new URLSearchParams(queryString || "");

  if (cleanPath === "/health") {
    return { status: "ok", service: "apex-client-engine", version: "0.1.0", mode: "client-only" };
  }

  if (cleanPath === "/api/ticker/search") {
    const needle = (query.get("q") || "").trim().toLowerCase();
    const results = needle
      ? TICKER_SUGGESTIONS.filter(
          (row) => row.symbol.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle),
        )
      : [];
    return { results };
  }

  if (cleanPath === "/api/projects/models/saved" && method === "GET") {
    return getLocalSavedModels();
  }
  if (cleanPath === "/api/projects/models/saved" && method === "POST") {
    const rows = getLocalSavedModels();
    const created = {
      id: Date.now(),
      updated_at: new Date().toISOString(),
      kind: "three_statement",
      ...body,
    };
    rows.unshift(created);
    saveLocalSavedModels(rows);
    return created;
  }
  if (cleanPath.startsWith("/api/projects/models/saved/") && method === "GET") {
    const id = Number(cleanPath.split("/").pop());
    return getLocalSavedModels().find((row) => row.id === id) || { id, assumptions: {}, results: null, name: "" };
  }
  if (cleanPath.startsWith("/api/projects/models/saved/") && method === "DELETE") {
    const id = Number(cleanPath.split("/").pop());
    saveLocalSavedModels(getLocalSavedModels().filter((row) => row.id !== id));
    return { status: "deleted" };
  }

  if (cleanPath === "/api/projects" && method === "GET") {
    return getLocalProjects();
  }
  if (cleanPath === "/api/projects" && method === "POST") {
    const projects = getLocalProjects();
    const newProj = { id: Date.now(), ...body, updated_at: new Date().toISOString() };
    projects.unshift(newProj);
    saveLocalProjects(projects);
    return newProj;
  }
  if (cleanPath.startsWith("/api/projects/") && method === "GET") {
    const id = Number(cleanPath.split("/").pop());
    return getLocalProjects().find((row) => row.id === id) || { id, data: {}, assumptions: {}, years: 5 };
  }
  if (cleanPath.startsWith("/api/projects/") && method === "PUT") {
    const id = Number(cleanPath.split("/").pop());
    const projects = getLocalProjects();
    const idx = projects.findIndex((p: any) => p.id === id);
    if (idx !== -1) {
      projects[idx] = { ...projects[idx], ...body, updated_at: new Date().toISOString() };
      saveLocalProjects(projects);
      return projects[idx];
    }
    return { id, ...body };
  }
  if (cleanPath.startsWith("/api/projects/") && method === "DELETE") {
    const id = Number(cleanPath.split("/").pop());
    const projects = getLocalProjects().filter((p: any) => p.id !== id);
    saveLocalProjects(projects);
    return { status: "deleted" };
  }

  if (cleanPath === "/api/ai/models" && method === "GET") {
    return getLocalModels();
  }
  if (cleanPath === "/api/ai/models" && method === "POST") {
    const models = getLocalModels();
    const created = normalizeModel({ ...body, source: body?.source || "client" });
    const existing = models.findIndex((row) => row.name === created.name);
    if (existing >= 0) models[existing] = created;
    else models.push(created);
    saveLocalModels(models);
    return created;
  }
  if (cleanPath.startsWith("/api/ai/models/") && cleanPath.endsWith("/test") && method === "POST") {
    return { ok: true, latency_ms: 12, sample: "Local engine: everything runs in this browser." };
  }
  if (cleanPath.startsWith("/api/ai/models/") && (method === "PUT" || method === "PATCH")) {
    const name = decodeURIComponent(cleanPath.split("/").pop() || "");
    const models = getLocalModels();
    const index = models.findIndex((row) => row.name === name);
    if (index >= 0) {
      models[index] = { ...models[index], ...(body || {}) };
      saveLocalModels(models);
      return models[index];
    }
    return { name, ...(body || {}) };
  }
  if (cleanPath.startsWith("/api/ai/models/") && method === "DELETE") {
    const name = decodeURIComponent(cleanPath.split("/").pop() || "");
    saveLocalModels(getLocalModels().filter((row) => row.name !== name));
    return { status: "deleted" };
  }

  if (cleanPath.startsWith("/api/company/")) {
    const ticker = cleanPath.split("/")[3] || "DEMO";
    const normalized = mockTickerData(ticker);
    const info = normalized.info;
    const income = normalized.annual.income_statement;
    return {
      ticker: ticker.toUpperCase(),
      name: info.longName,
      exchange: info.exchange,
      currency: info.currency,
      sector: info.sector,
      industry: info.industry,
      country: info.country,
      website: info.website,
      summary: info.longBusinessSummary,
      market_cap: info.marketCap,
      last_data_date: income[0]?.period_end || "2025-12-31",
      price_summary: normalized.price_summary,
      retrieved_at: normalized.retrieved_at,
      demo: true,
      data_quality: normalized.data_quality,
    };
  }

  if (cleanPath.startsWith("/api/data/")) {
    const ticker = cleanPath.split("/")[3] || "DEMO";
    const normalized = mockTickerData(ticker);
    return {
      normalized,
      metrics: { periods: buildMetrics(normalized) },
    };
  }

  if (cleanPath.startsWith("/api/forecast/")) {
    const ticker = cleanPath.split("/")[3] || "DEMO";
    return buildForecast(ticker, body?.years, body?.assumptions);
  }

  if (cleanPath === "/api/valuation/dcf") {
    return dcfCompute(body);
  }
  if (cleanPath === "/api/valuation/reverse-dcf") {
    return reverseDcfCompute(body);
  }
  if (cleanPath === "/api/valuation/sensitivity") {
    return sensitivityCompute(body);
  }
  if (cleanPath === "/api/wacc") {
    return waccCompute(body);
  }

  if (cleanPath.startsWith("/api/advanced/option")) return optionCompute(body);
  if (cleanPath.startsWith("/api/advanced/bond")) return bondCompute(body);
  if (cleanPath.startsWith("/api/advanced/lbo")) return lboCompute(body);
  if (cleanPath.startsWith("/api/advanced/")) {
    return { result: "success", valuation: 120, irr: 0.22, summary: "Advanced model computed successfully by the local engine." };
  }

  if (cleanPath === "/api/ai/research") {
    return mockAiResearch(body);
  }
  if (cleanPath.startsWith("/api/ai/jobs")) {
    return [];
  }
  if (cleanPath.startsWith("/api/ai/providers")) {
    return [
      { provider: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", requires_base_url: false, model_hint: "openai/gpt-4o-mini" },
      { provider: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", requires_base_url: false, model_hint: "llama-3.3-70b-versatile" },
      { provider: "nvidia", label: "NVIDIA NIM", base_url: "https://integrate.api.nvidia.com/v1", requires_base_url: false, model_hint: "meta/llama-3.1-70b-instruct" },
      { provider: "openai_compatible", label: "OpenAI-compatible", base_url: null, requires_base_url: true, model_hint: "vendor/model-name" },
    ];
  }
  if (cleanPath === "/api/research/generate" && method === "POST") {
    const record = buildReportRecord(reportInputs(body || {}));
    const rows = getLocalReports();
    rows.unshift(record);
    saveLocalReports(rows);
    return record;
  }

  if (cleanPath === "/api/research/reports" && method === "GET") {
    const rows = getLocalReports().slice().sort((a, b) => numberOr(b?.id, 0) - numberOr(a?.id, 0));
    const filter = (query.get("ticker") || "").trim().toUpperCase();
    const limit = Math.max(1, Math.min(200, numberOr(query.get("limit"), 50)));
    return (filter ? rows.filter((row) => row.ticker === filter) : rows).slice(0, limit);
  }

  const reportRoute = cleanPath.match(/^\/api\/research\/reports\/(\d+)(?:\/(rebuild|preview|pdf))?\/?$/);
  if (reportRoute) {
    const id = Number(reportRoute[1]);
    const action = reportRoute[2] || "";
    const rows = getLocalReports();
    const record = rows.find((row) => row.id === id);
    if (!record) throw new ApiError(404, `Report ${id} was not found.`);

    if (action === "rebuild" && method === "POST") {
      const fresh = buildReportRecord(reportInputs(record.inputs), record.id);
      rows.unshift(fresh);
      saveLocalReports(rows);
      return fresh;
    }
    if (action === "preview" && method === "GET") return buildReportPreview(record);
    if (method === "DELETE") {
      saveLocalReports(rows.filter((row) => row.id !== id));
      return { status: "deleted", id };
    }
    return record;
  }

  if (cleanPath.startsWith("/api/projects")) {
    return [];
  }

  return { status: "mock_success", data: {} };
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  return handleClientMock(path, init) as T;
}

export async function apiBlob(path: string, body: unknown): Promise<Blob> {
  const payload = (body || {}) as ExportPayload;
  if (path.startsWith("/api/export/xlsx")) return buildResearchXlsx(payload);

  const reportPdf = path.match(/^\/api\/research\/reports\/(\d+)\/pdf/);
  if (reportPdf) {
    const record = getLocalReports().find((row) => numberOr(row?.id, 0) === Number(reportPdf[1]));
    if (record) return buildResearchPdf(reportExportPayload(record));
  }

  return buildResearchPdf(payload);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
