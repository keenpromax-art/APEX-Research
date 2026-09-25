import type { CanonicalForecast } from "@/lib/canonical-forecast";
import { deepFreeze, isDeeplyFrozen } from "./immutable";
import { companyIdentityKey } from "./run-envelope";
import { stableHash } from "./stable";
import { FORECAST_VERSION } from "./types";

export interface ForecastRange {
  readonly low: number;
  readonly high: number;
}

export type ForecastExpectation =
  | { readonly kind: "point"; readonly value: number }
  | { readonly kind: "range"; readonly low: number; readonly high: number };

export interface ForecastIssuanceInput {
  readonly companyId: string;
  readonly runId: string;
  readonly period: string;
  readonly metric: string;
  readonly point?: number;
  readonly range?: ForecastRange;
  readonly issuedAt: string;
  readonly unit?: string;
  readonly currency?: string;
  readonly rationale?: string;
}

export interface ForecastIssuance {
  readonly version: typeof FORECAST_VERSION;
  readonly forecastId: string;
  readonly contentHash: string;
  readonly companyId: string;
  readonly runId: string;
  readonly period: string;
  readonly metric: string;
  readonly expectation: ForecastExpectation;
  readonly issuedAt: string;
  readonly unit: string | null;
  readonly currency: string | null;
  readonly rationale: string | null;
}

export interface ForecastActualInput {
  readonly value: number | null | undefined;
  readonly observedAt: string;
  readonly period?: string;
  readonly metric?: string;
  readonly companyId?: string;
  readonly sourceId?: string;
  readonly evidenceIds?: readonly string[];
}

export type ForecastScoreStatus = "hit" | "miss" | "missing";
export type ForecastScoreReason =
  | "point-hit"
  | "point-miss"
  | "within-range"
  | "below-range"
  | "above-range"
  | "actual-missing"
  | "invalid-actual"
  | "period-mismatch"
  | "metric-mismatch"
  | "company-mismatch"
  | "actual-precedes-forecast";

export interface ForecastScoringOptions {
  readonly absoluteTolerance?: number;
  readonly relativeTolerance?: number;
  readonly minimumScale?: number;
}

export interface ForecastScore {
  readonly version: typeof FORECAST_VERSION;
  readonly forecastId: string;
  readonly forecastHash: string;
  readonly actualHash: string | null;
  readonly status: ForecastScoreStatus;
  readonly reason: ForecastScoreReason;
  readonly hit: boolean | null;
  readonly score: number | null;
  readonly actualValue: number | null;
  readonly absoluteError: number | null;
  readonly relativeError: number | null;
  readonly normalizedError: number | null;
  readonly insideExpectedRange: boolean | null;
  readonly scoredAt: string | null;
  readonly sourceId: string | null;
  readonly evidenceIds: readonly string[];
  readonly hash: string;
}

export type CanonicalForecastMetric =
  | "revenue"
  | "ebit"
  | "ebitda"
  | "netIncome"
  | "operatingCashFlow"
  | "freeCashFlow"
  | "fcff"
  | "eps";

export interface CanonicalForecastIssuanceInput {
  readonly companyId: string;
  readonly runId: string;
  readonly forecast: CanonicalForecast;
  readonly metric: CanonicalForecastMetric;
  readonly period: string;
  readonly issuedAt: string;
  readonly unit?: string;
  readonly currency?: string;
  readonly rationale?: string;
}

export class ForecastIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastIntegrityError";
  }
}

function requiredText(value: string, field: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(field + " must be a string");
  const normalized = value.trim();
  if (!normalized) throw new TypeError(field + " must not be empty");
  if (normalized.length > maximum) throw new RangeError(field + " must not exceed " + maximum + " characters");
  return normalized;
}

function optionalText(value: string | undefined, field: string, maximum: number): string | null {
  return value === undefined ? null : requiredText(value, field, maximum);
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(field + " must be a valid timestamp");
  return normalized;
}

function finiteNumber(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(field + " must be a finite number");
  return Object.is(value, -0) ? 0 : value;
}

function expectationOf(input: ForecastIssuanceInput): ForecastExpectation {
  const hasPoint = Object.prototype.hasOwnProperty.call(input, "point");
  const hasRange = Object.prototype.hasOwnProperty.call(input, "range");
  if (hasPoint === hasRange) throw new TypeError("Forecast issuance requires exactly one of point or range");
  if (hasPoint) return { kind: "point", value: finiteNumber(input.point as number, "point") };
  const range = input.range as ForecastRange;
  if (range === null || typeof range !== "object") throw new TypeError("range must be an object");
  const low = finiteNumber(range.low, "range.low");
  const high = finiteNumber(range.high, "range.high");
  if (low > high) throw new RangeError("range.low must not exceed range.high");
  return { kind: "range", low, high };
}

function forecastContent(forecast: Omit<ForecastIssuance, "version" | "forecastId" | "contentHash">): unknown {
  return {
    companyId: forecast.companyId,
    runId: forecast.runId,
    period: forecast.period,
    metric: forecast.metric,
    expectation: forecast.expectation,
    issuedAt: forecast.issuedAt,
    unit: forecast.unit,
    currency: forecast.currency,
    rationale: forecast.rationale,
  };
}

function normalizeEvidenceIds(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError("evidenceIds must be an array");
  return Object.freeze([...new Set(values.map((value) => requiredText(value, "evidence ID", 256)))].sort());
}

function normalizedScoringOptions(options: ForecastScoringOptions): Required<ForecastScoringOptions> {
  const absoluteTolerance = options.absoluteTolerance ?? 0;
  const relativeTolerance = options.relativeTolerance ?? 0;
  const minimumScale = options.minimumScale ?? 1;
  if (!Number.isFinite(absoluteTolerance) || absoluteTolerance < 0) throw new RangeError("absoluteTolerance must be non-negative");
  if (!Number.isFinite(relativeTolerance) || relativeTolerance < 0) throw new RangeError("relativeTolerance must be non-negative");
  if (!Number.isFinite(minimumScale) || minimumScale <= 0) throw new RangeError("minimumScale must be positive");
  return { absoluteTolerance, relativeTolerance, minimumScale };
}

function missingScore(
  forecast: ForecastIssuance,
  reason: ForecastScoreReason,
  actualValue: number | null,
  scoredAt: string | null,
  sourceId: string | null,
  evidenceIds: readonly string[],
): ForecastScore {
  const score = {
    version: FORECAST_VERSION,
    forecastId: forecast.forecastId,
    forecastHash: forecast.contentHash,
    actualHash: null,
    status: "missing" as const,
    reason,
    hit: null,
    score: null,
    actualValue,
    absoluteError: null,
    relativeError: null,
    normalizedError: null,
    insideExpectedRange: null,
    scoredAt,
    sourceId,
    evidenceIds,
  };
  return deepFreeze({ ...score, hash: stableHash(score, "research-ledger/forecast-score/v1") }) as ForecastScore;
}

export function issueForecast(input: ForecastIssuanceInput): ForecastIssuance {
  if (input === null || typeof input !== "object") throw new TypeError("Forecast issuance input must be an object");
  const content: Omit<ForecastIssuance, "version" | "forecastId" | "contentHash"> = {
    companyId: companyIdentityKey(input.companyId),
    runId: requiredText(input.runId, "runId", 256),
    period: requiredText(input.period, "period", 120),
    metric: requiredText(input.metric, "metric", 160),
    expectation: expectationOf(input),
    issuedAt: timestamp(input.issuedAt, "issuedAt"),
    unit: optionalText(input.unit, "unit", 80),
    currency: input.currency === undefined ? null : requiredText(input.currency.toUpperCase(), "currency", 12),
    rationale: optionalText(input.rationale, "rationale", 2_000),
  };
  const contentHash = stableHash(forecastContent(content), "research-ledger/forecast-issuance/v1");
  return deepFreeze({
    version: FORECAST_VERSION,
    forecastId: `FCT-${contentHash.toUpperCase()}`,
    contentHash,
    ...content,
  }) as ForecastIssuance;
}

export function verifyForecastIssuance(value: unknown): value is ForecastIssuance {
  try {
    if (value === null || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
    const forecast = value as Partial<ForecastIssuance>;
    if (forecast.version !== FORECAST_VERSION) return false;
    if (typeof forecast.forecastId !== "string" || !/^FCT-[A-F0-9]{64}$/.test(forecast.forecastId)) return false;
    if (typeof forecast.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(forecast.contentHash)) return false;
    if (forecast.forecastId !== "FCT-" + forecast.contentHash.toUpperCase()) return false;
    if (typeof forecast.companyId !== "string" || !forecast.companyId) return false;
    if (typeof forecast.runId !== "string" || !forecast.runId) return false;
    if (typeof forecast.period !== "string" || !forecast.period) return false;
    if (typeof forecast.metric !== "string" || !forecast.metric) return false;
    if (forecast.expectation === null || typeof forecast.expectation !== "object") return false;
    if (forecast.expectation.kind === "point" && !Number.isFinite(forecast.expectation.value)) return false;
    if (forecast.expectation.kind === "range") {
      if (!Number.isFinite(forecast.expectation.low) || !Number.isFinite(forecast.expectation.high)) return false;
      if (forecast.expectation.low > forecast.expectation.high) return false;
    }
    if (forecast.expectation.kind !== "point" && forecast.expectation.kind !== "range") return false;
    if (typeof forecast.issuedAt !== "string" || !Number.isFinite(Date.parse(forecast.issuedAt))) return false;
    if (forecast.unit !== null && typeof forecast.unit !== "string") return false;
    if (forecast.currency !== null && typeof forecast.currency !== "string") return false;
    if (forecast.rationale !== null && typeof forecast.rationale !== "string") return false;
    return stableHash(forecastContent(forecast as ForecastIssuance), "research-ledger/forecast-issuance/v1") === forecast.contentHash;
  } catch {
    return false;
  }
}

export function scoreForecastActual(
  forecast: ForecastIssuance,
  actual: ForecastActualInput | null | undefined,
  options: ForecastScoringOptions = {},
): ForecastScore {
  if (!verifyForecastIssuance(forecast)) throw new ForecastIntegrityError("Forecast issuance failed integrity verification");
  if (actual === null || actual === undefined) {
    return missingScore(forecast, "actual-missing", null, null, null, []);
  }
  if (actual === null || typeof actual !== "object") throw new TypeError("Forecast actual must be an object or null");
  const observedAt = timestamp(actual.observedAt, "actual.observedAt");
  const sourceId = optionalText(actual.sourceId, "actual.sourceId", 256);
  const evidenceIds = normalizeEvidenceIds(actual.evidenceIds);
  const actualCompany = actual.companyId === undefined ? null : companyIdentityKey(actual.companyId);
  if (actualCompany !== null && actualCompany !== forecast.companyId) {
    return missingScore(forecast, "company-mismatch", null, observedAt, sourceId, evidenceIds);
  }
  if (actual.period !== undefined && requiredText(actual.period, "actual.period", 120) !== forecast.period) {
    return missingScore(forecast, "period-mismatch", null, observedAt, sourceId, evidenceIds);
  }
  if (actual.metric !== undefined && requiredText(actual.metric, "actual.metric", 160) !== forecast.metric) {
    return missingScore(forecast, "metric-mismatch", null, observedAt, sourceId, evidenceIds);
  }
  if (Date.parse(observedAt) < Date.parse(forecast.issuedAt)) {
    return missingScore(forecast, "actual-precedes-forecast", null, observedAt, sourceId, evidenceIds);
  }
  if (actual.value === null || actual.value === undefined || !Number.isFinite(actual.value)) {
    return missingScore(forecast, "invalid-actual", null, observedAt, sourceId, evidenceIds);
  }
  const { absoluteTolerance, relativeTolerance, minimumScale } = normalizedScoringOptions(options);
  const value = finiteNumber(actual.value, "actual.value");
  let hit: boolean;
  let reason: ForecastScoreReason;
  let absoluteError: number;
  let relativeError: number | null;
  let normalizedError: number;
  let insideExpectedRange: boolean | null;
  let scale: number;
  if (forecast.expectation.kind === "point") {
    absoluteError = Math.abs(value - forecast.expectation.value);
    scale = Math.max(Math.abs(value), Math.abs(forecast.expectation.value), minimumScale);
    normalizedError = absoluteError / scale;
    const tolerance = absoluteTolerance + relativeTolerance * Math.max(Math.abs(value), Math.abs(forecast.expectation.value));
    hit = absoluteError <= tolerance;
    reason = hit ? "point-hit" : "point-miss";
    relativeError = value === 0 ? null : (value - forecast.expectation.value) / Math.abs(value);
    insideExpectedRange = null;
  } else {
    insideExpectedRange = value >= forecast.expectation.low && value <= forecast.expectation.high;
    if (insideExpectedRange) {
      hit = true;
      reason = "within-range";
      absoluteError = 0;
      relativeError = 0;
      normalizedError = 0;
      scale = minimumScale;
    } else if (value < forecast.expectation.low) {
      hit = false;
      reason = "below-range";
      absoluteError = forecast.expectation.low - value;
      relativeError = value === 0 ? null : (value - forecast.expectation.low) / Math.abs(value);
      scale = Math.max(Math.abs(value), Math.abs(forecast.expectation.low), minimumScale);
      normalizedError = absoluteError / scale;
    } else {
      hit = false;
      reason = "above-range";
      absoluteError = value - forecast.expectation.high;
      relativeError = value === 0 ? null : (value - forecast.expectation.high) / Math.abs(value);
      scale = Math.max(Math.abs(value), Math.abs(forecast.expectation.high), minimumScale);
      normalizedError = absoluteError / scale;
    }
  }
  const roundedNormalizedError = Number.isFinite(normalizedError) ? Number(normalizedError.toPrecision(15)) : null;
  const roundedRelativeError = relativeError === null ? null : Number(relativeError.toPrecision(15));
  const result = {
    version: FORECAST_VERSION,
    forecastId: forecast.forecastId,
    forecastHash: forecast.contentHash,
    actualHash: stableHash(
      { observedAt, companyId: actualCompany, sourceId, evidenceIds, value },
      "research-ledger/forecast-actual/v1",
    ),
    status: hit ? "hit" as const : "miss" as const,
    reason,
    hit,
    score: Math.round(Math.max(0, 1 - (roundedNormalizedError ?? 1)) * 100_000) / 1_000,
    actualValue: value,
    absoluteError,
    relativeError: roundedRelativeError,
    normalizedError: roundedNormalizedError,
    insideExpectedRange,
    scoredAt: observedAt,
    sourceId,
    evidenceIds,
  };
  return deepFreeze({ ...result, hash: stableHash(result, "research-ledger/forecast-score/v1") }) as ForecastScore;
}

export function issueCanonicalForecast(input: CanonicalForecastIssuanceInput): ForecastIssuance {
  if (input === null || typeof input !== "object" || input.forecast === null || typeof input.forecast !== "object") {
    throw new TypeError("Canonical forecast is required");
  }
  const period = requiredText(input.period, "period", 120);
  const projection = input.forecast.projections.find((row) => row.label === period || String(row.year) === period);
  if (!projection) throw new RangeError(`Canonical forecast has no projection for ${period}`);
  return issueForecast({
    companyId: input.companyId,
    runId: input.runId,
    period,
    metric: input.metric,
    point: projection[input.metric],
    issuedAt: input.issuedAt,
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.currency === undefined ? {} : { currency: input.currency }),
    ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
  });
}

export function scoreForecastActuals(
  forecasts: readonly ForecastIssuance[],
  actuals: readonly ForecastActualInput[],
  options: ForecastScoringOptions = {},
): readonly ForecastScore[] {
  if (!Array.isArray(forecasts) || !Array.isArray(actuals)) throw new TypeError("forecasts and actuals must be arrays");
  const actualByKey = new Map<string, ForecastActualInput>();
  for (const actual of actuals) {
    if (actual === null || typeof actual !== "object") throw new TypeError("Each actual must be an object");
    const period = requiredText((actual as ForecastActualInput & { period?: unknown }).period as string, "actual.period", 120);
    const metric = requiredText((actual as ForecastActualInput & { metric?: unknown }).metric as string, "actual.metric", 160);
    const key = JSON.stringify([period, metric]);
    if (actualByKey.has(key)) throw new TypeError(`Duplicate actual for ${period} ${metric}`);
    actualByKey.set(key, actual);
  }
  const seenForecasts = new Set<string>();
  return Object.freeze(forecasts.map((forecast) => {
    if (seenForecasts.has(forecast.forecastId)) throw new TypeError(`Duplicate forecast ${forecast.forecastId}`);
    seenForecasts.add(forecast.forecastId);
    const actual = actualByKey.get(JSON.stringify([forecast.period, forecast.metric])) as (ForecastActualInput & {
      readonly period: string;
      readonly metric: string;
    }) | undefined;
    return scoreForecastActual(forecast, actual, options);
  }));
}
