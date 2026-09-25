/**
 * APEX RESEARCH — ResearchCase builder (Phase 1)
 * -----------------------------------------------
 * Assembles the report-agnostic ResearchCase from objects the existing
 * pipeline already produces. The builder:
 *
 *  - REFERENCES caller-supplied canonical objects (facts, ledger, valuation,
 *    evidence) — it never copies or recomputes them;
 *  - DERIVES only missing optional pieces via the EXISTING engines
 *    (buildCanonicalFacts, createAssumptionsLedger, buildScenarioSet,
 *    buildEvidenceRegistryFromInputs, assessDataConfidence) — never a second
 *    implementation;
 *  - NEVER invents missing information: gaps become `null`, empty lists, or
 *    explicit `ResearchUnknown` / data-quality blocker entries;
 *  - never mutates its inputs and never throws for absent optional data
 *    (missing profile/stockData is a contract violation and does throw).
 */
import type {
  AnnualFinancials,
  AssumptionsLedger,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
  StatementArchitecture,
} from "@/types/report";
import { getStatementArchitecture, stmtNum } from "@/types/report";
import type { CanonicalFactGraph } from "@/lib/canonical-facts";
import { buildCanonicalFacts, sealCanonicalFacts } from "@/lib/canonical-facts";
import type { EvidenceRegistry } from "@/lib/evidence-registry";
import { buildEvidenceRegistryFromInputs } from "@/lib/evidence-registry";
import type { DataConfidenceReport } from "@/lib/data-confidence";
import { assessDataConfidence } from "@/lib/data-confidence";
import type { ScenarioSet } from "@/lib/scenarios";
import { buildScenarioSet } from "@/lib/scenarios";
import type { CompanyOntology } from "@/lib/company-ontology";
import { buildCompanyOntology } from "@/lib/company-ontology";
import { classifyArchetype } from "@/lib/company-archetype";
import { createAssumptionsLedger } from "@/lib/assumptions-ledger";
import { getArchitectureForSector } from "@/lib/sectors/architectures";
import { gatePeerSet } from "@/lib/peer-similarity";
import {
  assessResearchComplexity,
  isRegulatedSectorId,
} from "./complexity";
import {
  RESEARCH_CASE_VERSION,
  type AccountingResearch,
  type BuildResearchCaseParams,
  type CatalystResearch,
  type CompetitionResearch,
  type DataQualityAssessment,
  type IndustryResearch,
  type ManagementResearch,
  type PeerSet,
  type ResearchArchitecture,
  type ResearchCase,
  type ResearchUnknown,
  type RiskResearch,
} from "./types";

// FNV-1a — stable case IDs across runs when dataCutoff is pinned.
function fnv1a(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function isCrossListed(profile: BuildResearchCaseParams["profile"]): boolean {
  if (profile.crossListingNote) return true;
  if (typeof profile.depositaryRatio === "number" && profile.depositaryRatio > 0 && profile.depositaryRatio !== 1) return true;
  if (
    profile.reportingCurrency &&
    profile.tradingCurrency &&
    profile.reportingCurrency.toUpperCase() !== profile.tradingCurrency.toUpperCase()
  ) {
    return true;
  }
  if (typeof profile.fxReportingToTrading === "number" && profile.fxReportingToTrading !== 1) return true;
  return false;
}

function collectEstimatedFields(rows: AnnualFinancials[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const tag of row.estimatesUsed ?? []) out.push(tag);
  }
  return uniq(out);
}

function hasIntangibles(latest: AnnualFinancials | undefined): boolean {
  if (!latest) return false;
  return stmtNum(latest, "goodwill") > 0 || stmtNum(latest, "otherIntangibles") > 0;
}

function buildArchitecture(
  ontology: CompanyOntology,
  profile: BuildResearchCaseParams["profile"],
  latest: AnnualFinancials | undefined
): ResearchArchitecture {
  // Prefer the actual statement row (REIT-vs-developer split lives there);
  // fall back to the sector registry when no history exists.
  const statementArchitecture: StatementArchitecture = latest
    ? getStatementArchitecture(latest)
    : getArchitectureForSector(ontology.sectorId).arch;
  return {
    sectorId: ontology.sectorId,
    sectorName: ontology.sectorName,
    industry: profile.industry || "",
    subSector: ontology.subSector,
    operatingArchetype: ontology.operatingArchetype,
    financialArchetype: ontology.financialArchetype,
    statementArchitecture,
    isFinancialInstitution: ontology.isFinancialInstitution,
    isRegulatedSector: isRegulatedSectorId(ontology.sectorId),
    segments: [...ontology.segments],
    valuationMethods: ontology.valuationMethods,
    allowedKPIs: [...ontology.kpis],
    forbiddenConcepts: [...ontology.forbiddenConcepts],
    requiredConcepts: [...ontology.requiredConcepts],
  };
}

function buildPeers(peers: PeerData[], ontology: CompanyOntology): PeerSet {
  const gate = gatePeerSet(peers);
  return {
    peers,
    curatedUniverse: [...ontology.competitors],
    gate,
    available: peers.length > 0,
  };
}

function buildManagement(params: BuildResearchCaseParams): ManagementResearch {
  const rr = params.researchReport ?? null;
  const ai = params.aiAnalysis ?? null;
  const officers = [...(params.profile.officers ?? [])];
  const managementAnalysis = rr?.managementAnalysis ?? null;
  const governance = ai?.governanceCommentary ?? null;
  const capitalAllocation = rr?.capitalAllocation ?? ai?.capitalAllocationCommentary ?? null;
  return {
    available: Boolean(managementAnalysis || governance || capitalAllocation || officers.length > 0),
    officers,
    managementAnalysis,
    governance,
    capitalAllocation,
  };
}

function buildCompetition(params: BuildResearchCaseParams, ontology: CompanyOntology): CompetitionResearch {
  const rr = params.researchReport ?? null;
  const competitiveAnalysis = rr?.competitiveAnalysis ?? null;
  const moat = rr?.moat ?? null;
  return {
    available: Boolean(competitiveAnalysis || moat),
    competitiveAnalysis,
    moat,
    curatedUniverse: [...ontology.competitors],
  };
}

function buildIndustry(params: BuildResearchCaseParams, ontology: CompanyOntology): IndustryResearch {
  const rr = params.researchReport ?? null;
  const sectorProfile = {
    allowedKPIs: ontology.kpis,
    forbiddenConcepts: ontology.forbiddenConcepts,
    requiredConcepts: ontology.requiredConcepts,
    standardMarginMetric: ontology.standardMarginMetric,
  };
  const industryContext = rr?.industryContext ?? rr?.companyUnderstanding?.industryContext ?? null;
  return {
    available: Boolean(industryContext) || ontology.sectorId !== "general",
    industryContext,
    sectorProfile,
    revenueDrivers: [...ontology.revenueDrivers],
    costDrivers: [...ontology.costDrivers],
  };
}

function buildAccounting(params: BuildResearchCaseParams, estimatedFields: string[]): AccountingResearch {
  const financialQuality = params.researchReport?.financialQuality ?? null;
  return {
    available: Boolean(financialQuality) || estimatedFields.length > 0,
    financialQuality,
    estimatedFields,
  };
}

function buildCatalysts(params: BuildResearchCaseParams): CatalystResearch {
  const catalysts = [...(params.researchReport?.catalysts ?? [])];
  const eventCategories = uniq(
    (params.eventPriceMovements ?? []).map((e) => String(e.category ?? "")).filter(Boolean)
  );
  return {
    available: catalysts.length > 0 || eventCategories.length > 0,
    catalysts,
    eventCategories,
  };
}

function buildRisks(params: BuildResearchCaseParams): RiskResearch {
  const risks = [...(params.researchReport?.risks ?? [])];
  return { available: risks.length > 0, risks };
}

function buildUnknowns(args: {
  planUnknowns: string[];
  epistemicUnknowns: string[];
  dataGapStatements: string[];
}): ResearchUnknown[] {
  const statements = uniq([...args.planUnknowns, ...args.epistemicUnknowns, ...args.dataGapStatements]);
  return statements.map((statement, idx) => {
    const fromPlan = args.planUnknowns.some((u) => u.trim().toLowerCase() === statement.toLowerCase());
    const fromEpistemic = args.epistemicUnknowns.some((u) => u.trim().toLowerCase() === statement.toLowerCase());
    const source = fromPlan ? "planner" : fromEpistemic ? "epistemic" : "data-gap";
    return { id: `U${String(idx + 1).padStart(3, "0")}`, statement, source } satisfies ResearchUnknown;
  });
}

function buildDataQuality(args: {
  grade: DataQualityAssessment["grade"];
  confidence: DataConfidenceReport | null;
  missingCanonicalFields: string[];
  estimatedFields: string[];
  availability: DataQualityAssessment["availability"];
  annualCount: number;
  quarterCount: number;
}): DataQualityAssessment {
  const { availability } = args;
  const blockers: string[] = [];
  if (args.annualCount === 0) blockers.push("NO_ANNUAL_FINANCIALS");
  if (args.quarterCount === 0) blockers.push("NO_QUARTERLY_FINANCIALS");
  if (!availability.canonicalFacts) blockers.push("NO_CANONICAL_FACTS");
  if (!availability.valuation) blockers.push("NO_VALUATION");
  if (!availability.assumptionsLedger) blockers.push("NO_ASSUMPTIONS_LEDGER");
  if (!availability.scenarios) blockers.push("NO_SCENARIOS");
  if (!availability.evidence) blockers.push("NO_EVIDENCE_REGISTRY");
  if (args.grade === "D") blockers.push("DATA_GRADE_D");
  if (args.grade === "N/A" && availability.canonicalFacts && availability.valuation) {
    blockers.push("DATA_CONFIDENCE_UNAVAILABLE");
  }
  return {
    grade: args.grade,
    confidence: args.confidence,
    missingCanonicalFields: args.missingCanonicalFields,
    estimatedFields: args.estimatedFields,
    estimatedFieldCount: args.estimatedFields.length,
    availability,
    blockers,
  };
}

function deriveScenarios(ledger: AssumptionsLedger | null, currentPrice: number): ScenarioSet | null {
  if (!ledger?.scenarios?.base?.targetPrice) return null;
  // Same derivation path as report-facts.ts — one ScenarioSet math, not two.
  return buildScenarioSet({
    currentPrice: currentPrice || ledger.currentPrice || 0,
    baseTargetPrice: ledger.scenarios.base.targetPrice,
    bullTarget: ledger.scenarios.bull?.targetPrice,
    bearTarget: ledger.scenarios.bear?.targetPrice,
    bullMultiplier: 1.25,
    bearMultiplier: 0.75,
  });
}

export function buildResearchCase(params: BuildResearchCaseParams): ResearchCase {
  const { profile, stockData } = params;
  if (!profile || typeof profile.ticker !== "string" || !profile.ticker.trim()) {
    throw new Error("buildResearchCase: profile.ticker is required");
  }
  if (!stockData || typeof stockData !== "object") {
    throw new Error("buildResearchCase: stockData is required");
  }

  const createdAt = params.createdAt ?? new Date().toISOString();
  const annualFinancials: AnnualFinancials[] = params.annualFinancials ? [...params.annualFinancials] : [];
  const quarterlyFinancials: QuarterlyFinancials[] = params.quarterlyFinancials ? [...params.quarterlyFinancials] : [];
  const latest = annualFinancials[annualFinancials.length - 1];

  const provided: string[] = ["profile", "stockData"];
  const derived: string[] = [];
  if (params.annualFinancials) provided.push("annualFinancials");
  if (params.quarterlyFinancials) provided.push("quarterlyFinancials");
  if (params.ontology) provided.push("ontology");
  if (params.canonicalFacts) provided.push("canonicalFacts");
  if (params.assumptionsLedger) provided.push("assumptionsLedger");
  if (params.valuation) provided.push("valuation");
  if (params.scenarios) provided.push("scenarios");
  if (params.peers) provided.push("peers");
  if (params.evidence) provided.push("evidence");
  if (params.dataConfidence) provided.push("dataConfidence");
  if (params.researchReport) provided.push("researchReport");
  if (params.researchPlan) provided.push("researchPlan");
  if (params.aiAnalysis) provided.push("aiAnalysis");
  if (params.eventPriceMovements) provided.push("eventPriceMovements");

  // ── Ontology / architecture (existing classifiers, deterministic) ──
  const archetypeProfile = classifyArchetype(profile, stockData, annualFinancials);
  const ontology =
    params.ontology ??
    (() => {
      derived.push("ontology");
      return buildCompanyOntology(profile, archetypeProfile);
    })();
  const architecture = buildArchitecture(ontology, profile, latest);

  // ── Canonical facts — reference if given, else existing engine + seal ──
  let canonicalFacts: CanonicalFactGraph | null = params.canonicalFacts ?? null;
  if (!canonicalFacts) {
    try {
      canonicalFacts = sealCanonicalFacts(
        buildCanonicalFacts({
          profile,
          stockData,
          annualFinancials,
          asOf: params.dataCutoff ?? createdAt,
        })
      );
      derived.push("canonicalFacts");
    } catch {
      canonicalFacts = null;
    }
  }

  // ── Valuation reference (never recomputed) ──
  const valuation: DCFResult | null = params.valuation ?? null;

  // ── Assumptions ledger ──
  let assumptionsLedger: AssumptionsLedger | null = params.assumptionsLedger ?? null;
  if (!assumptionsLedger && valuation) {
    try {
      assumptionsLedger = createAssumptionsLedger({
        profile,
        stockData,
        annualFinancials,
        dcf: valuation,
      });
      derived.push("assumptionsLedger");
    } catch {
      assumptionsLedger = null;
    }
  }

  // ── Scenarios — same path as report-facts.ts ──
  let scenarios: ScenarioSet | null = params.scenarios ?? null;
  if (!scenarios && assumptionsLedger) {
    scenarios = deriveScenarios(assumptionsLedger, stockData.currentPrice || assumptionsLedger.currentPrice || 0);
    if (scenarios) derived.push("scenarios");
  }

  // ── Evidence registry ──
  let evidence: EvidenceRegistry | null = params.evidence ?? null;
  if (!evidence) {
    try {
      evidence = buildEvidenceRegistryFromInputs({
        annualFinancials,
        stockData,
        dcf: valuation ?? undefined,
        asOf: params.dataCutoff ?? createdAt,
        currency: profile.currency,
        scale: canonicalFacts?.scale,
      });
      derived.push("evidence");
    } catch {
      evidence = null;
    }
  }

  // ── Data confidence ──
  let dataConfidence: DataConfidenceReport | null = params.dataConfidence ?? null;
  if (!dataConfidence && valuation) {
    try {
      dataConfidence = assessDataConfidence({
        stockData,
        annualFinancials,
        dcf: valuation,
        aiOverridesUsed: false,
      });
      derived.push("dataConfidence");
    } catch {
      dataConfidence = null;
    }
  }

  const estimatedFields = collectEstimatedFields(annualFinancials);
  const peers = buildPeers(params.peers ? [...params.peers] : [], ontology);

  // ── Research domains (optional AI research — nulls stay null) ──
  const management = buildManagement(params);
  const competition = buildCompetition(params, ontology);
  const industry = buildIndustry(params, ontology);
  const accounting = buildAccounting(params, estimatedFields);
  const catalysts = buildCatalysts(params);
  const risks = buildRisks(params);

  // ── Questions & unknowns — honest gaps only ──
  const researchQuestions = [...(params.researchPlan?.questions ?? [])];
  const planUnknowns = params.researchPlan?.unknowns ?? [];
  const epistemicUnknowns = params.researchReport?.companyUnderstanding?.epistemic?.unknowns ?? [];
  const dataGapStatements: string[] = [];
  if (annualFinancials.length === 0) dataGapStatements.push("No annual financial history available.");
  if (quarterlyFinancials.length === 0) dataGapStatements.push("No quarterly financial history available.");
  if (!valuation) dataGapStatements.push("Valuation model not available for this case.");
  if (!canonicalFacts) dataGapStatements.push("Canonical fact graph could not be built.");
  else if (canonicalFacts.missing.length > 0) {
    const shown = canonicalFacts.missing.slice(0, 12).join(", ");
    const more = canonicalFacts.missing.length > 12 ? ` (+${canonicalFacts.missing.length - 12} more)` : "";
    dataGapStatements.push(`Missing canonical fields: ${shown}${more}.`);
  }
  if (!params.researchReport) dataGapStatements.push("AI research report not available (narrative domains unevaluated).");

  const unknowns = buildUnknowns({ planUnknowns, epistemicUnknowns, dataGapStatements });

  const availability: DataQualityAssessment["availability"] = {
    canonicalFacts: Boolean(canonicalFacts),
    assumptionsLedger: Boolean(assumptionsLedger),
    valuation: Boolean(valuation),
    scenarios: Boolean(scenarios),
    evidence: Boolean(evidence),
    dataConfidence: Boolean(dataConfidence),
    researchReport: Boolean(params.researchReport),
  };

  const dataQuality = buildDataQuality({
    grade: dataConfidence?.grade ?? "N/A",
    confidence: dataConfidence,
    missingCanonicalFields: canonicalFacts ? [...canonicalFacts.missing] : [],
    estimatedFields,
    availability,
    annualCount: annualFinancials.length,
    quarterCount: quarterlyFinancials.length,
  });

  // ── Deterministic complexity ──
  const complexity = assessResearchComplexity({
    segmentCount: architecture.segments.length,
    geographyCount: isCrossListed(profile) ? 2 : 1,
    crossListed: isCrossListed(profile),
    statementArchitecture: architecture.statementArchitecture,
    isFinancialInstitution: architecture.isFinancialInstitution,
    operatingArchetype: architecture.operatingArchetype,
    financialArchetype: architecture.financialArchetype,
    totalDebt: latest ? stmtNum(latest, "totalDebt") : 0,
    totalEquity: latest ? stmtNum(latest, "totalEquity") : 0,
    hasGoodwillOrIntangibles: hasIntangibles(latest),
    isRegulatedSector: architecture.isRegulatedSector,
    historyYears: annualFinancials.length,
    quarterCount: quarterlyFinancials.length,
    peerCount: peers.peers.length,
    peersSuppressed: peers.gate.suppress,
    dataGrade: dataQuality.grade,
    estimatedFieldCount: estimatedFields.length,
    missingFactCount: dataQuality.missingCanonicalFields.length,
    hasCanonicalFacts: availability.canonicalFacts,
  });

  const dataCutoff =
    params.dataCutoff ?? canonicalFacts?.asOf ?? createdAt;
  const modelVersion = params.modelVersion ?? "apex-financial-model-v1";

  const caseId = `RC-${profile.ticker.toUpperCase()}-${fnv1a(
    `${profile.ticker.toUpperCase()}|${dataCutoff}|${modelVersion}|${RESEARCH_CASE_VERSION}`
  )}`;

  // AI confidence only when the research report supplied it — never synthesized.
  const confidence = params.researchReport?.companyUnderstanding?.confidence ?? null;

  return {
    caseId,
    version: RESEARCH_CASE_VERSION,
    company: profile,
    stock: stockData,
    architecture,
    historicalFinancials: annualFinancials,
    quarterlyFinancials,
    ontology,
    canonicalFacts,
    assumptionsLedger,
    valuation,
    scenarios,
    peers,
    evidence,
    management,
    competition,
    industry,
    accounting,
    catalysts,
    risks,
    researchQuestions,
    unknowns,
    dataQuality,
    confidence,
    complexity,
    provenance: { provided, derived },
    createdAt,
    dataCutoff,
    modelVersion,
  };
}
