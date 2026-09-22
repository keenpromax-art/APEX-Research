/**
 * APEX RESEARCH — AI MODEL BUILDER
 *
 * The AI dynamically produces the model specification: forecast variables,
 * EXPLICIT formulas (Revenue = Volume × ASP, NII = InterestIncome −
 * InterestExpense, ...), assumptions. No hardcoded sector equations.
 */
import type {
  FactPack,
  CompanyUnderstanding,
  Formula,
  ForecastVariable,
  Assumption,
  ForecastSpecification,
  BusinessDriver,
  KpiDefinition,
} from "./types";
import { parseLlmJson } from "./llm";

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
}

/** The complete per-company research model specification, generated dynamically by AI. */
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
  confidence: number; // 0..1 overall confidence in this model
}

const SYSTEM_PROMPT = `You are a financial modeling agent on an institutional equity research desk. You receive a company understanding (from a prior AI stage) plus the yfinance statement lines available. Design the financial model DYNAMICALLY for this company.

RULES:
- Derive formulas from the company's economics. No generic corporate/sector equations.
- Every formula explains WHY the relationship fits THIS company.
- Formulas are machine-executable expressions over forecast variables, e.g. "volume * asp", "interestIncome - interestExpense".
- Every variable maps to a yfinance statement line when one exists (baseValue = latest yfinance value) or is declared an AI-forecast input.
- Never invent historical numbers. Never zero-fill missing data.

Respond with ONLY JSON:
{
  "horizonYears": 5,
  "horizonRationale": "string",
  "variables": [{ "name": "string", "label": "string", "baseValue": null, "unit": "string", "kind": "input", "statementLine": null }],
  "formulas": [{ "id": "F1", "equation": "Revenue = Volume x ASP", "expression": "volume * asp", "output": "revenue", "variables": ["volume", "asp"], "explanation": "string", "sourceFacts": ["string"], "confidence": 0.9 }],
  "assumptions": [{ "id": "A1", "assumption": "string", "variable": "string", "value": 0.08, "unit": "%", "period": "Y1", "rationale": "string", "historicalEvidence": "string citing [F-...] ids", "confidence": 0.8 }],
  "driverPaths": { "volume": [0.08, 0.06] }
}
Note: growth rates and ratio assumptions are DECIMALS (0.08 = 8%).`;
/** Compact MODEL_CONTEXT (Principle 33): statement lines + drivers + anchors. */
export function modelContext(input: ModelBuilderInput): string {
  const { pack, understanding } = input;
  const lineNames = (sec: { facts: Array<{ metric: string }> }) =>
    [...new Set(sec.facts.map((f) => f.metric))].join(", ");
  const incomeLines = lineNames(pack.incomeStatement);
  const balanceLines = lineNames(pack.balanceSheet);
  const cashLines = lineNames(pack.cashFlow);
  const latestPeriod = (sec: { facts: Array<{ metric: string; period: string }> }): string => {
    const periods = [...new Set(sec.facts.map((f) => f.period))].filter(Boolean);
    return periods[0] || "";
  };
  const latestIncome = latestPeriod(pack.incomeStatement);
  const latestBalance = latestPeriod(pack.balanceSheet);
  const lastRevenue = pack.incomeStatement.facts.find((f) => /revenue/i.test(f.metric) && f.period === latestIncome)?.value;
  const lastEquity = pack.balanceSheet.facts.find((f) => /equity/i.test(f.metric) && f.period === latestBalance)?.value;
  const lastNii = pack.incomeStatement.facts.find((f) => /netInterest|net interest/i.test(f.metric) && f.period === latestIncome)?.value;
  const price = pack.market.facts.find((f) => f.metric === "currentPrice")?.value;
  const shares = pack.market.facts.find((f) => f.metric === "sharesOutstanding")?.value;

  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `Primary economic abstraction: ${understanding.primaryEconomicAbstraction}`,
    `How it makes money: ${understanding.howItMakesMoney}`,
    "",
    "DRIVERS (from understanding stage):",
    ...understanding.revenueDrivers.map((d) => `- ${d.name}: ${d.mechanism}`),
    ...understanding.costDrivers.map((d) => `- ${d.name}: ${d.mechanism} [cost]`),
    ...understanding.marginDrivers.map((d) => `- ${d.name}: ${d.mechanism} [margin]`),
    ...understanding.metricsToAvoid.map((m) => `- AVOID: ${m.metric} — ${m.reason}`),
    "",
    "KEY KPIS:",
    ...understanding.keyKpis.map((k) => `- ${k.name} (${k.availability}): ${k.rationale}`),
    "",
    "AVAILABLE STATEMENT LINES (fact IDs are [F-metricKey]):",
    `incomeStatement: ${incomeLines}`,
    `balanceSheet: ${balanceLines}`,
    `cashFlow: ${cashLines}`,
    "",
    `LATEST YEAR: ${latestIncome || "N/A"}`,
    `LATEST REVENUE: ${lastRevenue ?? "Not available from yfinance"}`,
    `LATEST EQUITY: ${lastEquity ?? "Not available from yfinance"}`,
    `LATEST NII (if bank): ${lastNii ?? "N/A"}`,
    `CURRENT PRICE: ${price ?? "N/A"}`,
    `CURRENT SHARES: ${shares ?? "N/A"}`,
  ].join("\n");
}
/** AI model specification. transport calls the LLM; normalization + validation below. */
export async function buildModelSpec(
  transport: ModelTransport,
  input: ModelBuilderInput
): Promise<ForecastSpecification> {
  const { pack, understanding } = input;
  const ctx = modelContext(input);
  const user = `RESEARCH CONTEXT
================
${ctx}

TASK
====
Design the financial model for ${understanding.companyName} now.

OUTPUT
======
Respond with ONLY the JSON object.`;

  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.25, maxTokens: 3500, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed) throw new Error(`AI model builder agent returned unparseable output for ${pack.ticker}`);

  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const variables: ForecastVariable[] = arr(parsed.variables).map((v): ForecastVariable => ({
    name: String(v?.name || "").trim(),
    label: String(v?.label || v?.name || ""),
    baseValue: typeof v?.baseValue === "number" && isFinite(v.baseValue) ? v.baseValue : undefined,
    unit: String(v?.unit || "currency"),
    kind: v?.kind === "computed" ? "computed" : "input",
    statementLine: typeof v?.statementLine === "string" && v.statementLine !== "null" ? v.statementLine : undefined,
  })).filter((v) => v.name);

  const formulas: Formula[] = arr(parsed.formulas).map((f, i) => ({
    id: String(f?.id || `F${i + 1}`),
    equation: String(f?.equation || ""),
    expression: String(f?.expression || ""),
    output: String(f?.output || ""),
    variables: Array.isArray(f?.variables) ? f.variables.map(String) : [],
    explanation: String(f?.explanation || ""),
    sourceFacts: Array.isArray(f?.sourceFacts) ? f.sourceFacts.map(String) : [],
    confidence: typeof f?.confidence === "number" ? f.confidence : 0.7,
  })).filter((f) => f.expression && f.output);

  const assumptions: Assumption[] = arr(parsed.assumptions).map((a, i) => ({
    id: String(a?.id || `A${i + 1}`),
    assumption: String(a?.assumption || ""),
    variable: String(a?.variable || ""),
    value: typeof a?.value === "number" && isFinite(a.value) ? a.value : 0,
    unit: String(a?.unit || "%"),
    period: String(a?.period || "Y1"),
    rationale: String(a?.rationale || ""),
    historicalEvidence: String(a?.historicalEvidence || ""),
    confidence: typeof a?.confidence === "number" ? a.confidence : 0.7,
  })).filter((a) => a.variable && isFinite(a.value));

  const driverPaths: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(parsed.driverPaths || {})) {
    if (Array.isArray(v)) {
      driverPaths[String(k)] = v.map((x) => (typeof x === "number" && isFinite(x) ? x : 0));
    }
  }

  const horizon = typeof parsed.horizonYears === "number" && parsed.horizonYears >= 1 && parsed.horizonYears <= 10
    ? Math.round(parsed.horizonYears)
    : 5;
  return {
    horizonYears: horizon,
    horizonRationale: String(parsed.horizonRationale || ""),
    variables,
    formulas,
    assumptions,
    driverPaths,
  };
}

export default buildModelSpec;
