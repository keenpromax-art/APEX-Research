/**
 * APEX RESEARCH — Data Confidence Tiers (claim-level provenance taxonomy)
 *
 * Every load-bearing number carries one tier:
 *
 *   VERIFIED_SECONDARY — reported by Yahoo (exchange-grade secondary source)
 *   DERIVED            — computed deterministically from verified inputs, or a
 *                        documented synthesis disclosed via estimatesUsed
 *   AI_ASSUMPTION      — an LLM chose it (growth/margin paths, categorizations)
 *   UNVERIFIED         — present but ambiguous (e.g. a zero that could be a
 *                        genuine nil or a missing field; see canonical facts)
 *   MISSING            — absent (null/undefined/NaN)
 *
 * This is the taxonomy layer only — it grades, it never blocks. Fail-closed
 * gates (DATA-01, SHARE-01, XREF-*) keep owning publication decisions, now
 * with tier-labeled evidence behind them.
 */

import type { AnnualFinancials, DCFResult, StockData } from "@/types/report";

export type ConfidenceTier =
  | "VERIFIED_SECONDARY"
  | "DERIVED"
  | "AI_ASSUMPTION"
  | "UNVERIFIED"
  | "MISSING";

export interface FieldConfidence {
  field: string;
  tier: ConfidenceTier;
  source: string;
  note: string;
}

export interface DataConfidenceReport {
  fields: FieldConfidence[];
  /** A = fully reported · B = minor gaps · C = material gaps · D = insufficient */
  grade: "A" | "B" | "C" | "D";
  summary: string;
  assessedAt: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Tier a raw input field: reported vs estimated vs missing. */
function tierInput(value: unknown, estimated: boolean, source: string): FieldConfidence {
  if (!isNum(value)) {
    return { field: "", tier: "MISSING", source, note: "Field absent from the feed." };
  }
  if (estimated) {
    return { field: "", tier: "DERIVED", source: `${source} (documented synthesis)`, note: "Synthesized via disclosed fallback — see estimatesUsed; treat bands, not points." };
  }
  if (value === 0) {
    return { field: "", tier: "UNVERIFIED", source, note: "Reads zero — reported nil and missing field are indistinguishable at this layer; canonical facts disambiguate." };
  }
  return { field: "", tier: "VERIFIED_SECONDARY", source, note: "Reported by Yahoo Finance." };
}

/** Grade + confidence for the inputs behind one report (pure). */
export function assessDataConfidence(args: {
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  dcf: DCFResult;
  aiOverridesUsed: boolean;
}): DataConfidenceReport {
  const { stockData, annualFinancials, dcf, aiOverridesUsed } = args;
  const latest: any = annualFinancials[annualFinancials.length - 1] || {};
  const estTags: string[] = Array.isArray(latest.estimatesUsed) ? latest.estimatesUsed : [];
  const estimated = (prefix: string): boolean => estTags.some((t) => t.startsWith(prefix));

  const fields: FieldConfidence[] = [];
  const push = (field: string, fc: Omit<FieldConfidence, "field">) => fields.push({ ...fc, field });

  // Price/shares are strictly positive when reported — a zero is a missing
  // field, not a nil. Market cap instead falls back to price × shares
  // (DERIVED) before being declared missing.
  const price: unknown = stockData.currentPrice;
  const shares: unknown = stockData.sharesOutstanding || latest.sharesOutstanding;
  push("currentPrice", !isNum(price) || price <= 0
    ? { tier: "MISSING", source: "Yahoo quote", note: "No positive price on record." }
    : tierInput(price, false, "Yahoo quote"));
  push("sharesOutstanding", !isNum(shares) || (shares as number) <= 0
    ? { tier: "MISSING", source: "Yahoo quote/statements", note: "No positive share count on record." }
    : tierInput(shares, false, "Yahoo quote/statements"));
  push("marketCap", isNum(stockData.marketCap) && stockData.marketCap > 0
    ? tierInput(stockData.marketCap, false, "Yahoo quote")
    : isNum(price) && (price as number) > 0 && isNum(shares) && (shares as number) > 0
      ? { tier: "DERIVED", source: "price × shares", note: "Feed omitted market cap; derived from price × resolved shares." }
      : { tier: "MISSING", source: "Yahoo quote", note: "Field absent from the feed." });
  push("revenue", tierInput(latest.revenue ?? latest.totalRevenue, estimated("revenue@"), "Yahoo timeseries"));
  push("netIncome", tierInput(latest.netIncome, estimated("netIncome@"), "Yahoo timeseries"));
  push("totalEquity", tierInput(latest.totalEquity, false, "Yahoo timeseries"));
  push("totalDebt", tierInput(latest.totalDebt, false, "Yahoo timeseries"));
  push("cash", tierInput(latest.cash, false, "Yahoo timeseries"));
  push("operatingCashFlow", tierInput(latest.operatingCashFlow, estimated("operatingCashFlow@"), "Yahoo timeseries"));
  push("freeCashFlow", tierInput(latest.freeCashFlow, estimated("fcf@"), "Yahoo timeseries"));

  const dcfValid = (dcf as any)?.status === "valid";
  push("fairValue", {
    tier: dcfValid ? "DERIVED" : "UNVERIFIED",
    source: dcfValid ? "deterministic DCF engine" : "no validated model output",
    note: dcfValid ? "Computed from verified inputs through audited arithmetic." : "Model produced no positive equity — any displayed value is an NR anchor, not a valuation.",
  });
  push("forecastGrowth", {
    tier: aiOverridesUsed ? "AI_ASSUMPTION" : "DERIVED",
    source: aiOverridesUsed ? "AI DCF assumptions (bounded)" : "mechanical history blend",
    note: aiOverridesUsed ? "LLM-selected path inside validation clamps; code executed the math." : "Winsorized historical CAGR blend; no AI judgment involved.",
  });

  const missing = fields.filter((f) => f.tier === "MISSING").length;
  const unverified = fields.filter((f) => f.tier === "UNVERIFIED").length;
  const grade = missing >= 3 ? "D" : missing >= 1 || unverified >= 3 ? "C" : unverified >= 1 ? "B" : "A";
  return {
    fields,
    grade,
    summary: `Data confidence ${grade}: ${fields.filter((f) => f.tier === "VERIFIED_SECONDARY").length}/${fields.length} fields exchange-reported${missing > 0 ? `, ${missing} missing` : ""}${unverified > 0 ? `, ${unverified} ambiguous-zero` : ""}.`,
    assessedAt: new Date().toISOString(),
  };
}

export default { assessDataConfidence };
