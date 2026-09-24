import { getStatementArchitecture } from "@/types/report";
import type {
  EconomicIdentity,
  IdentityClaim,
  IdentityEvidenceReference,
  ResearchIdentitySource,
} from "./types";
import {
  indexResearchReferences,
  makeEvidenceReferences,
  referenceCoverage,
  supportedReferences,
} from "./evidence-profile";
import type { EconomicIdentityType } from "./proposal";

type Index = ReturnType<typeof indexResearchReferences>;

function claim(
  value: string | null,
  rationale: string,
  references: IdentityEvidenceReference[],
  unavailableReason?: string
): IdentityClaim {
  const supported = supportedReferences(references);
  const status = supported.length > 0 ? "supported" : value ? "insufficient_evidence" : "unavailable";
  const confidence = Math.round(referenceCoverage(references) * 1000) / 1000;
  return {
    value,
    status,
    confidence,
    rationale: value ? rationale : unavailableReason ?? rationale,
    references,
  };
}

function latestPeriod(source: ResearchIdentitySource): string {
  const rows = source.researchCase.historicalFinancials ?? [];
  const latest = rows[rows.length - 1] as { fiscalYearEnd?: string; year?: string } | undefined;
  return latest?.fiscalYearEnd || latest?.year || source.researchCase.dataCutoff;
}

function canonicalRefs(
  source: ResearchIdentitySource,
  index: Index,
  fields: string[]
): IdentityEvidenceReference[] {
  const period = latestPeriod(source);
  return makeEvidenceReferences(
    fields.map((field) => ({
      id: `canonical:${index.ticker}:${field}:${period}`,
      kind: "canonical-fact" as const,
      source: "Canonical fact graph",
    })),
    index,
    fields.length
  );
}

function ontologyRef(source: ResearchIdentitySource, index: Index): IdentityEvidenceReference[] {
  return makeEvidenceReferences(
    [{ id: `derived:${index.ticker}:research:ontology`, kind: "derived-calculation" as const }],
    index,
    1
  );
}

function driverRefs(names: Array<{ sourceFacts?: string[] }>, index: Index): IdentityEvidenceReference[] {
  const ids = names.flatMap((d) => d.sourceFacts ?? []).filter(Boolean).slice(0, 8);
  return makeEvidenceReferences(ids.map((id) => ({ id, kind: "ai-fact" as const })), index, 8);
}

function extractFactRefs(texts: string[], index: Index): IdentityEvidenceReference[] {
  const joined = texts.join("\n");
  const matches = joined.match(/\[[A-Za-z]-.+?\]/g) ?? [];
  return makeEvidenceReferences(
    [...new Set(matches)].slice(0, 8).map((id) => ({ id, kind: "ai-fact" as const })),
    index,
    8
  );
}

function architectureOf(source: ResearchIdentitySource): string {
  const rows = source.researchCase.historicalFinancials ?? [];
  const latest = rows[rows.length - 1];
  return latest ? getStatementArchitecture(latest) : source.researchCase.architecture.statementArchitecture;
}

export function classifyEconomicIdentityType(source: ResearchIdentitySource): {
  type: EconomicIdentityType;
  rationale: string;
} {
  const rc = source.researchCase;
  const report = source.researchReport;
  const sectorId = rc.architecture.sectorId;
  const archetype = rc.architecture.financialArchetype;
  const segments = report?.companyUnderstanding?.businessSegments ?? [];
  const abstraction = (
    report?.economicEngine?.primaryAbstraction ??
    report?.companyUnderstanding?.primaryEconomicAbstraction ??
    ""
  ).toLowerCase();
  if (archetype === "DISTRESSED") return { type: "distressed-turnaround", rationale: "Distressed financial archetype controls the research question." };
  if (sectorId === "bank") return { type: "deposit-funded-bank", rationale: "Bank statement architecture and ontology identify a deposit-funded lender." };
  if (sectorId === "nbfc") return { type: "lending-spread-finance", rationale: "NBFC architecture identifies a lending-spread finance company." };
  if (sectorId === "insurance") return { type: "underwriting-float-insurer", rationale: "Insurance architecture identifies an underwriting and float business." };
  if (rc.valuation?.sotpBreakdown) return { type: "multi-segment-holding", rationale: "Canonical SOTP identifies separately valued operating segments." };
  if (segments.filter((s) => s.name && s.name.toLowerCase() !== "segment" && s.description).length >= 3) {
    return { type: "multi-segment-holding", rationale: "AI research identifies three or more substantive operating segments." };
  }
  if (sectorId === "technology-software" || sectorId === "internet-platform") {
    if (/advertis|query|order|gmv|transaction|marketplace|take-rate|take rate/.test(abstraction)) {
      return { type: "transactional-platform", rationale: "Platform abstraction is transaction or advertising driven." };
    }
    return { type: "subscription-platform", rationale: "Software or platform ontology identifies recurring subscription economics." };
  }
  if (sectorId === "asset-management" || sectorId === "ratings-agency") {
    return { type: "subscription-platform", rationale: "Fee-based asset-light ontology identifies recurring fee economics." };
  }
  if (sectorId === "consumer") return { type: "branded-volume-business", rationale: "Consumer ontology identifies branded volume, price and mix economics." };
  if (sectorId === "pharma") return { type: "pipeline-research-business", rationale: "Pharma ontology identifies research-pipeline economics." };
  if (sectorId === "auto" || sectorId === "cement" || sectorId === "agrochemical" || sectorId === "industrial") {
    return { type: "unit-volume-business", rationale: "Industrial ontology identifies unit-volume economics." };
  }
  if (sectorId === "renewable-energy") {
    if (/project|order|mw|pipeline|execution/.test(abstraction)) {
      return { type: "project-pipeline-business", rationale: "Renewable operating language identifies project-pipeline economics." };
    }
    return { type: "contracted-asset-business", rationale: "Renewable or utility operations identify contracted-asset economics." };
  }
  if (sectorId === "utilities" || sectorId === "telecom") {
    return { type: "contracted-asset-business", rationale: "Network or regulated-asset operations identify contracted economics." };
  }
  if (sectorId === "real-estate" && architectureOf(source) === "D") {
    return { type: "asset-backed-business", rationale: "REIT statement architecture identifies asset-backed rental economics." };
  }
  if (archetype === "CYCLICAL_CAPITAL_INTENSIVE") {
    return { type: "cyclical-capital-business", rationale: "Cyclical capital-intensive archetype controls the earnings interpretation." };
  }
  return { type: "diversified-corporate", rationale: "No specialized economic signature is supported by the available architecture." };
}

export function buildEconomicIdentity(
  source: ResearchIdentitySource,
  index: Index
): EconomicIdentity {
  const rc = source.researchCase;
  const report = source.researchReport;
  const understanding = report?.companyUnderstanding ?? null;
  const engine = report?.economicEngine ?? null;
  const classification = classifyEconomicIdentityType(source);
  const ontology = ontologyRef(source, index);
  const revenueRefs = [
    ...driverRefs(engine?.revenueDrivers ?? understanding?.revenueDrivers ?? [], index),
    ...canonicalRefs(source, index, ["revenue", "totalRevenue", "totalFeeRevenue", "rentalIncome", "grossWrittenPremium"]),
  ];
  const marginRefs = [
    ...driverRefs(engine?.marginDrivers ?? understanding?.marginDrivers ?? [], index),
    ...canonicalRefs(source, index, ["netIncome", "operatingIncome", "underwritingResult", "netOperatingIncome"]),
  ];
  const capitalRefs = [
    ...driverRefs(engine?.capitalDrivers ?? [], index),
    ...canonicalRefs(source, index, ["totalDebt", "totalEquity", "cash", "loans", "deposits"]),
  ];
  const competition = rc.competition?.moat ?? null;
  const competitiveRefs = competition?.sources?.length
    ? extractFactRefs(competition.sources.map((s) => `${s.source} ${s.evidence} ${s.chain ?? ""}`), index)
    : [];
  const pricingRefs = extractFactRefs(
    [
      ...(understanding?.competitiveAdvantages ?? []).map((a) => `${a.advantage} ${a.mechanism} ${a.evidence.join(" ")}`),
      competition?.verdict ?? "",
    ],
    index
  );
  const revenueEngine = engine?.primaryAbstraction || understanding?.primaryEconomicAbstraction || null;
  const marginEngine = engine?.marginDrivers?.[0]?.name || understanding?.marginDrivers?.[0]?.name || rc.ontology.standardMarginMetric;
  const capitalStructure = rc.architecture.isFinancialInstitution
    ? "Operating liabilities fund the balance sheet; equity and regulatory capital constrain growth."
    : "Funded debt, retained earnings and operating cash flow fund the asset base.";
  const competitive = competition?.verdict || understanding?.whyThisCompany || null;
  const pricing = pricingRefs.some((r) => r.status === "supported")
    ? understanding?.competitiveAdvantages?.[0]?.advantage ?? competition?.sources?.[0]?.source ?? null
    : null;
  const cyclicality = rc.architecture.financialArchetype === "CYCLICAL_CAPITAL_INTENSIVE"
    ? "Cyclical and capital-intensive earnings interpretation applies."
    : rc.architecture.financialArchetype === "DISTRESSED"
      ? "Distressed balance-sheet repair controls the earnings path."
      : "No cyclical override is supported by the financial archetype.";
  const regulatory = rc.architecture.isRegulatedSector
    ? `Regulated-sector interpretation applies to ${rc.architecture.sectorName}.`
    : "No sector-level regulatory override is supported.";
  const recurring = /recurr|subscri|arr|deposit|premium|lease|occupancy|ppa|annuity|fee/.test(
    `${revenueEngine ?? ""} ${(engine?.revenueDrivers ?? []).map((d) => `${d.name} ${d.mechanism}`).join(" ")}`.toLowerCase()
  )
    ? `Recurring-revenue interpretation is supported for ${revenueEngine ?? "the primary engine"}.`
    : null;
  const intensity = rc.ontology.capexDrivers.length > 0 ? `Capital intensity is assessed through ${rc.ontology.capexDrivers.join("; ")}.` : null;
  const allocation = rc.management?.capitalAllocation || null;
  const workingCapital = rc.ontology.nwcDrivers.length > 0 ? `Working-capital interpretation uses ${rc.ontology.nwcDrivers.join("; ")}.` : null;
  const financing = rc.architecture.isFinancialInstitution || rc.architecture.financialArchetype === "DISTRESSED"
    ? "Financing and balance-sheet capacity are central to the investment question."
    : null;
  const unitEconomics = rc.ontology.unitEconomics || null;
  const supportingReferences = [
    ...ontology,
    ...supportedReferences(revenueRefs).slice(0, 2),
    ...supportedReferences(marginRefs).slice(0, 2),
    ...supportedReferences(capitalRefs).slice(0, 2),
  ];
  const allClaims = [
    claim(revenueEngine, "Primary abstraction comes from AI research when grounded; otherwise ontology drivers apply.", revenueRefs, "Primary revenue engine is unavailable without AI research or ontology drivers."),
    claim(marginEngine, "Margin engine comes from AI research when grounded; otherwise the ontology margin metric applies.", marginRefs, "Margin engine is unavailable without AI research or canonical margins."),
    claim(capitalStructure, "Capital structure follows statement architecture and financial archetype.", [...ontology, ...capitalRefs], "Capital structure cannot be classified without architecture."),
    claim(competitive, "Competitive identity uses the AI moat verdict or company differentiator when grounded.", competitiveRefs, "Competitive identity is unavailable without moat or differentiator evidence."),
    claim(pricing, "Pricing power is stated only when competitive-advantage evidence cites facts.", pricingRefs, "Pricing power is insufficiently evidenced."),
    claim(cyclicality, "Cyclicality follows the deterministic financial archetype.", ontology, "Cyclicality is unavailable without an archetype."),
    claim(regulatory, "Regulatory dependence follows the deterministic regulated-sector flag.", ontology, "Regulatory status is unavailable."),
    claim(recurring, "Recurring-revenue language is accepted only when the economic engine supports it.", revenueRefs, "Recurring-revenue classification is insufficiently evidenced."),
    claim(intensity, "Capital intensity is framed through ontology capex drivers.", [...ontology, ...capitalRefs], "Capital intensity is unavailable without capex drivers."),
    claim(allocation, "Capital-allocation interpretation uses AI management research when present.", extractFactRefs([allocation ?? ""], index), "Capital-allocation posture is unavailable without management evidence."),
    claim(workingCapital, "Working-capital interpretation uses ontology NWC drivers when present.", ontology, "Working-capital drivers are unavailable."),
    claim(financing, "Financing dependence follows financial-institution or distressed status.", [...ontology, ...capitalRefs], "Financing dependence is not material on the available evidence."),
    claim(unitEconomics, "Unit economics use the ontology statement when available.", ontology, "Unit economics are unavailable."),
  ];
  const supportedCount = allClaims.filter((c) => c.status === "supported").length;
  return {
    type: classification.type,
    status: supportedCount > 0 ? "supported" : "insufficient_evidence",
    confidence: Math.round((supportedCount / allClaims.length) * 1000) / 1000,
    primaryRevenueEngine: allClaims[0],
    primaryMarginEngine: allClaims[1],
    capitalStructureIdentity: allClaims[2],
    competitiveIdentity: allClaims[3],
    pricingPower: allClaims[4],
    cyclicality: allClaims[5],
    regulatoryDependence: allClaims[6],
    recurringRevenue: allClaims[7],
    capitalIntensity: allClaims[8],
    capitalAllocationImportance: allClaims[9],
    workingCapitalImportance: allClaims[10],
    financingDependence: allClaims[11],
    unitEconomics: allClaims[12],
    supportingReferences,
  };
}
