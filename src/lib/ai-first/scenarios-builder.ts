import { parseLlmJson } from "./llm";
import { executeForecast } from "./forecast-engine";
import { executeValuation } from "./valuation-engine";
import { buildHistoricalAnalysisPack } from "./historical-analysis";
import { DEPTH_DIRECTIVES, DEPTH_TOKEN_BUDGETS } from "./depth-guidance";
import {
  architectureInput,
  cloneForecastSpecification,
  forecastPathEquals,
  forecastStatementsEqual,
  isFiniteNumber,
  isForecastBlocked,
  stableId,
} from "./valuation-helpers";
import type {
  CompanyUnderstanding,
  FactPack,
  ForecastResult,
  ForecastSpecification,
  ScenarioClosure,
  ScenarioSetValidation,
  ScenarioSpecification,
  ScenarioVariableChange,
  ValuationDiagnostic,
  ValuationResult,
  ValuationSpecification,
} from "./types";

export type ScenarioTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface ScenarioFlowOptions {
  baseForecast?: ForecastResult;
  architecture?: string;
  requireEvidence?: boolean;
}

export interface ScenarioSetExecution {
  scenarios: ScenarioSpecification[];
  validation: ScenarioSetValidation;
  forecasts: Record<"bear" | "base" | "bull", ForecastResult>;
  valuations: Record<"bear" | "base" | "bull", ValuationResult>;
}

const SYSTEM_PROMPT = `You are an institutional scenario architect. Return exactly three scenarios in canonical order: bear, base, bull.

RULES:
- Every changed variable must be a known input variable in the supplied model.
- Every change requires a finite path with exactly one value per model year.
- Probabilities must be positive and sum to 1.
- Base paths must exactly match canonical model driver/assumption paths.
- Bear paths must be below base and bull paths above base for every changed variable; at least one year must differ materially in bear and bull.
- No unknown variables, no no-op bear/bull cases, and no hand-entered target prices.
- Bear, base, and bull must be deterministic model-to-valuation runs.

Respond with ONLY JSON:
{
  "scenarios": [
    {"name":"bear","probability":0.25,"changedVariables":[{"variable":"knownInput","baseValue":0.08,"scenarioValue":0.05,"path":[0.05,0.05,0.05,0.05,0.05],"rationale":"string","modelVariableId":"optional-id"}]},
    {"name":"base","probability":0.50,"changedVariables":[]},
    {"name":"bull","probability":0.25,"changedVariables":[{"variable":"knownInput","baseValue":0.08,"scenarioValue":0.11,"path":[0.11,0.11,0.11,0.11,0.11],"rationale":"string","modelVariableId":"optional-id"}]}
  ],
  "generationRationale": "string",
  "scenarioDriverSummary": "string"
}

${DEPTH_DIRECTIVES.scenarios}`;

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function variableSpec(modelSpec: ForecastSpecification, variable: string) {
  const normalized = variable.trim().toLowerCase();
  return modelSpec.variables.find((candidate) => candidate.name.toLowerCase() === normalized);
}

function directDriverPath(modelSpec: ForecastSpecification, variable: string): number[] | undefined {
  const direct = modelSpec.driverPaths[variable];
  if (Array.isArray(direct)) return [...direct];
  const entry = Object.entries(modelSpec.driverPaths).find(([key]) => key.toLowerCase() === variable.trim().toLowerCase());
  return entry ? [...entry[1]] : undefined;
}

function canonicalVariablePath(modelSpec: ForecastSpecification, variable: string): number[] | undefined {
  const driverPath = directDriverPath(modelSpec, variable);
  if (driverPath) return driverPath;
  const definition = variableSpec(modelSpec, variable);
  const assumption = modelSpec.assumptions.find((candidate) => candidate.variable.toLowerCase() === variable.trim().toLowerCase());
  const assumptionPath = assumption?.valuePath ?? assumption?.path;
  if (Array.isArray(assumptionPath) && assumptionPath.every(isFiniteNumber)) return [...assumptionPath];
  if (assumption && isFiniteNumber(assumption.value)) {
    const growthUnit = ["%", "percent", "rate"].includes(assumption.unit.toLowerCase());
    if (growthUnit && isFiniteNumber(definition?.baseValue)) return Array.from({ length: modelSpec.horizonYears }, () => assumption.value as number);
  }
  return undefined;
}

function scenarioPath(modelSpec: ForecastSpecification, change: ScenarioVariableChange): number[] {
  if (Array.isArray(change.path)) return [...change.path];
  return Array.from({ length: modelSpec.horizonYears }, () => change.scenarioValue);
}

function applyScenarioPaths(modelSpec: ForecastSpecification, scenario: ScenarioSpecification): ForecastSpecification {
  const adjusted = cloneForecastSpecification(modelSpec);
  for (const change of scenario.changedVariables) {
    const path = scenarioPath(modelSpec, change);
    const existingDriver = directDriverPath(modelSpec, change.variable) !== undefined;
    if (existingDriver) {
      const key = Object.keys(adjusted.driverPaths).find((candidate) => candidate.toLowerCase() === change.variable.toLowerCase()) ?? change.variable;
      adjusted.driverPaths[key] = path;
    } else {
      delete adjusted.driverPaths[change.variable];
      adjusted.assumptions = adjusted.assumptions.map((assumption) => assumption.variable.toLowerCase() === change.variable.toLowerCase()
        ? { ...assumption, value: path[0] ?? change.scenarioValue, valuePath: path, path }
        : assumption);
    }
  }
  return adjusted;
}

export function scenarioContext(pack: FactPack, understanding: CompanyUnderstanding, modelSpec: ForecastSpecification): string {
  let historical = "";
  try {
    historical = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 25).join("\n");
  } catch {
    historical = "Historical derived data unavailable.";
  }
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `ECONOMIC ABSTRACTION: ${understanding.primaryEconomicAbstraction}`,
    `HOW IT MAKES MONEY: ${String(understanding.howItMakesMoney).slice(0, 500)}`,
    `MODEL HORIZON: ${modelSpec.horizonYears}`,
    "",
    "KNOWN INPUT VARIABLES:",
    ...modelSpec.variables.filter((variable) => variable.kind === "input").map((variable) => `- ${variable.name} | id=${variable.id ?? "missing"} | label=${variable.label} | unit=${variable.unit} | base=${variable.baseValue ?? "missing"}`),
    "",
    "CANONICAL DRIVER PATHS:",
    ...Object.entries(modelSpec.driverPaths).map(([variable, path]) => `- ${variable}: ${path.join(", ")}`),
    "ASSUMPTION PATHS:",
    ...modelSpec.assumptions.map((assumption) => `- ${assumption.variable}: ${assumption.valuePath?.join(", ") ?? assumption.path?.join(", ") ?? assumption.value} ${assumption.unit}`),
    "",
    "MODEL FORMULAS:",
    ...modelSpec.formulas.map((formula) => `- ${formula.output}=${formula.expression}`),
    "",
    "HISTORICAL DERIVED:",
    historical,
    "",
    "KPIS:",
    ...understanding.keyKpis.map((kpi) => `- ${kpi.name}: ${kpi.rationale}`),
  ].join("\n");
}

function normalizeChange(raw: any, modelSpec: ForecastSpecification): ScenarioVariableChange {
  const variable = String(raw?.variable ?? "");
  const path = Array.isArray(raw?.path) && raw.path.every((value: unknown) => typeof value === "number" && Number.isFinite(value))
    ? raw.path.map(Number)
    : Array.from({ length: modelSpec.horizonYears }, () => typeof raw?.scenarioValue === "number" && Number.isFinite(raw.scenarioValue) ? raw.scenarioValue : Number.NaN);
  const canonical = canonicalVariablePath(modelSpec, variable);
  return {
    variable,
    ...(typeof raw?.baseValue === "number" && Number.isFinite(raw.baseValue) ? { baseValue: raw.baseValue } : canonical ? { baseValue: canonical[0] } : {}),
    scenarioValue: typeof raw?.scenarioValue === "number" && Number.isFinite(raw.scenarioValue) ? raw.scenarioValue : path[0],
    path,
    rationale: String(raw?.rationale ?? ""),
    ...(raw?.modelVariableId ? { modelVariableId: String(raw.modelVariableId) } : variableSpec(modelSpec, variable)?.id ? { modelVariableId: variableSpec(modelSpec, variable)?.id } : {}),
  };
}

function scenarioId(scenario: ScenarioSpecification, modelSpec: ForecastSpecification, pack: FactPack): string {
  return stableId("SCEN", [pack.ticker, modelSpec.modelId ?? modelSpec.architecture, scenario.name, scenario.changedVariables.map((change) => [change.variable, change.path ?? change.scenarioValue])]);
}

export async function buildScenarios(
  transport: ScenarioTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding,
  modelSpec: ForecastSpecification,
): Promise<{ scenarios: ScenarioSpecification[]; generationRationale: string; driverSummary: string; validation: ScenarioSetValidation }> {
  const response = await transport({
    system: SYSTEM_PROMPT,
    user: `SCENARIO CONTEXT\n===============\n${scenarioContext(pack, understanding, modelSpec)}\n\nTASK\n====\nGenerate exactly bear/base/bull with valid per-year paths and probabilities. Return only JSON.`,
    temperature: 0.2,
    maxTokens: DEPTH_TOKEN_BUDGETS.scenarios,
    jsonMode: true,
  });
  const parsed = parseLlmJson<Record<string, any>>(response);
  const rawScenarios = Array.isArray(parsed?.scenarios) ? parsed.scenarios : [];
  const defaultProbabilities: Record<string, number> = { bear: 0.25, base: 0.5, bull: 0.25 };
  const scenarios = rawScenarios.map((raw: any, index: number) => {
    const name = String(raw?.name ?? "") as ScenarioSpecification["name"];
    const scenario: ScenarioSpecification = {
      name,
      changedVariables: (Array.isArray(raw?.changedVariables) ? raw.changedVariables : []).map((change: any) => normalizeChange(change, modelSpec)),
      targetPrice: undefined,
      targetProvenance: "forecast",
      probability: typeof raw?.probability === "number" && Number.isFinite(raw.probability) ? raw.probability : defaultProbabilities[name] ?? Number.NaN,
    };
    return { ...scenario, id: scenarioId(scenario, modelSpec, pack) };
  });
  const validation = validateScenarioSet(scenarios, modelSpec);
  return {
    scenarios,
    validation,
    generationRationale: String(parsed?.generationRationale ?? ""),
    driverSummary: String(parsed?.scenarioDriverSummary ?? ""),
  };
}

function scenarioSingleValidation(scenario: ScenarioSpecification, modelSpec: ForecastSpecification): { diagnostics: ValuationDiagnostic[]; blockers: string[] } {
  const diagnostics: ValuationDiagnostic[] = [];
  const blockers: string[] = [];
  if (scenario.name !== "base" && scenario.changedVariables.length === 0) {
    const message = `${scenario.name} scenario must change at least one known model path.`;
    diagnostics.push(diagnostic("SCENARIO_NO_OP", message, "error", "changedVariables"));
    blockers.push(message);
  }
  const seen = new Set<string>();
  for (const change of scenario.changedVariables) {
    const definition = variableSpec(modelSpec, change.variable);
    if (!definition || definition.kind !== "input") {
      const message = `Unknown or computed scenario variable ${change.variable}.`;
      diagnostics.push(diagnostic("SCENARIO_VARIABLE_UNKNOWN", message, "error", change.variable));
      blockers.push(message);
      continue;
    }
    const key = definition.name.toLowerCase();
    if (seen.has(key)) {
      const message = `Scenario variable ${change.variable} appears more than once.`;
      diagnostics.push(diagnostic("SCENARIO_VARIABLE_DUPLICATE", message, "error", change.variable));
      blockers.push(message);
    }
    seen.add(key);
    const path = scenarioPath(modelSpec, change);
    if (path.length !== modelSpec.horizonYears || path.some((value) => !isFiniteNumber(value))) {
      const message = `Scenario variable ${change.variable} requires ${modelSpec.horizonYears} finite annual path values.`;
      diagnostics.push(diagnostic("SCENARIO_PATH_INVALID", message, "error", change.variable));
      blockers.push(message);
    }
    if (path.length > 0 && (!isFiniteNumber(change.scenarioValue) || Math.abs(change.scenarioValue - path[0]) > 1e-9)) {
      const message = `Scenario variable ${change.variable} scalar value must equal the first annual path value.`;
      diagnostics.push(diagnostic("SCENARIO_PATH_SCALAR_MISMATCH", message, "error", change.variable));
      blockers.push(message);
    }
    if (!change.rationale.trim()) {
      const message = `Scenario variable ${change.variable} requires a rationale.`;
      diagnostics.push(diagnostic("SCENARIO_RATIONALE_MISSING", message, "error", change.variable));
      blockers.push(message);
    }
    const canonical = canonicalVariablePath(modelSpec, change.variable);
    if (canonical?.length && isFiniteNumber(change.baseValue) && Math.abs(change.baseValue - canonical[0]) > 1e-9) {
      const message = `Base value for ${change.variable} does not match the canonical model path.`;
      diagnostics.push(diagnostic("SCENARIO_BASE_VALUE_MISMATCH", message, "error", change.variable));
      blockers.push(message);
    }
    if (canonical && !forecastPathEquals(path, canonical) && scenario.name === "base") {
      const message = `Base scenario path for ${change.variable} does not match the canonical model path.`;
      diagnostics.push(diagnostic("SCENARIO_BASE_PATH_MISMATCH", message, "error", change.variable));
      blockers.push(message);
    }
    if (canonical && scenario.name !== "base" && forecastPathEquals(path, canonical)) {
      const message = `${scenario.name} scenario is a no-op for ${change.variable}.`;
      diagnostics.push(diagnostic("SCENARIO_NO_OP", message, "error", change.variable));
      blockers.push(message);
    }
    if (canonical && scenario.name !== "base" && path.length === canonical.length && Math.max(...path.map((value, index) => Math.abs(value - canonical[index]))) <= 1e-6) {
      const message = `${scenario.name} scenario change for ${change.variable} is not material.`;
      diagnostics.push(diagnostic("SCENARIO_CHANGE_INSIGNIFICANT", message, "error", change.variable));
      blockers.push(message);
    }
  }
  return { diagnostics, blockers };
}

export function validateScenarioSet(scenarios: readonly ScenarioSpecification[], modelSpec: ForecastSpecification): ScenarioSetValidation {
  const diagnostics: ValuationDiagnostic[] = [];
  const blockers: string[] = [];
  const expected = ["bear", "base", "bull"];
  if (scenarios.length !== 3) {
    const message = `Exactly three scenarios are required; received ${scenarios.length}.`;
    diagnostics.push(diagnostic("SCENARIO_COUNT_INVALID", message));
    blockers.push(message);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (scenarios[index]?.name !== expected[index]) {
      const message = `Scenario order must be bear, base, bull; position ${index + 1} is ${String(scenarios[index]?.name ?? "missing")}.`;
      diagnostics.push(diagnostic("SCENARIO_ORDER_INVALID", message));
      blockers.push(message);
    }
  }
  if (new Set(scenarios.map((scenario) => scenario.name)).size !== scenarios.length) {
    const message = "Scenario names must be unique.";
    diagnostics.push(diagnostic("SCENARIO_DUPLICATE", message));
    blockers.push(message);
  }
  const probabilities = scenarios.map((scenario) => scenario.probability);
  if (probabilities.some((probability) => !isFiniteNumber(probability) || probability <= 0 || probability >= 1)) {
    const message = "Every scenario requires a probability strictly between zero and one.";
    diagnostics.push(diagnostic("SCENARIO_PROBABILITY_INVALID", message));
    blockers.push(message);
  } else if (Math.abs(probabilities.reduce((sum: number, probability) => sum + (probability as number), 0) - 1) > 1e-9) {
    const message = "Scenario probabilities must sum to one.";
    diagnostics.push(diagnostic("SCENARIO_PROBABILITY_SUM_INVALID", message));
    blockers.push(message);
  }
  for (const scenario of scenarios) {
    const single = scenarioSingleValidation(scenario, modelSpec);
    diagnostics.push(...single.diagnostics);
    blockers.push(...single.blockers);
  }
  const bear = scenarios[0];
  const base = scenarios[1];
  const bull = scenarios[2];
  if (bear?.name === "bear" && base?.name === "base" && bull?.name === "bull") {
    const baseByVariable = new Map(base.changedVariables.map((change) => [change.variable.toLowerCase(), scenarioPath(modelSpec, change)]));
    const checkDirection = (scenario: ScenarioSpecification, direction: "bear" | "bull"): void => {
  if (scenario.targetProvenance !== "forecast") {
    const message = `${scenario.name} scenario target provenance must be forecast.`;
    diagnostics.push(diagnostic("SCENARIO_PROVENANCE_INVALID", message));
    blockers.push(message);
  }
  for (const change of scenario.changedVariables) {
        const basePath = baseByVariable.get(change.variable.toLowerCase()) ?? canonicalVariablePath(modelSpec, change.variable);
        if (!basePath) continue;
        const path = scenarioPath(modelSpec, change);
        const monotonic = path.every((value, index) => direction === "bear" ? value <= basePath[index] : value >= basePath[index]);
        if (!monotonic) {
          const message = `${scenario.name} path for ${change.variable} is not monotonically ${direction === "bear" ? "below" : "above"} base.`;
          diagnostics.push(diagnostic("SCENARIO_MONOTONICITY_INVALID", message, "error", change.variable));
          blockers.push(message);
        }
      }
    };
    checkDirection(bear, "bear");
    checkDirection(bull, "bull");
  }
  return {
    valid: blockers.length === 0,
    status: blockers.some((blocker) => blocker.includes("order") || blocker.includes("Exactly") || blocker.includes("unknown") || blocker.includes("Unknown") || blocker.includes("no-op")) ? "invalid" : "blocked",
    scenarioIds: scenarios.map((scenario) => scenario.id ?? "").filter(Boolean),
    diagnostics,
    blockers: [...new Set(blockers)],
    publicationBlocked: blockers.length > 0,
  };
}

function closureFrom(forecast: ForecastResult): ScenarioClosure {
  const checks = forecast.identityChecks.map((check, index) => ({
    id: check.code ?? `forecast-check-${index + 1}`,
    statement: "incomeStatement" as const,
    period: forecast.incomeStatement[index]?.period ?? forecast.incomeStatement[0]?.period ?? "forecast",
    passed: check.pass,
    actual: check.actual,
    expected: check.expected,
    detail: check.detail ?? check.check,
  }));
  const criticalFailure = forecast.identityChecks.some((check) => check.critical && !check.pass);
  return {
    status: isForecastBlocked(forecast) ? "blocked" : criticalFailure ? "failed" : "passed",
    passed: forecast.status === "ready" && !criticalFailure,
    checks,
    diagnostics: forecast.identityChecks.filter((check) => !check.pass).map((check) => diagnostic(check.code ?? "SCENARIO_CLOSURE_FAILED", check.detail ?? check.check, "error")),
  };
}

function unavailableValuation(spec: ValuationSpecification, pack: FactPack, blockers: readonly string[]): ValuationResult {
  const id = stableId("VAL", ["scenario-blocked", spec.specId ?? spec.methodology, pack.ticker, blockers.join("|")]);
  return {
    id,
    methodology: spec.methodology,
    method: spec.methodology,
    status: "blocked",
    outputs: {},
    executedFrom: spec,
    bridge: { basis: "equity_value", steps: [] },
    diagnostics: blockers.map((message) => diagnostic("SCENARIO_VALUATION_BLOCKED", message)),
    blockers: [...blockers],
    publicationBlocked: true,
  };
}

export function flowScenarioThroughModel(
  scenario: ScenarioSpecification,
  modelSpec: ForecastSpecification,
  factPack: FactPack,
  baseValuationSpec: ValuationSpecification,
  options: ScenarioFlowOptions = {},
): { scenario: ScenarioSpecification; forecast: ForecastResult; valuation: ValuationResult } {
  const single = scenarioSingleValidation(scenario, modelSpec);
  const baseForecast = options.baseForecast;
  if (single.blockers.length > 0) {
    const blockedForecast: ForecastResult = baseForecast ?? { incomeStatement: [], balanceSheet: [], cashFlow: [], identityChecks: [], status: "blocked", publicationStatus: "blocked", blockers: single.blockers, publicationBlocked: true };
    return {
      scenario: { ...scenario, id: scenario.id ?? scenarioId(scenario, modelSpec, factPack), status: "blocked", forecast: blockedForecast, valuation: unavailableValuation(baseValuationSpec, factPack, single.blockers), closure: { status: "blocked", passed: false, checks: [], diagnostics: single.diagnostics }, diagnostics: single.diagnostics, blockers: single.blockers, publicationBlocked: true, targetPrice: undefined },
      forecast: blockedForecast,
      valuation: unavailableValuation(baseValuationSpec, factPack, single.blockers),
    };
  }
  const adjustedSpec = applyScenarioPaths(modelSpec, scenario);
  const forecastOut = executeForecast({ model: adjustedSpec, factPack, ...(options.architecture ? { architecture: architectureInput(options.architecture) } : {}) });
  const modelId = modelSpec.modelId ?? adjustedSpec.modelId;
  const forecast: ForecastResult = {
    ...forecastOut.forecast,
    ...(modelId ? { modelId } : {}),
    forecastId: scenario.id ?? scenarioId(scenario, modelSpec, factPack),
  };
  const valuation = executeValuation(baseValuationSpec, forecast, factPack, {
    ...(modelSpec ? { forecastSpec: adjustedSpec } : {}),
    ...(options.architecture ? { architecture: options.architecture } : {}),
    requireEvidence: options.requireEvidence ?? true,
  });
  const closure = closureFrom(forecast);
  const blockers = [...forecast.blockers ?? [], ...(valuation.status === "ready" ? [] : valuation.blockers ?? ["Scenario valuation is unavailable"])];
  const status = blockers.length === 0 && valuation.fairValuePerShare !== undefined && closure.passed ? "ready" : "blocked";
  return {
    scenario: {
      ...scenario,
      id: scenario.id ?? scenarioId(scenario, modelSpec, factPack),
      status,
      targetPrice: status === "ready" ? valuation.fairValuePerShare : undefined,
      targetProvenance: "forecast",
      forecast,
      valuation,
      bridge: valuation.bridge,
      closure,
      diagnostics: [...single.diagnostics, ...forecast.identityChecks.filter((check) => !check.pass).map((check) => diagnostic(check.code ?? "SCENARIO_CLOSURE_FAILED", check.detail ?? check.check)), ...(valuation.diagnostics ?? [])],
      blockers: [...new Set(blockers)],
      publicationBlocked: status !== "ready",
    },
    forecast,
    valuation,
  };
}

function emptyScenarioOutputs(scenarios: readonly ScenarioSpecification[]): ScenarioSetExecution["forecasts"] {
  const empty: ForecastResult = { incomeStatement: [], balanceSheet: [], cashFlow: [], identityChecks: [], status: "blocked", publicationStatus: "blocked", blockers: ["Scenarios not executed"], publicationBlocked: true };
  return { bear: empty, base: empty, bull: empty };
}

export function executeScenarioSet(
  scenarios: readonly ScenarioSpecification[],
  modelSpec: ForecastSpecification,
  canonicalForecast: ForecastResult,
  factPack: FactPack,
  valuationSpec: ValuationSpecification,
  options: ScenarioFlowOptions = {},
): ScenarioSetExecution {
  let validation = validateScenarioSet(scenarios, modelSpec);
  const diagnostics = [...validation.diagnostics];
  const blockers = [...validation.blockers];
  if (isForecastBlocked(canonicalForecast)) {
    const message = `Canonical forecast is blocked: ${canonicalForecast.blockers?.join("; ") || "publicationBlocked=true"}.`;
    diagnostics.push(diagnostic("FORECAST_BLOCKED", message));
    blockers.push(message);
  }
  if (blockers.length > 0) {
    validation = { ...validation, valid: false, status: "blocked", diagnostics, blockers: [...new Set(blockers)], publicationBlocked: true };
    const blockedScenarios = scenarios.map((scenario) => ({ ...scenario, status: "blocked" as const, forecast: canonicalForecast, valuation: unavailableValuation(valuationSpec, factPack, validation.blockers), diagnostics: validation.diagnostics, blockers: validation.blockers, publicationBlocked: true, targetPrice: undefined }));
    const emptyValuations = Object.fromEntries(["bear", "base", "bull"].map((name) => [name, unavailableValuation(valuationSpec, factPack, validation.blockers)])) as ScenarioSetExecution["valuations"];
    return { scenarios: blockedScenarios, validation, forecasts: emptyScenarioOutputs(scenarios), valuations: emptyValuations };
  }
  const flows = scenarios.map((scenario) => flowScenarioThroughModel(scenario, modelSpec, factPack, valuationSpec, { ...options, baseForecast: canonicalForecast }));
  const baseFlow = flows[1];
  const baseMatches = baseFlow && forecastStatementsEqual(canonicalForecast, baseFlow.forecast);
  if (!baseMatches) {
    const message = "Base scenario outputs do not exactly match canonical forecast statements.";
    diagnostics.push(diagnostic("SCENARIO_BASE_OUTPUT_MISMATCH", message));
    blockers.push(message);
  }
  const targets = flows.map((flow) => flow.scenario.targetPrice);
  const targetMonotonic = targets.every(isFiniteNumber) && (targets[2] as number) >= (targets[1] as number) && (targets[1] as number) >= (targets[0] as number);
  if (!targetMonotonic) {
    const message = "Scenario fair values must satisfy bear <= base <= bull.";
    diagnostics.push(diagnostic("SCENARIO_TARGET_MONOTONICITY_INVALID", message));
    blockers.push(message);
  }
  for (const flow of flows) {
    if (flow.scenario.status !== "ready") {
      const message = `${flow.scenario.name} scenario execution is blocked.`;
      diagnostics.push(diagnostic("SCENARIO_EXECUTION_BLOCKED", message, "error", flow.scenario.name));
      blockers.push(message);
    }
  }
  if (blockers.length > 0) {
    validation = { ...validation, valid: false, status: "invalid", diagnostics, blockers: [...new Set(blockers)], publicationBlocked: true };
  }
  const executedScenarios = flows.map((flow) => validation.valid ? flow.scenario : {
    ...flow.scenario,
    status: "blocked" as const,
    targetPrice: undefined,
    diagnostics: [...(flow.scenario.diagnostics ?? []), ...validation.diagnostics],
    blockers: [...new Set([...(flow.scenario.blockers ?? []), ...validation.blockers])],
    publicationBlocked: true,
  });
  return {
    scenarios: executedScenarios,
    validation,
    forecasts: { bear: flows[0].forecast, base: flows[1].forecast, bull: flows[2].forecast },
    valuations: { bear: flows[0].valuation, base: flows[1].valuation, bull: flows[2].valuation },
  };
}

export function renderScenarioContext(scenarios: readonly ScenarioSpecification[], baseFairValue?: number): string {
  const lines = [`SCENARIO CONTEXT`, `Base fair value: ${baseFairValue ?? "N/A"}`, ""];
  for (const scenario of scenarios) {
    lines.push(`--- ${scenario.name.toUpperCase()} ---`, `Probability: ${scenario.probability ?? "N/A"}`);
    for (const change of scenario.changedVariables) lines.push(`${change.variable}: ${change.scenarioValue}; path=${(change.path ?? []).join(", ")}; ${change.rationale}`);
    lines.push(`Target: ${scenario.targetPrice ?? "N/A"}`, `Status: ${scenario.status ?? "planned"}`, "");
  }
  return lines.join("\n");
}

export const validateScenarios = validateScenarioSet;
export const runScenarioSet = executeScenarioSet;

export default {
  buildScenarios,
  executeScenarioSet,
  flowScenarioThroughModel,
  renderScenarioContext,
  scenarioContext,
  validateScenarioSet,
  validateScenarios,
};
