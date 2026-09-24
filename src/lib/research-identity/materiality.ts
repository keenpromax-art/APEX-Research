import type {
  EconomicIdentity,
  InvestorQuestion,
  MaterialityAssessment,
  MaterialityDimensionScores,
  MaterialityProfile,
  ResearchIdentitySource,
} from "./types";
import { indexResearchReferences, makeEvidenceReferences } from "./evidence-profile";
import {
  MATERIALITY_DIMENSION_WEIGHTS,
  MATERIALITY_DIMENSIONS,
  MATERIALITY_TOPIC_DEFINITIONS,
  type MaterialityTopicDefinition,
} from "./registry";
import type { MaterialityTier, MaterialityTopicId } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

const TOPIC_KEYWORDS: Record<MaterialityTopicId, string[]> = {
  "growth-engine": ["growth", "revenue", "volume", "cagr", "expansion"],
  "margin-returns": ["margin", "return", "profit", "operating leverage", "roe", "roic"],
  "cash-conversion": ["cash", "free cash", "accrual", "conversion", "working capital"],
  "capital-allocation": ["capital allocation", "capex", "buyback", "dividend", "reinvestment"],
  "balance-sheet": ["balance sheet", "leverage", "debt", "equity", "solvency", "capital"],
  "asset-quality": ["asset quality", "npa", "provision", "credit cost", "collection"],
  "funding-liquidity": ["deposit", "funding", "liquidity", "borrowing", "maturity"],
  "segment-economics": ["segment", "division", "business mix"],
  "sum-of-parts": ["sum of parts", "sotp", "holding discount", "segment value"],
  "project-pipeline": ["project", "pipeline", "backlog", "order book", "concession"],
  "unit-economics": ["unit", "customer", "subscriber", "arpu", "retention"],
  "volume-price-mix": ["volume", "price", "mix", "realization", "premium"],
  "research-pipeline": ["pipeline", "research", "anda", "trial", "approval"],
  "valuation-expectations": ["valuation", "expectation", "multiple", "fair value", "target"],
  "scenarios": ["scenario", "bear", "bull", "sensitivity"],
  "management": ["management", "governance", "ownership", "board"],
  "risks": ["risk", "downside", "invalidation", "threat"],
  "catalysts": ["catalyst", "event", "trigger", "inflection"],
  "peers": ["peer", "competitor", "relative", "multiple"],
  "evidence": ["evidence", "filing", "disclosure", "audit", "unknown"],
};

const TOPIC_CANONICAL_FIELDS: Record<MaterialityTopicId, string[]> = {
  "growth-engine": ["revenue", "totalRevenue", "totalFeeRevenue", "rentalIncome", "grossWrittenPremium"],
  "margin-returns": ["netIncome", "operatingIncome", "underwritingResult", "netOperatingIncome"],
  "cash-conversion": ["operatingCashFlow", "capitalExpenditures", "freeCashFlow"],
  "capital-allocation": ["capitalExpenditures", "freeCashFlow"],
  "balance-sheet": ["totalDebt", "totalEquity", "totalAssets", "cash"],
  "asset-quality": ["loans", "provisionForCreditLosses", "grossNPA", "netNPA"],
  "funding-liquidity": ["deposits", "loans", "cash", "totalDebt"],
  "segment-economics": ["revenue", "netIncome"],
  "sum-of-parts": ["totalEquity", "totalDebt", "cash"],
  "project-pipeline": ["revenue", "operatingCashFlow"],
  "unit-economics": ["revenue", "netIncome"],
  "volume-price-mix": ["revenue", "netIncome"],
  "research-pipeline": ["revenue", "netIncome"],
  "valuation-expectations": ["currentPrice", "sharesOutstanding", "marketCap"],
  "scenarios": ["currentPrice", "sharesOutstanding"],
  "management": ["sharesOutstanding"],
  "risks": ["totalDebt", "cash", "netIncome"],
  "catalysts": ["revenue", "currentPrice"],
  "peers": ["currentPrice", "marketCap"],
  "evidence": ["revenue", "netIncome", "currentPrice"],
};

function latestPeriod(source: ResearchIdentitySource): string {
  const rows = source.researchCase.historicalFinancials ?? [];
  const latest = rows[rows.length - 1] as { fiscalYearEnd?: string; year?: string } | undefined;
  return latest?.fiscalYearEnd || latest?.year || source.researchCase.dataCutoff;
}

function topicTexts(source: ResearchIdentitySource, topicId: MaterialityTopicId): string[] {
  const report = source.researchReport;
  const keywords = TOPIC_KEYWORDS[topicId];
  const texts: string[] = [];
  const engine = report?.economicEngine;
  if (engine) {
    const drivers = [
      ...engine.revenueDrivers,
      ...engine.costDrivers,
      ...engine.marginDrivers,
      ...engine.cashDrivers,
      ...engine.balanceSheetDrivers,
      ...engine.capitalDrivers,
      ...engine.returnsDrivers,
    ];
    for (const driver of drivers) {
      const text = `${driver.name} ${driver.mechanism}`.toLowerCase();
      if (keywords.some((k) => text.includes(k))) texts.push(...(driver.sourceFacts ?? []));
    }
  }
  for (const item of report?.evidenceMap?.items ?? []) {
    const text = `${item.claim} ${item.evidence}`.toLowerCase();
    if (keywords.some((k) => text.includes(k))) texts.push(...item.factIds);
  }
  for (const debate of report?.debates ?? []) {
    const text = `${debate.debate} ${debate.mechanism} ${debate.significance}`.toLowerCase();
    if (keywords.some((k) => text.includes(k))) {
      texts.push(...debate.evidenceFor.flatMap((e) => e.factIds), ...debate.evidenceAgainst.flatMap((e) => e.factIds));
    }
  }
  return [...new Set(texts)].slice(0, 12);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function adjustForIdentity(
  definition: MaterialityTopicDefinition,
  economic: EconomicIdentity,
  source: ResearchIdentitySource,
  dimensions: MaterialityDimensionScores
): void {
  const rc = source.researchCase;
  if (definition.economicTypes?.includes(economic.type)) {
    dimensions.thesisRelevance = clamp01(dimensions.thesisRelevance + 0.12);
    dimensions.strategicImportance = clamp01(dimensions.strategicImportance + 0.08);
  }
  if (definition.sectorIds?.includes(rc.architecture.sectorId)) {
    dimensions.thesisRelevance = clamp01(dimensions.thesisRelevance + 0.06);
  }
  if (definition.architectures?.includes(rc.architecture.statementArchitecture)) {
    dimensions.balanceSheetImpact = clamp01(dimensions.balanceSheetImpact + 0.06);
  }
  if (definition.archetypes?.includes(rc.architecture.financialArchetype)) {
    dimensions.riskRelevance = clamp01(dimensions.riskRelevance + 0.06);
  }
  if (rc.historicalFinancials.length === 0 && ["growth-engine", "margin-returns", "cash-conversion"].includes(definition.id)) {
    dimensions.uncertainty = 0.85;
    dimensions.historicalAbnormality = 0.8;
  }
  if (rc.peers.gate.suppress && definition.id === "peers") {
    dimensions.uncertainty = 0.85;
    dimensions.evidenceStrength = 0.1;
  }
  if (rc.catalysts.eventCategories.length > 0 && definition.id === "catalysts") {
    dimensions.investorAttention = 0.75;
  }
  if (rc.peers.peers.length >= 3 && definition.id === "peers") {
    dimensions.evidenceStrength = Math.max(dimensions.evidenceStrength, 0.65);
  }
}

function scoreDimensions(dimensions: MaterialityDimensionScores): number {
  let total = 0;
  for (const dimension of MATERIALITY_DIMENSIONS) {
    total += dimensions[dimension] * MATERIALITY_DIMENSION_WEIGHTS[dimension];
  }
  return Math.round(total * 1000) / 1000;
}

function tierForScore(score: number, evidenceStrength: number): MaterialityTier {
  if (evidenceStrength <= 0.05 && score < 0.72) return "TIER_5_SUPPRESS";
  if (score >= 0.72) return "TIER_1_CORE";
  if (score >= 0.55) return "TIER_2_IMPORTANT";
  if (score >= 0.38) return "TIER_3_SUPPORTING";
  if (score >= 0.22) return "TIER_4_BACKGROUND";
  return "TIER_5_SUPPRESS";
}

export function assessMateriality(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity,
  question: InvestorQuestion
): MaterialityProfile {
  const period = latestPeriod(source);
  const assessments: MaterialityAssessment[] = MATERIALITY_TOPIC_DEFINITIONS.map((definition) => {
    const dimensions: MaterialityDimensionScores = { ...definition.dimensions };
    adjustForIdentity(definition, economic, source, dimensions);
    const aiRefs = makeEvidenceReferences(
      topicTexts(source, definition.id).map((id) => ({ id, kind: "ai-fact" as const })),
      index,
      12
    );
    const canonicalFields: string[] = (TOPIC_CANONICAL_FIELDS as Record<string, string[]>)[definition.id] ?? [];
    const canonicalRefs = makeEvidenceReferences(
      canonicalFields.map((field: string) => ({
        id: `canonical:${index.ticker}:${field}:${period}`,
        kind: "canonical-fact" as const,
      })),
      index,
      8
    );
    const registryRefs = makeEvidenceReferences(
      (source.researchCase.evidence?.items ?? [])
        .filter((item) => canonicalFields.includes(item.field))
        .slice(0, 6)
        .map((item) => ({ id: item.id, kind: "evidence-registry" as const })),
      index,
      6
    );
    const references = [...aiRefs, ...canonicalRefs, ...registryRefs].slice(0, 12);
    const supported = references.filter((r) => r.status === "supported").length;
    dimensions.evidenceStrength = clamp01(Math.max(dimensions.evidenceStrength, supported / 3));
    if (question.question && (TOPIC_KEYWORDS as Record<string, string[]>)[definition.id].some((k: string) => question.question!.toLowerCase().includes(k))) {
      dimensions.thesisRelevance = clamp01(dimensions.thesisRelevance + 0.08);
    }
    const proposal = source.proposal?.materiality?.find((m) => m.topicId === definition.id);
    let proposalAdjustment = 0;
    if (proposal?.scoreAdjustment) {
      const proposalRefs = makeEvidenceReferences(
        (proposal.evidenceIds ?? []).map((id) => ({ id, kind: "ai-fact" as const })),
        index,
        6
      );
      if (proposalRefs.some((r) => r.status === "supported")) proposalAdjustment = proposal.scoreAdjustment;
    }
    const score = Math.round((scoreDimensions(dimensions) + proposalAdjustment) * 1000) / 1000;
    const tier = tierForScore(score, dimensions.evidenceStrength);
    const topDimensions = MATERIALITY_DIMENSIONS.filter((d) => dimensions[d] >= 0.7).slice(0, 3);
    return {
      topicId: definition.id,
      label: definition.label,
      tier,
      score: Math.max(0, score),
      depth: 0,
      dimensions,
      rationale: topDimensions.length > 0
        ? `Material because ${topDimensions.join(", ")} are elevated on available evidence.`
        : "No material dimension is elevated on available evidence.",
      references,
      proposalAdjustment,
    };
  });
  const coreTopics = assessments.filter((a) => a.tier === "TIER_1_CORE").map((a) => a.topicId);
  const suppressedTopics = assessments.filter((a) => a.tier === "TIER_5_SUPPRESS").map((a) => a.topicId);
  const averageScore = assessments.length > 0
    ? Math.round((assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length) * 1000) / 1000
    : 0;
  return {
    status: coreTopics.length > 0 ? "available" : suppressedTopics.length === assessments.length ? "unavailable" : "insufficient",
    assessments,
    coreTopics,
    suppressedTopics,
    averageScore,
    references: assessments.flatMap((a) => a.references.filter((r) => r.status === "supported")).slice(0, 12),
  };
}
