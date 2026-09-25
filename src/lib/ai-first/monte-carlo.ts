import { executeForecast } from "./forecast-engine";
import { executeValuation } from "./valuation-engine";
import { percentile } from "./valuation-cross-check";
import { methodPlansFromSpecification, normalizeValuationMethod } from "./valuation-methods";
import {
  architectureInput,
  cloneForecastSpecification,
  isFiniteNumber,
  isForecastBlocked,
  resolveValuationAnchors,
  stableHash,
  stableId,
  terminalPolicyOf,
  valuationAssumption,
} from "./valuation-helpers";
import type {
  FactPack,
  ForecastResult,
  ForecastSpecification,
  MonteCarloDistribution,
  MonteCarloDriver,
  MonteCarloPercentiles,
  MonteCarloResult,
  MonteCarloVariable,
  ValuationDiagnostic,
  ValuationMethodPlan,
  ValuationSpecification,
} from "./types";

export const MONTE_CARLO_MIN_SAMPLES = 32;
export const MONTE_CARLO_MAX_SAMPLES = 10_000;
export const MONTE_CARLO_MAX_ATTEMPT_MULTIPLIER = 10;

export interface MonteCarloInput {
  specification: ValuationSpecification;
  forecast: ForecastResult;
  factPack: FactPack;
  forecastSpec?: ForecastSpecification;
  architecture?: string;
  requireEvidence?: boolean;
  variables: MonteCarloVariable[];
  sampleCount?: number;
  seed: number | string;
  retentionLimit?: number;
}

interface RandomSource {
  next(): number;
  normal(): number;
}

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

export function normalizeSeed(seed: number | string): number {
  if (typeof seed === "number" && Number.isFinite(seed)) return Math.abs(Math.trunc(seed)) >>> 0;
  const hash = Number.parseInt(stableHash(String(seed)), 36) >>> 0;
  return hash;
}

export function createSeededRandom(seed: number | string): RandomSource {
  let state = normalizeSeed(seed) || 0x6d2b79f5;
  let spare: number | undefined;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    normal: () => {
      if (spare !== undefined) {
        const value = spare;
        spare = undefined;
        return value;
      }
      let first = 0;
      let second = 0;
      while (first <= Number.EPSILON) first = next();
      while (second <= Number.EPSILON) second = next();
      const magnitude = Math.sqrt(-2 * Math.log(first));
      spare = magnitude * Math.sin(2 * Math.PI * second);
      return magnitude * Math.cos(2 * Math.PI * second);
    },
  };
}

function sampleDistribution(distribution: MonteCarloDistribution, random: RandomSource): number {
  if (distribution.type === "uniform") return distribution.min + (distribution.max - distribution.min) * random.next();
  if (distribution.type === "triangular") {
    const span = distribution.max - distribution.min;
    const draw = random.next();
    const split = (distribution.mode - distribution.min) / span;
    return draw < split
      ? distribution.min + Math.sqrt(draw * span * (distribution.mode - distribution.min))
      : distribution.max - Math.sqrt((1 - draw) * span * (distribution.max - distribution.mode));
  }
  const raw = distribution.mean + distribution.standardDeviation * random.normal();
  return Math.max(distribution.min, Math.min(distribution.max, raw));
}

function selectedPlan(specification: ValuationSpecification): ValuationMethodPlan | undefined {
  const selected = normalizeValuationMethod(specification.selectedMethod ?? specification.methodology);
  const plans = methodPlansFromSpecification(specification);
  return plans.find((plan) => normalizeValuationMethod(plan.method) === selected) ?? plans[0];
}

function invalidValuationPlan(plan: ValuationMethodPlan): boolean {
  const policy = terminalPolicyOf(plan);
  if (!policy) return false;
  const rate = planBaseValue(plan, "wacc") ?? planBaseValue(plan, "costOfEquity");
  return !isFiniteNumber(rate) || rate <= policy.growth || policy.growth >= 1 || policy.maxValueShare <= 0 || policy.maxValueShare >= 1;
}

function planBaseValue(plan: ValuationMethodPlan, variable: string): number | undefined {
  if (variable.startsWith("component:")) return plan.components?.find((component) => `component:${component.id}` === variable)?.value;
  const assumption = valuationAssumption(plan, [variable]);
  if (assumption && isFiniteNumber(assumption.value)) return assumption.value;
  if (["wacc", "discountRate", "costOfEquity", "requiredReturn", "ke"].includes(variable)) return plan.discountRate;
  if (["terminalGrowth", "g", "terminalGrowthRate"].includes(variable)) return plan.terminalAssumptions?.growth ?? terminalPolicyOf(plan)?.growth;
  return undefined;
}

function applyPlanValues(plan: ValuationMethodPlan, values: ReadonlyMap<string, number>): ValuationMethodPlan {
  const adjusted: ValuationMethodPlan = {
    ...plan,
    assumptions: plan.assumptions.map((assumption) => ({ ...assumption })),
    ...(plan.components ? { components: plan.components.map((component) => ({ ...component })) } : {}),
  };
  for (const [variable, value] of values) {
    if (variable.startsWith("component:")) {
      const componentId = variable.slice("component:".length);
      adjusted.components = (adjusted.components ?? []).map((component) => component.id === componentId ? { ...component, value } : component);
      continue;
    }
    const assumption = valuationAssumption(adjusted, [variable]);
    if (assumption) adjusted.assumptions = adjusted.assumptions.map((candidate) => candidate.variable === assumption.variable ? { ...candidate, value, valuePath: undefined, path: undefined } : candidate);
    if (["wacc", "discountRate", "costOfEquity", "requiredReturn", "ke"].includes(variable)) adjusted.discountRate = value;
    if (["terminalGrowth", "g", "terminalGrowthRate"].includes(variable)) {
      adjusted.terminalAssumptions = { growth: value, rationale: plan.terminalAssumptions?.rationale ?? plan.terminalPolicy?.rationale ?? "Monte Carlo terminal growth" };
      if (adjusted.terminalPolicy) adjusted.terminalPolicy = { ...adjusted.terminalPolicy, growth: value };
    }
  }
  return adjusted;
}

function applyModelValues(forecastSpec: ForecastSpecification, values: ReadonlyMap<string, number>): ForecastSpecification {
  const adjusted = cloneForecastSpecification(forecastSpec);
  for (const [variable, value] of values) {
    const path = Array.from({ length: adjusted.horizonYears }, () => value);
    const driverKey = Object.keys(adjusted.driverPaths).find((key) => key.toLowerCase() === variable.toLowerCase());
    if (driverKey) adjusted.driverPaths[driverKey] = path;
    else adjusted.assumptions = adjusted.assumptions.map((assumption) => assumption.variable.toLowerCase() === variable.toLowerCase() ? { ...assumption, value, valuePath: path, path } : assumption);
  }
  return adjusted;
}

export function sampledTerminalPolicyInvalid(variables: readonly MonteCarloVariable[], sample: Record<string, number>): boolean {
  let rate: number | undefined;
  let growth: number | undefined;
  for (const variable of variables) {
    const value = sample[variable.variable];
    if (["wacc", "discountRate", "costOfCapital"].includes(variable.variable)) rate = value;
    if (["costOfEquity", "requiredReturn", "ke"].includes(variable.variable)) rate = value;
    if (["terminalGrowth", "terminalGrowthRate", "g"].includes(variable.variable)) growth = value;
  }
  return isFiniteNumber(rate) && isFiniteNumber(growth) && growth >= rate;
}

function percentiles(values: readonly number[]): MonteCarloPercentiles {
  return { p10: percentile(values, 0.1), p25: percentile(values, 0.25), p50: percentile(values, 0.5), p75: percentile(values, 0.75), p90: percentile(values, 0.9) };
}

function correlation(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] - leftMean;
    const y = right[index] - rightMean;
    covariance += x * y;
    leftVariance += x * x;
    rightVariance += y * y;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : 0;
}

function validateVariable(variable: MonteCarloVariable, plan: ValuationMethodPlan | undefined, forecastSpec: ForecastSpecification | undefined): string | null {
  const distribution = variable.distribution;
  if (!distribution || !isFiniteNumber(distribution.min) || !isFiniteNumber(distribution.max) || distribution.min >= distribution.max) return `${variable.variable} distribution requires min < max.`;
  if (distribution.type === "normal" && (!isFiniteNumber(distribution.mean) || !isFiniteNumber(distribution.standardDeviation) || distribution.standardDeviation < 0)) return `${variable.variable} normal distribution is invalid.`;
  if (distribution.type === "triangular" && (!isFiniteNumber(distribution.mode) || distribution.mode < distribution.min || distribution.mode > distribution.max)) return `${variable.variable} triangular mode is outside bounds.`;
  if (variable.source === "valuation") {
    if (!plan || !isFiniteNumber(planBaseValue(plan, variable.variable))) return `${variable.variable} is not an executable valuation assumption.`;
  } else {
    const known = forecastSpec?.variables.some((candidate) => candidate.kind === "input" && candidate.name.toLowerCase() === variable.variable.toLowerCase());
    if (!forecastSpec || !known) return `${variable.variable} is not a known forecast input.`;
  }
  return null;
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const seed = normalizeSeed(input.seed);
  const requestedSamples = Math.max(MONTE_CARLO_MIN_SAMPLES, Math.min(MONTE_CARLO_MAX_SAMPLES, Math.trunc(input.sampleCount ?? 1000)));
  const id = stableId("MC", [input.specification.specId ?? input.specification.methodology, input.forecast.forecastId ?? input.forecast.modelId, input.factPack.factPackId ?? input.factPack.contentHash ?? input.factPack.ticker, seed, requestedSamples, input.variables]);
  const anchors = resolveValuationAnchors(input.factPack);
  const blocked = (blockers: string[], code = "MONTE_CARLO_BLOCKED"): MonteCarloResult => ({
    id,
    method: input.specification.methodology,
    status: "blocked",
    seed,
    requestedSamples,
    acceptedSamples: 0,
    rejectedSamples: 0,
    attemptedSamples: 0,
    fairValue: { p10: Number.NaN, p25: Number.NaN, p50: Number.NaN, p75: Number.NaN, p90: Number.NaN },
    returnPct: { p10: Number.NaN, p25: Number.NaN, p50: Number.NaN, p75: Number.NaN, p90: Number.NaN },
    centralRange: { low: Number.NaN, high: Number.NaN },
    downsideRange: { low: Number.NaN, high: Number.NaN },
    upsideRange: { low: Number.NaN, high: Number.NaN },
    probabilityOfUpside: Number.NaN,
    ...(isFiniteNumber(anchors.currentPrice) ? { currentPrice: anchors.currentPrice } : {}),
    keyVarianceDrivers: [],
    diagnostics: blockers.map((message) => diagnostic(code, message)),
    blockers,
    publicationBlocked: true,
  });
  if (isForecastBlocked(input.forecast)) return blocked(input.forecast.blockers?.length ? input.forecast.blockers : ["Forecast publicationBlocked=true."], "FORECAST_BLOCKED");
  if (!isFiniteNumber(anchors.currentPrice) || anchors.currentPrice <= 0) return blocked(["A positive current price is required to calculate Monte Carlo returns and probability of upside."], "MONTE_CARLO_PRICE_MISSING");
  if (input.variables.length === 0) return blocked(["At least one bounded Monte Carlo variable is required."], "MONTE_CARLO_VARIABLES_MISSING");
  const plan = selectedPlan(input.specification);
  const variableErrors = input.variables.map((variable) => validateVariable(variable, plan, input.forecastSpec)).filter((message): message is string => message !== null);
  if (variableErrors.length > 0) return blocked(variableErrors, "MONTE_CARLO_VARIABLE_INVALID");
  const random = createSeededRandom(seed);
  const acceptedValues: number[] = [];
  const acceptedReturns: number[] = [];
  const acceptedSamples: Array<Record<string, number>> = [];
  const acceptedInputs: Array<Record<string, number>> = [];
  let rejectedSamples = 0;
  let attemptedSamples = 0;
  const maxAttempts = requestedSamples * MONTE_CARLO_MAX_ATTEMPT_MULTIPLIER;
  while (acceptedValues.length < requestedSamples && attemptedSamples < maxAttempts) {
    attemptedSamples += 1;
    const valuationValues = new Map<string, number>();
    const modelValues = new Map<string, number>();
    const sample: Record<string, number> = {};
    for (const variable of input.variables) {
      const value = sampleDistribution(variable.distribution, random);
      if (!isFiniteNumber(value) || value < variable.distribution.min || value > variable.distribution.max) {
        rejectedSamples += 1;
        break;
      }
      sample[variable.variable] = value;
      if (variable.source === "valuation") valuationValues.set(variable.variable, value);
      else modelValues.set(variable.variable, value);
    }
    if (Object.keys(sample).length !== input.variables.length) continue;
    const sampledRateVariable = input.variables.find((variable) => ["wacc", "discountRate", "costOfCapital", "costOfEquity", "requiredReturn", "ke"].includes(variable.variable));
    const sampledGrowthVariable = input.variables.find((variable) => ["terminalGrowth", "terminalGrowthRate", "g"].includes(variable.variable));
    const sampledRate = sampledRateVariable ? sample[sampledRateVariable.variable] : undefined;
    const sampledGrowth = sampledGrowthVariable ? sample[sampledGrowthVariable.variable] : undefined;
    if (isFiniteNumber(sampledRate) && isFiniteNumber(sampledGrowth) && sampledGrowth >= sampledRate) {
      rejectedSamples += 1;
      continue;
    }
    const adjustedPlan = plan ? applyPlanValues(plan, valuationValues) : undefined;
    if (adjustedPlan && invalidValuationPlan(adjustedPlan)) {
      rejectedSamples += 1;
      continue;
    }
    let forecast = input.forecast;
    if (modelValues.size > 0) {
      if (!input.forecastSpec) {
        rejectedSamples += 1;
        continue;
      }
      const adjustedModel = applyModelValues(input.forecastSpec, modelValues);
      const output = executeForecast({ model: adjustedModel, factPack: input.factPack, ...(input.architecture ? { architecture: architectureInput(input.architecture) } : {}) });
      forecast = { ...output.forecast, modelId: input.forecastSpec.modelId, forecastId: stableId("FCMC", [input.forecastSpec.modelId ?? input.forecastSpec.architecture, seed, attemptedSamples]) };
    }
    if (!adjustedPlan) {
      rejectedSamples += 1;
      continue;
    }
    const adjustedSpecification: ValuationSpecification = {
      ...input.specification,
      methodology: String(adjustedPlan.method),
      method: adjustedPlan.method,
      selectedMethod: adjustedPlan.method,
      rationale: adjustedPlan.rationale,
      variablesDrivingValuation: [...adjustedPlan.variablesDrivingValuation],
      assumptions: adjustedPlan.assumptions,
      discountRate: adjustedPlan.discountRate,
      discountRateRationale: adjustedPlan.discountRateRationale,
      terminalAssumptions: adjustedPlan.terminalAssumptions,
      terminalPolicy: adjustedPlan.terminalPolicy,
      components: adjustedPlan.components,
      evidence: adjustedPlan.evidence,
      evidenceIds: adjustedPlan.evidenceIds,
      discountRateEvidenceIds: adjustedPlan.discountRateEvidenceIds,
      terminalGrowthEvidenceIds: adjustedPlan.terminalGrowthEvidenceIds,
      sensitivityVariables: adjustedPlan.sensitivityVariables,
      methodPlans: [adjustedPlan],
    };
    const valuation = executeValuation(adjustedSpecification, forecast, input.factPack, {
      ...(input.forecastSpec ? { forecastSpec: input.forecastSpec } : {}),
      ...(input.architecture ? { architecture: input.architecture } : {}),
      requireEvidence: input.requireEvidence ?? true,
      selectedMethod: String(adjustedPlan.method),
    });
    if (valuation.status !== "ready" || !isFiniteNumber(valuation.fairValuePerShare)) {
      rejectedSamples += 1;
      continue;
    }
    const fairValue = valuation.fairValuePerShare;
    acceptedValues.push(fairValue);
    acceptedReturns.push(isFiniteNumber(anchors.currentPrice) && anchors.currentPrice > 0 ? (fairValue / anchors.currentPrice - 1) * 100 : Number.NaN);
    acceptedSamples.push(sample);
    acceptedInputs.push(sample);
  }
  if (acceptedValues.length < Math.max(MONTE_CARLO_MIN_SAMPLES, Math.floor(requestedSamples * 0.5))) {
    return blocked([`Only ${acceptedValues.length} of ${requestedSamples} requested Monte Carlo samples were valid after ${attemptedSamples} attempts.`], "MONTE_CARLO_INSUFFICIENT_SAMPLES");
  }
  const fairValue = percentiles(acceptedValues);
  const validReturns = acceptedReturns.filter(isFiniteNumber);
  const returns = validReturns.length >= 2 ? percentiles(validReturns) : fairValue;
  const keyVarianceDrivers: MonteCarloDriver[] = input.variables.map((variable) => {
    const values = acceptedInputs.map((sample) => sample[variable.variable]);
    const absoluteCorrelation = Math.abs(correlation(values, acceptedValues));
    return { variable: variable.variable, source: variable.source, absoluteCorrelation, contributionScore: absoluteCorrelation };
  }).sort((left, right) => right.contributionScore - left.contributionScore || left.variable.localeCompare(right.variable));
  const retentionLimit = Math.max(0, Math.min(MONTE_CARLO_MAX_SAMPLES, Math.trunc(input.retentionLimit ?? requestedSamples)));
  return {
    id,
    method: String(plan?.method ?? input.specification.methodology),
    status: "ready",
    seed,
    requestedSamples,
    acceptedSamples: acceptedValues.length,
    rejectedSamples,
    attemptedSamples,
    fairValue,
    returnPct: returns,
    centralRange: { low: fairValue.p25, high: fairValue.p75 },
    downsideRange: { low: fairValue.p10, high: fairValue.p25 },
    upsideRange: { low: fairValue.p75, high: fairValue.p90 },
    probabilityOfUpside: validReturns.length > 0 ? validReturns.filter((value) => value > 0).length / validReturns.length : Number.NaN,
    ...(isFiniteNumber(anchors.currentPrice) ? { currentPrice: anchors.currentPrice } : {}),
    keyVarianceDrivers,
    samples: acceptedSamples.slice(0, retentionLimit),
    diagnostics: rejectedSamples > 0 ? [diagnostic("MONTE_CARLO_SAMPLES_REJECTED", `${rejectedSamples} invalid sample(s) were rejected.`, "warning")] : [],
    blockers: [],
    publicationBlocked: false,
  };
}

export const runDeterministicMonteCarlo = runMonteCarlo;

export default { createSeededRandom, normalizeSeed, runDeterministicMonteCarlo, runMonteCarlo };
