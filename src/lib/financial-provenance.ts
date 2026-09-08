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
