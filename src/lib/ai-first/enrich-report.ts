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
  if (t.keyInflectionPoints?.length) parts.push(`Inflection points: ${t.keyInflectionPoints.join("; ")}`);
  if (t.bullCase?.length) parts.push(`Evidence FOR: ${t.bullCase.join(" | ")}`);
  if (t.bearCase?.length) parts.push(`Evidence AGAINST: ${t.bearCase.join(" | ")}`);
  return clip(parts.filter(Boolean).join("\n\n"), 24000);
}

/** Prefer the longer of two prose bodies — never shorten rich council text. */
function richer(a: string | undefined | null, b: string | undefined | null): string {
  const x = (a || "").trim();
  const y = (b || "").trim();
  return x.length >= y.length ? x : y;
}

function mapCatalysts(catalysts: Catalyst[]): AIAnalysis["catalysts"] {
  return catalysts.map((c) => ({
    event: c.catalyst,
    horizon: c.timeframe || "Unscheduled",
    probability: c.quantitative ? "Evidence-backed" : "Qualitative only",
    impact: [c.mechanism, c.financialVariable, c.forecastImpact, c.valuationImpact, c.observableKpi ? `KPI: ${c.observableKpi}` : ""]
      .filter(Boolean)
      .join(" → ") || "See chain",
    kpi: c.observableKpi,
    direction: c.direction,
    invalidation: c.invalidation,
  }));
}

function riskSeverity(r: Risk, all: Risk[]): "High" | "Medium" | "Low" {
  // Deterministic ranking, not invention: a risk is High when it carries a
  // quantified financial consequence and sits in the leading half of the
  // evidence-ranked set; otherwise Medium. No risk is silently downgraded.
  const idx = all.findIndex((x) => x.risk === r.risk);
  const quantified = /\d|%|margin|volume|price|credit|nim|occupancy|utilization|revenue|cost/i.test(
    `${r.financialConsequence} ${r.valuationConsequence}`
  );
  if (!quantified) return "Medium";
  return idx === 0 ? "High" : idx < all.length / 2 ? "High" : "Medium";
}

function mapRisks(risks: Risk[]): AIAnalysis["keyRisks"] {
  return risks.map((r) => ({
    risk: r.risk,
    description: [r.mechanism, r.affectedKpi ? `KPI: ${r.affectedKpi}` : "", r.financialConsequence, r.valuationConsequence]
      .filter(Boolean)
      .join(" | "),
    impact: riskSeverity(r, risks),
    mitigation: r.monitoringIndicator,
    valuationSensitivity: r.valuationConsequence,
  }));
}

function mapMoat(moat: MoatAnalysis): {
  competitiveMoat?: string;
  moatSources?: AIAnalysis["moatSources"];
  moatPillars?: AIAnalysis["moatPillars"];
  moatChains?: AIAnalysis["moatChains"];
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

/**
 * Economic-engine driver narrative — the part of ai-first that the legacy
 * council never wrote. Rendered into the strategy and forensic sections so
 * revenue/cost/margin/cash/balance-sheet mechanisms reach the PDF body.
 */
function economicEngineNarrative(research: ResearchReport): string {
  const e = research.economicEngine;
  if (!e) return "";
  const families: Array<[string, typeof e.revenueDrivers]> = [
    ["Revenue engines", e.revenueDrivers || []],
    ["Cost drivers", e.costDrivers || []],
    ["Margin engines", e.marginDrivers || []],
    ["Cash engines", e.cashDrivers || []],
    ["Balance-sheet engines", e.balanceSheetDrivers || []],
    ["Capital engines", e.capitalDrivers || []],
    ["Return engines", e.returnsDrivers || []],
  ];
  const lines: string[] = [];
  if (e.primaryAbstraction) lines.push(`Primary economic abstraction: ${e.primaryAbstraction}.`);
  for (const [label, drivers] of families) {
    if (!drivers?.length) continue;
    lines.push(`${label}: ${drivers.map((d) => `${d.name} — ${d.mechanism}`).join(" ")}`);
  }
  if (e.valueQuestions?.length) {
    lines.push(`The value questions this machine raises: ${e.valueQuestions.join(" | ")}`);
  }
  return lines.join("\n\n");
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
  const engineNarrative = economicEngineNarrative(research);

  // Append-only where both sources exist: rich council prose is never
  // shortened by the ai-first bridge (the previous behaviour replaced 800-word
  // strategy prose with a one-line moat-chain join).
  const strategyCombined = [
    aiAnalysis.businessStrategyCommentary,
    moatMaps.competitiveMoat,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  const overviewCombined = [
    aiAnalysis.companyOverview,
    research.companyUnderstanding?.whatItDoes,
    research.companyUnderstanding?.howItMakesMoney,
    research.companyUnderstanding?.industryContext,
    why,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  const segmentsText = research.companyUnderstanding?.businessSegments
    ?.map((s) => `${s.name}${s.shareOfRevenue != null ? ` (${(s.shareOfRevenue * 100).toFixed(0)}% of revenue)` : ""}: ${s.description}`)
    .join(" | ");

  const managementCombined = [
    aiAnalysis.managementCommentary,
    research.companyUnderstanding?.managementPriorities?.join("; "),
    research.managementAnalysis,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  const industryCombined = [
    aiAnalysis.industryDynamicsCommentary,
    aiAnalysis.globalIndustryAnalysis,
    research.companyUnderstanding?.industryContext,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  const forensicExtra = [
    research.financialQuality,
    research.historicalAnalysis,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n\n");

  const enriched: AIAnalysis = {
    ...aiAnalysis,
    // Thesis/conclusion: the synthesized chain wins when present (it is the
    // debate-driven body), but a longer council thesis is not truncated.
    investmentThesis: richer(thesisText, aiAnalysis.investmentThesis),
    investmentConclusion: aiAnalysis.investmentConclusion,
    companyOverview: overviewCombined || aiAnalysis.companyOverview,
    economicContext: richer([aiAnalysis.economicContext, forensicExtra].filter(Boolean).join("\n\n"), aiAnalysis.economicContext),
    whyThisCompany: why || aiAnalysis.whyThisCompany,
    researchDebates: research.debates?.length ? mapDebates(research) : aiAnalysis.researchDebates,
    competitiveMoat: richer(moatMaps.competitiveMoat, aiAnalysis.competitiveMoat),
    moatChains: moatMaps.moatChains?.length ? moatMaps.moatChains : aiAnalysis.moatChains,
    moatPillars: moatMaps.moatPillars?.length ? moatMaps.moatPillars : aiAnalysis.moatPillars,
    moatSources: moatMaps.moatSources && Object.values(moatMaps.moatSources).some(Boolean)
      ? moatMaps.moatSources
      : aiAnalysis.moatSources,
    businessStrategyCommentary: strategyCombined || aiAnalysis.businessStrategyCommentary,
    operatingProfileCommentary: richer(
      [aiAnalysis.operatingProfileCommentary, engineNarrative].filter(Boolean).join("\n\n"),
      aiAnalysis.operatingProfileCommentary
    ),
    segmentAnalysis: richer(segmentsText, aiAnalysis.segmentAnalysis),
    competitiveLandscape: competitiveLandscape?.length ? competitiveLandscape : aiAnalysis.competitiveLandscape,
    catalysts: research.catalysts?.length ? mapCatalysts(research.catalysts) : aiAnalysis.catalysts,
    keyRisks: research.risks?.length ? mapRisks(research.risks) : aiAnalysis.keyRisks,
    evidenceMapConfidence: research.evidenceMap?.overallConfidence ?? aiAnalysis.evidenceMapConfidence,
    evidenceUnsupported: research.evidenceMap?.unsupported ?? aiAnalysis.evidenceUnsupported,
    researchDiscovery: mapDiscovery(research) || aiAnalysis.researchDiscovery,
    industryDynamicsCommentary: industryCombined || aiAnalysis.industryDynamicsCommentary,
    globalIndustryAnalysis: richer(aiAnalysis.globalIndustryAnalysis, research.companyUnderstanding?.industryContext),
    managementCommentary: managementCombined || aiAnalysis.managementCommentary,
    capitalAllocationCommentary: richer(
      [aiAnalysis.capitalAllocationCommentary, research.capitalAllocation].filter(Boolean).join("\n\n"),
      aiAnalysis.capitalAllocationCommentary
    ),
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
