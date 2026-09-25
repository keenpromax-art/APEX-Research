import { deepFreeze } from "../research-ledger/immutable";
import { stableHash } from "../research-ledger/stable";
import type { AdvisoryPreviewPolicy, CanonicalIntegrityScores, CanonicalQaDecision, CanonicalQaDiagnostic, CanonicalQaResult, RegenerationAttempt } from "./types";
import { CANONICAL_QA_VERSION } from "./types";
import { hashCanonicalQaInput, hashReportForQa, scoreCanonicalQa } from "./scoring";
import { runCanonicalQaDimensions } from "./dimensions";
export function decideCanonicalQa(
  diagnostics: CanonicalQaDiagnostic[],
  scores: CanonicalIntegrityScores,
  stale: boolean
): CanonicalQaDecision {
  if (stale) return "BLOCK";
  if (scores.blockerCount > 0) return "BLOCK";
  if (scores.overall < 40) return "BLOCK";
  const criticalMajors = diagnostics.filter(
    (d) => d.severity === "major" && (d.dimension === "accounting" || d.dimension === "numerical" || d.dimension === "evidence" || d.dimension === "valuation" || d.dimension === "reproducibility")
  );
  if (criticalMajors.length > 0) return "REVIEW";
  if (scores.majorCount > 0) return "REVIEW";
  if (scores.overall < 70) return "REVIEW";
  if (scores.minorCount > 0) return "QUALIFIED";
  if (scores.overall < 85) return "QUALIFIED";
  return "READY";
}
export function advisoryPreviewForDecision(decision: CanonicalQaDecision, blockers: string[], warnings: string[]): AdvisoryPreviewPolicy {
  if (decision === "READY") {
    return { allowed: true, label: "PDF", reason: "Canonical QA is READY for publication", exportAllowed: true, publishAllowed: true };
  }
  if (decision === "QUALIFIED") {
    return { allowed: true, label: "Qualified PDF with disclosed qualifications", reason: warnings.join("; ") || "Qualified publication with disclosed warnings", exportAllowed: true, publishAllowed: true };
  }
  if (decision === "REVIEW") {
    return { allowed: true, label: "Diagnostic preview (non-publishable)", reason: warnings.join("; ") || blockers.join("; ") || "Review required before publication", exportAllowed: false, publishAllowed: false };
  }
  return { allowed: true, label: "Diagnostic preview (non-publishable)", reason: blockers.join("; ") || "Publication is blocked", exportAllowed: false, publishAllowed: false };
}
export function isCanonicalQaStale(result: CanonicalQaResult, currentInputHash: string): boolean {
  return result.inputHash !== currentInputHash;
}
export function verifyCanonicalQaResult(result: unknown, currentInputHash?: string): boolean {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return false;
  const candidate = result as CanonicalQaResult;
  if (candidate.version !== CANONICAL_QA_VERSION) return false;
  if (typeof candidate.inputHash !== "string" || candidate.inputHash.length !== 64) return false;
  if (typeof candidate.reportHash !== "string" || candidate.reportHash.length !== 64) return false;
  if (!Array.isArray(candidate.diagnostics)) return false;
  if (candidate.decision !== "BLOCK" && candidate.decision !== "REVIEW" && candidate.decision !== "QUALIFIED" && candidate.decision !== "READY") return false;
  const recomputed = scoreCanonicalQa(candidate.diagnostics);
  if (recomputed.overall !== candidate.scores.overall) return false;
  if (recomputed.blockerCount !== candidate.scores.blockerCount) return false;
  if (recomputed.majorCount !== candidate.scores.majorCount) return false;
  const expectedDecision = decideCanonicalQa(candidate.diagnostics, recomputed, false);
  const stale = currentInputHash !== undefined ? candidate.inputHash !== currentInputHash : candidate.stale;
  if (stale && candidate.decision !== "BLOCK" && candidate.stale !== true) return false;
  if (!stale && candidate.decision !== expectedDecision) return false;
  return true;
}
export function runCanonicalQa(
  report: unknown,
  pack: unknown,
  context: Record<string, unknown> = {},
  options: { generatedAt?: string; attempts?: RegenerationAttempt[]; reproducibilityHash?: string | null; priorInputHash?: string | null } = {}
): CanonicalQaResult {
  const generatedAt = typeof options.generatedAt === "string" ? options.generatedAt : new Date().toISOString();
  const diagnostics = runCanonicalQaDimensions(report, pack, context);
  const scores = scoreCanonicalQa(diagnostics);
  const inputHash = hashCanonicalQaInput({ report, packTicker: (pack as Record<string, unknown> | null)?.ticker ?? null, context });
  const reportHash = hashReportForQa(report);
  const stale = options.priorInputHash !== undefined && options.priorInputHash !== null ? options.priorInputHash !== inputHash : false;
  const decision = decideCanonicalQa(diagnostics, scores, stale);
  const blockers = diagnostics.filter((d) => d.severity === "blocker").map((d) => `${d.id}: ${d.finding}`);
  const warnings = diagnostics.filter((d) => d.severity !== "blocker").map((d) => `${d.id}: ${d.finding}`);
  const advisoryPreview = advisoryPreviewForDecision(decision, blockers, warnings);
  const attempts = options.attempts ? [...options.attempts] : [];
  const result: CanonicalQaResult = {
    version: CANONICAL_QA_VERSION,
    generatedAt,
    inputHash,
    reportHash,
    dimensions: scores.dimensions.map((d) => d.dimension),
    diagnostics,
    scores,
    decision,
    blockers,
    warnings,
    stale,
    advisoryPreview,
    attempts,
    reproducibilityHash: options.reproducibilityHash ?? null
  };
  return deepFreeze(result) as CanonicalQaResult;
}
export function hashCanonicalQaResult(result: CanonicalQaResult): string {
  return stableHash(result, "canonical-qa/result/v1");
}
