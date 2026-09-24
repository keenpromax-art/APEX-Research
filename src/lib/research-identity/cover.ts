import type {
  CoverSpec,
  EconomicIdentity,
  InvestorQuestion,
  MaterialityProfile,
  ResearchIdentitySource,
  SignatureAnalysis,
  ValuationIdentity,
} from "./types";
import type { indexResearchReferences } from "./evidence-profile";
import { makeEvidenceReferences, supportedReferences } from "./evidence-profile";

type Index = ReturnType<typeof indexResearchReferences>;

function limitText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function companyLabel(source: ResearchIdentitySource): string {
  const profile = source.researchCase.company;
  return profile.name || profile.ticker || "Company";
}

function titleForEconomic(economic: EconomicIdentity): string | null {
  switch (economic.type) {
    case "deposit-funded-bank":
      return "THE BALANCE-SHEET FRANCHISE";
    case "lending-spread-finance":
      return "THE CREDIT-CYCLE UNDERWRITING";
    case "underwriting-float-insurer":
      return "THE UNDERWRITING DISCIPLINE";
    case "subscription-platform":
      return "THE RECURRING-GROWTH ENGINE";
    case "transactional-platform":
      return "THE TRANSACTION ENGINE";
    case "branded-volume-business":
      return "THE VOLUME-PRICE-MIX COMPOUNDER";
    case "pipeline-research-business":
      return "THE PIPELINE OPTION VALUE";
    case "unit-volume-business":
      return "THE OPERATING-LEVERAGE ENGINE";
    case "project-pipeline-business":
      return "THE PROJECT-PIPELINE BACKLOG";
    case "contracted-asset-business":
      return "THE CONTRACTED-CASH-FLOW BASE";
    case "asset-backed-business":
      return "THE ASSET-BACKED RETURN";
    case "multi-segment-holding":
      return "THE SUM OF THE PARTS";
    case "cyclical-capital-business":
      return "THE CYCLE-NORMALIZED EARNINGS TEST";
    case "distressed-turnaround":
      return "THE TURNAROUND UNDERWRITING";
    default:
      return null;
  }
}

function subtitleFor(
  source: ResearchIdentitySource,
  question: InvestorQuestion,
  valuation: ValuationIdentity,
  signatures: SignatureAnalysis[]
): string | null {
  const parts: string[] = [];
  if (question.question) parts.push(limitText(question.question, 140));
  if (valuation.reverseCentral && valuation.reverseInterpretation) {
    parts.push(`Market-implied expectations: ${limitText(valuation.reverseInterpretation, 120)}`);
  }
  if (signatures.length > 0) {
    parts.push(`Signature: ${limitText(signatures[0].question, 120)}`);
  }
  if (parts.length === 0) return null;
  return parts.slice(0, 2).join(" · ");
}

export function buildCoverSpec(input: {
  source: ResearchIdentitySource;
  index: Index;
  economic: EconomicIdentity;
  question: InvestorQuestion;
  materiality: MaterialityProfile;
  valuation: ValuationIdentity;
  signatures: SignatureAnalysis[];
  coverStructure: CoverSpec["arrangement"];
}): CoverSpec {
  const { source, index, economic, question, valuation, signatures, coverStructure } = input;
  const proposal = source.proposal?.title;
  const proposalRefs = makeEvidenceReferences(
    (proposal?.evidenceIds ?? []).map((id) => ({ id, kind: "ai-fact" as const })),
    index,
    6
  );
  const proposalSupported = supportedReferences(proposalRefs).length > 0;
  const fallbackTitle = titleForEconomic(economic);
  const company = companyLabel(source);
  let title: string;
  let subtitle: string;
  if (proposal?.title && (proposalSupported || proposalRefs.length === 0)) {
    title = limitText(proposal.title, 90);
    subtitle = proposal.subtitle
      ? limitText(proposal.subtitle, 180)
      : subtitleFor(source, question, valuation, signatures) ?? `${company} — institutional equity research`;
  } else {
    title = fallbackTitle ?? `${company.toUpperCase()} — INSTITUTIONAL RESEARCH`;
    subtitle = subtitleFor(source, question, valuation, signatures) ?? `${company} — institutional equity research`;
  }
  const metricKeys = metricKeysFor(source, coverStructure);
  const references = [
    ...question.references.filter((r) => r.status === "supported").slice(0, 4),
    ...signatures.flatMap((s) => s.references).filter((r) => r.status === "supported").slice(0, 4),
  ].slice(0, 8);
  return {
    title,
    subtitle,
    eyebrow: `${source.researchCase.architecture.sectorName} · ${source.reportTypeId} · ${source.depth}`,
    investorQuestion: question.question,
    questionStatus: question.status,
    metricKeys,
    arrangement: coverStructure,
    emphasis: `${economic.type} viewed through ${question.type}; valuation lens ${valuation.type}.`,
    references,
  };
}

function metricKeysFor(source: ResearchIdentitySource, arrangement: CoverSpec["arrangement"]): string[] {
  const arch = source.researchCase.architecture.statementArchitecture;
  switch (arrangement) {
    case "segment-led":
      return ["segmentValue", "holdingDiscount", "fairValue", "upside"];
    case "recovery-led":
      return ["bearTarget", "baseTarget", "bullTarget", "netDebt", "liquidity"];
    case "valuation-led":
      return ["currentPrice", "fairValue", "upside", "impliedGrowth"];
    case "evidence-led":
      return ["currentPrice", "fairValue", "evidenceCoverage", "dataGrade"];
    case "question-led":
      return ["currentPrice", "fairValue", "upside", "roe", "fcfMargin"];
    default:
      if (arch === "B") return ["currentPrice", "fairValue", "roe", "nim", "assetQuality"];
      if (arch === "D") return ["currentPrice", "nav", "occupancy", "ffoYield"];
      return ["currentPrice", "fairValue", "upside", "roic", "fcfMargin"];
  }
}
