import type {
  CompanyUnderstanding,
  EvidenceMap,
  FactPack,
  ForecastResult,
  ForecastSpecification,
  MonteCarloResult,
  ResearchDiscoveryPack,
  ResearchReport,
  ReverseValuationResult,
  ScenarioSetValidation,
  ScenarioSpecification,
  SensitivityAnalysis,
  ValuationMatrix,
  ValuationResult,
  ValuationSpecification,
} from "@/lib/ai-first/types";
import type { ResearchPlan } from "@/lib/ai-first/research-planner";
import type { ModelSpecValidationResult as ValidatorResult } from "@/lib/ai-first/model-spec-validator";
import type { NormalizedResearchSourceContext, ResearchSourceSnapshot } from "@/lib/research-context/builder";
import type { CanonicalEvidenceRegistry } from "@/lib/research-retrieval/evidence";
import type { ResearchRetrievalResult } from "@/lib/research-retrieval/types";
import type { ResearchLineageGraph, ResearchLineageValidation } from "@/lib/research-lineage/types";
import type { PeerDiscoveryResult } from "@/lib/peer-discovery/types";
import type { NormalizedHistoryResult } from "@/lib/history/types";
import type { EarningsQualityAssessment } from "@/lib/earnings-quality/types";
import type { CapitalAllocationLedger } from "@/lib/capital-allocation/types";
import type { ManagementCredibilityLedger } from "@/lib/management-credibility/types";
import type { GuidanceReconciliation } from "@/lib/guidance-reconciliation";
import type { ConfidenceDecomposition } from "@/lib/research-package/confidence";

export const CANONICAL_RESEARCH_PACKAGE_VERSION = "canonical-research-package-v1" as const;
export const RESEARCH_RUN_EVENT_SCHEMA_VERSION = "research-run-event-v1" as const;
export const CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION = "canonical-research-package-schema-v1" as const;

export type ResearchPublicationStatus = "publishable" | "blocked" | "preview";
export type ResearchQualityStatus = "ready" | "blocked" | "preview";

export interface ResearchQualityCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  blocking: boolean;
}

export interface ResearchQualityState {
  status: ResearchQualityStatus;
  publicationStatus: ResearchPublicationStatus;
  canPublish: boolean;
  canUseDiagnosticPreview: boolean;
  checks: ResearchQualityCheck[];
  blockers: string[];
  warnings: string[];
}

export interface ResearchPackageIntegrity {
  sealed: boolean;
  hashAlgorithm: "sha256";
  hashMatches: boolean;
  packageHash?: string;
  immutable: boolean;
}

export interface ResearchRunCheckpoint {
  id: string;
  stage: string;
  status: "started" | "completed" | "paused" | "failed";
  at: string;
  detail?: string;
}

export type ResearchRunStatus = "queued" | "running" | "paused" | "completed" | "failed";

export interface ResearchRun {
  runId: string;
  schemaVersion: typeof CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION;
  ticker: string;
  status: ResearchRunStatus;
  dataCutoff: string;
  sourceSnapshotHash: string;
  startedAt: string;
  completedAt?: string;
  options: Record<string, unknown>;
  checkpoints: ResearchRunCheckpoint[];
  packageId?: string;
  error?: { code: string; message: string };
}

export interface CanonicalResearchPackage {
  schemaVersion: typeof CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION;
  packageVersion: typeof CANONICAL_RESEARCH_PACKAGE_VERSION;
  packageId: string;
  researchRunId: string;
  run: ResearchRun;
  ticker: string;
  dataCutoff: string;
  sourceSnapshotHash: string;
  sourceSnapshot: ResearchSourceSnapshot;
  sourceContext: NormalizedResearchSourceContext;
  normalizedSourceContext: NormalizedResearchSourceContext;
  factPack: FactPack;
  modelSpec: ForecastSpecification;
  modelValidation?: ValidatorResult;
  forecastSpec: ForecastSpecification;
  executedForecast: ForecastResult;
  forecast: ForecastResult;
  valuationSpec: ValuationSpecification;
  valuationMatrix: ValuationMatrix;
  valuationResult: ValuationResult;
  valuation: ValuationResult;
  rating: "BUY" | "HOLD" | "SELL" | "NR";
  scenarios: ScenarioSpecification[];
  scenarioOutputs: ScenarioSpecification[];
  scenarioValidation?: ScenarioSetValidation;
  sensitivity: Array<Record<string, number | string>>;
  sensitivityAnalysis?: SensitivityAnalysis;
  monteCarlo?: MonteCarloResult;
  reverseResult?: ReverseValuationResult | null;
  reverseValuationResult?: ReverseValuationResult | null;
  researchPlan?: ResearchPlan;
  researchDiscovery?: ResearchDiscoveryPack;
  evidence?: EvidenceMap;
  evidenceMap?: EvidenceMap;
  retrieval?: ResearchRetrievalResult;
  evidenceRegistry?: CanonicalEvidenceRegistry;
  lineage?: ResearchLineageGraph;
  lineageValidation?: ResearchLineageValidation;
  peerDiscovery?: PeerDiscoveryResult;
  normalizedHistory?: NormalizedHistoryResult;
  earningsQuality?: EarningsQualityAssessment;
  capitalAllocationLedger?: CapitalAllocationLedger;
  managementCredibility?: ManagementCredibilityLedger;
  guidanceReconciliation?: GuidanceReconciliation;
  confidenceDecomposition?: ConfidenceDecomposition;
  researchReport: ResearchReport;
  companyUnderstanding: CompanyUnderstanding;
  qualityStatus: ResearchQualityStatus;
  publicationStatus: ResearchPublicationStatus;
  publicationBlocked: boolean;
  quality: ResearchQualityState;
  integrity: ResearchPackageIntegrity;
  canonicalQa?: import("@/lib/canonical-qa/types").CanonicalQaResult;
  qaDecision?: import("@/lib/canonical-qa/types").CanonicalQaDecision;
  reproducibility?: import("@/lib/canonical-qa/types").ReproducibilityMetadata;
  auditPackage?: import("@/lib/canonical-qa/types").MachineAuditPackage;
  auditPackageHash?: string;
  researchMemory?: import("@/lib/canonical-qa/types").LongitudinalMemoryEntry | null;
  whatChanged?: import("@/lib/canonical-qa/types").WhatChangedReport | null;
  updateMode?: import("@/lib/canonical-qa/types").ResearchUpdateMode;
  versions: {
    package: string;
    factPack: string;
    model: string;
    forecast: string;
    valuation: string;
    review: string;
    prompt: string;
    retrieval?: string;
    evidence?: string;
    lineage?: string;
    analytics?: string;
    confidence?: string;
    canonicalQa?: string;
    reproducibility?: string;
    audit?: string;
  };
  packageHash: string;
}

export type ResearchRunEventType =
  | "run_started"
  | "stage_started"
  | "stage_completed"
  | "checkpoint"
  | "quality_update"
  | "paused"
  | "completed"
  | "failed";

export interface ResearchRunEvent {
  schemaVersion: typeof RESEARCH_RUN_EVENT_SCHEMA_VERSION;
  type: ResearchRunEventType;
  runId: string;
  ticker: string;
  sequence: number;
  emittedAt: string;
  stage?: string;
  run?: ResearchRun;
  checkpoint?: ResearchRunCheckpoint;
  data?: Record<string, unknown>;
  package?: CanonicalResearchPackage;
  error?: { code: string; message: string };
}

export interface CanonicalResearchPackageInput {
  ticker: string;
  dataCutoff: string;
  sourceSnapshotHash: string;
  sourceSnapshot?: ResearchSourceSnapshot;
  sourceContext: NormalizedResearchSourceContext;
  normalizedSourceContext?: NormalizedResearchSourceContext;
  run: ResearchRun;
  factPack: FactPack;
  modelSpec: ForecastSpecification;
  modelValidation?: ValidatorResult;
  forecastSpec: ForecastSpecification;
  executedForecast: ForecastResult;
  valuationSpec: ValuationSpecification;
  valuationMatrix: ValuationMatrix;
  valuationResult: ValuationResult;
  rating: "BUY" | "HOLD" | "SELL" | "NR";
  scenarios: ScenarioSpecification[];
  scenarioValidation?: ScenarioSetValidation;
  sensitivity: Array<Record<string, number | string>>;
  sensitivityAnalysis?: SensitivityAnalysis;
  monteCarlo?: MonteCarloResult;
  reverseResult?: ReverseValuationResult | null;
  researchPlan?: ResearchPlan;
  researchDiscovery?: ResearchDiscoveryPack;
  evidence?: EvidenceMap;
  retrieval?: ResearchRetrievalResult;
  evidenceRegistry?: CanonicalEvidenceRegistry;
  lineage?: ResearchLineageGraph;
  lineageValidation?: ResearchLineageValidation;
  peerDiscovery?: PeerDiscoveryResult;
  normalizedHistory?: NormalizedHistoryResult;
  earningsQuality?: EarningsQualityAssessment;
  capitalAllocationLedger?: CapitalAllocationLedger;
  managementCredibility?: ManagementCredibilityLedger;
  guidanceReconciliation?: GuidanceReconciliation;
  confidenceDecomposition?: ConfidenceDecomposition;
  researchReport: ResearchReport;
  versions?: Partial<CanonicalResearchPackage["versions"]>;
  quality?: ResearchQualityState;
}
