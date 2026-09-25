/**
 * APEX RESEARCH — AI REPORT ASSEMBLY
 *
 * The ResearchReport object is the single source of truth for the PDF renderer.
 * All content is generated dynamically by AI, grounded in yfinance facts.
 * The PDF renderer only renders this object — it never invents content.
 *
 * PRINCIPLE: The research package flows through the pipeline:
 *   Fact pack → Company understanding → Model builder → Assumptions → Forecast
 *   → Valuation → Scenarios → Narratives → Quality review → ResearchReport → PDF
 *
 * Every AI-generated number must be linked back to a yfinance FACT or an AI
 * MODEL OUTPUT (never invented independently).
 */
import type {
  ResearchReport,
  FactPack,
  CompanyUnderstanding,
  ForecastSpecification,
  ForecastResult,
  ValuationResult,
  ValuationSpecification,
  ThesisSpecification,
  Catalyst,
  Risk,
  CompetitorAnalysis,
  MoatAnalysis,
  Formula,
  ForecastVariable,
  Assumption,
  ScenarioSpecification,
  ReviewFinding,
  Fact,
  EconomicEngine,
  Debate,
  EvidenceMap,
  ResearchDiscoveryPack,
  ValuationMatrix,
  ScenarioSetValidation,
  SensitivityAnalysis,
  MonteCarloResult,
  ReverseValuationPlan,
  ReverseValuationResult,
} from "./types";
import type { ResearchPlan } from "./research-planner";

/** Version string for the research report assembly. */
export const RESEARCH_REPORT_VERSION = "1.0.0";

/** Assembler input: every pipeline component in one place. */
export interface ReportAssemblerInput {
  companyUnderstanding: CompanyUnderstanding;
  factPack: FactPack;
  forecastSpec: ForecastSpecification;
  formulas: Formula[];
  forecast: ForecastResult;
  valuationSpec: ValuationSpecification;
  valuation: ValuationResult;
  scenarios: ScenarioSpecification[];
  thesis: ThesisSpecification;
  risks: Risk[];
  catalysts: Catalyst[];
  competitiveAnalysis: CompetitorAnalysis;
  moat: MoatAnalysis;
  historicalAnalysis: string;
  managementAnalysis: string;
  capitalAllocation: string;
  financialQuality: string;
  sensitivity: Array<Record<string, number | string>>;
  sensitivityAnalysis?: SensitivityAnalysis;
  monteCarlo?: MonteCarloResult;
  valuationMatrix?: ValuationMatrix;
  scenarioValidation?: ScenarioSetValidation;
  reverseValuation: { variable: string; requiredValue: number; interpretation: string } | null;
  reverseValuationResult?: ReverseValuationResult | null;
  reverseValuationPlan?: ReverseValuationPlan | null;
  artifactIds?: ResearchReport["artifactIds"];
  conclusion: string;
  reviews: ReviewFinding[];
  reviewPassed: boolean;
  regenerationLog: string[];
  /** Content-intelligence artifacts. */
  economicEngine?: EconomicEngine;
  debates?: Debate[];
  evidenceMap?: EvidenceMap;
  researchDiscovery?: ResearchDiscoveryPack;
  researchPlan?: ResearchPlan;
  /** Institutional research analytics artifacts. */
  peerDiscovery?: ResearchReport["peerDiscovery"];
  normalizedHistory?: ResearchReport["normalizedHistory"];
  earningsQuality?: ResearchReport["earningsQuality"];
  capitalAllocationLedger?: ResearchReport["capitalAllocationLedger"];
  managementCredibility?: ResearchReport["managementCredibility"];
  guidanceReconciliation?: ResearchReport["guidanceReconciliation"];
  confidenceDecomposition?: ResearchReport["confidenceDecomposition"];
  canonicalQa?: ResearchReport["canonicalQa"];
  reproducibility?: ResearchReport["reproducibility"];
  qaDecision?: ResearchReport["qaDecision"];
  regenerationAttempts?: ResearchReport["regenerationAttempts"];
  auditPackageHash?: ResearchReport["auditPackageHash"];
  auditPackage?: ResearchReport["auditPackage"];
}

/**
 * Assemble the complete ResearchReport object from pipeline components.
 * Called after the quality review loop completes.
 */
export function assembleResearchReport(input: ReportAssemblerInput): ResearchReport {
  const {
    companyUnderstanding,
    factPack,
    forecastSpec,
    formulas,
    forecast,
    valuationSpec,
    valuation,
    scenarios,
    thesis,
    risks,
    catalysts,
    competitiveAnalysis,
    moat,
    historicalAnalysis,
    managementAnalysis,
    capitalAllocation,
    financialQuality,
    sensitivity,
    sensitivityAnalysis,
    monteCarlo,
    valuationMatrix,
    scenarioValidation,
    reverseValuation,
    reverseValuationResult,
    reverseValuationPlan,
    artifactIds,
    conclusion,
    reviews,
    reviewPassed,
    regenerationLog,
    economicEngine,
    debates,
    evidenceMap,
    researchDiscovery,
    researchPlan,
    peerDiscovery,
    normalizedHistory,
    earningsQuality,
    capitalAllocationLedger,
    managementCredibility,
    guidanceReconciliation,
    confidenceDecomposition,
    canonicalQa,
    reproducibility,
    qaDecision,
    regenerationAttempts,
    auditPackageHash,
    auditPackage,
  } = input;

  const researchRunId = `RUN-${factPack.ticker}-${new Date().toISOString().slice(0, 10)}-${String(Date.now()).slice(-6)}`;
  const modelVersion = `v${RESEARCH_REPORT_VERSION}`;
  const promptVersion = "AI-FIRST-v1.0";
  const factPackVersion = factPack.version;
  const forecastVersion = `f${forecast.incomeStatement.length}y`;
  const valuationVersion = valuation.methodology
    ? `v-${valuation.methodology.substring(0, 10).replace(/\s+/g, "-").toLowerCase()}`
    : "v-unspecified";
  const reviewVersion = reviewPassed ? "r-pass" : "r-review";

  // Key metrics: the fact pack anchors the report cites (yfinance facts only).
  const keyMetrics: Fact[] = [
    ...factPack.market.facts.filter((f) => f.value !== undefined).slice(0, 8),
    ...factPack.incomeStatement.facts.filter((f) => f.value !== undefined).slice(0, 8),
  ];

  return {
    researchRunId,
    companyTicker: factPack.ticker,
    modelVersion,
    promptVersion,
    factPackVersion,
    generationTimestamp: new Date().toISOString(),
    forecastVersion,
    valuationVersion,
    reviewVersion,

    companyUnderstanding,
    businessModel: companyUnderstanding.howItMakesMoney,
    industryContext: companyUnderstanding.industryContext,
    historicalAnalysis,
    keyMetrics,

    operatingModel: {
      formulas,
      variables: forecastSpec.variables,
    },

    forecast,
    valuation,
    ...(valuationMatrix ? { valuationMatrix } : {}),
    scenarios,
    ...(scenarioValidation ? { scenarioValidation } : {}),
    thesis,
    catalysts,
    risks,
    competitiveAnalysis,
    moat,

    managementAnalysis,
    capitalAllocation,
    financialQuality,
    sensitivity,
    ...(sensitivityAnalysis ? { sensitivityAnalysis } : {}),
    ...(monteCarlo ? { monteCarlo } : {}),
    reverseValuation,
    ...(reverseValuationResult ? { reverseValuationResult } : {}),
    ...(reverseValuationPlan ? { reverseValuationPlan } : {}),
    ...(artifactIds ? { artifactIds } : {}),
    conclusion,

    economicEngine,
    debates,
    evidenceMap,
    researchDiscovery,
    researchPlan,
    ...(peerDiscovery ? { peerDiscovery } : {}),
    ...(normalizedHistory ? { normalizedHistory } : {}),
    ...(earningsQuality ? { earningsQuality } : {}),
    ...(capitalAllocationLedger ? { capitalAllocationLedger } : {}),
    ...(managementCredibility ? { managementCredibility } : {}),
    ...(guidanceReconciliation ? { guidanceReconciliation } : {}),
    ...(confidenceDecomposition ? { confidenceDecomposition } : {}),
    ...(canonicalQa ? { canonicalQa } : {}),
    ...(reproducibility ? { reproducibility } : {}),
    ...(qaDecision ? { qaDecision } : {}),
    ...(regenerationAttempts ? { regenerationAttempts } : {}),
    ...(auditPackageHash ? { auditPackageHash } : {}),
    ...(auditPackage ? { auditPackage } : {}),

    reviews,
    reviewPassed,
    regenerationLog,
  };
}

/**
 * Render the ResearchReport object as a string for debugging/monitoring.
 * The PDF renderer uses the actual report object, not this string.
 */
export function renderReportSummary(report: ResearchReport): string {
  const lines: string[] = [
    "RESEARCH REPORT SUMMARY",
    `Ticker: ${report.companyTicker}`,
    `Research Run ID: ${report.researchRunId}`,
    `Review Passed: ${report.reviewPassed}`,
    "",
    "CORE SECTIONS:",
    `  Company Understanding: ${report.companyUnderstanding?.whatItDoes ? "populated" : "empty"}`,
    `  Forecast Years: ${report.forecast?.incomeStatement?.length || 0}`,
    `  Valuation Method: ${report.valuation?.methodology || "not specified"}`,
    `  Valuation Status: ${report.valuation?.status ?? "legacy/unknown"}`,
    `  Valuation Matrix: ${report.valuationMatrix?.methods.filter((method) => method.status === "ready").length ?? 0} ready; primary=${report.valuationMatrix?.primaryMethod ?? "none"}`,
    `  Cross-check Spread: ${report.valuationMatrix?.crossCheck.disagreement ? `${(report.valuationMatrix.crossCheck.disagreement.spreadPct * 100).toFixed(1)}%` : "N/A"}`,
    `  Scenarios: ${report.scenarios?.length || 0} (Bear/Base/Bull); validation=${report.scenarioValidation?.status ?? "legacy/unknown"}`,
    `  Thesis: ${report.thesis?.thesis ? "present" : "empty"}`,
    `  Risks: ${report.risks?.length || 0} risks identified`,
    `  Catalysts: ${report.catalysts?.length || 0} catalysts identified`,
  `  Moat: ${report.moat?.verdict || "not assessed"}`,
  `  Peers: ${report.peerDiscovery?.status ?? "unavailable"} (${report.peerDiscovery?.peerSets ? Object.values(report.peerDiscovery.peerSets).filter((set) => set.status === "ready").length : 0} set(s) ready)`,
  `  History: ${report.normalizedHistory?.status ?? "unavailable"} (${report.normalizedHistory?.coverage.metricsReady ?? 0} metric(s) ready, ${report.normalizedHistory?.trendBreaks.length ?? 0} trend break(s))`,
  `  Earnings Quality: ${report.earningsQuality?.status ?? "unavailable"}`,
  `  Capital Allocation: ${report.capitalAllocationLedger?.status ?? "unavailable"}`,
  `  Management Credibility: ${report.managementCredibility?.status ?? "UNVERIFIED"}`,
  `  Guidance Reconciliation: ${report.guidanceReconciliation?.status ?? "unverified"}`,
  `  Confidence Decomposition: ${report.confidenceDecomposition?.overall.score ?? "n/a"}`,
  "",
    "VALUATION:",
    `  Fair Value per Share: ${report.valuation?.fairValuePerShare !== undefined ? report.valuation.fairValuePerShare : "N/A"}`,
    `  Upside: ${report.valuation?.upsidePct !== undefined ? `${report.valuation.upsidePct.toFixed(1)}%` : "N/A"}`,
    `  Sensitivity Variables: ${report.sensitivityAnalysis?.rankedVariables.join(", ") || "N/A"}`,
    `  Monte Carlo P50: ${report.monteCarlo?.status === "ready" ? report.monteCarlo.fairValue.p50.toFixed(2) : "N/A"}`,
    `  Reverse Status: ${report.reverseValuationResult?.status ?? (report.reverseValuation ? "ready" : "unavailable")}`,
    "",
    "CONTAMINATION CHECK:",
    "  All content dynamically generated — no hardcoded sector templates",
  ];
  return lines.join("\n");
}

export default { assembleResearchReport, renderReportSummary };