/**
 * APEX RESEARCH — AI Orchestration (Phase 6)
 * ------------------------------------------
 * Reusable roles, a deterministic ResearchTask planner, committee review and
 * red-team probes. References existing personas / rosters / QA — never a
 * second scoring engine and never a provider-specific call path.
 *
 * PHASE 6 RULES (non-negotiable):
 *  - Provider interchangeability preserved: orchestration talks only to an
 *    injected `OrchestrationTransport` (adapters over the four existing
 *    transport shapes). No fetch, no model lists, no vendor branching here.
 *  - Do not fork openrouter council logic, quality-review scoring, or
 *    writer-checker attempt budgets — re-export / wrap by reference.
 *  - Deterministic planner: no LLM required to build the task graph.
 *  - Never invent numbers or findings; missing inputs stay null / blockers.
 *  - Existing report output is unchanged (this module is opt-in).
 */
import type { AgentFamily, ModelTier } from "@/lib/agent-team";
import type { ResearchModuleId } from "@/lib/research-modules";
import type { ResearchDepth, ReportTypeId } from "@/lib/report-types";
import type { CouncilVerificationAudit } from "@/types/report";
import type { FactPack, ResearchReport } from "@/lib/ai-first/types";
import type { ReviewFinding, ReviewSeverity } from "@/lib/ai-first/quality-review";
import type { runQualityReview, adjudicateRegeneration } from "@/lib/ai-first/quality-review";

export const RESEARCH_ORCHESTRATION_VERSION = "research-orchestration-v1";

/**
 * Mirrors the live council gate in openrouter.ts (`COUNCIL_PASS_THRESHOLD`).
 * Used only when the committee folds a `CouncilVerificationAudit` into its
 * decision — not a new gate on the existing /api/analyze pipeline.
 */
export const COUNCIL_PASS_THRESHOLD = 70;

/** Writer/checker attempt budget — reference, never a local copy of the number. */
export { WRITER_CHECKER_MAX_ATTEMPTS } from "@/lib/writer-checker-loop";

// ─────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────

export type RoleSource =
  | "council"
  | "agent-team"
  | "quality-review"
  | "writer-checker"
  | "orchestration";

/** Unified role descriptor over existing rosters (ids stay source-unique). */
export interface ResearchRole {
  id: string;
  name: string;
  /** One-line job contract. */
  role: string;
  source: RoleSource;
  tier?: ModelTier;
  family?: AgentFamily;
  needsLlm: boolean;
  /** For checkers: role id(s) this seat helps. */
  helps?: string[];
}

// ─────────────────────────────────────────────
// ResearchTask
// ─────────────────────────────────────────────

export type ResearchTaskKind =
  | "plan"
  | "author"
  | "checker"
  | "red-team"
  | "committee";

export type ResearchTaskStatus = "pending" | "ready" | "blocked" | "done" | "skipped";

/**
 * One unit of orchestration work. `resultRef` is an opaque pointer — tasks
 * never store financial numbers (LLM prose is never the source of truth).
 */
export interface ResearchTask {
  id: string;
  kind: ResearchTaskKind;
  title: string;
  /** `ResearchRole.id` in the role catalog. */
  roleId: string;
  status: ResearchTaskStatus;
  needsLlm: boolean;
  /** Task ids that must complete first (acyclic). */
  dependsOn: string[];
  /** Blueprint section this task feeds (authors/checkers). */
  sectionId?: string;
  /** First research module the section declares (routing hint only). */
  moduleId?: ResearchModuleId;
  /** Fail-closed markers (e.g. PEERS_SUPPRESSED, NO_VALUATION). */
  blockers: string[];
  /** Attempt budget (authors use WRITER_CHECKER_MAX_ATTEMPTS). */
  maxAttempts: number;
  attempt: number;
  /** Opaque handle to prose/audit output — never inline financial truth. */
  resultRef?: string;
}

export interface ResearchTaskPlan {
  version: string;
  caseId: string | null;
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  /** Deterministic stamp (injectable for tests). */
  plannedAt: string;
  tasks: ResearchTask[];
  /** Unique role ids referenced (stable order). */
  roleIds: string[];
  /** Plan-level blockers copied from the ResearchCase data quality. */
  blockers: string[];
}

// ─────────────────────────────────────────────
// Committee
// ─────────────────────────────────────────────

export interface CommitteeSeat {
  roleId: string;
  name: string;
  focus: string;
}

export type QualityReviewOutcome = ReturnType<typeof runQualityReview>;
export type AdjudicationOutcome = ReturnType<typeof adjudicateRegeneration>;

export interface CommitteeDecision {
  version: string;
  seats: CommitteeSeat[];
  /** Present when report+pack were supplied (or an injected review). */
  qualityReview: QualityReviewOutcome | null;
  adjudication: AdjudicationOutcome | null;
  councilAudit: CouncilVerificationAudit | null;
  /** Red-team findings folded into the gate (by reference). */
  redTeamFindings: RedTeamFinding[];
  passed: boolean;
  blockers: string[];
  regenerate: string[];
  decidedAt: string;
}

// ─────────────────────────────────────────────
// Red team
// ─────────────────────────────────────────────

export type RedTeamProbeId =
  | "blockers-propagate"
  | "peers-suppressed"
  | "missing-valuation"
  | "task-graph-closure"
  | "author-needs-checker"
  | "debates-gate"
  | "unknowns-not-invented";

export interface RedTeamFinding {
  id: string;
  severity: ReviewSeverity;
  component: string;
  finding: string;
  recommendation: string;
  /** Deterministic probe id, or "llm-adversary". */
  probe: RedTeamProbeId | "llm-adversary";
}

export interface RedTeamResult {
  version: string;
  findings: RedTeamFinding[];
  /** Probe ids attempted (stable order). */
  probesRun: string[];
  passed: boolean;
  /** True when an LLM adversary transport was supplied and responded. */
  llmUsed: boolean;
}
