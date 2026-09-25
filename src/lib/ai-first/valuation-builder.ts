import { parseLlmJson } from "./llm";
import { DEPTH_DIRECTIVES, DEPTH_TOKEN_BUDGETS } from "./depth-guidance";
import { buildHistoricalAnalysisPack } from "./historical-analysis";
import { latestFactByAliases, resolveValuationAnchors, stableId } from "./valuation-helpers";
import { normalizeValuationMethod, VALUATION_METHODS, VALUATION_METHOD_REGISTRY } from "./valuation-methods";
import type {
  Assumption,
  CompanyUnderstanding,
  EconomicEngine,
  EvidenceMap,
  Fact,
  FactPack,
  ForecastSpecification,
  ThesisEngineOutput,
  ValuationComponent,
  ValuationEvidence,
  ValuationMethodPlan,
  ValuationSpecification,
  ValuationTerminalPolicy,
} from "./types";

export type ValuationTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface ValuationBuilderInput {
  pack: FactPack;
  understanding: CompanyUnderstanding;
  forecastSpec: ForecastSpecification;
  engine?: EconomicEngine;
  debates?: ThesisEngineOutput;
  evidenceMap?: EvidenceMap;
}

const TERMINAL_METRICS: Record<string, ValuationTerminalPolicy["terminalMetric"]> = {
  "FCFF DCF": "fcff",
  FCFE: "fcfe",
  "Residual Income": "residual_income",
  DDM: "dividend",
};

const SYSTEM_PROMPT = `You are a valuation specialist and institutional valuation architect. Select valuation methods; deterministic code validates and executes them.

SUPPORTED METHODS: FCFF DCF, FCFE, Residual Income, DDM, P/E, EV/EBITDA, EV/Sales, P/B, SOTP, NAV.

RULES:
- AI selects economically suitable methods; code rejects unsupported, inapplicable, under-evidenced, or data-incomplete methods before arithmetic.
- FCFF DCF requires explicit EBIT/tax/D&A/capex/working-capital or CFO/capex paths, WACC, terminal growth below WACC, terminal value cap, shares, and net debt.
- FCFE requires explicit levered cash flow, cost of equity, terminal policy, and shares.
- Residual Income requires opening book value, EPS/net income, a book-value roll-forward, cost of equity, and terminal policy.
- DDM requires an explicit forecast DPS or total-dividend path.
- P/E, EV/EBITDA, EV/Sales, and P/B require their target multiple and method-specific earnings, EBITDA, sales, or common-book-value inputs.
- SOTP and NAV require explicit component values, consistent valuation basis, and valid fact/evidence IDs for every component.
- Never invent shares, cash, debt, or net debt. Missing facts remain blockers.
- Every method assumption and terminal input must cite valid [F-...] fact IDs or declared evidence IDs.
- Provide every executable method in methodPlans. Do not include rejected methods in methodPlans.

Respond with ONLY JSON:
{
  "methodology": "FCFF DCF",
  "rationale": "string with [F-...] evidence",
  "variablesDrivingValuation": ["string"],
  "evidenceIds": ["string"],
  "assumptions": [{"id":"AV1","assumption":"string","variable":"wacc","value":0.10,"unit":"decimal","period":"Y1-Y5","rationale":"string","historicalEvidence":"[F-...]","factIds":["F-..."],"evidenceIds":[],"confidence":0.8}],
  "discountRate": 0.10,
  "discountRateRationale": "string",
  "discountRateEvidenceIds": ["F-..."],
  "terminalAssumptions": {"growth":0.03,"rationale":"string"},
  "terminalGrowthEvidenceIds": ["F-..."],
  "terminalPolicy": {"growth":0.03,"maxValueShare":0.75,"terminalMetric":"fcff","rationale":"string","evidenceIds":["F-..."]},
  "sensitivityVariables": ["wacc","terminalGrowth"],
  "components": [{"id":"segment-a","name":"string","value":0,"basis":"enterprise|equity|asset|liability","method":"string","rationale":"string","factIds":["F-..."],"evidenceIds":[]}],
  "evidence": [{"id":"E1","factIds":["F-..."],"source":"string","claim":"string"}],
  "methodPlans": [
    {"method":"FCFF DCF","rationale":"string","variablesDrivingValuation":[],"assumptions":[],"discountRate":0.10,"terminalAssumptions":{"growth":0.03,"rationale":"string"},"terminalPolicy":{"growth":0.03,"maxValueShare":0.75,"terminalMetric":"fcff","rationale":"string","evidenceIds":[]},"evidenceIds":[],"components":[],"sensitivityVariables":[]}
  ],
  "methodsConsidered": [{"method":"FCFF DCF","verdict":"selected","reason":"string"}],
  "limitations": ["string"]
}

${DEPTH_DIRECTIVES.valuation}`;

function citedFactIds(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map((entry: unknown) => String(entry)).map((entry) => entry.replace(/^\[F-|\]$/gi, "").replace(/^F-/i, "")))].filter(Boolean);
  if (typeof value !== "string") return [];
  return [...new Set((value.match(/\[F-[^\]]+\]/gi) ?? []).map((entry) => entry.replace(/^\[F-|\]$/g, "").replace(/^F-/i, "")))].filter(Boolean);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function normalizeAssumption(raw: any, index: number, prefix = "AV"): Assumption {
  const historicalEvidence = String(raw?.historicalEvidence ?? "");
  const factIds = [...new Set([...citedFactIds(raw?.factIds), ...citedFactIds(historicalEvidence)])];
  const evidenceIds: string[] = [...new Set<string>(strings(raw?.evidenceIds))];
  return {
    id: String(raw?.id ?? `${prefix}${index + 1}`),
    assumption: String(raw?.assumption ?? ""),
    variable: String(raw?.variable ?? ""),
    value: typeof raw?.value === "number" && Number.isFinite(raw.value) ? raw.value : Number.NaN,
    unit: String(raw?.unit ?? "decimal"),
    period: String(raw?.period ?? "Y1-Y5"),
    rationale: String(raw?.rationale ?? ""),
    historicalEvidence,
    confidence: typeof raw?.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : 0.7,
    ...(factIds.length ? { factIds } : {}),
    ...(evidenceIds.length ? { evidenceIds } : {}),
    ...(Array.isArray(raw?.valuePath) && raw.valuePath.every((value: unknown) => typeof value === "number" && Number.isFinite(value)) ? { valuePath: [...raw.valuePath] } : {}),
    ...(Array.isArray(raw?.path) && raw.path.every((value: unknown) => typeof value === "number" && Number.isFinite(value)) ? { path: [...raw.path] } : {}),
    ...(raw?.safeRange && typeof raw.safeRange === "object" ? { safeRange: { ...(typeof raw.safeRange.min === "number" ? { min: raw.safeRange.min } : {}), ...(typeof raw.safeRange.max === "number" ? { max: raw.safeRange.max } : {}) } } : {}),
  };
}

function normalizeEvidence(raw: any, index: number): ValuationEvidence {
  return {
    id: String(raw?.id ?? `E${index + 1}`),
    ...(Array.isArray(raw?.factIds) ? { factIds: citedFactIds(raw.factIds) } : {}),
    ...(typeof raw?.source === "string" && raw.source ? { source: raw.source } : {}),
    ...(typeof raw?.claim === "string" && raw.claim ? { claim: raw.claim } : {}),
  };
}

function normalizeComponent(raw: any, index: number): ValuationComponent {
  const basis = raw?.basis === "equity" || raw?.basis === "asset" || raw?.basis === "liability" ? raw.basis : "enterprise";
  return {
    id: String(raw?.id ?? `component-${index + 1}`),
    name: String(raw?.name ?? `Component ${index + 1}`),
    value: typeof raw?.value === "number" && Number.isFinite(raw.value) ? raw.value : Number.NaN,
    basis,
    method: String(raw?.method ?? "explicit valuation"),
    rationale: String(raw?.rationale ?? ""),
    factIds: citedFactIds(raw?.factIds),
    evidenceIds: [...new Set(strings(raw?.evidenceIds))],
    ...(typeof raw?.probability === "number" && Number.isFinite(raw.probability) && raw.probability >= 0 && raw.probability <= 1 ? { probability: raw.probability } : {}),
  };
}

function normalizeTerminalPolicy(raw: any, fallback: { growth: number; rationale: string } | undefined, method: string, evidenceIds: string[]): ValuationTerminalPolicy | undefined {
  const source = raw && typeof raw === "object" ? raw : fallback;
  if (!source || typeof source.growth !== "number" || !Number.isFinite(source.growth)) return undefined;
  const terminalMetric = TERMINAL_METRICS[method] ?? "none";
  return {
    growth: source.growth,
    maxValueShare: typeof raw?.maxValueShare === "number" && Number.isFinite(raw.maxValueShare) ? raw.maxValueShare : 0.75,
    terminalMetric,
    rationale: String(source.rationale ?? raw?.rationale ?? ""),
    evidenceIds: [...new Set([...evidenceIds, ...strings(raw?.evidenceIds)])],
  };
}

function normalizePlan(raw: any, fallbackMethod: string, index: number): ValuationMethodPlan {
  const method = normalizeValuationMethod(raw?.method ?? fallbackMethod) ?? String(raw?.method ?? fallbackMethod);
  const assumptions = (Array.isArray(raw?.assumptions) ? raw.assumptions : []).map((assumption: any, assumptionIndex: number) => normalizeAssumption(assumption, assumptionIndex, `AV${index + 1}`));
  const evidenceIds: string[] = [...new Set<string>(strings(raw?.evidenceIds))];
  const terminalAssumptions = raw?.terminalAssumptions && typeof raw.terminalAssumptions.growth === "number" && Number.isFinite(raw.terminalAssumptions.growth)
    ? { growth: raw.terminalAssumptions.growth, rationale: String(raw.terminalAssumptions.rationale ?? "") }
    : undefined;
  const terminalEvidenceIds = [...new Set(strings(raw?.terminalGrowthEvidenceIds))];
  const terminalPolicy = normalizeTerminalPolicy(raw?.terminalPolicy, terminalAssumptions, method, terminalEvidenceIds);
  return {
    method,
    rationale: String(raw?.rationale ?? ""),
    variablesDrivingValuation: Array.isArray(raw?.variablesDrivingValuation) ? raw.variablesDrivingValuation.map((entry: unknown) => String(entry)) : [],
    assumptions,
    ...(typeof raw?.discountRate === "number" && Number.isFinite(raw.discountRate) ? { discountRate: raw.discountRate } : {}),
    ...(typeof raw?.discountRateRationale === "string" ? { discountRateRationale: raw.discountRateRationale } : {}),
    ...(terminalAssumptions ? { terminalAssumptions } : {}),
    ...(terminalPolicy ? { terminalPolicy } : {}),
    ...(Array.isArray(raw?.components) ? { components: raw.components.map(normalizeComponent) } : {}),
    ...(Array.isArray(raw?.evidence) ? { evidence: raw.evidence.map(normalizeEvidence) } : {}),
    ...(evidenceIds.length ? { evidenceIds } : {}),
    ...(Array.isArray(raw?.discountRateEvidenceIds) ? { discountRateEvidenceIds: [...new Set<string>(strings(raw.discountRateEvidenceIds))] } : {}),
    ...(terminalEvidenceIds.length ? { terminalGrowthEvidenceIds: terminalEvidenceIds } : {}),
    ...(Array.isArray(raw?.sensitivityVariables) ? { sensitivityVariables: raw.sensitivityVariables.map((entry: unknown) => String(entry)) } : {}),
  };
}

export function valuationContext(input: ValuationBuilderInput): string {
  const { pack, understanding, forecastSpec, engine, debates, evidenceMap } = input;
  const anchors = resolveValuationAnchors(pack);
  const currentPriceFact = latestFactByAliases(pack, ["currentPrice", "regularMarketPrice", "sharePrice"]);
  const inputs = forecastSpec.variables.filter((variable) => variable.kind === "input").map((variable) => `${variable.name} [unit=${variable.unit}; base=${variable.baseValue ?? "missing"}]`);
  let derivedBlock = "";
  try {
    derivedBlock = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 30).join("\n");
  } catch {
    derivedBlock = "Historical derived data unavailable.";
  }
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `ECONOMIC ABSTRACTION: ${understanding.primaryEconomicAbstraction}`,
    `HOW IT MAKES MONEY: ${String(understanding.howItMakesMoney).slice(0, 500)}`,
    `WHAT IT DOES: ${String(understanding.whatItDoes).slice(0, 500)}`,
    `ARCHITECTURE: ${forecastSpec.architecture ?? "code-selected from model/evidence"}`,
    `CURRENT PRICE: ${anchors.currentPrice ?? "missing"} ${currentPriceFact?.currency ?? ""}`,
    `SHARES: ${anchors.sharesOutstanding ?? "missing"}`,
    `CASH: ${anchors.cash ?? "missing"}`,
    `DEBT: ${anchors.debt ?? "missing"}`,
    `NET DEBT: ${anchors.netDebt ?? "missing"}`,
    `BOOK VALUE PER SHARE: ${anchors.bookValuePerShare ?? "missing"}`,
    "",
    "SUPPORTED REGISTRY:",
    ...VALUATION_METHODS.map((method) => `- ${method}: ${VALUATION_METHOD_REGISTRY[method].description}`),
    "",
    "ECONOMIC ENGINE VALUE QUESTIONS:",
    ...(engine?.valueQuestions ?? []).map((question) => `- ${question}`),
    "",
    "CENTRAL RESEARCH DEBATES:",
    ...(debates?.debates ?? []).map((debate) => `- ${debate.debate} | financial=${debate.financialConsequence ?? "n/a"} | valuation=${debate.valuationConsequence ?? "n/a"}`),
    "",
    "EVIDENCE MAP:",
    ...(evidenceMap?.items ?? []).slice(0, 12).map((item) => `- [${item.direction}/T${item.tier}] ${item.claim}: ${item.evidence.slice(0, 140)} | ${item.factIds.join(" ")}`),
    ...(evidenceMap?.unsupported.length ? [`UNSUPPORTED: ${evidenceMap.unsupported.join(" | ")}`] : []),
    "",
    "HISTORICAL DERIVED:",
    derivedBlock,
    "",
    "FORECAST INPUTS:",
    ...inputs.map((entry) => `- ${entry}`),
    "FORECAST DRIVER PATHS:",
    ...Object.entries(forecastSpec.driverPaths).map(([variable, path]) => `- ${variable}: ${path.join(", ")}`),
    "FORECAST ASSUMPTIONS:",
    ...forecastSpec.assumptions.map((assumption) => `- ${assumption.variable}=${assumption.value} ${assumption.unit}: ${assumption.rationale} | evidence=${assumption.historicalEvidence}`),
    "FORECAST FORMULAS:",
    ...forecastSpec.formulas.map((formula) => `- ${formula.output}=${formula.expression}`),
    "",
    "AI-APPROPRIATE METHODS:",
    ...understanding.appropriateValuationMethods.map((method) => `- ${method.method}: ${method.why}`),
    "METRICS TO AVOID:",
    ...understanding.metricsToAvoid.map((metric) => `- ${metric.metric}: ${metric.reason}`),
  ].join("\n");
}

export async function buildValuationSpec(transport: ValuationTransport, input: ValuationBuilderInput): Promise<ValuationSpecification> {
  const response = await transport({
    system: SYSTEM_PROMPT,
    user: `VALUATION CONTEXT\n===============\n${valuationContext(input)}\n\nTASK\n====\nSelect the primary method and all executable cross-check method plans for ${input.understanding.companyName}. Return only the specified JSON.`,
    temperature: 0.2,
    maxTokens: DEPTH_TOKEN_BUDGETS.valuation,
    jsonMode: true,
  });
  const parsed = parseLlmJson<Record<string, any>>(response);
  if (!parsed || typeof parsed !== "object") throw new Error(`AI valuation builder returned unparseable output for ${input.pack.ticker}`);
  const rawMethod = String(parsed.methodology ?? parsed.method ?? "");
  const normalizedMethod = normalizeValuationMethod(rawMethod);
  const assumptions = (Array.isArray(parsed.assumptions) ? parsed.assumptions : []).map((assumption, index) => normalizeAssumption(assumption, index));
  const evidence = (Array.isArray(parsed.evidence) ? parsed.evidence : []).map(normalizeEvidence);
  const evidenceIds = [...new Set([...(Array.isArray(parsed.evidenceIds) ? parsed.evidenceIds.map((entry: unknown) => String(entry)) : []), ...citedFactIds(parsed.rationale), ...assumptions.flatMap((assumption) => assumption.factIds ?? [])])];
  const terminalAssumptions = parsed.terminalAssumptions && typeof parsed.terminalAssumptions.growth === "number" && Number.isFinite(parsed.terminalAssumptions.growth)
    ? { growth: parsed.terminalAssumptions.growth, rationale: String(parsed.terminalAssumptions.rationale ?? "") }
    : undefined;
  const method = normalizedMethod ?? rawMethod;
  const terminalPolicy = normalizeTerminalPolicy(parsed.terminalPolicy, terminalAssumptions, method, Array.isArray(parsed.terminalGrowthEvidenceIds) ? parsed.terminalGrowthEvidenceIds.map((entry: unknown) => String(entry)) : []);
  const components = (Array.isArray(parsed.components) ? parsed.components : []).map(normalizeComponent);
  const rawPlans = Array.isArray(parsed.methodPlans) && parsed.methodPlans.length > 0 ? parsed.methodPlans : [{
    method,
    rationale: parsed.rationale,
    variablesDrivingValuation: parsed.variablesDrivingValuation,
    assumptions: parsed.assumptions,
    discountRate: parsed.discountRate,
    discountRateRationale: parsed.discountRateRationale,
    terminalAssumptions: parsed.terminalAssumptions,
    terminalPolicy: parsed.terminalPolicy,
    components: parsed.components,
    evidence: parsed.evidence,
    evidenceIds: parsed.evidenceIds,
    discountRateEvidenceIds: parsed.discountRateEvidenceIds,
    terminalGrowthEvidenceIds: parsed.terminalGrowthEvidenceIds,
    sensitivityVariables: parsed.sensitivityVariables,
  }];
  const methodPlans = rawPlans.map((plan: any, index: number) => normalizePlan(plan, method, index)).filter((plan: ValuationMethodPlan) => !!plan.method);
  const selectedPlan = methodPlans.find((plan) => normalizeValuationMethod(plan.method) === normalizedMethod) ?? methodPlans[0];
  const methodsConsidered = (Array.isArray(parsed.methodsConsidered) ? parsed.methodsConsidered : []).map((entry: any) => ({
    method: String(entry?.method ?? ""),
    verdict: entry?.verdict === "rejected" ? "rejected" as const : "selected" as const,
    reason: String(entry?.reason ?? ""),
  }));
  return {
    methodology: rawMethod.trim() || method,
    method,
    selectedMethod: method,
    specId: stableId("VALSPEC", [input.pack.ticker, input.forecastSpec.modelId ?? input.forecastSpec.architecture ?? input.forecastSpec.horizonYears, method, evidenceIds]),
    modelId: input.forecastSpec.modelId,
    architecture: input.forecastSpec.architecture,
    rationale: String(parsed.rationale ?? ""),
    variablesDrivingValuation: Array.isArray(parsed.variablesDrivingValuation) ? parsed.variablesDrivingValuation.map((entry: unknown) => String(entry)) : [],
    assumptions,
    ...(typeof parsed.discountRate === "number" && Number.isFinite(parsed.discountRate) ? { discountRate: parsed.discountRate } : {}),
    ...(typeof parsed.discountRateRationale === "string" ? { discountRateRationale: parsed.discountRateRationale } : {}),
    ...(terminalAssumptions ? { terminalAssumptions } : {}),
    ...(terminalPolicy ? { terminalPolicy } : {}),
    ...(components.length ? { components } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(evidenceIds.length ? { evidenceIds } : {}),
    ...(Array.isArray(parsed.discountRateEvidenceIds) ? { discountRateEvidenceIds: [...new Set(parsed.discountRateEvidenceIds.map((entry: unknown) => String(entry)))] } : {}),
    ...(Array.isArray(parsed.terminalGrowthEvidenceIds) ? { terminalGrowthEvidenceIds: [...new Set(parsed.terminalGrowthEvidenceIds.map((entry: unknown) => String(entry)))] } : {}),
    ...(Array.isArray(parsed.sensitivityVariables) ? { sensitivityVariables: parsed.sensitivityVariables.map((entry: unknown) => String(entry)) } : {}),
    methodPlans,
    methodsConsidered: methodsConsidered.length ? methodsConsidered : [{ method, verdict: "selected", reason: String(parsed.rationale ?? "AI selected") }],
    ...(selectedPlan ? {} : {}),
  };
}

export default { buildValuationSpec, valuationContext };
