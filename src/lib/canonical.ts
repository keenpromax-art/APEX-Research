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
import { QA_GATES_ENABLED } from "./qa-gates";

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
  decision: "READY" | "READY_WITH_WARNINGS" | "BLOCKED";
  warnings: string[];
}

function hasInvalidReconciliation(entries: unknown): boolean {
  return Array.isArray(entries) && entries.some((entry) => Boolean((entry as { invalid?: boolean })?.invalid));
}

export function canPublishReport(data: ReportData | null | undefined): PublishGate {
  if (!data) {
    return { canPublish: false, reasons: ["No report data"], decision: "BLOCKED", warnings: [] };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];
  const identity = identityIssues(data);
  if (identity.length > 0) reasons.push(...identity.map((issue) => `Identity: ${issue}`));
  if (!data.qaReport) reasons.push("Pre-publish QA has not run (qaReport missing)");
  else if (data.qaReport.gateStatus === "BLOCKED") {
    for (const check of data.qaReport.checks.filter((item) => item.status === "FAIL")) reasons.push(`${check.id}: ${check.name}`);
    if (data.qaReport.checks.every((item) => item.status !== "FAIL")) reasons.push("QA gate BLOCKED with no itemized failures");
  }
  if (!data.finalQAResult) reasons.push("Final QA result missing");
  else if (!data.finalQAResult.canPublish) {
    for (const error of data.finalQAResult.errors || []) {
      const code = (error as { code?: string }).code ? `${(error as { code?: string }).code}: ` : "";
      reasons.push(`${code}${(error as { message?: string }).message || "Final QA error"}`);
    }
    if (reasons.length === 0) reasons.push("Final QA disallows publication");
  }
  if (!data.canonicalForecast) reasons.push("Canonical forecast is missing");
  if (!data.researchCase) reasons.push("Research case is missing");
  if (!data.evidenceRegistry || data.evidenceRegistry.items.length === 0) reasons.push("Evidence registry is missing or empty");
  if (data.researchGraph) {
    if (!data.researchGraph.materialClaimsTraceable) reasons.push("Evidence graph contains untraceable material claims");
    for (const blocker of data.researchGraph.blockers) reasons.push(`Evidence graph: ${blocker}`);
  } else {
    warnings.push("Evidence graph has not been attached");
  }
  if (hasInvalidReconciliation(data.reconciliation)) reasons.push("Primary/secondary source reconciliation contains an invalid field");
  if (data.independentReport?.issues?.some((issue) => issue.severity === "FAIL")) reasons.push("Independent validator contains a failure");
  if (data.researchReport && data.researchReport.reviewPassed === false) reasons.push("Attached AI-first research review did not pass");
  if (data.assumptionsLedger && data.researchCase?.assumptionsLedger && data.assumptionsLedger !== data.researchCase.assumptionsLedger) {
    warnings.push("Report and ResearchCase assumptions ledgers are not the same object");
  }
  if (data.aiAnalysis?.councilVerification?.status === "FLAGGED") warnings.push("Council verification is flagged");

  const strict = QA_GATES_ENABLED;
  const decision = reasons.length > 0 && strict ? "BLOCKED" : reasons.length > 0 || warnings.length > 0 ? "READY_WITH_WARNINGS" : "READY";
  return {
    canPublish: !strict || reasons.length === 0,
    reasons,
    decision,
    warnings,
  };
}