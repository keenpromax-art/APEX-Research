/**
 * APEX RESEARCH — Evidence Graph (Phase 7)
 * ----------------------------------------
 * Directed traceability graph over existing canonical objects:
 *
 *   Source → Evidence → Claim → Analysis → Conclusion → Section
 *
 * PHASE 7 RULES (non-negotiable):
 *  - Reference EvidenceRegistry / claim-validator / modules / blueprints —
 *    never recompute financials or re-score claims with a second engine.
 *  - Material claims (percentage / currency) without an evidence chain are
 *    explicit blockers — never invented into "supported".
 *  - No LLM. No page caps. Existing report output unchanged.
 *  - Missing registry / narratives stay null + unknowns (fail-closed).
 */
import type { ResearchCase } from "@/lib/research-case";
import type { EvidenceConflict, EvidenceRegistry, SourceTier } from "@/lib/evidence-registry";
import type { Claim } from "@/lib/claims";
import type { ResearchSeverity } from "@/lib/severity";
import type { ResearchModuleId, ModuleRunBundle } from "@/lib/research-modules";
import type { ResolvedSection } from "@/lib/report-types";
import type { ComposedSection } from "@/lib/report-composer";

export const EVIDENCE_GRAPH_VERSION = "evidence-graph-v1";

/** Chain stages (documented order; not enforced as a linear pipeline). */
export type EvidenceStage =
  | "source"
  | "evidence"
  | "claim"
  | "analysis"
  | "conclusion"
  | "section";

export type EvidenceNodeKind = EvidenceStage | "question" | "counter-evidence" | "conflict";

export interface EvidenceGraphNode {
  id: string;
  kind: EvidenceNodeKind;
  label: string;
  /** Opaque reference into an existing object (evidence id, claim id, …). */
  ref?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export type EvidenceEdgeKind =
  | "source-produces-evidence"
  | "evidence-supports-claim"
  | "claim-informs-analysis"
  | "analysis-supports-conclusion"
  | "claim-supports-conclusion"
  | "analysis-feeds-section"
  | "conclusion-feeds-section"
  | "claim-in-section"
  | "question-informs-analysis"
  | "question-covers-claim"
  | "evidence-counter-evidence"
  | "counter-evidence-challenges-claim"
  | "conflict-informs-evidence";

export interface EvidenceGraphEdge {
  from: string;
  to: string;
  kind: EvidenceEdgeKind;
}

/** Narrative text fed into the graph for claim extraction. */
export interface EvidenceNarrative {
  /** Stable origin id, e.g. `thesis`, `conclusion`, `section:moat-…`. */
  originId: string;
  text: string;
  /** Blueprint/composed section this narrative belongs to (optional). */
  sectionId?: string;
  /** Research module that owns/produced the narrative (optional). */
  moduleId?: ResearchModuleId;
  /**
   * Chain role. `conclusion` links claims directly to the conclusion node;
   * default `analysis` links through the owning module when present.
   */
  role?: "analysis" | "conclusion";
  stance?: "supports" | "contradicts" | "neutral";
  targetClaimId?: string;
  questionId?: string;
}

/** Per-claim traceability record (material claims gate the exit criterion). */
export interface ClaimTrace {
  claimId: string;
  originId: string;
  text: string;
  kind: Claim["kind"];
  numericValue?: number;
  numericRaw?: string;
  /** Validated via existing claim-validator + registry match. */
  supported: boolean;
  severity: ResearchSeverity;
  evidenceId: string | null;
  tier: SourceTier | null;
  /** Node-id path when fully traceable (Source → Evidence → Claim …). */
  path: string[];
  sectionId: string | null;
  moduleId: ResearchModuleId | null;
  role: "analysis" | "conclusion";
  /** Material % / currency claim with no evidence chain. */
  material: boolean;
  field?: string;
  unit?: string;
  currency?: string;
  scale?: string;
  period?: string;
  periodType?: Claim["periodType"];
  stance: "supports" | "contradicts" | "neutral";
  targetClaimId: string | null;
  questionId: string | null;
}

export interface EvidenceGraphQuestion {
  id: string;
  nodeId: string;
  question: string;
  requiredFor: string;
  evidenceNeeded: string;
}

export interface EvidenceGraphConflict {
  id: string;
  nodeId: string;
  field: string;
  reason: EvidenceConflict["reason"];
  selectedEvidenceId: string;
  incomingEvidenceIds: string[];
  material: boolean;
}

export interface ResearchCompleteness {
  totalQuestions: number;
  addressedQuestions: number;
  evidenceBackedQuestions: number;
  unresolvedQuestions: number;
  score: number;
  evidenceScore: number;
}

export interface EvidenceGraph {
  version: string;
  caseId: string;
  builtAt: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  claims: ClaimTrace[];
  questions: EvidenceGraphQuestion[];
  conflicts: EvidenceGraphConflict[];
  completeness: ResearchCompleteness;
  /** Exit criterion: every material claim has Source→Evidence→Claim chain. */
  materialClaimsTraceable: boolean;
  materialClaimCount: number;
  traceableMaterialCount: number;
  /** Fail-closed markers (EVIDENCE_REGISTRY_MISSING, UNTRACEABLE_CLAIM:…). */
  blockers: string[];
  /** Honest gaps — never filled with invention. */
  unknowns: string[];
}

export interface BuildEvidenceGraphInput {
  researchCase: ResearchCase;
  /** Phase 4 outline sections (or Phase 5 composed sections). */
  sections?: ResolvedSection[] | ComposedSection[] | null;
  /** Phase 3 module bundle — analysis nodes reference available runs. */
  modules?: ModuleRunBundle | null;
  /** Prose to extract claims from (thesis, conclusion, section bodies…). */
  narratives?: EvidenceNarrative[] | null;
  /** Explicit registry override; defaults to `researchCase.evidence`. */
  registry?: EvidenceRegistry | null;
  /** Injectable stamp for deterministic tests. */
  builtAt?: string;
}
