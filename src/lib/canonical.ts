/**
 * CANONICAL SELECTORS — single source of truth for cross-section consistency.
 *
 * Every renderer (web hero, PDF cover/KPI/thesis/moat/catalyst/comps/QA pages)
 * MUST read fair value, CMP, rating, moat, WACC and scenarios through these
 * helpers. Direct reads of `data.targetPrice`, `data.dcf.intrinsicValue`,
 * `data.recommendation` or `dcf.verdict` in render code are banned: the ledger
 * legitimately overrides raw DCF outputs (NR anchors, bank RI model, 1%
 * reconciliation flips), so dual reads print two different numbers.
 */
import type { ReportData } from "@/types/report";

export interface CanonicalValuation {
  cmp: number;
  fv: number;
  targetPrice: number;
  upside: number;
  rating: "BUY" | "HOLD" | "SELL" | "NR";
  /** Where the numbers came from — "report" means the ledger was missing. */
  source: "ledger" | "report";
}

export function canonicalValuation(data: ReportData): CanonicalValuation {
  const ledger = data.assumptionsLedger;
  if (ledger && ledger.targetPrice > 0 && ledger.currentPrice > 0) {
    return {
      cmp: ledger.currentPrice,
      fv: ledger.fairValue,
      targetPrice: ledger.targetPrice,
      upside: ledger.upsideDownsidePct,
      rating: ledger.rating,
      source: "ledger",
    };
  }
  const cmp = data.cmp || data.stockData?.currentPrice || 0;
  const targetPrice = data.targetPrice || data.dcf?.intrinsicValue || 0;
  const upside = cmp > 0 && targetPrice > 0 ? targetPrice / cmp - 1 : 0;
  return {
    cmp,
    fv: targetPrice,
    targetPrice,
    upside,
    rating: data.recommendation || "NR",
    source: "report",
  };
}

export function canonicalRating(data: ReportData): "BUY" | "HOLD" | "SELL" | "NR" {
  return canonicalValuation(data).rating;
}

export interface CanonicalMoat {
  rating: "Wide" | "Narrow" | "None";
  trend: string;
}

/** Ledger first, canonical facts second — never the AI narrative. */
export function canonicalMoat(data: ReportData): CanonicalMoat {
  const ledger = data.assumptionsLedger;
  if (ledger?.moatRating) {
    return { rating: ledger.moatRating, trend: ledger.moatTrend || "Stable" };
  }
  const factsMoat = (data.masterReportFacts as any)?.moat;
  if (factsMoat?.rating === "Wide" || factsMoat?.rating === "Narrow" || factsMoat?.rating === "None") {
    return { rating: factsMoat.rating, trend: factsMoat.trend || "Stable" };
  }
  return { rating: "Narrow", trend: "Stable" };
}

/** Ledger WACC, else DCF assumption, else null (renderers show N/M — no fake 9.5%). */
export function canonicalWacc(data: ReportData): number | null {
  const w = data.assumptionsLedger?.wacc ?? data.dcf?.assumptions?.wacc;
  return typeof w === "number" && isFinite(w) && w > 0 ? w : null;
}

/** Ledger scenarios only — renderers must not recompute ×1.25/×0.75. */
export function canonicalScenarios(data: ReportData) {
  return data.assumptionsLedger?.scenarios || null;
}

/**
 * Company-identity integrity flags. Any non-empty result means the report may
 * describe the wrong company, sector, or currency — QA must block export.
 */
export function identityIssues(data: ReportData): string[] {
  const issues: string[] = [];
  const p = data.profile;
  if (!p) {
    issues.push("Company profile missing");
    return issues;
  }
  if (!p.sector || p.sector === "N/A") issues.push(`Sector unknown ("${p.sector || "missing"}") — sector routing fell back to General`);
  if (!p.industry || p.industry === "N/A") issues.push(`Industry unknown ("${p.industry || "missing"}")`);
  if (!p.name || p.name === p.ticker) issues.push("Company name equals ticker — Yahoo returned no verifiable identity");
  if (!p.exchange) issues.push("Exchange unknown — listing venue unverified");
  if (!p.currency) issues.push("Currency unknown — money figures unverifiable");
  return issues;
}

export interface PublishGate {
  canPublish: boolean;
  reasons: string[];
}

/**
 * THE canonical publish gate — fail-closed. Every surface (download button,
 * banners, badges) must use this. Missing QA objects block: an unaudited
 * report is not a publishable report.
 */
export function canPublishReport(data: ReportData | null | undefined): PublishGate {
  if (!data) return { canPublish: false, reasons: ["No report data"] };
  const reasons: string[] = [];
  if (!data.qaReport) {
    reasons.push("Pre-publish QA has not run (qaReport missing)");
  } else if (data.qaReport.gateStatus === "BLOCKED") {
    for (const c of data.qaReport.checks.filter((c) => c.status === "FAIL")) {
      reasons.push(`${c.id}: ${c.name}`);
    }
    if (reasons.length === 0) reasons.push("QA gate BLOCKED with no itemized failures");
  }
  if (!data.finalQAResult) {
    reasons.push("Final QA result missing");
  } else if (!data.finalQAResult.canPublish) {
    for (const e of data.finalQAResult.errors || []) {
      const code = (e as any).code ? `${(e as any).code}: ` : "";
      if (!reasons.some((r) => r.includes(code.trim()))) {
        reasons.push(`${code}${(e as any).message || "Final QA error"}`);
      }
    }
    if (!reasons.some((r) => r.includes("Final QA"))) {
      reasons.push("Final QA disallows publication");
    }
  }
  return { canPublish: reasons.length === 0, reasons };
}
