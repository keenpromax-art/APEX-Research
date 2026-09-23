/**
 * Red-team — deterministic structural probes over the ResearchTask plan and
 * ResearchCase, plus an optional LLM adversary via injected transport.
 *
 * Probes never recompute financials and never invent findings: when the case
 * or plan is absent the probe records an explicit blocker-shaped finding
 * (or is skipped with `probesRun` noting the gap).
 */
import type { ResearchCase } from "@/lib/research-case";
import { resolveValuationAnchors } from "@/lib/research-modules";
import { parseLlmJson } from "@/lib/ai-first/llm";
import type { OrchestrationTransport } from "./transport";
import type { RedTeamFinding, RedTeamProbeId, RedTeamResult, ResearchTaskPlan } from "./types";
import { RESEARCH_ORCHESTRATION_VERSION } from "./types";

function finding(
  probe: RedTeamProbeId,
  severity: RedTeamFinding["severity"],
  component: string,
  text: string,
  recommendation: string
): RedTeamFinding {
  return {
    id: `${probe}:${component}`,
    severity,
    component,
    finding: text,
    recommendation,
    probe,
  };
}

interface DeterministicInput {
  plan?: ResearchTaskPlan | null;
  researchCase?: ResearchCase | null;
}

function probeBlockersPropagate(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("blockers-propagate");
  const rc = input.researchCase;
  const plan = input.plan;
  if (!rc || !plan) {
    out.push(
      finding(
        "blockers-propagate",
        "major",
        "plan",
        "Cannot verify data-quality blockers propagate without both ResearchCase and task plan.",
        "Supply researchCase and plan before the red-team gate."
      )
    );
    return;
  }
  const caseBlockers = rc.dataQuality.blockers;
  for (const b of caseBlockers) {
    if (!plan.blockers.includes(b)) {
      out.push(
        finding(
          "blockers-propagate",
          "blocker",
          "plan",
          `Case blocker ${b} missing from task-plan blockers.`,
          `Copy ${b} into plan.blockers (fail-closed; never drop case blockers).`
        )
      );
    }
  }
}

function probePeersSuppressed(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("peers-suppressed");
  const rc = input.researchCase;
  const plan = input.plan;
  if (!rc || !plan) return;
  if (!rc.peers.gate.suppress && rc.peers.available) return;
  const peerTasks = plan.tasks.filter((t) => t.moduleId === "peers" && t.kind === "author");
  for (const t of peerTasks) {
    if (t.status !== "blocked" || !t.blockers.includes("PEERS_SUPPRESSED")) {
      out.push(
        finding(
          "peers-suppressed",
          "blocker",
          t.id,
          `Peer author task not blocked despite suppressed/unavailable peers (status=${t.status}).`,
          "Mark PEERS_SUPPRESSED and status=blocked; never author peer numbers without a gate-passed set."
        )
      );
    }
  }
}

function probeMissingValuation(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("missing-valuation");
  const rc = input.researchCase;
  const plan = input.plan;
  if (!rc || !plan) return;
  if (rc.dataQuality.availability.valuation) return;
  const anchors = resolveValuationAnchors(rc);
  if (anchors.fairValue != null || anchors.rating != null) {
    out.push(
      finding(
        "missing-valuation",
        "blocker",
        "valuation",
        "Case reports valuation unavailable but anchors resolved non-null — inconsistent single-source state.",
        "Fix availability flags or clear the anchor sources; do not dual-source fair value."
      )
    );
  }
  const valuationAuthors = plan.tasks.filter(
    (t) => t.kind === "author" && t.moduleId === "valuation"
  );
  for (const t of valuationAuthors) {
    if (t.status !== "blocked" || !t.blockers.includes("NO_VALUATION")) {
      out.push(
        finding(
          "missing-valuation",
          "blocker",
          t.id,
          "Valuation author not blocked despite NO_VALUATION case availability.",
          "Block the task and mark the section unavailable — never invent a fair value."
        )
      );
    }
  }
}

function probeTaskGraphClosure(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("task-graph-closure");
  const plan = input.plan;
  if (!plan) {
    out.push(
      finding(
        "task-graph-closure",
        "major",
        "plan",
        "No task plan supplied for closure check.",
        "Run buildResearchTasks before red-team."
      )
    );
    return;
  }
  const ids = new Set(plan.tasks.map((t) => t.id));
  for (const t of plan.tasks) {
    for (const dep of t.dependsOn) {
      if (!ids.has(dep)) {
        out.push(
          finding(
            "task-graph-closure",
            "blocker",
            t.id,
            `Task depends on missing id ${dep}.`,
            "Repair dependsOn edges; graph must be closed and acyclic."
          )
        );
      }
    }
  }
  const kinds = new Set(plan.tasks.map((t) => t.kind));
  for (const required of ["plan", "red-team", "committee"] as const) {
    if (!kinds.has(required)) {
      out.push(
        finding(
          "task-graph-closure",
          "blocker",
          "plan",
          `Task graph missing required ${required} node.`,
          "Every plan includes plan → work → red-team → committee."
        )
      );
    }
  }
}

function probeAuthorNeedsChecker(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("author-needs-checker");
  const plan = input.plan;
  if (!plan) return;
  const authors = plan.tasks.filter((t) => t.kind === "author");
  for (const a of authors) {
    const checked = plan.tasks.some(
      (t) => t.kind === "checker" && t.dependsOn.includes(a.id)
    );
    if (!checked) {
      out.push(
        finding(
          "author-needs-checker",
          "blocker",
          a.id,
          `Author task ${a.id} has no downstream checker.`,
          "Pair every LLM author with a deterministic checker seat."
        )
      );
    }
  }
}

function probeDebatesGate(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("debates-gate");
  const plan = input.plan;
  const rc = input.researchCase;
  if (!plan || !rc) return;
  const debatesTask = plan.tasks.find((t) => t.sectionId === "research-debates");
  if (!debatesTask) return;
  const hasResearch = rc.confidence != null || rc.researchQuestions.length > 0;
  // Outline already gated inclusion; if the section is present the gate passed.
  // Flag only the impossible state: section planned while case shows no research
  // AND the plan claims case-linked research domains — keep conservative:
  if (!hasResearch && debatesTask.status === "done") {
    out.push(
      finding(
        "debates-gate",
        "major",
        debatesTask.id,
        "Research-debates section marked done while case has no research report signals.",
        "Leave pending/blocked until debates or a research report exist."
      )
    );
  }
}

function probeUnknownsNotInvented(input: DeterministicInput, out: RedTeamFinding[], run: string[]): void {
  run.push("unknowns-not-invented");
  const rc = input.researchCase;
  if (!rc) return;
  // Unknowns must remain recorded — the red-team does not clear them.
  // Structural check: data-gap unknowns present when canonical facts missing.
  const missingFacts = rc.dataQuality.missingCanonicalFields.length > 0;
  const hasDataGap = rc.unknowns.some((u) => u.source === "data-gap");
  if (missingFacts && !hasDataGap && rc.unknowns.length === 0) {
    out.push(
      finding(
        "unknowns-not-invented",
        "major",
        "unknowns",
        "Canonical fields missing but no unknowns recorded — gaps may have been invented away.",
        "Record data-gap unknowns for every missing canonical field."
      )
    );
  }
}

const DETERMINISTIC_PROBES: Array<{
  id: RedTeamProbeId;
  fn: (input: DeterministicInput, out: RedTeamFinding[], run: string[]) => void;
}> = [
  { id: "blockers-propagate", fn: probeBlockersPropagate },
  { id: "peers-suppressed", fn: probePeersSuppressed },
  { id: "missing-valuation", fn: probeMissingValuation },
  { id: "task-graph-closure", fn: probeTaskGraphClosure },
  { id: "author-needs-checker", fn: probeAuthorNeedsChecker },
  { id: "debates-gate", fn: probeDebatesGate },
  { id: "unknowns-not-invented", fn: probeUnknownsNotInvented },
];

export interface RunRedTeamInput extends DeterministicInput {
  /** Optional LLM adversary — provider-agnostic injected transport. */
  transport?: OrchestrationTransport | null;
  /** Short prose excerpt for the LLM adversary (never financial truth source). */
  thesisExcerpt?: string | null;
  companyName?: string | null;
}

const LLM_SYSTEM = `You are the red team on an institutional research desk.
Challenge ONLY structural/process risks: missing evidence, uncited claims, gate bypasses, inconsistent blockers.
You never invent financial numbers. Reply with ONLY JSON:
{"findings":[{"severity":"blocker"|"major"|"minor","component":"...","finding":"...","recommendation":"..."}]}
If nothing material, return {"findings":[]}.`;

export async function runRedTeam(input: RunRedTeamInput): Promise<RedTeamResult> {
  const findings: RedTeamFinding[] = [];
  const probesRun: string[] = [];

  for (const probe of DETERMINISTIC_PROBES) {
    probe.fn(input, findings, probesRun);
  }

  let llmUsed = false;
  if (input.transport) {
    probesRun.push("llm-adversary");
    try {
      const user = [
        `Company: ${input.companyName ?? "unknown"}`,
        `Task plan: ${input.plan ? `${input.plan.tasks.length} tasks, blockers=${input.plan.blockers.join(",") || "none"}` : "absent"}`,
        `Case blockers: ${input.researchCase?.dataQuality.blockers.join(",") || "none"}`,
        input.thesisExcerpt ? `Thesis excerpt (untrusted prose):\n${input.thesisExcerpt.slice(0, 1200)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const resp = await input.transport.complete({
        system: LLM_SYSTEM,
        user,
        temperature: 0.2,
        maxTokens: 1200,
        jsonMode: true,
        roleId: "orch-red-team",
        tier: "flagship",
      });
      const parsed = parseLlmJson<{ findings?: Array<Partial<RedTeamFinding>> }>(resp);
      if (parsed && Array.isArray(parsed.findings)) {
        llmUsed = true;
        for (const f of parsed.findings) {
          const sev = f.severity === "blocker" || f.severity === "major" ? f.severity : "minor";
          findings.push({
            id: `llm-adversary:${findings.length + 1}`,
            severity: sev,
            component: String(f.component || "report"),
            finding: String(f.finding || "").slice(0, 500),
            recommendation: String(f.recommendation || "").slice(0, 500),
            probe: "llm-adversary",
          });
        }
      }
    } catch {
      // Transport failure: deterministic probes still stand; no invented findings.
    }
  }

  return {
    version: RESEARCH_ORCHESTRATION_VERSION,
    findings,
    probesRun,
    passed: findings.every((f) => f.severity !== "blocker"),
    llmUsed,
  };
}
