import { verifyFactPack } from "@/lib/ai-first/fact-pack";
import type { CanonicalResearchPackage, ResearchQualityCheck, ResearchQualityState } from "./types";
import { verifyCanonicalResearchPackage } from "./hash";
import { validateResearchLineageGraph, verifyResearchLineageGraph } from "@/lib/research-lineage/graph";
import { verifyCanonicalQaResult } from "@/lib/canonical-qa/decision";
import { verifyMachineAuditPackage } from "@/lib/canonical-qa/audit-package";
import { verifyReproducibilityMetadata } from "@/lib/canonical-qa/reproducibility";
import { advisoryPreviewPolicyForCanonicalPackage } from "@/lib/canonical-qa/advisory";
import type { CanonicalQaDecision } from "@/lib/canonical-qa/types";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function assessResearchQuality(input: {
  factPackVerified: boolean;
  currencyBlocked: boolean;
  currentPriceAvailable: boolean;
  currentPriceFreshness?: "fresh" | "stale" | "unknown";
  currentPriceDelayed?: boolean;
  forecastReady: boolean;
  valuationReady: boolean;
  modelValid: boolean;
  reviewPassed: boolean;
  retrievalStatus?: "ready" | "partial" | "failed" | "unavailable";
  retrievalVerified?: boolean;
  lineageVerified?: boolean;
  lineageTraceable?: boolean;
  peerDiscoveryStatus?: "ready" | "insufficient" | "unavailable";
  peerSetsReady?: number;
  historyStatus?: "ready" | "insufficient" | "unavailable";
  historyMetricsReady?: number;
  historyClaimsDepending?: readonly string[];
  historyClaimsUnsupported?: readonly string[];
  qaDecision?: CanonicalQaDecision | null;
  qaVerified?: boolean;
  reproducibilityVerified?: boolean;
  auditVerified?: boolean;
  blockers?: string[];
  warnings?: string[];
}): ResearchQualityState {
  const checks: ResearchQualityCheck[] = [
    {
      id: "fact-pack-integrity",
      status: input.factPackVerified ? "pass" : "fail",
      blocking: true,
      message: input.factPackVerified ? "FactPack is sealed and content-addressed." : "FactPack integrity is unavailable.",
    },
    {
      id: "currency-share-basis",
      status: input.currencyBlocked ? "fail" : "pass",
      blocking: true,
      message: input.currencyBlocked ? "Currency/share basis normalization is blocked." : "Currency and share basis are normalized.",
    },
    {
      id: "market-price",
      status: input.currentPriceAvailable ? "pass" : "fail",
      blocking: true,
      message: input.currentPriceAvailable ? "Canonical current price is available." : "Canonical current price is unavailable.",
    },
    {
      id: "forecast",
      status: input.forecastReady ? "pass" : "fail",
      blocking: true,
      message: input.forecastReady ? "Canonical forecast executed and passed model checks." : "Canonical forecast is blocked or unavailable.",
    },
    {
      id: "valuation",
      status: input.valuationReady ? "pass" : "fail",
      blocking: true,
      message: input.valuationReady ? "Canonical valuation matrix and selected result are ready." : "Canonical valuation is blocked or unavailable.",
    },
    {
      id: "model-validation",
      status: input.modelValid ? "pass" : "fail",
      blocking: true,
      message: input.modelValid ? "Model specification validation passed." : "Model specification validation is blocked.",
    },
    {
      id: "research-review",
      status: input.reviewPassed ? "pass" : "warn",
      blocking: true,
      message: input.reviewPassed ? "Research quality review passed." : "Research quality review has findings.",
    },
  ];
  if (input.currentPriceFreshness !== undefined) {
    checks.push({
      id: "market-price-freshness",
      status: input.currentPriceFreshness === "fresh" ? "pass" : input.currentPriceFreshness === "stale" ? "warn" : "fail",
      blocking: true,
      message: input.currentPriceFreshness === "fresh" ? "Current-price timestamp is fresh." : `Current-price freshness is ${input.currentPriceFreshness}.`,
    });
  }
  if (input.currentPriceDelayed !== undefined) {
    checks.push({
      id: "market-price-delivery",
      status: input.currentPriceDelayed ? "warn" : "pass",
      blocking: false,
      message: input.currentPriceDelayed ? "Current price is delayed by the source." : "Current price is delivered without a source delay flag.",
    });
  }
  if (input.retrievalStatus !== undefined) {
    const retrievalPass = input.retrievalStatus === "ready" && input.retrievalVerified === true;
    checks.push({
      id: "research-retrieval",
      status: retrievalPass ? "pass" : input.retrievalStatus === "partial" ? "warn" : "fail",
      blocking: true,
      message: retrievalPass ? "Research retrieval is available and content-addressed." : `Research retrieval is ${input.retrievalStatus}.`,
    });
  }
  if (input.lineageVerified !== undefined) {
    checks.push({
      id: "research-lineage-integrity",
      status: input.lineageVerified ? "pass" : "fail",
      blocking: true,
      message: input.lineageVerified ? "Canonical research lineage passed integrity verification." : "Canonical research lineage failed integrity verification.",
    });
  }
  if (input.lineageTraceable !== undefined) {
    checks.push({
      id: "material-claim-lineage",
      status: input.lineageTraceable ? "pass" : "fail",
      blocking: true,
      message: input.lineageTraceable ? "Material claims have source-to-claim lineage or no material blockers." : "One or more material claims lack source-to-claim lineage.",
    });
  }
  const analyticsWarnings: string[] = [];
  if (input.peerDiscoveryStatus !== undefined && input.peerDiscoveryStatus !== "ready") {
    analyticsWarnings.push(`Economic peer discovery is ${input.peerDiscoveryStatus} (${input.peerSetsReady ?? 0} set role(s) evidenced); relative peer claims stay explicitly unavailable rather than fabricated.`);
  }
  if (input.historyStatus !== undefined && input.historyStatus !== "ready") {
    analyticsWarnings.push(`Normalized history is ${input.historyStatus} (${input.historyMetricsReady ?? 0} metric(s) ready); long-horizon trend claims stay explicitly unavailable.`);
  }
  if (input.qaDecision !== undefined && input.qaDecision !== null) {
    const decision = input.qaDecision;
    const verified = input.qaVerified !== false;
    if (!verified) {
      checks.push({ id: "canonical-qa-integrity", status: "fail", blocking: true, message: "Canonical QA result failed integrity verification." });
    } else if (decision === "BLOCK") {
      checks.push({ id: "canonical-qa-decision", status: "fail", blocking: true, message: "Canonical QA decision is BLOCK; publication requires remediation." });
    } else if (decision === "REVIEW") {
      checks.push({ id: "canonical-qa-decision", status: "fail", blocking: true, message: "Canonical QA decision is REVIEW; publication requires review." });
    } else if (decision === "QUALIFIED") {
      checks.push({ id: "canonical-qa-decision", status: "warn", blocking: false, message: "Canonical QA decision is QUALIFIED; publication carries disclosed qualifications." });
    } else {
      checks.push({ id: "canonical-qa-decision", status: "pass", blocking: true, message: "Canonical QA decision is READY." });
    }
  }
  if (input.reproducibilityVerified !== undefined) {
    checks.push({
      id: "reproducibility-integrity",
      status: input.reproducibilityVerified ? "pass" : "fail",
      blocking: true,
      message: input.reproducibilityVerified ? "Reproducibility metadata is complete and hashed." : "Reproducibility metadata is missing or invalid.",
    });
  }
  if (input.auditVerified !== undefined) {
    checks.push({
      id: "audit-package-integrity",
      status: input.auditVerified ? "pass" : "fail",
      blocking: true,
      message: input.auditVerified ? "Machine audit package verified." : "Machine audit package is missing or invalid.",
    });
  }
  const dependentClaims = [...new Set(input.historyClaimsDepending ?? [])];
  const unsupportedClaims = [...new Set(input.historyClaimsUnsupported ?? [])];
  const materialDependency = dependentClaims.filter((claim) => unsupportedClaims.includes(claim));
  if (input.peerDiscoveryStatus !== undefined || input.historyStatus !== undefined) {
    checks.push({
      id: "research-analytics",
      status: input.peerDiscoveryStatus === "ready" && input.historyStatus === "ready" ? "pass" : materialDependency.length > 0 ? "fail" : "warn",
      blocking: materialDependency.length > 0,
      message: materialDependency.length > 0
        ? `Material claim(s) ${materialDependency.join(", ")} depend on peer or history artifacts that are not ready.`
        : input.peerDiscoveryStatus === "ready" && input.historyStatus === "ready"
          ? "Economic peer and normalized-history artifacts are ready."
          : [...analyticsWarnings].join(" "),
    });
  }
  const blockers = [...new Set([
    ...(input.blockers ?? []),
    ...checks.filter((check) => check.status === "fail").map((check) => `${check.id}: ${check.message}`),
  ])];
  const warnings = [...new Set([...(input.warnings ?? []), ...analyticsWarnings])];
  const canPublish = blockers.length === 0 && checks.every((check) => !check.blocking || check.status === "pass");
  return {
    status: canPublish ? "ready" : "blocked",
    publicationStatus: canPublish ? "publishable" : "blocked",
    canPublish,
    canUseDiagnosticPreview: !canPublish,
    checks,
    blockers,
    warnings,
  };
}

export function assessSealedResearchPackage(value: unknown): ResearchQualityState {
  if (!verifyCanonicalResearchPackage(value)) {
    const advisory = advisoryPreviewPolicyForCanonicalPackage({ blockers: ["package-integrity: Package integrity verification failed."] });
    return {
      status: "blocked",
      publicationStatus: "blocked",
      canPublish: false,
      canUseDiagnosticPreview: advisory.allowed,
      checks: [{ id: "package-integrity", status: "fail", blocking: true, message: `Package integrity verification failed. ${advisory.label}.` }],
      blockers: ["package-integrity: Package integrity verification failed."],
      warnings: [],
    };
  }
  const candidate = value as CanonicalResearchPackage;
  const lineageValidation = candidate.lineage ? validateResearchLineageGraph(candidate.lineage) : undefined;
  const qaDecision = (candidate.qaDecision ?? candidate.canonicalQa?.decision ?? candidate.researchReport?.qaDecision ?? candidate.researchReport?.canonicalQa?.decision ?? null) as CanonicalQaDecision | null;
  const qaVerified = candidate.canonicalQa ? verifyCanonicalQaResult(candidate.canonicalQa) : candidate.researchReport?.canonicalQa ? verifyCanonicalQaResult(candidate.researchReport.canonicalQa) : qaDecision === null ? undefined : true;
  const reproducibilityVerified = candidate.reproducibility ? verifyReproducibilityMetadata(candidate.reproducibility) : candidate.researchReport?.reproducibility ? verifyReproducibilityMetadata(candidate.researchReport.reproducibility) : undefined;
  const auditVerified = candidate.auditPackage ? verifyMachineAuditPackage(candidate.auditPackage) : candidate.researchReport?.auditPackage ? verifyMachineAuditPackage(candidate.researchReport.auditPackage) : undefined;
  const quality = assessResearchQuality({
    factPackVerified: verifyFactPack(candidate.factPack),
    currencyBlocked: candidate.sourceContext.currencyBasis.blocked,
    currentPriceAvailable: finite(candidate.sourceContext.stockData.currentPrice) && candidate.sourceContext.stockData.currentPrice > 0,
    ...(candidate.factPack.currentPriceMetadata ? { currentPriceFreshness: candidate.factPack.currentPriceMetadata.freshness, currentPriceDelayed: candidate.factPack.currentPriceMetadata.delayed } : {}),
    forecastReady: candidate.executedForecast.status === "ready" && candidate.executedForecast.publicationBlocked !== true,
    valuationReady: candidate.valuationResult.status === "ready" && candidate.valuationMatrix.status === "ready" && finite(candidate.valuationResult.fairValuePerShare),
    modelValid: candidate.modelValidation?.valid !== false,
    reviewPassed: candidate.researchReport.reviewPassed === true,
    retrievalStatus: candidate.retrieval?.status ?? "unavailable",
    retrievalVerified: candidate.retrieval ? candidate.retrieval.available && candidate.retrieval.resultHash.length === 64 && candidate.retrieval.status !== "failed" && candidate.retrieval.status !== "unavailable" : false,
    lineageVerified: candidate.lineage ? verifyResearchLineageGraph(candidate.lineage) : false,
    lineageTraceable: candidate.lineage ? lineageValidation?.materialClaimsTraceable === true : false,
    ...(qaDecision ? { qaDecision, ...(qaVerified !== undefined ? { qaVerified } : {}) } : {}),
    ...(reproducibilityVerified !== undefined ? { reproducibilityVerified } : {}),
    ...(auditVerified !== undefined ? { auditVerified } : {}),
    ...(candidate.peerDiscovery ? { peerDiscoveryStatus: candidate.peerDiscovery.status, peerSetsReady: Object.values(candidate.peerDiscovery.peerSets).filter((set) => set.status === "ready").length } : {}),
    ...(candidate.normalizedHistory
      ? {
          historyStatus: candidate.normalizedHistory.status,
          historyMetricsReady: candidate.normalizedHistory.coverage.metricsReady,
          historyClaimsDepending: candidate.normalizedHistory.materialClaims.map((claim) => claim.claim),
          historyClaimsUnsupported: candidate.normalizedHistory.materialClaims.filter((claim) => claim.supportedBy.length === 0).map((claim) => claim.claim),
        }
      : {}),
    blockers: candidate.quality.blockers,
    warnings: candidate.quality.warnings,
  });
  return {
    ...quality,
    checks: [
      { id: "package-integrity", status: "pass", blocking: true, message: "Package hash and immutability seal verified." },
      ...quality.checks,
    ],
  };
}

export function canPublishResearchPackage(value: unknown): boolean {
  return assessSealedResearchPackage(value).canPublish;
}

export function isPublicationBlocked(value: unknown): boolean {
  return !canPublishResearchPackage(value);
}

export function diagnosticPreviewLabel(value: unknown): string {
  return canPublishResearchPackage(value) ? "PDF" : "Diagnostic preview (non-publishable)";
}
