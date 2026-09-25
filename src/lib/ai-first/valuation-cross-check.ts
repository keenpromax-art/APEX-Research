import { getValuationMethod } from "./valuation-methods";
import type { ValuationDiagnostic, ValuationDisagreement, ValuationExecutionStatus, ValuationMethodId, ValuationMatrixEntry } from "./types";
import { isFiniteNumber } from "./valuation-helpers";

export interface ValuationCrossCheck {
  status: ValuationExecutionStatus;
  diagnostics: ValuationDiagnostic[];
  disagreement?: ValuationDisagreement;
  comparablePairs: Array<{ left: string; right: string; spreadPct: number }>;
}

export function percentile(values: readonly number[], probability: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function analyzeValuationCrossCheck(methods: readonly ValuationMatrixEntry[]): ValuationCrossCheck {
  const ready = methods
    .filter((method) => method.status === "ready" && isFiniteNumber(method.fairValuePerShare))
    .map((method) => ({ method: method.methodId, value: method.fairValuePerShare as number }));
  if (ready.length === 0) {
    return {
      status: "blocked",
      diagnostics: [{ code: "CROSS_CHECK_NO_READY_VALUATIONS", severity: "error", message: "No independently ready valuation is available for cross-checking." }],
      comparablePairs: [],
    };
  }
  const values = ready.map((entry) => entry.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const p25 = percentile(values, 0.25);
  const median = percentile(values, 0.5);
  const p75 = percentile(values, 0.75);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const coefficientOfVariation = Math.abs(mean) > 1e-12 ? Math.sqrt(variance) / Math.abs(mean) : values.length > 1 ? Number.POSITIVE_INFINITY : 0;
  const spreadPct = Math.abs(median) > 1e-12 ? (maximum - minimum) / Math.abs(median) : maximum - minimum;
  const threshold = Math.max(Math.abs(median) * 0.25, 1e-9);
  const outliers = ready
    .filter((entry) => Math.abs(entry.value - median) > threshold)
    .map((entry) => ({ method: entry.method, fairValuePerShare: entry.value, deviationPct: Math.abs(median) > 1e-12 ? (entry.value - median) / Math.abs(median) : entry.value - median }));
  const comparablePairs: ValuationCrossCheck["comparablePairs"] = [];
  for (let left = 0; left < ready.length; left += 1) {
    for (let right = left + 1; right < ready.length; right += 1) {
      const leftDefinition = getValuationMethod(ready[left].method);
      const rightDefinition = getValuationMethod(ready[right].method);
      if (leftDefinition?.family !== rightDefinition?.family) continue;
      const denominator = Math.max(Math.abs(ready[left].value), Math.abs(ready[right].value), 1e-12);
      comparablePairs.push({ left: ready[left].method, right: ready[right].method, spreadPct: Math.abs(ready[left].value - ready[right].value) / denominator });
    }
  }
  const diagnostics: ValuationDiagnostic[] = [];
  if (ready.length < 2) diagnostics.push({ code: "CROSS_CHECK_SINGLE_METHOD", severity: "warning", message: "Only one method is ready; cross-check independence is limited." });
  if (spreadPct > 0.5) diagnostics.push({ code: "VALUATION_DISAGREEMENT_HIGH", severity: "warning", message: `Ready valuation methods disagree by ${(spreadPct * 100).toFixed(1)}% of the median.` });
  if (outliers.length > 0) diagnostics.push({ code: "VALUATION_OUTLIERS", severity: "warning", message: `${outliers.length} method value(s) differ from the cross-method median by more than 25%.` });
  return {
    status: ready.length >= 2 ? "ready" : "unavailable",
    diagnostics,
    disagreement: {
      minimum,
      p25,
      median,
      p75,
      maximum,
      spreadPct,
      coefficientOfVariation,
      methodCount: ready.length,
      outliers,
    },
    comparablePairs,
  };
}

export function selectPrimaryValuationMethod(
  methods: readonly ValuationMatrixEntry[],
  selectedMethod?: string | ValuationMethodId,
): ValuationMatrixEntry | null {
  const ready = methods.filter((method) => method.status === "ready" && isFiniteNumber(method.fairValuePerShare));
  if (ready.length === 0) return null;
  const selected = ready.find((method) => method.methodId.toLowerCase() === String(selectedMethod ?? "").toLowerCase());
  if (selected) return selected;
  return [...ready].sort((left, right) => {
    const leftMethod = getValuationMethod(left.methodId);
    const rightMethod = getValuationMethod(right.methodId);
    const familyRank = (family: string | undefined): number => family === "cash_flow" ? 0 : family === "equity_claim" ? 1 : family === "asset_based" ? 2 : family === "sum_of_parts" ? 3 : 4;
    return familyRank(leftMethod?.family) - familyRank(rightMethod?.family)
      || right.suitability.score - left.suitability.score
      || right.dataSufficiency.score - left.dataSufficiency.score
      || left.methodId.localeCompare(right.methodId);
  })[0] ?? null;
}

export default { analyzeValuationCrossCheck, percentile, selectPrimaryValuationMethod };
