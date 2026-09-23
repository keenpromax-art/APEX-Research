/**
 * Deterministic ResearchTask planner — pure function of ResearchCase +
 * resolved blueprint outline. No LLM, no page caps, no company-specific
 * conclusions: section titles and module sets come from the Phase 4 outline.
 *
 * Graph shape (acyclic):
 *   plan → author(section)* → checker(section)* → red-team → committee
 */
import { WRITER_CHECKER_MAX_ATTEMPTS } from "@/lib/writer-checker-loop";
import type { ResearchCase } from "@/lib/research-case";
import type { ResearchModuleId } from "@/lib/research-modules";
import type { ReportTypeId, ResearchDepth, ResolvedSection } from "@/lib/report-types";
import type { ResearchTask, ResearchTaskPlan } from "./types";
import { RESEARCH_ORCHESTRATION_VERSION } from "./types";

/** Council persona id (without `council-` prefix) by module priority. */
const MODULE_PRIMARY_ROLE: Array<{ module: ResearchModuleId; councilId: string }> = [
  { module: "valuation", councilId: "strategist" },
  { module: "moat", councilId: "moat" },
  { module: "management", councilId: "governance" },
  { module: "risk-catalyst", councilId: "news" },
  { module: "peers", councilId: "moat" },
  { module: "quality", councilId: "forensic" },
  { module: "statements", councilId: "forensic" },
  { module: "thesis", councilId: "strategist" },
  { module: "business", councilId: "strategist" },
];

const CREDIT_TITLE = /credit|solvency|capital structure|rating framework|solvency scorecard/i;

function primaryRoleForSection(section: ResolvedSection): string {
  if (CREDIT_TITLE.test(section.title)) return "council-credit";
  // Prefer the section's declared first module (blueprint ownership order),
  // then fall back to priority so moat-price-fair-value (modules: moat, valuation)
  // routes to moat, while fundamental-analysis (valuation first) routes to strategist.
  for (const mod of section.modules) {
    const hit = MODULE_PRIMARY_ROLE.find((e) => e.module === mod);
    if (hit) return `council-${hit.councilId}`;
  }
  return "council-strategist";
}

function checkerRoleForSection(section: ResolvedSection, authorRoleId: string): string {
  if (CREDIT_TITLE.test(section.title)) return "qr-fact-checker";
  if (authorRoleId === "council-moat") return "qr-industry-analyst";
  if (authorRoleId === "council-strategist" || section.modules.includes("thesis")) {
    return "qr-fact-checker";
  }
  if (section.modules.includes("statements") || section.modules.includes("quality")) {
    return "qr-accounting-analyst";
  }
  return "qr-fact-checker";
}

function pushBlocker(task: ResearchTask, code: string): void {
  if (!task.blockers.includes(code)) task.blockers.push(code);
}

export interface BuildResearchTasksInput {
  /** Optional case — when absent the plan still builds with a case blocker. */
  researchCase?: ResearchCase | null;
  /** Resolved Phase 4 outline (sections in render order). */
  sections: ResolvedSection[];
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  /** Deterministic stamp for tests; defaults to wall-clock. */
  plannedAt?: string;
}

export function buildResearchTasks(input: BuildResearchTasksInput): ResearchTaskPlan {
  const rc = input.researchCase ?? null;
  const plannedAt = input.plannedAt ?? new Date().toISOString();
  const planBlockers: string[] = [];
  if (!rc) planBlockers.push("NO_RESEARCH_CASE");
  if (rc) planBlockers.push(...rc.dataQuality.blockers);

  const valuationMissing = rc ? !rc.dataQuality.availability.valuation : true;
  const peersSuppressed = rc ? rc.peers.gate.suppress || !rc.peers.available : false;

  const planTask: ResearchTask = {
    id: "T-plan",
    kind: "plan",
    title: "Research task plan",
    roleId: "orch-red-team",
    status: "pending",
    needsLlm: false,
    dependsOn: [],
    blockers: [...planBlockers],
    maxAttempts: 1,
    attempt: 0,
  };

  const tasks: ResearchTask[] = [planTask];
  const roleIds: string[] = [planTask.roleId];
  const pushRole = (id: string) => {
    if (!roleIds.includes(id)) roleIds.push(id);
  };
  pushRole(planTask.roleId);

  for (const section of input.sections) {
    const authorRoleId = primaryRoleForSection(section);
    const checkerRoleId = checkerRoleForSection(section, authorRoleId);
    const primaryModule = section.modules[0];
    const authorId = `T-author-${section.id}`;
    const checkerId = `T-check-${section.id}`;

    const author: ResearchTask = {
      id: authorId,
      kind: "author",
      title: `Author: ${section.title}`,
      roleId: authorRoleId,
      status: "pending",
      needsLlm: true,
      dependsOn: [planTask.id],
      sectionId: section.id,
      moduleId: primaryModule,
      blockers: [],
      maxAttempts: WRITER_CHECKER_MAX_ATTEMPTS,
      attempt: 0,
    };

    if (valuationMissing && section.modules.includes("valuation")) {
      pushBlocker(author, "NO_VALUATION");
    }
    if (peersSuppressed && section.modules.includes("peers")) {
      pushBlocker(author, "PEERS_SUPPRESSED");
    }
    if (author.blockers.length > 0) author.status = "blocked";

    const checker: ResearchTask = {
      id: checkerId,
      kind: "checker",
      title: `Check: ${section.title}`,
      roleId: checkerRoleId,
      status: "pending",
      needsLlm: false,
      dependsOn: [authorId],
      sectionId: section.id,
      moduleId: primaryModule,
      blockers: author.blockers.length > 0 ? [...author.blockers] : [],
      maxAttempts: 1,
      attempt: 0,
    };
    if (checker.blockers.length > 0) checker.status = "blocked";

    tasks.push(author, checker);
    pushRole(authorRoleId);
    pushRole(checkerRoleId);
  }

  const leafIds = tasks
    .filter((t) => t.kind === "checker" || t.kind === "author")
    .map((t) => t.id);

  const redTeam: ResearchTask = {
    id: "T-red-team",
    kind: "red-team",
    title: "Red-team adversarial review",
    roleId: "orch-red-team",
    status: "pending",
    needsLlm: false,
    dependsOn: leafIds.length > 0 ? leafIds : [planTask.id],
    blockers: [],
    maxAttempts: 1,
    attempt: 0,
  };
  tasks.push(redTeam);
  pushRole(redTeam.roleId);

  const committee: ResearchTask = {
    id: "T-committee",
    kind: "committee",
    title: "Committee gate",
    roleId: "qr-final-institutional-research-reviewer",
    status: "pending",
    needsLlm: false,
    dependsOn: [redTeam.id],
    blockers: [],
    maxAttempts: 1,
    attempt: 0,
  };
  tasks.push(committee);
  pushRole(committee.roleId);

  return {
    version: RESEARCH_ORCHESTRATION_VERSION,
    caseId: rc?.caseId ?? null,
    reportTypeId: input.reportTypeId,
    depth: input.depth,
    plannedAt,
    tasks,
    roleIds,
    blockers: planBlockers,
  };
}
