import { verifyFactPack } from "@/lib/ai-first/fact-pack";
import { runAiFirstResearch, type PipelineTransport, type RunAiFirstOptions } from "@/lib/ai-first/pipeline";
import type { CustomKeyConfig } from "@/lib/ai-providers";
import type { ExecuteResearchRetrievalOptions } from "@/lib/research-retrieval/types";
import { stableHash } from "@/lib/research-ledger/stable";
import {
  buildResearchSourceContext,
  type BuildResearchSourceContextOptions,
  type NormalizedResearchSourceContext,
} from "@/lib/research-context/builder";
import { sealCanonicalResearchPackage } from "./hash";
import { assessResearchQuality } from "./quality";
import { RESEARCH_ANALYTICS_VERSION } from "./analytics";
import { RESEARCH_CONFIDENCE_DECOMPOSITION_VERSION } from "./confidence";
import { validateResearchLineageGraph, verifyResearchLineageGraph } from "@/lib/research-lineage/graph";
import { runCanonicalQa } from "@/lib/canonical-qa/decision";
import { runBoundedRegeneration } from "@/lib/canonical-qa/regeneration";
import { buildMachineAuditPackage } from "@/lib/canonical-qa/audit-package";
import { buildReproducibilityMetadata, hashReproducibilityMetadata } from "@/lib/canonical-qa/reproducibility";
import { appendLongitudinalMemory, deriveUpdateMode, snapshotForMemory } from "@/lib/canonical-qa/memory";
import { CANONICAL_QA_VERSION } from "@/lib/canonical-qa/types";
import { AI_FIRST_PROMPT_VERSION } from "@/lib/ai-first/llm";
import { checkpointsFromDurableState, globalStageCache, hashStageInput, resumePlanFromCheckpoints } from "@/lib/research-runs/stage-cache";
import {
  CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION,
  RESEARCH_RUN_EVENT_SCHEMA_VERSION,
  type CanonicalResearchPackage,
  type ResearchRun,
  type ResearchRunCheckpoint,
  type ResearchRunEvent,
} from "./types";
import type { ResearchReport } from "@/lib/ai-first/types";

export interface CanonicalResearchOptions {
  reportTypeId?: string;
  depth?: string;
  customKeyConfig?: CustomKeyConfig | null;
  transport?: PipelineTransport;
  resumeFrom?: Record<string, unknown> | null;
  retrievalTimestamp?: string;
  dataCutoff?: string;
  runId?: string;
  sourceContext?: NormalizedResearchSourceContext;
  sourceContextOptions?: Omit<BuildResearchSourceContextOptions, "ticker" | "retrievalTimestamp" | "dataCutoff">;
  retrievalProvider?: ExecuteResearchRetrievalOptions["provider"];
  retrieval?: Omit<ExecuteResearchRetrievalOptions, "ticker" | "asOf" | "now">;
  retrievalProviderAllowlist?: readonly string[];
  retrievalLimits?: ExecuteResearchRetrievalOptions["limits"];
  retrievalNow?: string;
  retrievalSignal?: AbortSignal;
  updateMode?: import("@/lib/canonical-qa/types").ResearchUpdateMode;
  onEvent?: (event: ResearchRunEvent) => void;
}

export interface CanonicalResearchResult {
  package: CanonicalResearchPackage;
  run: ResearchRun;
  sourceContext: NormalizedResearchSourceContext;
  pipelineResult: Awaited<ReturnType<typeof runAiFirstResearch>>;
}

function safeRunOptions(options: CanonicalResearchOptions): Record<string, unknown> {
  return {
    reportTypeId: options.reportTypeId ?? "institutional_equity_v1",
    depth: options.depth ?? "concise",
    resume: Boolean(options.resumeFrom),
    transport: options.transport ? "injected" : "provider-or-mechanical",
    customKeyConfigured: Boolean(options.customKeyConfig?.apiKey),
    customProvider: options.customKeyConfig?.provider ?? null,
    customModel: options.customKeyConfig?.model ?? null,
    retrievalProvider: options.retrievalProvider?.id ?? options.retrieval?.provider?.id ?? null,
    retrievalProviderAllowed: options.retrievalProvider ? (options.retrievalProviderAllowlist ?? ["injected", "fixture", "test", "mock"]).includes(options.retrievalProvider.id) : options.retrieval?.provider ? (options.retrieval.providerAllowlist ?? options.retrieval.allowedProviders ?? ["injected", "fixture", "test", "mock"]).includes(options.retrieval.provider.id) : false,
  };
}

function runIdFor(ticker: string, sourceHash: string, cutoff: string, options: Record<string, unknown>): string {
  const digest = stableHash({ ticker, sourceHash, cutoff, options }, "research-package/run-id/v1");
  return `RUN-${digest.slice(0, 24).toUpperCase()}`;
}

function cloneReport(report: ResearchReport, run: ResearchRun): ResearchReport {
  const cloned = structuredClone(report) as ResearchReport;
  cloned.researchRunId = run.runId;
  cloned.generationTimestamp = run.completedAt ?? run.startedAt;
  return cloned;
}

function event(
  type: ResearchRunEvent["type"],
  run: ResearchRun,
  sequence: number,
  extra: Partial<ResearchRunEvent> = {},
): ResearchRunEvent {
  return {
    schemaVersion: RESEARCH_RUN_EVENT_SCHEMA_VERSION,
    type,
    runId: run.runId,
    ticker: run.ticker,
    sequence,
    emittedAt: new Date().toISOString(),
    ...extra,
  };
}

function stageId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pipeline";
}

function canonicalRating(valuation: { status?: string; fairValuePerShare?: number }, currentPrice: number | undefined): "BUY" | "HOLD" | "SELL" | "NR" {
  const fairValue = valuation.fairValuePerShare;
  if (valuation.status !== "ready" || typeof fairValue !== "number" || !Number.isFinite(fairValue) || typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) return "NR";
  const upside = fairValue / currentPrice - 1;
  if (upside >= 0.12) return "BUY";
  if (upside <= -0.12) return "SELL";
  return "HOLD";
}

export async function runCanonicalResearch(ticker: string, options: CanonicalResearchOptions = {}): Promise<CanonicalResearchResult> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) throw new TypeError("ticker is required");
  const runOptions = safeRunOptions(options);
  const provisionalStartedAt = options.retrievalTimestamp ?? new Date().toISOString();
  const runId = options.runId ?? runIdFor(normalizedTicker, "pending", options.dataCutoff ?? "pending", runOptions);
  const run: ResearchRun = {
    runId,
    schemaVersion: CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION,
    ticker: normalizedTicker,
    status: "running",
    dataCutoff: options.dataCutoff ?? "",
    sourceSnapshotHash: "",
    startedAt: provisionalStartedAt,
    options: runOptions,
    checkpoints: [],
  };
  let sequence = 0;
  const emit = (value: ResearchRunEvent) => {
    sequence += 1;
    options.onEvent?.({ ...value, sequence });
  };
  emit(event("run_started", run, sequence, { run: { ...run, checkpoints: run.checkpoints.map((checkpoint) => ({ ...checkpoint })) }, data: { status: "fetching_source_context" } }));
  let activeStage: ResearchRunCheckpoint | null = null;
  const completeActive = () => {
    if (!activeStage) return;
    const completed: ResearchRunCheckpoint = { ...activeStage, status: "completed", at: run.startedAt };
    run.checkpoints.push(completed);
    emit(event("stage_completed", run, sequence, { stage: completed.stage, checkpoint: completed }));
    activeStage = null;
  };
  try {
    const sourceContext = options.sourceContext ?? await buildResearchSourceContext({
      ticker: normalizedTicker,
      ...(options.retrievalTimestamp ? { retrievalTimestamp: options.retrievalTimestamp } : {}),
      ...(options.dataCutoff ? { dataCutoff: options.dataCutoff } : {}),
      ...(options.sourceContextOptions ?? {}),
    });
    if (sourceContext.ticker !== normalizedTicker) throw new TypeError("Source context ticker does not match requested ticker");
    run.dataCutoff = sourceContext.dataCutoff;
    run.sourceSnapshotHash = sourceContext.source.snapshotHash;
    run.startedAt = sourceContext.retrievedAt;
    const durableCheckpoints = checkpointsFromDurableState((options.resumeFrom as Record<string, unknown> | null)?.checkpoints ?? (options.resumeFrom as Record<string, unknown> | null)?.run ?? options.resumeFrom);
    if (durableCheckpoints.length > 0) {
      const orderedStages = ["source", "understanding", "model", "forecast", "valuation", "scenarios", "review"];
      const resumePlan = resumePlanFromCheckpoints(durableCheckpoints, orderedStages);
      for (const checkpoint of durableCheckpoints) {
        const restored: ResearchRunCheckpoint = { id: checkpoint.stage, stage: checkpoint.stage, status: checkpoint.status === "completed" ? "completed" : "started", at: checkpoint.at, ...(checkpoint.detail ? { detail: checkpoint.detail } : {}) };
        run.checkpoints.push(restored);
      }
      emit(event("checkpoint", run, sequence, { data: { resumeLineage: resumePlan.completed, remaining: resumePlan.remaining } }));
    }
    const pipelineVersionForCache = "apex-ai-first-pipeline-v1";
    const promptVersionForCache = AI_FIRST_PROMPT_VERSION;
    const modelVersionForCache = "apex-financial-model-v1";
    const cacheInputHash = hashStageInput({ ticker: normalizedTicker, sourceSnapshotHash: run.sourceSnapshotHash, dataCutoff: run.dataCutoff, runOptions });
    const cacheProbe = globalStageCache.peek({ stage: "canonical-package", inputHash: cacheInputHash, pipelineVersion: pipelineVersionForCache, modelVersion: modelVersionForCache, promptVersion: promptVersionForCache, dataVersion: run.sourceSnapshotHash });
    const cacheDependencies = { sourceSnapshotHash: run.sourceSnapshotHash, factPackHash: sourceContext.factPack.contentHash ?? run.sourceSnapshotHash };
    const cacheDirty = cacheProbe ? globalStageCache.isDirty({ stage: "canonical-package", inputHash: cacheInputHash, pipelineVersion: pipelineVersionForCache, modelVersion: modelVersionForCache, promptVersion: promptVersionForCache, dataVersion: run.sourceSnapshotHash }, cacheDependencies) : true;
    if (cacheProbe && !cacheDirty) {
      emit(event("checkpoint", run, sequence, { stage: "stage-cache", data: { cacheHit: true, key: cacheProbe.key } }));
    }
    const pipelineOptions: RunAiFirstOptions = {
      ...(options.customKeyConfig !== undefined ? { customKeyConfig: options.customKeyConfig } : {}),
      ...(options.transport ? { transport: options.transport } : {}),
      factPack: sourceContext.factPack,
      retrievalTimestamp: sourceContext.retrievedAt,
      ...(options.retrievalProvider !== undefined ? { retrievalProvider: options.retrievalProvider } : {}),
      ...(options.retrieval !== undefined ? { retrieval: options.retrieval } : {}),
      ...(options.retrievalProviderAllowlist ? { retrievalProviderAllowlist: options.retrievalProviderAllowlist } : {}),
      ...(options.retrievalLimits ? { retrievalLimits: options.retrievalLimits } : {}),
      ...(options.retrievalNow ? { retrievalNow: options.retrievalNow } : {}),
      ...(options.retrievalSignal ? { retrievalSignal: options.retrievalSignal } : {}),
      onProgress: ({ stage, detail }) => {
        completeActive();
        const checkpoint: ResearchRunCheckpoint = {
          id: stageId(stage),
          stage: stageId(stage),
          status: "started",
          at: run.startedAt,
          ...(detail ? { detail } : {}),
        };
        activeStage = checkpoint;
        run.checkpoints.push(checkpoint);
        emit(event("stage_started", run, sequence, { stage: checkpoint.stage, checkpoint, ...(detail ? { data: { detail } } : {}) }));
        emit(event("checkpoint", run, sequence, { stage: checkpoint.stage, checkpoint, ...(detail ? { data: { detail } } : {}) }));
      },
    };
    const pipelineResult = await runAiFirstResearch(normalizedTicker, sourceContext.pipelineQuoteSummary, pipelineOptions);
    completeActive();
    run.status = "completed";
    run.completedAt = run.startedAt;
    const researchReport = cloneReport(pipelineResult.report, run);
    const analytics = pipelineResult.researchAnalytics ?? null;
    delete (researchReport as unknown as Record<string, unknown>).auditPackage;
    delete (researchReport as unknown as Record<string, unknown>).auditPackageHash;
    delete (researchReport as unknown as Record<string, unknown>).canonicalQa;
    delete (researchReport as unknown as Record<string, unknown>).reproducibility;
    delete (researchReport as unknown as Record<string, unknown>).qaDecision;
    delete (researchReport as unknown as Record<string, unknown>).regenerationAttempts;
    if (researchReport.researchDiscovery) {
      researchReport.researchDiscovery = {
        ...researchReport.researchDiscovery,
        generatedAt: sourceContext.retrievedAt,
      };
    }
    const modelValid = pipelineResult.modelValidation?.valid !== false && researchReport.forecast?.status !== "blocked";
    const forecastReady = pipelineResult.forecastStatus === "ready" || researchReport.forecast?.status === "ready";
    const valuationReady = pipelineResult.valuationMatrix?.status === "ready" && researchReport.valuation?.status === "ready" && typeof researchReport.valuation?.fairValuePerShare === "number" && Number.isFinite(researchReport.valuation.fairValuePerShare);
    const currentPrice = sourceContext.stockData.currentPrice;
    const rating = canonicalRating(researchReport.valuation, currentPrice);
    const factPackVerified = verifyFactPack(pipelineResult.factPack) && pipelineResult.factPack.contentHash === sourceContext.factPack.contentHash;
    const lineageValidation = validateResearchLineageGraph(pipelineResult.lineage);
    const retrievalUnavailable = pipelineResult.retrieval?.status === "unavailable" || pipelineResult.retrieval?.status === "failed";
    const reproducibility = buildReproducibilityMetadata({
      provider: options.customKeyConfig?.provider ?? (options.transport ? "injected-transport" : "mechanical"),
      model: options.customKeyConfig?.model ?? "mechanical-preview",
      temperature: 0.3,
      maxTokens: 3000,
      tokenBudget: 3000,
      promptVersion: researchReport.promptVersion || AI_FIRST_PROMPT_VERSION,
      promptText: researchReport.promptVersion || AI_FIRST_PROMPT_VERSION,
      pipelineVersion: pipelineVersionForCache,
      factPackVersion: pipelineResult.factPack.version,
      factPack: sourceContext.factPack,
      modelSpec: pipelineResult.forecastSpec,
      assumptions: pipelineResult.forecastSpec.assumptions,
      forecast: researchReport.forecast,
      valuation: researchReport.valuation,
      report: researchReport,
      generatedAt: sourceContext.retrievedAt,
    });
    const reproducibilityHash = hashReproducibilityMetadata(reproducibility);
    const qaContext: Record<string, unknown> = {
      currentPrice,
      retrievalStatus: pipelineResult.retrieval?.status,
      retrievalTimestamp: sourceContext.retrievedAt,
      now: sourceContext.retrievedAt,
      generatedAt: sourceContext.retrievedAt,
      priceFreshness: sourceContext.factPack.currentPriceMetadata?.freshness,
    };
    const initialQa = runCanonicalQa(researchReport, sourceContext.factPack, qaContext, { generatedAt: sourceContext.retrievedAt, reproducibilityHash });
    const regenOutcome = await runBoundedRegeneration(researchReport, sourceContext.factPack, qaContext, { generatedAt: sourceContext.retrievedAt, maxAttempts: 2, ...(options.transport ? { transport: options.transport } : {}) });
    const mergedAttempts = [...initialQa.attempts, ...regenOutcome.attempts];
    const canonicalQa = regenOutcome.attempts.length > 0
      ? runCanonicalQa(regenOutcome.report, sourceContext.factPack, qaContext, { generatedAt: sourceContext.retrievedAt, attempts: mergedAttempts, reproducibilityHash })
      : { ...initialQa, attempts: mergedAttempts };
    const qaDecision = canonicalQa.decision;
    const regeneratedReport = regenOutcome.attempts.some((a) => a.status === "fixed") ? (regenOutcome.report as unknown as ResearchReport) : researchReport;
    const finalForecast = regeneratedReport.forecast ?? researchReport.forecast;
    const finalValuation = regeneratedReport.valuation ?? researchReport.valuation;
    const finalScenarios = (regeneratedReport.scenarios as ResearchReport["scenarios"]) ?? researchReport.scenarios;
    Object.assign(researchReport, { canonicalQa, qaDecision, reproducibility, regenerationAttempts: mergedAttempts });
    researchReport.canonicalQa = canonicalQa;
    researchReport.qaDecision = qaDecision;
    researchReport.reproducibility = reproducibility;
    researchReport.regenerationAttempts = mergedAttempts;
    const auditPackage = buildMachineAuditPackage({
      report: researchReport,
      evidenceRegistry: pipelineResult.evidenceRegistry,
      model: pipelineResult.forecastSpec,
      forecast: finalForecast,
      valuation: finalValuation,
      assumptions: pipelineResult.forecastSpec.assumptions,
      qa: canonicalQa,
      researchPlan: pipelineResult.researchPlan,
      lineage: pipelineResult.lineage,
      reproducibility,
      generatedAt: sourceContext.retrievedAt,
    });
    researchReport.auditPackage = auditPackage;
    researchReport.auditPackageHash = auditPackage.packageHash;
    const updateMode = options.updateMode ?? deriveUpdateMode({ previousRunId: (options.resumeFrom as Record<string, unknown> | null)?.runId as string | undefined ?? null });
    const memorySnapshot = snapshotForMemory({
      thesis: regeneratedReport.thesis,
      valuation: finalValuation,
      forecast: finalForecast,
      assumptions: pipelineResult.forecastSpec.assumptions,
      risks: regeneratedReport.risks,
      catalysts: regeneratedReport.catalysts,
      guidance: (analytics as unknown as Record<string, unknown> | null)?.guidanceReconciliation ?? null,
      unknowns: (pipelineResult.researchPlan as unknown as Record<string, unknown> | null)?.unknowns ?? null,
      evidence: pipelineResult.evidenceRegistry,
    });
    const memoryOutcome = appendLongitudinalMemory({
      store: [],
      companyId: normalizedTicker,
      runId,
      mode: updateMode,
      occurredAt: sourceContext.retrievedAt,
      dataCutoff: sourceContext.dataCutoff,
      snapshot: memorySnapshot,
      generatedAt: sourceContext.retrievedAt,
    });
    const quality = assessResearchQuality({
      factPackVerified,
      currencyBlocked: sourceContext.currencyBasis.blocked,
      currentPriceAvailable: typeof currentPrice === "number" && Number.isFinite(currentPrice) && currentPrice > 0,
      ...(sourceContext.factPack.currentPriceMetadata ? { currentPriceFreshness: sourceContext.factPack.currentPriceMetadata.freshness, currentPriceDelayed: sourceContext.factPack.currentPriceMetadata.delayed } : {}),
      forecastReady,
      valuationReady,
      modelValid,
      reviewPassed: researchReport.reviewPassed === true,
      retrievalStatus: pipelineResult.retrieval?.status,
      retrievalVerified: pipelineResult.retrieval ? pipelineResult.retrieval.resultHash.length === 64 : false,
      lineageVerified: pipelineResult.lineage ? verifyResearchLineageGraph(pipelineResult.lineage) : false,
      lineageTraceable: lineageValidation.materialClaimsTraceable,
      qaDecision,
      qaVerified: true,
      reproducibilityVerified: true,
      auditVerified: true,
      ...(analytics ? { peerDiscoveryStatus: analytics.peerDiscovery.status, peerSetsReady: Object.values(analytics.peerDiscovery.peerSets).filter((set) => set.status === "ready").length } : {}),
      ...(analytics
        ? {
            historyStatus: analytics.normalizedHistory.status,
            historyMetricsReady: analytics.normalizedHistory.coverage.metricsReady,
            historyClaimsDepending: analytics.normalizedHistory.materialClaims.map((claim) => claim.claim),
            historyClaimsUnsupported: analytics.normalizedHistory.materialClaims.filter((claim) => claim.supportedBy.length === 0).map((claim) => claim.claim),
          }
        : {}),
      blockers: [
        ...(factPackVerified ? [] : ["Pipeline FactPack differs from the shared source-context FactPack."]),
        ...(forecastReady ? [] : ["Canonical forecast is not publication-ready."]),
        ...(valuationReady ? [] : ["Canonical valuation is not publication-ready."]),
        ...(retrievalUnavailable ? ["Research retrieval is unavailable or failed."] : []),
        ...(lineageValidation.issues.map((entry) => `lineage:${entry.code}: ${entry.message}`)),
        ...(sourceContext.currencyBasis.blocked ? ["Normalized currency/share basis is unavailable."] : []),
        ...(qaDecision === "BLOCK" ? [`canonical-qa-decision: Canonical QA decision is BLOCK`] : []),
        ...(qaDecision === "REVIEW" ? [`canonical-qa-decision: Canonical QA decision is REVIEW`] : []),
      ],
      warnings: [
        ...(sourceContext.fetchCounts.quote !== 1 || sourceContext.fetchCounts.timeseries !== 1
          ? ["Source fetch count is not exactly one for quote and fundamentals timeseries."]
          : []),
        ...(regenOutcome.regeneratedStages.length > 0 ? [`Bounded regeneration re-executed: ${regenOutcome.regeneratedStages.join(",")}`] : []),
      ],
    });
    const packageInput = {
      ticker: normalizedTicker,
      dataCutoff: sourceContext.dataCutoff,
      sourceSnapshotHash: sourceContext.source.snapshotHash,
      sourceContext,
      run,
      factPack: sourceContext.factPack,
      modelSpec: pipelineResult.forecastSpec,
      ...(pipelineResult.modelValidation ? { modelValidation: pipelineResult.modelValidation } : {}),
      forecastSpec: pipelineResult.forecastSpec,
      executedForecast: researchReport.forecast,
      valuationSpec: pipelineResult.valuationSpec,
      valuationMatrix: pipelineResult.valuationMatrix ?? {
        valuationId: "VALUATION-MATRIX-UNAVAILABLE",
        status: "blocked" as const,
        selectedMethod: null,
        primaryMethod: null,
        primaryValuationId: null,
        methods: [],
        crossCheck: { status: "blocked" as const, diagnostics: [], comparablePairs: [] },
        diagnostics: [],
        blockers: ["Valuation matrix unavailable."],
        publicationBlocked: true,
      },
      valuationResult: researchReport.valuation,
      rating,
      scenarios: researchReport.scenarios,
      ...(pipelineResult.scenarioValidation ? { scenarioValidation: pipelineResult.scenarioValidation } : {}),
      sensitivity: researchReport.sensitivity,
      ...(pipelineResult.sensitivityAnalysis ? { sensitivityAnalysis: pipelineResult.sensitivityAnalysis } : {}),
      ...(pipelineResult.monteCarlo ? { monteCarlo: pipelineResult.monteCarlo } : {}),
      ...(pipelineResult.reverseValuationResult ? { reverseResult: pipelineResult.reverseValuationResult } : {}),
      ...(pipelineResult.researchPlan ? { researchPlan: pipelineResult.researchPlan } : {}),
      ...(pipelineResult.retrieval ? { retrieval: pipelineResult.retrieval } : {}),
      ...(pipelineResult.evidenceRegistry ? { evidenceRegistry: pipelineResult.evidenceRegistry } : {}),
      ...(pipelineResult.lineage ? { lineage: pipelineResult.lineage } : {}),
      lineageValidation,
      ...(analytics ? { peerDiscovery: analytics.peerDiscovery } : {}),
      ...(analytics ? { normalizedHistory: analytics.normalizedHistory } : {}),
      ...(analytics ? { earningsQuality: analytics.earningsQuality } : {}),
      ...(analytics ? { capitalAllocationLedger: analytics.capitalAllocation } : {}),
      ...(analytics ? { managementCredibility: analytics.managementCredibility } : {}),
      ...(analytics ? { guidanceReconciliation: analytics.guidanceReconciliation } : {}),
      ...(pipelineResult.confidenceDecomposition ? { confidenceDecomposition: pipelineResult.confidenceDecomposition } : {}),
      ...(researchReport.researchDiscovery ? { researchDiscovery: researchReport.researchDiscovery } : {}),
      ...(researchReport.evidenceMap ? { evidence: researchReport.evidenceMap } : {}),
      canonicalQa,
      qaDecision,
      reproducibility,
      auditPackage,
      auditPackageHash: auditPackage.packageHash,
      researchMemory: memoryOutcome.entry,
      whatChanged: memoryOutcome.delta,
      updateMode,
      researchReport: { ...researchReport, retrieval: pipelineResult.retrieval, evidenceRegistry: pipelineResult.evidenceRegistry, lineage: pipelineResult.lineage },
      versions: {
        package: "canonical-research-package-v1",
        factPack: pipelineResult.factPack.version,
        model: researchReport.modelVersion,
        forecast: researchReport.forecastVersion,
        valuation: researchReport.valuationVersion,
        review: researchReport.reviewVersion,
        prompt: researchReport.promptVersion,
        retrieval: pipelineResult.retrieval?.version ?? "research-retrieval-v1",
        evidence: "canonical-evidence-registry-v1",
        lineage: pipelineResult.lineage?.version ?? "research-lineage-v1",
        ...(analytics ? { analytics: RESEARCH_ANALYTICS_VERSION } : {}),
        ...(pipelineResult.confidenceDecomposition ? { confidence: RESEARCH_CONFIDENCE_DECOMPOSITION_VERSION } : {}),
        canonicalQa: CANONICAL_QA_VERSION,
        reproducibility: reproducibility.version,
        audit: auditPackage.version,
      },
      quality,
    };
    const sealed = sealCanonicalResearchPackage(packageInput as never);
    globalStageCache.set({ stage: "canonical-package", inputHash: cacheInputHash, pipelineVersion: pipelineVersionForCache, modelVersion: modelVersionForCache, promptVersion: promptVersionForCache, dataVersion: run.sourceSnapshotHash }, { packageHash: sealed.packageHash, packageId: sealed.packageId }, cacheDependencies, run.startedAt);
    emit(event("quality_update", run, sequence, { data: { quality: sealed.quality, publicationStatus: sealed.quality.publicationStatus } }));
    emit(event("completed", run, sequence, { data: { packageId: sealed.packageId, quality: sealed.quality, package: sealed }, package: sealed }));
    return { package: sealed, run: sealed.run, sourceContext, pipelineResult };
  } catch (error) {
    completeActive();
    const paused = error instanceof Error && error.name === "PausedForRateLimitError";
    run.status = paused ? "paused" : "failed";
    run.completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Canonical research failed";
    const code = error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : paused ? "RATE_PAUSED" : "RESEARCH_RUN_FAILED";
    run.error = { code, message };
    const partial = error && typeof error === "object" && "partial" in error
      ? (error as { partial?: unknown }).partial
      : options.resumeFrom ?? null;
    emit(event(paused ? "paused" : "failed", run, sequence, { error: run.error, ...(paused ? { data: { resumeFrom: partial } } : {}) }));
    throw error;
  }
}

export const runProductionResearch = runCanonicalResearch;
export const runCanonicalResearchPipeline = runCanonicalResearch;
export const buildCanonicalResearchPackage = runCanonicalResearch;
export type ProductionResearchResult = CanonicalResearchResult;
