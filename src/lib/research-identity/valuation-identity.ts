import { resolveValuationAnchors } from "@/lib/research-modules";
import type {
  DebateMap,
  EconomicIdentity,
  MaterialityProfile,
  ResearchIdentitySource,
  ValuationIdentity,
} from "./types";
import {
  indexResearchReferences,
  makeEvidenceReferences,
  supportedReferences,
} from "./evidence-profile";
import type { ValuationIdentityType } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

function classifyValuationType(source: ResearchIdentitySource, economic: EconomicIdentity): ValuationIdentityType {
  const rc = source.researchCase;
  if (rc.valuation?.sotpBreakdown) return "segment-sum-of-parts";
  if (rc.architecture.isFinancialInstitution) return "residual-income-equity";
  if (rc.architecture.statementArchitecture === "D") return "asset-nav";
  if (rc.architecture.financialArchetype === "DISTRESSED" || economic.type === "distressed-turnaround") return "recovery-option";
  if (rc.valuation) return "operating-cash-flow-dcf";
  return "undetermined";
}

function canonicalMarketRefs(source: ResearchIdentitySource, index: Index) {
  const facts = source.researchCase.canonicalFacts;
  const asOf = facts?.asOf ?? source.researchCase.dataCutoff;
  return makeEvidenceReferences(
    ["currentPrice", "sharesOutstanding", "marketCap"].map((field) => ({
      id: `canonical:${index.ticker}:${field}:${asOf}`,
      kind: "canonical-fact" as const,
    })),
    index,
    3
  );
}

export function buildValuationIdentity(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity,
  materiality: MaterialityProfile,
  debates: DebateMap
): ValuationIdentity {
  const rc = source.researchCase;
  const anchors = resolveValuationAnchors(rc);
  const type = classifyValuationType(source, economic);
  const reverse = rc.valuation?.reverseDCF ?? null;
  const aiReverse = source.researchReport?.reverseValuation ?? null;
  const methodReferences = [
    ...canonicalMarketRefs(source, index),
    ...makeEvidenceReferences(
      [{ id: `derived:${index.ticker}:valuation:anchors`, kind: "derived-calculation" as const }],
      index,
      1
    ),
  ];
  const reverseReferences = [
    ...makeEvidenceReferences(
      [{ id: `derived:${index.ticker}:valuation:reverse-dcf`, kind: "derived-calculation" as const }],
      index,
      1
    ),
    ...makeEvidenceReferences(
      (aiReverse ? [{ id: `derived:${index.ticker}:valuation:ai-reverse`, kind: "derived-calculation" as const }] : []),
      index,
      1
    ),
  ];
  const reverseVariable = reverse ? "revenue-growth-and-operating-margin" : aiReverse?.variable ?? null;
  const reverseConverged = reverse?.converged === true;
  const growthGap = typeof reverse?.impliedRevenueGrowthRate === "number" && typeof reverse.impliedTerminalOperatingMargin === "number"
    ? Math.abs(reverse.impliedRevenueGrowthRate) + Math.abs(reverse.impliedTerminalOperatingMargin)
    : 0;
  const expectationsTier = materiality.assessments.find((a) => a.topicId === "valuation-expectations")?.tier;
  const reverseCentral = Boolean(
    (reverseConverged && growthGap > 0.04) ||
      (expectationsTier === "TIER_1_CORE" || expectationsTier === "TIER_2_IMPORTANT") ||
      debates.debates.some((d) => d.central && /valuation|expect|price|multiple/i.test(`${d.question} ${d.valuationConsequence ?? ""}`))
  );
  const reverseInterpretation = reverse?.verdict ?? aiReverse?.interpretation ?? null;
  const method = anchors.rating || anchors.fairValue !== null
    ? `${type} anchored by ${anchors.anchorsFrom}`
    : null;
  const supported = supportedReferences([...methodReferences, ...reverseReferences]).length;
  return {
    type,
    status: method ? "supported" : "unavailable",
    method,
    lens: null,
    methodReferences,
    reverseVariable,
    reverseConverged,
    reverseCentral: reverseCentral && Boolean(reverseInterpretation),
    reverseInterpretation,
    reverseReferences,
    confidence: method ? Math.min(0.9, 0.45 + supported * 0.08) : 0,
  };
}
