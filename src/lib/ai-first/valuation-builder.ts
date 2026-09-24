/**
 * APEX RESEARCH — AI VALUATION BUILDER
 *
 * The AI decides which valuation methodologies are appropriate for THIS
 * company (DCF, P/BV, Residual Income, Dividend Discount, SOTP, NAV, EV-based
 * multiples...). These are examples, not a fixed registry — the AI decides.
 *
 * PRINCIPLE: AI decides the valuation method. Code executes the selected
 * model (valuation-engine.ts). The AI never invents the final target price.
 */
import type {
  FactPack,
  CompanyUnderstanding,
  ForecastSpecification,
  ValuationSpecification,
  Fact,
  EconomicEngine,
  ThesisEngineOutput,
  EvidenceMap,
} from "./types";
import { parseLlmJson } from "./llm";
import { buildHistoricalAnalysisPack } from "./historical-analysis";
import { DEPTH_DIRECTIVES, DEPTH_TOKEN_BUDGETS } from "./depth-guidance";

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

const SYSTEM_PROMPT = `You are a valuation specialist on an institutional equity research desk. You receive the company understanding + forecast model design (from prior AI stages) and must SELECT the appropriate valuation methodology for this company.

Do NOT automatically run DCF on every company. If DCF is inappropriate, say so and select another method (Residual Income, P/E, P/B, EV/EBITDA, EV/Revenue, Dividend Discount, or any other economically appropriate methodology — e.g. for a commercial bank: Residual Income or P/B grounded in book value, ROE, and capital; NOT EV/EBITDA).

Explain:
- WHY this method is appropriate
- WHAT variables drive valuation
- WHAT assumptions matter (values + rationale + historical evidence citing [F-...] fact IDs)
- WHAT limitations exist
- Which methods were considered and REJECTED (with reasons)

Respond with ONLY JSON:
{
  "methodology": "string (must be one the valuation engine can execute: DCF, FCFF, Residual Income, P/E, P/B, EV/EBITDA, EV/Revenue, Dividend Discount)",
  "rationale": "string",
  "variablesDrivingValuation": ["string"],
  "assumptions": [{ "id": "A1", "assumption": "string", "variable": "string", "value": 0.105, "unit": "decimal", "period": "Y1-Y5", "rationale": "string", "historicalEvidence": "string citing [F-...] ids", "confidence": 0.8 }],
  "discountRate": 0.105,
  "discountRateRationale": "string",
  "terminalAssumptions": { "growth": 0.04, "rationale": "string" },
  "methodsConsidered": [{ "method": "string", "verdict": "selected", "reason": "string" }],
  "limitations": ["string"]
}
Note: rates are DECIMALS (0.105 = 10.5%). The methodology MUST be executable by the deterministic engine — if the economically ideal method is not executable, choose the closest executable one and explain the limitation.

${DEPTH_DIRECTIVES.valuation}`;

/** Rich VALUATION_CONTEXT with historical derived + forecast anchors. */
export function valuationContext(input: ValuationBuilderInput): string {
  const { pack, understanding, forecastSpec, engine, debates, evidenceMap } = input;
  const price = pack.market.facts.find((f: Fact) => f.metric === "currentPrice")?.value;
  const currency = pack.market.facts.find((f: Fact) => f.metric === "currentPrice")?.currency || "";
  const bvps = pack.market.facts.find((f: Fact) => f.metric === "bookValuePerShare")?.value;
  const inputs = forecastSpec.variables.filter((v) => v.kind === "input").map((v) => v.name);
  const assumptionList = forecastSpec.assumptions
    .map((a) => `- ${a.variable}: ${a.value} ${a.unit} — ${a.assumption} | evidence: ${a.historicalEvidence.slice(0, 100)}`)
    .join("\n");
  let derivedBlock = "";
  try { derivedBlock = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 30).join("\n"); } catch { derivedBlock = "(derived unavailable)"; }
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `Primary economic abstraction: ${understanding.primaryEconomicAbstraction}`,
    `How it makes money: ${understanding.howItMakesMoney}`,
    `What it does: ${String(understanding.whatItDoes).slice(0, 500)}`,
    price !== undefined ? `CURRENT PRICE: ${price} ${currency}` : "CURRENT PRICE: Not available from yfinance",
    `BOOK VALUE PER SHARE: ${bvps ?? "Not available from yfinance"}`,
    "",
    ...(engine?.valueQuestions?.length
      ? [`ECONOMIC ENGINE VALUE QUESTIONS: ${engine.valueQuestions.join(" | ")}`, ""]
      : []),
    ...(debates?.debates?.length
      ? [
          "RESEARCH DEBATES (select method that adjudicates the central debate):",
          ...debates.debates.map(
            (d) =>
              `- ${d.debate} | financial: ${d.financialConsequence || "n/a"} | valuation: ${d.valuationConsequence || "n/a"} | resolution: ${d.resolutionSignal || "n/a"}`
          ),
          `Central: ${debates.debates[debates.centralDebateIndex]?.debate || debates.thesis.slice(0, 200)}`,
          "",
        ]
      : []),
    ...(evidenceMap?.items?.length
      ? [
          `EVIDENCE MAP confidence ${evidenceMap.overallConfidence.toFixed(2)}:`,
          ...evidenceMap.items.slice(0, 8).map((i) => `- [${i.direction}/T${i.tier}] ${i.claim}: ${i.evidence.slice(0, 120)}`),
          ...(evidenceMap.unsupported.length ? [`UNSUPPORTED: ${evidenceMap.unsupported.slice(0, 4).join(" | ")}`] : []),
          "",
        ]
      : []),
    "HISTORICAL DERIVED (for valuation grounding):",
    derivedBlock,
    "",
    "AI-DETERMINED APPROPRIATE METHODS (from understanding stage):",
    ...understanding.appropriateValuationMethods.map((m) => `- ${m.method}: ${m.why}`),
    "",
    "METRICS TO AVOID:",
    ...understanding.metricsToAvoid.map((m) => `- ${m.metric} — ${m.reason}`),
    "",
    "FORECAST MODEL ASSUMPTIONS (AI outputs):",
    assumptionList,
    "",
    `FORECAST INPUT VARIABLES: ${inputs.join(", ")}`,
    `FORMULAS: ${forecastSpec.formulas.map((f) => `[${f.id}] ${f.equation}`).join(" | ")}`,
    `HORIZON: ${forecastSpec.horizonYears}Y — ${forecastSpec.horizonRationale.slice(0, 200)}`,
  ].join("\n");
}

/** AI valuation method selection. transport calls the LLM. */
export async function buildValuationSpec(
  transport: ValuationTransport,
  input: ValuationBuilderInput
): Promise<ValuationSpecification> {
  const ctx = valuationContext(input);
  const user = `RESEARCH CONTEXT
================
${ctx}

TASK
====
Select the valuation methodology for ${input.understanding.companyName} now.

OUTPUT
======
Respond with ONLY the JSON object.`;

  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.25, maxTokens: DEPTH_TOKEN_BUDGETS.valuation, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !parsed.methodology) {
    throw new Error(`AI valuation builder returned unparseable output for ${input.pack.ticker}`);
  }

  const assumptions = (Array.isArray(parsed.assumptions) ? parsed.assumptions : [])
    .map((a: any, i: number) => ({
      id: String(a?.id || `AV${i + 1}`),
      assumption: String(a?.assumption || ""),
      variable: String(a?.variable || ""),
      value: typeof a?.value === "number" && isFinite(a.value) ? a.value : NaN,
      unit: String(a?.unit || "decimal"),
      period: String(a?.period || "Y1-Y5"),
      rationale: String(a?.rationale || ""),
      historicalEvidence: String(a?.historicalEvidence || ""),
      confidence: typeof a?.confidence === "number" ? a.confidence : 0.7,
    }))
    .filter((a: any) => a.variable && isFinite(a.value));

  return {
    methodology: String(parsed.methodology),
    rationale: String(parsed.rationale || ""),
    variablesDrivingValuation: Array.isArray(parsed.variablesDrivingValuation)
      ? parsed.variablesDrivingValuation.map(String)
      : [],
    assumptions,
    discountRate: typeof parsed.discountRate === "number" ? parsed.discountRate : undefined,
    discountRateRationale: typeof parsed.discountRateRationale === "string" ? parsed.discountRateRationale : undefined,
    terminalAssumptions:
      parsed.terminalAssumptions && typeof parsed.terminalAssumptions.growth === "number"
        ? { growth: parsed.terminalAssumptions.growth, rationale: String(parsed.terminalAssumptions.rationale || "") }
        : undefined,
    methodsConsidered: (Array.isArray(parsed.methodsConsidered) ? parsed.methodsConsidered : []).map((m: any) => ({
      method: String(m?.method || ""),
      verdict: m?.verdict === "rejected" ? "rejected" : "selected",
      reason: String(m?.reason || ""),
    })),
  };
}

export default { buildValuationSpec, valuationContext };