import type {
  EconomicIdentity,
  MaterialityProfile,
  ResearchIdentitySource,
  SignatureAnalysis,
} from "./types";
import { indexResearchReferences, makeEvidenceReferences } from "./evidence-profile";
import { SIGNATURE_CANDIDATES, type SignatureCandidate } from "./registry";
import { assessDataAvailability } from "./data-availability";
import type { AnalyticalDepth, SignatureAnalysisType } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;
type Availability = ReturnType<typeof assessDataAvailability>;

function moduleAvailable(source: ResearchIdentitySource, module: string): boolean {
  const rc = source.researchCase;
  if (module === "business") return true;
  if (module === "statements") return rc.historicalFinancials.length > 0;
  if (module === "valuation") return Boolean(rc.assumptionsLedger || rc.valuation);
  if (module === "peers") return !rc.peers.gate.suppress && rc.peers.peers.length > 0;
  if (module === "moat") return Boolean(rc.competition.moat);
  if (module === "risk-catalyst") return rc.risks.risks.length > 0 || rc.catalysts.catalysts.length > 0;
  if (module === "management") return rc.management.available || rc.management.officers.length > 0;
  if (module === "quality") return Boolean(rc.canonicalFacts || rc.evidence);
  if (module === "thesis") return Boolean(source.researchReport?.thesis || rc.assumptionsLedger);
  return false;
}

function candidateApplies(candidate: SignatureCandidate, source: ResearchIdentitySource, economic: EconomicIdentity): boolean {
  const rc = source.researchCase;
  if (candidate.economicTypes && !candidate.economicTypes.includes(economic.type)) return false;
  if (candidate.sectorIds && !candidate.sectorIds.includes(rc.architecture.sectorId)) return false;
  if (candidate.architectures && !candidate.architectures.includes(rc.architecture.statementArchitecture)) return false;
  if (candidate.archetypes && !candidate.archetypes.includes(rc.architecture.financialArchetype)) return false;
  return true;
}

function depthForTier(tier: string, depth: "concise" | "full"): AnalyticalDepth {
  const base = tier === "TIER_1_CORE" ? 4 : tier === "TIER_2_IMPORTANT" ? 3 : tier === "TIER_3_SUPPORTING" ? 2 : 1;
  const adjusted = depth === "full" ? base + 1 : tier === "TIER_1_CORE" ? base : base - 0; // full reports deepen signature work
  return Math.max(1, Math.min(5, adjusted)) as AnalyticalDepth;
}

export function selectSignatureAnalyses(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity,
  materiality: MaterialityProfile,
  availability: Availability
): SignatureAnalysis[] {
  const scored = SIGNATURE_CANDIDATES.filter((candidate) => candidateApplies(candidate, source, economic)).map((candidate) => {
    const topic = materiality.assessments.find((a) => a.topicId === candidate.topicId);
    const modulesReady = candidate.requiresModules.every((m) => moduleAvailable(source, m));
    const dataReady = candidate.requiresDataSelectors.every((selector) => availability.available.has(selector));
    const references = [
      ...(topic?.references ?? []).filter((r) => r.status === "supported").slice(0, 4),
      ...makeEvidenceReferences(
        [{ id: `derived:${index.ticker}:research:ontology`, kind: "derived-calculation" as const }],
        index,
        1
      ),
    ];
    const supported = references.filter((r) => r.status === "supported").length;
    const tierBonus = topic?.tier === "TIER_1_CORE" ? 18 : topic?.tier === "TIER_2_IMPORTANT" ? 10 : topic?.tier === "TIER_3_SUPPORTING" ? 4 : 0;
    const proposal = source.proposal?.signatureAnalyses?.find((p) => p.type === candidate.type);
    const proposalRefs = makeEvidenceReferences(
      (proposal?.evidenceIds ?? []).map((id) => ({ id, kind: "ai-fact" as const })),
      index,
      6
    );
    const proposalBonus = proposal && proposalRefs.some((r) => r.status === "supported") ? 12 : 0;
    const score = candidate.basePriority + tierBonus + Math.min(12, supported * 3) + proposalBonus;
    return { candidate, topic, modulesReady, dataReady, references, score };
  });
  const viable = scored
    .filter((s) => s.modulesReady && s.dataReady && s.references.some((r) => r.status === "supported"))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const selected = viable.slice(0, 3);
  if (selected.length === 0) {
    const fallback = scored.find((s) => s.candidate.type === "earnings-power-bridge" && s.modulesReady && s.dataReady);
    if (fallback && source.researchCase.historicalFinancials.length > 0) selected.push(fallback);
  }
  return selected.map(({ candidate, topic, references }) => {
    const title = source.proposal?.signatureAnalyses?.find((p) => p.type === candidate.type)?.title || candidate.title;
    const question = source.proposal?.signatureAnalyses?.find((p) => p.type === candidate.type)?.question || candidate.question;
    return {
      id: candidate.id,
      type: candidate.type as SignatureAnalysisType,
      title,
      question,
      topicId: candidate.topicId,
      depth: depthForTier(topic?.tier ?? "TIER_3_SUPPORTING", source.depth),
      sectionId: null,
      chartIds: [...candidate.chartIds],
      tableIds: [...candidate.tableIds],
      status: "supported",
      rationale: `${candidate.question} ${topic ? `Materiality ${topic.tier.replace(/_/g, " ").toLowerCase()} with score ${topic.score}.` : ""}`.trim(),
      references: references.slice(0, 8),
      confidence: Math.min(0.9, 0.5 + references.filter((r) => r.status === "supported").length * 0.08),
    } satisfies SignatureAnalysis;
  });
}
