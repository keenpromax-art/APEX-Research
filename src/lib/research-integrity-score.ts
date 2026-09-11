/**
 * APEX RESEARCH — ResearchIntegrityScore (TRACK 2)
 * -------------------------------------------------
 * Deterministic, pure score over canonical-severity findings:
 *
 *   score = 100 − 25×blocker − 10×material − 5×warn   (floored at 0)
 *
 * Grades: A ≥90, B ≥75, C ≥60, D ≥40, else F.
 * passesGate ⇔ zero blockers. Material/warn findings never block but always
 * cost score and surface as gate warnings with remediation.
 */
import type { ResearchSeverity } from "./severity";
import { qaStatusToSeverity } from "./severity";

export interface IntegrityBreakdown {
  blockers: number;
  materials: number;
  warns: number;
  infos: number;
}

export interface ResearchIntegrityScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  passesGate: boolean;
  breakdown: IntegrityBreakdown;
  summary: string;
}

export const INTEGRITY_WEIGHTS = { blocker: 25, material: 10, warn: 5, info: 0 } as const;

export function scoreFromBreakdown(b: IntegrityBreakdown): ResearchIntegrityScore {
  const score = Math.max(
    0,
    100 - b.blockers * INTEGRITY_WEIGHTS.blocker - b.materials * INTEGRITY_WEIGHTS.material - b.warns * INTEGRITY_WEIGHTS.warn
  );
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const passesGate = b.blockers === 0;
  const summary =
    b.blockers > 0
      ? `${b.blockers} blocker(s) — publication prohibited until fixed (score ${score}).`
      : b.materials > 0 || b.warns > 0
        ? `${b.materials} material / ${b.warns} warn — publishable with disclosed qualifications (score ${score}).`
        : `Clean — no material findings (score ${score}).`;
  return { score, grade, passesGate, breakdown: { ...b }, summary };
}

export function scoreFromSeverities(severities: ResearchSeverity[]): ResearchIntegrityScore {
  const b: IntegrityBreakdown = { blockers: 0, materials: 0, warns: 0, infos: 0 };
  for (const s of severities) {
    if (s === "blocker") b.blockers++;
    else if (s === "material") b.materials++;
    else if (s === "warn") b.warns++;
    else b.infos++;
  }
  return scoreFromBreakdown(b);
}

/** QA-check convenience: FAIL→blocker, WARN→warn, PASS→info. */
export function scoreFromQAChecks(checks: Array<{ status: "PASS" | "WARN" | "FAIL" }>): ResearchIntegrityScore {
  return scoreFromSeverities(checks.map((c) => qaStatusToSeverity(c.status)));
}
