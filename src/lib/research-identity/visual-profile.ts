import type {
  EconomicIdentity,
  InvestorQuestion,
  MaterialityProfile,
  NarrativeProfile,
  ResearchIdentitySource,
  SignatureAnalysis,
  ValuationIdentity,
  VisualProfile,
} from "./types";
import { indexResearchReferences, makeEvidenceReferences } from "./evidence-profile";
import { VISUAL_PROFILE_REGISTRY } from "./registry";
import { VISUAL_ARCHETYPES, type VisualArchetype } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

function tierScore(materiality: MaterialityProfile, topic: string): number {
  const tier = materiality.assessments.find((a) => a.topicId === topic)?.tier;
  if (tier === "TIER_1_CORE") return 1;
  if (tier === "TIER_2_IMPORTANT") return 0.7;
  if (tier === "TIER_3_SUPPORTING") return 0.45;
  if (tier === "TIER_4_BACKGROUND") return 0.25;
  return 0;
}

function visualScores(
  source: ResearchIdentitySource,
  economic: EconomicIdentity,
  materiality: MaterialityProfile,
  narrative: NarrativeProfile
): Record<VisualArchetype, number> {
  return {
    compounder: 0.35 + tierScore(materiality, "margin-returns") * 0.35,
    growth: tierScore(materiality, "growth-engine") * 0.65 + tierScore(materiality, "unit-economics") * 0.35,
    forensic: tierScore(materiality, "evidence") * 0.5 + narrative.forensicIntensity * 0.5,
    credit: tierScore(materiality, "balance-sheet") * 0.55 + tierScore(materiality, "funding-liquidity") * 0.45,
    "deep-value": tierScore(materiality, "valuation-expectations") * 0.7,
    turnaround: economic.type === "distressed-turnaround" ? 1 : tierScore(materiality, "risks") * 0.35,
    conglomerate: economic.type === "multi-segment-holding" ? 1 : tierScore(materiality, "segment-economics") * 0.55,
    "asset-backed": economic.type === "asset-backed-business" ? 1 : tierScore(materiality, "balance-sheet") * 0.3,
    "event-driven": tierScore(materiality, "catalysts") * 0.65 + narrative.eventIntensity * 0.35,
    cyclical: economic.type === "cyclical-capital-business" ? 1 : tierScore(materiality, "margin-returns") * 0.3,
  };
}

function coverStructure(
  question: InvestorQuestion,
  economic: EconomicIdentity,
  valuation: ValuationIdentity,
  materiality: MaterialityProfile
): VisualProfile["coverStructure"] {
  if (economic.type === "multi-segment-holding") return "segment-led";
  if (economic.type === "distressed-turnaround") return "recovery-led";
  if (valuation.reverseCentral) return "valuation-led";
  if ((materiality.assessments.find((a) => a.topicId === "evidence")?.score ?? 1) < 0.35) return "evidence-led";
  if (question.status === "available") return "question-led";
  return "metrics-led";
}

export function buildVisualProfile(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity,
  materiality: MaterialityProfile,
  narrative: NarrativeProfile,
  question: InvestorQuestion,
  valuation: ValuationIdentity,
  signatures: SignatureAnalysis[],
  chartCount: number,
  tableCount: number
): VisualProfile {
  const scores = visualScores(source, economic, materiality, narrative);
  const proposal = source.proposal?.visualProfile?.archetype;
  if (proposal && (VISUAL_ARCHETYPES as readonly string[]).includes(proposal)) {
    scores[proposal as VisualArchetype] += 0.18;
  }
  let archetype: VisualArchetype = "compounder";
  let best = -1;
  for (const candidate of VISUAL_ARCHETYPES) {
    if (scores[candidate] > best) {
      best = scores[candidate];
      archetype = candidate;
    }
  }
  const base = VISUAL_PROFILE_REGISTRY[archetype];
  const contentUnits = chartCount + tableCount + signatures.length;
  const density = contentUnits >= 14 || materiality.averageScore >= 0.62 ? "dense" : contentUnits <= 6 ? "spacious" : base.density;
  return {
    archetype,
    status: best > 0.12 ? "supported" : "insufficient_evidence",
    density,
    chartFrequency: base.chartFrequency,
    tableFrequency: base.tableFrequency,
    calloutFrequency: base.calloutFrequency,
    dividerStyle: base.dividerStyle,
    coverStructure: coverStructure(question, economic, valuation, materiality),
    typographyEmphasis: base.typographyEmphasis,
    chartEmphasis: base.chartEmphasis,
    rationale: `Visual treatment follows the ${archetype} research profile and ${contentUnits} selected analytical units.`,
    references: materiality.references.slice(0, 6),
    confidence: best > 0.12 ? 0.7 : 0.3,
  };
}

export function visualReferenceIds(index: Index) {
  return makeEvidenceReferences(
    [{ id: `derived:${index.ticker}:research:ontology`, kind: "derived-calculation" as const }],
    index,
    1
  );
}
