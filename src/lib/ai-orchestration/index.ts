/**
 * APEX RESEARCH — AI Orchestration (Phase 6 entry point)
 *
 * Reusable roles, deterministic ResearchTask planner, committee gate and
 * red-team probes. Provider failover stays in ai-providers / openrouter;
 * orchestration only speaks OrchestrationTransport (adapters provided).
 */
export * from "./types";
export {
  RESEARCH_ROLES,
  listResearchRoles,
  getResearchRole,
  rolesBySource,
  isResearchRoleId,
} from "./roles";
export {
  fromTeamTransport,
  toTeamTransport,
  fromFunctionTransport,
  toFunctionTransport,
  fromAiFirstTransport,
  toAiFirstTransport,
} from "./transport";
export type { OrchestrationCall, OrchestrationTransport } from "./transport";
export { buildResearchTasks } from "./planner";
export type { BuildResearchTasksInput } from "./planner";
export { derivePlanProgressTasks } from "./live-progress";
export type {
  DerivePlanTasksInput,
  PlanPhase,
  PlanProgressTask,
  PlanTaskDisplayStatus,
} from "./live-progress";
export { runCommitteeReview } from "./committee";
export type { RunCommitteeReviewInput } from "./committee";
export { runRedTeam } from "./red-team";
export type { RunRedTeamInput } from "./red-team";
