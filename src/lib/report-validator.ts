/**
 * APEX RESEARCH - Report Consistency Validator & Publication Gate
 * 
 * Strict Financial Invariant:
 * "A report must only be published when the underlying facts, calculations,
 * narrative, and PDF are internally consistent."
 * 
 * Publication Gate:
 * If any HARD BLOCK issue is present, status is "BLOCKED" and export is prohibited.
 * Only if all hard checks pass is status "PASS" (or "WARNING" for soft advisories).
 */

import { validateFinancialIdentities, FinancialValidationResult } from "./financial-validation";
import { validateRecommendationConsistency } from "./recommendation";
import { validateScenarioSet } from "./scenarios";
import { classifySector, validateSectorConcepts } from "./sectors/profiles";
import type { MasterReportFacts } from "./report-facts";
import type { ReportData } from "@/types/report";

export type QASeverity = "CRITICAL_BLOCK" | "WARNING" | "INFO";

export interface QAIssue {
  code: string;
  layer: "LAYER_A_SOURCE_DATA" | "LAYER_B_FINANCIAL_MODEL" | "LAYER_C_NARRATIVE_INTEGRITY" | "LAYER_D_PDF_LAYOUT";
  severity: QASeverity;
  section: string;
  message: string;
  expected?: string | number | null;
  actual?: string | number | null;
}

export interface FinalReportQAResult {
  status: "PASS" | "WARNING" | "BLOCKED";
  canPublish: boolean;
  score: number; // 0 to 100
  timestamp: string;
  errors: QAIssue[];
  warnings: QAIssue[];
  layerSummaries: {
    layerA: "PASS" | "WARN" | "FAIL";
    layerB: "PASS" | "WARN" | "FAIL";
    layerC: "PASS" | "WARN" | "FAIL";
    layerD: "PASS" | "WARN" | "FAIL";
  };
}

/**
 * Validates a MasterReportFacts instance and compiled report data before publication.
 */
export function validateMasterReport(
  facts: MasterReportFacts,
  reportData?: ReportData
): FinalReportQAResult {
  const errors: QAIssue[] = [];
  const warnings: QAIssue[] = [];

  // =========================================================================
  // LAYER A: SOURCE DATA QA
  // =========================================================================
  const priceVal = facts.market.currentPrice.value;
  if (!priceVal || priceVal <= 0 || !Number.isFinite(priceVal)) {
    errors.push({
      code: "DATA_INVALID_PRICE",
      layer: "LAYER_A_SOURCE_DATA",
      severity: "CRITICAL_BLOCK",
      section: "market",
      message: `Invalid market price (${priceVal}). Publication blocked.`,
      expected: "> 0",
      actual: priceVal ?? "null"
    });
  }

  const sharesVal = facts.market.sharesOutstanding.shares;
  if (!sharesVal || sharesVal <= 0 || !Number.isFinite(sharesVal)) {
    errors.push({
      code: "DATA_INVALID_SHARES",
      layer: "LAYER_A_SOURCE_DATA",
      severity: "CRITICAL_BLOCK",
      section: "market",
      message: `Invalid shares outstanding count (${sharesVal}).`,
      expected: "> 0",
      actual: sharesVal
    });
  }

  if (facts.financials.history.length < 2) {
    warnings.push({
      code: "DATA_LIMITED_HISTORY",
      layer: "LAYER_A_SOURCE_DATA",
      severity: "WARNING",
      section: "financials",
      message: `Company has only ${facts.financials.history.length} fiscal period(s) of reported data. Multi-year CAGR reliability is reduced.`
    });
  }

  if (facts.peers.coverageStatus === "warning" || facts.peers.coverageStatus === "suppressed") {
    warnings.push({
      code: "DATA_LOW_PEER_COVERAGE",
      layer: "LAYER_A_SOURCE_DATA",
      severity: "WARNING",
      section: "peers",
      message: `Peer coverage is ${(facts.peers.peerCoverage * 100).toFixed(0)}% (${facts.peers.validPeers}/${facts.peers.totalPeers} peers). Relative multiple rankings may be skewed.`
    });
  }

  // =========================================================================
  // LAYER B: FINANCIAL & ACCOUNTING QA
  // =========================================================================
  if (reportData && reportData.annualFinancials && reportData.stockData) {
    const sector = facts?.company?.sector || reportData?.profile?.sector || "";
    const industry = facts?.company?.industry || reportData?.profile?.industry || "";
    const description = facts?.company?.description || reportData?.profile?.description || "";
    const isFinancialInstitution = classifySector(sector, industry, description).isFinancialInstitution;

    const identities = validateFinancialIdentities({
      annualFinancials: reportData.annualFinancials,
      stockData: reportData.stockData,
      dcf: reportData.dcf,
      isFinancialInstitution
    });

    for (const issue of identities.issues) {
      if (issue.severity === "FATAL") {
        errors.push({
          code: issue.code,
          layer: "LAYER_B_FINANCIAL_MODEL",
          severity: "CRITICAL_BLOCK",
          section: "accounting_identities",
          message: issue.message,
          expected: issue.expected,
          actual: issue.actual
        });
      } else if (issue.severity === "FLAG") {
        warnings.push({
          code: issue.code,
          layer: "LAYER_B_FINANCIAL_MODEL",
          severity: "WARNING",
          section: "accounting_identities",
          message: issue.message,
          expected: issue.expected,
          actual: issue.actual
        });
      }
    }
  }

  // Check Recommendation Deterministic Invariant.
  // Exemption: when inputs were insufficient the ledger mandates NR (there is
  // no model output to contradict). Any directional call under any model
  // failure is still checked — NR-by-construction is the only free pass.
  const modelUnusable = Boolean((reportData?.assumptionsLedger as any)?.insufficientData);
  const declaredForRecCheck: string = facts.recommendation?.rating || "HOLD";
  const recCheck = (modelUnusable && (declaredForRecCheck === "NR" || declaredForRecCheck === "NOT RATED"))
    ? { valid: true, issues: [] as string[] }
    : validateRecommendationConsistency(
      priceVal,
      facts.valuation.fairValue.value,
      declaredForRecCheck
    );
  if (!recCheck.valid) {
    for (const issue of recCheck.issues) {
      errors.push({
        code: "VALUATION_RECOMMENDATION_MISMATCH",
        layer: "LAYER_B_FINANCIAL_MODEL",
        severity: "CRITICAL_BLOCK",
        section: "recommendation",
        message: issue
      });
    }
  }

  // Check Scenario Mathematics & Ordering
  if (facts.scenarios) {
    const scenarioCheck = validateScenarioSet(facts.scenarios);
    if (!scenarioCheck.valid) {
      for (const issue of scenarioCheck.issues) {
        errors.push({
          code: "SCENARIO_MATH_INVALID",
          layer: "LAYER_B_FINANCIAL_MODEL",
          severity: "CRITICAL_BLOCK",
          section: "scenarios",
          message: issue
        });
      }
    }
  }

  // =========================================================================
  // LAYER C: NARRATIVE QA & CROSS-REFERENCE INTEGRITY
  // =========================================================================
  // Header vs Valuation Fair Value
  const headerFv = reportData?.targetPrice ?? facts.valuation.fairValue.value;
  const valuationFv = facts.valuation.fairValue.value;
  if (headerFv !== null && valuationFv !== null && Math.abs(headerFv - valuationFv) > 0.05) {
    errors.push({
      code: "NARRATIVE_FAIR_VALUE_CONTRADICTION",
      layer: "LAYER_C_NARRATIVE_INTEGRITY",
      severity: "CRITICAL_BLOCK",
      section: "header_vs_valuation",
      message: `Header target price (${headerFv}) contradicts Valuation model fair value (${valuationFv}).`,
      expected: valuationFv,
      actual: headerFv
    });
  }

  // Header vs Thesis Rating
  const headerRating = reportData?.recommendation ?? facts.recommendation?.rating;
  const modelRating = facts.recommendation?.rating;
  if (modelRating && headerRating !== modelRating) {
    errors.push({
      code: "NARRATIVE_RATING_CONTRADICTION",
      layer: "LAYER_C_NARRATIVE_INTEGRITY",
      severity: "CRITICAL_BLOCK",
      section: "header_vs_thesis",
      message: `Header rating '${headerRating}' contradicts deterministic model rating '${modelRating}'.`,
      expected: modelRating,
      actual: headerRating
    });
  }

  // Moat Rating Canonicalization
  if (!facts.moat.rating || !["Wide", "Narrow", "None"].includes(facts.moat.rating)) {
    errors.push({
      code: "MOAT_INVALID",
      layer: "LAYER_C_NARRATIVE_INTEGRITY",
      severity: "CRITICAL_BLOCK",
      section: "moat",
      message: `Moat rating '${facts.moat.rating}' is not one of canonical options ('Wide', 'Narrow', 'None').`
    });
  }

  // Moat Narrative vs Canonical Fact Consistency
  if (reportData?.aiAnalysis?.investmentThesis) {
    const thesisLower = (reportData.aiAnalysis.investmentThesis + " " + ((reportData.aiAnalysis as any).economicMoatCommentary || reportData.aiAnalysis.businessStrategyCommentary || "")).toLowerCase();
    if (facts.moat.rating === "None" && (thesisLower.includes("wide structural moat") || thesisLower.includes("wide economic moat") || thesisLower.includes("wide moat"))) {
      errors.push({
        code: "MOAT_NARRATIVE_CONTRADICTION",
        layer: "LAYER_C_NARRATIVE_INTEGRITY",
        severity: "CRITICAL_BLOCK",
        section: "moat",
        message: "Narrative claims a 'Wide moat', contradicting canonical 'None' economic moat rating.",
        expected: "None",
        actual: "Wide"
      });
    } else if (facts.moat.rating === "Wide" && (thesisLower.includes("no economic moat") || thesisLower.includes("moat: none") || thesisLower.includes("lacks an economic moat"))) {
      errors.push({
        code: "MOAT_NARRATIVE_CONTRADICTION",
        layer: "LAYER_C_NARRATIVE_INTEGRITY",
        severity: "CRITICAL_BLOCK",
        section: "moat",
        message: "Narrative claims 'No economic moat', contradicting canonical 'Wide' economic moat rating.",
        expected: "Wide",
        actual: "None"
      });
    }
  }

  // Uncertainty Canonicalization (If valuation invalid, must be N/A)
  if (!facts.valuation.fairValue.value && facts.risks.uncertainty.rating !== "N/A") {
    errors.push({
      code: "UNCERTAINTY_INVALID_ON_NULL_VALUATION",
      layer: "LAYER_C_NARRATIVE_INTEGRITY",
      severity: "CRITICAL_BLOCK",
      section: "risks",
      message: `Valuation is invalid/missing, but uncertainty is '${facts.risks.uncertainty.rating}' instead of 'N/A'.`
    });
  }

  // Sector Leakage Check
  if (reportData?.aiAnalysis) {
    const sectorProfile = classifySector(
      reportData.profile.sector,
      reportData.profile.industry,
      reportData.profile.description
    );
    const text = Object.values(reportData.aiAnalysis)
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    const leakage = validateSectorConcepts(sectorProfile, text);
    if (!leakage.valid) {
      errors.push({
        code: "SECTOR_LEAKAGE_DETECTED",
        layer: "LAYER_C_NARRATIVE_INTEGRITY",
        severity: "CRITICAL_BLOCK",
        section: "narrative",
        message: `Sector leakage detected for ${sectorProfile.name}: ${leakage.leakedConcepts.join(", ")}.`
      });
    }
  }

  // =========================================================================
  // LAYER D: PDF RENDER INTEGRITY
  // =========================================================================
  // Guard against undefined critical variables in PDF data contract
  if (!facts.company.ticker || !facts.company.name) {
    errors.push({
      code: "PDF_MISSING_METADATA",
      layer: "LAYER_D_PDF_LAYOUT",
      severity: "CRITICAL_BLOCK",
      section: "pdf_cover",
      message: "Company ticker or name is undefined; PDF rendering will fail."
    });
  }

  // =========================================================================
  // LAYER E: PRE-PUBLISH QA INTEGRITY INVARIANTS & GATE
  // Ingests failures from validateReportIntegrity (semantic bleeding, arithmetic failures)
  // =========================================================================
  if (reportData?.qaReport) {
    for (const check of reportData.qaReport.checks || []) {
      if (check.status === "FAIL") {
        errors.push({
          code: `QA_${check.id}`,
          layer: check.category === "KEYWORD_BLOCKLIST" || check.category === "MOAT_INTEGRITY"
            ? "LAYER_C_NARRATIVE_INTEGRITY"
            : "LAYER_B_FINANCIAL_MODEL",
          severity: "CRITICAL_BLOCK",
          section: check.category.toLowerCase(),
          message: `${check.name} [${check.id}]: ${check.details}`,
          expected: check.expected,
          actual: check.actual,
        });
      } else if (check.status === "WARN") {
        warnings.push({
          code: `QA_${check.id}`,
          layer: "LAYER_B_FINANCIAL_MODEL",
          severity: "WARNING",
          section: check.category.toLowerCase(),
          message: `${check.name} [${check.id}]: ${check.details}`,
        });
      }
    }
  }

  // Status & Score Calculation
  const hasCriticalErrors = errors.length > 0;
  const status: "PASS" | "WARNING" | "BLOCKED" = hasCriticalErrors
    ? "BLOCKED"
    : warnings.length > 0
    ? "WARNING"
    : "PASS";

  const canPublish = !hasCriticalErrors;

  // Base score 100, -25 per critical error, -5 per warning
  const score = Math.max(0, 100 - (errors.length * 25) - (warnings.length * 5));

  const getLayerStatus = (layer: QAIssue["layer"]): "PASS" | "WARN" | "FAIL" => {
    if (errors.some(e => e.layer === layer)) return "FAIL";
    if (warnings.some(w => w.layer === layer)) return "WARN";
    return "PASS";
  };

  return {
    status,
    canPublish,
    score,
    timestamp: new Date().toISOString(),
    errors,
    warnings,
    layerSummaries: {
      layerA: getLayerStatus("LAYER_A_SOURCE_DATA"),
      layerB: getLayerStatus("LAYER_B_FINANCIAL_MODEL"),
      layerC: getLayerStatus("LAYER_C_NARRATIVE_INTEGRITY"),
      layerD: getLayerStatus("LAYER_D_PDF_LAYOUT")
    }
  };
}
