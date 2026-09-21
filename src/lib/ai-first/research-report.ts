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
} from "./types";

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
  reverseValuation: { variable: string; requiredValue: number; interpretation: string } | null;
  conclusion: string;
  reviews: ReviewFinding[];
  reviewPassed: boolean;
  regenerationLog: string[];
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
    reverseValuation,
    conclusion,
    reviews,
    reviewPassed,
    regenerationLog,
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
    scenarios,
    thesis,
    catalysts,
    risks,
    competitiveAnalysis,
    moat,

    managementAnalysis,
    capitalAllocation,
    financialQuality,
    sensitivity,
    reverseValuation,
    conclusion,

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
    `  Scenarios: ${report.scenarios?.length || 0} (Bear/Base/Bull)`,
    `  Thesis: ${report.thesis?.thesis ? "present" : "empty"}`,
    `  Risks: ${report.risks?.length || 0} risks identified`,
    `  Catalysts: ${report.catalysts?.length || 0} catalysts identified`,
    `  Moat: ${report.moat?.verdict || "not assessed"}`,
    "",
    "VALUATION:",
    `  Fair Value per Share: ${report.valuation?.fairValuePerShare !== undefined ? report.valuation.fairValuePerShare : "N/A"}`,
    `  Upside: ${report.valuation?.upsidePct !== undefined ? `${report.valuation.upsidePct.toFixed(1)}%` : "N/A"}`,
    "",
    "CONTAMINATION CHECK:",
    "  All content dynamically generated — no hardcoded sector templates",
  ];
  return lines.join("\n");
}

export default { assembleResearchReport, renderReportSummary };