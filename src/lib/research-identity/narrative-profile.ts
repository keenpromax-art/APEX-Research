import type {
  DebateMap,
  EconomicIdentity,
  InvestorQuestion,
  MaterialityProfile,
  NarrativeProfile,
  ResearchIdentitySource,
  SignatureAnalysis,
} from "./types";
import { indexResearchReferences, makeEvidenceReferences } from "./evidence-profile";
import { NARRATIVE_PROFILE_REGISTRY } from "./registry";
import { NARRATIVE_ARCHETYPES, type NarrativeArchetype } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

function tierScore(materiality: MaterialityProfile, topic: string): number {
  const tier = materiality.assessments.find((a) => a.topicId === topic)?.tier;
  if (tier === "TIER_1_CORE") return 1;
  if (tier === "TIER_2_IMPORTANT") return 0.7;
  if (tier === "TIER_3_SUPPORTING") return 0.45;
  if (tier === "TIER_4_BACKGROUND") return 0.25;
  return 0;
}

function archetypeScores(
  source: ResearchIdentitySource,
  economic: EconomicIdentity,
  materiality: MaterialityProfile
): Record<NarrativeArchetype, number> {
  const rc = source.researchCase;
  return {
    compounder: tierScore(materiality, "margin-returns") * 0.6 + tierScore(materiality, "cash-conversion") * 0.4 + (economic.type === "diversified-corporate" ? 0.15 : 0),
    growth: tierScore(materiality, "growth-engine") * 0.65 + tierScore(materiality, "unit-economics") * 0.35,
    forensic: (1 - source.researchCase.dataQuality.grade.localeCompare("A") * 0) * 0 + (materiality.assessments.find((a) => a.topicId === "evidence")?.score ?? 0) * 0.45 + tierScore(materiality, "risks") * 0.25 + (rc.unknowns.length / 12) * 0.3,
    credit: tierScore(materiality, "balance-sheet") * 0.55 + tierScore(materiality, "funding-liquidity") * 0.45,
    "deep-value": tierScore(materiality, "valuation-expectations") * 0.65 + tierScore(materiality, "margin-returns") * 0.35,
    turnaround: economic.type === "distressed-turnaround" ? 1 : tierScore(materiality, "risks") * 0.4,
    conglomerate: economic.type === "multi-segment-holding" ? 1 : tierScore(materiality, "segment-economics") * 0.5,
    "asset-backed": economic.type === "asset-backed-business" ? 1 : tierScore(materiality, "balance-sheet") * 0.3,
    "event-driven": Math.min(1, rc.catalysts.eventCategories.length / 3) * 0.65 + tierScore(materiality, "catalysts") * 0.35,
    cyclical: economic.type === "cyclical-capital-business" ? 1 : tierScore(materiality, "margin-returns") * 0.25,
    strategic: tierScore(materiality, "segment-economics") * 0.45 + tierScore(materiality, "management") * 0.35 + tierScore(materiality, "capital-allocation") * 0.2,
  };
}

export function buildNarrativeProfile(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity,
  materiality: MaterialityProfile,
  question: InvestorQuestion,
  signatures: SignatureAnalysis[],
  debates: DebateMap
): NarrativeProfile {
  const scores = archetypeScores(source, economic, materiality);
  const proposal = source.proposal?.narrativeProfile?.archetype;
  if (proposal && (NARRATIVE_ARCHETYPES as readonly string[]).includes(proposal)) {
    scores[proposal as NarrativeArchetype] += 0.18;
  }
  let archetype: NarrativeArchetype = "compounder";
  let best = -1;
  for (const candidate of NARRATIVE_ARCHETYPES) {
    if (scores[candidate] > best) {
      best = scores[candidate];
      archetype = candidate;
    }
  }
  const base = NARRATIVE_PROFILE_REGISTRY[archetype];
  const clamp = (value: number) => Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
  const profile: NarrativeProfile = {
    archetype,
    status: best > 0.12 ? "supported" : "insufficient_evidence",
    fundamentalIntensity: clamp(base.fundamentalIntensity + (tierScore(materiality, "growth-engine") - 0.5) * 0.1),
    valuationIntensity: clamp(base.valuationIntensity + (tierScore(materiality, "valuation-expectations") - 0.5) * 0.12),
    forensicIntensity: clamp(base.forensicIntensity + ((materiality.assessments.find((a) => a.topicId === "evidence")?.score ?? 0.5) - 0.5) * 0.12),
    strategicIntensity: clamp(base.strategicIntensity + (tierScore(materiality, "segment-economics") - 0.5) * 0.1),
    eventIntensity: clamp(base.eventIntensity + (tierScore(materiality, "catalysts") - 0.5) * 0.12),
    creditIntensity: clamp(base.creditIntensity + (tierScore(materiality, "balance-sheet") - 0.5) * 0.12),
    quantitativeDensity: clamp(base.quantitativeDensity + (materiality.averageScore - 0.5) * 0.1),
    skepticism: clamp(base.skepticism + (debates.unsupportedCount / Math.max(1, debates.debates.length)) * 0.2),
    evidenceRequirement: clamp(base.evidenceRequirement),
    scenarioEmphasis: clamp(base.scenarioEmphasis + (tierScore(materiality, "scenarios") - 0.5) * 0.12),
    managementWeight: clamp(base.managementWeight + (tierScore(materiality, "management") - 0.5) * 0.1),
    rationale: `Narrative emphasis follows materiality, signature work and debate uncertainty; ${archetype} scored ${Math.round(best * 1000) / 1000}.`,
    references: [
      ...materiality.references.slice(0, 6),
      ...makeEvidenceReferences(
        [{ id: `derived:${index.ticker}:research:ontology`, kind: "derived-calculation" as const }],
        index,
        1
      ),
    ],
    confidence: best > 0.12 ? 0.72 : 0.3,
  };
  void question;
  void signatures;
  return profile;
}
