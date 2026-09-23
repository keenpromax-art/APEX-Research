/**
 * Live plan display — derives per-report ResearchTask progress rows from the
 * deterministic Phase 6 task graph + real pipeline events. Pure: no clocks,
 * no LLM, no side effects (testable without React or CSS).
 *
 * Honest mapping (live pipeline → plan tasks):
 *  - plan            → done once the ResearchCase + outline are ready
 *  - author(section) → follows the assigned council persona agent
 *                      (`council-<id>` → agent `<id>` checkpoint status);
 *                      blocked tasks stay blocked regardless of agents
 *  - checker(section)→ follows the council verifier (checking seat for all)
 *  - red-team        → complete when the deterministic runRedTeam result exists
 *  - committee       → complete when runCommitteeReview folded the council
 *                      audit + red-team findings (note carries PASSED/flags)
 */
import type { AgentCheckpoint } from "@/types/report";
import { getResearchRole } from "./roles";
import type { CommitteeDecision, RedTeamResult, ResearchTask, ResearchTaskPlan } from "./types";

export type PlanTaskDisplayStatus =
  | AgentCheckpoint["status"]
  | "blocked";

export interface PlanProgressTask {
  id: string;
  kind: ResearchTask["kind"];
  name: string;
  role: string;
  status: PlanTaskDisplayStatus;
  note?: string;
}

export type PlanPhase = "planning" | "generating" | "assembling" | "done";

export interface DerivePlanTasksInput {
  phase: PlanPhase;
  /** Live council agent checkpoints (7-agent roster) at derivation time. */
  agentCheckpoints?: AgentCheckpoint[] | null;
  /** Deterministic red-team result (null until runRedTeam resolved). */
  redTeam?: RedTeamResult | null;
  /** Committee fold of council audit + red-team findings (null until run). */
  committee?: CommitteeDecision | null;
}

function agentStatus(
  checkpoints: AgentCheckpoint[] | null | undefined,
  id: string
): AgentCheckpoint["status"] {
  return checkpoints?.find((c) => c.id === id)?.status ?? "pending";
}

/** `council-<persona>` → live agent checkpoint id (`<persona>`). */
function personaAgentId(roleId: string): string | null {
  if (!roleId.startsWith("council-")) return null;
  const persona = roleId.slice("council-".length);
  return persona === "verifier" ? "verifier" : persona;
}

function roleLabel(roleId: string): string {
  return getResearchRole(roleId)?.name ?? roleId;
}

function authorStatus(
  task: ResearchTask,
  input: DerivePlanTasksInput
): PlanTaskDisplayStatus {
  if (task.blockers.length > 0) return "blocked";
  if (input.phase === "planning") return "pending";
  const agentId = personaAgentId(task.roleId);
  if (!agentId) return "pending";
  return agentStatus(input.agentCheckpoints, agentId);
}

function checkerStatus(
  task: ResearchTask,
  input: DerivePlanTasksInput
): PlanTaskDisplayStatus {
  if (task.blockers.length > 0) return "blocked";
  if (input.phase === "planning") return "pending";
  // One council verifier audits every section checker seat.
  return agentStatus(input.agentCheckpoints, "verifier");
}

function planStatus(task: ResearchTask, input: DerivePlanTasksInput): PlanTaskDisplayStatus {
  if (input.phase === "planning") return "pending";
  void task;
  return "complete";
}

function redTeamStatus(input: DerivePlanTasksInput): { status: PlanTaskDisplayStatus; note?: string } {
  const rt = input.redTeam;
  if (!rt) {
    return { status: input.phase === "planning" ? "pending" : "running" };
  }
  const blockers = rt.findings.filter((f) => f.severity === "blocker").length;
  return {
    status: "complete",
    note: `${rt.probesRun.length} probes · ${blockers > 0 ? `${blockers} blocker finding${blockers === 1 ? "" : "s"}` : "no blockers"}`,
  };
}

function committeeStatus(input: DerivePlanTasksInput): { status: PlanTaskDisplayStatus; note?: string } {
  const dec = input.committee;
  if (!dec) {
    // Fold runs after the council audit resolves — visibly checking while the
    // verifier works, then pending before generation starts.
    const verifier = agentStatus(input.agentCheckpoints, "verifier");
    if (input.phase === "planning") return { status: "pending" };
    if (verifier === "running" || verifier === "verifying" || verifier === "retrying") {
      return { status: "verifying" };
    }
    if (verifier === "complete") return { status: "running" };
    return { status: "pending" };
  }
  return {
    status: "complete",
    note: dec.passed
      ? "Committee PASSED"
      : `Committee: ${dec.blockers.length} flag${dec.blockers.length === 1 ? "" : "s"}`,
  };
}

export function derivePlanProgressTasks(
  plan: ResearchTaskPlan,
  input: DerivePlanTasksInput
): PlanProgressTask[] {
  const out: PlanProgressTask[] = [];

  for (const task of plan.tasks) {
    const roleName = roleLabel(task.roleId);
    if (task.kind === "plan") {
      const status = planStatus(task, input);
      out.push({
        id: task.id,
        kind: task.kind,
        name: task.title,
        role: `${roleName} · plan`,
        status,
        note: status === "complete"
          ? `${plan.reportTypeId} · ${plan.depth} · blockers: ${plan.blockers.length > 0 ? plan.blockers.join(", ") : "none"}`
          : undefined,
      });
      continue;
    }
    if (task.kind === "author") {
      const status = authorStatus(task, input);
      out.push({
        id: task.id,
        kind: task.kind,
        name: task.title,
        role: `${roleName} · author`,
        status,
        note: status === "blocked" ? `BLOCKED: ${task.blockers.join(", ")}` : undefined,
      });
      continue;
    }
    if (task.kind === "checker") {
      const status = checkerStatus(task, input);
      out.push({
        id: task.id,
        kind: task.kind,
        name: task.title,
        role: `${roleName} · checker`,
        status,
        note: status === "blocked" ? `BLOCKED: ${task.blockers.join(", ")}` : undefined,
      });
      continue;
    }
    if (task.kind === "red-team") {
      const { status, note } = redTeamStatus(input);
      out.push({ id: task.id, kind: task.kind, name: task.title, role: `${roleName} · review`, status, note });
      continue;
    }
    if (task.kind === "committee") {
      const { status, note } = committeeStatus(input);
      out.push({ id: task.id, kind: task.kind, name: task.title, role: `${roleName} · gate`, status, note });
    }
  }

  return out;
}
