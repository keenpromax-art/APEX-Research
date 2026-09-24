import type {
  EconomicIdentity,
  InvestorQuestion,
  ResearchIdentitySource,
} from "./types";
import { indexResearchReferences, makeEvidenceReferences } from "./evidence-profile";
import { INVESTOR_QUESTION_TYPES, type InvestorQuestionType } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

function limitText(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function questionEvidence(text: string, source: ResearchIdentitySource, index: Index) {
  const report = source.researchReport;
  const lower = text.toLowerCase();
  const ids: string[] = [];
  const engine = report?.economicEngine;
  const drivers = engine
    ? [...engine.revenueDrivers, ...engine.marginDrivers, ...engine.cashDrivers, ...engine.balanceSheetDrivers]
    : [];
  for (const driver of drivers) {
    const haystack = `${driver.name} ${driver.mechanism}`.toLowerCase();
    if (driver.name.length > 3 && (lower.includes(driver.name.toLowerCase()) || haystack.split(" ").some((w) => w.length > 5 && lower.includes(w)))) {
      ids.push(...(driver.sourceFacts ?? []));
    }
  }
  for (const item of report?.evidenceMap?.items ?? []) {
    const claim = `${item.claim} ${item.evidence}`.toLowerCase();
    if (item.claim.length > 12 && (lower.includes(item.claim.toLowerCase().slice(0, 24)) || claim.split(" ").some((w) => w.length > 6 && lower.includes(w)))) {
      ids.push(...item.factIds);
    }
  }
  for (const debate of report?.debates ?? []) {
    if (debate.debate && lower.includes(debate.debate.toLowerCase().slice(0, 32))) {
      ids.push(...debate.evidenceFor.flatMap((e) => e.factIds), ...debate.evidenceAgainst.flatMap((e) => e.factIds));
    }
  }
  return makeEvidenceReferences(
    [...new Set(ids)].slice(0, 10).map((id) => ({ id, kind: "ai-fact" as const })),
    index,
    10
  );
}

export function determineQuestionType(economic: EconomicIdentity, source: ResearchIdentitySource): InvestorQuestionType {
  const sectorId = source.researchCase.architecture.sectorId;
  const archetype = source.researchCase.architecture.financialArchetype;
  if (archetype === "DISTRESSED") return "turnaround-feasibility";
  if (economic.type === "deposit-funded-bank") return "balance-sheet-franchise";
  if (economic.type === "lending-spread-finance") return "credit-cycle";
  if (economic.type === "underwriting-float-insurer") return "balance-sheet-franchise";
  if (economic.type === "multi-segment-holding") return "segment-value";
  if (economic.type === "distressed-turnaround") return "turnaround-feasibility";
  if (economic.type === "cyclical-capital-business") return "cycle-normalization";
  if (economic.type === "subscription-platform" || economic.type === "transactional-platform") return "unit-economics";
  if (economic.type === "project-pipeline-business" || economic.type === "contracted-asset-business") return "capital-allocation";
  if (economic.type === "asset-backed-business") return "returns-durability";
  if (sectorId === "insurance") return "regulatory-capital";
  if (source.researchCase.catalysts.eventCategories.length > 0) return "event-resolution";
  return "growth-durability";
}

export function buildInvestorQuestion(
  source: ResearchIdentitySource,
  index: Index,
  economic: EconomicIdentity
): InvestorQuestion {
  const report = source.researchReport;
  const proposal = source.proposal?.investorQuestion;
  const proposalType = proposal?.type && (INVESTOR_QUESTION_TYPES as readonly string[]).includes(proposal.type)
    ? (proposal.type as InvestorQuestionType)
    : undefined;
  const proposalRefs = makeEvidenceReferences(
    (proposal?.evidenceIds ?? []).map((id) => ({ id, kind: "ai-fact" as const })),
    index,
    10
  );
  const proposalSupported = proposalRefs.filter((r) => r.status === "supported").length;
  if (proposal?.value && proposalType && (proposalSupported > 0 || proposalRefs.length === 0)) {
    const references = proposalSupported > 0 ? proposalRefs : questionEvidence(proposal.value, source, index);
    const supported = references.filter((r) => r.status === "supported").length;
    return {
      type: proposalType,
      status: supported > 0 ? "available" : "insufficient",
      question: limitText(proposal.value),
      rationale: proposal.rationale || "AI-proposed investor question, validated against research evidence.",
      references,
      confidence: supported > 0 ? 0.8 : 0.35,
    };
  }
  const valueQuestion = report?.economicEngine?.valueQuestions?.find((q) => q.trim().length > 12) ?? null;
  const debate = report?.debates?.[0] ?? null;
  const candidate = valueQuestion || debate?.debate || null;
  if (!report || !candidate) {
    return {
      type: "unknown",
      status: "unavailable",
      question: null,
      rationale: "No AI economic engine, debate or validated proposal is available; the central investor question is explicitly unavailable.",
      references: [],
      confidence: 0,
    };
  }
  const references = questionEvidence(candidate, source, index);
  const supported = references.filter((r) => r.status === "supported").length;
  return {
    type: determineQuestionType(economic, source),
    status: supported > 0 ? "available" : "insufficient",
    question: limitText(candidate),
    rationale: "Central question selected from the AI economic engine or central debate and tied to available evidence.",
    references,
    confidence: supported > 0 ? 0.72 : 0.35,
  };
}
