/**
 * APEX RESEARCH — Claim Validator (TRACK 3)
 * -------------------------------------------
 * Multi-claim, tier-aware validation over an EvidenceRegistry:
 *
 * - Every numeric claim is matched against the registry (best tier wins).
 * - Supported at any tier → info (pass), tier recorded for strength.
 * - Unsupported MATERIAL claims (percentage / currency) → BLOCKER.
 *   A thesis number with no evidence is fabrication until proven otherwise.
 * - Unsupported multiples / counts → WARN (thin, not necessarily false).
 * - Coverage scoring: supported / total + tier breakdown; systematic
 *   fabrication (≥3 unsupported material claims, or coverage < 50% with
 *   ≥3 claims) escalates to a set-level BLOCKER.
 *
 * Tolerances mirror claims.ts: percentages ±0.85pp absolute; currency ±2%
 * relative; multiples/counts ±5% relative.
 */
import type { Claim } from "./claims";
import { matchNumericEvidence, compareTier, type EvidenceRegistry, type SourceTier } from "./evidence-registry";
import type { ResearchSeverity } from "./severity";

export interface ClaimVerdict {
  claimId: string;
  text: string;
  kind: Claim["kind"];
  supported: boolean;
  tier: SourceTier | null;
  evidenceId: string | null;
  severity: ResearchSeverity;
  detail: string;
  /** Period tag from the claim text (e.g., "FY26", "2026E"). */
  period?: string;
  /** Direction consistency: does the claim's direction match the model's forecast? */
  directionConsistent?: boolean;
}

export interface ClaimSetResult {
  verdicts: ClaimVerdict[];
  total: number;
  supported: number;
  unsupported: number;
  coverage: number;
  tierBreakdown: Record<SourceTier, number>;
  blockers: ClaimVerdict[];
  setBlocker: boolean;
  summary: string;
}

const MATERIAL_KINDS: ReadonlySet<Claim["kind"]> = new Set(["percentage", "currency"]);

function toleranceFor(kind: Claim["kind"]): { toleranceAbs?: number; tolerancePct?: number } {
  if (kind === "percentage") return { toleranceAbs: 0.85 };
  if (kind === "currency") return { tolerancePct: 0.02 };
  return { tolerancePct: 0.05 };
}

/** Validate ONE claim against the registry. */
export function validateClaim(
  claim: Claim,
  registry: EvidenceRegistry
): ClaimVerdict {
  const base = { claimId: claim.id, text: claim.text, kind: claim.kind };
  if (claim.numericValue === undefined || !Number.isFinite(claim.numericValue)) {
    return {
      ...base, supported: false, tier: null, evidenceId: null, severity: "warn",
      detail: `Claim carries no parseable numeric — nothing to evidence (kind ${claim.kind}).`,
    };
  }
  const hit = matchNumericEvidence(registry, claim.numericValue, { kind: claim.kind, ...toleranceFor(claim.kind) });
  if (hit) {
    return {
      ...base, supported: true, tier: hit.tier, evidenceId: hit.id, severity: "info",
      detail: `Supported by ${hit.id} [${hit.tier}] (${hit.source}).`,
    };
  }
  if (MATERIAL_KINDS.has(claim.kind)) {
    return {
      ...base, supported: false, tier: null, evidenceId: null, severity: "blocker",
      detail: `FATAL: material ${claim.kind} claim "${claim.numericRaw ?? claim.numericValue}" has no registry evidence — unevidenced numbers must not publish.`,
    };
  }
  return {
    ...base, supported: false, tier: null, evidenceId: null, severity: "warn",
    detail: `Thin ${claim.kind} claim "${claim.numericRaw ?? claim.numericValue}" has no registry evidence — corroborate or drop.`,
  };
}

/** Extended claim verdict with temporal and directional metadata. */
export interface ClaimVerdictExtended extends ClaimVerdict {
  period?: string;
  directionConsistent?: boolean;
}

/**
 * Validate a claim with temporal and directional matching.
 * Extracts period tags, filters evidence to same-period items,
 * and checks directional consistency against model forecasts.
 */
export function validateClaimExtended(
  claim: Claim,
  registry: EvidenceRegistry,
  evidenceItems?: Array<{ id: string; tier: SourceTier; source: string; field: string; value: number; period?: string; numericValue?: number }>
): ClaimVerdictExtended {
  const verdict = validateClaim(claim, registry);
  const result: ClaimVerdictExtended = { ...verdict };

  // Temporal matching: extract year from claim text and only match evidence from same period
  const yearMatch = claim.text.match(/\b(20\d{2}|FY\d{2})\b/i);
  if (yearMatch) {
    const claimYear = yearMatch[0].replace(/FY/i, '20');
    result.period = claimYear;
    // Filter evidence to only same-period items
    const items = evidenceItems ?? [];
    const samePeriodEvidence = items.filter(e => {
      const ePeriod = e.period ?? "";
      return !ePeriod || ePeriod.includes(claimYear) || claimYear.includes(ePeriod);
    });
    if (samePeriodEvidence.length > 0) {
      // Re-match with period-filtered evidence
      const periodHit = samePeriodEvidence.find(e => {
        if (typeof e.value !== "number" || !Number.isFinite(e.value)) return false;
        const gap = Math.abs(e.value - (claim.numericValue ?? 0));
        const tol = toleranceFor(claim.kind);
        if (claim.kind === "percentage") return gap <= (tol.toleranceAbs ?? 0.85);
        const rel = Math.abs(e.value) > 0 ? gap / Math.abs(e.value) : (gap > 0 ? Infinity : 0);
        return gap <= (tol.toleranceAbs ?? 0) || rel <= (tol.tolerancePct ?? 0.05);
      });
      if (periodHit && (!verdict.supported || compareTier(periodHit.tier, verdict.tier ?? "TERTIARY") < 0)) {
        result.supported = true;
        result.tier = periodHit.tier;
        result.evidenceId = periodHit.id;
        result.severity = "info";
        result.detail = `Supported by ${periodHit.id} [${periodHit.tier}] (${periodHit.source}). [Period: ${claimYear}]`;
      }
    }
  }

  // Directional consistency: check if claim direction matches model forecast direction
  if (claim.numericValue != null && evidenceItems && evidenceItems.length > 0) {
    const modelEvidence = evidenceItems.find(e => e.source === "MODEL_DERIVED" || e.source === "canonical-forecast");
    if (modelEvidence?.numericValue != null) {
      const claimDirection = claim.numericValue > 0 ? "positive" : claim.numericValue < 0 ? "negative" : "neutral";
      const modelDirection = modelEvidence.numericValue > 0 ? "positive" : modelEvidence.numericValue < 0 ? "negative" : "neutral";
      result.directionConsistent = claimDirection === modelDirection || modelDirection === "neutral";
      if (!result.directionConsistent) {
        result.supported = false;
        result.severity = "blocker";
        result.detail = `Direction mismatch: claim says ${claimDirection} (${claim.numericValue.toFixed(2)}) but model forecasts ${modelDirection} (${modelEvidence.numericValue.toFixed(2)}).`;
      }
    }
  }

  return result;
}

/** Validate a SET of claims: per-claim verdicts + coverage scoring + set-level BLOCKER. */
export function validateClaimSet(
  claims: Claim[],
  registry: EvidenceRegistry
): ClaimSetResult {
  // Dedupe by claim id (same sentence extracted twice counts once).
  const seen = new Set<string>();
  const uniq = claims.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const verdicts = uniq.map((c) => validateClaim(c, registry));
  const supported = verdicts.filter((v) => v.supported).length;
  const total = verdicts.length;
  const unsupported = total - supported;
  const coverage = total === 0 ? 1 : supported / total;
  const tierBreakdown: Record<SourceTier, number> = { PRIMARY: 0, SECONDARY: 0, TERTIARY: 0, MODEL_DERIVED: 0 };
  for (const v of verdicts) {
    if (v.supported && v.tier) tierBreakdown[v.tier]++;
  }
  const blockers = verdicts.filter((v) => v.severity === "blocker");
  const materialUnsupported = blockers.length;
  // Set-level escalation: systematic fabrication pattern.
  const setBlocker = materialUnsupported >= 3 || (total >= 3 && coverage < 0.5);
  const summary =
    total === 0
      ? "No numeric claims — nothing to evidence."
      : setBlocker
        ? `BLOCKER: ${materialUnsupported} unsupported material claim(s), coverage ${(coverage * 100).toFixed(0)}% — systematic evidence failure.`
        : blockers.length > 0
          ? `BLOCKER: ${blockers.length} unsupported material claim(s), coverage ${(coverage * 100).toFixed(0)}%.`
          : `All ${total} claim(s) evidenced, coverage ${(coverage * 100).toFixed(0)}% (PRIMARY ${tierBreakdown.PRIMARY} / SECONDARY ${tierBreakdown.SECONDARY} / TERTIARY ${tierBreakdown.TERTIARY} / DERIVED ${tierBreakdown.MODEL_DERIVED}).`;
  return { verdicts, total, supported, unsupported, coverage, tierBreakdown, blockers, setBlocker, summary };
}
