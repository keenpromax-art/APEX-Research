import type {
  ChartSelection,
  EconomicIdentity,
  InvestorQuestion,
  MaterialityProfile,
  ReportCompatibility,
  ResearchIdentitySource,
  SectionArchitecture,
  SectionPlan,
  SignatureAnalysis,
  TableSelection,
} from "./types";
import { indexResearchReferences } from "./evidence-profile";
import { SECTION_IDENTITY_HINTS, SECTION_RHYTHM } from "./registry";
import type { ResolvedSection } from "@/lib/report-types";
import type { MaterialityTier, MaterialityTopicId } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

function limitText(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function inferTopic(section: ResolvedSection): MaterialityTopicId {
  const hint = SECTION_IDENTITY_HINTS[section.id];
  if (hint) return hint.topicId;
  const text = `${section.id} ${section.title} ${section.modules.join(" ")}`.toLowerCase();
  if (/segment|sotp|holding|discount/.test(text)) return "segment-economics";
  if (/credit|capital|solvency|rating/.test(text)) return "balance-sheet";
  if (/risk|bear|bull/.test(text)) return "risks";
  if (/event|catalyst|disclosure/.test(text)) return "catalysts";
  if (/management|governance|ownership|allocation/.test(text)) return "management";
  if (/peer|comp/.test(text)) return "peers";
  if (/cash/.test(text)) return "cash-conversion";
  if (/income|revenue|growth|forecast/.test(text)) return "growth-engine";
  if (/valuation|method|thesis|debate|executive|cover/.test(text)) return "valuation-expectations";
  return "evidence";
}

function tierRank(tier: MaterialityTier): number {
  if (tier === "TIER_1_CORE") return 5;
  if (tier === "TIER_2_IMPORTANT") return 4;
  if (tier === "TIER_3_SUPPORTING") return 3;
  if (tier === "TIER_4_BACKGROUND") return 2;
  return 1;
}

export function evaluateReportTypeCompatibility(
  source: ResearchIdentitySource,
  economic: EconomicIdentity
): ReportCompatibility {
  const rc = source.researchCase;
  const reportTypeId = source.reportTypeId;
  const reasons: string[] = [];
  let status: ReportCompatibility["status"] = "supported";
  let capability = "Single-company canonical research case.";
  if (reportTypeId === "bank_v1" && rc.architecture.statementArchitecture !== "B") {
    status = "unsupported";
    reasons.push("Bank report requires depository statement architecture B.");
  }
  if (reportTypeId === "insurance_v1" && rc.architecture.statementArchitecture !== "C") {
    status = "unsupported";
    reasons.push("Insurance report requires insurance statement architecture C.");
  }
  if (reportTypeId === "reit_v1" && rc.architecture.statementArchitecture !== "D") {
    status = "unsupported";
    reasons.push("REIT report requires REIT statement architecture D.");
  }
  if (reportTypeId === "sotp_v1" && !rc.valuation?.sotpBreakdown) {
    status = "unsupported";
    reasons.push("SOTP report requires canonical segment valuation.");
  }
  if (reportTypeId === "portfolio_v1") {
    status = "limited";
    capability = "Single-company portfolio lens; no multi-holding dataset is available.";
    reasons.push("Portfolio report is limited to one holding because holdings data is unavailable.");
  }
  if (reportTypeId === "industry_v1") {
    status = "limited";
    capability = "Single-company industry lens; no industry-level dataset is available.";
    reasons.push("Industry report is limited because only one company's canonical dataset is available.");
  }
  if (reportTypeId === "special_situation_v1" && economic.type !== "distressed-turnaround" && rc.catalysts.eventCategories.length === 0) {
    status = "limited";
    reasons.push("Special-situation report is limited without distress or measured event evidence.");
  }
  if (status === "supported") reasons.push("Report-type capability matches the available canonical research case.");
  return { reportTypeId, status, capability, reasons };
}

function proposalDepth(source: ResearchIdentitySource, sectionId: string): number | null {
  const proposal = source.proposal?.sections?.find((s) => s.sectionId === sectionId);
  if (proposal?.depth === undefined || proposal.depth === null) return null;
  return Math.max(0, Math.min(5, Math.round(proposal.depth)));
}

export function buildSectionArchitecture(input: {
  source: ResearchIdentitySource;
  index: Index;
  economic: EconomicIdentity;
  materiality: MaterialityProfile;
  question: InvestorQuestion;
  signatures: SignatureAnalysis[];
  charts: ChartSelection;
  tables: TableSelection;
  outline: ResolvedSection[];
  compatibility: ReportCompatibility;
}): SectionArchitecture {
  const { source, materiality, signatures, charts, tables, outline } = input;
  const plans: SectionPlan[] = outline.map((section) => {
    const topicId = inferTopic(section);
    const assessment = materiality.assessments.find((a) => a.topicId === topicId);
    const hint = SECTION_IDENTITY_HINTS[section.id];
    const mandatory = hint?.mandatory ?? section.id === "cover";
    const matchedSignatures = signatures.filter(
      (s) => s.topicId === topicId || s.sectionId === section.id || s.title.toLowerCase().includes(section.title.toLowerCase().slice(0, 12))
    );
    let depth = (assessment?.depth ?? (mandatory ? 1 : 0)) as SectionPlan["depth"];
    if (matchedSignatures.length > 0 && depth > 0 && depth < 5) depth = Math.min(5, depth + 1) as SectionPlan["depth"];
    const proposed = proposalDepth(source, section.id);
    if (proposed !== null) depth = proposed as SectionPlan["depth"];
    const include = mandatory || depth > 0;
    const priority = tierRank(assessment?.tier ?? "TIER_5_SUPPRESS") * 100 + depth * 12 + matchedSignatures.length * 8 - (hint?.baseOrder ?? 50) / 100;
    return {
      sectionId: section.id,
      title: limitText(section.title),
      topicId,
      order: 0,
      depth,
      priority: Math.round(priority * 100) / 100,
      include,
      mandatory,
      signatureIds: matchedSignatures.map((s) => s.id),
      chartIds: [],
      tableIds: [],
      rationale: include
        ? `${assessment?.label ?? topicId} is ${assessment?.tier.replace(/_/g, " ").toLowerCase() ?? "suppressed"} at depth ${depth}.`
        : `${assessment?.label ?? topicId} is immaterial or unevidenced and is suppressed.`,
      rhythm: SECTION_RHYTHM[topicId],
      references: (assessment?.references ?? []).filter((r) => r.status === "supported").slice(0, 6),
    };
  });
  const identityOverview: SectionPlan = {
    sectionId: "identity-overview",
    title: "Central Investor Question",
    topicId: "valuation-expectations",
    order: 0,
    depth: input.question.status === "unavailable" ? 1 : 3,
    priority: 1000,
    include: true,
    mandatory: true,
    signatureIds: [],
    chartIds: [],
    tableIds: [],
    rationale: "Every adaptive report opens with its evidence-bound central question and identity spine.",
    rhythm: SECTION_RHYTHM["valuation-expectations"],
    references: input.question.references.filter((r) => r.status === "supported").slice(0, 6),
  };
  plans.push(identityOverview);
  if (signatures.length > 0) {
    const signatureTopic = signatures[0].topicId;
    const assessment = materiality.assessments.find((a) => a.topicId === signatureTopic);
    plans.push({
      sectionId: "signature-analysis",
      title: `Signature Analysis: ${limitText(signatures[0].title, 80)}`,
      topicId: signatureTopic,
      order: 0,
      depth: Math.max(3, Math.min(5, signatures[0].depth + 1)) as SectionPlan["depth"],
      priority: 900,
      include: true,
      mandatory: false,
      signatureIds: signatures.map((s) => s.id),
      chartIds: [],
      tableIds: [],
      rationale: `Signature analysis receives expanded space because ${assessment?.label ?? signatureTopic} is material.`,
      rhythm: SECTION_RHYTHM[signatureTopic],
      references: signatures.flatMap((s) => s.references).filter((r) => r.status === "supported").slice(0, 8),
    });
    for (const signature of signatures) {
      const match = plans.find((p) => signature.sectionId === p.sectionId) ??
        plans.find((p) => p.topicId === signature.topicId && p.include && p.sectionId !== "signature-analysis") ??
        plans.find((p) => p.sectionId === "signature-analysis");
      if (match && !match.signatureIds.includes(signature.id)) match.signatureIds.push(signature.id);
      signature.sectionId = match?.sectionId ?? "signature-analysis";
    }
  }
  for (const chart of charts.selected) {
    const target = plans.find((p) => p.sectionId === "signature-analysis" && chart.signatureIds.length > 0) ??
      plans.find((p) => p.topicId === chart.topicId && p.include) ??
      plans.find((p) => p.sectionId === "identity-overview");
    if (target) {
      chart.sectionId = target.sectionId;
      if (!target.chartIds.includes(chart.id)) target.chartIds.push(chart.id);
    }
  }
  for (const table of tables.selected) {
    const target = plans.find((p) => p.sectionId === "signature-analysis" && table.signatureIds.length > 0) ??
      plans.find((p) => p.topicId === table.topicId && p.include) ??
      plans.find((p) => p.sectionId === "identity-overview");
    if (target) {
      table.sectionId = target.sectionId;
      if (!target.tableIds.includes(table.id)) target.tableIds.push(table.id);
    }
  }
  const ordered = [...plans].sort((a, b) => {
    const aKey = (SECTION_IDENTITY_HINTS[a.sectionId]?.baseOrder ?? 50) - a.priority / 1000;
    const bKey = (SECTION_IDENTITY_HINTS[b.sectionId]?.baseOrder ?? 50) - b.priority / 1000;
    if (a.sectionId === "cover") return -1;
    if (b.sectionId === "cover") return 1;
    if (a.sectionId === "identity-overview") return -1;
    if (b.sectionId === "identity-overview") return 1;
    if (aKey !== bKey) return aKey - bKey;
    return a.sectionId.localeCompare(b.sectionId);
  });
  ordered.forEach((plan, position) => {
    plan.order = position + 1;
  });
  const included = ordered.filter((p) => p.include);
  const suppressed = ordered.filter((p) => !p.include);
  const coreTopics = materiality.coreTopics.join(", ") || "no Tier 1 topic";
  return {
    status: included.length > 0 ? "available" : "unavailable",
    sections: ordered,
    included,
    suppressed,
    orderingRationale: `Sections are ordered by deterministic materiality and depth; core topics are ${coreTopics}. Compatibility is ${input.compatibility.status}.`,
  };
}
