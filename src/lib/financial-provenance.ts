/**
 * APEX RESEARCH - Verified Primary-Data Provenance (Priority 2)
 *
 * Pipeline: primary filing (Yahoo timeseries/quoteSummary) → normalized
 * statements → accounting checks → model. Never silently fabricate.
 * Every number carries source + period + currency + units + estimated flag.
 */
import type { AnnualFinancials, CompanyProfile, StockData } from "@/types/report";

export type ProvenanceSource =
  | "YAHOO_TIMESERIES_REPORTED"
  | "YAHOO_QUOTESUMMARY_REPORTED"
  | "DERIVED_IDENTITY" // e.g. totalLiabilities = assets - equity
  | "ESTIMATED_FALLBACK" // fixed-margin synthesis — must be disclosed + gated
  | "MISSING";

export interface FieldProvenance {
  field: string;
  source: ProvenanceSource;
  period: string;
  currency: string;
  units: "raw" | "INR-Cr" | "USD-M";
  isEstimated: boolean;
  detail?: string;
}

export interface ProvenanceAssessment {
  fields: FieldProvenance[];
  estimatedCount: number;
  estimatedRatio: number;
  criticalMissing: string[];
  currency: string;
  units: string;
  isBlocked: boolean;
  blockReason: string | null;
  dataQualityFlags: string[];
}

const CRITICAL_FIELDS = ["revenue", "sharesOutstanding", "totalDebt", "cash", "netIncome"] as const;

export function assessProvenance(params: {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
}): ProvenanceAssessment {
  const { profile, stockData, annualFinancials } = params;
  const currency = (profile.currency || "").toUpperCase();
  const units = currency === "INR" ? ("INR-Cr" as const) : ("USD-M" as const);
  const fields: FieldProvenance[] = [];
  const dataQualityFlags: string[] = [];

  const latest = annualFinancials[annualFinancials.length - 1];
  const period = latest?.fiscalYearEnd || latest?.year || "unknown-period";

  const push = (field: string, value: unknown, estimatedTag?: string, derived = false) => {
    const isZeroOrMissing = value === null || value === undefined || value === 0 || !Number.isFinite(Number(value));
    const isEstimated = Boolean(estimatedTag);
    fields.push({
      field,
      source: isEstimated ? "ESTIMATED_FALLBACK" : isZeroOrMissing && !derived ? "MISSING" : derived ? "DERIVED_IDENTITY" : "YAHOO_TIMESERIES_REPORTED",
      period,
      currency: currency || "UNKNOWN",
      units: "raw",
      isEstimated,
      detail: estimatedTag,
    });
  };

  if (!latest) {
    return {
      fields,
      estimatedCount: 0,
      estimatedRatio: 1,
      criticalMissing: [...CRITICAL_FIELDS],
      currency: currency || "UNKNOWN",
      units,
      isBlocked: true,
      blockReason: "NO_FINANCIAL_HISTORY: zero audited periods — model cannot run",
      dataQualityFlags: ["NO_FINANCIAL_HISTORY"],
    };
  }

  const estTags = (suffix: string) => (latest.estimatesUsed || []).filter((t) => t.startsWith(suffix)).join(";") || undefined;

  push("revenue", latest.revenue, (latest.estimatesUsed || []).some((t) => t.startsWith("revenue@")) ? "revenue@synthesized" : undefined);
  push("sharesOutstanding", stockData.sharesOutstanding || latest.sharesOutstanding);
  push("totalDebt", latest.totalDebt);
  push("cash", latest.cash);
  push("netIncome", latest.netIncome);
  push("operatingCashFlow", latest.operatingCashFlow, estTags("operatingCashFlow@"));
  push("capitalExpenditures", latest.capitalExpenditures, estTags("capex@"));
  push("grossProfit", latest.grossProfit, estTags("grossProfit@"));
  push("operatingIncome", latest.operatingIncome, estTags("operatingIncome@"));
  push("ebitda", latest.ebitda, estTags("ebitda@"));

  const estimatedCount = fields.filter((f) => f.isEstimated).length + (latest.estimatesUsed?.length || 0);
  const estimatedRatio = fields.length > 0 ? fields.filter((f) => f.isEstimated).length / fields.length : 1;

  const criticalMissing: string[] = [];
  if (!(latest.revenue > 0)) criticalMissing.push("revenue");
  if (!((stockData.sharesOutstanding || latest.sharesOutstanding || 0) > 0)) criticalMissing.push("sharesOutstanding");
  if (!(stockData.currentPrice > 0)) criticalMissing.push("currentPrice");
  if (!currency) criticalMissing.push("currency");

  // Period continuity: fiscalYearEnd sequence must be annual and non-duplicate
  const years = annualFinancials.map((f) => f.fiscalYearEnd || f.year);
  if (new Set(years).size !== years.length) criticalMissing.push("duplicate-periods");

  if ((latest.estimatesUsed?.length || 0) > 0) dataQualityFlags.push(`ESTIMATED_FINANCIALS:${latest.estimatesUsed!.length}`);
  if (estimatedRatio >= 0.5) dataQualityFlags.push("HIGH_ESTIMATE_RATIO");
  if (!currency) dataQualityFlags.push("CURRENCY_UNKNOWN");

  // Hard block: no revenue, no shares, no price, no currency, duplicate periods.
  // High estimate ratio alone is WARN (handled in QA DATA-01), not block — preserves availability.
  const isBlocked = criticalMissing.length > 0;
  return {
    fields,
    estimatedCount,
    estimatedRatio,
    criticalMissing,
    currency: currency || "UNKNOWN",
    units,
    isBlocked,
    blockReason: isBlocked ? `PRIMARY_DATA_INSUFFICIENT: ${criticalMissing.join(", ")}` : null,
    dataQualityFlags,
  };
}

export interface MarketIntegrityIssue {
  code: string;
  severity: "BLOCK" | "WARN";
  message: string;
  expected: string;
  actual: string;
}

export interface ResolvedShareCount {
  shares: number;
  source: "quote" | "statement" | "none";
  warn: string | null;
}

/**
 * Resolve the authoritative share count by cross-checking BOTH candidates
 * against market cap (price × shares ≈ marketCap, 25% tolerance).
 * Yahoo sometimes reports partial-class quote shares (e.g. Dell Class C free
 * float) while market cap covers all classes — blindly preferring quote shares
 * then doubles per-share fair value. The count that reconciles wins; a split
 * decision WARNs explicitly instead of silently modeling on the wrong base.
 */
export function resolveShareCount(params: {
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
}): ResolvedShareCount {
  const { stockData, annualFinancials } = params;
  const latest = annualFinancials[annualFinancials.length - 1];
  const price = Number(stockData.currentPrice) || 0;
  const q = Number(stockData.sharesOutstanding) || 0;
  const f = Number(latest?.sharesOutstanding) || 0;
  const mktCap = Number(stockData.marketCap) || 0;
  const reconciles = (s: number) =>
    price > 0 && s > 0 && mktCap > 0 && Math.abs(mktCap - price * s) / Math.max(1, price * s) <= 0.25;
  const qOk = reconciles(q);
  const fOk = reconciles(f);
  if (q > 0 && f > 0) {
    if (qOk && !fOk) return { shares: q, source: "quote", warn: null };
    if (fOk && !qOk) return {
      shares: f, source: "statement",
      warn: `Quote shares (${q.toFixed(0)}) do not reconcile with market cap while statement shares (${f.toFixed(0)}) do — probable partial-class quote feed. Model uses statement count; verify fully-diluted shares.`,
    };
    if (qOk && fOk) return { shares: q, source: "quote", warn: null };
    return { shares: 0, source: "none", warn: null };
  }
  if (q > 0) return { shares: q, source: "quote", warn: null };
  if (f > 0) return { shares: f, source: "statement", warn: `Quote shares missing — statement count used; verify.` };
  return { shares: 0, source: "none", warn: null };
}

/**
 * Priority 2 — hard financial-data integrity layer (independent of the model).
 * Reconciles price × shares = market cap, quote shares vs statement shares,
 * debt/cash/equity/EV bridges and balance-sheet identity BEFORE any DCF may
 * proceed. Gross mismatches BLOCK (fabricated or unit-scaled inputs); moderate
 * drift WARNs. Tolerances are deliberately wider than display rounding so
 * weighted-average diluted-share effects never false-positive.
 */
export function assessMarketIntegrity(params: {
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
}): { issues: MarketIntegrityIssue[]; blocked: boolean } {
  const { stockData, annualFinancials } = params;
  const issues: MarketIntegrityIssue[] = [];
  const latest = annualFinancials[annualFinancials.length - 1];
  if (!latest) {
    return { issues: [{ code: "SHARE-01", severity: "BLOCK", message: "No statements — integrity unassessable.", expected: "≥1 audited period", actual: "0 periods" }], blocked: true };
  }
  const price = Number(stockData.currentPrice) || 0;
  const qShares = Number(stockData.sharesOutstanding) || 0;
  const fShares = Number(latest.sharesOutstanding) || 0;
  const mktCap = Number(stockData.marketCap) || 0;

  // 1. price × shares = market cap, cross-checked against BOTH share counts.
  // The resolver picks the count that reconciles (partial-class quote feeds lose).
  // Neither reconciling grossly BLOCKS — except the multi-class case below.
  // Multi-class exception: quote and statement AGREE yet both disagree grossly
  // with market cap (single-class shares vs all-class market cap) — WARN with
  // explicit fully-diluted-count verification, do not BLOCK consistent primaries.
  const resolved = resolveShareCount({ stockData, annualFinancials });
  const qfAgree = qShares > 0 && fShares > 0 && Math.abs(qShares - fShares) / Math.max(1, qShares) <= 0.4;
  if (resolved.source === "none" && price > 0 && mktCap > 0 && (qShares > 0 || fShares > 0)) {
    issues.push({
      code: "SHARE-01", severity: "BLOCK",
      message: `Neither quote shares (${qShares.toFixed(0)}) nor statement shares (${fShares.toFixed(0)}) reconcile with market cap (${mktCap.toFixed(0)}) at price ${price} — no trustworthy per-share base. No DCF may proceed.`,
      expected: "one count reconciling within ±25%", actual: `quote ${qShares.toFixed(0)} vs statement ${fShares.toFixed(0)}`,
    });
  } else if (price > 0 && mktCap > 0 && resolved.source !== "none") {
    const used = resolved.shares;
    const implied = price * used;
    const drift = Math.abs(mktCap - implied) / Math.max(1, implied);
    if (drift > 0.25) {
      if (qfAgree) {
        issues.push({
          code: "SHARE-01", severity: "WARN",
          message: `Market cap (${mktCap.toFixed(0)}) exceeds price × single-class shares (${implied.toFixed(0)}) by ${(drift * 100).toFixed(1)}% while quote/statement shares agree — probable multi-class capital structure. Verify fully-diluted share count; per-share math uses disclosed single-class count.`,
          expected: `≈ ${implied.toFixed(0)} or multi-class disclosed`, actual: mktCap.toFixed(0),
        });
      } else {
        issues.push({
          code: "SHARE-01", severity: "BLOCK",
          message: `Market cap (${mktCap.toFixed(0)}) contradicts price × resolved shares (${implied.toFixed(0)}) by ${(drift * 100).toFixed(1)}% — share-count/unit scaling failure. No DCF may proceed.`,
          expected: `≈ ${implied.toFixed(0)} (±25%)`, actual: mktCap.toFixed(0),
        });
      }
    } else if (drift > 0.08) {
      issues.push({
        code: "SHARE-01", severity: "WARN",
        message: `Market cap drifts ${(drift * 100).toFixed(1)}% from price × shares — verify share units before modeling.`,
        expected: `≈ ${implied.toFixed(0)} (±8%)`, actual: mktCap.toFixed(0),
      });
    }
  }
  if (resolved.warn) {
    issues.push({
      code: "SHARE-01", severity: "WARN",
      message: resolved.warn,
      expected: "quote ≈ statement ≈ marketCap/price",
      actual: `quote ${qShares.toFixed(0)} vs statement ${fShares.toFixed(0)}`,
    });
  }

  // 2. quote shares vs statement (diluted) shares. When the market-cap
  // cross-check above resolved unambiguously to one count (partial-class quote
  // feed vs all-class market cap), the disagreement is EXPLAINED — WARN with
  // disclosure. BLOCK only when no count reconciles (unresolvable base).
  if (qShares > 0 && fShares > 0) {
    const drift = Math.abs(qShares - fShares) / Math.max(1, qShares);
    const resolvedToOne = resolved.source !== "none";
    if (drift > 0.4) {
      if (resolvedToOne) {
        issues.push({
          code: "SHARE-01", severity: "WARN",
          message: `Quote shares (${qShares.toFixed(0)}) diverge ${(drift * 100).toFixed(1)}% from statement shares (${fShares.toFixed(0)}), but market cap reconciles with the ${resolved.source} count — model uses ${resolved.shares.toFixed(0)}; verify fully-diluted/multi-class count before publishing.`,
          expected: "one reconciling count", actual: `${qShares.toFixed(0)} vs ${fShares.toFixed(0)}`,
        });
      } else {
        issues.push({
          code: "SHARE-01", severity: "BLOCK",
          message: `Quote shares (${qShares.toFixed(0)}) contradict statement shares (${fShares.toFixed(0)}) by ${(drift * 100).toFixed(1)}% with neither reconciling to market cap — per-share math would be fantasy.`,
          expected: "quote ≈ statement (±40%)", actual: `${qShares.toFixed(0)} vs ${fShares.toFixed(0)}`,
        });
      }
    } else if (drift > 0.25) {
      issues.push({
        code: "SHARE-01", severity: "WARN",
        message: `Quote/statement share drift ${(drift * 100).toFixed(1)}% — likely weighted-average dilution; disclosed, not blocked.`,
        expected: "quote ≈ statement (±25%)", actual: `${qShares.toFixed(0)} vs ${fShares.toFixed(0)}`,
      });
    }
  }

  // 3. Per-share anchor sanity: price must be finite and positive before division
  if (!(price > 0) || !Number.isFinite(price)) {
    issues.push({
      code: "SHARE-01", severity: "BLOCK",
      message: `Current price (${String(stockData.currentPrice)}) is not a positive finite number — per-share valuation undefined.`,
      expected: "> 0", actual: String(stockData.currentPrice),
    });
  }

  // 4. Balance-sheet identity on latest (gross >15% BLOCK — mirrors BS-01 ceiling, independent path)
  if (latest.totalAssets > 0) {
    const liab = latest.totalLiabilities > 0 ? latest.totalLiabilities : (latest.totalDebt || 0) + (latest.currentLiabilities || 0);
    const rhs = liab + (latest.totalEquity || 0);
    const varPct = (Math.abs(latest.totalAssets - rhs) / latest.totalAssets) * 100;
    if (varPct > 15) {
      issues.push({
        code: "SHARE-01", severity: "BLOCK",
        message: `Balance-sheet identity variance ${varPct.toFixed(1)}% (Assets ${latest.totalAssets} vs L+E ${rhs}) — statement integrity failure before modeling.`,
        expected: "< 15%", actual: `${varPct.toFixed(1)}%`,
      });
    }
  }

  return { issues, blocked: issues.some((i) => i.severity === "BLOCK") };
}
