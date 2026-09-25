import type {
  FactPack,
  CompanyUnderstanding,
  Formula,
  ForecastVariable,
  Assumption,
  ForecastSpecification,
  BusinessDriver,
  KpiDefinition,
  EconomicEngine,
  ThesisEngineOutput,
} from "./types";
import { parseLlmJson } from "./llm";
import { buildHistoricalAnalysisPack } from "./historical-analysis";
import { DEPTH_DIRECTIVES, DEPTH_TOKEN_BUDGETS } from "./depth-guidance";
import { canonicalizeModelSpecReferences, ModelSpecValidationError, validateModelSpec } from "./model-spec-validator";
import { selectLatestFact } from "./fact-pack";

export type ModelTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface ModelBuilderInput {
  pack: FactPack;
  understanding: CompanyUnderstanding;
  engine?: EconomicEngine;
  debates?: ThesisEngineOutput;
}

export interface AIResearchModel {
  companyUnderstanding: CompanyUnderstanding;
  historicalFacts: FactPack;
  revenueDrivers: BusinessDriver[];
  costDrivers: BusinessDriver[];
  marginDrivers: BusinessDriver[];
  balanceSheetDrivers: BusinessDriver[];
  cashFlowDrivers: BusinessDriver[];
  keyKpis: KpiDefinition[];
  forecastVariables: ForecastVariable[];
  formulas: Formula[];
  assumptions: Assumption[];
  confidence: number;
}

const SYSTEM_PROMPT = `You are a financial modeling agent on an institutional equity research desk. You receive a company understanding, economic engine statement bindings, research debates, canonical facts, and deterministic historical metrics. Design the financial model dynamically for this company.

ECONOMIC EQUATION DISCOVERY:
1. Identify the physical revenue, cost, margin, cash, balance-sheet, and capital mechanisms for this company.
2. Declare measurable variables that are observable in canonical facts, derived from them, or explicitly estimated.
3. Use only variables declared in the model and cite their canonical factId values in sourceFacts and historicalEvidence.
4. Encode debate-driven mechanisms as variables or driver paths.
5. Use safe arithmetic expressions only: identifiers, numeric literals, +, -, *, /, and parentheses. No functions, code, or invented facts.

RULES:
- Formulas must be economically necessary, machine-executable, and have exactly the variables used by the expression.
- Historical base values must equal the latest canonical fact value when a variable maps to a fact. Never invent or zero-fill missing history.
- Every input driver path must contain exactly horizonYears finite rates. Rates are decimals, so 0.08 means 8 percent.
- Formula outputs must be connected to another formula or a declared statement output.
- Use canonical factId references such as FACT-...; legacy metric references are accepted only for compatibility and are normalized by the builder.
- Generate only economically required assumptions.

Respond with ONLY JSON:
{
  "horizonYears": 5,
  "horizonRationale": "string",
  "variables": [{ "id": "V1", "name": "string", "label": "string", "baseValue": null, "baseFactId": "FACT-...", "unit": "string", "kind": "input", "statementLine": null }],
  "formulas": [{ "id": "F1", "equation": "string", "expression": "volume * asp", "output": "revenue", "variables": ["volume", "asp"], "explanation": "string", "sourceFacts": ["FACT-..."], "confidence": 0.9 }],
  "assumptions": [{ "id": "A1", "assumption": "string", "variable": "string", "value": 0.08, "unit": "%", "period": "Y1", "rationale": "string", "historicalEvidence": "FACT-...", "confidence": 0.8 }],
  "driverPaths": { "volume": [0.08, 0.06] }
}

${DEPTH_DIRECTIVES.model}`;

function periodScore(period: string | undefined): number {
  if (!period) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(period);
  if (Number.isFinite(parsed)) return parsed;
  const year = period.match(/(?:19|20)\d{2}/)?.[0];
  return year ? Number(year) : Number.NEGATIVE_INFINITY;
}

function lineNames(section: { facts: Array<{ metric: string; factId?: string }> }): string {
  return [...new Map(section.facts.map((fact) => [fact.metric, fact.factId ? `${fact.metric} [${fact.factId}]` : fact.metric])).values()].join(", ");
}

function latestValue(pack: FactPack, metric: string): number | undefined {
  return selectLatestFact(pack, metric)?.value;
}

function latestPeriod(pack: FactPack): string {
  return pack.incomeStatement.facts
    .filter((fact) => fact.period !== "current")
    .sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period))[0]?.reportingPeriod
    ?? pack.incomeStatement.facts[0]?.period
    ?? "";
}

export function modelContext(input: ModelBuilderInput): string {
  const { pack, understanding, engine, debates } = input;
  const incomeLines = lineNames(pack.incomeStatement);
  const balanceLines = lineNames(pack.balanceSheet);
  const cashLines = lineNames(pack.cashFlow);
  const latestIncome = latestPeriod(pack);
  const lastRevenue = latestValue(pack, "totalRevenue") ?? latestValue(pack, "revenue");
  const lastEquity = latestValue(pack, "totalEquity") ?? latestValue(pack, "stockholdersEquity");
  const lastNii = latestValue(pack, "netInterestIncome") ?? latestValue(pack, "netInterest");
  const price = latestValue(pack, "currentPrice");
  const shares = latestValue(pack, "sharesOutstanding");
  let derivedBlock = "";
  try {
    derivedBlock = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 40).join("\n");
  } catch {
    derivedBlock = "(historical derived metrics unavailable)";
  }
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `What it does: ${String(understanding.whatItDoes).slice(0, 700)}`,
    `Primary economic abstraction: ${understanding.primaryEconomicAbstraction}`,
    `How it makes money: ${understanding.howItMakesMoney}`,
    `Industry: ${String(understanding.industryContext).slice(0, 500)}`,
    `Why this company: ${(understanding.whyThisCompany || "").slice(0, 400) || "(n/a)"}`,
    "",
    "DRIVERS (from understanding stage):",
    ...understanding.revenueDrivers.map((driver) => `- ${driver.name}: ${driver.mechanism}`),
    ...understanding.costDrivers.map((driver) => `- ${driver.name}: ${driver.mechanism} [cost]`),
    ...understanding.marginDrivers.map((driver) => `- ${driver.name}: ${driver.mechanism} [margin]`),
    ...understanding.balanceSheetDrivers.map((driver) => `- ${driver.name}: ${driver.mechanism} [BS]`),
    ...understanding.cashGenerationDrivers.map((driver) => `- ${driver.name}: ${driver.mechanism} [cash]`),
    ...understanding.returnsDrivers.map((driver) => `- ${driver.name}: ${driver.mechanism} [returns]`),
    ...(understanding.capitalEngines || []).map((driver) => `- ${driver.name}: ${driver.mechanism} [capital]`),
    ...understanding.metricsToAvoid.map((metric) => `- AVOID: ${metric.metric} — ${metric.reason}`),
    "",
    ...(engine
      ? [
          "ECONOMIC ENGINE STATEMENT BINDINGS (map drivers to forecast rows):",
          ...engine.statementBindings.map((binding) => `- ${binding.statementLine} ← ${binding.drivenBy}: ${binding.mechanism}`),
          `Value questions: ${engine.valueQuestions.join(" | ") || "none"}`,
          "",
        ]
      : []),
    ...(debates?.debates?.length
      ? [
          "RESEARCH DEBATES (forecast must encode their drivers — not prose):",
          ...debates.debates.map((debate) => `- ${debate.debate} | FOR: ${debate.evidenceFor[0]?.evidence.slice(0, 100) || "—"} | AGAINST: ${debate.evidenceAgainst[0]?.evidence.slice(0, 100) || "—"} | financial: ${debate.financialConsequence || "n/a"} | valuation: ${debate.valuationConsequence || "n/a"}`),
           `Central thesis: ${debates.thesis.slice(0, 300)}`,
          "",
        ]
      : []),
    "KEY KPIS:",
    ...understanding.keyKpis.map((kpi) => `- ${kpi.name} (${kpi.availability}): ${kpi.rationale}`),
    "",
    "HISTORICAL DERIVED (deterministic from canonical facts — use for assumption grounding):",
    derivedBlock,
    "",
    "AVAILABLE STATEMENT LINES (canonical factId references):",
    `incomeStatement: ${incomeLines}`,
    `balanceSheet: ${balanceLines}`,
    `cashFlow: ${cashLines}`,
    "",
    `LATEST YEAR: ${latestIncome || "N/A"}`,
    `LATEST REVENUE: ${lastRevenue ?? "Not available from canonical facts"}`,
    `LATEST EQUITY: ${lastEquity ?? "Not available from canonical facts"}`,
    `LATEST NII (if applicable): ${lastNii ?? "N/A"}`,
    `CURRENT PRICE: ${price ?? "N/A"}`,
    `CURRENT SHARES: ${shares ?? "N/A"}`,
    `CONFIDENCE: ${understanding.confidence.overall} — ${understanding.confidence.reasoning.slice(0, 200)}`,
  ].join("\n");
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rawVariable(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeModelShape(parsed: Record<string, unknown>): ForecastSpecification {
  const variables = array(parsed.variables).map((value) => {
    const raw = rawVariable(value);
    return {
      ...raw,
      name: raw.name,
      label: raw.label ?? raw.name,
      unit: raw.unit,
      kind: raw.kind,
      ...(raw.baseValue !== undefined ? { baseValue: raw.baseValue } : {}),
      ...(raw.statementLine !== undefined ? { statementLine: raw.statementLine } : {}),
    } as unknown as ForecastVariable;
  });
  const formulas = array(parsed.formulas).map((value) => {
    const raw = rawVariable(value);
    return {
      ...raw,
      id: raw.id,
      equation: raw.equation,
      expression: raw.expression,
      output: raw.output,
      variables: rawArray(raw.variables),
      explanation: raw.explanation,
      sourceFacts: rawArray(raw.sourceFacts),
      confidence: raw.confidence,
    } as unknown as Formula;
  });
  const assumptions = array(parsed.assumptions).map((value) => {
    const raw = rawVariable(value);
    return {
      ...raw,
      id: raw.id,
      assumption: raw.assumption,
      variable: raw.variable,
      value: raw.value,
      unit: raw.unit,
      period: raw.period,
      rationale: raw.rationale,
      historicalEvidence: raw.historicalEvidence,
      confidence: raw.confidence,
      factIds: rawArray(raw.factIds),
      evidenceIds: rawArray(raw.evidenceIds),
    } as unknown as Assumption;
  });
  const driverPaths: Record<string, number[]> = {};
  if (parsed.driverPaths !== null && typeof parsed.driverPaths === "object" && !Array.isArray(parsed.driverPaths)) {
    for (const [key, value] of Object.entries(parsed.driverPaths as Record<string, unknown>)) driverPaths[key] = rawArray(value) as number[];
  }
  return {
    horizonYears: parsed.horizonYears as number,
    horizonRationale: parsed.horizonRationale as string,
    variables,
    formulas,
    assumptions,
    driverPaths,
    ...(parsed.modelId !== undefined ? { modelId: String(parsed.modelId) } : {}),
    ...(parsed.version !== undefined ? { version: String(parsed.version) } : {}),
    ...(Array.isArray(parsed.outputs) ? { outputs: parsed.outputs.map(String) } : {}),
    ...(parsed.architecture !== undefined ? { architecture: String(parsed.architecture) } : {}),
  };
}

export async function buildModelSpec(transport: ModelTransport, input: ModelBuilderInput): Promise<ForecastSpecification> {
  const { pack, understanding } = input;
  const context = modelContext(input);
  const user = `RESEARCH CONTEXT\n================\n${context}\n\nTASK\n====\nDesign the financial model for ${understanding.companyName} now.\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const response = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.25, maxTokens: DEPTH_TOKEN_BUDGETS.model, jsonMode: true });
  const parsed = parseLlmJson<Record<string, unknown>>(response);
  if (!parsed) throw new Error(`AI model builder agent returned unparseable output for ${pack.ticker}`);
  const shape = normalizeModelShape(parsed);
  const canonical = canonicalizeModelSpecReferences(shape, pack, { fillMissingEvidence: false });
  const validation = validateModelSpec(canonical, pack, { requireEvidence: true, enforceCanonicalBases: true, allowUnresolvedBaseValues: false });
  if (!validation.valid) throw new ModelSpecValidationError(`AI model builder returned an invalid specification for ${pack.ticker}`, validation);
  return canonical;
}

export default buildModelSpec;
