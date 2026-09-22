/**
 * APEX RESEARCH — AI SCENARIO BUILDER
 *
 * The AI dynamically generates Bear/Base/Bull scenarios. Scenario assumptions
 * are NOT hardcoded — the AI determines what actually changes between
 * scenarios based on the company's economics.
 *
 * PRINCIPLE: The AI determines scenario variables and rationale. Code flows
 * them through model → financial statements → valuation → target price.
 * No hand-entered target prices, no random perturbation.
 */
import type {
  FactPack,
  Fact,
  ScenarioSpecification,
  CompanyUnderstanding,
  ForecastSpecification,
  ForecastResult,
  ValuationSpecification,
  ValuationResult,
} from "./types";
import { parseLlmJson } from "./llm";
import { executeForecast } from "./forecast-engine";
import { executeValuation } from "./valuation-engine";

export type ScenarioTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

const SYSTEM_PROMPT = `You are an institutional equity research analyst. Generate three scenarios (Bear, Base, Bull) for this company.

RULES:
- The AI (you) determines what actually changes between scenarios — volume, ASP, margin, credit cost, NIM, subscriber growth, ARPU, capex, FX, commodity cost, etc., depending entirely on the company.
- Do NOT invent arbitrary percentages. Ground every change in the company's economics and yfinance history (cite [F-...] fact IDs).
- Changed variables MUST be forecast variables or drivers from the model spec.
- Every scenario flows through the deterministic model → statements → valuation. No hand-entered target prices (leave targetPrice null).

Respond with ONLY JSON:
{
  "scenarios": [
    {
      "name": "bear",
      "changedVariables": [
        { "variable": "string (model variable name)", "baseValue": 0.08, "scenarioValue": 0.05, "rationale": "string grounded in company economics" }
      ]
    },
    { "name": "base", "changedVariables": [{ "variable": "string", "baseValue": 0.08, "scenarioValue": 0.08, "rationale": "base case = model assumptions" }] },
    { "name": "bull", "changedVariables": [{ "variable": "string", "baseValue": 0.08, "scenarioValue": 0.11, "rationale": "string" }] }
  ],
  "generationRationale": "string",
  "scenarioDriverSummary": "string"
}
Note: values are in the same units as the model variables (growth rates as decimals, 0.08 = 8%).`;

/** Compact SCENARIO_CONTEXT: model variables + base anchors only. */
export function scenarioContext(
  pack: FactPack,
  understanding: CompanyUnderstanding,
  modelSpec: ForecastSpecification
): string {
  const price = pack.market.facts.find((f: Fact) => f.metric === "currentPrice")?.value;
  const currency = pack.market.facts.find((f: Fact) => f.metric === "currentPrice")?.currency || "";
  const inputs = modelSpec.variables.filter((v) => v.kind === "input");
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `Primary economic abstraction: ${understanding.primaryEconomicAbstraction}`,
    price !== undefined ? `CURRENT PRICE: ${price} ${currency}` : "CURRENT PRICE: Not available from yfinance",
    "",
    "FORECAST MODEL VARIABLES (inputs the scenarios may change):",
    ...inputs.map((v) => `- ${v.name} (${v.label}, unit: ${v.unit}, base: ${v.baseValue ?? "N/A"})`),
    "",
    "MODEL FORMULAS:",
    ...modelSpec.formulas.map((f) => `- [${f.id}] ${f.equation}`),
    "",
    "BASE ASSUMPTIONS (anchor values):",
    ...modelSpec.assumptions.map((a) => `- ${a.variable}: ${a.value} ${a.unit} — ${a.assumption}`),
  ].join("\n");
}

/** AI scenario generation from the fact pack + model spec. */
export async function buildScenarios(
  transport: ScenarioTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding,
  modelSpec: ForecastSpecification
): Promise<{ scenarios: ScenarioSpecification[]; generationRationale: string; driverSummary: string }> {
  const ctx = scenarioContext(pack, understanding, modelSpec);
  const user = `RESEARCH CONTEXT
================
${ctx}

TASK
====
Generate Bear/Base/Bull scenarios for ${understanding.companyName} now.

OUTPUT
======
Respond with ONLY the JSON object.`;

  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.3, maxTokens: 2500, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.scenarios) || parsed.scenarios.length < 3) {
    throw new Error(`AI scenario builder returned unparseable or incomplete output for ${pack.ticker}`);
  }

  const scenarios: ScenarioSpecification[] = parsed.scenarios
    .filter((s: any) => ["bear", "base", "bull"].includes(s?.name))
    .map((s: any) => ({
      name: s.name,
      changedVariables: (Array.isArray(s.changedVariables) ? s.changedVariables : [])
        .map((cv: any) => ({
          variable: String(cv?.variable || ""),
          baseValue: typeof cv?.baseValue === "number" && isFinite(cv.baseValue) ? cv.baseValue : undefined,
          scenarioValue: typeof cv?.scenarioValue === "number" && isFinite(cv.scenarioValue) ? cv.scenarioValue : 0,
          rationale: String(cv?.rationale || ""),
        }))
        .filter((cv: any) => cv.variable),
      targetPrice: undefined,
      targetProvenance: "forecast" as const,
    }));

  return {
    scenarios,
    generationRationale: String(parsed.generationRationale || ""),
    driverSummary: String(parsed.scenarioDriverSummary || ""),
  };
}

/**
 * Flow a scenario through the deterministic engines:
 * changed variables → adjusted forecast → valuation → target price.
 * The AI chose WHAT changes; code computes the resulting target price.
 */
export function flowScenarioThroughModel(
  scenario: ScenarioSpecification,
  modelSpec: ForecastSpecification,
  factPack: FactPack,
  baseValuationSpec: ValuationSpecification
): { scenario: ScenarioSpecification; forecast: ForecastResult; valuation: ValuationResult } {
  // Apply scenario deltas to the model's driverPaths and assumption values.
  const adjustedSpec: ForecastSpecification = {
    ...modelSpec,
    assumptions: modelSpec.assumptions.map((a) => {
      const change = scenario.changedVariables.find((cv) => cv.variable === a.variable);
      return change ? { ...a, value: change.scenarioValue } : a;
    }),
    driverPaths: Object.fromEntries(
      Object.entries(modelSpec.driverPaths).map(([k, path]) => {
        const change = scenario.changedVariables.find((cv) => cv.variable === k);
        if (!change) return [k, path];
        // Shift the whole growth path by the scenario delta.
        const delta = change.scenarioValue - (change.baseValue ?? change.scenarioValue);
        return [k, path.map((g) => g + delta)];
      })
    ),
  };

  // Re-execute the deterministic forecast with scenario assumptions.
  const forecastOut = executeForecast({ model: adjustedSpec, factPack });

  // Re-execute the deterministic valuation on the scenario forecast.
  const valuation = executeValuation(baseValuationSpec, forecastOut.forecast, factPack);

  return {
    scenario: {
      ...scenario,
      targetPrice: valuation.fairValuePerShare,
      targetProvenance: "forecast",
    },
    forecast: forecastOut.forecast,
    valuation,
  };
}

/** Render a compact scenario context for AI reviewers or the report. */
export function renderScenarioContext(
  scenarios: ScenarioSpecification[],
  baseFV?: number
): string {
  const lines: string[] = [
    "SCENARIO CONTEXT",
    `Base fair value: ${baseFV !== undefined ? baseFV : "N/A"}`,
    "",
  ];
  for (const s of scenarios) {
    lines.push(`--- ${s.name.toUpperCase()} ---`);
    for (const cv of s.changedVariables) {
      lines.push(`  ${cv.variable}: base=${cv.baseValue ?? "n/a"} → scenario=${cv.scenarioValue} (${cv.rationale})`);
    }
    lines.push(`  Target price: ${s.targetPrice !== undefined ? s.targetPrice : "N/A"}`);
    lines.push("");
  }
  return lines.join("\n");
}

export default { buildScenarios, flowScenarioThroughModel, renderScenarioContext };