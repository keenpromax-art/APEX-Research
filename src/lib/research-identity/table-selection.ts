import type {
  EconomicIdentity,
  MaterialityProfile,
  ResearchIdentitySource,
  SignatureAnalysis,
  TableSelection,
} from "./types";
import { indexResearchReferences } from "./evidence-profile";
import { TABLE_CANDIDATES, type TableCandidate } from "./registry";
import { assessDataAvailability } from "./data-availability";

type Index = ReturnType<typeof indexResearchReferences>;
type Availability = ReturnType<typeof assessDataAvailability>;

function applies(candidate: TableCandidate, source: ResearchIdentitySource, economic: EconomicIdentity): boolean {
  const rc = source.researchCase;
  if (candidate.economicTypes && !candidate.economicTypes.includes(economic.type)) return false;
  if (candidate.sectorIds && !candidate.sectorIds.includes(rc.architecture.sectorId)) return false;
  if (candidate.architectures && !candidate.architectures.includes(rc.architecture.statementArchitecture)) return false;
  return true;
}

export function selectTables(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity,
  materiality: MaterialityProfile,
  signatures: SignatureAnalysis[],
  availability: Availability
): TableSelection {
  const selected = [];
  const omitted = [];
  for (const candidate of TABLE_CANDIDATES) {
    const topic = materiality.assessments.find((a) => a.topicId === candidate.topicId);
    const applicable = applies(candidate, source, economic);
    const dataReady = availability.available.has(candidate.dataSelector);
    const references = (topic?.references ?? []).filter((r) => r.status === "supported").slice(0, 6);
    const signatureMatch = signatures.some((s) => s.tableIds.includes(candidate.id));
    const tierBonus = topic?.tier === "TIER_1_CORE" ? 20 : topic?.tier === "TIER_2_IMPORTANT" ? 12 : topic?.tier === "TIER_3_SUPPORTING" ? 5 : 0;
    const priority = candidate.basePriority + tierBonus + (signatureMatch ? 15 : 0) + Math.min(10, references.length * 2);
    const omissionReason = !applicable
      ? "Candidate does not apply to this economic identity."
      : !dataReady
        ? availability.reasons.get(candidate.dataSelector) ?? "Required canonical data is unavailable."
        : references.length < candidate.requiredReferences
          ? "Evidence is insufficient for this table."
          : topic?.tier === "TIER_5_SUPPRESS"
            ? "Topic materiality suppresses this table."
            : null;
    const plan = {
      id: candidate.id,
      title: candidate.title,
      family: candidate.family,
      question: candidate.question,
      topicId: candidate.topicId,
      selected: omissionReason === null,
      priority,
      sectionId: null,
      signatureIds: signatures.filter((s) => s.tableIds.includes(candidate.id)).map((s) => s.id),
      modules: [...candidate.modules],
      dataSelector: candidate.dataSelector,
      decisionValue: candidate.decisionValue,
      omissionReason,
      references,
    };
    if (plan.selected) selected.push(plan);
    else omitted.push(plan);
  }
  selected.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  omitted.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return {
    status: selected.length > 0 ? "available" : omitted.length > 0 ? "insufficient" : "unavailable",
    selected,
    omitted,
  };
}
