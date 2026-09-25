import type { AdvisoryPreviewPolicy, CanonicalQaDecision } from "./types";
import { advisoryPreviewForDecision } from "./decision";
export const ADVISORY_PREVIEW_LABEL = "Diagnostic preview (non-publishable)" as const;
export const ADVISORY_READY_LABEL = "PDF" as const;
export function advisoryPreviewPolicyForCanonicalPackage(input: {
  decision?: unknown;
  blockers?: unknown;
  warnings?: unknown;
  canPublish?: unknown;
}): AdvisoryPreviewPolicy {
  const decision = input.decision === "BLOCK" || input.decision === "REVIEW" || input.decision === "QUALIFIED" || input.decision === "READY" ? (input.decision as CanonicalQaDecision) : null;
  const blockers = Array.isArray(input.blockers) ? (input.blockers as unknown[]).map((v) => String(v)) : [];
  const warnings = Array.isArray(input.warnings) ? (input.warnings as unknown[]).map((v) => String(v)) : [];
  if (decision) return advisoryPreviewForDecision(decision, blockers, warnings);
  if (input.canPublish === true) return { allowed: true, label: ADVISORY_READY_LABEL, reason: "Canonical package is publishable", exportAllowed: true, publishAllowed: true };
  return { allowed: true, label: ADVISORY_PREVIEW_LABEL, reason: blockers.join("; ") || warnings.join("; ") || "Canonical package is not publishable; advisory preview only", exportAllowed: false, publishAllowed: false };
}
export function diagnosticPreviewLabelForDecision(decision: CanonicalQaDecision): string {
  return decision === "READY" ? ADVISORY_READY_LABEL : ADVISORY_PREVIEW_LABEL;
}
export function isPublishAllowedForDecision(decision: CanonicalQaDecision): boolean {
  return decision === "READY" || decision === "QUALIFIED";
}
export function isExportAllowedForDecision(decision: CanonicalQaDecision): boolean {
  return decision === "READY" || decision === "QUALIFIED";
}
