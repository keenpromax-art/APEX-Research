export const CANONICAL_QA_VERSION = "canonical-qa-v1" as const;
export const CANONICAL_QA_DECISION_VERSION = "canonical-qa-decision-v1" as const;
export const REPRODUCIBILITY_VERSION = "reproducibility-v1" as const;
export const MACHINE_AUDIT_PACKAGE_VERSION = "machine-audit-package-v1" as const;
export const RESEARCH_MEMORY_VERSION = "longitudinal-research-memory-v1" as const;
export type CanonicalQaDimension =
  | "numerical"
  | "accounting"
  | "evidence"
  | "model"
  | "forecast"
  | "valuation"
  | "scenario"
  | "competitive"
  | "narrative"
  | "cross-section"
  | "contamination"
  | "freshness"
  | "reproducibility"
  | "pdf-plumbing";
export type CanonicalQaSeverity = "blocker" | "major" | "minor" | "info";
export type CanonicalQaDecision = "BLOCK" | "REVIEW" | "QUALIFIED" | "READY";
export type ResearchUpdateMode = "initiation" | "update" | "event" | "thesis-change" | "deep-dive";
export interface CanonicalQaDiagnostic {
  id: string;
  dimension: CanonicalQaDimension;
  severity: CanonicalQaSeverity;
  component: string;
  finding: string;
  recommendation: string;
  evidenceRefs: string[];
  deterministic: boolean;
}
export interface CanonicalDimensionScore {
  dimension: CanonicalQaDimension;
  score: number;
  passed: boolean;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
  infoCount: number;
}
export interface CanonicalIntegrityScores {
  version: typeof CANONICAL_QA_VERSION;
  dimensions: CanonicalDimensionScore[];
  overall: number;
  grade: string;
  blockerCount: number;
  majorCount: number;
  minorCount: number;
  infoCount: number;
}
export interface ReproducibilityMetadata {
  version: typeof REPRODUCIBILITY_VERSION;
  gitCommit: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tokenBudget: number;
  promptVersion: string;
  promptHash: string;
  pipelineVersion: string;
  factPackVersion: string;
  dataHash: string;
  factHash: string;
  modelHash: string;
  assumptionHash: string;
  forecastHash: string;
  valuationHash: string;
  reportHash: string;
  generatedAt: string;
}
export interface RegenerationAttempt {
  attempt: number;
  stage: string;
  kind: "deterministic" | "bounded-llm" | "skipped";
  triggerDiagnosticIds: string[];
  status: "fixed" | "unfixed" | "skipped";
  detail: string;
  at: string;
}
export interface CanonicalQaResult {
  version: typeof CANONICAL_QA_VERSION;
  generatedAt: string;
  inputHash: string;
  reportHash: string;
  dimensions: CanonicalQaDimension[];
  diagnostics: CanonicalQaDiagnostic[];
  scores: CanonicalIntegrityScores;
  decision: CanonicalQaDecision;
  blockers: string[];
  warnings: string[];
  stale: boolean;
  advisoryPreview: AdvisoryPreviewPolicy;
  attempts: RegenerationAttempt[];
  reproducibilityHash: string | null;
}
export interface AdvisoryPreviewPolicy {
  allowed: boolean;
  label: string;
  reason: string;
  exportAllowed: boolean;
  publishAllowed: boolean;
}
export interface MachineAuditPackage {
  version: typeof MACHINE_AUDIT_PACKAGE_VERSION;
  generatedAt: string;
  packageHash: string;
  reportHash: string;
  hashes: Record<string, string>;
  report: unknown;
  evidenceRegistry: unknown;
  model: unknown;
  forecast: unknown;
  valuation: unknown;
  assumptions: unknown;
  qa: unknown;
  researchPlan: unknown;
  lineage: unknown;
  reproducibility: unknown;
}
export interface WhatChangedDelta {
  field: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  beforeHash: string | null;
  afterHash: string | null;
  before: unknown;
  after: unknown;
}
export interface WhatChangedReport {
  version: typeof RESEARCH_MEMORY_VERSION;
  fromRunId: string | null;
  toRunId: string;
  mode: ResearchUpdateMode;
  generatedAt: string;
  deltas: WhatChangedDelta[];
  changedFields: string[];
  hasChanges: boolean;
  hash: string;
}
export interface LongitudinalMemoryEntry {
  version: typeof RESEARCH_MEMORY_VERSION;
  companyId: string;
  runId: string;
  mode: ResearchUpdateMode;
  occurredAt: string;
  dataCutoff: string;
  previousRunId: string | null;
  lineage: string[];
  status: string;
  contentHash: string;
  snapshotHash: string;
  deltaHash: string | null;
  snapshot: Record<string, unknown>;
}
