import { createSuite, check, report } from "../helpers/assert";
import { runCanonicalQa, verifyCanonicalQaResult, isCanonicalQaStale } from "../../src/lib/canonical-qa/decision";
import { buildReproducibilityMetadata, verifyReproducibilityMetadata, hashReproducibilityMetadata } from "../../src/lib/canonical-qa/reproducibility";
import { buildMachineAuditPackage, verifyMachineAuditPackage } from "../../src/lib/canonical-qa/audit-package";

const suite = createSuite();

function baseReport(): Record<string, unknown> {
  return {
    researchRunId: "RUN-TEST-001",
    companyTicker: "TEST",
    modelVersion: "v1.0.0",
    promptVersion: "AI-FIRST-v1.0",
    factPackVersion: "fact-pack-v1",
    generationTimestamp: "2026-09-25T12:00:00.000Z",
    forecastVersion: "f3y",
    valuationVersion: "v-dcf",
    reviewVersion: "r-pass",
    companyUnderstanding: { primaryEconomicAbstraction: "revenue", revenueDrivers: [{ name: "Revenue" }], costDrivers: [], marginDrivers: [], keyKpis: [{ name: "Revenue" }] },
    businessModel: "Test business",
    industryContext: "Test industry",
    historicalAnalysis: "History",
    keyMetrics: [{ metric: "revenue", value: 100 }],
    operatingModel: { formulas: [{ id: "F1", equation: "a", expression: "revenue * 1", output: "netIncome", variables: ["revenue"], explanation: "e", sourceFacts: [], confidence: 0.8 }], variables: [] },
    forecastSpec: { driverPaths: { revenue: [0.05, 0.05, 0.05] } },
    forecast: {
      status: "ready",
      incomeStatement: [{ period: "2025", values: { revenue: 100, netIncome: 10 } }, { period: "2026", values: { revenue: 105, netIncome: 11 } }],
      balanceSheet: [{ period: "2025", values: { totalAssets: 200, totalLiabilities: 120, totalEquity: 80 } }],
      cashFlow: [{ period: "2025", values: { cashOpen: 10, cfo: 5, cfi: -2, cff: 0, cashClose: 13 } }],
      identityChecks: [{ check: "bs", pass: true, critical: true }],
    },
    valuation: { methodology: "DCF", fairValuePerShare: 50, upsidePct: 10, status: "ready", executedFrom: { rationale: "Rationale with evidence", discountRate: 0.1, terminalAssumptions: { growth: 0.04 }, assumptions: [] } },
    scenarios: [
      { name: "bear", targetPrice: 40, targetProvenance: "forecast" },
      { name: "base", targetPrice: 50, targetProvenance: "forecast" },
      { name: "bull", targetPrice: 60, targetProvenance: "forecast" },
    ],
    thesis: { thesis: "Evidence [F-revenue] shows revenue compounding via volume expansion drives fair value upside through FCF growth", bullCase: ["Bull case with sufficient length"], bearCase: ["Bear case with monitoring indicator"], keyDebate: "Debate", keyInflectionPoints: [], whatMarketMayBeMissing: "Missing", whatCouldInvalidate: ["Demand decline sharply"] },
    catalysts: [],
    risks: [{ risk: "Demand slowdown", mechanism: "Volume decline reduces throughput", affectedKpi: "Revenue", financialConsequence: "Revenue lower", valuationConsequence: "Lower", monitoringIndicator: "Monthly volume" }],
    competitiveAnalysis: { competitors: [] },
    moat: { hasMoat: false, sources: [], verdict: "No moat" },
    managementAnalysis: "Mgmt",
    capitalAllocation: "Cap",
    financialQuality: "Quality",
    sensitivity: [],
    reverseValuation: null,
    conclusion: "Conclusion with sufficient length for export",
    artifactIds: { modelIds: ["M1"], forecastIds: ["F1"], valuationIds: ["V1"], scenarioIds: ["S1"], sensitivityIds: [], monteCarloIds: [], reverseIds: [] },
    reviews: [],
    reviewPassed: true,
    regenerationLog: [],
  };
}

function basePack(): Record<string, unknown> {
  return { ticker: "TEST", retrievalTimestamp: "2026-09-25T12:00:00.000Z", version: "fact-pack-v1", company: { facts: [] }, market: { facts: [] }, incomeStatement: { facts: [] }, balanceSheet: { facts: [] }, cashFlow: { facts: [] } };
}

function baseContext(): Record<string, unknown> {
  return { currentPrice: 45, retrievalStatus: "ready", retrievalTimestamp: "2026-09-25T12:00:00.000Z", now: "2026-09-25T12:00:00.000Z", generatedAt: "2026-09-25T12:00:00.000Z", priceFreshness: "fresh" };
}

const ready = runCanonicalQa(baseReport(), basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
check(suite, "ready fixture passes", ready.decision === "READY" && ready.advisoryPreview.publishAllowed === true);
check(suite, "qa hash verifies", verifyCanonicalQaResult(ready) === true);
check(suite, "tampered qa fails", (() => {
  const tampered = JSON.parse(JSON.stringify(ready)) as Record<string, unknown>;
  (tampered.scores as Record<string, unknown>).overall = 0;
  return verifyCanonicalQaResult(tampered) === false;
})());
check(suite, "broken balance sheet blocks", (() => {
  const broken = baseReport();
  (broken as Record<string, Record<string, unknown[]>>).forecast.balanceSheet = [{ period: "2025", values: { totalAssets: 200, totalLiabilities: 120, totalEquity: 10 } }] as unknown as Record<string, unknown>[];
  return runCanonicalQa(broken, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" }).decision === "BLOCK";
})());
check(suite, "stale qa detected", (() => {
  const changed = baseReport();
  (changed as Record<string, Record<string, unknown>>).thesis.thesis = "Completely different thesis text with [F-revenue] citation for staleness";
  const changedQa = runCanonicalQa(changed, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
  return ready.inputHash !== changedQa.inputHash && isCanonicalQaStale(ready, changedQa.inputHash) === true;
})());
check(suite, "qa is deterministic", (() => {
  const second = runCanonicalQa(JSON.parse(JSON.stringify(baseReport())), JSON.parse(JSON.stringify(basePack())), JSON.parse(JSON.stringify(baseContext())), { generatedAt: "2026-09-25T12:00:00.000Z" });
  return ready.inputHash === second.inputHash && ready.decision === second.decision;
})());
check(suite, "reproducibility verifies and hashes", (() => {
  const repro = buildReproducibilityMetadata({ provider: "mechanical", model: "mechanical-preview", factPack: basePack(), modelSpec: {}, assumptions: [], forecast: {}, valuation: {}, report: baseReport(), generatedAt: "2026-09-25T12:00:00.000Z" });
  return verifyReproducibilityMetadata(repro) === true && hashReproducibilityMetadata(repro).length === 64;
})());
check(suite, "audit package verifies and tamper fails", (() => {
  const audit = buildMachineAuditPackage({ report: baseReport(), evidenceRegistry: { items: [] }, model: { a: 1 }, forecast: { b: 1 }, valuation: { c: 1 }, assumptions: [], qa: ready, researchPlan: {}, lineage: {}, reproducibility: {}, generatedAt: "2026-09-25T12:00:00.000Z" });
  const tampered = JSON.parse(JSON.stringify(audit)) as Record<string, unknown>;
  (tampered as Record<string, unknown>).report = { tampered: true };
  return verifyMachineAuditPackage(audit) === true && verifyMachineAuditPackage(tampered) === false;
})());

report(suite, "integration/canonical-qa");
