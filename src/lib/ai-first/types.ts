/**
 * APEX RESEARCH — AI-First Core Types
 *
 * The factual data firewall (Principle 22/23): every number in the system
 * carries a provenance tier and these tiers are NEVER mixed.
 *
 *   FACT       — historical, sourced from yfinance
 *   DERIVED    — computed by deterministic code FROM yfinance facts
 *   ASSUMPTION — AI-generated forward-looking input (with rationale + evidence)
 *   FORECAST   — computed by deterministic code FROM AI assumptions
 *   OPINION    — AI interpretation/judgment (non-numeric or qualitative)
 */

// ─────────────────────────────────────────────
// Provenance
// ─────────────────────────────────────────────

export type ProvenanceTier =
  | "fact"
  | "derived"
  | "assumption"
  | "forecast"
  | "opinion";

export type FactSource = "yfinance" | "derived" | "ai";

/** A single normalized fact. Missing values NEVER become zero (Principle 24). */
export interface Fact {
  /** Machine-readable metric key, e.g. "revenue", "totalEquity", "nim". */
  metric: string;
  /** Human label for prompt rendering, e.g. "Total revenue". */
  label: string;
  /** Numeric value — undefined when yfinance does not provide it. */
  value?: number;
  /** Non-numeric raw value (text metrics) — e.g. company description. */
  textValue?: string;
  /** Reporting period, e.g. "FY2025", "Q3-FY2026", "TTM", "current". */
  period: string;
  currency?: string;
  unit?: string;
  source: FactSource;
  ticker: string;
  retrievalTimestamp: string;
  /** For derived facts: which fact IDs / formulas produced this value. */
  derivedFrom?: string[];
}

export interface FactSection {
  /** Section name, e.g. "incomeStatement". */
  name: string;
  /** Normalized facts in this section (sparse — absent metrics are absent). */
  facts: Fact[];
  /** Raw yfinance payload preserved for audit (never sent to LLMs in full). */
  raw?: unknown;
}

/**
 * The complete per-company fact pack. One canonical pack shared by every
 * agent in the pipeline. No agent may invent historical facts.
 */
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
  /** Monotonic pack version — bumped when normalization logic changes. */
  version: string;
}

// ─────────────────────────────────────────────
// Company understanding (AI-generated)
// ─────────────────────────────────────────────

export interface BusinessDriver {
  name: string;
  /** What economically drives this item for THIS company. */
  mechanism: string;
  /** yfinance fact IDs grounding the driver's existence. */
  sourceFacts: string[];
  /** Which financial statement line this driver maps to. */
  statementLine?: string;
}

export interface KpiDefinition {
  name: string;
  /** Why this KPI matters for this company's economics. */
  rationale: string;
  /** Whether yfinance supplies this KPI directly or it must be modeled. */
  availability: "yfinance" | "modeled" | "unavailable";
  unit?: string;
}

export interface CompanyUnderstanding {
  ticker: string;
  companyName: string;
  /** What the company actually does, in the AI's own words. */
  whatItDoes: string;
  /** How it makes money — the economic engine. */
  howItMakesMoney: string;
  businessSegments: Array<{ name: string; description: string; shareOfRevenue?: number }>;
  /** The economic units of the business (deposits, vehicles, subscribers...). */
  economicUnits: string[];
  /** Primary economic abstraction — e.g. "net interest income" for a bank. */
  primaryEconomicAbstraction: string;
  revenueDrivers: BusinessDriver[];
  costDrivers: BusinessDriver[];
  marginDrivers: BusinessDriver[];
  cashGenerationDrivers: BusinessDriver[];
  balanceSheetDrivers: BusinessDriver[];
  returnsDrivers: BusinessDriver[];
  /** Capex / capital-intensity engines (AI infrastructure, PP&E build, working capital). */
  capitalEngines?: BusinessDriver[];
  keyKpis: KpiDefinition[];
  /** Metrics the AI determined should NOT be used for this company. */
  metricsToAvoid: Array<{ metric: string; reason: string }>;
  statementsThatMatterMost: string[];
  industryContext: string;
  /** AI-determined appropriate valuation methods with rationale. */
  appropriateValuationMethods: Array<{ method: string; why: string }>;
  confidence: ConfidenceAssessment;
  /** What is unique about this company vs any peer — the investment case differentiator. */
  whyThisCompany?: string;
  /** Competitive advantages that map to economic architecture chains. */
  competitiveAdvantages?: Array<{ advantage: string; mechanism: string; evidence: string[] }>;
  /** Competitive threats that can erode advantages. */
  competitiveThreats?: Array<{ threat: string; mechanism: string; evidence: string[] }>;
  /** Current inflection points (what changed and why it matters now). */
  currentInflections?: string[];
  /** Management priorities / capital allocation posture (UNKNOWN if not in facts). */
  managementPriorities?: string[];
  /** Optional epistemic breakdown (known/inferred/unknown) — audit §14. */
  epistemic?: {
    knownFacts: string[];
    inferences: string[];
    unknowns: string[];
    requiredResearch: string[];
  };
}

/** Structured economic engine — what physically determines revenue/margins/cash/capital. */
export interface EconomicEngine {
  ticker: string;
  primaryAbstraction: string;
  revenueDrivers: BusinessDriver[];
  costDrivers: BusinessDriver[];
  marginDrivers: BusinessDriver[];
  cashDrivers: BusinessDriver[];
  balanceSheetDrivers: BusinessDriver[];
  capitalDrivers: BusinessDriver[];
  returnsDrivers: BusinessDriver[];
  keyKpis: KpiDefinition[];
  metricsToAvoid: Array<{ metric: string; reason: string }>;
  /** How the engine maps to statement lines the forecast will execute. */
  statementBindings: Array<{
    statementLine: string;
    drivenBy: string;
    mechanism: string;
    sourceFacts: string[];
  }>;
  /** 2-4 value-determining questions the engine raises (seed for debates). */
  valueQuestions: string[];
  confidence: number;
}

/** Evidence attached to a claim/debate with tier + confidence. */
export interface EvidenceItem {
  claim: string;
  evidence: string;
  factIds: string[];
  tier: number;
  direction: "for" | "against" | "mixed";
  confidence: number;
  period?: string;
}

/** Evidence map for the report — every major claim mapped to sources. */
export interface EvidenceMap {
  ticker: string;
  items: EvidenceItem[];
  /** Claims that could not be supported (honest unknowns). */
  unsupported: string[];
  overallConfidence: number;
}

export interface ConfidenceAssessment {
  overall: number; // 0..1
  dataQuality: string;
  reasoning: string;
}

// ─────────────────────────────────────────────
// Model specification (AI-generated) — code executes it
// ─────────────────────────────────────────────

export interface Formula {
  id: string;
  /** Human-readable equation, e.g. "Revenue = Volume × ASP". */
  equation: string;
  /** Machine-executable expression over variables, e.g. "volume * asp". */
  expression: string;
  /** Output variable this formula computes. */
  output: string;
  variables: string[];
  explanation: string;
  sourceFacts: string[];
  confidence: number; // 0..1
}

export interface ForecastVariable {
  name: string;
  label: string;
  /** Base-year value from yfinance facts (or derived). */
  baseValue?: number;
  unit: string;
  /** Whether the variable is an input the AI forecasts or a computed output. */
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
  /** Historical evidence with yfinance fact citations. */
  historicalEvidence: string;
  confidence: number; // 0..1
}

export interface ForecastSpecification {
  horizonYears: number;
  /** AI's rationale for the chosen horizon. */
  horizonRationale: string;
  variables: ForecastVariable[];
  formulas: Formula[];
  assumptions: Assumption[];
  /** Path of growth rates per forecast year for each input variable. */
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
  /** Identity checks performed by the deterministic engine. */
  identityChecks: Array<{ check: string; pass: boolean; detail?: string }>;
}

// ─────────────────────────────────────────────
// Valuation (AI selects; code executes)
// ─────────────────────────────────────────────

export interface ValuationSpecification {
  methodology: string;
  /** Why this method is economically appropriate for THIS company. */
  rationale: string;
  variablesDrivingValuation: string[];
  assumptions: Assumption[];
  discountRate?: number;
  discountRateRationale?: string;
  terminalAssumptions?: { growth: number; rationale: string };
  /** Alternative methods considered and rejected (with reasons). */
  methodsConsidered: Array<{ method: string; verdict: "selected" | "rejected"; reason: string }>;
}

export interface ValuationResult {
  methodology: string;
  fairValuePerShare?: number;
  fairValueEquity?: number;
  enterpriseValue?: number;
  outputs: Record<string, number | undefined>;
  /** Upside vs current price, computed deterministically. */
  upsidePct?: number;
  executedFrom: ValuationSpecification;
}

// ─────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────

export interface ScenarioSpecification {
  name: "bear" | "base" | "bull";
  /** What actually changes between scenarios for THIS company. */
  changedVariables: Array<{ variable: string; baseValue?: number; scenarioValue: number; rationale: string }>;
  targetPrice?: number;
  targetProvenance: ProvenanceTier; // always "forecast"
}

// ─────────────────────────────────────────────
// Narrative (AI-generated, model-linked)
// ─────────────────────────────────────────────

export interface DebateEvidence {
  evidence: string;
  factIds: string[]; // [F-...]
  tier: number;
}

export interface Debate {
  debate: string; // falsifiable value question, e.g. "Can AI capex earn acceptable returns?"
  evidenceFor: DebateEvidence[];
  evidenceAgainst: DebateEvidence[];
  mechanism: string; // economic mechanism at stake
  significance: string; // why this debate decides valuation
  /** Financial consequence if FOR side wins (revenue/EBIT/FCF row). */
  financialConsequence?: string;
  /** Valuation consequence if FOR side wins (EV/equity/per-share). */
  valuationConsequence?: string;
  /** Observable condition that would resolve the debate one way. */
  resolutionSignal?: string;
}

export interface ThesisEngineOutput {
  debates: Debate[];
  centralDebateIndex: number;
  thesis: string;
  thesisEvidence: string[];
  thesisCounterEvidence: string[];
  keyUncertainty: string;
  invalidationCondition: string;
  monitoringKpi: string;
  confidence: number;
}

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
  /** "QUALITATIVE ONLY" when no quantitative chain can be established. */
  quantitative: boolean;
  timeframe?: string;
  /** Observable KPI that confirms the catalyst fired. */
  observableKpi?: string;
  /** Direction of impact when the catalyst fires. */
  direction?: "positive" | "negative" | "mixed";
  /** What would invalidate / delay the catalyst. */
  invalidation?: string;
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
    /** Segment this competitor competes in (when filing segments exist). */
    segment?: string;
  }>;
  /** Set when AI determines appropriate peers cannot be identified. */
  insufficient?: boolean;
  note?: string;
}

export interface MoatAnalysis {
  hasMoat: boolean;
  /** AI-selected sources — no fixed pillar list. Each source is an economic architecture chain. */
  sources: Array<{
    source: string;
    evidence: string;
    economicConsequence: string;
    durability: string;
    threatsToDurability: string;
    /** Explicit chain: asset → mechanism → KPI → financial → valuation. */
    chain?: string;
  }>;
  verdict: string;
}

// ─────────────────────────────────────────────
// Research report (final assembly)
// ─────────────────────────────────────────────

export interface ReviewFinding {
  reviewer: string;
  severity: "blocker" | "major" | "minor";
  component: string;
  finding: string;
  recommendation: string;
}

export interface ResearchReport {
  /** Versioning — every AI-generated package is reproducible (Principle 34). */
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

  /** Content-intelligence artifacts (optional — populated when stages run). */
  economicEngine?: EconomicEngine;
  debates?: Debate[];
  evidenceMap?: EvidenceMap;

  /** Quality control trail. */
  reviews: ReviewFinding[];
  reviewPassed: boolean;
  regenerationLog: string[];
}

// ─────────────────────────────────────────────
// AI model specification (Principle 30) — the entire object is generated
// dynamically by AI. Deterministic engines execute it; nothing is hardcoded.
// ─────────────────────────────────────────────

export interface AIResearchModel {
  company: CompanyUnderstanding;
  historicalFacts: FactPack;
  businessDrivers: BusinessDriver[];
  formulas: Formula[];
  forecast: ForecastSpecification;
  valuation: ValuationSpecification;
  scenarios: ScenarioSpecification[];
  thesis: ThesisSpecification;
  catalysts: Catalyst[];
  risks: Risk[];
  competitiveAnalysis: CompetitorAnalysis;
  moatAnalysis: MoatAnalysis;
  confidence: ConfidenceAssessment;
}

// ─────────────────────────────────────────────
// Compact context packages (Principle 33 — performance)
// ─────────────────────────────────────────────

export type ContextPackageKind =
  | "FACT_CONTEXT"
  | "BUSINESS_CONTEXT"
  | "MODEL_CONTEXT"
  | "VALUATION_CONTEXT"
  | "REPORT_CONTEXT"
  | "REVIEW_CONTEXT";
