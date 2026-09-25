import type { AssumptionsLedger, DCFResult } from "@/types/report";
import type { CanonicalForecast } from "@/lib/canonical-forecast";
import type { ResearchReport } from "@/lib/ai-first/types";

export interface ForecastCompatibilityInput {
  profileTicker?: string | null;
  canonicalForecast?: CanonicalForecast | null;
  assumptionsLedger?: AssumptionsLedger | null;
  canonicalValuation?: DCFResult | null;
  researchReport?: ResearchReport | null;
  fairValueTolerancePct?: number;
  upsideTolerancePct?: number;
}

export interface ForecastCompatibilityCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ForecastCompatibilityResult {
  compatible: boolean;
  qualitativeCompatible: boolean;
  checks: ForecastCompatibilityCheck[];
  issues: string[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function closeEnough(actual: number, expected: number, tolerancePct: number): boolean {
  const tolerance = Math.max(Math.abs(expected) * tolerancePct, 0.01);
  return Math.abs(actual - expected) <= tolerance;
}

export function checkForecastCompatibility(input: ForecastCompatibilityInput): ForecastCompatibilityResult {
  const fairValueTolerancePct = input.fairValueTolerancePct ?? 0.01;
  const upsideTolerancePct = input.upsideTolerancePct ?? 0.01;
  const checks: ForecastCompatibilityCheck[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  const report = input.researchReport;

  if (!report) {
    add("research-report", false, "AI-first research report is absent.");
    return { compatible: false, qualitativeCompatible: false, checks, issues: ["AI-first research report is absent."] };
  }
  add("research-report", true, "AI-first research report is present.");

  if (input.profileTicker && report.companyTicker && input.profileTicker.toUpperCase() !== report.companyTicker.toUpperCase()) {
    add("ticker", false, `Ticker mismatch: requested ${input.profileTicker}, research report ${report.companyTicker}.`);
  } else {
    add("ticker", true, "Research report ticker matches the requested company.");
  }

  if (report.reviewPassed !== true) {
    add("review", false, "AI-first quality review did not pass.");
  } else {
    add("review", true, "AI-first quality review passed.");
  }

  if (!input.canonicalForecast || input.canonicalForecast.projections.length === 0) {
    add("canonical-forecast", false, "Canonical forecast is missing or has no projections.");
  } else {
    add("canonical-forecast", true, `Canonical forecast contains ${input.canonicalForecast.projections.length} projections.`);
  }

  if (!input.assumptionsLedger) {
    add("canonical-ledger", false, "Canonical assumptions ledger is missing.");
  } else {
    add("canonical-ledger", true, "Canonical assumptions ledger is present.");
  }

  const ledgerValue = input.assumptionsLedger?.fairValue ?? input.assumptionsLedger?.targetPrice;
  const aiValue = report.valuation?.fairValuePerShare;
  if (finite(ledgerValue) && finite(aiValue)) {
    const passed = closeEnough(aiValue, ledgerValue, fairValueTolerancePct);
    add("fair-value", passed, passed ? `AI fair value ${aiValue.toFixed(2)} matches canonical ${ledgerValue.toFixed(2)}.` : `AI fair value ${aiValue.toFixed(2)} diverges from canonical ${ledgerValue.toFixed(2)}.`);
  } else {
    add("fair-value", false, "AI or canonical fair value is unavailable.");
  }

  const baseScenario = report.scenarios?.find((scenario) => scenario.name === "base");
  const baseTarget = baseScenario?.targetPrice;
  const canonicalTarget = input.assumptionsLedger?.targetPrice;
  if (finite(baseTarget) && finite(canonicalTarget)) {
    const passed = closeEnough(baseTarget, canonicalTarget, fairValueTolerancePct);
    add("base-scenario", passed, passed ? `AI base target ${baseTarget.toFixed(2)} matches canonical ${canonicalTarget.toFixed(2)}.` : `AI base target ${baseTarget.toFixed(2)} diverges from canonical ${canonicalTarget.toFixed(2)}.`);
  } else {
    add("base-scenario", false, "AI base scenario or canonical target is unavailable.");
  }

  const aiUpside = report.valuation?.upsidePct;
  const canonicalUpside = input.assumptionsLedger?.upsideDownsidePct;
  if (finite(aiUpside) && finite(canonicalUpside)) {
    const passed = closeEnough(aiUpside / 100, canonicalUpside, upsideTolerancePct);
    add("upside", passed, passed ? `AI upside ${aiUpside.toFixed(2)}% matches canonical ${(canonicalUpside * 100).toFixed(2)}%.` : `AI upside ${aiUpside.toFixed(2)}% diverges from canonical ${(canonicalUpside * 100).toFixed(2)}%.`);
  } else {
    add("upside", false, "AI or canonical upside is unavailable.");
  }

  const issues = checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`);
  const qualitativeIds = new Set(["research-report", "ticker", "review"]);
  const qualitativeCompatible = checks.filter((check) => !qualitativeIds.has(check.id)).every((check) => check.passed);
  return { compatible: issues.length === 0, qualitativeCompatible, checks, issues };
}

export function isForecastCompatible(input: ForecastCompatibilityInput): boolean {
  return checkForecastCompatibility(input).compatible;
}
