/**
 * APEX RESEARCH — Canonical Severity Taxonomy (TRACK 2)
 * ------------------------------------------------------
 * ONE ordering for every finding in the pipeline:
 *
 *   info < warn < material < blocker
 *
 * - info:     diagnostic, no action (provenance, passing checks).
 * - warn:     thin evidence / loose tolerance — costs score, never blocks.
 * - material: disclosure-grade break (12pp margin gap, funding shortfall,
 *             accrual anomaly) — warns at the gate, blocks only when hidden.
 * - blocker:  machine-verifiable falsehood, hidden shortfall, parallel model,
 *             or contamination — publication is prohibited until fixed.
 *
 * Legacy severities convert LOSSLESSLY here (BLOCKER conversions):
 *   QA check      FAIL → blocker, WARN → warn, PASS → info
 *   Validator     CRITICAL_BLOCK → blocker, WARNING → warn, INFO → info
 *   Identities    FATAL → blocker, FLAG → warn, INFO → info
 *   Independent   FAIL → blocker, WARN → warn, PASS → info
 *   Forecast      info/warn/material/blocker → itself (native taxonomy)
 *
 * Gate mapping: any blocker → BLOCKED; else any material/warn →
 * READY_WITH_WARNINGS; else READY. Material never silently passes — it
 * always surfaces as at least a warning with remediation.
 */

export type ResearchSeverity = "info" | "warn" | "material" | "blocker";

export const SEVERITY_RANK: Record<ResearchSeverity, number> = {
  info: 0,
  warn: 1,
  material: 2,
  blocker: 3,
};

export function compareSeverity(a: ResearchSeverity, b: ResearchSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function maxSeverity(severities: ResearchSeverity[]): ResearchSeverity {
  let top: ResearchSeverity = "info";
  for (const s of severities) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[top]) top = s;
  }
  return top;
}

/** QA check status → canonical severity (BLOCKER conversion). */
export function qaStatusToSeverity(status: "PASS" | "WARN" | "FAIL"): ResearchSeverity {
  if (status === "FAIL") return "blocker";
  if (status === "WARN") return "warn";
  return "info";
}

/** report-validator QASeverity → canonical severity. */
export function validatorSeverityToResearch(s: "CRITICAL_BLOCK" | "WARNING" | "INFO"): ResearchSeverity {
  if (s === "CRITICAL_BLOCK") return "blocker";
  if (s === "WARNING") return "warn";
  return "info";
}

/** financial-validation IssueSeverity → canonical severity. */
export function identitySeverityToResearch(s: "FATAL" | "FLAG" | "INFO"): ResearchSeverity {
  if (s === "FATAL") return "blocker";
  if (s === "FLAG") return "warn";
  return "info";
}

/** independent-validator severity → canonical severity. */
export function independentSeverityToResearch(s: "FAIL" | "WARN" | "PASS"): ResearchSeverity {
  if (s === "FAIL") return "blocker";
  if (s === "WARN") return "warn";
  return "info";
}

/** Canonical severity → QA check status (for QA surfaces). */
export function researchToQACheckStatus(s: ResearchSeverity): "PASS" | "WARN" | "FAIL" {
  if (s === "blocker") return "FAIL";
  if (s === "material" || s === "warn") return "WARN";
  return "PASS";
}

/** Canonical severity → publication-gate contribution. */
export function researchToGate(s: ResearchSeverity): "BLOCKED" | "WARNING" | "READY" {
  if (s === "blocker") return "BLOCKED";
  if (s === "material" || s === "warn") return "WARNING";
  return "READY";
}

/** Labeling invariant: every severity must be one of the four canonical values. */
export function assertCanonicalSeverity(s: string): asserts s is ResearchSeverity {
  if (s !== "info" && s !== "warn" && s !== "material" && s !== "blocker") {
    throw new Error(`Severity taxonomy violation: "${s}" is not info|warn|material|blocker.`);
  }
}
