// ============================================================
// APEX RESEARCH — Canonical Financial Fact Graph (P0 #1, #4, #24)
// ------------------------------------------------------------
// ONE graph of typed facts consumed by the independent validator and
// QA — never by the model itself (the model keeps its own audited path;
// the validator must not share code with what it audits).
//
// Every fact carries: source, period, fiscalPeriod, periodType
// (ACTUAL / ESTIMATE / FORECAST), currency, scale, as-of date, and
// confidence. MISSING stays missing: absent fields are recorded with
// confidence "none", never defaulted.
// ============================================================
import type { AnnualFinancials, CompanyProfile, StockData } from "@/types/report";

export type PeriodType = "ACTUAL" | "ESTIMATE" | "FORECAST";
export type FactConfidence = "high" | "medium" | "low" | "none";

export interface RawFact<T = number> {
  value: T | null;
  source: string;
  /** Calendar/fiscal label as printed, e.g. "FY2024". */
  period: string;
  /** Machine fiscal period, e.g. "2024-03-31". */
  fiscalPeriod: string;
  periodType: PeriodType;
  currency: string;
  scale: "raw" | "INR-Cr" | "USD-M";
  asOf: string;
  confidence: FactConfidence;
}

export interface CanonicalMarketFacts {
  price: RawFact;
  sharesBasic: RawFact;
  /** Fully-diluted count: max(basic, netIncome/dilutedEps-implied) with reconciliation flag. */
  sharesDiluted: RawFact & { dilutedBasis?: string; dilutedReconciles?: boolean };
  marketCap: RawFact;
  asOf: string;
}

export interface CanonicalYearFacts {
  year: string;
  fiscalPeriod: string;
  periodType: PeriodType;
  missingFields: string[];
  revenue: RawFact;
  operatingCashFlow: RawFact;
  capitalExpenditures: RawFact;
  freeCashFlow: RawFact;
  currentAssets: RawFact;
  currentLiabilities: RawFact;
  netWorkingCapital: RawFact;
  totalAssets: RawFact;
  totalLiabilities: RawFact;
  totalEquity: RawFact;
  totalDebt: RawFact;
  cash: RawFact;
  shortTermInvestments: RawFact;
  netIncome: RawFact;
  ebitda: RawFact;
  sharesOutstanding: RawFact;
  dilutedEps: RawFact;
  // Income-statement integrity set (P0 #21, #25–#27, #38–#39)
  costOfRevenue: RawFact;
  grossProfit: RawFact;
  operatingIncome: RawFact;
  interestExpense: RawFact;
  otherIncome: RawFact;
  pretaxIncome: RawFact;
  incomeTaxExpense: RawFact;
  depreciation: RawFact;
  eps: RawFact;
  // Balance-sheet detail set (P0 #22–#24, #35–#37, #41–#42, #46)
  shortTermDebt: RawFact;
  longTermDebt: RawFact;
  accountsPayable: RawFact;
  netReceivables: RawFact;
  inventory: RawFact;
  netFixedAssets: RawFact;
  retainedEarnings: RawFact;
  dividendsPaid: RawFact;
  repurchases: RawFact;
  stockBasedCompensation: RawFact;
  capitalLeaseObligations: RawFact;
  otherCurrentAssets: RawFact;
  otherCurrentLiabilities: RawFact;
}

export interface CanonicalFactGraph {
  currency: string;
  scale: "raw" | "INR-Cr" | "USD-M";
  asOf: string;
  market: CanonicalMarketFacts;
  years: CanonicalYearFacts[];
  /** Fields absent everywhere (never defaulted — downstream must gate, not guess). */
  missing: string[];
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function moneyFact(
  value: unknown,
  opts: { source: string; period: string; fiscalPeriod: string; periodType: PeriodType; currency: string; scale: CanonicalFactGraph["scale"]; asOf: string; estimated?: boolean }
): RawFact {
  const v = numOrNull(value);
  return {
    value: v,
    source: opts.source,
    period: opts.period,
    fiscalPeriod: opts.fiscalPeriod,
    periodType: opts.periodType,
    currency: opts.currency,
    scale: opts.scale,
    asOf: opts.asOf,
    confidence: v === null ? "none" : opts.estimated ? "low" : "high",
  };
}

/**
 * Build the canonical graph. Yahoo timeseries rows are ACTUAL filings;
 * any year carrying `estimatesUsed` tags is ESTIMATE (mixed provenance is
 * disclosed per-year, never laundered into ACTUAL).
 */
export function buildCanonicalFacts(params: {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  asOf?: string;
}): CanonicalFactGraph {
  const { profile, stockData, annualFinancials } = params;
  const asOf = params.asOf ?? new Date().toISOString();
  const currency = (profile.currency || "UNKNOWN").toUpperCase();
  const scale: CanonicalFactGraph["scale"] = currency === "INR" ? "INR-Cr" : "USD-M";

  const latest = annualFinancials[annualFinancials.length - 1];
  const basicShares = numOrNull(stockData.sharesOutstanding) && (stockData.sharesOutstanding as number) > 0
    ? (stockData.sharesOutstanding as number)
    : numOrNull(latest?.sharesOutstanding) && ((latest?.sharesOutstanding as number) > 0)
      ? (latest?.sharesOutstanding as number)
      : null;
  // Diluted derivation (P0 #10): netIncome/dilutedEps implies the fully-diluted
  // count. Take max(basic, implied) — dilution only ever ADDS shares.
  const ni = numOrNull(latest?.netIncome);
  const deps = numOrNull(latest?.dilutedEps);
  const impliedDiluted = ni !== null && deps !== null && ni > 0 && deps > 0 ? ni / deps : null;
  let dilutedShares: number | null = basicShares;
  let dilutedBasis = "basic (no dilutive securities evidenced)";
  let dilutedReconciles = true;
  if (impliedDiluted !== null && impliedDiluted > 0) {
    if (basicShares === null || impliedDiluted >= basicShares * 0.999) {
      dilutedShares = Math.max(basicShares ?? 0, impliedDiluted);
      dilutedBasis = "netIncome/dilutedEps-implied fully-diluted count";
      dilutedReconciles = basicShares === null || impliedDiluted >= basicShares * 0.999;
    } else {
      // Implied diluted BELOW basic is impossible — keep basic, flag loudly.
      dilutedShares = basicShares;
      dilutedBasis = "basic retained: implied diluted below basic is impossible";
      dilutedReconciles = false;
    }
  }

  const price = numOrNull(stockData.currentPrice);
  const marketCap = numOrNull(stockData.marketCap);
  const mk = (value: number | null, source: string): RawFact => ({
    value, source, period: "QUOTE", fiscalPeriod: "QUOTE", periodType: "ACTUAL",
    currency, scale, asOf, confidence: value === null ? "none" : "high",
  });

  const years: CanonicalYearFacts[] = annualFinancials.map((f) => {
    const period = f.year || "unknown-period";
    const fiscalPeriod = f.fiscalYearEnd || f.year || "unknown-period";
    // P0 #4: any synthesized field tags the WHOLE year ESTIMATE — mixed
    // provenance is disclosed, never laundered into ACTUAL.
    const periodType: PeriodType = (f.estimatesUsed?.length ?? 0) > 0 ? "ESTIMATE" : "ACTUAL";
    const mf = (value: unknown, source: string, estimated = false): RawFact =>
      moneyFact(value, { source, period, fiscalPeriod, periodType, currency, scale, asOf, estimated });
    const missingFields: string[] = [];
    const need = (name: string, v: unknown) => { if (numOrNull(v) === null) missingFields.push(name); };
    (["revenue", "operatingCashFlow", "capitalExpenditures", "freeCashFlow", "currentAssets", "currentLiabilities", "netWorkingCapital", "totalAssets", "totalLiabilities", "totalEquity", "totalDebt", "cash", "netIncome", "ebitda", "sharesOutstanding", "costOfRevenue", "grossProfit", "operatingIncome", "interestExpense", "pretaxIncome", "incomeTaxExpense", "depreciation", "shortTermDebt", "longTermDebt", "accountsPayable", "netFixedAssets", "retainedEarnings", "dividendsPaid"] as const)
      .forEach((k) => need(k, (f as unknown as Record<string, unknown>)[k]));
    return {
      year: period, fiscalPeriod, periodType, missingFields,
      revenue: mf(f.revenue, "Yahoo.timeseries:revenue"),
      operatingCashFlow: mf(f.operatingCashFlow, "Yahoo.timeseries:operatingCashFlow", (f.estimatesUsed || []).some((t) => t.startsWith("operatingCashFlow@"))),
      capitalExpenditures: mf(f.capitalExpenditures, "Yahoo.timeseries:capitalExpenditures", (f.estimatesUsed || []).some((t) => t.startsWith("capex@"))),
      freeCashFlow: mf(f.freeCashFlow, "Yahoo.timeseries:freeCashFlow"),
      currentAssets: mf(f.currentAssets, "Yahoo.timeseries:currentAssets"),
      currentLiabilities: mf(f.currentLiabilities, "Yahoo.timeseries:currentLiabilities"),
      netWorkingCapital: mf(f.netWorkingCapital, "Yahoo.timeseries:netWorkingCapital"),
      totalAssets: mf(f.totalAssets, "Yahoo.timeseries:totalAssets"),
      totalLiabilities: mf(f.totalLiabilities, "Yahoo.timeseries:totalLiabilities"),
      totalEquity: mf(f.totalEquity, "Yahoo.timeseries:totalEquity"),
      totalDebt: mf(f.totalDebt, "Yahoo.timeseries:totalDebt"),
      cash: mf(f.cash, "Yahoo.timeseries:cash"),
      shortTermInvestments: mf(f.shortTermInvestments, "Yahoo.timeseries:shortTermInvestments"),
      netIncome: mf(f.netIncome, "Yahoo.timeseries:netIncome"),
      ebitda: mf(f.ebitda, "Yahoo.timeseries:ebitda", (f.estimatesUsed || []).some((t) => t.startsWith("ebitda@"))),
      sharesOutstanding: mf(f.sharesOutstanding, "Yahoo.timeseries:sharesOutstanding"),
      dilutedEps: mf(f.dilutedEps, "Yahoo.timeseries:dilutedEps"),
      costOfRevenue: mf(f.costOfRevenue, "Yahoo.timeseries:costOfRevenue"),
      grossProfit: mf(f.grossProfit, "Yahoo.timeseries:grossProfit", (f.estimatesUsed || []).some((t) => t.startsWith("grossProfit@"))),
      operatingIncome: mf(f.operatingIncome, "Yahoo.timeseries:operatingIncome", (f.estimatesUsed || []).some((t) => t.startsWith("operatingIncome@"))),
      interestExpense: mf(f.interestExpense, "Yahoo.timeseries:interestExpense"),
      otherIncome: mf((f as unknown as { otherIncome?: unknown }).otherIncome, "Yahoo.timeseries:otherIncome"),
      pretaxIncome: mf((f as unknown as { pretaxIncome?: unknown }).pretaxIncome, "Yahoo.timeseries:pretaxIncome"),
      incomeTaxExpense: mf((f as unknown as { incomeTaxExpense?: unknown }).incomeTaxExpense, "Yahoo.timeseries:incomeTaxExpense"),
      depreciation: mf(f.depreciation, "Yahoo.timeseries:depreciation", (f.estimatesUsed || []).some((t) => t.startsWith("depreciation@"))),
      eps: mf(f.eps, "Yahoo.timeseries:eps"),
      shortTermDebt: mf(f.shortTermDebt, "Yahoo.timeseries:shortTermDebt"),
      longTermDebt: mf(f.longTermDebt, "Yahoo.timeseries:longTermDebt"),
      accountsPayable: mf(f.accountsPayable, "Yahoo.timeseries:accountsPayable"),
      netReceivables: mf((f as unknown as { netReceivables?: unknown }).netReceivables, "Yahoo.timeseries:netReceivables"),
      inventory: mf((f as unknown as { inventory?: unknown }).inventory, "Yahoo.timeseries:inventory"),
      netFixedAssets: mf(f.netFixedAssets, "Yahoo.timeseries:netFixedAssets"),
      retainedEarnings: mf((f as unknown as { retainedEarnings?: unknown }).retainedEarnings, "Yahoo.timeseries:retainedEarnings"),
      dividendsPaid: mf((f as unknown as { dividendsPaid?: unknown }).dividendsPaid, "Yahoo.timeseries:dividendsPaid"),
      repurchases: mf((f as unknown as { repurchases?: unknown }).repurchases, "Yahoo.timeseries:repurchases"),
      stockBasedCompensation: mf((f as unknown as { stockBasedCompensation?: unknown }).stockBasedCompensation, "Yahoo.timeseries:stockBasedCompensation"),
      capitalLeaseObligations: mf((f as unknown as { capitalLeaseObligations?: unknown }).capitalLeaseObligations, "Yahoo.timeseries:capitalLeaseObligations"),
      otherCurrentAssets: mf((f as unknown as { otherCurrentAssets?: unknown }).otherCurrentAssets, "Yahoo.timeseries:otherCurrentAssets"),
      otherCurrentLiabilities: mf((f as unknown as { otherCurrentLiabilities?: unknown }).otherCurrentLiabilities, "Yahoo.timeseries:otherCurrentLiabilities"),
    };
  });

  const missing: string[] = [];
  if (price === null) missing.push("market.price");
  if (basicShares === null) missing.push("market.sharesBasic");
  if (dilutedShares === null) missing.push("market.sharesDiluted");
  if (marketCap === null) missing.push("market.marketCap");
  if (!currency || currency === "UNKNOWN") missing.push("market.currency");
  if (annualFinancials.length === 0) missing.push("statements.*");

  return {
    currency, scale, asOf,
    market: {
      price: mk(price, "Yahoo.quote:regularMarketPrice"),
      sharesBasic: mk(basicShares, "Yahoo.keyStats:sharesOutstanding|statements"),
      sharesDiluted: { ...mk(dilutedShares, "derived:netIncome/dilutedEps|max(basic)"), dilutedBasis, dilutedReconciles },
      marketCap: mk(marketCap, "Yahoo.quote:marketCap"),
      asOf,
    },
    years,
    missing,
  };
}
