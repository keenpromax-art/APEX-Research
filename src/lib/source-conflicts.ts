import type { EvidenceConflict, EvidenceItem } from "./evidence-registry";

export type {
  EvidenceConflict,
  EvidenceConflictReason,
  EvidenceConflictResolution,
  EvidenceItem,
  EvidenceRegistry,
  EvidenceSourceType,
  SourceTier,
} from "./evidence-registry";
export {
  compareTier,
  detectEvidenceConflicts,
  detectEvidenceConflicts as detectSourceConflicts,
  listEvidenceConflicts,
  listEvidenceConflicts as listSourceConflicts,
  sourceReliabilityScore,
  sourceTypeForTier,
} from "./evidence-registry";

export function resolveSourceConflict(conflict: EvidenceConflict): EvidenceItem {
  return { ...conflict.selected };
}
