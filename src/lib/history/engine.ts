import { createStableId, stableHash, compareStableStrings } from "@/lib/research-ledger/stable";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import type { FactPack } from "@/lib/ai-first/types";
import type { CanonicalEvidenceRegistry } from "@/lib/research-retrieval/types";
import {
  HISTORY_METRIC_KEYS,
  HISTORY_METRIC_RAW_ALIASES,
  buildHistoryMetricIndex,
  buildHistoryMetricPoints,
  type HistoryMetricKey,
  type HistoryMetricPoint,
} from "./facts";
import {
  HISTORY_WINDOW_KEYS,
  NORMALIZED_HISTORY_VERSION,
  type BuildNormalizedHistoryInput,
  type CorporateActionKind,
  type HistoryCorporateAction,
  type HistoryRestatementChain,
  type HistoryReversibility,
  type HistoryStatus,
  type HistoryTrend,
  type HistoryTrendBreak,
  type HistoryValuationResponse,
  type HistoryWindowKey,
  type NormalizedHistoryResult,
} from "./types";
import {
  UNATTRIBUTED_BREAK_ATTRIBUTION,
  buildHistoryTrend,
  buildHistoryTrendBreak,
  detectHistoryCadence,
  periodsForWindow,
  withValuationResponse,
  type TrendBreakAttribution,
} from "./trends";

const DEFAULT_MINIMUM_POINTS: Readonly<Record<HistoryWindowKey, number>> = Object.freeze({ "5Y": 3, "10Y": 5 });
const HISTORIES_DOMAIN = "history/normalized-history/v1";
const VALUATION_RESPONSE_HORIZON_MONTHS = 12;
const MATERIAL_CLAIM_THRESHOLD_PERIODS = 4;

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function evidenceMap(registry: CanonicalEvidenceRegistry | null | undefined): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const item of registry?.items ?? []) {
    if (!item.factId) continue;
    const bucket = map.get(item.factId) ?? [];
    bucket.push(item.id);
    map.set(item.factId, bucket);
  }
  for (const [factId, ids] of map) map.set(factId, [...new Set(ids)].sort(compareStableStrings));
  return map;
}

const ACTION_VALUE_KEYS: readonly string[] = Object.freeze(["splitRatio", "numberOfShares", "ratio", "amount", "value", "shares", "price", "dividend"]);

function actionTypeOf(metric: string): string {
  for (const key of ACTION_VALUE_KEYS) {
    const suffix = `_${key}`;
    if (metric.length > suffix.length && metric.endsWith(suffix)) return metric.slice(0, metric.length - suffix.length);
  }
  return metric;
}

function corporateActionKind(token: string): CorporateActionKind {
  const value = token.toLowerCase();
  if (/split|consolidat/.test(value)) return "split";
  if (/dividend|distribution/.test(value)) return "dividend";
  if (/symbol|rename|ticker|cusip/.test(value)) return "symbolChange";
  if (/spin|demerger|divest/.test(value)) return "spinOff";
  if (/rights|offering|warrant/.test(value)) return "rightsIssue";
  if (/merger|acquisition|acquire|amalgamat/.test(value)) return "merger";
  if (/delist|suspend|halt/.test(value)) return "delisting";
  if (/buyback|repurchase|recap/.test(value)) return "buyback";
  return "unknown";
}

function ratioFromText(text: string | undefined): number | null {
  if (!text) return null;
  const colon = text.match(/(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
  const forForm = text.match(/(\d+(?:\.\d+)?)\s*[- ]for[- ]\s*(\d+(?:\.\d+)?)/i);
  const match = colon ?? forForm;
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0 || numerator <= 0) return null;
  return round6(numerator / denominator);
}

function splitFactor(values: readonly number[], text: string | undefined): number | null {
  const fromText = ratioFromText(text);
  if (fromText !== null) return fromText;
  const ratioLike = values.filter((value) => value > 0 && Number.isFinite(value));
  if (ratioLike.length === 0) return null;
  return round6(Math.max(...ratioLike));
}

function buildCorporateActions(factPack: FactPack | null): {
  actions: HistoryCorporateAction[];
  adjustments: Map<string, number>;
} {
  const actions: HistoryCorporateAction[] = [];
  const adjustments = new Map<string, number>();
  const facts = factPack?.corporateActions?.facts ?? [];
  const grouped = new Map<string, typeof facts>();
  for (const fact of facts) {
    if (!/^corporateAction_/i.test(fact.metric)) continue;
    const periodEnd = (fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period ?? "").slice(0, 10);
    const key = `${actionTypeOf(fact.metric)}|${periodEnd}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(fact);
    grouped.set(key, bucket);
  }
  for (const key of [...grouped.keys()].sort(compareStableStrings)) {
    const group = grouped.get(key) ?? [];
    const head = group[0];
    if (!head) continue;
    const actionType = key.split("|")[0]?.replace(/^corporateAction_/i, "") ?? "";    const kind = corporateActionKind(actionType);
    const numeric = group.filter((fact) => typeof fact.value === "number" && Number.isFinite(fact.value)) as Array<typeof group[number] & { value: number }>;
    const values = numeric.map((fact) => fact.value);
    const textFact = group.find((fact) => typeof fact.textValue === "string" && fact.textValue.length > 0);
    const factor = kind === "split" ? splitFactor(values, textFact?.textValue) : null;
    const amount = numeric.find((fact) => /amount|price|dividend|value/i.test(fact.metric))?.value ?? null;
    const effectiveDate = (head.reportingPeriod ?? head.fiscalPeriod ?? head.period ?? "unknown").slice(0, 10);
    const adjustedMetrics: HistoryMetricKey[] = kind === "split" ? ["eps"] : [];
    const adjustmentApplied = kind === "split" && factor !== null && factor > 0 && Number.isFinite(factor);
    if (adjustmentApplied && factor !== null) adjustments.set(effectiveDate, factor);
    const factIds = group.map((fact) => fact.factId ?? "").filter(Boolean).sort(compareStableStrings);
    actions.push({
      id: createStableId("HISTACT", { key, kind, factor, amount }, HISTORIES_DOMAIN),
      kind,
      effectiveDate,
      description: textFact?.textValue ?? `${kind} corporate action on ${effectiveDate}`,
      factor,
      amount: amount === null ? null : round6(amount),
      adjustedMetrics,
      adjustmentApplied,
      note: adjustmentApplied
        ? `per-share series normalized by split factor ${factor} for periods ending before ${effectiveDate}`
        : kind === "split"
          ? "split detected without a usable ratio; per-share series left unadjusted and flagged"
          : `no series adjustment required for a ${kind} action`,
      factIds,
      evidenceIds: Object.freeze([]) as readonly string[],
    });
  }
  return { actions, adjustments };
}

function adjustmentsByPeriod(adjustments: ReadonlyMap<string, number>, periodEnds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const dates = [...adjustments.keys()].sort(compareStableStrings);
  for (const periodEnd of periodEnds) {
    let factor = 1;
    for (const date of dates) {
      if (date > periodEnd && (adjustments.get(date) ?? 1) > 0) factor *= adjustments.get(date) as number;
    }
    if (factor !== 1) out.set(periodEnd, round6(factor));
  }
  return out;
}

function buildRestatementChains(input: {
  metrics: Readonly<Record<HistoryMetricKey, readonly HistoryMetricPoint[]>>;
  registry: CanonicalEvidenceRegistry | null | undefined;
}): HistoryRestatementChainsResult {
  const chains: HistoryRestatementChain[] = [];
  const registryRestatements = input.registry?.restatements ?? [];
  for (const metric of HISTORY_METRIC_KEYS) {
    const aliases = HISTORY_METRIC_RAW_ALIASES[metric];
    for (const point of input.metrics[metric] ?? []) {
      const candidates = registryRestatements
        .filter((entry) => entry.period === point.periodEnd && (entry.field === metric || aliases.includes(entry.field)))
        .sort((left, right) => left.id.localeCompare(right.id));
      const registryEntry = candidates[0];
      const hasFactRestatement = point.restated !== null && point.reported !== null && point.restated !== point.reported;
      if (!hasFactRestatement && !registryEntry) continue;
      const priorValue = hasFactRestatement ? (point.reported as number) : numericOf(registryEntry?.priorValue);
      const restatedValue = hasFactRestatement ? (point.restated as number) : numericOf(registryEntry?.restatedValue);
      if (priorValue === null || restatedValue === null) continue;
      const delta = round6(restatedValue - priorValue);
      const deltaPct = priorValue === 0 ? null : round6(delta / Math.abs(priorValue));
      const direction = delta > 0 ? "upward" : delta < 0 ? "downward" : "unchanged";
      const reversibility = reversibilityOf(deltaPct, registryEntry);
      chains.push({
        id: createStableId("HISTREST", { metric, periodEnd: point.periodEnd, priorValue, restatedValue, registryEntry: registryEntry?.id ?? null }, HISTORIES_DOMAIN),
        metric,
        period: point.period,
        periodEnd: point.periodEnd,
        priorFactId: point.factIds[0] ?? registryEntry?.priorId ?? "",
        restatedFactId: point.restatedFactIds[0] ?? registryEntry?.restatedId ?? "",
        priorValue: round6(priorValue),
        restatedValue: round6(restatedValue),
        delta,
        deltaPct,
        direction,
        reason: registryEntry?.reason ?? "A later observation for the same period supersedes the earlier reported value.",
        origin: registryEntry ? "evidence-registry-restatement" : hasFactRestatement ? "fact-restatement-flag" : "source-conflict",
        reversibility: reversibility.value,
        reversibilityBasis: reversibility.basis,
        impactedMetrics: [metric],
        evidenceIds: [registryEntry?.id ?? ""].filter(Boolean).sort(compareStableStrings),
      });
    }
  }
  const seen = new Set<string>();
  const unique = chains.filter((chain) => {
    const key = `${chain.metric}|${chain.periodEnd}|${chain.priorValue}|${chain.restatedValue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { chains: unique.sort((left, right) => left.id.localeCompare(right.id)) };
}

interface CanonicalEvidenceRestatementLike {
  readonly id: string;
  readonly field: string;
  readonly period: string;
  readonly priorId: string;
  readonly restatedId: string;
  readonly priorValue: number | string;
  readonly restatedValue: number | string;
  readonly reason: string;
}

function numericOf(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reversibilityOf(deltaPct: number | null, registryEntry: CanonicalEvidenceRestatementLike | undefined): { value: HistoryReversibility; basis: string } {
  if (registryEntry && /revert|revers|reinstat/i.test(registryEntry.reason)) {
    return { value: "reversible", basis: `registry restatement reason records a reversion: ${registryEntry.reason}` };
  }
  if (deltaPct !== null && Math.abs(deltaPct) >= 0.05) {
    return { value: "irreversible", basis: "restatement changed the reported figure by 5% or more and the revised basis persists in the canonical registry" };
  }
  return { value: "unknown", basis: "insufficient evidence to determine whether the restated basis was subsequently reverted" };
}

function priceSeries(factPack: FactPack | null): Map<string, number> {
  const series = new Map<string, number>();
  for (const fact of factPack?.priceHistory?.facts ?? []) {
    if (!/^price(adj)?close$/i.test(fact.metric)) continue;
    if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || fact.value <= 0) continue;
    const periodEnd = (fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period ?? "").slice(0, 10);
    if (!periodEnd) continue;
    if (!series.has(periodEnd)) series.set(periodEnd, fact.value);
  }
  return series;
}

function valuationResponse(
  prices: ReadonlyMap<string, number>,
  fromDate: string,
  horizonMonths: number,
): HistoryValuationResponse {
  const dates = [...prices.keys()].sort(compareStableStrings);
  const startIndex = dates.findIndex((date) => date >= fromDate);
  const startDate = startIndex >= 0 ? (dates[startIndex] as string) : null;
  const startPrice = startDate ? (prices.get(startDate) as number) : null;
  const targetTimestamp = Date.parse(`${fromDate}T00:00:00.000Z`) + horizonMonths * 30.44 * 86_400_000;
  const endDate = dates.find((date) => Date.parse(`${date}T00:00:00.000Z`) >= targetTimestamp) ?? null;
  const endPrice = endDate ? (prices.get(endDate) as number) : null;
  if (!startDate || startPrice === null || !endDate || endPrice === null) {
    return {
      horizonMonths,
      observed: false,
      fromDate: startDate ?? fromDate,
      toDate: endDate ?? "unavailable",
      priceReturnPct: null,
      note: `price history does not span the ${horizonMonths}-month window after ${fromDate}; no valuation response is asserted`,
    };
  }
  return {
    horizonMonths,
    observed: true,
    fromDate: startDate,
    toDate: endDate,
    priceReturnPct: round6(endPrice / startPrice - 1),
    note: `price return from ${startDate} to ${endDate} after the detected break`,
  };
}

function attributionFor(
  breakPeriodEnd: string,
  actions: readonly HistoryCorporateAction[],
  chains: readonly HistoryRestatementChain[],
): TrendBreakAttribution {
  const breakYear = breakPeriodEnd.slice(0, 4);
  const action = actions
    .filter((entry) => entry.effectiveDate.slice(0, 10) <= breakPeriodEnd || entry.effectiveDate.slice(0, 4) === breakYear)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate) || left.id.localeCompare(right.id))[0];
  if (action) {
    const reversible = action.kind === "split" || action.kind === "dividend" || action.kind === "buyback" || action.kind === "rightsIssue";
    return {
      cause: `${action.kind} corporate action on ${action.effectiveDate}`,
      causeEvidenceIds: action.evidenceIds,
      causeConfidence: 0.7,
      reversible: action.kind === "unknown" ? null : reversible,
      reversibility: action.kind === "unknown" ? "unknown" : reversible ? "reversible" : "irreversible",
      reversibilityBasis: action.kind === "unknown"
        ? `unclassified corporate action ${action.id} coincides with the break; reversibility undetermined`
        : `a ${action.kind} action is a discrete, non-recurring event so the break is treated as ${reversible ? "reversible" : "irreversible"}`,
      evidenceIds: action.evidenceIds,
    };
  }
  const chain = chains.filter((entry) => entry.periodEnd === breakPeriodEnd).sort((left, right) => left.id.localeCompare(right.id))[0];
  if (chain) {
    return {
      cause: `restatement of ${chain.metric} for ${chain.period} (${chain.direction}, ${chain.deltaPct === null ? "n/a" : `${round6(chain.deltaPct * 100).toFixed(1)}%`})`,
      causeEvidenceIds: chain.evidenceIds,
      causeConfidence: 0.5,
      reversible: chain.reversibility === "reversible" ? true : chain.reversibility === "irreversible" ? false : null,
      reversibility: chain.reversibility,
      reversibilityBasis: chain.reversibilityBasis,
      evidenceIds: chain.evidenceIds,
    };
  }
  return UNATTRIBUTED_BREAK_ATTRIBUTION;
}

interface HistoryRestatementChainsResult {
  readonly chains: HistoryRestatementChain[];
}

export function buildNormalizedHistory(input: BuildNormalizedHistoryInput): NormalizedHistoryResult {
  const factPack = input.factPack ?? null;
  const subjectId = (input.subjectId ?? factPack?.ticker ?? "unknown").trim().toUpperCase() || "UNKNOWN";
  const generatedAt = input.generatedAt ?? factPack?.retrievalTimestamp ?? "unknown";
  const windows = (input.windows?.length ? input.windows : HISTORY_WINDOW_KEYS) as readonly HistoryWindowKey[];
  const index = buildHistoryMetricIndex(factPack);
  const metricPoints = buildHistoryMetricPoints(index);
  const cadence = detectHistoryCadence(index.periods);
  const evidenceByFactId = evidenceMap(input.evidenceRegistry);
  const { actions, adjustments } = buildCorporateActions(factPack);
  const periodEnds = index.periods;
  const { chains } = buildRestatementChains({ metrics: metricPoints.metrics, registry: input.evidenceRegistry });
  const normalizedAdjustments = adjustmentsByPeriod(adjustments, periodEnds);
  const earningsNormalization = input.earningsNormalization ?? null;
  const trends: HistoryTrend[] = [];
  const trendBreaks: HistoryTrendBreak[] = [];
  const diagnostics: string[] = [...metricPoints.diagnostics];
  for (const window of windows) {
    const required = input.minimumPeriods?.[window] ?? DEFAULT_MINIMUM_POINTS[window];
    const expected = periodsForWindow(window, cadence);
    for (const metric of HISTORY_METRIC_KEYS) {
      const points = metricPoints.points(metric);
      if (points.length === 0) {
        diagnostics.push(`HISTORY_METRIC_UNAVAILABLE:${metric}`);
        continue;
      }
      const reported = buildHistoryTrend({ metric, window, basis: "reported", points, cadence, requiredPoints: required, adjustments: normalizedAdjustments, evidenceByFactId });
      trends.push(reported);
      const restated = buildHistoryTrend({ metric, window, basis: "restated", points, cadence, requiredPoints: required, adjustments: normalizedAdjustments, evidenceByFactId });
      if (restated.points.some((entry) => entry.value !== null)) trends.push(restated);
      const normalizedPoints = applyEarningsNormalization(points, earningsNormalization, metric);
      const normalized = buildHistoryTrend({ metric, window, basis: "normalized", points: normalizedPoints, cadence, requiredPoints: required, adjustments: normalizedAdjustments, evidenceByFactId });
      trends.push(normalized);
      for (const basis of ["reported", "restated", "normalized"] as const) {
        const trend = trends.find((entry) => entry.metric === metric && entry.window === window && entry.basis === basis);
        if (!trend || trend.status !== "ready") continue;
        const detected = buildHistoryTrendBreak({
          trend,
          attribution: attributionFor(breakAnchorOf(trend), actions, chains),
          id: createStableId("HISTBREAK", { subjectId, metric, window, basis, anchor: breakAnchorOf(trend) }, HISTORIES_DOMAIN),
        });
        if (detected) trendBreaks.push(detected);
      }
    }
    if (expected < 2) diagnostics.push(`HISTORY_WINDOW_DEGENERATE:${window}`);
  }
  const prices = priceSeries(factPack);
  const attributedBreaks = trendBreaks.map((entry) => withValuationResponse(entry, valuationResponse(prices, entry.breakPeriodEnd, VALUATION_RESPONSE_HORIZON_MONTHS)));
  const readyTrends = trends.filter((entry) => entry.status === "ready");
  const availableMetrics = HISTORY_METRIC_KEYS.filter((metric) => metricPoints.points(metric).length > 0);
  const readyMetrics = HISTORY_METRIC_KEYS.filter((metric) => trends.some((entry) => entry.metric === metric && entry.status === "ready"));
  const missingMetrics = HISTORY_METRIC_KEYS.filter((metric) => !readyMetrics.includes(metric));
  const coreReady = ["revenue", "ebit", "netMargin", "cashConversion"].filter((metric) => readyMetrics.includes(metric as HistoryMetricKey)).length;
  const status: HistoryStatus = availableMetrics.length === 0
    ? "unavailable"
    : readyTrends.length === 0
      ? "insufficient"
      : coreReady >= 2 && availableMetrics.length >= 4
        ? "ready"
        : "insufficient";
  if (status !== "ready") diagnostics.push(`HISTORY_STATUS:${status}`);
  if (periodEnds.length < MATERIAL_CLAIM_THRESHOLD_PERIODS) diagnostics.push("HISTORY_SHALLOW_PERIODS");
  const materialClaims = [
    {
      id: createStableId("HISTCLAIM", { subjectId, claim: "trend-continuity" }, HISTORIES_DOMAIN),
      claim: `Trend continuity across ${windows.join(" and ")} windows for revenue, EBIT, margins, cash conversion and capital intensity.`,
      dependsOn: ["revenue", "ebit", "operatingMargin", "netMargin", "cashConversion", "capexIntensity"] as readonly HistoryMetricKey[],
      supportedBy: readyMetrics.filter((metric) => ["revenue", "ebit", "operatingMargin", "netMargin", "cashConversion", "capexIntensity"].includes(metric)),
    },
    {
      id: createStableId("HISTCLAIM", { subjectId, claim: "capital-intensity-trend" }, HISTORIES_DOMAIN),
      claim: "Capital intensity, leverage and shareholder-return trends are stable enough to anchor a forward model.",
      dependsOn: ["capexIntensity", "leverage", "dilution", "payoutRatio", "buybackIntensity"] as readonly HistoryMetricKey[],
      supportedBy: readyMetrics.filter((metric) => ["capexIntensity", "leverage", "dilution", "payoutRatio", "buybackIntensity"].includes(metric)),
    },
  ];
  const evidenceIds = [...new Set([
    ...[...evidenceByFactId.values()].flat(),
    ...chains.flatMap((entry) => entry.evidenceIds),
    ...attributedBreaks.flatMap((entry) => entry.evidenceIds),
  ])].sort(compareStableStrings);
  const groupedWindows = Object.fromEntries(windows.map((window) => [window, trends.filter((entry) => entry.window === window)])) as Record<HistoryWindowKey, HistoryTrend[]>;
  const content = {
    version: NORMALIZED_HISTORY_VERSION,
    subjectId,
    status,
    generatedAt,
    currency: index.currency,
    windows: groupedWindows,
    restatementChains: chains,
    corporateActions: actions,
    trendBreaks: attributedBreaks.sort((left, right) => left.id.localeCompare(right.id)),
    coverage: {
      metricsTracked: HISTORY_METRIC_KEYS.length,
      metricsReady: readyMetrics.length,
      periodsAvailable: periodEnds.length,
      earliestPeriodEnd: periodEnds[0] ?? null,
      latestPeriodEnd: periodEnds[periodEnds.length - 1] ?? null,
      completeness: round6(readyMetrics.length / HISTORY_METRIC_KEYS.length),
      missingMetrics,
    },
    materialClaims,
    diagnostics: [...new Set(diagnostics)].sort(compareStableStrings),
    evidenceIds,
  } satisfies Omit<NormalizedHistoryResult, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, HISTORIES_DOMAIN) }) as NormalizedHistoryResult;
}

function breakAnchorOf(trend: HistoryTrend): string {
  const points = trend.points.filter((entry) => entry.value !== null);
  if (points.length < 5) return points[0]?.periodEnd ?? "";
  const values = points.map((entry) => entry.value as number);
  const deltas: number[] = [];
  for (let position = 1; position < values.length; position += 1) deltas.push((values[position] as number) - (values[position - 1] as number));
  const levelMean = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
  const floor = Math.max(1e-9, levelMean * 1e-6);
  let bestSplit = 2;
  let bestSeparation = -1;
  for (let split = 2; split <= deltas.length - 2; split += 1) {
    const prior = deltas.slice(0, split);
    const post = deltas.slice(split);
    const priorMean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    const postMean = post.reduce((sum, value) => sum + value, 0) / post.length;
    const priorVar = prior.reduce((sum, value) => sum + (value - priorMean) ** 2, 0) / Math.max(1, prior.length - 1);
    const postVar = post.reduce((sum, value) => sum + (value - postMean) ** 2, 0) / Math.max(1, post.length - 1);
    const pooled = Math.sqrt(((prior.length - 1) * priorVar + (post.length - 1) * postVar) / Math.max(1, prior.length + post.length - 2));
    const separation = Math.abs(postMean - priorMean) / Math.max(pooled, floor);
    if (separation > bestSeparation) {
      bestSeparation = separation;
      bestSplit = split;
    }
  }
  return points[bestSplit]?.periodEnd ?? "";
}

function applyEarningsNormalization(
  points: readonly HistoryMetricPoint[],
  earningsNormalization: Readonly<Record<string, Readonly<Record<string, number>>>> | null,
  metric: HistoryMetricKey,
): readonly HistoryMetricPoint[] {
  if (!earningsNormalization) return points;
  const supported: HistoryMetricKey[] = ["ebit", "netMargin", "cashConversion", "payoutRatio"];
  if (!supported.includes(metric)) return points;
  return points.map((entry) => {
    const periodAdjustment = earningsNormalization[entry.periodEnd];
    if (!periodAdjustment) return entry;
    const key = Object.keys(periodAdjustment).sort(compareStableStrings)[0];
    const adjustment = key === undefined ? undefined : periodAdjustment[key];
    if (adjustment === undefined || !Number.isFinite(adjustment) || adjustment === 0) return entry;
    return {
      ...entry,
      reported: entry.reported === null ? null : round6(entry.reported + adjustment),
      restated: entry.restated === null ? null : round6(entry.restated + adjustment),
      derivation: `${entry.derivation ? `${entry.derivation}; ` : ""}earnings normalized by evidence-backed adjustment ${adjustment}`,
    };
  });
}

export const buildHistoryTrendPack = buildNormalizedHistory;
export const normalizeFinancialHistory = buildNormalizedHistory;
