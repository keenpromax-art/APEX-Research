import type { CanonicalSourceMetadata } from "../ai-first/types";

export const RESEARCH_LINEAGE_VERSION = "research-lineage-v1";

export const LINEAGE_NODE_KINDS = Object.freeze([
  "source_document",
  "observation",
  "fact",
  "derived_metric",
  "assumption",
  "forecast",
  "valuation",
  "formula",
  "scenario",
  "claim",
  "conclusion",
  "conflict",
  "corporate_action",
  "unknown",
] as const);

export const LINEAGE_EDGE_KINDS = Object.freeze([
  "contains_observation",
  "normalizes_to_fact",
  "derives",
  "assumes",
  "feeds_forecast",
  "feeds_valuation",
  "contains_formula",
  "produces_scenario",
  "scenario_supports_claim",
  "blocks_claim",
  "restsates",
  "supports_claim",
  "concludes",
  "conflicts_with",
  "adjusts_for",
  "records_unknown",
] as const);

export type LineageNodeKind = (typeof LINEAGE_NODE_KINDS)[number];
export type LineageEdgeKind = (typeof LINEAGE_EDGE_KINDS)[number];

export interface ResearchLineageNodeInput {
  id: string;
  kind: LineageNodeKind;
  label: string;
  value?: unknown;
  period?: string;
  sourceId?: string;
  factId?: string;
  observationId?: string;
  sourceDocumentId?: string;
  documentId?: string;
  formulaId?: string;
  scenarioId?: string;
  assumptionId?: string;
  forecastId?: string;
  valuationId?: string;
  claimId?: string;
  conclusionId?: string;
  action?: string;
  asOf?: string;
  restatementOf?: string;
  blocker?: string;
  source?: CanonicalSourceMetadata;
  evidenceNodeIds?: readonly string[];
  material?: boolean;
  confidence?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchLineageNode extends Omit<ResearchLineageNodeInput, "evidenceNodeIds"> {
  readonly version: typeof RESEARCH_LINEAGE_VERSION;
  readonly evidenceNodeIds: readonly string[];
  readonly contentHash: string;
}

export interface ResearchLineageEdgeInput {
  from: string;
  to: string;
  kind: LineageEdgeKind;
  confidence?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ResearchLineageEdge extends ResearchLineageEdgeInput {
  readonly version: typeof RESEARCH_LINEAGE_VERSION;
  readonly contentHash: string;
}

export type LineageValidationCode =
  | "DUPLICATE_NODE_ID"
  | "DANGLING_EDGE_REFERENCE"
  | "MISSING_EVIDENCE_REFERENCE"
  | "FORGED_EVIDENCE_REFERENCE"
  | "UNSUPPORTED_STAGE"
  | "LINEAGE_CYCLE"
  | "MISSING_MATERIAL_CLAIM_LINEAGE"
  | "MISSING_MATERIAL_CLAIM_BLOCKER"
  | "INVALID_SOURCE_METADATA"
  | "INTEGRITY_FAILURE";

export interface LineageValidationIssue {
  code: LineageValidationCode;
  nodeIds: readonly string[];
  edgeIndexes: readonly number[];
  message: string;
}

export interface ResearchLineageValidation {
  valid: boolean;
  closed: boolean;
  acyclic: boolean;
  referencesValid: boolean;
  materialClaimsTraceable: boolean;
  materialClaimCount: number;
  traceableMaterialClaimCount: number;
  blockedClaimIds: readonly string[];
  blockers: readonly string[];
  claimPaths: Readonly<Record<string, readonly string[]>>;
  issues: readonly LineageValidationIssue[];
}

export interface ResearchLineageGraphInput {
  subjectId: string;
  nodes: readonly ResearchLineageNodeInput[];
  edges: readonly ResearchLineageEdgeInput[];
}

export interface ResearchLineageGraph {
  readonly version: typeof RESEARCH_LINEAGE_VERSION;
  readonly subjectId: string;
  readonly nodes: readonly ResearchLineageNode[];
  readonly edges: readonly ResearchLineageEdge[];
  readonly materialClaimCount: number;
  readonly traceableMaterialClaimCount: number;
  readonly materialClaimsTraceable: boolean;
  readonly blockedClaimIds: readonly string[];
  readonly blockers: readonly string[];
  readonly validation?: ResearchLineageValidation;
  readonly contentHash: string;
}
