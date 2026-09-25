import { compareStableStrings } from "@/lib/research-ledger/stable";
import {
  HISTORY_METRIC_DIRECTIONS,
  HISTORY_METRIC_KEYS,
  HISTORY_METRIC_LABELS,
  HISTORY_METRIC_UNITS,
  historyFiscalYear,
  historyPeriodLabel,
  type HistoryMetricKey,
  type HistoryMetricPoint,
  type HistorySeriesBasis,
} from "./facts";
import {
  HISTORY_WINDOW_YEARS,
  type HistorySeriesPoint,
  type HistoryStatus,
  type HistoryTrend,
  type HistoryTrendBreak,
  type HistoryTrendDirection,
  type HistoryWindowKey,
} from "./types";

const TREND_CHANGE_TOLERANCE: Readonly<Record<HistoryMetricKey, number>> = Object.freeze({
  revenue: 0.02,
  ebit: 0.02,
  eps: 0.02,
  fcf: 0.02,
  roic: 0.02,
  roe: 0.02,
  roa: 0.02,
  grossMargin: 0.02,
  operatingMargin: 0.02,
  netMargin: 0.02,
  workingCapitalDays: 0.02,
  cashConversion: 0.05,
  capexIntensity: 0.02,
  leverage: 0.02,
  dilution: 0.005,
  payoutRatio: 0.1,
  buybackIntensity: 0.1,
  acquisitionIntensity: 0.1,
});

const BREAK_SEPARATION_THRESHOLD = 2;
const BREAK_SEVERITY_MAJOR = 3.5;
const BREAK_SEVERITY_MODERATE = 2.5;

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function dayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export interface HistoryCadence {
  readonly observationsPerYear: number;
  readonly medianGapDays: number;
  readonly annual: boolean;
}

export function detectHistoryCadence(periods: readonly string[]): HistoryCadence {
  const gaps: number[] = [];
  for (let position = 1; position < periods.length; position += 1) {
    const gap = dayCount(periods[position - 1] as string, periods[position] as string);
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return { observationsPerYear: 1, medianGapDays: 365, annual: true };
  const sorted = [...gaps].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  const medianGapDays = sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  const observationsPerYear = Math.min(4, Math.max(0.25, 365 / Math.max(1, medianGapDays)));
  return { observationsPerYear: round6(observationsPerYear), medianGapDays: round6(medianGapDays), annual: medianGapDays >= 300 };
}

export function periodsForWindow(window: HistoryWindowKey, cadence: HistoryCadence): number {
  return Math.max(2, Math.round(HISTORY_WINDOW_YEARS[window] * cadence.observationsPerYear));
}

function usablePoints(points: readonly HistoryMetricPoint[]): HistoryMetricPoint[] {
  return points.filter((entry) => entry.reported !== null);
}

function seriesForBasis(points: readonly HistoryMetricPoint[], basis: HistorySeriesBasis, adjustments: ReadonlyMap<string, number>): HistorySeriesPoint[] {
  return points.map((entry) => {
    const base = basis === "restated" ? entry.restated : entry.reported;
    let value = base;
    let note: string | null = null;
    if (basis === "normalized") {
      if (base === null) {
        value = null;
      } else {
        const factor = adjustments.get(entry.periodEnd) ?? 1;
        if (factor === 1) {
          value = base;
        } else {
          value = round6(base / factor);
          note = `corporate-action normalized by factor ${factor}`;
        }
      }
    }
    return {
      period: entry.period,
      periodEnd: entry.periodEnd,
      fiscalYear: entry.fiscalYear,
      value,
      unit: HISTORY_METRIC_UNITS[entry.metric],
      restated: entry.restated !== null,
      derived: entry.derived,
      factIds: entry.factIds,
      evidenceIds: Object.freeze([]) as readonly string[],
      source: entry.source,
      note: note ?? (entry.derivation ?? null),
    };
  });
}

function directionOf(metric: HistoryMetricKey, first: number | null, last: number | null): HistoryTrendDirection {
  if (first === null || last === null || !Number.isFinite(first) || !Number.isFinite(last)) return "unknown";
  const changePct = first === 0 ? null : (last - first) / Math.abs(first);
  if (changePct === null) return first === last ? "stable" : "unknown";
  const tolerance = TREND_CHANGE_TOLERANCE[metric];
  const direction = HISTORY_METRIC_DIRECTIONS[metric];
  if (direction === "neutral") {
    if (changePct > tolerance) return "improving";
    if (changePct < -tolerance) return "deteriorating";
    return "stable";
  }
  if (direction === "higher-better") {
    if (changePct > tolerance) return "improving";
    if (changePct < -tolerance) return "deteriorating";
    return "stable";
  }
  if (changePct < -tolerance) return "improving";
  if (changePct > tolerance) return "deteriorating";
  return "stable";
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export interface BuildHistoryTrendInput {
  readonly metric: HistoryMetricKey;
  readonly window: HistoryWindowKey;
  readonly basis: HistorySeriesBasis;
  readonly points: readonly HistoryMetricPoint[];
  readonly cadence: HistoryCadence;
  readonly requiredPoints: number;
  readonly adjustments: ReadonlyMap<string, number>;
  readonly evidenceByFactId: ReadonlyMap<string, readonly string[]>;
}

export function buildHistoryTrend(input: BuildHistoryTrendInput): HistoryTrend {
  const expected = periodsForWindow(input.window, input.cadence);
  const usable = usablePoints(input.points).slice(-expected);
  const all = input.points.slice(-expected);
  const series = seriesForBasis(all, input.basis, input.adjustments).map((entry) => {
    const evidenceIds = entry.factIds.flatMap((factId) => input.evidenceByFactId.get(factId) ?? []);
    return { ...entry, evidenceIds: [...new Set(evidenceIds)].sort(compareStableStrings) };
  });
  const values = usable.map((entry) => entry.reported as number);
  const first = values.length > 0 ? (values[0] as number) : null;
  const last = values.length > 0 ? (values[values.length - 1] as number) : null;
  const firstPeriodEnd = usable[0]?.periodEnd ?? null;
  const yearsElapsed = firstPeriodEnd && usable.length > 1 ? dayCount(firstPeriodEnd, usable[usable.length - 1]?.periodEnd ?? firstPeriodEnd) / 365 : 0;
  const cagr = first !== null && last !== null && first > 0 && last > 0 && yearsElapsed > 0
    ? round6((last / first) ** (1 / yearsElapsed) - 1)
    : null;
  const average = values.length > 0 ? round6(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const meanAbs = values.length > 0 ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length : 0;
  const volatility = values.length > 1 && meanAbs > 0 ? round6(stdev(values) / meanAbs) : null;
  const change = first !== null && last !== null ? round6(last - first) : null;
  const changePct = first !== null && last !== null && first !== 0 ? round6((last - first) / Math.abs(first)) : null;
  const complete = values.length >= Math.max(2, Math.ceil(expected * 0.6));
  const status: HistoryStatus = values.length >= input.requiredPoints ? "ready" : values.length > 0 ? "insufficient" : "unavailable";
  const notes: string[] = [];
  if (all.length > 0 && values.length < all.length) notes.push(`${all.length - values.length} period(s) in window carry no reported value`);
  if (input.basis === "restated" && series.every((entry) => entry.value === null)) notes.push("no restated observation on record for this window");
  if (input.basis === "normalized") notes.push("normalized basis applies corporate-action factors to the reported series");
  return {
    metric: input.metric,
    label: HISTORY_METRIC_LABELS[input.metric],
    window: input.window,
    basis: input.basis,
    unit: HISTORY_METRIC_UNITS[input.metric],
    direction: HISTORY_METRIC_DIRECTIONS[input.metric],
    points: series,
    first,
    last,
    change,
    changePct,
    cagr,
    average,
    volatility,
    trendDirection: directionOf(input.metric, first, last),
    coverage: { periods: values.length, required: input.requiredPoints, expected, complete },
    status,
    notes,
  };
}

export interface TrendBreakAttribution {
  readonly cause: string | null;
  readonly causeEvidenceIds: readonly string[];
  readonly causeConfidence: number;
  readonly reversible: boolean | null;
  readonly reversibility: "reversible" | "irreversible" | "unknown";
  readonly reversibilityBasis: string;
  readonly evidenceIds: readonly string[];
}

export const UNATTRIBUTED_BREAK_ATTRIBUTION: TrendBreakAttribution = Object.freeze({
  cause: null,
  causeEvidenceIds: Object.freeze([]) as readonly string[],
  causeConfidence: 0,
  reversible: null,
  reversibility: "unknown" as const,
  reversibilityBasis: "no evidence attributes this break to a cause, so reversibility cannot be judged",
  evidenceIds: Object.freeze([]) as readonly string[],
});

interface BreakCandidate {
  readonly splitIndex: number;
  readonly priorMean: number;
  readonly postMean: number;
  readonly separation: number;
  readonly delta: number;
}

function bestSplit(values: readonly number[]): BreakCandidate | null {
  const deltas: number[] = [];
  for (let position = 1; position < values.length; position += 1) {
    deltas.push((values[position] as number) - (values[position - 1] as number));
  }
  if (deltas.length < 4) return null;
  const levelMean = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
  const floor = Math.max(1e-9, levelMean * 1e-6);
  let best: BreakCandidate | null = null;
  for (let split = 2; split <= deltas.length - 2; split += 1) {
    const prior = deltas.slice(0, split);
    const post = deltas.slice(split);
    const priorMean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    const postMean = post.reduce((sum, value) => sum + value, 0) / post.length;
    const priorVar = prior.reduce((sum, value) => sum + (value - priorMean) ** 2, 0) / Math.max(1, prior.length - 1);
    const postVar = post.reduce((sum, value) => sum + (value - postMean) ** 2, 0) / Math.max(1, post.length - 1);
    const pooled = Math.sqrt(((prior.length - 1) * priorVar + (post.length - 1) * postVar) / Math.max(1, prior.length + post.length - 2));
    const separation = Math.abs(postMean - priorMean) / Math.max(pooled, floor);
    const candidate: BreakCandidate = { splitIndex: split, priorMean, postMean, separation, delta: postMean - priorMean };
    if (!best || candidate.separation > best.separation) best = candidate;
  }
  return best && best.separation >= BREAK_SEPARATION_THRESHOLD ? best : null;
}

export function buildHistoryTrendBreak(input: {
  readonly trend: HistoryTrend;
  readonly attribution: TrendBreakAttribution;
  readonly id: string;
}): HistoryTrendBreak | null {
  const points = input.trend.points.filter((entry) => entry.value !== null);
  if (points.length < 5) return null;
  const values = points.map((entry) => entry.value as number);
  const candidate = bestSplit(values);
  if (!candidate) return null;
  const breakPoint = points[candidate.splitIndex];
  if (!breakPoint) return null;
  const priorMean = round6(candidate.priorMean);
  const postMean = round6(candidate.postMean);
  const delta = round6(candidate.delta);
  const severity = candidate.separation >= BREAK_SEVERITY_MAJOR ? "major" : candidate.separation >= BREAK_SEVERITY_MODERATE ? "moderate" : "minor";
  return {
    id: input.id,
    metric: input.trend.metric,
    label: input.trend.label,
    window: input.trend.window,
    basis: input.trend.basis,
    breakPeriod: breakPoint.period,
    breakPeriodEnd: breakPoint.periodEnd,
    method: "mean-shift",
    priorMean,
    postMean,
    delta,
    deltaPct: priorMean === 0 ? null : round6(delta / Math.abs(priorMean)),
    separation: round6(candidate.separation),
    severity,
    cause: input.attribution.cause,
    causeEvidenceIds: input.attribution.causeEvidenceIds,
    causeConfidence: round6(input.attribution.causeConfidence),
    reversible: input.attribution.reversible,
    reversibility: input.attribution.reversibility,
    reversibilityBasis: input.attribution.reversibilityBasis,
    valuationResponse: null,
    evidenceIds: [...new Set([...input.attribution.evidenceIds, ...breakPoint.evidenceIds])].sort(compareStableStrings),
    status: input.attribution.cause === null ? "unattributed" : "evidenced",
  };
}

export function withValuationResponse(
  trendBreak: HistoryTrendBreak,
  response: HistoryTrendBreak["valuationResponse"],
): HistoryTrendBreak {
  return response === null ? trendBreak : { ...trendBreak, valuationResponse: response };
}

export function allHistoryMetricKeys(): readonly HistoryMetricKey[] {
  return HISTORY_METRIC_KEYS;
}

export function historyPeriodOf(periodEnd: string): string {
  return historyPeriodLabel(periodEnd);
}

export function historyYearOf(periodEnd: string): number | null {
  return historyFiscalYear(periodEnd);
}
