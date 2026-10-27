import { buildResearchPdf, buildResearchPdfMeta, buildResearchXlsx, inspectPdfBytes, type ExportPayload } from "./exporters";
import {
  buildProvenanceRows,
  integrityGates,
  parseListing,
  sectorProfile,
  validateIdentity,
} from "./provenance";
import {
  buildDeterministicNarrative,
  tryProviderNarrative,
  PROMPT_VERSION,
} from "./narrative";
import { fetchTickerFixture } from "./marketData";

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
    api_key: row?.api_key || null,
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

type FixtureIdentity = {
  name: string;
  sector: string;
  industry: string;
  country: string;
  website: string;
  employees: number;
  business: string;
};

const KNOWN_IDENTITIES: Record<string, FixtureIdentity> = {
  AAPL: {
    name: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    country: "US",
    website: "https://www.apple.com",
    employees: 164_000,
    business: "Designs and markets smartphones, personal computers, tablets, wearables and accessories, and sells a range of related services.",
  },
  MSFT: {
    name: "Microsoft Corporation",
    sector: "Technology",
    industry: "Systems Software",
    country: "US",
    website: "https://www.microsoft.com",
    employees: 221_000,
    business: "Develops and supports software, services, devices and solutions across productivity, cloud infrastructure and personal computing.",
  },
  NVDA: {
    name: "NVIDIA Corporation",
    sector: "Technology",
    industry: "Semiconductors",
    country: "US",
    website: "https://www.nvidia.com",
    employees: 29_600,
    business: "Designs graphics processing units and accelerated computing platforms for gaming, data centre, professional visualisation and automotive markets.",
  },
  TSLA: {
    name: "Tesla, Inc.",
    sector: "Consumer Discretionary",
    industry: "Automobile Manufacturers",
    country: "US",
    website: "https://www.tesla.com",
    employees: 140_473,
    business: "Designs, develops, manufactures and sells electric vehicles and energy generation and storage systems.",
  },
  "RELIANCE.NS": {
    name: "Reliance Industries Limited",
    sector: "Energy",
    industry: "Diversified Oil Gas & Chemicals",
    country: "IN",
    website: "https://www.ril.com",
    employees: 389_414,
    business: "Operates across refining, petrochemicals, retail and digital services with integrated energy-to-consumer operations.",
  },
  "INFY.NS": {
    name: "Infosys Limited",
    sector: "Information Technology",
    industry: "IT Consulting & Services",
    country: "IN",
    website: "https://www.infosys.com",
    employees: 317_240,
    business: "Provides consulting, technology, outsourcing and digital services to global enterprises.",
  },
  "INOXWIND.NS": {
    name: "Inox Wind Limited",
    sector: "Industrials",
    industry: "Wind Energy Equipment",
    country: "IN",
    website: "https://www.inoxwind.com",
    employees: 1_200,
    business: "Manufactures wind turbine generators and provides turnkey wind power project development, construction and operations services in India.",
  },
  GAPCO: {
    name: "GAPCO Sample Co.",
    sector: "Consumer Discretionary",
    industry: "Specialty Retail",
    country: "US",
    website: "https://example.invalid",
    employees: 4_200,
    business: "Sparse sample fixture: only two annual income periods, no cash-flow statement and a partially blank price summary.",
  },
};

const SECTOR_WHEEL: FixtureIdentity[] = [
  {
    name: "",
    sector: "Technology",
    industry: "Application Software",
    country: "US",
    website: "https://example.invalid",
    employees: 9_500,
    business: "Enterprise software products and subscription services.",
  },
  {
    name: "",
    sector: "Energy",
    industry: "Oil & Gas Exploration and Production",
    country: "US",
    website: "https://example.invalid",
    employees: 3_100,
    business: "Upstream oil and gas exploration and production assets.",
  },
  {
    name: "",
    sector: "Industrials",
    industry: "Specialty Machinery",
    country: "US",
    website: "https://example.invalid",
    employees: 12_400,
    business: "Engineered equipment for process and manufacturing industries.",
  },
  {
    name: "",
    sector: "Consumer Discretionary",
    industry: "Packaged Foods & Meats",
    country: "US",
    website: "https://example.invalid",
    employees: 21_800,
    business: "Branded packaged food products sold through retail channels.",
  },
  {
    name: "",
    sector: "Health Care",
    industry: "Biotechnology",
    country: "US",
    website: "https://example.invalid",
    employees: 1_850,
    business: "Clinical-stage biopharmaceutical development platform.",
  },
  {
    name: "",
    sector: "Financials",
    industry: "Regional Banks",
    country: "US",
    website: "https://example.invalid",
    employees: 2_600,
    business: "Deposit-taking and commercial lending franchise.",
  },
];

function tickerHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

const CURRENCY_SCALES: Record<string, number> = { USD: 1, INR: 85, GBp: 0.8, JPY: 150, EUR: 0.92 };

function scaleMoney(value: unknown, scale: number): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Number((value * scale).toPrecision(12));
}

function scaleStatement(items: Record<string, unknown>, scale: number): Record<string, unknown> {
  const scaled: Record<string, unknown> = {};
  Object.entries(items).forEach(([key, value]) => {
    scaled[key] = typeof value === "number" ? scaleMoney(value, scale) : value;
  });
  return scaled;
}

function mockTickerData(ticker: string) {
  const upper = ticker.toUpperCase();
  const listing = parseListing(upper);
  const identity = KNOWN_IDENTITIES[upper] || KNOWN_IDENTITIES[listing.baseTicker] || {
    ...SECTOR_WHEEL[tickerHash(upper) % SECTOR_WHEEL.length],
    name: `${listing.baseTicker} Corporation (Local Engine)`,
  };
  const currency = listing.currency;
  const scale = CURRENCY_SCALES[currency] || 1;
  const isSparse = upper === "GAPCO";

  const annualIncome = isSparse
    ? [
        { period_end: "2024-12-31", items: { revenue: 820_000_000, cost_of_revenue: 460_000_000, gross_profit: 360_000_000, operating_expense: 240_000_000, operating_income: 120_000_000, ebit: 120_000_000, ebitda: 150_000_000, pretax_income: 115_000_000, tax_expense: 24_000_000, net_income: 91_000_000, interest_expense: 8_000_000, diluted_eps: null, da: 30_000_000 } },
        { period_end: "2023-12-31", items: { revenue: 780_000_000, cost_of_revenue: 450_000_000, gross_profit: 330_000_000, operating_expense: 230_000_000, operating_income: 100_000_000, ebit: 100_000_000, ebitda: 126_000_000, pretax_income: 96_000_000, tax_expense: 20_000_000, net_income: 76_000_000, interest_expense: 8_000_000, diluted_eps: 1.81, da: 26_000_000 } },
      ]
    : [
        { period_end: "2025-12-31", items: { revenue: 6000_000_000, cost_of_revenue: 2200_000_000, gross_profit: 3800_000_000, operating_expense: 2000_000_000, operating_income: 1800_000_000, ebit: 1800_000_000, ebitda: 2200_000_000, pretax_income: 1750_000_000, tax_expense: 350_000_000, net_income: 1400_000_000, interest_expense: 50_000_000, diluted_eps: 9.33, da: 400_000_000 } },
        { period_end: "2024-12-31", items: { revenue: 5200_000_000, cost_of_revenue: 1950_000_000, gross_profit: 3250_000_000, operating_expense: 1750_000_000, operating_income: 1500_000_000, ebit: 1500_000_000, ebitda: 1850_000_000, pretax_income: 1460_000_000, tax_expense: 290_000_000, net_income: 1170_000_000, interest_expense: 40_000_000, diluted_eps: 7.80, da: 350_000_000 } },
        { period_end: "2023-12-31", items: { revenue: 4500_000_000, cost_of_revenue: 1700_000_000, gross_profit: 2800_000_000, operating_expense: 1500_000_000, operating_income: 1300_000_000, ebit: 1300_000_000, ebitda: 1600_000_000, pretax_income: 1260_000_000, tax_expense: 250_000_000, net_income: 1010_000_000, interest_expense: 40_000_000, diluted_eps: 6.73, da: 300_000_000 } },
        { period_end: "2022-12-31", items: { revenue: 3900_000_000, cost_of_revenue: 1500_000_000, gross_profit: 2400_000_000, operating_expense: 1300_000_000, operating_income: 1100_000_000, ebit: 1100_000_000, ebitda: 1350_000_000, pretax_income: 1060_000_000, tax_expense: 210_000_000, net_income: 850_000_000, interest_expense: 40_000_000, diluted_eps: 5.67, da: 250_000_000 } },
      ];
  const annualBalanceAll = [
    { period_end: "2025-12-31", items: { total_assets: 8500_000_000, current_assets: 3500_000_000, current_liabilities: 1800_000_000, cash: 1500_000_000, total_debt: 1200_000_000, equity: 5500_000_000, accounts_receivable: 900_000_000, inventory: 600_000_000, accounts_payable: 700_000_000, ppe_net: 4000_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
    { period_end: "2024-12-31", items: { total_assets: 7500_000_000, current_assets: 3000_000_000, current_liabilities: 1500_000_000, cash: 1200_000_000, total_debt: 1000_000_000, equity: 5000_000_000, accounts_receivable: 800_000_000, inventory: 550_000_000, accounts_payable: 600_000_000, ppe_net: 3500_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
    { period_end: "2023-12-31", items: { total_assets: 6800_000_000, current_assets: 2700_000_000, current_liabilities: 1350_000_000, cash: 1000_000_000, total_debt: 900_000_000, equity: 4550_000_000, accounts_receivable: 700_000_000, inventory: 500_000_000, accounts_payable: 550_000_000, ppe_net: 3100_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
    { period_end: "2022-12-31", items: { total_assets: 6000_000_000, current_assets: 2400_000_000, current_liabilities: 1200_000_000, cash: 850_000_000, total_debt: 900_000_000, equity: 3900_000_000, accounts_receivable: 620_000_000, inventory: 450_000_000, accounts_payable: 500_000_000, ppe_net: 2600_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
  ];
  // Sparse fixture: balance-sheet periods must align with the (short) income history.
  const sparseYears = new Set(annualIncome.map((row) => row.period_end));
  const annualBalance = isSparse ? annualBalanceAll.filter((row) => sparseYears.has(row.period_end)) : annualBalanceAll;
  const annualCashFlow = isSparse
    ? []
    : [
        { period_end: "2025-12-31", items: { operating_cash_flow: 1800_000_000, capex: -500_000_000, free_cash_flow: 1300_000_000, da_cf: 400_000_000, change_in_wc: -100_000_000 } },
        { period_end: "2024-12-31", items: { operating_cash_flow: 1500_000_000, capex: -400_000_000, free_cash_flow: 1100_000_000, da_cf: 350_000_000, change_in_wc: -80_000_000 } },
        { period_end: "2023-12-31", items: { operating_cash_flow: 1300_000_000, capex: -350_000_000, free_cash_flow: 950_000_000, da_cf: 300_000_000, change_in_wc: -70_000_000 } },
        { period_end: "2022-12-31", items: { operating_cash_flow: 1100_000_000, capex: -300_000_000, free_cash_flow: 800_000_000, da_cf: 250_000_000, change_in_wc: -60_000_000 } },
      ];

  const priceBase = isSparse ? 22.4 : 94.5;
  // Price-history ramp is built at ~94.5 scale; rescale it to the ticker's price base and currency.
  const priceFactor = (priceBase / 94.5) * scale;
  const sparseAlerts: any[] = isSparse
    ? [{ level: "warn", mode: "local", message: "Sparse fixture: two annual periods only; cash-flow statement and diluted EPS are unavailable and are reported as null." }]
    : [];

  return {
    ticker: upper,
    retrieved_at: new Date().toISOString(),
    is_synthetic: true,
    info: {
      longName: identity.name,
      shortName: listing.baseTicker,
      exchange: listing.exchange,
      currency,
      sector: identity.sector,
      industry: identity.industry,
      country: identity.country,
      website: identity.website,
      sharesOutstanding: 150_000_000,
      marketCap: scaleMoney(isSparse ? 3_360_000_000 : 12_500_000_000, scale),
      longBusinessSummary: `${identity.business} Every figure in this profile is generated deterministically in this browser for ${upper}.`,
      fullTimeEmployees: identity.employees,
    },
    annual: {
      income_statement: annualIncome.map((row) => ({ period_end: row.period_end, items: scaleStatement(row.items, scale) })),
      balance_sheet: annualBalance.map((row) => ({ period_end: row.period_end, items: scaleStatement(row.items, scale) })),
      cash_flow: annualCashFlow.map((row) => ({ period_end: row.period_end, items: scaleStatement(row.items, scale) })),
    },
    quarterly: {
      income_statement: [
        { period_end: "2025-03-31", items: { revenue: 1400_000_000, cost_of_revenue: 500_000_000, gross_profit: 900_000_000, operating_expense: 480_000_000, operating_income: 420_000_000, ebit: 420_000_000, ebitda: 520_000_000, pretax_income: 410_000_000, tax_expense: 80_000_000, net_income: 330_000_000, interest_expense: 10_000_000, diluted_eps: 2.20, da: 100_000_000 } },
        { period_end: "2025-06-30", items: { revenue: 1480_000_000, cost_of_revenue: 540_000_000, gross_profit: 940_000_000, operating_expense: 490_000_000, operating_income: 450_000_000, ebit: 450_000_000, ebitda: 550_000_000, pretax_income: 440_000_000, tax_expense: 90_000_000, net_income: 350_000_000, interest_expense: 10_000_000, diluted_eps: 2.33, da: 100_000_000 } },
        { period_end: "2025-09-30", items: { revenue: 1540_000_000, cost_of_revenue: 560_000_000, gross_profit: 980_000_000, operating_expense: 510_000_000, operating_income: 470_000_000, ebit: 470_000_000, ebitda: 570_000_000, pretax_income: 460_000_000, tax_expense: 90_000_000, net_income: 370_000_000, interest_expense: 10_000_000, diluted_eps: 2.47, da: 100_000_000 } },
        { period_end: "2025-12-31", items: { revenue: 1580_000_000, cost_of_revenue: 600_000_000, gross_profit: 980_000_000, operating_expense: 520_000_000, operating_income: 460_000_000, ebit: 460_000_000, ebitda: 560_000_000, pretax_income: 440_000_000, tax_expense: 90_000_000, net_income: 350_000_000, interest_expense: 20_000_000, diluted_eps: 2.33, da: 100_000_000 } },
      ].map((row) => ({ period_end: row.period_end, items: scaleStatement(row.items, scale) })),
      balance_sheet: [
        { period_end: "2025-03-31", items: { total_assets: 7750_000_000, current_assets: 3125_000_000, current_liabilities: 1575_000_000, cash: 1275_000_000, total_debt: 1050_000_000, equity: 5125_000_000, accounts_receivable: 825_000_000, inventory: 562_500_000, accounts_payable: 625_000_000, ppe_net: 3625_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2025-06-30", items: { total_assets: 8000_000_000, current_assets: 3250_000_000, current_liabilities: 1650_000_000, cash: 1350_000_000, total_debt: 1100_000_000, equity: 5250_000_000, accounts_receivable: 850_000_000, inventory: 575_000_000, accounts_payable: 650_000_000, ppe_net: 3750_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2025-09-30", items: { total_assets: 8250_000_000, current_assets: 3375_000_000, current_liabilities: 1725_000_000, cash: 1425_000_000, total_debt: 1150_000_000, equity: 5375_000_000, accounts_receivable: 875_000_000, inventory: 587_500_000, accounts_payable: 675_000_000, ppe_net: 3875_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
        { period_end: "2025-12-31", items: { total_assets: 8500_000_000, current_assets: 3500_000_000, current_liabilities: 1800_000_000, cash: 1500_000_000, total_debt: 1200_000_000, equity: 5500_000_000, accounts_receivable: 900_000_000, inventory: 600_000_000, accounts_payable: 700_000_000, ppe_net: 4000_000_000, goodwill: 1000_000_000, shares_issued: 150_000_000 } },
      ].map((row) => ({ period_end: row.period_end, items: scaleStatement(row.items, scale) })),
      cash_flow: isSparse
        ? []
        : [
            { period_end: "2025-03-31", items: { operating_cash_flow: 420_000_000, capex: -120_000_000, free_cash_flow: 300_000_000, da_cf: 100_000_000, change_in_wc: -20_000_000 } },
            { period_end: "2025-06-30", items: { operating_cash_flow: 440_000_000, capex: -120_000_000, free_cash_flow: 320_000_000, da_cf: 100_000_000, change_in_wc: -20_000_000 } },
            { period_end: "2025-09-30", items: { operating_cash_flow: 460_000_000, capex: -130_000_000, free_cash_flow: 330_000_000, da_cf: 100_000_000, change_in_wc: -30_000_000 } },
            { period_end: "2025-12-31", items: { operating_cash_flow: 480_000_000, capex: -130_000_000, free_cash_flow: 350_000_000, da_cf: 100_000_000, change_in_wc: -30_000_000 } },
          ].map((row) => ({ period_end: row.period_end, items: scaleStatement(row.items, scale) })),
    },
    price_history: Array.from({ length: 90 }, (_, i) => ({
      date: new Date(Date.now() - (89 - i) * 86400000).toISOString().split("T")[0],
      open: scaleMoney(80 + i * 0.15, priceFactor),
      high: scaleMoney(82 + i * 0.15, priceFactor),
      low: scaleMoney(79 + i * 0.15, priceFactor),
      close: scaleMoney(81 + i * 0.15, priceFactor),
      volume: 2_000_000,
    })),
    price_summary: {
      last_close: scaleMoney(priceBase, scale),
      last_date: new Date().toISOString().split("T")[0],
      previous_close: scaleMoney(isSparse ? 22.1 : 93.8, scale),
      change: scaleMoney(isSparse ? 0.3 : 0.7, scale),
      change_pct: isSparse ? 0.0136 : 0.0075,
      high_52w: isSparse ? null : scaleMoney(105, scale),
      low_52w: scaleMoney(isSparse ? 14.2 : 65, scale),
      avg_volume_3m: 2_100_000,
    },
    dividends: isSparse
      ? []
      : [
          { date: "2025-06-15", value: scaleMoney(0.5, scale) },
          { date: "2025-12-15", value: scaleMoney(0.55, scale) },
        ],
    splits: [],
    data_quality: {
      alerts: [
        { level: "info", mode: "local", message: `Local engine: deterministic ${currency} financial profile for ${upper} on ${listing.venueLabel}` },
        { level: "warn", mode: "local", message: "All figures are synthetic sample data, not company-reported financials." },
        ...sparseAlerts,
      ],
    },
  };
}

function syntheticFixture(ticker: string, error: string | null) {
  const fixture = mockTickerData(ticker);
  if (error) {
    fixture.data_quality.alerts.push({
      level: "warn",
      mode: "local",
      message: `Market-data provider fetch failed (${error}); this synthetic sample fixture was used instead. Figures are fabricated and are not for investment use.`,
    });
  }
  return fixture;
}

async function resolveFixture(
  tickerInput: string,
  force = false,
): Promise<{ fixture: any; origin: string; error: string | null }> {
  const ticker = String(tickerInput || "SAMPLE").trim().toUpperCase() || "SAMPLE";
  if (parseListing(ticker).isDemo) {
    return { fixture: mockTickerData(ticker), origin: "synthetic", error: null };
  }
  try {
    const { result, error } = await fetchTickerFixture(ticker, force);
    if (!result) return { fixture: syntheticFixture(ticker, error), origin: "synthetic", error };
    const alerts = [...(result.fixture.data_quality?.alerts || [])];
    if (error) {
      alerts.push({
        level: "warn",
        mode: "cache",
        message: `Provider refresh failed (${error}); showing provider data retrieved at ${result.fetchedAt}.`,
      });
    }
    return {
      fixture: { ...result.fixture, ticker, data_quality: { ...result.fixture.data_quality, alerts } },
      origin: result.origin,
      error,
    };
  } catch (fetchError) {
    const error = getErrorMessage(fetchError);
    return { fixture: syntheticFixture(ticker, error), origin: "synthetic", error };
  }
}

function companySummary(fixture: any) {
  const info = fixture?.info || {};
  const income = fixture?.annual?.income_statement || [];
  return {
    ticker: String(fixture?.ticker || "SAMPLE").toUpperCase(),
    name: info.longName,
    exchange: info.exchange,
    currency: info.currency,
    sector: info.sector,
    industry: info.industry,
    country: info.country,
    website: info.website,
    summary: info.longBusinessSummary,
    market_cap: info.marketCap,
    employees: info.fullTimeEmployees,
    last_data_date: income[0]?.period_end || null,
    price_summary: fixture?.price_summary,
    retrieved_at: fixture?.retrieved_at,
    demo: fixture?.is_synthetic !== false,
    provider: fixture?.provider || null,
    data_quality: fixture?.data_quality,
  };
}

export function buildMetrics(normalized: any) {
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

/**
 * Derive forecast drivers from reported history so the projection reflects the
 * company's own economics instead of generic engine defaults. Only drivers with
 * reported inputs are derived; every derived value records where it came from.
 */
function deriveAssumptions(fixture: any): { values: Record<string, number>; sources: Record<string, string> } {
  const values: Record<string, number> = {};
  const sources: Record<string, string> = {};
  const income: any[] = fixture?.annual?.income_statement || [];
  if (!income.length || !income[0].period_end) return { values, sources };
  const latestDate = String(income[0].period_end);
  const latest: any = income[0].items || {};
  const balance = (fixture?.annual?.balance_sheet || []).find((row: any) => String(row.period_end) === latestDate)?.items || null;
  const cashFlow = (fixture?.annual?.cash_flow || []).find((row: any) => String(row.period_end) === latestDate)?.items || null;
  const revenue = latest.revenue;
  if (!isFiniteNumber(revenue) || revenue <= 0) return { values, sources };
  const ratio = (num: unknown, den: unknown): number | null =>
    isFiniteNumber(num) && isFiniteNumber(den) && den !== 0 ? num / den : null;
  const set = (key: string, value: number, note: string) => {
    values[key] = value;
    sources[key] = note;
  };
  const ended = `reported period ended ${latestDate}`;

  const dated = income.filter((row: any) => row.period_end && isFiniteNumber(row.items?.revenue) && row.items.revenue > 0);
  if (dated.length >= 2) {
    const firstYear = Number(String(dated[dated.length - 1].period_end).slice(0, 4));
    const lastYear = Number(String(dated[0].period_end).slice(0, 4));
    const span = lastYear - firstYear;
    if (span >= 1) {
      const cagr = Math.pow(dated[0].items.revenue / dated[dated.length - 1].items.revenue, 1 / span) - 1;
      if (isFiniteNumber(cagr)) {
        set("revenue_growth", Math.min(0.5, Math.max(-0.5, cagr)), `Derived from reported revenue CAGR over ${span} year(s) ending ${String(dated[0].period_end).slice(0, 10)}`);
      }
    }
  }

  const opexRatio = ratio(latest.operating_expense, revenue);
  const oiRatio = ratio(latest.operating_income, revenue) ?? ratio(latest.ebit, revenue);
  const gmActual = ratio(latest.gross_profit, revenue);
  let grossMargin = gmActual;
  let opex = opexRatio;
  if (grossMargin === null && opex !== null && oiRatio !== null) grossMargin = opex + oiRatio;
  if (opex === null && grossMargin !== null && oiRatio !== null) opex = grossMargin - oiRatio;
  if (grossMargin !== null && opex !== null) {
    set("gross_margin", Math.min(1, Math.max(0, grossMargin)), `Derived from reported gross profit / revenue, ${ended}`);
    set("opex_ratio", Math.min(1, Math.max(0, opex)), `Derived from reported operating expense / revenue, ${ended}`);
  }

  let taxRate = ratio(latest.tax_expense, latest.pretax_income);
  let taxNote = `Derived from reported tax expense / pre-tax income, ${ended}`;
  if (taxRate === null && isFiniteNumber(latest.pretax_income) && latest.pretax_income > 0 && isFiniteNumber(latest.net_income) && latest.net_income >= 0) {
    taxRate = 1 - latest.net_income / latest.pretax_income;
    taxNote = `Derived as 1 - net income / pre-tax income, ${ended}`;
  }
  if (taxRate !== null && taxRate >= 0) {
    set("tax_rate", Math.min(0.6, taxRate), taxNote);
  }

  const da = isFiniteNumber(latest.da) ? latest.da : cashFlow?.da_cf;
  const daRatio = ratio(da, revenue);
  if (daRatio !== null && daRatio >= 0) {
    set("da_pct", Math.min(0.3, daRatio), `Derived from reported depreciation & amortization / revenue, ${ended}`);
  }

  const capexRatio = cashFlow ? ratio(cashFlow.capex, revenue) : null;
  if (capexRatio !== null) {
    set("capex_pct", Math.min(0.6, Math.max(0, -capexRatio)), `Derived from reported capex / revenue, ${ended}`);
  }

  const interestRatio = balance && isFiniteNumber(balance.total_debt) && balance.total_debt > 0
    ? ratio(latest.interest_expense, balance.total_debt)
    : null;
  if (interestRatio !== null && interestRatio >= 0) {
    set("interest_rate", Math.min(0.4, interestRatio), `Derived from reported interest expense / total debt, ${ended}`);
  }

  const nwcRatio = balance
    ? ratio(
        (balance.current_assets ?? 0) - (balance.cash ?? 0) - (balance.current_liabilities ?? 0),
        revenue,
      )
    : null;
  if (nwcRatio !== null) {
    set("nwc_pct", Math.min(0.33, Math.max(-0.5, nwcRatio)), `Derived from reported (current assets - cash - current liabilities) / revenue, ${ended}`);
  }

  const shareRows = (fixture?.annual?.balance_sheet || [])
    .filter((row: any) => isFiniteNumber(row.items?.shares_issued) && row.items.shares_issued > 0)
    .slice(0, 8);
  if (shareRows.length >= 2) {
    const span = Number(String(shareRows[0].period_end).slice(0, 4)) - Number(String(shareRows[shareRows.length - 1].period_end).slice(0, 4));
    if (span >= 1) {
      const cagr = Math.pow(shareRows[0].items.shares_issued / shareRows[shareRows.length - 1].items.shares_issued, 1 / span) - 1;
      if (isFiniteNumber(cagr)) {
        set("share_dilution", Math.min(0.1, Math.max(0, cagr)), `Derived from reported share count CAGR over ${span} year(s) (buybacks floor at 0)`);
      }
    }
  }

  return { values, sources };
}

function resolveAssumptions(input: any, derived: Record<string, number> = {}): Record<string, number> {
  const resolved: Record<string, number> = { ...DEFAULT_ASSUMPTIONS, ...derived };
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

export function buildForecast(ticker: string, yearsInput: unknown, assumptionsInput: any, fixtureInput?: any) {
  const fixture = fixtureInput || mockTickerData(ticker);
  const years = Math.max(1, Math.min(25, Math.round(numberOr(yearsInput, 5))));
  const derived = deriveAssumptions(fixture);
  const a = resolveAssumptions(assumptionsInput, derived.values);
  const assumptionSources: Record<string, string> = {};
  Object.keys(DEFAULT_ASSUMPTIONS).forEach((key) => {
    const raw = assumptionsInput?.[key];
    if (raw !== "" && raw !== null && raw !== undefined && Number.isFinite(Number(raw))) {
      assumptionSources[key] = "User input (documented assumption)";
    } else if (derived.sources[key]) {
      assumptionSources[key] = derived.sources[key];
    } else {
      assumptionSources[key] = "Engine default (documented assumption)";
    }
  });
  const baseIncome: any = fixture?.annual?.income_statement?.[0]?.items;
  const baseBalance: any = fixture?.annual?.balance_sheet?.[0]?.items;
  const emptySummary = { base_revenue: null, final_revenue: null, revenue_cagr: null, final_ebitda: null, final_fcf: null, balance_ok: true, max_balance_check: 0, base_balance_residual: 0, years: 0 };
  if (!isFiniteNumber(baseIncome?.revenue) || !baseBalance) {
    return {
      ticker: fixture?.ticker || ticker,
      error: "Base-period income statement or balance sheet is unavailable; no forecast was built.",
      base_gaps: ["Base-period statements unavailable; forecast drivers could not be derived and were not estimated."],
      assumptions: a,
      assumption_sources: assumptionSources,
      forecast_years: [] as number[],
      periods: [] as any[],
      summary: emptySummary,
      valuation: { dcf_value_per_share: null },
    };
  }

  const base_gaps: string[] = [];
  const valueDriver = (value: unknown, name: string, fallback: number): number => {
    if (isFiniteNumber(value)) return value;
    base_gaps.push(`${name} is unavailable in the base period; engine default ${fallback} applied.`);
    return fallback;
  };
  const ratioDriver = (value: unknown, name: string): number => {
    if (isFiniteNumber(value)) return baseIncome.revenue ? value / baseIncome.revenue : 0;
    base_gaps.push(`${name} is unavailable in the base period; the forecast driver defaults to 0.`);
    return 0;
  };

  const revenue = baseIncome.revenue;
  const cashBase = valueDriver(baseBalance.cash, "Cash", 0);
  const currentAssetsBase = valueDriver(baseBalance.current_assets, "Current assets", 0);
  const currentLiabilitiesBase = valueDriver(baseBalance.current_liabilities, "Current liabilities", 0);
  const totalAssetsBase = valueDriver(baseBalance.total_assets, "Total assets", 0);
  const nonCashCurrentRatio = revenue ? Math.max(0, currentAssetsBase - cashBase) / revenue : 0;
  const arRatio = ratioDriver(baseBalance.accounts_receivable, "Accounts receivable");
  const invRatio = ratioDriver(baseBalance.inventory, "Inventory");
  const apRatio = ratioDriver(baseBalance.accounts_payable, "Accounts payable");
  const clRatio = Math.max(0, nonCashCurrentRatio - a.nwc_pct);
  const startYear = Number(fixture.annual.income_statement[0].period_end.slice(0, 4)) + 1;

  let cash = cashBase;
  let debt = valueDriver(baseBalance.total_debt, "Total debt", 0);
  let equity = valueDriver(baseBalance.equity, "Equity", 0);
  let ppe = valueDriver(baseBalance.ppe_net, "PP&E", Math.max(0, totalAssetsBase - currentAssetsBase));
  let shares = valueDriver(
    baseBalance.shares_issued,
    "Shares issued",
    numberOr(fixture?.info?.sharesOutstanding, 0) || 0,
  );
  const goodwill = isFiniteNumber(baseBalance.goodwill)
    ? baseBalance.goodwill
    : (base_gaps.push("Goodwill is unavailable in the base period; it is treated as 0 in the projected balance check."), 0);
  const baseResidual = totalAssetsBase - currentLiabilitiesBase - debt - equity;
  if (Math.abs(baseResidual) > 1) {
    base_gaps.push(
      `Base balance sheet residual of ${Number(baseResidual.toPrecision(6))} covers balances the engine does not model ` +
        `(non-current liabilities beyond debt); the projection preserves this residual and reports drift against it.`,
    );
  }
  let previousRevenue = revenue;
  let previousWorkingCapital = currentAssetsBase - cashBase - currentLiabilitiesBase;

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
    const residual = totalAssets - totalLiabilities - equity;
    const balanceCheck = residual - baseResidual;

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
      balance_residual: residual,
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
    assumption_sources: assumptionSources,
    base_gaps,
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
      base_balance_residual: baseResidual,
      years: periods.length,
    },
    valuation: { dcf_value_per_share: null },
  };
}

export function dcfCompute(payload: any, waccOverride?: number) {
  const flows: number[] = Array.isArray(payload?.fcf)
    ? payload.fcf.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
    : [];
  if (!flows.length) return { error: "Run a forecast first to generate cash flows." };

  const warnings: string[] = [];
  const rawDiscount = isFiniteNumber(waccOverride) ? waccOverride : numberOr(payload?.wacc, 0.1);
  if (!Number.isFinite(rawDiscount) || rawDiscount <= 0) {
    warnings.push("Discount rate is non-positive or invalid; the engine default of 10% was applied.");
  }
  const wacc = rawDiscount > 0 ? rawDiscount : 0.1;
  const netDebt = numberOr(payload?.net_debt, 0);
  const rawShares = numberOr(payload?.shares, 0);
  if (!rawShares || rawShares <= 0) warnings.push("Shares outstanding are missing or non-positive; per-share values use 1 share.");
  const shares = rawShares > 0 ? rawShares : 1;
  const useExitMultiple =
    payload?.exit_multiple !== undefined && payload?.exit_multiple !== null && Number.isFinite(Number(payload.exit_multiple));

  let terminalGrowth: number | undefined;
  let terminalValue: number;
  let terminalGrowthClamped = false;
  if (useExitMultiple) {
    terminalValue = Number(payload.exit_multiple) * numberOr(payload?.final_ebitda, 0);
    if (!Number.isFinite(terminalValue)) terminalValue = 0;
  } else {
    let growth = numberOr(payload?.terminal_growth, 0.025);
    if (growth >= wacc) {
      growth = Math.max(0, wacc - 0.005);
      terminalGrowthClamped = true;
      warnings.push("Terminal growth must stay below the discount rate; it was clamped for this calculation.");
    } else if (growth < 0) {
      growth = 0;
      warnings.push("Terminal growth was negative; floored at zero.");
    }
    if (growth >= wacc - 0.0005 && !terminalGrowthClamped) {
      growth = Math.max(0, wacc - 0.005);
      terminalGrowthClamped = true;
      warnings.push("Terminal growth has to stay below the discount rate; it was clamped for this calculation.");
    }
    terminalGrowth = growth;
    const denom = wacc - growth;
    terminalValue = denom > 0 ? (flows[flows.length - 1] * (1 + growth)) / denom : 0;
    if (denom <= 0) warnings.push("Terminal-value denominator is non-positive; terminal value omitted.");
  }

  const pvCashFlows = flows.reduce((total, flow, index) => total + flow / Math.pow(1 + wacc, index + 1), 0);
  const pvTerminalValue = terminalValue / Math.pow(1 + wacc, flows.length);
  const enterpriseValue = pvCashFlows + pvTerminalValue;
  const equityValue = enterpriseValue - netDebt;
  const valuePerShare = shares > 0 ? equityValue / shares : null;
  const terminalShare = enterpriseValue !== 0 ? pvTerminalValue / enterpriseValue : null;
  if (terminalShare !== null && Math.abs(terminalShare) > 0.75) {
    warnings.push("Terminal value contributes more than 75% of enterprise value; the valuation is sensitive to long-run assumptions.");
  }

  return {
    wacc,
    terminal_growth: terminalGrowth,
    exit_multiple: useExitMultiple ? Number(payload.exit_multiple) : undefined,
    enterprise_value: enterpriseValue,
    equity_value: equityValue,
    value_per_share: valuePerShare,
    pv_cash_flows: pvCashFlows,
    pv_terminal_value: pvTerminalValue,
    net_debt: netDebt,
    shares,
    cash_flow_count: flows.length,
    terminal_value_share_of_ev: terminalShare,
    terminal_value_share: terminalShare,
    tv_share_of_ev: terminalShare,
    warnings,
  };
}

export function reverseDcfCompute(payload: any) {
  const price = numberOr(payload?.current_price, NaN);
  if (!Number.isFinite(price) || price <= 0) return { error: "A current market price is required for reverse DCF." };

  const tolerance = 1e-6;
  const terminalGrowth = numberOr(payload?.terminal_growth, 0.025);
  let low = 0.0001;
  let high = 2.0;
  const valueAt = (wacc: number) => {
    const result = dcfCompute(payload, wacc);
    return "error" in result ? NaN : (result as any).value_per_share;
  };
  let sawValidFlow = false;
  const lowValue = valueAt(low);
  const highValue = valueAt(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) {
    return { error: "Cannot imply a WACC without valid forecast cash flows." };
  }
  if (lowValue < price) {
    return { error: "Implied WACC is below the searchable lower bound; the market price is above the model's maximum value." };
  }
  if (highValue > price) {
    return { error: "Implied WACC is above the searchable upper bound; the market price is below the model's minimum value." };
  }

  let iterations = 0;
  for (iterations = 0; iterations < 120; iterations += 1) {
    const midpoint = (low + high) / 2;
    const value = valueAt(midpoint);
    if (!Number.isFinite(value)) break;
    sawValidFlow = true;
    if (value > price) low = midpoint;
    else high = midpoint;
    if (high - low < 1e-12) break;
  }

  if (!sawValidFlow) return { error: "Cannot imply a WACC without valid forecast cash flows." };

  const impliedWacc = (low + high) / 2;
  const reproduced = dcfCompute(payload, impliedWacc);
  const reproducedValue = "error" in reproduced ? NaN : (reproduced as any).value_per_share;
  const residual = Number.isFinite(reproducedValue) ? reproducedValue - price : NaN;
  const converged = Number.isFinite(residual) && Math.abs(residual) <= Math.max(tolerance, tolerance * Math.abs(price));
  const roundTripOk = converged;

  return {
    implied_wacc: impliedWacc,
    impliedWacc,
    current_price: price,
    currentPrice: price,
    terminal_growth: terminalGrowth,
    terminalGrowth,
    cash_flow_count: Array.isArray(payload?.fcf) ? payload.fcf.length : 0,
    iterations,
    tolerance,
    reproduced_value_per_share: reproducedValue,
    reproduced_value: reproducedValue,
    reproduced: converged,
    converged,
    round_trip_ok: roundTripOk,
    residual,
    residual_price: residual,
  };
}

export function sensitivityCompute(payload: any) {
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

function bankModelCompute(body: any) {
  const assets = numberOr(body?.total_assets, 0);
  const loans = numberOr(body?.advances, numberOr(body?.loans, 0));
  const deposits = numberOr(body?.deposits, 0);
  const equity = numberOr(body?.equity, 0);
  const nii = numberOr(body?.net_interest_income, 0);
  const nim = assets ? nii / assets : null;
  const creditCost = numberOr(body?.credit_cost, 0);
  const gnpa = isFiniteNumber(body?.gnpa) ? body.gnpa : null;
  const nnpa = isFiniteNumber(body?.nnpa) ? body.nnpa : null;
  const car = isFiniteNumber(body?.capital_adequacy) ? body.capital_adequacy : null;
  const roe = equity ? numberOr(body?.net_income, 0) / equity : null;
  return {
    model: "bank",
    net_interest_margin: nim,
    loan_to_deposit: deposits ? loans / deposits : null,
    credit_cost: creditCost,
    gnpa,
    nnpa,
    capital_adequacy: car,
    roe,
    missing: [
      !body?.net_interest_income && "net_interest_income",
      !body?.deposits && "deposits",
      !body?.advances && "advances",
      gnpa === null && "gnpa",
      car === null && "capital_adequacy",
    ].filter(Boolean),
  };
}

function insurerModelCompute(body: any) {
  const premiums = numberOr(body?.premiums, 0);
  const claims = numberOr(body?.claims, 0);
  const combinedRatio = premiums ? (claims + numberOr(body?.expenses, 0)) / premiums : null;
  const investmentIncome = numberOr(body?.investment_income, 0);
  const solvency = isFiniteNumber(body?.solvency_ratio) ? body.solvency_ratio : null;
  return {
    model: "insurer",
    combined_ratio: combinedRatio,
    loss_ratio: premiums ? claims / premiums : null,
    investment_income: investmentIncome,
    solvency_ratio: solvency,
    missing: [
      !body?.premiums && "premiums",
      !body?.claims && "claims",
      solvency === null && "solvency_ratio",
    ].filter(Boolean),
  };
}

function reitModelCompute(body: any) {
  const noi = numberOr(body?.noi, numberOr(body?.net_operating_income, 0));
  const ffo = numberOr(body?.ffo, 0);
  const affo = numberOr(body?.affo, 0);
  const nav = numberOr(body?.nav, 0);
  const occupancy = isFiniteNumber(body?.occupancy) ? body.occupancy : null;
  const distribution = numberOr(body?.distribution, 0);
  return {
    model: "reit",
    noi,
    ffo,
    affo,
    nav,
    occupancy,
    ffo_yield: nav ? ffo / nav : null,
    affo_payout: affo ? distribution / affo : null,
    missing: [
      !body?.noi && !body?.net_operating_income && "noi",
      !body?.ffo && "ffo",
      !body?.nav && "nav",
      occupancy === null && "occupancy",
    ].filter(Boolean),
  };
}

function commodityModelCompute(body: any) {
  const volume = numberOr(body?.production_volume, 0);
  const realizedPrice = numberOr(body?.realized_price, 0);
  const revenue = volume * realizedPrice;
  const unitCost = numberOr(body?.unit_cost, 0);
  const ebitda = revenue - volume * unitCost;
  return {
    model: "commodity",
    production_volume: volume,
    realized_price: realizedPrice,
    implied_revenue: revenue,
    unit_cost: unitCost,
    implied_ebitda: ebitda,
    ebitda_margin: revenue ? ebitda / revenue : null,
    missing: [
      !body?.production_volume && "production_volume",
      !body?.realized_price && "realized_price",
      !body?.unit_cost && "unit_cost",
    ].filter(Boolean),
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
  const fees = purchasePrice * feesPct;
  const totalSources = purchasePrice + fees;

  const sponsorEquityPct = Math.min(0.99, Math.max(0.01, numberOr(body?.sponsor_equity_pct, 0.4)));
  const debtPct = 1 - sponsorEquityPct;
  const rawTranches = Array.isArray(body?.tranches) ? body.tranches : null;
  const tranches = rawTranches && rawTranches.length
    ? rawTranches.map((t: any, i: number) => ({
        name: String(t?.name || "Tranche " + (i + 1)),
        rate: Math.max(0, numberOr(t?.rate, 0.07)),
        share: Math.max(0, numberOr(t?.share, 0)),
        amortization: Math.min(1, Math.max(0, numberOr(t?.amortization, 0))),
      }))
    : [{ name: "Senior debt", rate: Math.max(0, numberOr(body?.interest_rate, 0.07)), share: 1, amortization: 0 }];
  const shareSum = tranches.reduce((s: number, t: any) => s + t.share, 0) || 1;
  tranches.forEach((t: any) => { t.share = t.share / shareSum; });
  const debt = totalSources * debtPct;
  tranches.forEach((t: any) => { t.principal = debt * t.share; });
  const equity = totalSources - debt;

  const balances = tranches.map((t: any) => t.principal);
  let debtBalance = balances.reduce((s: number, v: number) => s + v, 0);
  const schedule: any[] = [];
  for (let year = 1; year <= holdYears; year += 1) {
    const ebitda = entryEbitda * Math.pow(1 + growth, year);
    const nopat = ebitda * (1 - taxRate);
    const trancheInterest = tranches.map((t: any, i: number) => balances[i] * t.rate);
    const interest = trancheInterest.reduce((s: number, v: number) => s + v, 0);
    const cashAvailable = nopat - interest;
    const sweepPool = Math.max(0, cashAvailable) * sweepShare;
    const mandatory = tranches.map((t: any, i: number) => Math.min(balances[i], balances[i] * t.amortization));
    mandatory.forEach((m: number, i: number) => { balances[i] -= m; });
    let sweepRemaining = sweepPool;
    const sweepPaid = balances.map(() => 0);
    for (let i = 0; i < tranches.length && sweepRemaining > 0; i += 1) {
      const pay = Math.min(balances[i], sweepRemaining);
      balances[i] -= pay;
      sweepPaid[i] = pay;
      sweepRemaining -= pay;
    }
    const totalPaydown = mandatory.reduce((s: number, v: number) => s + v, 0) + sweepPaid.reduce((s: number, v: number) => s + v, 0);
    debtBalance = balances.reduce((s: number, v: number) => s + v, 0);
    schedule.push({
      year,
      ebitda,
      nopat,
      interest,
      tranche_interest: trancheInterest,
      cash_available: cashAvailable,
      mandatory_amortization: mandatory,
      sweep_paydown: sweepPaid,
      debt_paydown: totalPaydown,
      debt_balance: debtBalance,
      tranche_balances: balances.slice(),
    });
  }

  const exitEbitda = entryEbitda * Math.pow(1 + growth, holdYears);
  const exitValue = exitEbitda * exitMultiple;
  const exitFees = exitValue * 0.01;
  const remainingDebt = balances.reduce((s: number, v: number) => s + v, 0);
  const netExitProceeds = exitValue - exitFees - remainingDebt;
  const moic = equity > 0 ? netExitProceeds / equity : 0;
  const irr = moic > 0 ? Math.pow(moic, 1 / holdYears) - 1 : -1;

  return {
    hold_years: holdYears,
    sponsor_equity_pct: sponsorEquityPct,
    debt_pct: debtPct,
    purchase_price: purchasePrice,
    fees,
    total_sources: totalSources,
    debt,
    equity,
    tranches: tranches.map((t: any, i: number) => ({ name: t.name, rate: t.rate, share: t.share, principal: t.principal, final_balance: balances[i] })),
    schedule,
    exit_value: exitValue,
    exit_fees: exitFees,
    remaining_debt: remainingDebt,
    net_exit_proceeds: netExitProceeds,
    moic,
    irr,
  };
}

export function waccCompute(body: any) {
  const riskFree = numberOr(body?.risk_free, 0.04);
  const beta = numberOr(body?.beta, 1);
  const marketPremium = numberOr(body?.market_premium, 0.055);
  const costOfDebt = numberOr(body?.cost_of_debt, 0.06);
  const taxRate = Math.min(0.9, Math.max(0, numberOr(body?.tax_rate, 0.25)));
  let equityWeight = numberOr(body?.equity_weight, 0.7);
  let debtWeight = numberOr(body?.debt_weight, 0.3);
  const totalWeight = equityWeight + debtWeight;
  let normalized = false;
  if (totalWeight > 0 && Math.abs(totalWeight - 1) > 1e-9) {
    equityWeight = equityWeight / totalWeight;
    debtWeight = debtWeight / totalWeight;
    normalized = true;
  }
  if (equityWeight < 0) equityWeight = 0;
  if (debtWeight < 0) debtWeight = 0;
  const sum = equityWeight + debtWeight;
  if (sum <= 0) {
    equityWeight = 0.7;
    debtWeight = 0.3;
  }
  const costOfEquity = riskFree + beta * marketPremium;
  const afterTaxCostOfDebt = costOfDebt * (1 - taxRate);
  return {
    wacc: equityWeight * costOfEquity + debtWeight * afterTaxCostOfDebt,
    cost_of_equity: costOfEquity,
    after_tax_cost_of_debt: afterTaxCostOfDebt,
    equity_weight: equityWeight,
    debt_weight: debtWeight,
    weights_normalized: normalized,
  };
}

async function mockAiResearch(body: any, fixtureInput?: any, origin = "synthetic") {
  const inputs = reportInputs({ ...body, years: numberOr(body?.years, 5) });
  const artifacts = await reportArtifacts(inputs, fixtureInput, origin);
  // Flatten structured risks/catalysts to strings for the legacy company-page UI.
  const narrative = artifacts.narrative;
  const flatReport = {
    ...narrative,
    risks: (narrative.risks || []).map((r: any) =>
      typeof r === "string" ? r : `${r.title}: ${r.exposure}${r.monitoring_metric ? ` Monitoring: ${r.monitoring_metric}.` : ""}`,
    ),
    catalysts: (narrative.catalysts || []).map((c: any) =>
      typeof c === "string" ? c : `${c.title}: ${c.event} (${c.timing})`,
    ),
    rating: artifacts.rating,
  };
  return { report: flatReport, payload: artifacts.forecast };
}

// --- RESEARCH REPORT PIPELINE (local) ---

const REPORT_STORE_KEY = "apex_reports";
const REPORT_WACC = 0.085;
const ENGINE_VERSION = "2.0.0";
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
    ticker: String(body?.ticker || "SAMPLE").trim().toUpperCase() || "SAMPLE",
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

function buildScenarios(ticker: string, inputs: any, fixture: any, price: number) {
  const baseAssumptions = resolveAssumptions({}, deriveAssumptions(fixture).values);
  const scenarios: Record<string, any> = {};
  const definitions: { key: string; label: string; adjust: (a: Record<string, number>) => Record<string, number> }[] = [
    {
      key: "bull",
      label: "Bull",
      adjust: (a) => ({
        ...a,
        revenue_growth: Math.min(0.5, a.revenue_growth + 0.05),
        gross_margin: Math.min(0.95, a.gross_margin + 0.03),
        opex_ratio: Math.max(0.05, a.opex_ratio - 0.02),
        capex_pct: Math.max(0, a.capex_pct - 0.01),
        tax_rate: Math.max(0, a.tax_rate - 0.02),
      }),
    },
    {
      key: "base",
      label: "Base",
      adjust: (a) => ({ ...a }),
    },
    {
      key: "bear",
      label: "Bear",
      adjust: (a) => ({
        ...a,
        revenue_growth: Math.max(-0.5, a.revenue_growth - 0.05),
        gross_margin: Math.max(0.1, a.gross_margin - 0.03),
        opex_ratio: Math.min(0.9, a.opex_ratio + 0.02),
        capex_pct: Math.min(0.6, a.capex_pct + 0.01),
        tax_rate: Math.min(0.6, a.tax_rate + 0.02),
      }),
    },
  ];

  for (const def of definitions) {
    const adjusted = def.adjust({ ...baseAssumptions });
    const forecast = buildForecast(ticker, inputs.years, adjusted, fixture);
    const flows: number[] = (forecast.periods || []).map((p: any) => p.fcf);
    const actuals = buildMetrics(fixture)[0] || null;
    const netDebt = isFiniteNumber(actuals?.net_debt) ? actuals.net_debt : 0;
    const shares = numberOr(fixture?.info?.sharesOutstanding, 0) || forecast.periods?.[0]?.shares || 1;
    const dcfBody: any = {
      fcf: flows,
      wacc: inputs.wacc,
      net_debt: netDebt,
      shares,
      final_ebitda: forecast.summary?.final_ebitda,
    };
    if (inputs.terminal_mode === "multiple") dcfBody.exit_multiple = inputs.exit_multiple;
    else dcfBody.terminal_growth = inputs.terminal_growth;
    const dcf = flows.length ? dcfCompute(dcfBody) : { error: "No cash flows" };
    scenarios[def.key] = {
      label: def.label,
      assumptions: adjusted,
      forecast_summary: forecast.summary || null,
      dcf_value_per_share: dcf?.error ? null : dcf.value_per_share,
      enterprise_value: dcf?.error ? null : dcf.enterprise_value,
      rating: null,
    };
  }
  return scenarios;
}

async function peerCompsCompute(ticker: string, peers: string[], targetPrice: number | null) {
  const safePeers = Array.isArray(peers) ? peers.slice(0, 12) : [];
  const rows: any[] = [];
  const targetFixtureResolved = await resolveFixture(ticker, false).catch(() => null);
  const targetMetrics = targetFixtureResolved ? buildMetrics(targetFixtureResolved.fixture)[0] : null;
  const targetInfo = targetFixtureResolved?.fixture?.info || {};
  const targetMarketCap = targetInfo.marketCap || (targetInfo.sharesOutstanding && targetFixtureResolved?.fixture?.price_summary?.last_close
    ? targetInfo.sharesOutstanding * targetFixtureResolved.fixture.price_summary.last_close
    : null);

  for (const peer of safePeers) {
    try {
      const resolved = await resolveFixture(peer, false);
      const fixture = resolved.fixture;
      const m: any = buildMetrics(fixture)[0] || {};
      const info = fixture.info || {};
      const price = fixture.price_summary?.last_close;
      const shares = numberOr(info.sharesOutstanding, 0);
      const marketCap = numberOr(info.marketCap, shares && price ? shares * price : NaN);
      const netDebt = numberOr(m?.net_debt, 0);
      const ev = Number.isFinite(marketCap) ? marketCap + netDebt : marketCap;
      rows.push({
        ticker: peer,
        name: info.longName || info.shortName || peer,
        currency: fixture.info?.currency || parseListing(peer).currency,
        price: Number.isFinite(price) ? price : null,
        market_cap: Number.isFinite(marketCap) ? marketCap : null,
        pe: Number.isFinite(marketCap) && Number.isFinite(m?.net_income) && m.net_income !== 0 ? marketCap / m.net_income : null,
        ev_ebitda: Number.isFinite(ev) && Number.isFinite(m?.ebitda) && m.ebitda !== 0 ? ev / m.ebitda : null,
        pb: Number.isFinite(price) && Number.isFinite(m?.book_value_per_share) && (m.book_value_per_share as number) !== 0 ? price / (m.book_value_per_share as number) : null,
        ev_sales: Number.isFinite(ev) && Number.isFinite(m?.revenue) && m.revenue !== 0 ? ev / m.revenue : null,
        revenue: Number.isFinite(m?.revenue) ? m.revenue : null,
        net_margin: Number.isFinite(m?.net_margin) ? m.net_margin : null,
      });
    } catch {
      rows.push({ ticker: peer, error: "peer data unavailable" });
    }
  }

  const numeric = (key: string) => rows.map((r) => r[key]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const median = (arr: number[]) => (arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : null);
  const medians = {
    pe: median(numeric("pe")),
    ev_ebitda: median(numeric("ev_ebitda")),
    pb: median(numeric("pb")),
    ev_sales: median(numeric("ev_sales")),
  };

  const targetMultiples = targetMetrics ? {
    pe: targetMarketCap && targetMetrics.net_income ? targetMarketCap / targetMetrics.net_income : null,
    ev_ebitda: targetMarketCap && targetMetrics.net_debt !== null && targetMetrics.ebitda ? (targetMarketCap + targetMetrics.net_debt) / targetMetrics.ebitda : null,
    pb: targetPrice && targetMetrics.book_value_per_share ? targetPrice / targetMetrics.book_value_per_share : null,
    ev_sales: targetMarketCap && targetMetrics.net_debt !== null && targetMetrics.revenue ? (targetMarketCap + targetMetrics.net_debt) / targetMetrics.revenue : null,
  } : null;

  return {
    target: { ticker, price: targetPrice, market_cap: targetMarketCap, multiples: targetMultiples },
    peers: rows,
    peer_count: rows.filter((r) => !r.error).length,
    medians,
    premium_discount_vs_median_pe: targetMultiples?.pe && medians.pe ? targetMultiples.pe / medians.pe - 1 : null,
  };
}

function monteCarloCompute(baseInputs: any, fixture: any, iterations = 500) {
  const derived = deriveAssumptions(fixture);
  const base = resolveAssumptions(baseInputs?.assumptions || {}, derived.values);
  const flows: number[] = [];
  const values: number[] = [];
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const normal = () => {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let i = 0; i < iterations; i += 1) {
    const a = { ...base };
    a.revenue_growth = Math.min(0.5, Math.max(-0.5, base.revenue_growth + normal() * 0.05));
    a.gross_margin = Math.min(0.95, Math.max(0.1, base.gross_margin + normal() * 0.03));
    a.wacc = Math.min(0.3, Math.max(0.05, (baseInputs?.wacc || 0.085) + normal() * 0.015));
    const terminalGrowth = Math.min(a.wacc - 0.005, Math.max(0, (baseInputs?.terminal_growth || 0.025) + normal() * 0.005));
    const forecast = buildForecast(baseInputs?.ticker || "X", baseInputs?.years || 5, a, fixture);
    const f = (forecast.periods || []).map((p: any) => p.fcf);
    if (!f.length) continue;
    const actuals = buildMetrics(fixture)[0] || null;
    const netDebt = Number.isFinite(actuals?.net_debt) ? actuals.net_debt : 0;
    const shares = numberOr(fixture?.info?.sharesOutstanding, 0) || forecast.periods?.[0]?.shares || 1;
    const dcf = dcfCompute({ fcf: f, wacc: a.wacc, net_debt: netDebt, shares, terminal_growth: terminalGrowth, final_ebitda: forecast.summary?.final_ebitda });
    if (dcf?.error || !Number.isFinite(dcf?.value_per_share)) continue;
    values.push(dcf.value_per_share as number);
  }
  values.sort((x, y) => x - y);
  const pct = (q: number) => values.length ? values[Math.min(values.length - 1, Math.floor(q * (values.length - 1)))] : null;
  return {
    iterations: values.length,
    requested: iterations,
    percentiles: {
      p5: pct(0.05),
      p25: pct(0.25),
      p50: pct(0.5),
      p75: pct(0.75),
      p95: pct(0.95),
    },
    mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    min: values.length ? values[0] : null,
    max: values.length ? values[values.length - 1] : null,
  };
}

function buildSectorModel(company: any, normalized: any, sector: any) {
  const key = sector?.key || "generic";
  const info = normalized?.info || {};
  const metrics: any = buildMetrics(normalized)[0] || {};
  const required = sector?.requiredInputs || [];
  const available: string[] = [];
  const missing: string[] = [];
  const baseChecks: Record<string, boolean> = {
    "Revenue": Number.isFinite(metrics.revenue),
    "Margins": Number.isFinite(metrics.gross_margin),
    "Cash flow": Number.isFinite(metrics.fcf),
    "Balance sheet": Number.isFinite(metrics.net_debt),
  };
  Object.entries(baseChecks).forEach(([k, v]) => (v ? available.push(k) : missing.push(k)));
  required.forEach((r: string) => {
    if (!available.some((a) => a.toLowerCase().includes(r.toLowerCase().split(" ")[0]))) missing.push(r);
  });
  const modelOutputs: Record<string, any> = {};
  if (key === "bank") {
    modelOutputs.note = "Bank-specific metrics (NIM, GNPA/NNPA, CET-1, deposit/loan growth) are not present in the generic statement schema; only consolidated ROE/leverage are computed.";
  } else if (key === "energy") {
    modelOutputs.note = "Commodity price/volume splits, reserves and project pipelines are not present; cyclicality is assessed through reported revenue and margins.";
  } else if (key === "manufacturing") {
    modelOutputs.capex_intensity = Number.isFinite(metrics.revenue) && metrics.revenue ? (metrics.fcf !== null ? null : null) : null;
  }
  return {
    key,
    label: sector?.label || "General",
    valuationApproach: sector?.valuationApproach || "Standard three-statement DCF",
    applicableMethods: sector?.applicableMethods || ["DCF"],
    requiredInputs: required,
    availableInputs: [...new Set(available)],
    missingInputs: [...new Set(missing)],
    modelOutputs,
    limitations: sector?.disclosure || "",
  };
}

async function reportArtifacts(inputs: any, fixtureInput?: any, origin = "synthetic") {
  const ticker = inputs.ticker;
  const listing = parseListing(ticker);
  const normalized = fixtureInput || mockTickerData(ticker);
  const isSynthetic = normalized.is_synthetic !== false;
  const company = companySummary(normalized);
  const metricsHistory = buildMetrics(normalized);
  const actuals = metricsHistory[0] || null;
  const forecast = buildForecast(ticker, inputs.years, {}, normalized);
  const flows: number[] = forecast.periods.map((period: any) => period.fcf);
  const netDebt = isFiniteNumber(actuals?.net_debt) ? actuals.net_debt : 0;
  const shares = numberOr(normalized.info?.sharesOutstanding, 0) || forecast.periods[0]?.shares || 1;
  const price = numberOr(normalized.price_summary?.last_close, 0);

  // WACC build-up via CAPM with documented defaults; inputs.wacc is the applied discount rate.
  const waccComponents = waccCompute({}) as any;

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
  if (!dcf.error) {
    dcf.wacc_components = {
      risk_free: 0.04,
      beta: 1.0,
      market_premium: 0.055,
      cost_of_equity: waccComponents.cost_of_equity,
      cost_of_debt: 0.06,
      tax_rate: 0.25,
      after_tax_cost_of_debt: waccComponents.after_tax_cost_of_debt,
      equity_weight: 0.7,
      debt_weight: 0.3,
      capm_wacc: waccComponents.wacc,
      applied_wacc: inputs.wacc,
      note: "CAPM build-up uses documented engine defaults (risk-free 4%, beta 1.0, ERP 5.5%, cost of debt 6%, tax 25%, 70/30 weights). The applied WACC is the user input used to discount cash flows.",
    };
  }

  const priceToBook = isFiniteNumber(actuals?.book_value_per_share) && isFiniteNumber(price) && price > 0
    ? price / actuals.book_value_per_share
    : null;
  const actualsWithPb = actuals ? { ...actuals, price_to_book: priceToBook } : null;

  const sensitivity = flows.length > 0 ? (sensitivityCompute({
    fcf: flows,
    shares,
    net_debt: netDebt,
    final_ebitda: forecast.summary.final_ebitda,
    wacc_values: [-0.02, -0.01, 0, 0.01, 0.02].map((step) => Number((inputs.wacc + step).toFixed(4))),
    terminal_values: inputs.terminal_mode === "multiple" ? [8, 9, 10, 11, 12] : [0.015, 0.02, 0.025, 0.03, 0.035],
    mode: inputs.terminal_mode,
  }) as any) : { error: "No forecast cash flows available; sensitivity grid is suppressed." };

  const reverseDcf = price > 0 && flows.length > 0 ? (reverseDcfCompute({ ...dcfBody, current_price: price }) as any) : { error: "No forecast cash flows or market price available; implied WACC is suppressed." };

  // Scenario analysis: distinct business assumptions, not price adjustments.
  const scenarios = buildScenarios(ticker, inputs, normalized, price);
  const peer_comps = (Array.isArray(inputs.peers) && inputs.peers.length)
    ? await peerCompsCompute(ticker, inputs.peers, price)
    : null;
  const monte_carlo = monteCarloCompute(inputs, normalized, 300);

  // Provenance + integrity gates
  const issues = validateIdentity({ ticker, company, normalized, priceSummary: normalized.price_summary });
  const executedChecks: string[] = ["identity"];
  // DCF integrity: a failed or unusable DCF must never coexist with an actionable rating.
  if (dcf?.error) {
    issues.push({
      severity: "error",
      code: "valuation.dcf_failed",
      message: `DCF could not be computed: ${dcf.error}`,
      blocking: true,
    });
  } else {
    if (!isFiniteNumber(dcf?.value_per_share)) {
      issues.push({
        severity: "error",
        code: "valuation.dcf_invalid",
        message: "DCF produced a non-finite value per share.",
        blocking: true,
      });
    }
    if (isFiniteNumber(dcf?.terminal_value_share_of_ev) && Math.abs(dcf.terminal_value_share_of_ev) > 0.85) {
      issues.push({
        severity: "warn",
        code: "valuation.terminal_dominates",
        message: `Terminal value contributes ${(dcf.terminal_value_share_of_ev * 100).toFixed(0)}% of enterprise value; the valuation is dominated by long-run assumptions.`,
      });
    }
    if (isFiniteNumber(dcf?.wacc) && isFiniteNumber(dcf?.terminal_growth) && dcf.terminal_growth >= dcf.wacc) {
      issues.push({
        severity: "error",
        code: "valuation.terminal_growth",
        message: "Terminal growth is not below the discount rate.",
        blocking: true,
      });
    }
  }
  executedChecks.push("valuation.dcf");
  // Forecast consistency checks.
  if (forecast?.summary) {
    if (!forecast.summary.balance_ok) {
      issues.push({
        severity: "warn",
        code: "forecast.balance_residual",
        message: `Forecast balance-sheet residual of ${Number(forecast.summary.max_balance_check ?? 0).toPrecision(4)} exceeds tolerance.`,
      });
    }
  }
  executedChecks.push("forecast.consistency");
  // Reverse DCF convergence check.
  if (reverseDcf && !reverseDcf.error && reverseDcf.converged === false) {
    issues.push({
      severity: "warn",
      code: "valuation.reverse_dcf_not_converged",
      message: "Reverse DCF did not converge to the observed market price.",
    });
  }
  executedChecks.push("valuation.reverse_dcf");

  const gates = integrityGates(issues);
  gates.checks_run = executedChecks;
  gates.checks_passed = gates.blockers.length === 0;

  // Synthetic (sample) data is never rated: publishing BUY/HOLD/SELL on fabricated
  // figures is exactly the integrity failure the gates exist to prevent.
  if (isSynthetic) {
    gates.ratingAllowed = false;
    gates.targetAllowed = false;
    gates.blockers.push({
      severity: "error",
      code: "data.synthetic",
      blocking: true,
      message: "Rating and target are withheld: figures come from the local sample fixture, not company-reported data.",
    });
    gates.warnings = gates.warnings.filter((issue) => issue.code !== "data.synthetic");
  }
  // A failed DCF must never coexist with an actionable rating/target.
  if (dcf?.error) {
    gates.ratingAllowed = false;
    gates.targetAllowed = false;
  }
  const provenance = buildProvenanceRows({
    ticker,
    listing,
    normalized,
    actuals,
    forecast,
    dcf: dcf.error ? null : dcf,
    assumptions: forecast.assumptions,
    assumptionSources: forecast.assumption_sources,
    retrievedAt: normalized.retrieved_at,
    isSynthetic,
    source: isSynthetic ? undefined : `${normalized.provider || "Configured market-data provider"} (retrieved ${normalized.retrieved_at})`,
  });
  const sector = sectorProfile(company.sector, company.industry);
  const sector_model = buildSectorModel(company, normalized, sector);

  // Rating resolution — integrity gates block rating/target on failure.
  const modelTarget = !dcf.error && isFiniteNumber(dcf.value_per_share) ? dcf.value_per_share : null;
  const manualCode = RATING_CODES.includes(inputs.manual_rating) ? inputs.manual_rating : "";
  let target = inputs.manual_target_price ?? modelTarget;
  let upside = target && price > 0 ? target / price - 1 : null;
  let rating: string;
  if (!gates.ratingAllowed) {
    rating = "NOT RATED";
    target = null;
    upside = null;
  } else if (inputs.rating_mode === "manual" && manualCode) {
    rating = manualCode;
  } else {
    rating = autoRating(upside);
  }
  const ratingBlocked = !gates.ratingAllowed;
  const ratingBlockReason = ratingBlocked ? gates.blockers.map((b) => b.message).join(" ") : null;

  const narrative = buildDeterministicNarrative({
    ticker,
    companyName: company.name || ticker,
    exchange: company.exchange || listing.exchange,
    sector: company.sector || "",
    industry: company.industry || "",
    currency: company.currency || listing.currency,
    marketCap: isFiniteNumber(company.market_cap) ? company.market_cap : null,
    employees: isFiniteNumber(normalized.info?.fullTimeEmployees) ? normalized.info.fullTimeEmployees : null,
    businessSummary: company.summary || "",
    price: {
      lastClose: isFiniteNumber(normalized.price_summary?.last_close) ? normalized.price_summary.last_close : null,
      low52w: isFiniteNumber(normalized.price_summary?.low_52w) ? normalized.price_summary.low_52w : null,
      high52w: isFiniteNumber(normalized.price_summary?.high_52w) ? normalized.price_summary.high_52w : null,
    },
    actuals,
    history: metricsHistory,
    forecast: { periods: forecast.periods, summary: forecast.summary, assumptions: forecast.assumptions, assumption_sources: forecast.assumption_sources },
    dcf: dcf.error ? null : dcf,
    sensitivity: sensitivity.error ? null : sensitivity,
    reverseDcf: reverseDcf.error ? null : reverseDcf,
    rating,
    target,
    upside,
    ratingBlocked,
    ratingBlockReason,
    horizon: inputs.horizon,
    sectorProfile: sector,
    isSynthetic,
  });

  const dataQuality = forecast.base_gaps?.length
    ? {
        ...(normalized.data_quality || {}),
        alerts: [
          ...(normalized.data_quality?.alerts || []),
          ...forecast.base_gaps.map((gap: string) => ({
            level: "warn",
            mode: "engine",
            message: `Forecast driver: ${gap}`,
          })),
        ],
      }
    : normalized.data_quality;

  const payload: ExportPayload = {
    ticker,
    title: "",
    generated_at: new Date(inputs.report_date || Date.now()).toISOString(),
    company,
    listing,
    actuals,
    history: metricsHistory,
    annual: normalized.annual,
    forecast,
    dcf,
    sensitivity,
    reverse_dcf: reverseDcf,
    report: narrative,
    rating,
    target_price: target,
    current_price: price > 0 ? price : null,
    upside,
    horizon: inputs.horizon,
    report_date: inputs.report_date,
    peers: inputs.peers,
    assumptions: forecast.assumptions,
    assumption_sources: forecast.assumption_sources,
    data_quality: dataQuality,
    price_summary: normalized.price_summary,
    provenance,
    validation: issues,
    integrity: {
      ratingAllowed: gates.ratingAllowed,
      targetAllowed: gates.targetAllowed,
      blockers: gates.blockers,
      warnings: gates.warnings,
      checks_run: gates.checks_run || executedChecks,
      checks_passed: gates.checks_passed ?? (gates.blockers.length === 0),
    },
    sector_profile: sector,
    sector_model,
    scenarios,
    peer_comps,
    monte_carlo,
    is_synthetic: isSynthetic,
    engine_version: ENGINE_VERSION,
    data_source: isSynthetic ? null : normalized.provider || "Configured market-data provider",
    retrieved_at: normalized.retrieved_at || null,
    currency: company.currency || listing.currency,
  };

  return {
    company,
    normalized,
    listing,
    forecast,
    dcf,
    sensitivity,
    reverseDcf,
    issues,
    gates,
    provenance,
    sector,
    narrative,
    payload,
    actuals,
    actualsWithPb,
    metricsHistory,
    rating,
    target,
    upside,
    ratingBlocked,
    ratingBlockReason,
    price,
    origin,
    baseGaps: forecast.base_gaps || [],
  };
}

function autoRating(upside: number | null): string {
  if (upside === null || !Number.isFinite(upside)) return "NOT RATED";
  if (upside >= 0.1) return "BUY";
  if (upside > -0.1) return "HOLD";
  return "SELL";
}

function finishReportRecord(
  artifacts: any,
  inputs: any,
  previousVersionId: number | null,
  narrativeSource: string,
  extraWarnings: string[],
) {
  const { company, dcf, forecast, payload, rating, target, upside, price, gates } = artifacts;

  const synthetic = payload.is_synthetic !== false;
  const warnings = [
    gates.ratingAllowed
      ? synthetic
        ? "Local engine: all figures come from the deterministic in-browser model."
        : `Provider data: ${payload.data_source || "market-data provider"}, retrieved ${payload.retrieved_at || "unknown"}. The stored snapshot is reused on export.`
      : `Rating and target withheld: ${gates.blockers.map((b: any) => b.message).join(" ")}`,
  ];
  if (Array.isArray(dcf.warnings)) warnings.push(...dcf.warnings);
  if (inputs.force_refresh) {
    warnings.push(
      synthetic
        ? "Force refresh was requested; the local engine rebuilt every figure from its own drivers."
        : "Force refresh was requested; market data was re-fetched from the provider instead of the local cache.",
    );
  }
  (artifacts.baseGaps || []).forEach((gap: string) => warnings.push(`Forecast driver: ${gap}`));
  warnings.push(...extraWarnings);

  const title = inputs.title || (rating === "NOT RATED"
    ? `${inputs.ticker} · Preliminary note (not rated) · ${inputs.horizon} outlook`
    : `${inputs.ticker} · ${rating} · ${inputs.horizon} outlook`);
  payload.title = title;
  payload.rating = rating;
  payload.target_price = target;
  payload.upside = upside;
  payload.current_price = price > 0 ? price : null;

  const meta = buildResearchPdfMeta(payload);
  const layoutIssues = inspectPdfBytes(meta.bytes);
  const pdfQa: any[] = [
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
      level: forecast.error ? "warn" : forecast.summary?.balance_ok ? "info" : "warn",
      check: "model.balance",
      detail: forecast.error
        ? String(forecast.error)
        : forecast.summary?.balance_ok
          ? Math.abs(forecast.summary?.base_balance_residual || 0) > 1
            ? `Projected identity drift stays within tolerance; the base-period residual of ${Number(
                forecast.summary.base_balance_residual.toPrecision(6),
              )} is preserved (balances the engine does not model).`
            : "Balance sheet identity holds in every projected year."
          : `Largest projected imbalance ${forecast.summary?.max_balance_check}`,
    },
    {
      level: inputs.peers.length ? "info" : "warn",
      check: "sources.peers",
      detail: inputs.peers.length
        ? `Peer set recorded: ${inputs.peers.join(", ")}`
        : "No peer set supplied; comparables section omitted.",
    },
    ...layoutIssues,
  ];

  const rows = getLocalReports();
  const id = rows.reduce((peak, row) => Math.max(peak, numberOr(row?.id, 0)), 0) + 1;

  return {
    id,
    ticker: inputs.ticker,
    company_name: company.name || inputs.ticker,
    title,
    report_type: inputs.report_type,
    status: gates.ratingAllowed ? "complete" : "preliminary",
    rating,
    target_price: target,
    current_price: price > 0 ? price : null,
    upside,
    currency: company.currency || "USD",
    horizon: inputs.horizon,
    ai_model: narrativeSource.startsWith("provider:") ? narrativeSource.slice("provider:".length) : null,
    narrative_source: narrativeSource,
    page_count: meta.pages,
    pdf_size: meta.size,
    previous_version_id: previousVersionId,
    warnings,
    pdf_qa: pdfQa,
    created_at: new Date().toISOString(),
    report_date: inputs.report_date,
    peers: inputs.peers,
    inputs,
    narrative: payload.report,
    origin: artifacts.origin,
    fixture: fixtureForRecord(artifacts.normalized),
  };
}

function fixtureForRecord(fixture: any) {
  if (!fixture || fixture.is_synthetic === false) {
    return fixture ? { ...fixture, price_history: [] } : null;
  }
  return null;
}

async function buildReportRecordAsync(inputs: any, previousVersionId: number | null = null) {
  const { fixture, origin, error } = await resolveFixture(inputs.ticker, inputs.force_refresh);
  const artifacts = await reportArtifacts(inputs, fixture, origin);
  let narrativeSource = "deterministic-engine";
  const extraWarnings: string[] = [];
  if (origin === "synthetic") {
    extraWarnings.push(
      `Market-data provider fetch failed (${error || "unavailable"}); the synthetic sample fixture was used. Figures are fabricated and must not be used for investment decisions.`,
    );
  } else if (error) {
    extraWarnings.push(`Provider refresh failed (${error}); provider data retrieved ${fixture.retrieved_at} from the local cache was used.`);
  }

  if (inputs.ai_model) {
    const models = getLocalModels();
    const model = models.find((row: any) => row.name === inputs.ai_model);
    if (model?.api_key) {
      const providerResult = await tryProviderNarrative(
        { name: model.name, provider: model.provider, base_url: model.base_url, api_key: model.api_key, model: model.model },
        {
          // --- Report identity -------------------------------------------------
          prompt_version: PROMPT_VERSION,
          engine_version: ENGINE_VERSION,
          ticker: inputs.ticker,
          company: artifacts.company.name,
          sector: artifacts.payload.sector_profile,
          industry: artifacts.company.industry,
          currency: artifacts.payload.currency,
          report_date: inputs.report_date,
          horizon: inputs.horizon,
          data_source: artifacts.payload.is_synthetic ? "SYNTHETIC local fixture — NOT company data" : artifacts.payload.data_source,
          retrieved_at: artifacts.payload.retrieved_at,
          is_synthetic: artifacts.payload.is_synthetic,
          // --- Decision output (copy verbatim, never recompute) -----------------
          rating: artifacts.rating,
          target: artifacts.target,
          upside: artifacts.upside,
          current_price: artifacts.price,
          rating_blocked: artifacts.gates.ratingAllowed === false,
          rating_block_reason: artifacts.gates.ratingAllowed === false
            ? artifacts.gates.blockers.map((b: any) => b.message).join(" ")
            : null,
          // --- Valuation evidence ----------------------------------------------
          dcf: {
            wacc: artifacts.dcf.wacc,
            terminal_growth: artifacts.dcf.terminal_growth,
            enterprise_value: artifacts.dcf.enterprise_value,
            equity_value: artifacts.dcf.equity_value,
            value_per_share: artifacts.dcf.value_per_share,
            net_debt: artifacts.dcf.net_debt,
            terminal_value_share_of_ev: artifacts.dcf.terminal_value_share_of_ev,
            warnings: artifacts.dcf.warnings,
          },
          reverse_dcf: artifacts.reverseDcf?.error ? null : artifacts.reverseDcf,
          sensitivity: artifacts.payload.sensitivity,
          scenarios: artifacts.payload.scenarios,
          peer_comps: artifacts.payload.peer_comps,
          monte_carlo: artifacts.payload.monte_carlo,
          // --- Forecast + assumption provenance ---------------------------------
          forecast_summary: artifacts.forecast.summary,
          forecast_assumptions: artifacts.forecast.assumptions,
          forecast_assumption_sources: artifacts.forecast.assumption_sources,
          forecast_gaps: artifacts.forecast.base_gaps,
          actuals: artifacts.actualsWithPb,
          history: artifacts.payload.history,
          // --- Validation / integrity / disclosures ------------------------------
          validation_issues: artifacts.payload.validation,
          integrity_gates: artifacts.payload.integrity,
          data_quality_alerts: artifacts.payload.data_quality?.alerts || [],
          sector_model: artifacts.payload.sector_model,
          provenance: artifacts.payload.provenance,
        },
      );
      if (providerResult?.narrative) {
        artifacts.payload.report = providerResult.narrative;
        artifacts.narrative = providerResult.narrative;
        narrativeSource = providerResult.narrative.narrative_source;
      } else {
        extraWarnings.push(`AI provider narrative was unavailable or failed schema validation; deterministic fallback used.`);
      }
    } else {
      extraWarnings.push(`AI model "${inputs.ai_model}" has no API key configured; deterministic narrative used.`);
    }
  }

  return finishReportRecord(artifacts, inputs, previousVersionId, narrativeSource, extraWarnings);
}

function pctValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

async function reportExportPayload(record: any): Promise<ExportPayload> {
  const inputs = record?.inputs || reportInputs({ ticker: record?.ticker });
  const artifacts = await reportArtifacts(inputs, record?.fixture || undefined, record?.origin || "synthetic");
  if (record?.title) artifacts.payload.title = record.title;
  if (record?.created_at) artifacts.payload.generated_at = record.created_at;
  if (record?.narrative) artifacts.payload.report = record.narrative;
  if (record?.rating) artifacts.payload.rating = record.rating;
  if (record?.target_price != null) artifacts.payload.target_price = record.target_price;
  if (record?.upside != null) artifacts.payload.upside = record.upside;
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
  { symbol: "SAMPLE", name: "APEX Sample Company", exchange: "SAMPLE", quote_type: "EQUITY" },
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
    const ticker = cleanPath.split("/")[3] || "SAMPLE";
    const force = query.get("refresh") === "true";
    return resolveFixture(ticker, force).then(({ fixture }) => companySummary(fixture));
  }

  if (cleanPath.startsWith("/api/data/")) {
    const ticker = cleanPath.split("/")[3] || "SAMPLE";
    const force = query.get("refresh") === "true";
    return resolveFixture(ticker, force).then((resolved) => ({
      normalized: resolved.fixture,
      metrics: { periods: buildMetrics(resolved.fixture) },
      origin: resolved.origin,
      provider_error: resolved.error,
    }));
  }

  if (cleanPath.startsWith("/api/forecast/")) {
    const ticker = cleanPath.split("/")[3] || "SAMPLE";
    return resolveFixture(ticker, false).then((resolved) =>
      buildForecast(ticker, body?.years, body?.assumptions, resolved.fixture),
    );
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
  if (cleanPath.startsWith("/api/advanced/bank")) return bankModelCompute(body);
  if (cleanPath.startsWith("/api/advanced/insurer")) return insurerModelCompute(body);
  if (cleanPath.startsWith("/api/advanced/reit")) return reitModelCompute(body);
  if (cleanPath.startsWith("/api/advanced/commodity")) return commodityModelCompute(body);
  if (cleanPath.startsWith("/api/advanced/")) {
    return { result: "success", valuation: 120, irr: 0.22, summary: "Advanced model computed successfully by the local engine." };
  }

  if (cleanPath === "/api/ai/research") {
    const ticker = String(body?.ticker || "SAMPLE").trim().toUpperCase() || "SAMPLE";
    return resolveFixture(ticker, false).then((resolved) =>
      mockAiResearch(body, resolved.fixture, resolved.origin),
    );
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
    return buildReportRecordAsync(reportInputs(body || {})).then((record) => {
      const rows = getLocalReports();
      rows.unshift(record);
      saveLocalReports(rows);
      return record;
    });
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
      return buildReportRecordAsync(reportInputs(record.inputs), record.id).then((fresh) => {
        rows.unshift(fresh);
        saveLocalReports(rows);
        return fresh;
      });
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
    if (record) {
      const payload = await reportExportPayload(record);
      return buildResearchPdf(payload);
    }
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
