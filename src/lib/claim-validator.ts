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
import { matchNumericEvidence, type EvidenceRegistry, type SourceTier } from "./evidence-registry";
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
