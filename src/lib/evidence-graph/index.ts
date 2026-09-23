/**
 * APEX RESEARCH — Evidence Graph (Phase 7 entry point)
 *
 * Source → Evidence → Claim → Analysis → Conclusion → Section.
 * Claim scoring stays in claim-validator; registry stays in evidence-registry.
 */
export * from "./types";
export { buildEvidenceGraph, traceClaimPath } from "./build";
