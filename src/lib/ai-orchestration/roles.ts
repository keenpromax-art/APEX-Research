/**
 * Reusable role catalog — references existing rosters, never duplicates
 * their job text as a second source of truth for authors/checkers.
 *
 * Ids are source-prefixed so council / team / quality / writer-checker seats
 * can never collide. Quality seats are generated from QUALITY_REVIEWER_NAMES
 * (the exact list runQualityReview executes).
 */
import { AGENT_TEAM_ROSTER, type AgentFamily, type ModelTier } from "@/lib/agent-team";
import { AI_AGENT_PERSONAS } from "@/lib/openrouter";
import { QUALITY_REVIEWER_NAMES } from "@/lib/ai-first/quality-review";
import type { ResearchRole, RoleSource } from "./types";

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const COUNCIL_ROLES: ResearchRole[] = AI_AGENT_PERSONAS.map((p) => ({
  id: `council-${p.id}`,
  name: p.name,
  role: p.role,
  source: "council" as const,
  tier: "flagship" as const,
  needsLlm: true,
}));

const TEAM_ROLES: ResearchRole[] = AGENT_TEAM_ROSTER.map((r) => ({
  id: r.id,
  name: r.name,
  role: r.job,
  source: "agent-team" as const,
  tier: r.tier,
  family: r.family,
  needsLlm: r.needsLlm,
  helps: r.helps,
}));

const QUALITY_ROLES: ResearchRole[] = QUALITY_REVIEWER_NAMES.map((name) => ({
  id: `qr-${slug(name)}`,
  name,
  role: `Independent quality-review seat: ${name}.`,
  source: "quality-review" as const,
  tier: "lite" as const,
  family: "checker" as AgentFamily,
  needsLlm: false,
}));

/**
 * Writer/checker loop pairs from writer-checker-loop.ts (strategist + moat).
 * Synthesized descriptors — the deterministic gates stay in that module.
 */
const WRITER_CHECKER_ROLES: ResearchRole[] = [
  {
    id: "wc-strategist-writer",
    name: "Strategist Draft Writer",
    role: "Writes the strategist thesis/overview draft under the deterministic draft-quality audit.",
    source: "writer-checker",
    tier: "standard",
    family: "author",
    needsLlm: true,
  },
  {
    id: "wc-strategist-checker",
    name: "Strategist Draft Checker",
    role: "Checks strategist drafts against ground truth (rating, FV, upside, sector vocabulary).",
    source: "writer-checker",
    tier: "lite",
    family: "checker",
    needsLlm: true,
    helps: ["wc-strategist-writer"],
  },
  {
    id: "wc-moat-writer",
    name: "Moat Draft Writer",
    role: "Writes the moat narrative under the canonical rating ceiling.",
    source: "writer-checker",
    tier: "standard",
    family: "author",
    needsLlm: true,
  },
  {
    id: "wc-moat-checker",
    name: "Moat Draft Checker",
    role: "Checks moat drafts against canonical moat + pillar ceilings.",
    source: "writer-checker",
    tier: "lite",
    family: "checker",
    needsLlm: true,
    helps: ["wc-moat-writer"],
  },
];

const ORCHESTRATION_ROLES: ResearchRole[] = [
  {
    id: "orch-red-team",
    name: "Red Team Adversary",
    role: "Runs deterministic adversarial probes (and optional LLM adversary) over the task plan and case blockers.",
    source: "orchestration",
    tier: "flagship",
    family: "checker",
    needsLlm: false,
  },
];

/** Full catalog: council 8 + agent-team 50 + quality 9 + writer/checker 4 + red-team 1. */
export const RESEARCH_ROLES: readonly ResearchRole[] = [
  ...COUNCIL_ROLES,
  ...TEAM_ROLES,
  ...QUALITY_ROLES,
  ...WRITER_CHECKER_ROLES,
  ...ORCHESTRATION_ROLES,
] as const;

const BY_ID = new Map(RESEARCH_ROLES.map((r) => [r.id, r]));

export function listResearchRoles(): ResearchRole[] {
  return RESEARCH_ROLES.map((r) => ({ ...r, ...(r.helps ? { helps: [...r.helps] } : {}) }));
}

export function getResearchRole(id: string): ResearchRole | null {
  return BY_ID.get(id) ?? null;
}

export function rolesBySource(source: RoleSource): ResearchRole[] {
  return RESEARCH_ROLES.filter((r) => r.source === source).map((r) => ({ ...r }));
}

export function isResearchRoleId(id: string): boolean {
  return BY_ID.has(id);
}
