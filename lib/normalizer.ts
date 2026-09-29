import type { FinancialData, Provenance, RawTickerData, Statement } from "./types";

const INFO_COMPANY_FIELDS: Record<string, string> = {
  shortName: "name",
  longName: "long_name",
  sector: "sector",
  industry: "industry",
  longBusinessSummary: "summary",
  website: "website",
  fullTimeEmployees: "employees",
  country: "country",
  exchange: "exchange",
  quoteType: "quote_type",
};

const INFO_MARKET_FIELDS: Record<string, string> = {
  currency: "currency",
  financialCurrency: "financial_currency",
  marketCap: "market_cap",
  sharesOutstanding: "shares_outstanding",
  fiftyTwoWeekHigh: "fifty_two_week_high",
  fiftyTwoWeekLow: "fifty_two_week_low",
  fiftyDayAverage: "fifty_day_average",
  twoHundredDayAverage: "two_hundred_day_average",
  beta: "beta",
  averageVolume: "average_volume",
  lastSplitFactor: "last_split_factor",
  lastSplitDate: "last_split_date",
};

const INFO_PRICE_FIELDS: Record<string, string> = {
  regularMarketPrice: "price",
  regularMarketChange: "change",
  regularMarketChangePercent: "change_percent",
  regularMarketPreviousClose: "previous_close",
  regularMarketOpen: "open",
  regularMarketDayHigh: "day_high",
  regularMarketDayLow: "day_low",
  regularMarketVolume: "volume",
  regularMarketTime: "quote_timestamp",
  marketState: "market_state",
};

const INFO_VALUATION_FIELDS: Record<string, string> = {
  trailingPE: "trailing_pe",
  forwardPE: "forward_pe",
  pegRatio: "peg_ratio",
  priceToBook: "price_to_book",
  priceToSalesTrailing12Months: "price_to_sales",
  enterpriseValue: "enterprise_value",
  enterpriseToRevenue: "ev_to_revenue",
  enterpriseToEbitda: "ev_to_ebitda",
  dividendYield: "dividend_yield",
  dividendRate: "dividend_rate",
  payoutRatio: "payout_ratio",
  trailingEps: "trailing_eps",
  forwardEps: "forward_eps",
  bookValue: "book_value",
  profitMargins: "profit_margin",
  grossMargins: "gross_margin",
  operatingMargins: "operating_margin",
  ebitdaMargins: "ebitda_margin",
  returnOnEquity: "return_on_equity",
  returnOnAssets: "return_on_assets",
  returnOnCapital: "return_on_capital",
  currentRatio: "current_ratio",
  quickRatio: "quick_ratio",
  totalDebt: "total_debt",
  totalCash: "total_cash",
  totalRevenue: "total_revenue",
  revenueGrowth: "revenue_growth",
  earningsGrowth: "earnings_growth",
  earningsQuarterlyGrowth: "earnings_quarterly_growth",
  debtToEquity: "debt_to_equity",
  freeCashflow: "free_cashflow",
  operatingCashflow: "operating_cashflow",
  revenuePerShare: "revenue_per_share",
  targetHighPrice: "target_high",
  targetLowPrice: "target_low",
  targetMeanPrice: "target_mean",
  targetMedianPrice: "target_median",
  recommendationKey: "recommendation_key",
  recommendationMean: "recommendation_mean",
  numberOfAnalystOpinions: "number_of_analyst_opinions",
};

function pick(info: Record<string, unknown>, fieldMap: Record<string, string>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [sourceKey, normalizedKey] of Object.entries(fieldMap)) {
    if (info[sourceKey] !== undefined && info[sourceKey] !== null) {
      out[normalizedKey] = info[sourceKey];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toStatement(
  raw: { periods: string[]; lineItems: Record<string, Record<string, number | null>> } | null,
  frequency: string,
  ticker: string,
  retrievedAt: string,
  currency: string | null,
  yfName: string
): Statement | null {
  if (!raw) return null;
  const periods = [...raw.periods].sort().reverse();
  const provenance: Provenance = {
    ticker,
    source: "yfinance",
    retrievedAt,
    currency,
    frequency,
    originalField: `yfinance.Ticker(${ticker}).${yfName}`,
    normalizedField: `financials.${yfName}`,
  };
  return { frequency, periods, lineItems: raw.lineItems, provenance };
}

export function normalize(raw: RawTickerData): FinancialData {
  const info = raw.info ?? {};
  const currency = (info.currency as string) ?? (info.financialCurrency as string) ?? null;
  const ticker = raw.ticker;

  const analystKeys = [
    "recommendationKey",
    "recommendationMean",
    "numberOfAnalystOpinions",
    "targetHighPrice",
    "targetMeanPrice",
    "targetLowPrice",
    "targetMedianPrice",
  ];
  const analyst: Record<string, unknown> = {};
  for (const key of analystKeys) {
    if (info[key] !== undefined && info[key] !== null) {
      analyst[INFO_VALUATION_FIELDS[key] ?? key] = info[key];
    }
  }

  return {
    ticker,
    retrievalTimestamp: raw.retrievedAt,
    company: pick(info, INFO_COMPANY_FIELDS),
    market: pick(info, INFO_MARKET_FIELDS),
    price: pick(info, INFO_PRICE_FIELDS),
    historicalPrices: raw.priceHistory ?? [],
    incomeStatement: toStatement(raw.incomeStatement, "annual", ticker, raw.retrievedAt, currency, "income_stmt"),
    balanceSheet: toStatement(raw.balanceSheet, "annual", ticker, raw.retrievedAt, currency, "balance_sheet"),
    cashFlow: toStatement(raw.cashFlow, "annual", ticker, raw.retrievedAt, currency, "cashflow"),
    incomeStatementQuarterly: toStatement(raw.quarterlyIncomeStatement, "quarterly", ticker, raw.retrievedAt, currency, "quarterly_income_stmt"),
    balanceSheetQuarterly: toStatement(raw.quarterlyBalanceSheet, "quarterly", ticker, raw.retrievedAt, currency, "quarterly_balance_sheet"),
    cashFlowQuarterly: toStatement(raw.quarterlyCashFlow, "quarterly", ticker, raw.retrievedAt, currency, "quarterly_cashflow"),
    valuation: pick(info, INFO_VALUATION_FIELDS),
    ownership:
      raw.majorHolders || raw.institutionalHolders
        ? { majorHolders: raw.majorHolders ?? null, institutionalHolders: raw.institutionalHolders ?? null }
        : null,
    dividends: raw.dividends ?? null,
    splits: raw.splits ?? null,
    earnings: raw.earningsDates ? { recent: raw.earningsDates } : null,
    analystData: Object.keys(analyst).length > 0 ? analyst : null,
    metadata: { info, sharesOutstandingSeries: raw.sharesOutstanding },
  };
}
