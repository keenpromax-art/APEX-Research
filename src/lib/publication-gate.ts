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
import type { EvidenceRegistry } from "./evidence-registry";
import { sourceQualityScore, listEvidenceConflicts } from "./evidence-registry";
import { QA_GATES_ENABLED } from "./qa-gates";

export type GateDecision = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

/**
 * P0–P3 priority taxonomy mapped from canonical severity:
 *   P0 (BLOCKER):  blocker  — publication prohibited until fixed.
 *   P1 (MAJOR):    material — disclosure-grade break; warns, may block if hidden.
 *   P2 (WARNING):  warn     — thin evidence / loose tolerance; costs score.
 *   P3 (INFO):     info     — diagnostic, no action required.
 */
export type GatePriority = "P0" | "P1" | "P2" | "P3";

export const SEVERITY_TO_PRIORITY: Record<ResearchSeverity, GatePriority> = {
  blocker: "P0",
  material: "P1",
  warn: "P2",
  info: "P3",
};

export interface GateFinding {
  source: "QA" | "RECON" | "LABEL" | "DISC" | "VALIDATOR" | "INDEPENDENT";
  code: string;
  severity: ResearchSeverity;
  priority: GatePriority;
  detail: string;
}

export interface PriorityBreakdown {
  P0: number;
  P1: number;
  P2: number;
  P3: number;
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
  priorityBreakdown: PriorityBreakdown;
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

/** High-severity QA codes that must block publication (not merely warn) when present.
 * THESIS-CHAIN-01 / CATALYST-SPEC-01 / COMPET-SEG-01 / MOAT-EVIDENCE-01 are
 * evidence-quality warnings — they cost score and count toward the 20-warning
 * overflow, but a single missing chain does not alone block a clean report
 * (otherwise every minimal test fixture would BLOCK). */
export const HIGH_SEVERITY_QA_BLOCKERS = new Set<string>([
  "THESIS-01", "OVERVIEW-01", "COMPET-01", "CATALYST-01", "MOAT-01", "MOAT-02", "MOAT-03",
  "CLAIM-01", "GOV-01", "DISC-01", "BS-01", "CHAIN-01", "ASSUME-01",
  "XREF-01", "XREF-02", "XREF-03", "XREF-04", "XREF-05", "FV-RECOMP-01",
  "IDENTITY-01", "PLACEHOLDER-01", "NARRATIVE-01", "SANITIZE-01",
  "BS-DETECTOR-04", "BS-DETECTOR-05", "PEER-01", "RATING-01", "RATING-02",
  "SEMANTIC-01", "VAL-01", "CREDIT-01", "ARCH-01", "ARCH-02", "ARCH-03", "ARCH-04",
  "GATE-OVERFLOW",
]);

/** Substantive-warning threshold beyond which disclosure is insufficient — publication blocked. */
export const SUBSTANTIVE_WARNING_THRESHOLD = 20;

/** Evaluate ONE gate decision from canonical-severity findings. */
export function evaluatePublicationGate(findings: GateFinding[]): PublicationGateResult {
  // Count substantive warnings before escalation (warn + material).
  const preSeverities = findings.map((f) => f.severity);
  const preBlockers = findings.filter((f) => f.severity === "blocker");
  const preWarnings = findings.filter((f) => f.severity === "material" || f.severity === "warn");
  const substantiveCount = preWarnings.length;

  // Kill-switch: when QA_GATES_ENABLED is false, findings stay as-is for
  // diagnostics but no GATE-OVERFLOW / high-severity escalation, and decision
  // never returns BLOCKED.
  let escalatedFindings = [...findings];
  if (QA_GATES_ENABLED) {
    if (substantiveCount >= SUBSTANTIVE_WARNING_THRESHOLD) {
      escalatedFindings.push({
        source: "QA",
        code: "GATE-OVERFLOW",
        severity: "blocker",
        priority: "P0",
        detail: `Report carries ${substantiveCount} material/warn qualifications (threshold ${SUBSTANTIVE_WARNING_THRESHOLD}) — exceeds substantive-warning budget; publication requires remediation, not disclosure.`,
      });
    }
    escalatedFindings = escalatedFindings.map((f) => {
      if ((f.severity === "material" || f.severity === "warn") && HIGH_SEVERITY_QA_BLOCKERS.has(f.code)) {
        return { ...f, severity: "blocker" as ResearchSeverity, priority: "P0" as GatePriority };
      }
      return f;
    });
  }

  const severities = escalatedFindings.map((f) => f.severity);
  const top = escalatedFindings.length === 0 ? ("info" as ResearchSeverity) : maxSeverity(severities);
  const gateLevel = researchToGate(top);
  const decision: GateDecision = !QA_GATES_ENABLED
    ? (gateLevel === "BLOCKED" || gateLevel === "WARNING" ? "READY_WITH_WARNINGS" : "READY")
    : gateLevel === "BLOCKED" ? "BLOCKED" : gateLevel === "WARNING" ? "READY_WITH_WARNINGS" : "READY";
  const score = scoreFromSeverities(severities);
  const blockers = escalatedFindings.filter((f) => f.severity === "blocker");
  const warnings = escalatedFindings.filter((f) => f.severity === "material" || f.severity === "warn");

  const priorityBreakdown: PriorityBreakdown = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of escalatedFindings) {
    priorityBreakdown[f.priority]++;
  }

  const summary =
    decision === "BLOCKED"
      ? `BLOCKED — ${blockers.length} blocker(s): ${blockers.slice(0, 2).map((b) => `${b.code}: ${b.detail.slice(0, 90)}`).join(" | ")}${blockers.length > 2 ? ` (+${blockers.length - 2} more)` : ""}`
      : decision === "READY_WITH_WARNINGS"
        ? `READY_WITH_WARNINGS — ${warnings.length} qualification(s), score ${score.score} (${score.grade}).`
        : `READY — clean, score ${score.score} (${score.grade}).`;
  return { decision, score, blockers, warnings, priorityBreakdown, summary };
}

/** SOURCE-QUALITY: Aggregate data quality check over the evidence registry. */
export function checkSourceQuality(registry: EvidenceRegistry): GateFinding[] {
  const findings: GateFinding[] = [];
  const sqs = sourceQualityScore(registry);

  if (sqs.primaryCoverage < 0.3 && registry.items.length > 5) {
    const primary = sqs.tierCounts["PRIMARY"] ?? 0;
    const secondary = sqs.tierCounts["SECONDARY"] ?? 0;
    const tertiary = sqs.tierCounts["TERTIARY"] ?? 0;
    const model = sqs.tierCounts["MODEL_DERIVED"] ?? 0;
    findings.push({
      source: "QA",
      code: "SOURCE-QUALITY",
      severity: "warn",
      priority: "P2",
      detail: `Low PRIMARY source coverage: ${primary}/${registry.items.length} fields (${(sqs.primaryCoverage * 100).toFixed(0)}%). ${secondary} SECONDARY, ${tertiary} TERTIARY, ${model} MODEL_DERIVED. Verify data freshness and consider filing-sourced corroboration.`,
    });
  }

  for (const conflict of listEvidenceConflicts(registry).filter((item) => item.material)) {
    findings.push({
      source: "QA",
      code: "SOURCE-CONFLICT",
      severity: "material",
      priority: "P1",
      detail: `${conflict.field} has conflicting evidence (${conflict.reason}); ${conflict.selected.tier} source selected: ${conflict.detail}`,
    });
  }

  for (const flag of sqs.stalenessFlags) {
    findings.push({
      source: "QA",
      code: "SOURCE-STALENESS",
      severity: "info",
      priority: "P3",
      detail: flag.message,
    });
  }

  return findings;
}

/** NARR-GENERIC: Generic company overview detection. */
export function checkNarrativeBoilerplate(data: {
  narrative?: { companyOverview?: string; overview?: string; companyDescription?: string };
}): GateFinding[] {
  const findings: GateFinding[] = [];
  const overview = (data.narrative?.companyOverview ?? data.narrative?.overview ?? data.narrative?.companyDescription ?? "").toLowerCase();
  if (overview.length > 0) {
    const genericPhrases = [
      "leading provider", "committed to delivering", "our mission is",
      "we are a", "our vision", "dedicated to", "we strive",
      "world-class", "best-in-class", "industry-leading", "premier",
    ];
    const matches = genericPhrases.filter(p => overview.includes(p));
    if (matches.length >= 3) {
      findings.push({
        source: "QA",
        code: "NARR-GENERIC",
        severity: "warn",
        priority: "P2",
        detail: `Company overview contains ${matches.length} generic boilerplate phrases without company-specific detail. Overview should reference actual segments, revenue drivers, or financial metrics.`,
      });
    }
  }
  return findings;
}

/** Adaptors: lift layer-native findings into GateFindings (BLOCKER conversions). */
export const toGateFindings = {
  qa(checks: Array<{ id: string; status: "PASS" | "WARN" | "FAIL"; details: string }>): GateFinding[] {
    return checks
      .filter((c) => c.status !== "PASS")
      .map((c) => {
        const severity: ResearchSeverity = c.status === "FAIL" ? "blocker" : "warn";
        return {
          source: "QA" as const,
          code: c.id,
          severity,
          priority: SEVERITY_TO_PRIORITY[severity],
          detail: c.details,
        };
      });
  },
  recon(findings: Array<{ rule: string; year?: string; pass: boolean; severity: ResearchSeverity; detail: string }>): GateFinding[] {
    return findings
      .filter((f) => !f.pass)
      .map((f) => ({
        source: "RECON" as const,
        code: f.rule,
        severity: f.severity,
        priority: SEVERITY_TO_PRIORITY[f.severity],
        detail: `${f.year ? `${f.year}: ` : ""}${f.detail}`,
      }));
  },
  label(findings: Array<{ invariant: string; pass: boolean; severity: ResearchSeverity; detail: string }>): GateFinding[] {
    return findings
      .filter((f) => !f.pass)
      .map((f) => ({
        source: "LABEL" as const,
        code: f.invariant,
        severity: f.severity,
        priority: SEVERITY_TO_PRIORITY[f.severity],
        detail: f.detail,
      }));
  },
  disc(findings: DiscontinuityFinding[]): GateFinding[] {
    return findings
      .filter((f) => !f.pass)
      .map((f) => ({
        source: "DISC" as const,
        code: f.code,
        severity: f.severity,
        priority: SEVERITY_TO_PRIORITY[f.severity],
        detail: f.detail,
      }));
  },
  sourceQuality(registry: EvidenceRegistry): GateFinding[] {
    return checkSourceQuality(registry);
  },
};
