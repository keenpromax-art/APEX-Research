/**
 * APEX RESEARCH — PublicationGate (TRACK 2)
 * -------------------------------------------
 * Single decision point for publishability. Consumes canonical-severity
 * findings from every layer (QA checks, forecast reconciliation, labeling
 * invariants, historical discontinuities, validator issues) and returns ONE
 * verdict:
 *
 *   BLOCKED             — ≥1 blocker: export prohibited until fixed.
 *   READY_WITH_WARNINGS — 0 blockers, ≥1 material/warn: publishable with
 *                         disclosed qualifications.
 *   READY               — clean.
 *
 * Discontinuity rules (history → model guard):
 *   DISC-01  Revenue discontinuity: YoY < −80% or > +500% → BLOCKER.
 *            Verify corporate action, restatement, or unit error before
 *            modeling (a quarterly spike must never rebase the trajectory).
 *   DISC-02  Gross-margin cliff: >15pp YoY collapse → MATERIAL.
 *            Requires mix-shift/cost-shock disclosure.
 *   DISC-03  Receivables surge (>70% with >50pp lead over revenue) →
 *            MATERIAL (channel-stuffing/collection review).
 *   DISC-04  Revenue/cash divergence (revenue +25% while OCF −25%) →
 *            MATERIAL (accrual-quality review).
 * DISC-02..04 reuse the kernel anomaly detector's economics; DISC-01 is an
 * independent hard bound so a unit error can never price.
 */
import { detectAccountingAnomalies } from "./financial-kernel";
import type { ResearchSeverity } from "./severity";
import { maxSeverity, researchToGate } from "./severity";
import { scoreFromSeverities, type ResearchIntegrityScore } from "./research-integrity-score";

export type GateDecision = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

export interface GateFinding {
  source: "QA" | "RECON" | "LABEL" | "DISC" | "VALIDATOR" | "INDEPENDENT";
  code: string;
  severity: ResearchSeverity;
  detail: string;
}

export interface DiscontinuityFinding {
  code: "DISC-01" | "DISC-02" | "DISC-03" | "DISC-04";
  pass: boolean;
  severity: ResearchSeverity;
  year: string;
  detail: string;
}

export interface PublicationGateResult {
  decision: GateDecision;
  score: ResearchIntegrityScore;
  blockers: GateFinding[];
  warnings: GateFinding[];
  summary: string;
}

/** Run DISC-01..04 over reported history (pure + deterministic). */
export function checkHistoricalDiscontinuities(
  history: Array<{
    year: string; revenue: number; netIncome: number; operatingCashFlow: number;
    netReceivables: number; totalAssets: number; grossMargin: number;
  }>
): DiscontinuityFinding[] {
  const out: DiscontinuityFinding[] = [];
  // DISC-01: independent hard revenue bound (unit-error tripwire).
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (!(prev.revenue > 0) || !(cur.revenue > 0)) continue;
    const g = cur.revenue / prev.revenue - 1;
    if (g < -0.8 || g > 5) {
      out.push({
        code: "DISC-01", pass: false, severity: "blocker", year: cur.year,
        detail: `${cur.year}: revenue discontinuity (${(g * 100).toFixed(0)}% YoY) — verify corporate action, restatement, or unit error before modeling.`,
      });
    }
  }
  // DISC-02..04: kernel anomaly economics mapped to canonical severity.
  // ANOM-PERIOD-JUMP is already covered by DISC-01 above (dedupe it here).
  for (const a of detectAccountingAnomalies(history)) {
    if (a.code === "ANOM-PERIOD-JUMP") continue;
    if (a.code === "ANOM-MARGIN-CLIFF") {
      const m = /(\d{4})/.exec(a.message);
      out.push({ code: "DISC-02", pass: false, severity: "material", year: m?.[1] ?? "n/a", detail: a.message });
    } else if (a.code === "ANOM-RECEIVABLES") {
      const m = /(\d{4})/.exec(a.message);
      out.push({ code: "DISC-03", pass: false, severity: "material", year: m?.[1] ?? "n/a", detail: a.message });
    } else if (a.code === "ANOM-REV-CASH") {
      const m = /(\d{4})/.exec(a.message);
      out.push({ code: "DISC-04", pass: false, severity: "material", year: m?.[1] ?? "n/a", detail: a.message });
    }
  }
  return out;
}

/** Evaluate ONE gate decision from canonical-severity findings. */
export function evaluatePublicationGate(findings: GateFinding[]): PublicationGateResult {
  const severities = findings.map((f) => f.severity);
  const top = findings.length === 0 ? ("info" as ResearchSeverity) : maxSeverity(severities);
  const gateLevel = researchToGate(top);
  const decision: GateDecision =
    gateLevel === "BLOCKED" ? "BLOCKED" : gateLevel === "WARNING" ? "READY_WITH_WARNINGS" : "READY";
  const score = scoreFromSeverities(severities);
  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "material" || f.severity === "warn");
  const summary =
    decision === "BLOCKED"
      ? `BLOCKED — ${blockers.length} blocker(s): ${blockers.slice(0, 2).map((b) => `${b.code}: ${b.detail.slice(0, 90)}`).join(" | ")}${blockers.length > 2 ? ` (+${blockers.length - 2} more)` : ""}`
      : decision === "READY_WITH_WARNINGS"
        ? `READY_WITH_WARNINGS — ${warnings.length} qualification(s), score ${score.score} (${score.grade}).`
        : `READY — clean, score ${score.score} (${score.grade}).`;
  return { decision, score, blockers, warnings, summary };
}

/** Adaptors: lift layer-native findings into GateFindings (BLOCKER conversions). */
export const toGateFindings = {
  qa(checks: Array<{ id: string; status: "PASS" | "WARN" | "FAIL"; details: string }>): GateFinding[] {
    return checks
      .filter((c) => c.status !== "PASS")
      .map((c) => ({
        source: "QA" as const,
        code: c.id,
        severity: (c.status === "FAIL" ? "blocker" : "warn") as ResearchSeverity,
        detail: c.details,
      }));
  },
  recon(findings: Array<{ rule: string; year?: string; pass: boolean; severity: ResearchSeverity; detail: string }>): GateFinding[] {
    return findings
      .filter((f) => !f.pass)
      .map((f) => ({ source: "RECON" as const, code: f.rule, severity: f.severity, detail: `${f.year ? `${f.year}: ` : ""}${f.detail}` }));
  },
  label(findings: Array<{ invariant: string; pass: boolean; severity: ResearchSeverity; detail: string }>): GateFinding[] {
    return findings
      .filter((f) => !f.pass)
      .map((f) => ({ source: "LABEL" as const, code: f.invariant, severity: f.severity, detail: f.detail }));
  },
  disc(findings: DiscontinuityFinding[]): GateFinding[] {
    return findings
      .filter((f) => !f.pass)
      .map((f) => ({ source: "DISC" as const, code: f.code, severity: f.severity, detail: f.detail }));
  },
};
