/**
 * Bridge: AI-first ResearchReport → legacy AIAnalysis + ReportData.researchReport
 *
 * Content-intelligence (economic engine, debates, evidence map, structured
 * catalysts/moat chains) is computed by the ai-first pipeline and must be
 * visible in the UI/PDF — never dropped after assembly.
 */
import type { ResearchReport, ThesisSpecification, Catalyst, Risk, MoatAnalysis, CompetitorAnalysis, DebateEvidence } from "./types";
import type { AIAnalysis } from "@/types/report";

function clip(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

function buildThesisText(t: ThesisSpecification, debates: ResearchReport["debates"], why: string): string {
  const parts: string[] = [];
  const central = debates?.length
    ? debates.find((d) => d.debate === t.keyDebate) || debates[0]
    : null;

  if (central) {
    parts.push(`Core debate: ${central.debate}`);
    parts.push(`Thesis: ${t.thesis || "See debate resolution below."}`);
    if (t.keyDebate) parts.push(`Key debate: ${t.keyDebate}`);
    const forEv: DebateEvidence[] = central.evidenceFor || [];
    const againstEv: DebateEvidence[] = central.evidenceAgainst || [];
    parts.push(`FOR: ${forEv.map((e) => e.evidence).join("; ") || "—"}`);
    parts.push(`AGAINST: ${againstEv.map((e) => e.evidence).join("; ") || "—"}`);
    if (central.financialConsequence) parts.push(`Financial consequence: ${central.financialConsequence}`);
    if (central.valuationConsequence) parts.push(`Valuation consequence: ${central.valuationConsequence}`);
    if (central.resolutionSignal) parts.push(`Resolution signal: ${central.resolutionSignal}`);
  } else {
    parts.push(t.thesis);
  }

  if (why) parts.push(`Why this company: ${why}`);
  if (t.whatMarketMayBeMissing) parts.push(`What the market may be missing: ${t.whatMarketMayBeMissing}`);
  if (t.whatCouldInvalidate?.length) parts.push(`Invalidation: ${t.whatCouldInvalidate.join("; ")}`);
  if (t.bullCase?.length) parts.push(`Evidence FOR: ${t.bullCase.slice(0, 4).join(" | ")}`);
  if (t.bearCase?.length) parts.push(`Evidence AGAINST: ${t.bearCase.slice(0, 4).join(" | ")}`);
  return clip(parts.filter(Boolean).join("\n\n"), 4000);
}

function mapCatalysts(catalysts: Catalyst[]): AIAnalysis["catalysts"] {
  return catalysts.map((c) => ({
    event: c.catalyst,
    horizon: c.timeframe || "Unscheduled",
    probability: c.quantitative ? "Evidence-backed" : "Qualitative only",
    impact: [c.forecastImpact, c.valuationImpact].filter(Boolean).join(" → ") || "See chain",
    kpi: c.observableKpi,
    direction: c.direction,
    invalidation: c.invalidation,
  }));
}

function mapRisks(risks: Risk[]): AIAnalysis["keyRisks"] {
  return risks.map((r) => ({
    risk: r.risk,
    description: `${r.mechanism} | KPI: ${r.affectedKpi} | Financial: ${r.financialConsequence} | Valuation: ${r.valuationConsequence}`,
    impact: "High" as const,
    mitigation: r.monitoringIndicator,
    valuationSensitivity: r.valuationConsequence,
  }));
}

function mapMoat(moat: MoatAnalysis): {
  competitiveMoat?: string;
  moatSources?: AIAnalysis["moatSources"];
  moatPillars?: AIAnalysis["moatPillars"];
  moatChains?: AIAnalysis["moatChains"];
  businessStrategyCommentary?: string;
} {
  if (!moat?.sources?.length && !moat?.verdict) return {};
  const chains = moat.sources.map((s) => ({
    source: s.source,
    chain: s.chain || `${s.source} → ${s.economicConsequence} → durability ${s.durability}`,
    evidence: s.evidence,
    durability: s.durability,
    threats: s.threatsToDurability,
  }));
  const competitiveMoat = [moat.verdict, ...moat.sources.map((s) => s.chain || `${s.source}: ${s.economicConsequence}`)]
    .filter(Boolean)
    .join("\n");
  const first = moat.sources[0];
  const second = moat.sources[1];
  const third = moat.sources[2];
  return {
    competitiveMoat,
    moatChains: chains,
    moatPillars: moat.sources.map((s) => ({
      pillar: s.source,
      durability: s.durability,
      rationale: s.chain || `${s.evidence} — ${s.economicConsequence}`,
    })),
    moatSources: {
      switchingCosts: first?.chain || first?.evidence || "",
      intangibleAssets: second?.chain || second?.evidence || "",
      costAdvantage: third?.chain || third?.evidence || "",
      moatTrend: moat.hasMoat ? "Supported by evidence chain" : "No economic moat",
    },
    businessStrategyCommentary: chains.map((c) => c.chain).join(" | "),
  };
}

function mapCompetitive(comp: CompetitorAnalysis): AIAnalysis["competitiveLandscape"] {
  return (comp.competitors || []).map((c) => ({
    company: c.company,
    segment: c.segment,
    overlap: c.businessOverlap,
    difference: c.keyDifference,
    strengths: c.relativeStrengths,
    weaknesses: c.relativeWeaknesses,
  }));
}

function mapDebates(research: ResearchReport): NonNullable<AIAnalysis["researchDebates"]> {
  return (research.debates || []).map((d, i) => ({
    debate: d.debate,
    evidenceFor: (d.evidenceFor || []).map((e) => e.evidence).join("; "),
    evidenceAgainst: (d.evidenceAgainst || []).map((e) => e.evidence).join("; "),
    financialConsequence: d.financialConsequence,
    valuationConsequence: d.valuationConsequence,
    resolutionSignal: d.resolutionSignal,
    central:
      research.thesis?.keyDebate && d.debate === research.thesis.keyDebate
        ? true
        : i === 0,
  }));
}

function mapDiscovery(research: ResearchReport): AIAnalysis["researchDiscovery"] {
  const d = research.researchDiscovery;
  if (!d) return undefined;
  return {
    summary: d.summary,
    coverage: d.coverage,
    economicInsights: d.economicInsights,
    workingCapitalChain: d.workingCapitalChain,
    roicInterpretation: d.roicInterpretation,
    targetPriceMethodology: d.targetPriceMethodology,
    gaps: d.gaps.map((g) => ({ area: g.area, status: g.status, question: g.question })),
  };
}

/** Merge ai-first ResearchReport content into the report AIAnalysis (non-destructive for council fields). */
export function enrichAIAnalysisFromResearchReport(
  aiAnalysis: AIAnalysis,
  research: ResearchReport
): AIAnalysis {
  const why = research.companyUnderstanding?.whyThisCompany || "";
  const thesisText = research.thesis
    ? buildThesisText(research.thesis, research.debates, why)
    : "";
  const moatMaps = research.moat ? mapMoat(research.moat) : {};
  const competitiveLandscape = research.competitiveAnalysis
    ? mapCompetitive(research.competitiveAnalysis)
    : undefined;

  const enriched: AIAnalysis = {
    ...aiAnalysis,
    investmentThesis: thesisText || aiAnalysis.investmentThesis,
    investmentConclusion: thesisText || aiAnalysis.investmentConclusion,
    companyOverview:
      [research.companyUnderstanding?.whatItDoes, research.companyUnderstanding?.howItMakesMoney, why]
        .filter(Boolean)
        .join(" ") || aiAnalysis.companyOverview,
    whyThisCompany: why || aiAnalysis.whyThisCompany,
    researchDebates: research.debates?.length ? mapDebates(research) : aiAnalysis.researchDebates,
    competitiveMoat: moatMaps.competitiveMoat || aiAnalysis.competitiveMoat,
    moatChains: moatMaps.moatChains || aiAnalysis.moatChains,
    moatPillars: moatMaps.moatPillars?.length ? moatMaps.moatPillars : aiAnalysis.moatPillars,
    moatSources: moatMaps.moatSources && Object.values(moatMaps.moatSources).some(Boolean)
      ? moatMaps.moatSources
      : aiAnalysis.moatSources,
    businessStrategyCommentary: moatMaps.businessStrategyCommentary || aiAnalysis.businessStrategyCommentary,
    competitiveLandscape: competitiveLandscape?.length ? competitiveLandscape : aiAnalysis.competitiveLandscape,
    catalysts: research.catalysts?.length ? mapCatalysts(research.catalysts) : aiAnalysis.catalysts,
    keyRisks: research.risks?.length ? mapRisks(research.risks) : aiAnalysis.keyRisks,
    evidenceMapConfidence: research.evidenceMap?.overallConfidence,
    evidenceUnsupported: research.evidenceMap?.unsupported,
    researchDiscovery: mapDiscovery(research) || aiAnalysis.researchDiscovery,
    industryDynamicsCommentary:
      research.companyUnderstanding?.industryContext || aiAnalysis.industryDynamicsCommentary,
    managementCommentary:
      research.companyUnderstanding?.managementPriorities?.join("; ") || aiAnalysis.managementCommentary,
    capitalAllocationCommentary:
      research.capitalAllocation || aiAnalysis.capitalAllocationCommentary,
    segmentAnalysis:
      research.companyUnderstanding?.businessSegments
        ?.map((s) => `${s.name}: ${s.description}`)
        .join(" | ") || aiAnalysis.segmentAnalysis,
  };

  // Keep any existing council verification from legacy pipeline
  if (aiAnalysis.councilVerification) enriched.councilVerification = aiAnalysis.councilVerification;
  if (aiAnalysis.newsSummary) enriched.newsSummary = aiAnalysis.newsSummary;

  return enriched;
}

/** Render research debates for the PDF (section body). */
export function renderResearchDebates(debates: NonNullable<AIAnalysis["researchDebates"]>): string {
  return debates
    .map((d, i) => {
      const lines = [
        `${i + 1}. ${d.central ? "[CENTRAL] " : ""}${d.debate}`,
        d.evidenceFor ? `   FOR: ${d.evidenceFor}` : "",
        d.evidenceAgainst ? `   AGAINST: ${d.evidenceAgainst}` : "",
        d.financialConsequence ? `   Financial: ${d.financialConsequence}` : "",
        d.valuationConsequence ? `   Valuation: ${d.valuationConsequence}` : "",
        d.resolutionSignal ? `   Resolve on: ${d.resolutionSignal}` : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export default { enrichAIAnalysisFromResearchReport, renderResearchDebates };
