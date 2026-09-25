import { executeForecast } from "./forecast-engine";
import { executeValuation } from "./valuation-engine";
import { validateReverseValuationPlan, type ReversePlannerInput } from "./reverse-planner";
import {
  architectureInput,
  cloneForecastSpecification,
  isFiniteNumber,
  isForecastBlocked,
  latestValueFromPack,
  stableId,
} from "./valuation-helpers";
import type {
  CompanyUnderstanding,
  Fact,
  FactPack,
  ForecastResult,
  ForecastSpecification,
  ReverseConvergence,
  ReverseValuationPlan,
  ReverseValuationResult,
  ValuationDiagnostic,
  ValuationResult,
  ValuationSpecification,
} from "./types";

export interface OneVariableSolveInput {
  plan: Pick<ReverseValuationPlan, "id" | "variable" | "unit" | "range" | "why">;
  target: number;
  evaluate: (value: number) => number | ValuationResult | undefined;
  maxIterations?: number;
  tolerance?: number;
  fairValueTolerance?: number;
}

export interface OneVariableSolution {
  status: "converged" | "unavailable";
  value?: number;
  fairValue?: number;
  convergence: ReverseConvergence;
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
}

export interface ReverseSolverInput {
  plan: ReverseValuationPlan;
  forecastSpec: ForecastSpecification;
  factPack: FactPack;
  valuationSpec: ValuationSpecification;
  architecture?: string;
  requireEvidence?: boolean;
  canonicalForecast?: ForecastResult;
}

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function evaluatedFairValue(value: number | ValuationResult | undefined): number | undefined {
  if (typeof value === "number") return isFiniteNumber(value) ? value : undefined;
  return value?.status === "ready" && isFiniteNumber(value.fairValuePerShare) ? value.fairValuePerShare : undefined;
}

function unavailableSolution(input: OneVariableSolveInput, message: string, monotonic = false, low = input.plan.range.min, high = input.plan.range.max, evaluations = 0): OneVariableSolution {
  return {
    status: "unavailable",
    convergence: { converged: false, iterations: 0, evaluations, tolerance: input.fairValueTolerance ?? 1e-8, residual: Number.NaN, bracket: { low, high }, monotonic },
    diagnostics: [diagnostic("REVERSE_SOLVER_UNAVAILABLE", message)],
    blockers: [message],
  };
}

export function solveOneVariable(input: OneVariableSolveInput): OneVariableSolution {
  const maxIterations = Math.max(1, Math.min(200, Math.trunc(input.maxIterations ?? 100)));
  const tolerance = Math.max(Number.EPSILON, input.tolerance ?? 1e-10);
  const fairValueTolerance = Math.max(Number.EPSILON, input.fairValueTolerance ?? 1e-8);
  if (!isFiniteNumber(input.target)) return unavailableSolution(input, "Reverse target must be finite.");
  if (!isFiniteNumber(input.plan.range.min) || !isFiniteNumber(input.plan.range.max) || input.plan.range.min >= input.plan.range.max) return unavailableSolution(input, "Reverse plan range is invalid.");
  let low = input.plan.range.min;
  let high = input.plan.range.max;
  let evaluations = 0;
  const fairLow = evaluatedFairValue(input.evaluate(low));
  evaluations += 1;
  if (fairLow === undefined) return unavailableSolution(input, `Solver evaluation at range minimum ${low} is invalid.`, false, low, high, evaluations);
  const fairHigh = evaluatedFairValue(input.evaluate(high));
  evaluations += 1;
  if (fairHigh === undefined) return unavailableSolution(input, `Solver evaluation at range maximum ${high} is invalid.`, false, low, high, evaluations);
  if (fairLow === fairHigh) return unavailableSolution(input, "Selected variable does not change fair value across its declared range.", false, low, high, evaluations);
  const increasing = fairLow < fairHigh;
  if (increasing && (input.target < fairLow || input.target > fairHigh)) return unavailableSolution(input, `Target price ${input.target} is outside the declared range's value bracket [${fairLow}, ${fairHigh}].`, true, low, high, evaluations);
  if (!increasing && (input.target > fairLow || input.target < fairHigh)) return unavailableSolution(input, `Target price ${input.target} is outside the declared range's value bracket [${fairLow}, ${fairHigh}].`, true, low, high, evaluations);
  let iterations = 0;
  let midpoint = (low + high) / 2;
  let fairMidpoint: number | undefined = fairLow;
  for (; iterations < maxIterations; iterations += 1) {
    midpoint = (low + high) / 2;
    fairMidpoint = evaluatedFairValue(input.evaluate(midpoint));
    evaluations += 1;
    if (fairMidpoint === undefined) return unavailableSolution(input, `Solver evaluation at ${midpoint} is invalid.`, true, low, high, evaluations);
    const residual = fairMidpoint - input.target;
    if (Math.abs(residual) <= fairValueTolerance || high - low <= tolerance * Math.max(1, Math.abs(midpoint))) break;
    if ((increasing && residual < 0) || (!increasing && residual > 0)) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  const fairValue = evaluatedFairValue(input.evaluate(midpoint));
  evaluations += 1;
  const residual = fairValue === undefined ? Number.NaN : fairValue - input.target;
  const converged = fairValue !== undefined && Math.abs(residual) <= Math.max(fairValueTolerance, tolerance * Math.max(1, Math.abs(input.target)));
  return {
    status: converged ? "converged" : "unavailable",
    ...(converged ? { value: midpoint, ...(fairValue !== undefined ? { fairValue } : {}) } : {}),
    convergence: { converged, iterations, evaluations, tolerance, residual, bracket: { low, high }, monotonic: true },
    diagnostics: converged ? [] : [diagnostic("REVERSE_SOLVER_NOT_CONVERGED", "Bisection did not meet the requested fair-value tolerance.")],
    blockers: converged ? [] : ["Reverse bisection did not converge."],
  };
}

export const bisectOneVariable = solveOneVariable;

export function applyReverseVariable(forecastSpec: ForecastSpecification, plan: ReverseValuationPlan, value: number): ForecastSpecification {
  const adjusted = cloneForecastSpecification(forecastSpec);
  const path = Array.from({ length: adjusted.horizonYears }, () => value);
  const driverKey = Object.keys(adjusted.driverPaths).find((key) => key.toLowerCase() === plan.modelVariable.toLowerCase());
  if (driverKey) adjusted.driverPaths[driverKey] = path;
  else {
    const before = adjusted.assumptions.map((assumption) => JSON.stringify(assumption));
    adjusted.assumptions = adjusted.assumptions.map((assumption) => assumption.variable.toLowerCase() === plan.modelVariable.toLowerCase()
      ? { ...assumption, value, valuePath: path, path }
      : assumption);
    if (before.every((entry, index) => entry === JSON.stringify(adjusted.assumptions[index]))) throw new Error(`Reverse plan variable ${plan.modelVariable} has no executable model path.`);
  }
  return adjusted;
}

export function buildOneVariableSolver(input: ReverseSolverInput): (value: number) => ValuationResult | undefined {
  return (value: number) => {
    const adjustedModel = applyReverseVariable(input.forecastSpec, input.plan, value);
    const forecastOut = executeForecast({ model: adjustedModel, factPack: input.factPack, ...(input.architecture ? { architecture: architectureInput(input.architecture) } : {}) });
    if (isForecastBlocked(forecastOut.forecast)) return undefined;
    const forecast: ForecastResult = {
      ...forecastOut.forecast,
      ...(input.forecastSpec.modelId ? { modelId: input.forecastSpec.modelId } : {}),
      forecastId: stableId("FCREV", [input.forecastSpec.modelId ?? input.forecastSpec.architecture, input.plan.id, value]),
    };
    const valuation = executeValuation(input.valuationSpec, forecast, input.factPack, {
      forecastSpec: adjustedModel,
      ...(input.architecture ? { architecture: input.architecture } : {}),
      requireEvidence: input.requireEvidence ?? true,
    });
    return valuation.status === "ready" ? valuation : undefined;
  };
}

export function solveReverseValuation(input: ReverseSolverInput, targetPrice?: number): ReverseValuationResult {
  const target = targetPrice ?? currentPriceOf(input.factPack);
  const baseId = stableId("REV", [input.plan.id, target, input.valuationSpec.specId ?? input.valuationSpec.methodology]);
  if (input.canonicalForecast && isForecastBlocked(input.canonicalForecast)) {
    const blockers = input.canonicalForecast.blockers?.length ? input.canonicalForecast.blockers : ["Forecast publicationBlocked=true."];
    return { id: baseId, variable: input.plan.variable, status: "blocked", interpretation: "Reverse valuation is blocked by the canonical forecast.", plan: input.plan, targetPrice: isFiniteNumber(target) ? target : undefined, diagnostics: [diagnostic("FORECAST_BLOCKED", blockers.join("; "))], blockers, publicationBlocked: true };
  }
  if (!isFiniteNumber(target) || target <= 0) {
    const message = "Reverse valuation requires an explicit positive current price.";
    return { id: baseId, variable: input.plan.variable, status: "unavailable", interpretation: message, plan: input.plan, diagnostics: [diagnostic("REVERSE_PRICE_MISSING", message)], blockers: [message], publicationBlocked: true };
  }
  const solve = buildOneVariableSolver(input);
  const solution = solveOneVariable({ plan: input.plan, target, evaluate: solve, maxIterations: 100, tolerance: 1e-10, fairValueTolerance: Math.max(1e-8, target * 1e-9) });
  if (solution.status !== "converged" || !isFiniteNumber(solution.value)) {
    return { id: baseId, variable: input.plan.variable, status: "unavailable", interpretation: solution.blockers.join(" "), plan: input.plan, targetPrice: target, convergence: solution.convergence, diagnostics: solution.diagnostics, blockers: solution.blockers, publicationBlocked: true };
  }
  const value = solution.value as number;
  const formatted = input.plan.unit === "decimal" ? `${(value * 100).toFixed(2)}%` : value.toFixed(2);
  return {
    id: baseId,
    variable: input.plan.variable,
    requiredValue: value,
    interpretation: `The current price implies ${input.plan.variable} of ${formatted} while holding all other selected model paths unchanged.`,
    status: "ready",
    plan: input.plan,
    targetPrice: target,
    convergence: solution.convergence,
    valuation: solve(value),
    diagnostics: [],
    blockers: [],
    publicationBlocked: false,
  };
}

export const executeReverseValuation = solveReverseValuation;

export function chooseReverseVariable(plan: ReverseValuationPlan | CompanyUnderstanding, _valuation?: ValuationResult): ReverseValuationPlan | null {
  if (plan && typeof plan === "object" && "range" in plan && "modelVariable" in plan) return plan;
  return null;
}

export function solveRequiredValue(
  chosen: ReverseValuationPlan,
  currentPrice: number | undefined,
  solveFn: (candidateValue: number) => number | undefined,
): { variable: string; requiredValue: number; interpretation: string } | null {
  if (!isFiniteNumber(currentPrice) || currentPrice <= 0) return null;
  const solution = solveOneVariable({ plan: chosen, target: currentPrice, evaluate: solveFn });
  if (solution.status !== "converged" || !isFiniteNumber(solution.value)) return null;
  const value = solution.value as number;
  const formatted = chosen.unit === "decimal" ? `${(value * 100).toFixed(2)}%` : value.toFixed(2);
  return { variable: chosen.variable, requiredValue: value, interpretation: `The current price implies ${chosen.variable} of ${formatted}.` };
}

export function buildRevenueCagrSolver(
  factPack: FactPack,
  forecastSpec: ForecastSpecification,
  valuationSpec: ValuationSpecification,
  executeForecastFn: (input: { model: ForecastSpecification; factPack: FactPack }) => { forecast: ForecastResult },
  executeValuationFn: (spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack) => ValuationResult,
): (cagr: number) => number | undefined {
  return (cagr: number) => {
    const adjusted = cloneForecastSpecification(forecastSpec);
    if (!Object.keys(adjusted.driverPaths).some((key) => key.toLowerCase() === "revenue")) return undefined;
    const key = Object.keys(adjusted.driverPaths).find((candidate) => candidate.toLowerCase() === "revenue") as string;
    adjusted.driverPaths[key] = Array.from({ length: adjusted.horizonYears }, () => cagr);
    const output = executeForecastFn({ model: adjusted, factPack });
    const valuation = executeValuationFn(valuationSpec, output.forecast, factPack);
    return valuation.status === "ready" ? valuation.fairValuePerShare : undefined;
  };
}

export function validateAndSolveReverseValuation(input: ReverseSolverInput & { plannerInput: ReversePlannerInput }, targetPrice?: number): ReverseValuationResult {
  const plan = validateReverseValuationPlan(input.plan, input.plannerInput);
  if (plan.status !== "viable") {
    return { id: stableId("REV", [plan.id, "blocked"]), variable: plan.variable, status: "unavailable", interpretation: plan.blockers?.join(" ") ?? "Reverse plan is unavailable.", plan, diagnostics: plan.diagnostics ?? [], blockers: plan.blockers ?? ["Reverse plan unavailable"], publicationBlocked: true };
  }
  return solveReverseValuation({ ...input, plan }, targetPrice);
}

export function currentPriceOf(pack: FactPack): number | undefined {
  const fact: Fact | undefined = pack.market.facts.find((candidate) => candidate.metric === "currentPrice" && isFiniteNumber(candidate.value))
    ?? pack.market.facts.find((candidate) => candidate.metric === "regularMarketPrice" && isFiniteNumber(candidate.value));
  return fact?.value ?? latestValueFromPack(pack, "currentPrice");
}

export default {
  applyReverseVariable,
  bisectOneVariable,
  buildOneVariableSolver,
  buildRevenueCagrSolver,
  chooseReverseVariable,
  currentPriceOf,
  executeReverseValuation,
  solveOneVariable,
  solveRequiredValue,
  solveReverseValuation,
  validateAndSolveReverseValuation,
};
