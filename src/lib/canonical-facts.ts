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
  /** Authoritative source id, e.g. Yahoo.quote:regularMarketPrice or SEC.filing:10-K-revenue. */
  source: string;
  /** Provenance tier: PRIMARY (filings/exchange/IR) or SECONDARY (aggregator cross-check). */
  provenance: "PRIMARY" | "SECONDARY" | "DERIVED" | "UNKNOWN";
  /** Calendar/fiscal label as printed, e.g. "FY2024". */
  period: string;
  /** Machine fiscal period, e.g. "2024-03-31". */
  fiscalPeriod: string;
  periodType: PeriodType;
  currency: string;
  /** Dimensional unit: money, shares, pct, multiple, days, etc. */
  unit: "money" | "shares" | "price" | "pct" | "multiple" | "days" | "ratio" | "scalar";
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
  statementType: "corporate" | "bank" | "nbfc" | "insurance" | "reit" | "asset-light";
  missingFields: string[];
  revenue: RawFact; // for corporate: revenue; for bank: totalRevenue (mapped)
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
  // Bank-native fields (only populated when statementType is bank/nbfc)
  netInterestIncome?: RawFact;
  nonInterestIncome?: RawFact;
  totalRevenue?: RawFact;
  provisionForCreditLosses?: RawFact;
  nonInterestExpenses?: RawFact;
  loans?: RawFact;
  deposits?: RawFact;
  grossNPA?: RawFact;
  netNPA?: RawFact;
  capitalAdequacyRatio?: RawFact;
  netInterestMargin?: RawFact;
  // Insurance-native fields (only populated when statementType is insurance)
  grossWrittenPremium?: RawFact;
  netEarnedPremium?: RawFact;
  claimsIncurred?: RawFact;
  underwritingExpenses?: RawFact;
  underwritingResult?: RawFact;
  lossRatio?: RawFact;
  expenseRatio?: RawFact;
  combinedRatio?: RawFact;
  investmentIncome?: RawFact;
  float?: RawFact;
  policyholderLiabilities?: RawFact;
  solvencyRatio?: RawFact;
  embeddedValue?: RawFact;
  // REIT-native fields (only populated when statementType is reit)
  rentalIncome?: RawFact;
  netOperatingIncome?: RawFact;
  noiMargin?: RawFact;
  fundsFromOperations?: RawFact;
  adjustedFundsFromOperations?: RawFact;
  ffoPerShare?: RawFact;
  affoPerShare?: RawFact;
  occupancyPct?: RawFact;
  netAssetValue?: RawFact;
  capRate?: RawFact;
  investmentPropertyValue?: RawFact;
  // Fee-native fields (only populated when statementType is asset-light)
  aumBeginning?: RawFact;
  aumEnding?: RawFact;
  netFlows?: RawFact;
  managementFees?: RawFact;
  performanceFees?: RawFact;
  technologyServicesRevenue?: RawFact;
  totalFeeRevenue?: RawFact;
  revenueAsPctOfAum?: RawFact;
  operatingExpenses?: RawFact;
  operatingMargin?: RawFact;
}

export interface CanonicalFactGraph {
  currency: string;
  scale: "raw" | "INR-Cr" | "USD-M";
  asOf: string;
  market: CanonicalMarketFacts;
  years: CanonicalYearFacts[];
  /** Fields absent everywhere (never defaulted — downstream must gate, not guess). */
  missing: string[];
  /** Immutability seal: deep-frozen after validation; hash detects later mutation. */
  _sealed?: boolean;
  _hash?: string;
}

// ─────────────────────────────────────────────────────────────
// Immutability seal (P0 #1): freeze + hash; any post-seal mutation throws or is detectable
// ─────────────────────────────────────────────────────────────
function deepFreezeGraph<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreezeGraph(v as object);
    Object.freeze(obj);
  }
  return obj;
}
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).filter((k) => k !== "_hash" && k !== "_sealed").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
function factHash(obj: unknown): string {
  const s = stableStringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `fh_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Seal the graph: deep-freeze and attach hash. Call once after validation — downstream must not mutate. */
export function sealCanonicalFacts(graph: CanonicalFactGraph): CanonicalFactGraph {
  const h = factHash(graph);
  (graph as unknown as Record<string, unknown>)._hash = h;
  (graph as unknown as Record<string, unknown>)._sealed = true;
  return deepFreezeGraph(graph);
}

/** Verify seal still holds (hash matches, still frozen). */
export function verifyCanonicalSeal(graph: CanonicalFactGraph): { sealed: boolean; hashOk: boolean; expected: string; actual: string } {
  const expected = (graph as unknown as Record<string, unknown>)._hash as string | undefined;
  const sealed = !!(graph as unknown as Record<string, unknown>)._sealed && Object.isFrozen(graph);
  const actual = factHash(graph);
  return { sealed, hashOk: expected === actual, expected: expected ?? "none", actual };
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function moneyFact(
  value: unknown,
  opts: { source: string; provenance?: RawFact["provenance"]; unit?: RawFact["unit"]; period: string; fiscalPeriod: string; periodType: PeriodType; currency: string; scale: CanonicalFactGraph["scale"]; asOf: string; estimated?: boolean }
): RawFact {
  const v = numOrNull(value);
  return {
    value: v,
    source: opts.source,
    provenance: opts.provenance ?? (opts.source.startsWith("Yahoo.") ? "SECONDARY" : "PRIMARY"),
    period: opts.period,
    fiscalPeriod: opts.fiscalPeriod,
    periodType: opts.periodType,
    currency: opts.currency,
    unit: opts.unit ?? "money",
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
  const mk = (value: number | null, source: string, unit: RawFact["unit"] = "money"): RawFact => ({
    value, source, provenance: source.startsWith("Yahoo.") ? "SECONDARY" : "PRIMARY", period: "QUOTE", fiscalPeriod: "QUOTE", periodType: "ACTUAL",
    currency, unit, scale, asOf, confidence: value === null ? "none" : "high",
  });

  const years: CanonicalYearFacts[] = annualFinancials.map((f) => {
    const period = f.year || "unknown-period";
    const fiscalPeriod = f.fiscalYearEnd || f.year || "unknown-period";
    // P0 #4: any synthesized field tags the WHOLE year ESTIMATE — mixed
    // provenance is disclosed, never laundered into ACTUAL.
    const periodType: PeriodType = (f.estimatesUsed?.length ?? 0) > 0 ? "ESTIMATE" : "ACTUAL";
    // Record-shaped access: the union now carries five genuinely separate shapes,
    // so non-universal fields (ebitda, inventory, deposits, …) are read via R —
    // direct access would be a compile error by design.
    const R = f as unknown as Record<string, unknown>;
    const rawSt = R.statementType as string | undefined;
    const arch: "bank" | "insurance" | "reit" | "fee" | "corporate" =
      rawSt === "bank" || rawSt === "nbfc" ? "bank"
      : rawSt === "insurance" ? "insurance"
      : rawSt === "reit" ? "reit"
      : rawSt === "asset-light" ? "fee" : "corporate";
    const statementType = (arch === "corporate" ? "corporate" : rawSt) as CanonicalYearFacts["statementType"];
    const mf = (value: unknown, source: string, estimated = false, unit: RawFact["unit"]="money"): RawFact =>
      moneyFact(value, { source, period, fiscalPeriod, periodType, currency, scale, asOf, estimated, unit });
    // Shared-fact reader: universal alias first (revenue compat), then native key.
    const S = (source: string, estimated = false, unit: RawFact["unit"] = "money", ...keys: string[]): RawFact => {
      for (const k of keys) {
        const v = numOrNull(R[k]);
        if (v !== null) return mf(v, source, estimated, unit);
      }
      return mf(undefined, source, estimated, unit);
    };
    const estHas = (prefix: string) => (f.estimatesUsed || []).some((t) => t.startsWith(prefix));
    const missingFields: string[] = [];
    const need = (name: string, v: unknown) => { if (numOrNull(v) === null) missingFields.push(name); };
    // Per-architecture required sets (native identities, never corporate fictions).
    const requiredByArch: Record<string, string[]> = {
      corporate: ["revenue", "operatingCashFlow", "capitalExpenditures", "freeCashFlow", "currentAssets", "currentLiabilities", "netWorkingCapital", "totalAssets", "totalLiabilities", "totalEquity", "totalDebt", "cash", "netIncome", "ebitda", "sharesOutstanding", "costOfRevenue", "grossProfit", "operatingIncome", "interestExpense", "pretaxIncome", "incomeTaxExpense", "depreciation", "shortTermDebt", "longTermDebt", "accountsPayable", "netFixedAssets", "retainedEarnings", "dividendsPaid"],
      bank: ["totalRevenue", "netInterestIncome", "operatingCashFlow", "capitalExpenditures", "freeCashFlow", "currentAssets", "currentLiabilities", "totalAssets", "totalLiabilities", "totalEquity", "totalDebt", "cash", "netIncome", "sharesOutstanding", "operatingIncome", "interestExpense", "pretaxIncome", "incomeTaxExpense", "shortTermDebt", "longTermDebt", "retainedEarnings", "dividendsPaid"],
      insurance: ["grossWrittenPremium", "netEarnedPremium", "claimsIncurred", "underwritingExpenses", "underwritingResult", "combinedRatio", "investmentIncome", "float", "policyholderLiabilities", "operatingCashFlow", "freeCashFlow", "totalAssets", "totalLiabilities", "totalEquity", "totalDebt", "cash", "netIncome", "sharesOutstanding", "pretaxIncome", "incomeTaxExpense", "dividendsPaid"],
      reit: ["rentalIncome", "netOperatingIncome", "fundsFromOperations", "adjustedFundsFromOperations", "operatingCashFlow", "freeCashFlow", "totalAssets", "investmentPropertyValue", "totalLiabilities", "totalEquity", "totalDebt", "cash", "netIncome", "sharesOutstanding", "interestExpense", "dividendsPaid"],
      fee: ["totalFeeRevenue", "managementFees", "operatingExpenses", "operatingIncome", "operatingMargin", "operatingCashFlow", "freeCashFlow", "totalAssets", "totalLiabilities", "totalEquity", "totalDebt", "cash", "netIncome", "sharesOutstanding", "pretaxIncome", "incomeTaxExpense", "dividendsPaid"],
    };
    (requiredByArch[arch] ?? requiredByArch.corporate).forEach((k) => need(k, R[k]));
    // Shared backbone facts (universal across all five shapes via compat aliases).
    const shared = {
      operatingCashFlow: S("Yahoo.timeseries:operatingCashFlow", estHas("operatingCashFlow@"), "money", "operatingCashFlow"),
      capitalExpenditures: S("Yahoo.timeseries:capitalExpenditures", estHas("capex@"), "money", "capitalExpenditures"),
      freeCashFlow: S("Yahoo.timeseries:freeCashFlow", false, "money", "freeCashFlow"),
      currentAssets: S("Yahoo.timeseries:currentAssets", false, "money", "currentAssets"),
      currentLiabilities: S("Yahoo.timeseries:currentLiabilities", false, "money", "currentLiabilities"),
      netWorkingCapital: S("Yahoo.timeseries:netWorkingCapital", false, "money", "netWorkingCapital"),
      totalAssets: S("Yahoo.timeseries:totalAssets", false, "money", "totalAssets"),
      totalLiabilities: S("Yahoo.timeseries:totalLiabilities", false, "money", "totalLiabilities"),
      totalEquity: S("Yahoo.timeseries:totalEquity", false, "money", "totalEquity"),
      totalDebt: S("Yahoo.timeseries:totalDebt", false, "money", "totalDebt"),
      cash: S("Yahoo.timeseries:cash", false, "money", "cash"),
      shortTermInvestments: S("Yahoo.timeseries:shortTermInvestments", false, "money", "shortTermInvestments"),
      netIncome: S("Yahoo.timeseries:netIncome", false, "money", "netIncome"),
      sharesOutstanding: S("Yahoo.timeseries:sharesOutstanding", false, "shares", "sharesOutstanding"),
      dilutedEps: S("Yahoo.timeseries:dilutedEps", false, "price", "dilutedEps"),
      eps: S("Yahoo.timeseries:eps", false, "price", "eps"),
      pretaxIncome: S("Yahoo.timeseries:pretaxIncome", false, "money", "pretaxIncome"),
      incomeTaxExpense: S("Yahoo.timeseries:incomeTaxExpense", false, "money", "incomeTaxExpense"),
      dividendsPaid: S("Yahoo.timeseries:dividendsPaid", false, "money", "dividendsPaid"),
      shortTermDebt: S("Yahoo.timeseries:shortTermDebt", false, "money", "shortTermDebt"),
      longTermDebt: S("Yahoo.timeseries:longTermDebt", false, "money", "longTermDebt"),
      retainedEarnings: S("Yahoo.timeseries:retainedEarnings", false, "money", "retainedEarnings"),
      repurchases: S("Yahoo.timeseries:repurchases", false, "money", "repurchases"),
      stockBasedCompensation: S("Yahoo.timeseries:stockBasedCompensation", false, "money", "stockBasedCompensation"),
      capitalLeaseObligations: S("Yahoo.timeseries:capitalLeaseObligations", false, "money", "capitalLeaseObligations"),
      otherCurrentAssets: S("Yahoo.timeseries:otherCurrentAssets", false, "money", "otherCurrentAssets"),
      otherCurrentLiabilities: S("Yahoo.timeseries:otherCurrentLiabilities", false, "money", "otherCurrentLiabilities"),
      // Corporate-detail facts (null/confidence-none for non-corporate shapes — never synthesized).
      costOfRevenue: S("Yahoo.timeseries:costOfRevenue", false, "money", "costOfRevenue"),
      grossProfit: S("Yahoo.timeseries:grossProfit", estHas("grossProfit@"), "money", "grossProfit"),
      operatingIncome: S("Yahoo.timeseries:operatingIncome", estHas("operatingIncome@"), "money", "operatingIncome"),
      interestExpense: S("Yahoo.timeseries:interestExpense", false, "money", "interestExpense"),
      otherIncome: S("Yahoo.timeseries:otherIncome", false, "money", "otherIncome"),
      depreciation: S("Yahoo.timeseries:depreciation", estHas("depreciation@"), "money", "depreciation", "depreciationAmortization"),
      ebitda: S("Yahoo.timeseries:ebitda", estHas("ebitda@"), "money", "ebitda"),
      accountsPayable: S("Yahoo.timeseries:accountsPayable", false, "money", "accountsPayable"),
      netReceivables: S("Yahoo.timeseries:netReceivables", false, "money", "netReceivables"),
      inventory: S("Yahoo.timeseries:inventory", false, "money", "inventory"),
      netFixedAssets: S("Yahoo.timeseries:netFixedAssets", false, "money", "netFixedAssets"),
    };
    if (arch === "bank") {
      // For banks, revenue is totalRevenue; corporate fictions stay missing (never synthesized)
      const bankMissingCorporate = ["costOfRevenue","grossProfit","ebitda","inventory","netReceivables","netFixedAssets","accountsPayable","depreciation"].filter(k=> !missingFields.includes(k));
      return {
        year: period, fiscalPeriod, periodType, statementType, missingFields: [...missingFields, ...bankMissingCorporate],
        revenue: S("Yahoo.timeseries:totalRevenue", false, "money", "totalRevenue", "revenue"),
        netInterestIncome: S("Yahoo.timeseries:netInterestIncome", false, "money", "netInterestIncome"),
        nonInterestIncome: S("Yahoo.timeseries:nonInterestIncome", false, "money", "nonInterestIncome"),
        totalRevenue: S("Yahoo.timeseries:totalRevenue", false, "money", "totalRevenue"),
        provisionForCreditLosses: S("Yahoo.timeseries:provisionForCreditLosses", false, "money", "provisionForCreditLosses"),
        nonInterestExpenses: S("Yahoo.timeseries:nonInterestExpenses", false, "money", "nonInterestExpenses"),
        loans: S("Yahoo.timeseries:loans", false, "money", "loans"),
        deposits: S("Yahoo.timeseries:deposits", false, "money", "deposits"),
        grossNPA: S("Yahoo.timeseries:grossNPA", false, "money", "grossNPA"),
        netNPA: S("Yahoo.timeseries:netNPA", false, "money", "netNPA"),
        capitalAdequacyRatio: S("Yahoo.timeseries:capitalAdequacyRatio", false, "pct", "capitalAdequacyRatio"),
        netInterestMargin: S("Yahoo.timeseries:netInterestMargin", false, "pct", "netInterestMargin", "netInterestMargin"),
        ...shared,
      };
    }
    if (arch === "insurance") {
      // Insurer revenue is NEP + investment income; bank/corporate fictions stay missing.
      const insMissingOther = ["costOfRevenue","grossProfit","ebitda","inventory","netReceivables","netFixedAssets","accountsPayable","depreciation","netInterestIncome","loans","deposits"].filter(k=> !missingFields.includes(k));
      return {
        year: period, fiscalPeriod, periodType, statementType, missingFields: [...missingFields, ...insMissingOther],
        revenue: S("Yahoo.timeseries:revenue", false, "money", "revenue", "netEarnedPremium"),
        grossWrittenPremium: S("Yahoo.timeseries:grossWrittenPremium", false, "money", "grossWrittenPremium"),
        netEarnedPremium: S("Yahoo.timeseries:netEarnedPremium", estHas("insurance:netEarnedPremium@"), "money", "netEarnedPremium"),
        claimsIncurred: S("Yahoo.timeseries:claimsIncurred", estHas("insurance:claims@"), "money", "claimsIncurred"),
        underwritingExpenses: S("Yahoo.timeseries:underwritingExpenses", estHas("insurance:underwritingExpenses@"), "money", "underwritingExpenses"),
        underwritingResult: S("Yahoo.timeseries:underwritingResult", false, "money", "underwritingResult"),
        lossRatio: S("Yahoo.timeseries:lossRatio", false, "ratio", "lossRatio"),
        expenseRatio: S("Yahoo.timeseries:expenseRatio", false, "ratio", "expenseRatio"),
        combinedRatio: S("Yahoo.timeseries:combinedRatio", false, "ratio", "combinedRatio"),
        investmentIncome: S("Yahoo.timeseries:investmentIncome", estHas("insurance:investmentIncome@"), "money", "investmentIncome"),
        float: S("Yahoo.timeseries:float", estHas("insurance:float-"), "money", "float"),
        policyholderLiabilities: S("Yahoo.timeseries:policyholderLiabilities", false, "money", "policyholderLiabilities"),
        solvencyRatio: S("Yahoo.timeseries:solvencyRatio", false, "pct", "solvencyRatio"),
        embeddedValue: S("Yahoo.timeseries:embeddedValue", false, "money", "embeddedValue"),
        ...shared,
      };
    }
    if (arch === "reit") {
      // REIT revenue is rental income; gross/EBITDA/inventory fictions stay missing.
      const reitMissingOther = ["costOfRevenue","grossProfit","ebitda","inventory","netReceivables","accountsPayable","depreciation"].filter(k=> !missingFields.includes(k));
      return {
        year: period, fiscalPeriod, periodType, statementType, missingFields: [...missingFields, ...reitMissingOther],
        revenue: S("Yahoo.timeseries:rentalIncome", false, "money", "revenue", "rentalIncome"),
        rentalIncome: S("Yahoo.timeseries:rentalIncome", false, "money", "rentalIncome"),
        netOperatingIncome: S("Yahoo.timeseries:netOperatingIncome", false, "money", "netOperatingIncome"),
        noiMargin: S("Yahoo.timeseries:noiMargin", false, "ratio", "noiMargin"),
        fundsFromOperations: S("Yahoo.timeseries:fundsFromOperations", false, "money", "fundsFromOperations"),
        adjustedFundsFromOperations: S("Yahoo.timeseries:adjustedFundsFromOperations", false, "money", "adjustedFundsFromOperations"),
        ffoPerShare: S("Yahoo.timeseries:ffoPerShare", false, "price", "ffoPerShare"),
        affoPerShare: S("Yahoo.timeseries:affoPerShare", false, "price", "affoPerShare"),
        occupancyPct: S("Yahoo.timeseries:occupancyPct", false, "pct", "occupancyPct"),
        netAssetValue: S("Yahoo.timeseries:netAssetValue", false, "money", "netAssetValue"),
        capRate: S("Yahoo.timeseries:capRate", false, "pct", "capRate"),
        investmentPropertyValue: S("Yahoo.timeseries:investmentPropertyValue", estHas("reit:investmentProperty@"), "money", "investmentPropertyValue"),
        ...shared,
      };
    }
    if (arch === "fee") {
      // Fee revenue is the top line; loan-book/underwriting/inventory fictions stay missing.
      const feeMissingOther = ["costOfRevenue","grossProfit","ebitda","inventory","netReceivables","netFixedAssets","accountsPayable","loans","deposits","combinedRatio"].filter(k=> !missingFields.includes(k));
      return {
        year: period, fiscalPeriod, periodType, statementType, missingFields: [...missingFields, ...feeMissingOther],
        revenue: S("Yahoo.timeseries:totalFeeRevenue", false, "money", "revenue", "totalFeeRevenue"),
        aumBeginning: S("Yahoo.timeseries:aumBeginning", estHas("fee:aum-"), "money", "aumBeginning"),
        aumEnding: S("Yahoo.timeseries:aumEnding", estHas("fee:aum-"), "money", "aumEnding"),
        netFlows: S("Yahoo.timeseries:netFlows", false, "money", "netFlows"),
        managementFees: S("Yahoo.timeseries:managementFees", false, "money", "managementFees"),
        performanceFees: S("Yahoo.timeseries:performanceFees", estHas("fee:performanceFees-"), "money", "performanceFees"),
        technologyServicesRevenue: S("Yahoo.timeseries:technologyServicesRevenue", estHas("fee:"), "money", "technologyServicesRevenue"),
        totalFeeRevenue: S("Yahoo.timeseries:totalFeeRevenue", false, "money", "totalFeeRevenue"),
        revenueAsPctOfAum: S("Yahoo.timeseries:revenueAsPctOfAum", false, "ratio", "revenueAsPctOfAum"),
        operatingExpenses: S("Yahoo.timeseries:operatingExpenses", estHas("fee:operatingExpenses@"), "money", "operatingExpenses"),
        operatingMargin: S("Yahoo.timeseries:operatingMargin", false, "ratio", "operatingMargin"),
        ...shared,
      };
    }
    // Corporate branch (Architecture A — unchanged economics, record-shaped access only)
    return {
      year: period, fiscalPeriod, periodType, statementType, missingFields,
      revenue: S("Yahoo.timeseries:revenue", false, "money", "revenue"),
      ...shared,
    };
  });

  const missing: string[] = [];
  if (price === null) missing.push("market.price");
  if (basicShares === null) missing.push("market.sharesBasic");
  if (dilutedShares === null) missing.push("market.sharesDiluted");
  if (marketCap === null) missing.push("market.marketCap");
  if (!currency || currency === "UNKNOWN") missing.push("market.currency");
  if (annualFinancials.length === 0) missing.push("statements.*");

  const graph: CanonicalFactGraph = {
    currency, scale, asOf,
    market: {
      price: mk(price, "Yahoo.quote:regularMarketPrice", "price"),
      sharesBasic: mk(basicShares, "Yahoo.keyStats:sharesOutstanding|statements", "shares"),
      sharesDiluted: { ...mk(dilutedShares, "derived:netIncome/dilutedEps|max(basic)", "shares"), dilutedBasis, dilutedReconciles },
      marketCap: mk(marketCap, "Yahoo.quote:marketCap", "money"),
      asOf,
    },
    years,
    missing,
  };
  return graph;
}
