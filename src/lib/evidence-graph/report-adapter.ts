import type { ReportData } from "@/types/report";
import { extractStructuredClaims } from "@/lib/claims";
import { buildEvidenceGraph } from "./build";
import type { EvidenceGraph, EvidenceNarrative } from "./types";

function addNarrative(
  narratives: EvidenceNarrative[],
  originId: string,
  text: string | null | undefined,
  options: Omit<EvidenceNarrative, "originId" | "text"> = {}
): void {
  if (typeof text !== "string" || !text.trim()) return;
  narratives.push({ originId, text, ...options });
}

function collectReportNarratives(report: ReportData): EvidenceNarrative[] {
  const narratives: EvidenceNarrative[] = [];
  const research = report.researchReport;
  const ai = report.aiAnalysis;
  const centralClaimId = research?.thesis?.thesis
    ? extractStructuredClaims(research.thesis.thesis)[0]?.id
    : undefined;

  addNarrative(narratives, "ai:companyOverview", ai?.companyOverview, { moduleId: "business" });
  addNarrative(narratives, "ai:economicContext", ai?.economicContext, { moduleId: "business" });
  addNarrative(narratives, "ai:segmentAnalysis", ai?.segmentAnalysis, { moduleId: "business" });
  addNarrative(narratives, "ai:investmentThesis", ai?.investmentThesis, { moduleId: "thesis", role: "conclusion" });
  addNarrative(narratives, "ai:investmentConclusion", ai?.investmentConclusion, { moduleId: "thesis", role: "conclusion" });
  addNarrative(narratives, "ai:competitiveMoat", ai?.competitiveMoat, { moduleId: "moat" });
  addNarrative(narratives, "ai:revenueCommentary", ai?.revenueCommentary, { moduleId: "statements" });
  addNarrative(narratives, "ai:ebitdaCommentary", ai?.ebitdaCommentary, { moduleId: "statements" });
  addNarrative(narratives, "ai:ebitCommentary", ai?.ebitCommentary, { moduleId: "statements" });
  addNarrative(narratives, "ai:cashFlowCommentary", ai?.cashFlowCommentary, { moduleId: "statements" });
  addNarrative(narratives, "ai:quarterlyResultsCommentary", ai?.quarterlyResultsCommentary, { moduleId: "statements" });
  addNarrative(narratives, "ai:managementCommentary", ai?.managementCommentary, { moduleId: "management" });
  addNarrative(narratives, "ai:governanceCommentary", ai?.governanceCommentary, { moduleId: "management" });
  addNarrative(narratives, "ai:capitalAllocationCommentary", ai?.capitalAllocationCommentary, { moduleId: "management" });
  addNarrative(narratives, "ai:industryDynamicsCommentary", ai?.industryDynamicsCommentary, { moduleId: "business" });
  addNarrative(narratives, "ai:keyRisks", ai?.keyRisks?.map((risk) => `${risk.risk}: ${risk.description}`).join("\n"), { moduleId: "risk-catalyst", stance: "contradicts", targetClaimId: centralClaimId });
  addNarrative(narratives, "ai:enterpriseRiskCommentary", ai?.enterpriseRiskCommentary?.map((risk) => `${risk.risk}: ${risk.description}`).join("\n"), { moduleId: "risk-catalyst", stance: "contradicts", targetClaimId: centralClaimId });
  addNarrative(narratives, "ai:catalysts", ai?.catalysts?.map((catalyst) => `${catalyst.event}: ${catalyst.impact}`).join("\n"), { moduleId: "risk-catalyst" });

  if (research) {
    addNarrative(narratives, "research:businessModel", research.businessModel, { moduleId: "business" });
    addNarrative(narratives, "research:industryContext", research.industryContext, { moduleId: "business" });
    addNarrative(narratives, "research:historicalAnalysis", research.historicalAnalysis, { moduleId: "statements" });
    addNarrative(narratives, "research:thesis", research.thesis?.thesis, { moduleId: "thesis", role: "conclusion" });
    addNarrative(narratives, "research:bullCase", research.thesis?.bullCase?.join("\n"), { moduleId: "thesis", role: "conclusion" });
    addNarrative(narratives, "research:bearCase", research.thesis?.bearCase?.join("\n"), { moduleId: "thesis", role: "conclusion", stance: "contradicts", targetClaimId: centralClaimId });
    addNarrative(narratives, "research:conclusion", research.conclusion, { moduleId: "thesis", role: "conclusion" });
    addNarrative(narratives, "research:management", research.managementAnalysis, { moduleId: "management" });
    addNarrative(narratives, "research:capitalAllocation", research.capitalAllocation, { moduleId: "management" });
    addNarrative(narratives, "research:financialQuality", research.financialQuality, { moduleId: "statements" });
    addNarrative(narratives, "research:risks", research.risks?.map((risk) => `${risk.risk}: ${risk.mechanism} ${risk.financialConsequence}`).join("\n"), { moduleId: "risk-catalyst", stance: "contradicts", targetClaimId: centralClaimId });
    addNarrative(narratives, "research:catalysts", research.catalysts?.map((catalyst) => `${catalyst.catalyst}: ${catalyst.mechanism} ${catalyst.financialVariable}`).join("\n"), { moduleId: "risk-catalyst" });
  }

  const sectionByModule = new Map<string, string>();
  for (const section of report.composedReport?.sections ?? []) {
    for (const moduleId of section.modules) {
      if (!sectionByModule.has(moduleId)) sectionByModule.set(moduleId, section.id);
    }
  }
  for (const narrative of narratives) {
    if (!narrative.sectionId && narrative.moduleId) {
      const sectionId = sectionByModule.get(narrative.moduleId);
      if (sectionId) narrative.sectionId = sectionId;
    }
  }
  return narratives;
}

export function buildEvidenceGraphFromReportData(
  report: ReportData,
  options: { builtAt?: string } = {}
): EvidenceGraph | null {
  if (!report.researchCase) return null;
  return buildEvidenceGraph({
    researchCase: report.researchCase,
    sections: report.composedReport?.sections ?? null,
    modules: report.composedReport?.modules ?? null,
    narratives: collectReportNarratives(report),
    registry: report.evidenceRegistry ?? report.researchCase.evidence,
    builtAt: options.builtAt ?? report.generatedAt,
  });
}
