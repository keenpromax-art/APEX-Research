import { WRITER_CHECKER_MAX_ATTEMPTS } from "@/lib/writer-checker-loop";
import type { ResearchCase } from "@/lib/research-case";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";
import type { ResearchTask } from "./types";
import { RESEARCH_ORCHESTRATION_VERSION } from "./types";
import { IDENTITY_PROPOSAL_TASKS } from "@/lib/research-identity";

export interface BuildIdentityTasksInput {
  researchCase?: ResearchCase | null;
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  plannedAt?: string;
}

/**
 * Deterministic identity-task graph (provider-agnostic).
 * Nine structured proposal tasks feed the deterministic ResearchDNA build;
 * each task requests strict JSON validated by normalizeIdentityProposal.
 * No provider branching, no financial computation, fail-closed blockers.
 */
export function buildIdentityResearchTasks(input: BuildIdentityTasksInput): {
  version: string;
  caseId: string | null;
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  plannedAt: string;
  tasks: ResearchTask[];
} {
  const plannedAt = input.plannedAt ?? new Date().toISOString();
  const rc = input.researchCase ?? null;
  const blockers = rc ? [...rc.dataQuality.blockers] : ["NO_RESEARCH_CASE"];
  const tasks: ResearchTask[] = IDENTITY_PROPOSAL_TASKS.map((task, position) => ({
    id: `T-identity-${task}`,
    kind: "plan",
    title: `Identity proposal: ${task}`,
    roleId: position < 5 ? "council-strategist" : "orch-red-team",
    status: blockers.length > 0 && (task === "debate-identification" || task === "materiality-reasoning") ? "blocked" : "pending",
    needsLlm: true,
    dependsOn: position === 0 ? [] : [`T-identity-${IDENTITY_PROPOSAL_TASKS[position - 1]}`],
    blockers: position === 0 ? [...blockers] : [],
    maxAttempts: WRITER_CHECKER_MAX_ATTEMPTS,
    attempt: 0,
  }));
  return {
    version: RESEARCH_ORCHESTRATION_VERSION,
    caseId: rc?.caseId ?? null,
    reportTypeId: input.reportTypeId,
    depth: input.depth,
    plannedAt,
    tasks,
  };
}
