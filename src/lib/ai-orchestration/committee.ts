/**
 * Committee gate — folds existing quality-review scoring, optional council
 * audit, and red-team findings into one decision. Does NOT reimplement
 * scoring: `runQualityReview` / `adjudicateRegeneration` stay authoritative.
 */
import {
  runQualityReview,
  adjudicateRegeneration,
  QUALITY_REVIEWER_NAMES,
} from "@/lib/ai-first/quality-review";
import type { CouncilVerificationAudit } from "@/types/report";
import type { FactPack, ResearchReport } from "@/lib/ai-first/types";
import type { RedTeamFinding } from "./types";
import type { CommitteeDecision, CommitteeSeat, QualityReviewOutcome } from "./types";
import { COUNCIL_PASS_THRESHOLD, RESEARCH_ORCHESTRATION_VERSION } from "./types";
import { getResearchRole } from "./roles";

const SEAT_FOCUS: Record<string, string> = {
  "Financial Analyst": "Statement integrity, margins, cash-flow quality",
  "Accounting Analyst": "Accounting identities and disclosure consistency",
  "Valuation Analyst": "DCF / scenario / upside arithmetic",
  "Industry Analyst": "Sector fit and peer-set relevance",
  "Skeptical Analyst": "Adversarial challenge of the weakest assumptions",
  "Fact Checker": "Evidence grounding for material claims",
  "Report Editor": "Structure, completeness, editorial coherence",
  "Research Judge": "Sentence-level evidence audit",
  "Final Institutional Research Reviewer": "Publication readiness and principle compliance",
};

function defaultSeats(): CommitteeSeat[] {
  return QUALITY_REVIEWER_NAMES.map((name) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const roleId = `qr-${slug}`;
    // Prefer catalog lookup so name/focus stay single-sourced when present.
    const role = getResearchRole(roleId);
    return {
      roleId,
      name: role?.name ?? name,
      focus: SEAT_FOCUS[name] ?? role?.role ?? name,
    };
  });
}

function councilBlockers(audit: CouncilVerificationAudit | null): string[] {
  if (!audit) return [];
  const out: string[] = [];
  const flags = audit.checks.filter((c) => c.status === "FLAG");
  if (audit.status === "FLAGGED") out.push(`COUNCIL_STATUS_FLAGGED: ${audit.summary}`);
  if (audit.integrityScore < COUNCIL_PASS_THRESHOLD) {
    out.push(
      `COUNCIL_SCORE_BELOW_THRESHOLD: ${audit.integrityScore} < ${COUNCIL_PASS_THRESHOLD}`
    );
  }
  if (flags.length > 0) {
    out.push(`COUNCIL_CHECKS_FLAGGED: ${flags.map((f) => f.name).join(", ")}`);
  }
  return out;
}

export interface RunCommitteeReviewInput {
  /** Precomputed quality review (tests / pipeline already ran it). */
  qualityReview?: QualityReviewOutcome | null;
  /** When qualityReview is absent and both are set, the committee runs QA itself. */
  report?: ResearchReport | null;
  pack?: FactPack | null;
  councilAudit?: CouncilVerificationAudit | null;
  /** Red-team findings (by reference); blockers fold into the gate. */
  redTeamFindings?: RedTeamFinding[] | null;
  seats?: CommitteeSeat[] | null;
  decidedAt?: string;
}

export function runCommitteeReview(input: RunCommitteeReviewInput): CommitteeDecision {
  const seats = input.seats && input.seats.length > 0 ? input.seats : defaultSeats();
  const redTeamFindings = input.redTeamFindings ?? [];

  let qualityReview: QualityReviewOutcome | null = input.qualityReview ?? null;
  if (!qualityReview && input.report && input.pack) {
    qualityReview = runQualityReview(input.report, input.pack);
  }

  let adjudication: CommitteeDecision["adjudication"] = null;
  if (qualityReview && input.report) {
    adjudication = adjudicateRegeneration(
      qualityReview.regenerationCandidates,
      qualityReview.perReviewer,
      input.report
    );
  }

  const blockers: string[] = [];
  if (qualityReview) {
    for (const f of qualityReview.allFindings) {
      if (f.severity === "blocker") {
        blockers.push(`QA_BLOCKER: ${f.component}: ${f.finding}`);
      }
    }
    if (!qualityReview.passed && blockers.length === 0) {
      blockers.push(`QA_NOT_PASSED: score ${qualityReview.overallScore}`);
    }
  }

  for (const f of redTeamFindings) {
    if (f.severity === "blocker") {
      blockers.push(`RED_TEAM_BLOCKER: ${f.component}: ${f.finding}`);
    }
  }

  blockers.push(...councilBlockers(input.councilAudit ?? null));

  return {
    version: RESEARCH_ORCHESTRATION_VERSION,
    seats,
    qualityReview,
    adjudication,
    councilAudit: input.councilAudit ?? null,
    redTeamFindings,
    passed: blockers.length === 0,
    blockers,
    regenerate: adjudication?.regenerate ?? [],
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  };
}
