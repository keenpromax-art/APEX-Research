/**
 * APEX RESEARCH — AI-FIRST ENGINE
 *
 * Dynamic, company-specific institutional equity research.
 *
 * AXIOM: YFINANCE is the ONLY authoritative factual historical data layer.
 * Everything above it (company understanding, economic model, formulas,
 * forecast assumptions, valuation method selection, scenarios, reverse
 * valuation, thesis, risks, catalysts, moat, competitive analysis) is
 * dynamically reasoned by AI per-company.
 *
 * CRITICAL RULE: AI decides the model. Code executes the model. The LLM
 * generates structured model specifications (variables, formulas, assumption
 * values, method selections) and deterministic runtime calculators perform
 * all arithmetic, preventing LLM arithmetic hallucination.
 *
 * There is ONE dynamic AI pipeline. No hardcoded sector/company archetypes,
 * no BANK/AUTO/TECH engines, no fixed contamination vocabulary.
 *
 * Pipeline (all modules implemented under src/lib/ai-first/):
 *   TICKER
 *     -> YFINANCE FACT PACK            (fact-pack.ts)
 *     -> AI COMPANY UNDERSTANDING      (company-understanding.ts)
 *     -> AI MODEL SPECIFICATION        (model-builder.ts)
 *     -> AI ASSUMPTIONS                (assumptions.ts)
 *     -> DETERMINISTIC FORECAST ENGINE (forecast-engine.ts + statement-identities.ts)
 *     -> AI VALUATION SELECTION        (valuation-builder.ts)
 *     -> DETERMINISTIC VALUATION       (valuation-engine.ts + valuation-helpers.ts)
 *     -> AI SCENARIOS                  (scenarios-builder.ts)
 *     -> AI REVERSE VALUATION          (reverse-valuation.ts)
 *     -> AI NARRATIVES                 (narrative-builders.ts)
 *     -> AI QUALITY REVIEW LOOP        (quality-review.ts)
 *     -> RESEARCH REPORT OBJECT        (research-report.ts)
 *     -> PDF RENDERER (renders object only)
 *
 * Module classification (from AI_FIRST_REWRITE_PLAN.md):
 *  KEEP: deterministic infrastructure (ai-providers, openrouter, agent-team,
 *        yahoo-finance, calculations, canonical-forecast, financial-kernel,
 *        financial-provenance, valuation calculators, units, ratio-guards,
 *        PDFDocument, accounting-identity-engine, evidence-registry, claim-validator)
 *  DELETE: hardcoded analytical intelligence (company-archetype, company-ontology,
 *           sectors/*, sector-allowlist, research-model/*, ai/sanitizer, hardcoded moat,
 *           report-qa ONT/OM style rules)
 *  REWRITE: route handlers to pipe through AI-first engine (no sector gates)
 *  NEW: ai-first modules (types, fact-pack, company-understanding, model-builder,
 *       assumptions, model-runtime, forecast-engine, valuation-builder,
 *       valuation-engine, scenarios-builder, reverse-valuation,
 *       narrative-builders, quality-review, research-report)
 */

// ============================================================
// Core Types — re-exported from types.ts
// ============================================================

export type ProvenanceTier =
  | "fact"
  | "derived"
  | "assumption"
  | "forecast"
  | "opinion";

export type FactSource = "yfinance" | "derived" | "ai";

export interface Fact {
  metric: string;
  label: string;
  value?: number;
  textValue?: string;
  period: string;
  currency?: string;
  unit?: string;
  source: FactSource;
  ticker: string;
  retrievalTimestamp: string;
  derivedFrom?: string[];
}

export interface FactSection {
  name: string;
  facts: Fact[];
  raw?: unknown;
}

export interface FactPack {
  ticker: string;
  company: FactSection;
  market: FactSection;
  incomeStatement: FactSection;
  balanceSheet: FactSection;
  cashFlow: FactSection;
  shares: FactSection;
  earnings: FactSection;
  estimates: FactSection;
  corporateActions: FactSection;
  priceHistory: FactSection;
  holders: FactSection;
  retrievalTimestamp: string;
  version: string;
}

export interface BusinessDriver {
  name: string;
  mechanism: string;
  sourceFacts: string[];
  statementLine?: string;
}

export interface KpiDefinition {
  name: string;
  rationale: string;
  availability: "yfinance" | "modeled" | "unavailable";
  unit?: string;
}

export interface CompanyUnderstanding {
  ticker: string;
  companyName: string;
  whatItDoes: string;
  howItMakesMoney: string;
  businessSegments: Array<{ name: string; description: string; shareOfRevenue?: number }>;
  economicUnits: string[];
  primaryEconomicAbstraction: string;
  revenueDrivers: BusinessDriver[];
  costDrivers: BusinessDriver[];
  marginDrivers: BusinessDriver[];
  cashGenerationDrivers: BusinessDriver[];
  balanceSheetDrivers: BusinessDriver[];
  returnsDrivers: BusinessDriver[];
  keyKpis: KpiDefinition[];
  metricsToAvoid: Array<{ metric: string; reason: string }>;
  statementsThatMatterMost: string[];
  industryContext: string;
  appropriateValuationMethods: Array<{ method: string; why: string }>;
  confidence: ConfidenceAssessment;
}

export interface ConfidenceAssessment {
  overall: number; // 0..1
  dataQuality: string;
  reasoning: string;
}

// Model specification types — from model-builder.ts

export interface Formula {
  id: string;
  equation: string;
  expression: string;
  output: string;
  variables: string[];
  explanation: string;
  sourceFacts: string[];
  confidence: number; // 0..1
}

export interface ForecastVariable {
  name: string;
  label: string;
  baseValue?: number;
  unit: string;
  kind: "input" | "computed";
  statementLine?: string;
}

export interface Assumption {
  id: string;
  assumption: string;
  variable: string;
  value: number;
  unit: string;
  period: string;
  rationale: string;
  historicalEvidence: string;
  confidence: number; // 0..1
}

export interface ForecastSpecification {
  horizonYears: number;
  horizonRationale: string;
  variables: ForecastVariable[];
  formulas: Formula[];
  assumptions: Assumption[];
  driverPaths: Record<string, number[]>;
}

export interface ForecastStatementYear {
  period: string;
  values: Record<string, number | undefined>;
  provenance: Record<string, ProvenanceTier>;
}

export interface ForecastResult {
  incomeStatement: ForecastStatementYear[];
  balanceSheet: ForecastStatementYear[];
  cashFlow: ForecastStatementYear[];
  identityChecks: Array<{ check: string; pass: boolean; detail?: string }>;
}

// Valuation types — from valuation-builder/engine.ts

export interface ValuationSpecification {
  methodology: string;
  rationale: string;
  variablesDrivingValuation: string[];
  assumptions: Assumption[];
  discountRate?: number;
  discountRateRationale?: string;
  terminalAssumptions?: { growth: number; rationale: string };
  methodsConsidered: Array<{ method: string; verdict: "selected" | "rejected"; reason: string }>;
}

export interface ValuationResult {
  methodology: string;
  fairValuePerShare?: number;
  fairValueEquity?: number;
  enterpriseValue?: number;
  outputs: Record<string, number | undefined>;
  upsidePct?: number;
  executedFrom: ValuationSpecification;
}

// Scenario types — from scenarios-builder.ts

export interface ScenarioSpecification {
  name: "bear" | "base" | "bull";
  changedVariables: Array<{ variable: string; baseValue?: number; scenarioValue: number; rationale: string }>;
  targetPrice?: number;
  targetProvenance: ProvenanceTier; // always "forecast"
}

// Narrative types — from narrative-builders.ts

export interface ThesisSpecification {
  thesis: string;
  bullCase: string[];
  bearCase: string[];
  keyDebate: string;
  keyInflectionPoints: string[];
  whatMarketMayBeMissing: string;
  whatCouldInvalidate: string[];
}

export interface Catalyst {
  catalyst: string;
  mechanism: string;
  financialVariable: string;
  forecastImpact?: string;
  valuationImpact?: string;
  quantitative: boolean;
  timeframe?: string;
}

export interface Risk {
  risk: string;
  mechanism: string;
  affectedKpi: string;
  financialConsequence: string;
  valuationConsequence: string;
  monitoringIndicator: string;
}

export interface CompetitorAnalysis {
  competitors: Array<{
    company: string;
    businessOverlap: string;
    economicSimilarity: string;
    keyDifference: string;
    relativeStrengths: string;
    relativeWeaknesses: string;
  }>;
  insufficient?: boolean;
  note?: string;
}

export interface MoatAnalysis {
  hasMoat: boolean;
  sources: Array<{
    source: string;
    evidence: string;
    economicConsequence: string;
    durability: string;
    threatsToDurability: string;
  }>;
  verdict: string;
}

// Research report type — from research-report.ts

export interface ReviewFinding {
  reviewer: string;
  severity: "blocker" | "major" | "minor";
  component: string;
  finding: string;
  recommendation: string;
}

export interface ResearchReport {
  researchRunId: string;
  companyTicker: string;
  modelVersion: string;
  promptVersion: string;
  factPackVersion: string;
  generationTimestamp: string;
  forecastVersion: string;
  valuationVersion: string;
  reviewVersion: string;

  companyUnderstanding: CompanyUnderstanding;
  businessModel: string;
  industryContext: string;
  historicalAnalysis: string;
  keyMetrics: Fact[];
  operatingModel: { formulas: Formula[]; variables: ForecastVariable[] };
  forecast: ForecastResult;
  valuation: ValuationResult;
  scenarios: ScenarioSpecification[];
  thesis: ThesisSpecification;
  catalysts: Catalyst[];
  risks: Risk[];
  competitiveAnalysis: CompetitorAnalysis;
  moat: MoatAnalysis;
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

export type ContextPackageKind =
  | "FACT_CONTEXT"
  | "BUSINESS_CONTEXT"
  | "MODEL_CONTEXT"
  | "VALUATION_CONTEXT"
  | "REPORT_CONTEXT"
  | "REVIEW_CONTEXT";

// ============================================================
// AI-First Pipeline Module Exports
// ============================================================

// Fact pack — yfinance normalization; no zero-fill; provenance-tagged
// (src/lib/ai-first/fact-pack.ts)
export { buildFactPack, renderFactContext } from "./fact-pack";

// Company understanding — AI determines business model, economics, drivers
// (src/lib/ai-first/company-understanding.ts)
export { understandCompany } from "./company-understanding";

// Model builder — AI generates dynamic formulas and model specification
// (src/lib/ai-first/model-builder.ts)
export type {
  ModelBuilderInput,
  ModelTransport,
} from "./model-builder";
export { modelContext, buildModelSpec } from "./model-builder";

// Assumption generation — AI-generated assumptions with historical evidence
// (src/lib/ai-first/assumptions.ts)
export {
  buildAssumptionsPrompt,
  parseAssumptionJson,
  deriveFromAssumptions,
  validateAssumptions,
} from "./assumptions";

// Model runtime — deterministic expression evaluator
// "AI decides the model. Code executes the model."
// (src/lib/ai-first/model-runtime.ts)
export { evalExpression, applyGrowthPath } from "./model-runtime";

// Forecast engine — deterministic forecast execution
// (src/lib/ai-first/forecast-engine.ts)
export { executeForecast, renderForecastContext } from "./forecast-engine";

// Valuation builder — AI selects methodology; code executes
// (src/lib/ai-first/valuation-builder.ts)
export { buildValuationSpec, valuationContext } from "./valuation-builder";

// Valuation engine — deterministic valuation execution
// (src/lib/ai-first/valuation-engine.ts)
export { executeValuation } from "./valuation-engine";

// Scenarios builder — AI generates Bear/Base/Bull scenarios dynamically
// (src/lib/ai-first/scenarios-builder.ts)
export {
  buildScenarios,
  flowScenarioThroughModel,
  renderScenarioContext,
} from "./scenarios-builder";

// Narrative builders — all AI-generated (thesis, risks, catalysts, moat, competitive analysis)
// (src/lib/ai-first/narrative-builders.ts)
export { buildNarrative } from "./narrative-builders";

// Reverse valuation — AI chooses the variable to solve for; code solves it
// (src/lib/ai-first/reverse-valuation.ts)
export {
  chooseReverseVariable,
  solveRequiredValue,
  buildRevenueCagrSolver,
  currentPriceOf,
} from "./reverse-valuation";

// Quality review — 8 AI reviewers + adjudicator self-correction loop
// (src/lib/ai-first/quality-review.ts)
export { runQualityReview, adjudicateRegeneration } from "./quality-review";

// Research report assembly — final object PDF renderer renders
// (src/lib/ai-first/research-report.ts)
export { assembleResearchReport, renderReportSummary } from "./research-report";

// Orchestration pipeline — ONE dynamic AI pipeline (no sector gates)
// (src/lib/ai-first/pipeline.ts)
export { runAiFirstResearch, makeProviderTransport } from "./pipeline";
export type { PipelineTransport, AiFirstProgress, RunAiFirstOptions, AiFirstRunResult } from "./pipeline";

// ============================================================
// Legacy / Re-exported from core infrastructure
// ============================================================

// Types re-exported from src/lib/types (report types, calculations, etc.)
// These exist in the broader codebase; importing directly would create
// circular dependencies. Instead, document what's available elsewhere.

// AI provider infrastructure (multi-provider, failover, key config)
// (src/lib/ai-providers.ts, src/lib/openrouter.ts)
// These are kept as-is; the new AI-first pipeline uses them via transport functions.

// Agent team runtime (harvesters, quants, authors, checkers)
// (src/lib/agent-team.ts)
// Transport layer for the AI-first pipeline.

// yfinance data ingestion
// (src/lib/yahoo-finance.ts) — stripped of sector-gate logic; raw fetcher

// Financial calculation engines
// (src/lib/calculations.ts, src/lib/financial-kernel.ts)
// Deterministic math used by the forecast/valuation engines.

// Valuation calculators (residential, reverse-DCF, calibration)
// (src/lib/valuation/residual-income.ts, reverse-dcf.ts, calibration.ts)

// Number formatting and units
// (src/lib/units.ts, src/lib/ratio-guards.ts)

// PDF document renderer
// (src/components/PDFDocument/) — re-targeted to render ResearchReport object

// Accounting identity enforcement
// (src/lib/accounting-identity-engine.ts)

// Fact provenance and evidence registry
// (src/lib/evidence-registry.ts, src/lib/claim-validator.ts)

// ============================================================
// The AI-first engine is constructed module-by-module. Each module is added
// under src/lib/ai-first/ and exported here as it lands. See
// docs/AI_FIRST_REWRITE_PLAN.md for the migration sequence.