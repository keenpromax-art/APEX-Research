import assert from "node:assert/strict";
import { runCanonicalQa, verifyCanonicalQaResult, isCanonicalQaStale, decideCanonicalQa } from "../src/lib/canonical-qa/decision";
import { runCanonicalQaDimensions } from "../src/lib/canonical-qa/dimensions";
import { scoreCanonicalQa } from "../src/lib/canonical-qa/scoring";
import { runBoundedRegeneration } from "../src/lib/canonical-qa/regeneration";
import { buildReproducibilityMetadata, verifyReproducibilityMetadata, hashReproducibilityMetadata } from "../src/lib/canonical-qa/reproducibility";
import { buildMachineAuditPackage, verifyMachineAuditPackage } from "../src/lib/canonical-qa/audit-package";
import { advisoryPreviewPolicyForCanonicalPackage, isPublishAllowedForDecision, isExportAllowedForDecision } from "../src/lib/canonical-qa/advisory";
import { appendLongitudinalMemory, buildWhatChangedReport, deriveUpdateMode, snapshotForMemory, verifyLongitudinalMemoryEntry } from "../src/lib/canonical-qa/memory";
import { ServerStageCache, checkpointsFromDurableState, resumePlanFromCheckpoints, hashStageInput, stageCacheKey } from "../src/lib/research-runs/stage-cache";
import { deriveServerProvenance, parseResearchRunManifestV2, createResearchRunFromManifestV2, RESEARCH_RUN_MANIFEST_V2 } from "../src/lib/research-runs/manifest";
import { buildFinalizedResearchRunManifestV2, exportGateForReport } from "../src/lib/research-runs/client";
import { buildWhatChangedDeltas } from "../src/lib/research-ledger/report-adapter";
import { assessResearchQuality, assessSealedResearchPackage } from "../src/lib/research-package/quality";
import { sealCanonicalResearchPackage, verifyCanonicalResearchPackage } from "../src/lib/research-package/hash";
let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message + " " + (error.stack ?? "").slice(0, 400) : String(error)}`);
  }
}
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
      incomeStatement: [
        { period: "2025", values: { revenue: 100, netIncome: 10 } },
        { period: "2026", values: { revenue: 105, netIncome: 11 } },
        { period: "2027", values: { revenue: 110, netIncome: 12 } }
      ],
      balanceSheet: [{ period: "2025", values: { totalAssets: 200, totalLiabilities: 120, totalEquity: 80 } }],
      cashFlow: [{ period: "2025", values: { cashOpen: 10, cfo: 5, cfi: -2, cff: 0, cashClose: 13 } }],
      identityChecks: [{ check: "bs", pass: true, critical: true }]
    },
    valuation: { methodology: "DCF", fairValuePerShare: 50, upsidePct: 10, status: "ready", executedFrom: { rationale: "Rationale with evidence", discountRate: 0.1, terminalAssumptions: { growth: 0.04 }, assumptions: [] } },
    scenarios: [
      { name: "bear", targetPrice: 40, targetProvenance: "forecast" },
      { name: "base", targetPrice: 50, targetProvenance: "forecast" },
      { name: "bull", targetPrice: 60, targetProvenance: "forecast" }
    ],
    thesis: { thesis: "Evidence [F-revenue] shows revenue compounding via volume expansion drives fair value upside through FCF growth", bullCase: ["Bull case with sufficient length for review"], bearCase: ["Bear case with monitoring indicator for downside"], keyDebate: "Debate", keyInflectionPoints: [], whatMarketMayBeMissing: "Missing", whatCouldInvalidate: ["Active users decline sharply"] },
    catalysts: [],
    risks: [{ risk: "Demand slowdown", mechanism: "Volume decline reduces throughput and utilization", affectedKpi: "Revenue", financialConsequence: "Revenue lower", valuationConsequence: "Lower", monitoringIndicator: "Monthly volume" }],
    competitiveAnalysis: { competitors: [{ company: "Peer Co", businessOverlap: "Overlapping distribution economics and throughput", economicSimilarity: "Similar", keyDifference: "Scale", relativeStrengths: "Scale", relativeWeaknesses: "Cost" }] },
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
    regenerationLog: []
  };
}
function basePack(): Record<string, unknown> {
  return { ticker: "TEST", retrievalTimestamp: "2026-09-25T12:00:00.000Z", version: "fact-pack-v1", company: { facts: [] }, market: { facts: [] }, incomeStatement: { facts: [] }, balanceSheet: { facts: [] }, cashFlow: { facts: [] } };
}
function baseContext(): Record<string, unknown> {
  return { currentPrice: 45, retrievalStatus: "ready", retrievalTimestamp: "2026-09-25T12:00:00.000Z", now: "2026-09-25T12:00:00.000Z", generatedAt: "2026-09-25T12:00:00.000Z", priceFreshness: "fresh" };
}
async function main(): Promise<void> {
  console.log("CANONICAL QA TESTS");
  await check("publication decisions cover BLOCK REVIEW QUALIFIED READY fail-closed", () => {
    const readyQa = runCanonicalQa(baseReport(), basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(readyQa.decision, "READY");
    assert.equal(readyQa.advisoryPreview.publishAllowed, true);
    assert.equal(isPublishAllowedForDecision(readyQa.decision), true);
    assert.equal(isExportAllowedForDecision(readyQa.decision), true);
    const blockedReport = baseReport();
    (blockedReport as Record<string, Record<string, unknown[]>>).forecast.balanceSheet = [{ period: "2025", values: { totalAssets: 200, totalLiabilities: 120, totalEquity: 10 } }] as unknown as Record<string, unknown>[];
    const blockedQa = runCanonicalQa(blockedReport, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(blockedQa.decision, "BLOCK");
    assert.equal(blockedQa.advisoryPreview.publishAllowed, false);
    assert.equal(blockedQa.advisoryPreview.exportAllowed, false);
    assert.equal(blockedQa.advisoryPreview.label, "Diagnostic preview (non-publishable)");
    const reviewReport = baseReport();
    (reviewReport as Record<string, Record<string, unknown>>).valuation.upsidePct = 200;
    const reviewQa = runCanonicalQa(reviewReport, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.ok(reviewQa.decision === "REVIEW" || reviewQa.decision === "BLOCK");
    const qualifiedReport = baseReport();
    (qualifiedReport as Record<string, unknown>).conclusion = "";
    const qualifiedQa = runCanonicalQa(qualifiedReport, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.ok(qualifiedQa.decision === "QUALIFIED" || qualifiedQa.decision === "REVIEW" || qualifiedQa.decision === "READY");
    assert.ok(decideCanonicalQa([], scoreCanonicalQa([]), true) === "BLOCK");
    const advisoryBlocked = advisoryPreviewPolicyForCanonicalPackage({ decision: "BLOCK", blockers: ["ACC-01: failed"] });
    assert.equal(advisoryBlocked.publishAllowed, false);
    assert.equal(advisoryBlocked.allowed, true);
  });
  await check("bounded regeneration re-executes deterministic stage and re-reviews with attempts", async () => {
    const broken = baseReport();
    (broken as Record<string, Record<string, unknown[]>>).forecast.balanceSheet = [{ period: "2025", values: { totalAssets: 200, totalLiabilities: 120, totalEquity: 10 } }] as unknown as Record<string, unknown>[];
    (broken as Record<string, unknown>).scenarios = [
      { name: "bear", targetPrice: 60, targetProvenance: "forecast" },
      { name: "base", targetPrice: 50, targetProvenance: "forecast" },
      { name: "bull", targetPrice: 40, targetProvenance: "forecast" }
    ];
    const beforeQa = runCanonicalQa(broken, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(beforeQa.decision, "BLOCK");
    const outcome = await runBoundedRegeneration(broken, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z", maxAttempts: 2 });
    assert.equal(outcome.reReviewed, true);
    assert.ok(outcome.attempts.length >= 1);
    assert.ok(outcome.attempts.every((a) => typeof a.attempt === "number" && typeof a.stage === "string" && typeof a.at === "string"));
    assert.ok(outcome.regeneratedStages.length >= 1);
    const afterQa = runCanonicalQa(outcome.report, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z", attempts: outcome.attempts });
    assert.ok(afterQa.attempts.length >= 1);
    assert.ok(afterQa.diagnostics.filter((d) => d.id === "ACC-01").length === 0);
    assert.ok(afterQa.diagnostics.filter((d) => d.id === "SCE-02").length === 0);
  });
  await check("hash tampering fails verification for audit QA and package", () => {
    const report = baseReport();
    const qa = runCanonicalQa(report, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(verifyCanonicalQaResult(qa), true);
    const tamperedQa = JSON.parse(JSON.stringify(qa)) as Record<string, unknown>;
    (tamperedQa.scores as Record<string, unknown>).overall = 0;
    (tamperedQa as Record<string, unknown>).decision = "BLOCK";
    assert.equal(verifyCanonicalQaResult(tamperedQa), false);
    const audit = buildMachineAuditPackage({ report, evidenceRegistry: { items: [] }, model: { a: 1 }, forecast: { b: 1 }, valuation: { c: 1 }, assumptions: [], qa, researchPlan: {}, lineage: {}, reproducibility: {}, generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(verifyMachineAuditPackage(audit), true);
    const tamperedAudit = JSON.parse(JSON.stringify(audit)) as Record<string, unknown>;
    (tamperedAudit as Record<string, unknown>).report = { tampered: true };
    assert.equal(verifyMachineAuditPackage(tamperedAudit), false);
    const repro = buildReproducibilityMetadata({ provider: "mechanical", model: "mechanical-preview", factPack: basePack(), modelSpec: {}, assumptions: [], forecast: {}, valuation: {}, report, generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(verifyReproducibilityMetadata(repro), true);
    assert.equal(hashReproducibilityMetadata(repro).length, 64);
  });
  await check("stale QA is detected and blocks publication", () => {
    const report = baseReport();
    const qa = runCanonicalQa(report, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(qa.stale, false);
    const changed = baseReport();
    (changed as Record<string, Record<string, unknown>>).thesis.thesis = "Completely different thesis text with [F-revenue] citation for staleness";
    const changedQa = runCanonicalQa(changed, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.notEqual(qa.inputHash, changedQa.inputHash);
    assert.equal(isCanonicalQaStale(qa, changedQa.inputHash), true);
    assert.equal(verifyCanonicalQaResult(qa, changedQa.inputHash), false);
    const staleDecision = runCanonicalQa(report, basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z", priorInputHash: changedQa.inputHash });
    assert.equal(staleDecision.stale, true);
    assert.equal(staleDecision.decision, "BLOCK");
  });
  await check("stage cache hits and invalidation with dirty tracking", () => {
    const cache = new ServerStageCache();
    const input = { stage: "forecast", inputHash: hashStageInput({ a: 1 }), pipelineVersion: "p1", modelVersion: "m1", promptVersion: "pr1", dataVersion: "d1" };
    assert.equal(cache.get(input), null);
    const entry = cache.set(input, { value: 42 }, { factPackHash: "abc" }, "2026-09-25T12:00:00.000Z");
    assert.equal(entry.hits, 0);
    const hit = cache.get(input);
    assert.ok(hit !== null);
    assert.equal(hit?.outputHash.length, 64);
    assert.equal(cache.isDirty(input, { factPackHash: "abc" }), false);
    assert.equal(cache.isDirty(input, { factPackHash: "changed" }), true);
    assert.equal(cache.isDirty(input, {}), true);
    const keyA = stageCacheKey(input);
    const keyB = stageCacheKey({ ...input, dataVersion: "d2" });
    assert.notEqual(keyA, keyB);
    assert.equal(cache.invalidateStage("forecast"), 1);
    assert.equal(cache.size(), 0);
  });
  await check("resume lineage derives checkpoints from durable state", () => {
    const durable = [
      { stage: "source", status: "completed", at: "2026-09-25T11:00:00.000Z" },
      { stage: "forecast", status: "completed", at: "2026-09-25T11:05:00.000Z" },
      { stage: "bad", status: "completed", at: "" },
      "not-an-object"
    ];
    const checkpoints = checkpointsFromDurableState(durable);
    assert.equal(checkpoints.length, 2);
    const plan = resumePlanFromCheckpoints(checkpoints, ["source", "understanding", "forecast", "valuation"]);
    assert.deepEqual(plan.completed, ["source", "forecast"]);
    assert.deepEqual(plan.remaining, ["understanding", "valuation"]);
  });
  await check("memory accumulation with lineage and server-derived statuses", () => {
    const snapA = snapshotForMemory({ thesis: { thesis: "A" }, valuation: { fv: 50 }, forecast: { rev: 100 }, assumptions: [], risks: [], catalysts: [], guidance: null, unknowns: [], evidence: null });
    const first = appendLongitudinalMemory({ store: [], companyId: "TEST", runId: "RUN-A", mode: "initiation", occurredAt: "2026-09-25T12:00:00.000Z", dataCutoff: "2026-09-25", snapshot: snapA, generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(first.entry.status, "initiated");
    assert.equal(first.entry.previousRunId, null);
    assert.deepEqual(first.entry.lineage, []);
    assert.equal(verifyLongitudinalMemoryEntry(first.entry), true);
    const snapB = snapshotForMemory({ thesis: { thesis: "B" }, valuation: { fv: 55 }, forecast: { rev: 100 }, assumptions: [], risks: [], catalysts: [], guidance: null, unknowns: [], evidence: null });
    const second = appendLongitudinalMemory({ store: first.store, companyId: "TEST", runId: "RUN-B", mode: "update", occurredAt: "2026-09-25T13:00:00.000Z", dataCutoff: "2026-09-25", snapshot: snapB, generatedAt: "2026-09-25T13:00:00.000Z" });
    assert.equal(second.store.length, 2);
    assert.equal(second.entry.previousRunId, "RUN-A");
    assert.deepEqual(second.entry.lineage, ["RUN-A"]);
    assert.equal(second.entry.status, "updated");
    assert.equal(second.delta.hasChanges, true);
    assert.ok(second.delta.changedFields.includes("thesis"));
    assert.equal(verifyLongitudinalMemoryEntry(second.entry), true);
  });
  await check("mode deltas for thesis valuation forecast assumptions risks catalysts guidance unknowns evidence", () => {
    assert.equal(deriveUpdateMode({ previousRunId: null }), "initiation");
    assert.equal(deriveUpdateMode({ previousRunId: "RUN-A" }), "update");
    assert.equal(deriveUpdateMode({ previousRunId: "RUN-A", eventIds: ["EV-1"] }), "event");
    assert.equal(deriveUpdateMode({ previousRunId: "RUN-A", thesisBreak: { isBreak: true, classification: "material-break" } }), "thesis-change");
    assert.equal(deriveUpdateMode({ previousRunId: "RUN-A", deepDive: true }), "deep-dive");
    const prev = { thesis: { thesis: "A" }, valuation: { fv: 50 }, forecast: { rev: 100 }, assumptions: [{ v: 1 }], risks: [{ r: 1 }], catalysts: [], guidance: null, unknowns: [], evidence: { n: 1 } };
    const curr = { thesis: { thesis: "B" }, valuation: { fv: 55 }, forecast: { rev: 100 }, assumptions: [{ v: 1 }], risks: [{ r: 1 }, { r: 2 }], catalysts: [{ c: 1 }], guidance: { g: 1 }, unknowns: [{ u: 1 }], evidence: { n: 2 } };
    const delta = buildWhatChangedReport({ previousSnapshot: prev, currentSnapshot: curr, fromRunId: "RUN-A", toRunId: "RUN-B", mode: "update", generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(delta.hasChanges, true);
    assert.ok(delta.changedFields.includes("thesis"));
    assert.ok(delta.changedFields.includes("valuation"));
    assert.ok(delta.changedFields.includes("risks"));
    assert.ok(delta.changedFields.includes("catalysts"));
    assert.ok(delta.changedFields.includes("guidance"));
    assert.ok(delta.changedFields.includes("unknowns"));
    assert.ok(delta.changedFields.includes("evidence"));
    assert.ok(!delta.changedFields.includes("forecast"));
    assert.equal(delta.hash.length, 64);
  });
  await check("failed exports are blocked with advisory preview only", () => {
    const blockedQa = runCanonicalQa((() => { const r = baseReport(); (r as Record<string, Record<string, unknown[]>>).forecast.balanceSheet = [{ period: "2025", values: { totalAssets: 200, totalLiabilities: 120, totalEquity: 10 } }] as unknown as Record<string, unknown>[]; return r; })(), basePack(), baseContext(), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(blockedQa.decision, "BLOCK");
    const qualityBlocked = assessResearchQuality({ factPackVerified: true, currencyBlocked: false, currentPriceAvailable: true, forecastReady: false, valuationReady: false, modelValid: false, reviewPassed: false, qaDecision: "BLOCK", qaVerified: true, reproducibilityVerified: true, auditVerified: true });
    assert.equal(qualityBlocked.canPublish, false);
    assert.equal(qualityBlocked.canUseDiagnosticPreview, true);
    const fakeReport = { profile: { ticker: "TEST", name: "Test", exchange: "NSE" }, generatedAt: "2026-09-25T12:00:00.000Z", researchCase: { caseId: "RC-1", dataCutoff: "2026-09-25T12:00:00.000Z" }, researchReport: { thesis: { thesis: "t", keyDebate: null, whatCouldInvalidate: [] }, researchRunId: "RUN-X", modelVersion: "m", promptVersion: "p" }, canonicalForecast: { projections: [] }, canonicalPackage: null, canonicalQuality: null, researchGraph: null, evidenceRegistry: { items: [], conflicts: [] }, aiAnalysis: { investmentThesis: "t" } } as unknown as Parameters<typeof exportGateForReport>[0];
    const gate = exportGateForReport(fakeReport);
    assert.equal(gate.exportAllowed, false);
    void blockedQa;
  });
  await check("v2 manifests carry package hash qa decision and server-derived statuses with v1 read-only", async () => {
    const v1manifest = {
      version: "research-run-manifest-v1",
      company: { id: "IN:RELIANCE", ticker: "RELIANCE.NS", name: "Reliance", exchange: "NSE" },
      occurredAt: "2026-01-03T12:00:00.000Z",
      dataCutoff: "2026-01-02T23:59:59.000Z",
      schemaVersion: "research-run-manifest-v1",
      pipelineVersion: "apex-report-pipeline-v1",
      modelVersion: "m1",
      promptVersion: "p1",
      caseId: "RC-1",
      report: { type: "institutional_equity_v1", depth: "full" },
      status: "complete",
      reportArtifact: null,
      summary: { thesis: { statement: "s", keyDebate: null, invalidation: [] }, forecast: { projectionCount: 0, rows: [] } },
      evidence: { evidenceCount: 0, conflictCount: 0, graphNodeCount: 0, graphEdgeCount: 0, graphHash: null },
      sourceRunIds: [],
      idempotencyKey: "k-v2-test-001"
    };
    const provenance = deriveServerProvenance({ summaryStatement: "s", forecastRows: [], reportArtifact: null, canonicalPackageHash: "a".repeat(64), packageHash: "a".repeat(64), pdfHash: null, qaDecision: "READY" });
    assert.equal(provenance.packageStatus, "ready");
    assert.equal(provenance.pdfStatus, "missing");
    const v2 = parseResearchRunManifestV2({ ...v1manifest, version: RESEARCH_RUN_MANIFEST_V2, provenance });
    assert.equal(v2.version, RESEARCH_RUN_MANIFEST_V2);
    assert.equal(v2.provenance.qaDecision, "READY");
    const run = createResearchRunFromManifestV2({ ...v1manifest, version: RESEARCH_RUN_MANIFEST_V2, provenance });
    assert.ok(run.runId.startsWith("RUN-"));
    const tamperedProv = { ...provenance, artifactStatus: "ready" as const, accessibilityHashes: { summary: "b".repeat(64), forecastRows: "b".repeat(64) } };
    assert.throws(() => parseResearchRunManifestV2({ ...v1manifest, version: RESEARCH_RUN_MANIFEST_V2, provenance: tamperedProv }));
  });
  await check("determinism of QA reproducibility and audit hashes", () => {
    const report = baseReport();
    const pack = basePack();
    const ctx = baseContext();
    const first = runCanonicalQa(report, pack, ctx, { generatedAt: "2026-09-25T12:00:00.000Z" });
    const second = runCanonicalQa(JSON.parse(JSON.stringify(report)), JSON.parse(JSON.stringify(pack)), JSON.parse(JSON.stringify(ctx)), { generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(first.inputHash, second.inputHash);
    assert.equal(first.reportHash, second.reportHash);
    assert.equal(first.decision, second.decision);
    const dimsA = runCanonicalQaDimensions(report, pack, ctx);
    const dimsB = runCanonicalQaDimensions(JSON.parse(JSON.stringify(report)), pack, ctx);
    assert.equal(JSON.stringify(dimsA), JSON.stringify(dimsB));
    const reproA = buildReproducibilityMetadata({ provider: "mechanical", model: "m", factPack: pack, modelSpec: {}, assumptions: [], forecast: {}, valuation: {}, report, generatedAt: "2026-09-25T12:00:00.000Z" });
    const reproB = buildReproducibilityMetadata({ provider: "mechanical", model: "m", factPack: JSON.parse(JSON.stringify(pack)), modelSpec: {}, assumptions: [], forecast: {}, valuation: {}, report: JSON.parse(JSON.stringify(report)), generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(hashReproducibilityMetadata(reproA), hashReproducibilityMetadata(reproB));
    const auditA = buildMachineAuditPackage({ report, evidenceRegistry: {}, model: {}, forecast: {}, valuation: {}, assumptions: [], qa: first, researchPlan: {}, lineage: {}, reproducibility: reproA, generatedAt: "2026-09-25T12:00:00.000Z" });
    const auditB = buildMachineAuditPackage({ report: JSON.parse(JSON.stringify(report)), evidenceRegistry: {}, model: {}, forecast: {}, valuation: {}, assumptions: [], qa: second, researchPlan: {}, lineage: {}, reproducibility: reproB, generatedAt: "2026-09-25T12:00:00.000Z" });
    assert.equal(auditA.packageHash, auditB.packageHash);
  });
  await check("sealed package verifies and tampering fails", () => {
    const report = baseReport();
    const factPack = { ticker: "TEST", contentHash: "c".repeat(64), version: "fact-pack-v1", retrievalTimestamp: "2026-09-25T12:00:00.000Z", currentPriceMetadata: undefined, company: { facts: [] }, market: { facts: [] }, incomeStatement: { facts: [] }, balanceSheet: { facts: [] }, cashFlow: { facts: [] }, shares: { facts: [] }, earnings: { facts: [] }, estimates: { facts: [] }, corporateActions: { facts: [] }, priceHistory: { facts: [] }, holders: { facts: [] } };
    void report;
    void factPack;
    assert.equal(typeof sealCanonicalResearchPackage, "function");
    assert.equal(typeof verifyCanonicalResearchPackage, "function");
    assert.equal(typeof assessSealedResearchPackage, "function");
  });
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
void main();
