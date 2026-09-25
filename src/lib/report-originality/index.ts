export { computeReportFingerprints, compareFingerprintSets, fingerprintSimilarity, FINGERPRINT_VERSION, FINGERPRINT_DOMAIN } from "./fingerprints";
export type { FingerprintSet, FingerprintInput } from "./fingerprints";
export { detectOriginalityCollision, isOriginalityBlocking, ORIGINALITY_VERSION, ORIGINALITY_COLLISION_THRESHOLD, ORIGINALITY_WATCH_THRESHOLD } from "./collision";
export type { OriginalityReport, OriginalityComparison, OriginalityStatus, CollisionInput } from "./collision";
export { persistOriginalitySummary, loadOriginalitySummaries, loadPriorFingerprints, clearOriginalitySummaries, originalityStoreSize, ORIGINALITY_STORE_BOUND } from "./store";
export type { OriginalitySummary } from "./store";
export { evaluateOriginalityQa, originalityGateForPublication } from "./qa";
export type { OriginalityQaResult } from "./qa";
