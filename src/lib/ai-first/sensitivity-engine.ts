import { executeForecast } from "./forecast-engine";
import { executeValuation } from "./valuation-engine";
import { getValuationMethod, methodPlansFromSpecification, normalizeValuationMethod } from "./valuation-methods";
import {
  architectureInput,
  cloneForecastSpecification,
  isFiniteNumber,
  isForecastBlocked,
  stableId,
  terminalPolicyOf,
  valuationAssumption,
} from "./valuation-helpers";
import type {
  FactPack,
  ForecastResult,
  ForecastSpecification,
  SensitivityAnalysis,
  SensitivityRun,
  ValuationDiagnostic,
  ValuationMethodPlan,
  ValuationSpecification,
} from "./types";

export interface ValuationSensitivityInput {
  specification: ValuationSpecification;
  forecast: ForecastResult;
  factPack: FactPack;
  forecastSpec?: ForecastSpecification;
  architecture?: string;
  requireEvidence?: boolean;
  variables?: string[];
}

export interface ValuationSensitivityExecution {
  analysis: SensitivityAnalysis;
  fairValue: number | null;
  forecast: ForecastResult;
}

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function selectedPlan(specification: ValuationSpecification): ValuationMethodPlan | undefined {
  const selected = normalizeValuationMethod(specification.selectedMethod ?? specification.methodology);
  return methodPlansFromSpecification(specification).find((plan) => normalizeValuationMethod(plan.method) === selected)
    ?? methodPlansFromSpecification(specification)[0];
}

function planValue(plan: ValuationMethodPlan, variable: string): number | undefined {
  if (variable.startsWith("component:")) {
    const component = plan.components?.find((candidate) => candidate.id === variable.slice("component:".length));
    return component?.value;
  }
  const assumption = valuationAssumption(plan, [variable]);
  if (assumption && isFiniteNumber(assumption.value)) return assumption.value;
  if (["discountRate", "wacc", "costOfEquity", "requiredReturn", "ke"].includes(variable) && isFiniteNumber(plan.discountRate)) return plan.discountRate;
  if (["terminalGrowth", "g", "terminalGrowthRate"].includes(variable)) return plan.terminalAssumptions?.growth ?? terminalPolicyOf(plan)?.growth;
  return undefined;
}

function applyPlanValue(plan: ValuationMethodPlan, variable: string, value: number): ValuationMethodPlan {
  const adjusted: ValuationMethodPlan = {
    ...plan,
    assumptions: plan.assumptions.map((assumption) => ({ ...assumption })),
    ...(plan.components ? { components: plan.components.map((component) => ({ ...component })) } : {}),
  };
  if (variable.startsWith("component:")) {
    const id = variable.slice("component:".length);
    adjusted.components = (adjusted.components ?? []).map((component) => component.id === id ? { ...component, value } : component);
    return adjusted;
  }
  const assumption = valuationAssumption(adjusted, [variable]);
  if (assumption) {
    adjusted.assumptions = adjusted.assumptions.map((candidate) => candidate.variable === assumption.variable ? { ...candidate, value, valuePath: undefined, path: undefined } : candidate);
  }
  if (["discountRate", "wacc", "costOfEquity", "requiredReturn", "ke"].includes(variable)) adjusted.discountRate = value;
  if (["terminalGrowth", "g", "terminalGrowthRate"].includes(variable)) {
    adjusted.terminalAssumptions = { growth: value, rationale: plan.terminalAssumptions?.rationale ?? plan.terminalPolicy?.rationale ?? "Sensitivity terminal growth" };
    if (adjusted.terminalPolicy) adjusted.terminalPolicy = { ...adjusted.terminalPolicy, growth: value };
  }
  return adjusted;
}

function modelVariable(forecastSpec: ForecastSpecification, variable: string) {
  const normalized = variable.toLowerCase();
  return forecastSpec.variables.find((candidate) => candidate.kind === "input" && candidate.name.toLowerCase() === normalized);
}

function applyModelValue(forecastSpec: ForecastSpecification, variable: string, value: number): ForecastSpecification {
  const adjusted = cloneForecastSpecification(forecastSpec);
  const definition = modelVariable(forecastSpec, variable);
  if (!definition) return adjusted;
  const path = Array.from({ length: forecastSpec.horizonYears }, () => value);
  const driverKey = Object.keys(adjusted.driverPaths).find((key) => key.toLowerCase() === variable.toLowerCase());
  if (driverKey) adjusted.driverPaths[driverKey] = path;
  else {
    adjusted.assumptions = adjusted.assumptions.map((assumption) => assumption.variable.toLowerCase() === variable.toLowerCase()
      ? { ...assumption, value, valuePath: path, path }
      : assumption);
  }
  return adjusted;
}

function relevantVariables(plan: ValuationMethodPlan, specification: ValuationSpecification, forecastSpec: ForecastSpecification | undefined, overrides?: readonly string[]): Array<{ variable: string; source: "valuation" | "forecast" }> {
  const method = normalizeValuationMethod(plan.method);
  const definition = method ? getValuationMethod(method) : undefined;
  const requested = new Set([...(definition?.sensitivityVariables ?? []), ...(overrides ?? []), ...(plan.sensitivityVariables ?? [])]);
  if (normalizeValuationMethod(plan.method) === "SOTP" || normalizeValuationMethod(plan.method) === "NAV") for (const component of plan.components ?? []) requested.add(`component:${component.id}`);
  const result: Array<{ variable: string; source: "valuation" | "forecast" }> = [];
  for (const variable of [...requested].sort()) {
    if (variable.startsWith("component:") && plan.components?.some((component) => `component:${component.id}` === variable)) result.push({ variable, source: "valuation" });
    else if (isFiniteNumber(planValue(plan, variable))) result.push({ variable, source: "valuation" });
    else if (forecastSpec && modelVariable(forecastSpec, variable)) result.push({ variable, source: "forecast" });
  }
  for (const variable of specification.variablesDrivingValuation ?? []) {
    if (!result.some((entry) => entry.variable.toLowerCase() === variable.toLowerCase()) && forecastSpec && modelVariable(forecastSpec, variable)) result.push({ variable, source: "forecast" });
  }
  return result;
}

function sensitivityValues(variable: string, base: number, plan: ValuationMethodPlan): [number, number, number] {
  if (variable.startsWith("component:")) {
    const step = Math.max(Math.abs(base) * 0.2, 1);
    return [base - step, base, base + step];
  }
  if (["discountRate", "wacc", "costOfEquity", "requiredReturn", "ke"].includes(variable)) {
    const step = Math.max(0.005, Math.abs(base) * 0.1);
    return [Math.max(0.0001, base - step), base, base + step];
  }
  if (["terminalGrowth", "g", "terminalGrowthRate"].includes(variable)) {
    const rate = plan.discountRate ?? planValue(plan, "discountRate") ?? planValue(plan, "costOfEquity");
    const step = Math.max(0.0025, Math.min(0.01, Math.abs((rate ?? base + 0.05) - base) * 0.15));
    return [Math.max(-0.95, base - step), base, Math.min((rate ?? Number.POSITIVE_INFINITY) - 0.0001, base + step)];
  }
  const step = Math.max(Math.abs(base) * 0.2, 0.01);
  return [Math.max(0, base - step), base, base + step];
}

function runValuation(plan: ValuationMethodPlan, specification: ValuationSpecification, forecast: ForecastResult, factPack: FactPack, forecastSpec: ForecastSpecification | undefined, architecture: string | undefined, requireEvidence: boolean) {
  const adjustedSpecification: ValuationSpecification = {
    ...specification,
    methodology: String(plan.method),
    method: plan.method,
    selectedMethod: plan.method,
    rationale: plan.rationale,
    variablesDrivingValuation: [...plan.variablesDrivingValuation],
    assumptions: plan.assumptions.map((assumption) => ({ ...assumption })),
    discountRate: plan.discountRate,
    discountRateRationale: plan.discountRateRationale,
    terminalAssumptions: plan.terminalAssumptions,
    terminalPolicy: plan.terminalPolicy,
    components: plan.components,
    evidence: plan.evidence,
    evidenceIds: plan.evidenceIds,
    discountRateEvidenceIds: plan.discountRateEvidenceIds,
    terminalGrowthEvidenceIds: plan.terminalGrowthEvidenceIds,
    sensitivityVariables: plan.sensitivityVariables,
    methodPlans: [plan],
  };
  return executeValuation(adjustedSpecification, forecast, factPack, {
    ...(forecastSpec ? { forecastSpec } : {}),
    ...(architecture ? { architecture } : {}),
    requireEvidence,
    selectedMethod: String(plan.method),
  });
}

function runVariable(input: ValuationSensitivityInput, plan: ValuationMethodPlan, variable: string, source: "valuation" | "forecast", baseFairValue: number | null): SensitivityRun {
  const baseValue = source === "valuation" ? planValue(plan, variable) : modelVariable(input.forecastSpec as ForecastSpecification, variable)?.baseValue;
  const diagnostics: ValuationDiagnostic[] = [];
  if (!isFiniteNumber(baseValue)) {
    const message = `Sensitivity variable ${variable} has no finite base value.`;
    diagnostics.push(diagnostic("SENSITIVITY_BASE_MISSING", message));
    return { id: stableId("SENS", [input.specification.specId, variable, "blocked"]), variable, source, method: String(plan.method), lowValue: Number.NaN, baseValue: Number.NaN, highValue: Number.NaN, values: [], fairValues: [], baseFairValue, fairValueRange: null, rangePct: null, modelExecutions: 0, status: "blocked", diagnostics };
  }
  const values = sensitivityValues(variable, baseValue, plan);
  const fairValues: Array<number | null> = [];
  let modelExecutions = 0;
  values.forEach((value, index) => {
    if (index === 1 && source === "forecast") {
      fairValues.push(baseFairValue);
      return;
    }
    let forecast = input.forecast;
    let candidatePlan = plan;
    if (source === "forecast") {
      if (!input.forecastSpec) {
        fairValues.push(null);
        diagnostics.push(diagnostic("SENSITIVITY_MODEL_SPEC_MISSING", `Forecast specification is required to rerun ${variable}.`));
        return;
      }
      const adjustedModel = applyModelValue(input.forecastSpec, variable, value);
      const output = executeForecast({ model: adjustedModel, factPack: input.factPack, ...(input.architecture ? { architecture: architectureInput(input.architecture) } : {}) });
      modelExecutions += 1;
      forecast = { ...output.forecast, modelId: input.forecastSpec.modelId, forecastId: stableId("FCSENS", [input.forecastSpec.modelId ?? input.forecastSpec.architecture, variable, value]) };
    } else {
      candidatePlan = applyPlanValue(plan, variable, value);
    }
    const valuation = runValuation(candidatePlan, input.specification, forecast, input.factPack, source === "forecast" ? input.forecastSpec : undefined, input.architecture, input.requireEvidence ?? true);
    if (valuation.status !== "ready" || !isFiniteNumber(valuation.fairValuePerShare)) diagnostics.push(diagnostic("SENSITIVITY_CASE_UNAVAILABLE", `${variable}=${value} did not produce a ready valuation.`, "warning", variable));
    fairValues.push(valuation.status === "ready" && isFiniteNumber(valuation.fairValuePerShare) ? valuation.fairValuePerShare : null);
  });
  const completed = fairValues.filter((value): value is number => isFiniteNumber(value));
  const fairValueRange = completed.length >= 2 ? Math.max(...completed) - Math.min(...completed) : null;
  return {
    id: stableId("SENS", [input.specification.specId ?? input.specification.methodology, plan.method, variable]),
    variable,
    source,
    method: String(plan.method),
    lowValue: values[0],
    baseValue,
    highValue: values[2],
    values,
    fairValues,
    baseFairValue,
    fairValueRange,
    rangePct: fairValueRange !== null && isFiniteNumber(baseFairValue) && baseFairValue !== 0 ? fairValueRange / Math.abs(baseFairValue) : null,
    modelExecutions,
    status: completed.length === 3 && diagnostics.every((entry) => entry.severity !== "error") ? "ready" : "blocked",
    diagnostics,
  };
}

export function runValuationSensitivity(input: ValuationSensitivityInput): SensitivityAnalysis {
  const id = stableId("SENSANALYSIS", [input.specification.specId ?? input.specification.methodology, input.forecast.forecastId ?? input.forecast.modelId, input.factPack.contentHash ?? input.factPack.ticker]);
  if (isForecastBlocked(input.forecast)) {
    const blockers = input.forecast.blockers?.length ? input.forecast.blockers : ["Forecast publicationBlocked=true"];
    return { id, ...(input.forecast.modelId ? { valuationId: input.forecast.modelId } : {}), method: input.specification.methodology, status: "blocked", runs: [], rankedVariables: [], diagnostics: [diagnostic("FORECAST_BLOCKED", `Sensitivity is blocked: ${blockers.join("; ")}.`)], blockers, publicationBlocked: true };
  }
  const plan = selectedPlan(input.specification);
  if (!plan) {
    const blockers = ["No executable valuation method plan is available for sensitivity."];
    return { id, method: input.specification.methodology, status: "blocked", runs: [], rankedVariables: [], diagnostics: blockers.map((message) => diagnostic("SENSITIVITY_METHOD_MISSING", message)), blockers, publicationBlocked: true };
  }
  const baseValuation = runValuation(plan, input.specification, input.forecast, input.factPack, input.forecastSpec, input.architecture, input.requireEvidence ?? true);
  if (baseValuation.status !== "ready" || !isFiniteNumber(baseValuation.fairValuePerShare)) {
    const blockers = baseValuation.blockers?.length ? baseValuation.blockers : ["Base valuation is unavailable."];
    return { id, ...(baseValuation.id ? { valuationId: baseValuation.id } : {}), method: String(plan.method), status: "blocked", runs: [], rankedVariables: [], diagnostics: blockers.map((message) => diagnostic("SENSITIVITY_BASE_BLOCKED", message)), blockers, publicationBlocked: true };
  }
  const variables = relevantVariables(plan, input.specification, input.forecastSpec, input.variables);
  const runs = variables.map((entry) => runVariable(input, plan, entry.variable, entry.source, baseValuation.fairValuePerShare as number));
  const ranked = [...runs].filter((run) => run.status === "ready" && run.fairValueRange !== null).sort((left, right) => (right.fairValueRange as number) - (left.fairValueRange as number) || left.variable.localeCompare(right.variable));
  const blocked = runs.some((run) => run.status !== "ready");
  return {
    id,
    valuationId: baseValuation.id,
    method: String(plan.method),
    status: runs.length > 0 && !blocked ? "ready" : "blocked",
    runs,
    rankedVariables: ranked.map((run) => run.variable),
    diagnostics: runs.flatMap((run) => run.diagnostics),
    blockers: runs.filter((run) => run.status !== "ready").map((run) => `${run.variable} sensitivity unavailable`),
    publicationBlocked: runs.length === 0 || blocked,
  };
}

export const buildSensitivityAnalysis = runValuationSensitivity;

export function toLegacySensitivityGrid(analysis: SensitivityAnalysis): Array<Record<string, number | string>> {
  if (analysis.status !== "ready" || analysis.runs.length === 0) return [];
  return analysis.runs.flatMap((run) => run.values.map((value, index) => ({
    variable: run.variable,
    value,
    baseValue: run.baseValue,
    fairValue: run.fairValues[index] ?? "N/A",
    fairValueRange: run.fairValueRange ?? "N/A",
    sensitivityId: run.id,
  })));
}

export interface SensitivityCaseResult {
  fairValue: number | null;
  forecast: ForecastResult;
  modelExecutions: number;
}

export function executeSensitivityCase(input: ValuationSensitivityInput, variable: string, value: number, source: "valuation" | "forecast"): SensitivityCaseResult {
  const plan = selectedPlan(input.specification);
  if (!plan) return { fairValue: null, forecast: input.forecast, modelExecutions: 0 };
  if (source === "valuation") {
    const adjustedPlan = applyPlanValue(plan, variable, value);
    const valuation = runValuation(adjustedPlan, input.specification, input.forecast, input.factPack, input.forecastSpec, input.architecture, input.requireEvidence ?? true);
    return { fairValue: valuation.status === "ready" && isFiniteNumber(valuation.fairValuePerShare) ? valuation.fairValuePerShare : null, forecast: input.forecast, modelExecutions: 0 };
  }
  if (!input.forecastSpec) return { fairValue: null, forecast: input.forecast, modelExecutions: 0 };
  const adjustedModel = applyModelValue(input.forecastSpec, variable, value);
  const output = executeForecast({ model: adjustedModel, factPack: input.factPack, ...(input.architecture ? { architecture: architectureInput(input.architecture) } : {}) });
  const forecast = { ...output.forecast, modelId: input.forecastSpec.modelId, forecastId: stableId("FCSENS", [input.forecastSpec.modelId ?? input.forecastSpec.architecture, variable, value]) };
  const valuation = runValuation(plan, input.specification, forecast, input.factPack, input.forecastSpec, input.architecture, input.requireEvidence ?? true);
  return { fairValue: valuation.status === "ready" && isFiniteNumber(valuation.fairValuePerShare) ? valuation.fairValuePerShare : null, forecast, modelExecutions: 1 };
}

export default {
  buildSensitivityAnalysis,
  executeSensitivityCase,
  runValuationSensitivity,
  toLegacySensitivityGrid,
};
