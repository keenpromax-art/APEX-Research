import type { CanonicalEvidenceRegistry } from "@/lib/research-retrieval/evidence";
import type { ResearchRetrievalResult } from "@/lib/research-retrieval/types";
import type { ResearchLineageGraph } from "@/lib/research-lineage/types";

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

export type ProvenanceTier =
  | "fact"
  | "derived"
  | "assumption"
  | "forecast"
  | "opinion";

export const CANONICAL_SOURCE_TAXONOMY_VERSION = "canonical-source-taxonomy-v1";
export const FACT_NORMALIZATION_VERSION = "fact-normalization-v1";

export const CANONICAL_SOURCE_TYPES = Object.freeze([
  "regulatory_filing",
  "exchange_filing",
  "annual_report",
  "investor_presentation",
  "earnings_call",
  "government_regulator",
  "company_website",
  "market_data_provider",
  "secondary_database",
  "news",
  "model_derived",
  "unknown",
] as const);

export type CanonicalSourceType = (typeof CANONICAL_SOURCE_TYPES)[number];
export type SourceAuthority = "primary" | "secondary" | "tertiary" | "model_derived" | "unknown";
export type SourceValueRole =
  | "reported_fact"
  | "management_guidance"
  | "consensus_estimate"
  | "market_observation"
  | "context"
  | "derived_value"
  | "unknown";
export type FactConfidenceLevel = "none" | "low" | "medium" | "high";
export type FactPeriodType = "actual" | "estimate" | "forecast" | "current" | "unknown";

export interface CanonicalSourceMetadata {
  taxonomyVersion: typeof CANONICAL_SOURCE_TAXONOMY_VERSION;
  sourceId: string;
  type: CanonicalSourceType;
  authority: SourceAuthority;
  valueRole: SourceValueRole;
  confidence: number;
  provider?: string;
  publisher?: string;
  documentId?: string;
  documentTitle?: string;
  locator?: string;
  publicationDate?: string;
  asOfDate?: string;
}

export interface CanonicalSourceMetadataInput extends Partial<Omit<CanonicalSourceMetadata, "taxonomyVersion" | "type" | "sourceId">> {
  type: CanonicalSourceType;
  sourceId: string;
}

export const CANONICAL_SOURCE_DEFAULTS: Readonly<Record<CanonicalSourceType, Readonly<Pick<CanonicalSourceMetadata, "authority" | "valueRole" | "confidence">>>> = Object.freeze({
  regulatory_filing: Object.freeze({ authority: "primary", valueRole: "reported_fact", confidence: 0.98 }),
  exchange_filing: Object.freeze({ authority: "primary", valueRole: "reported_fact", confidence: 0.95 }),
  annual_report: Object.freeze({ authority: "primary", valueRole: "reported_fact", confidence: 0.95 }),
  investor_presentation: Object.freeze({ authority: "primary", valueRole: "management_guidance", confidence: 0.85 }),
  earnings_call: Object.freeze({ authority: "primary", valueRole: "management_guidance", confidence: 0.8 }),
  government_regulator: Object.freeze({ authority: "primary", valueRole: "reported_fact", confidence: 0.95 }),
  company_website: Object.freeze({ authority: "primary", valueRole: "context", confidence: 0.7 }),
  market_data_provider: Object.freeze({ authority: "secondary", valueRole: "market_observation", confidence: 0.7 }),
  secondary_database: Object.freeze({ authority: "secondary", valueRole: "context", confidence: 0.6 }),
  news: Object.freeze({ authority: "tertiary", valueRole: "context", confidence: 0.45 }),
  model_derived: Object.freeze({ authority: "model_derived", valueRole: "derived_value", confidence: 0.3 }),
  unknown: Object.freeze({ authority: "unknown", valueRole: "unknown", confidence: 0 }),
});

function requiredSourceText(value: string, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function sourceConfidence(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Source confidence must be between 0 and 1");
  return Object.is(value, -0) ? 0 : value;
}

export function createCanonicalSourceMetadata(input: CanonicalSourceMetadataInput): CanonicalSourceMetadata {
  if (input === null || typeof input !== "object") throw new TypeError("Canonical source metadata input must be an object");
  if (!CANONICAL_SOURCE_TYPES.includes(input.type)) throw new TypeError(`Unsupported canonical source type ${String(input.type)}`);
  const defaults = CANONICAL_SOURCE_DEFAULTS[input.type];
  const optional = {
    ...(input.provider === undefined ? {} : { provider: requiredSourceText(input.provider, "provider") }),
    ...(input.publisher === undefined ? {} : { publisher: requiredSourceText(input.publisher, "publisher") }),
    ...(input.documentId === undefined ? {} : { documentId: requiredSourceText(input.documentId, "documentId") }),
    ...(input.documentTitle === undefined ? {} : { documentTitle: requiredSourceText(input.documentTitle, "documentTitle") }),
    ...(input.locator === undefined ? {} : { locator: requiredSourceText(input.locator, "locator") }),
    ...(input.publicationDate === undefined ? {} : { publicationDate: requiredSourceText(input.publicationDate, "publicationDate") }),
    ...(input.asOfDate === undefined ? {} : { asOfDate: requiredSourceText(input.asOfDate, "asOfDate") }),
  };
  return Object.freeze({
    ...optional,
    taxonomyVersion: CANONICAL_SOURCE_TAXONOMY_VERSION,
    sourceId: requiredSourceText(input.sourceId, "sourceId"),
    type: input.type,
    authority: input.authority ?? defaults.authority,
    valueRole: input.valueRole ?? defaults.valueRole,
    confidence: sourceConfidence(input.confidence ?? defaults.confidence),
  });
}

export type LegacyFactSource = "yfinance" | "derived";
export type FactSource = LegacyFactSource | CanonicalSourceType;

export interface CurrencyConversionMetadata {
  fromCurrency: string | null;
  toCurrency: string | null;
  rate: number | null;
  method: string;
  applied: boolean;
}

export interface ShareBasisConversionMetadata {
  fromBasis: string;
  toBasis: string;
  factor: number;
  method: string;
  applied: boolean;
}

export interface FactNormalizationMetadata {
  version: typeof FACT_NORMALIZATION_VERSION;
  method: string;
  rawValue: number | string | boolean | null;
  rawUnit: string | null;
  normalizedUnit: string | null;
  scaleFactor: number;
  currencyConversion: CurrencyConversionMetadata;
  shareBasisConversion: ShareBasisConversionMetadata;
  confidence: number;
}

export interface Fact {
  metric: string;
  label: string;
  value?: number;
  textValue?: string;
  period: string;
  periodId?: string;
  currency?: string;
  unit?: string;
  source: FactSource;
  sourceId?: string;
  sourcePath?: string;
  sourceMetadata?: CanonicalSourceMetadata;
  factId?: string;
  ticker: string;
  retrievalTimestamp: string;
  asOfTimestamp?: string;
  priceTimestamp?: string;
  exchange?: string;
  session?: string;
  dataStatus?: CurrentPriceDataStatus;
  delayedOrRealtime?: CurrentPriceDataStatus;
  freshness?: "fresh" | "stale" | "unknown";
  asOfDate?: string;
  fiscalPeriod?: string;
  fiscalYear?: number;
  reportingPeriod?: string;
  periodType?: FactPeriodType;
  restated?: boolean;
  estimated?: boolean;
  rawField?: string;
  normalization?: FactNormalizationMetadata;
  currencyConversion?: CurrencyConversionMetadata;
  shareBasisConversion?: ShareBasisConversionMetadata;
  confidence?: number;
  confidenceLevel?: FactConfidenceLevel;
  derivedFrom?: string[];
}

export interface FactSection {
  name: string;
  facts: Fact[];
  raw?: unknown;
}

export type CurrentPriceDataStatus = "realtime" | "delayed" | "unknown";

export interface CurrentPriceMetadata {
  value?: number;
  timestamp?: string;
  timestampSource?: string;
  exchange?: string;
  session?: string;
  status: CurrentPriceDataStatus;
  delayedOrRealtime: CurrentPriceDataStatus;
  source: string;
  sourceId: string;
  asOfDate?: string;
  ageMs?: number;
  ageSeconds?: number;
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  isStale: boolean;
  delayed: boolean;
  isDelayed: boolean;
  delaySeconds?: number;
  diagnostics: string[];
}

export interface FactPackDiagnostics {
  currentPrice: CurrentPriceMetadata;
  fundamentalsTimeseries: { present: boolean; rows: number; facts: number; diagnostics: string[] };
  priceHistory: { present: boolean; rows: number; facts: number; diagnostics: string[] };
  corporateActions: { present: boolean; rows: number; facts: number; diagnostics: string[] };
  warnings: string[];
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
  fundamentalsTimeseries?: FactSection;
  retrievalTimestamp: string;
  version: string;
  currentPrice?: CurrentPriceMetadata;
  currentPriceValue?: number;
  currentPriceMetadata?: CurrentPriceMetadata;
  priceFreshness?: CurrentPriceMetadata;
  freshnessDiagnostics?: CurrentPriceMetadata;
  diagnostics?: FactPackDiagnostics;
  factPackId?: string;
  contentHash?: string;
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

// ─────────────────────────────────────────────
// Research Discovery — identify gaps, collect evidence, seed writers
// ─────────────────────────────────────────────

export type DiscoveryArea =
  | "revenueDrivers"
  | "marketShare"
  | "competitiveLandscape"
  | "brandStrength"
  | "pricing"
  | "volume"
  | "managementCommentary"
  | "industryGrowth"
  | "risks"
  | "catalysts"
  | "moat"
  | "thesis"
  | "workingCapital"
  | "marginMechanism"
  | "valuationExpectations";

export interface DiscoveryGap {
  area: DiscoveryArea;
  question: string;
  why: string;
  status: "filled" | "partial" | "missing";
  evidenceItems: EvidenceItem[];
  /** Highest source tier available (1=filing … 6=inference). */
  sourceTier: number;
}

export interface MoatSeed {
  source: string;
  chain: string;
  evidence: string;
  durability: string;
  threatsToDurability: string;
  factIds: string[];
  confidence: number;
}

export interface CatalystSeed {
  catalyst: string;
  mechanism: string;
  timeframe?: string;
  observableKpi?: string;
  direction?: "positive" | "negative" | "mixed";
  forecastImpact?: string;
  valuationImpact?: string;
  invalidation?: string;
  quantitative: boolean;
  factIds: string[];
}

export interface RiskSeed {
  risk: string;
  mechanism: string;
  affectedKpi: string;
  financialConsequence: string;
  valuationConsequence: string;
  monitoringIndicator: string;
  factIds: string[];
}

export interface CompetitiveSeed {
  company: string;
  businessOverlap: string;
  economicSimilarity: string;
  keyDifference: string;
  relativeStrengths: string;
  relativeWeaknesses: string;
  segment?: string;
  /** "operating" = real product rival; "valuation" = peer multiple comp only. */
  relationship: "operating" | "valuation" | "both";
}

export interface ResearchDiscoveryPack {
  ticker: string;
  generatedAt: string;
  gaps: DiscoveryGap[];
  evidenceItems: EvidenceItem[];
  /** Deterministic economic insights (CCC chain, margin trajectory, ROIC interpretation). */
  economicInsights: string[];
  moatSeeds: MoatSeed[];
  catalystSeeds: CatalystSeed[];
  riskSeeds: RiskSeed[];
  competitiveSeeds: CompetitiveSeed[];
  /** How forecast margin path is supposed to move (e.g. gross recovery + pricing − brand spend). */
  marginMechanism?: string;
  /** Supplier financing → negative CCC → FCF conversion → capital returns chain. */
  workingCapitalChain?: string;
  /** Why ROIC may be extreme (low invested capital, negative WC, cash-heavy BS). */
  roicInterpretation?: string;
  /** 5-year intrinsic DCF vs 12-month target framing. */
  targetPriceMethodology?: string;
  coverage: { filled: number; partial: number; missing: number; total: number };
  summary: string;
  /** True when AI (not just mechanical collection) ran. */
  aiUsed: boolean;
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
  safeRange?: { min?: number; max?: number };
  sourceFactIds?: string[];
  evidenceIds?: string[];
  dependencies?: string[];
  statement?: "incomeStatement" | "balanceSheet" | "cashFlow";
  terminal?: boolean;
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
  id?: string;
  baseFactId?: string;
  factId?: string;
  dimension?: string;
  statement?: "incomeStatement" | "balanceSheet" | "cashFlow";
  safeRange?: { min?: number; max?: number };
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
  safeRange?: { min?: number; max?: number };
  factIds?: string[];
  evidenceIds?: string[];
  valuePath?: number[];
  path?: number[];
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
  modelId?: string;
  forecastId?: string;
  version?: string;
  outputs?: string[];
  architecture?: string;
  basePeriod?: string;
  statementOutputs?: Record<string, string[]>;
  validation?: {
    valid: boolean;
    issues: string[];
  };
}

export interface ForecastStatementYear {
  period: string;
  values: Record<string, number | undefined>;
  provenance: Record<string, ProvenanceTier>;
  missing?: string[];
  missingValues?: string[];
  nullValues?: string[];
  explicitValues?: Record<string, number | null>;
  nullableValues?: Record<string, number | null>;
  factIds?: Record<string, string>;
}

export type ForecastStatus = "ready" | "blocked" | "incomplete";

export interface ForecastValidationSummary {
  valid: boolean;
  issues: string[];
}

export interface ForecastResult {
  incomeStatement: ForecastStatementYear[];
  balanceSheet: ForecastStatementYear[];
  cashFlow: ForecastStatementYear[];
  /** Identity checks performed by the deterministic engine. */
  identityChecks: Array<{ check: string; pass: boolean; detail?: string; critical?: boolean; code?: string; actual?: number; expected?: number; tolerance?: number }>;
  status?: ForecastStatus;
  publicationStatus?: ForecastStatus;
  blockers?: string[];
  publicationBlocked?: boolean;
  validation?: ForecastValidationSummary;
  architecture?: string;
  modelValidation?: ForecastValidationSummary;
  forecastId?: string;
  modelId?: string;
}

// ─────────────────────────────────────────────
// Valuation (AI selects; code executes)
// ─────────────────────────────────────────────

export type ValuationMethodId =
  | "FCFF DCF"
  | "FCFE"
  | "Residual Income"
  | "DDM"
  | "P/E"
  | "EV/EBITDA"
  | "EV/Sales"
  | "P/B"
  | "SOTP"
  | "NAV";

export type ValuationExecutionStatus =
  | "ready"
  | "blocked"
  | "unavailable"
  | "unsupported"
  | "not_applicable"
  | "failed";

export interface ValuationDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  field?: string;
}

export interface ValuationTerminalPolicy {
  growth: number;
  maxValueShare: number;
  terminalMetric: "fcff" | "fcfe" | "dividend" | "residual_income" | "none";
  rationale: string;
  evidenceIds?: string[];
}

export interface ValuationEvidence {
  id: string;
  factIds?: string[];
  source?: string;
  claim?: string;
}

export interface ValuationComponent {
  id: string;
  name: string;
  value: number;
  basis: "enterprise" | "equity" | "asset" | "liability";
  method: string;
  rationale: string;
  factIds: string[];
  evidenceIds: string[];
  probability?: number;
}

export interface ValuationMethodPlan {
  method?: ValuationMethodId | string;
  rationale: string;
  variablesDrivingValuation: string[];
  assumptions: Assumption[];
  discountRate?: number;
  discountRateRationale?: string;
  terminalAssumptions?: { growth: number; rationale: string };
  terminalPolicy?: ValuationTerminalPolicy;
  components?: ValuationComponent[];
  evidence?: ValuationEvidence[];
  evidenceIds?: string[];
  discountRateEvidenceIds?: string[];
  terminalGrowthEvidenceIds?: string[];
  sensitivityVariables?: string[];
}

export interface ValuationSpecification extends ValuationMethodPlan {
  methodology: string;
  specId?: string;
  modelId?: string;
  selectedMethod?: ValuationMethodId | string;
  architecture?: string;
  methodsConsidered: Array<{ method: string; verdict: "selected" | "rejected"; reason: string }>;
  methodPlans?: ValuationMethodPlan[];
}

export interface ValuationBridgeStep {
  label: string;
  from: "enterprise" | "equity" | "per_share";
  to: "enterprise" | "equity" | "per_share";
  amount?: number;
  rate?: number;
}

export interface ValuationBridge {
  basis: "enterprise_to_equity" | "equity_to_per_share" | "equity_value" | "enterprise_value";
  enterpriseValue?: number;
  equityValue?: number;
  netDebt?: number;
  debt?: number;
  cash?: number;
  sharesOutstanding?: number;
  fairValuePerShare?: number;
  currentPrice?: number;
  steps: ValuationBridgeStep[];
}

export interface ValuationProvenanceInput {
  name: string;
  value?: number;
  unit: string;
  provenance: ProvenanceTier;
  factIds?: string[];
  evidenceIds?: string[];
  source?: string;
}

export interface ValuationProvenance {
  valuationId: string;
  method: string;
  specId?: string;
  modelId?: string;
  forecastId?: string;
  factPackId?: string;
  architecture?: string;
  inputs: ValuationProvenanceInput[];
}

export interface ValuationResult {
  methodology: string;
  fairValuePerShare?: number;
  fairValueEquity?: number;
  enterpriseValue?: number;
  outputs: Record<string, number | undefined>;
  upsidePct?: number;
  executedFrom: ValuationSpecification;
  id?: string;
  method?: string;
  status?: ValuationExecutionStatus;
  bridge?: ValuationBridge;
  provenance?: ValuationProvenance;
  diagnostics?: ValuationDiagnostic[];
  blockers?: string[];
  publicationBlocked?: boolean;
  paths?: Record<string, number[]>;
}

export interface ValuationMethodSuitability {
  score: number;
  label: "high" | "medium" | "low" | "inapplicable";
  applicableArchitectures: string[];
  reasons: string[];
}

export interface ValuationDataSufficiency {
  score: number;
  label: "sufficient" | "partial" | "insufficient";
  requiredFacts: string[];
  missingFacts: string[];
  requiredForecastLines: string[];
  missingForecastLines: string[];
  requiredAssumptions: string[];
  missingAssumptions: string[];
  evidenceIds: string[];
  missingEvidence: string[];
}

export interface ValuationMatrixEntry extends ValuationResult {
  methodId: ValuationMethodId;
  suitability: ValuationMethodSuitability;
  dataSufficiency: ValuationDataSufficiency;
  selected: boolean;
  sensitivityRank: number | null;
}

export interface ValuationDisagreement {
  minimum: number;
  p25: number;
  median: number;
  p75: number;
  maximum: number;
  spreadPct: number;
  coefficientOfVariation: number;
  methodCount: number;
  outliers: Array<{ method: string; fairValuePerShare: number; deviationPct: number }>;
}

export interface ValuationMatrix {
  valuationId: string;
  modelId?: string;
  forecastId?: string;
  factPackId?: string;
  status: ValuationExecutionStatus;
  selectedMethod: ValuationMethodId | null;
  primaryMethod: ValuationMethodId | null;
  primaryValuationId: string | null;
  methods: ValuationMatrixEntry[];
  crossCheck: {
    status: ValuationExecutionStatus;
    diagnostics: ValuationDiagnostic[];
    disagreement?: ValuationDisagreement;
    comparablePairs: Array<{ left: string; right: string; spreadPct: number }>;
  };
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
  publicationBlocked: boolean;
}

// ─────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────

export interface ScenarioVariableChange {
  variable: string;
  baseValue?: number;
  scenarioValue: number;
  rationale: string;
  path?: number[];
  modelVariableId?: string;
}

export interface ScenarioClosureCheck {
  id: string;
  statement: "incomeStatement" | "balanceSheet" | "cashFlow";
  period: string;
  passed: boolean;
  actual?: number;
  expected?: number;
  detail?: string;
}

export interface ScenarioClosure {
  status: "passed" | "failed" | "blocked";
  passed: boolean;
  checks: ScenarioClosureCheck[];
  diagnostics: ValuationDiagnostic[];
}

export interface ScenarioSpecification {
  name: "bear" | "base" | "bull";
  changedVariables: ScenarioVariableChange[];
  targetPrice?: number;
  targetProvenance: ProvenanceTier;
  id?: string;
  probability?: number;
  status?: "ready" | "blocked" | "invalid";
  forecast?: ForecastResult;
  valuation?: ValuationResult;
  bridge?: ValuationBridge;
  closure?: ScenarioClosure;
  diagnostics?: ValuationDiagnostic[];
  blockers?: string[];
  publicationBlocked?: boolean;
}

export interface ScenarioSetValidation {
  valid: boolean;
  status: "ready" | "blocked" | "invalid";
  scenarioIds: string[];
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
  publicationBlocked: boolean;
}

export interface SensitivityRun {
  id: string;
  variable: string;
  source: "valuation" | "forecast";
  method: string;
  lowValue: number;
  baseValue: number;
  highValue: number;
  values: number[];
  fairValues: Array<number | null>;
  baseFairValue: number | null;
  fairValueRange: number | null;
  rangePct: number | null;
  modelExecutions: number;
  status: ValuationExecutionStatus;
  diagnostics: ValuationDiagnostic[];
}

export interface SensitivityAnalysis {
  id: string;
  valuationId?: string;
  method: string;
  status: ValuationExecutionStatus;
  runs: SensitivityRun[];
  rankedVariables: string[];
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
  publicationBlocked: boolean;
}

export type MonteCarloDistribution =
  | { type: "uniform"; min: number; max: number }
  | { type: "normal"; mean: number; standardDeviation: number; min: number; max: number }
  | { type: "triangular"; min: number; mode: number; max: number };

export interface MonteCarloVariable {
  variable: string;
  source: "valuation" | "forecast";
  distribution: MonteCarloDistribution;
}

export interface MonteCarloPercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloRange {
  low: number;
  high: number;
}

export interface MonteCarloDriver {
  variable: string;
  source: "valuation" | "forecast";
  absoluteCorrelation: number;
  contributionScore: number;
}

export interface MonteCarloResult {
  id: string;
  valuationId?: string;
  method: string;
  status: ValuationExecutionStatus;
  seed: number;
  requestedSamples: number;
  acceptedSamples: number;
  rejectedSamples: number;
  attemptedSamples: number;
  fairValue: MonteCarloPercentiles;
  returnPct: MonteCarloPercentiles;
  centralRange: MonteCarloRange;
  downsideRange: MonteCarloRange;
  upsideRange: MonteCarloRange;
  probabilityOfUpside: number;
  currentPrice?: number;
  keyVarianceDrivers: MonteCarloDriver[];
  samples?: Array<Record<string, number>>;
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
  publicationBlocked: boolean;
}

export type ReverseVariableId = "revenueCagr" | "ebitMargin" | "nim" | "roe" | "arpu";

export interface ReverseValuationPlan {
  id: string;
  variable: ReverseVariableId;
  why: string;
  unit: "decimal" | "currency";
  range: { min: number; max: number };
  economicLinkage: string;
  forecastLinkage: string;
  modelVariable: string;
  forecastLine: string;
  method: string;
  factIds: string[];
  evidenceIds: string[];
  status?: "viable" | "unavailable" | "invalid";
  diagnostics?: ValuationDiagnostic[];
  blockers?: string[];
  publicationBlocked?: boolean;
}

export interface ReverseConvergence {
  converged: boolean;
  iterations: number;
  evaluations: number;
  tolerance: number;
  residual: number;
  bracket: { low: number; high: number };
  monotonic: boolean;
}

export interface ReverseValuationResult {
  id: string;
  variable: string;
  requiredValue?: number;
  interpretation: string;
  status: ValuationExecutionStatus;
  plan?: ReverseValuationPlan;
  targetPrice?: number;
  convergence?: ReverseConvergence;
  valuation?: ValuationResult;
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
  publicationBlocked: boolean;
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

export interface ArtifactTraceability {
  factIds: string[];
  modelIds: string[];
  scenarioIds: string[];
  sensitivityIds: string[];
  valuationIds: string[];
}

export interface FinancialImpactContract {
  statement: "incomeStatement" | "balanceSheet" | "cashFlow" | "valuation";
  line: string;
  direction: "positive" | "negative" | "mixed";
  unit: string;
  scenarioIds: string[];
  description?: string;
}

export interface ValuationImpactContract {
  methodId: string;
  metric: "fair_value_per_share" | "enterprise_value" | "equity_value" | "return";
  direction: "positive" | "negative" | "mixed";
  sensitivityIds: string[];
  scenarioIds: string[];
  description?: string;
}

export interface Catalyst {
  catalyst: string;
  mechanism: string;
  financialVariable: string;
  forecastImpact?: string;
  valuationImpact?: string;
  quantitative: boolean;
  timeframe?: string;
  observableKpi?: string;
  direction?: "positive" | "negative" | "mixed";
  invalidation?: string;
  id?: string;
  traceability?: ArtifactTraceability;
  financialImpactContract?: FinancialImpactContract;
  valuationImpactContract?: ValuationImpactContract;
}

export interface Risk {
  risk: string;
  mechanism: string;
  affectedKpi: string;
  financialConsequence: string;
  valuationConsequence: string;
  monitoringIndicator: string;
  id?: string;
  traceability?: ArtifactTraceability;
  financialImpactContract?: FinancialImpactContract;
  valuationImpactContract?: ValuationImpactContract;
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
  researchPlan?: import("@/lib/ai-first/research-planner").ResearchPlan;
  retrieval?: ResearchRetrievalResult;
  evidenceRegistry?: CanonicalEvidenceRegistry;
  lineage?: ResearchLineageGraph;
  /** Economic peer discovery — separate operating, valuation, competitive and benchmark sets. */
  peerDiscovery?: import("@/lib/peer-discovery/types").PeerDiscoveryResult;
  /** Normalized 5Y/10Y history with restatement chains, corporate actions and trend breaks. */
  normalizedHistory?: import("@/lib/history/types").NormalizedHistoryResult;
  /** Deterministic reported vs cash vs normalized earnings assessment. */
  earningsQuality?: import("@/lib/earnings-quality/types").EarningsQualityAssessment;
  /** Structured capital-allocation ledger with allocation diagnostics. */
  capitalAllocationLedger?: import("@/lib/capital-allocation/types").CapitalAllocationLedger;
  /** Dated management KPI promise ledger with variance, status and confidence. */
  managementCredibility?: import("@/lib/management-credibility/types").ManagementCredibilityLedger;
  /** Separate historical / management / consensus / APEX guidance tracks with revision history. */
  guidanceReconciliation?: import("@/lib/guidance-reconciliation").GuidanceReconciliation;
  /** Data / model / assumption / forecast / valuation / overall confidence decomposition. */
  confidenceDecomposition?: import("@/lib/research-package/confidence").ConfidenceDecomposition;
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
  valuationMatrix?: ValuationMatrix;
  scenarios: ScenarioSpecification[];
  scenarioValidation?: ScenarioSetValidation;
  thesis: ThesisSpecification;
  catalysts: Catalyst[];
  risks: Risk[];
  competitiveAnalysis: CompetitorAnalysis;
  moat: MoatAnalysis;
  managementAnalysis: string;
  capitalAllocation: string;
  financialQuality: string;
  sensitivity: Array<Record<string, number | string>>;
  sensitivityAnalysis?: SensitivityAnalysis;
  monteCarlo?: MonteCarloResult;
  reverseValuation: { variable: string; requiredValue: number; interpretation: string } | null;
  reverseValuationResult?: ReverseValuationResult | null;
  reverseValuationPlan?: ReverseValuationPlan | null;
  conclusion: string;
  artifactIds?: {
    factPackId?: string;
    modelIds: string[];
    forecastIds: string[];
    valuationIds: string[];
    scenarioIds: string[];
    sensitivityIds: string[];
    monteCarloIds: string[];
    reverseIds: string[];
    retrievalIds?: string[];
    documentIds?: string[];
    evidenceIds?: string[];
  };

  /** Content-intelligence artifacts (optional — populated when stages run). */
  economicEngine?: EconomicEngine;
  debates?: Debate[];
  evidenceMap?: EvidenceMap;
  /** Research-discovery pack: gaps identified + evidence collected + seeds for writers. */
  researchDiscovery?: ResearchDiscoveryPack;

  /** Quality control trail. */
  reviews: ReviewFinding[];
  reviewPassed: boolean;
  regenerationLog: string[];
  canonicalQa?: import("@/lib/canonical-qa/types").CanonicalQaResult;
  reproducibility?: import("@/lib/canonical-qa/types").ReproducibilityMetadata;
  qaDecision?: import("@/lib/canonical-qa/types").CanonicalQaDecision;
  regenerationAttempts?: import("@/lib/canonical-qa/types").RegenerationAttempt[];
  auditPackageHash?: string;
  auditPackage?: import("@/lib/canonical-qa/types").MachineAuditPackage;
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
