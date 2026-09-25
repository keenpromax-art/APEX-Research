import { deepFreeze, isDeeplyFrozen } from "../research-ledger/immutable";
import { compareStableStrings, createStableId, stableHash, stableStringify } from "../research-ledger/stable";
import {
  CANONICAL_SOURCE_TAXONOMY_VERSION,
  FACT_NORMALIZATION_VERSION,
  createCanonicalSourceMetadata,
  type CanonicalSourceMetadata,
  type Fact,
  type FactNormalizationMetadata,
  type FactPack,
  type FactSection,
  type FactSource,
  type CurrentPriceMetadata,
  type FactPackDiagnostics,
} from "./types";

export const FACT_PACK_VERSION = "2.0";
export const YAHOO_FACT_SOURCE_ID = "market-data:provider:yahoo-finance";

const FACT_PACK_SECTIONS = [
  "company",
  "market",
  "incomeStatement",
  "balanceSheet",
  "cashFlow",
  "shares",
  "earnings",
  "estimates",
  "corporateActions",
  "priceHistory",
  "holders",
] as const;

type FactPackSectionName = (typeof FACT_PACK_SECTIONS)[number] | "fundamentalsTimeseries";

export class FactPackIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactPackIntegrityError";
  }
}

export interface BuildFactPackOptions {
  retrievalTimestamp?: string;
  sourceMetadata?: Partial<Omit<CanonicalSourceMetadata, "taxonomyVersion">>;
}

export interface CreateFactIdInput {
  ticker: string;
  metric: string;
  period: string;
  sourceId?: string;
  sourcePath?: string;
  reportingPeriod?: string;
  fiscalPeriod?: string;
  periodType?: string;
}

function requiredText(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function normalizeTimestamp(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const parsed = Date.parse(requiredText(value, "retrievalTimestamp"));
  if (!Number.isFinite(parsed)) throw new TypeError("retrievalTimestamp must be a valid timestamp");
  return new Date(parsed).toISOString();
}

function canonicalRawValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    return `[non-finite:${String(value)}]`;
  }
  if (typeof value === "bigint") return `[bigint:${value.toString()}]`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Date) return Number.isFinite(Date.parse(value.toISOString())) ? value.toISOString() : "[invalid-date]";
  if (ancestors.has(value)) throw new TypeError("Fact-pack raw payload must not be cyclic");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .map((item) => canonicalRawValue(item, ancestors))
        .sort(compareStableStringsOnStableValue);
    }
    const result: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort(compareStableStrings)) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) continue;
      const normalized = canonicalRawValue(descriptor.value, ancestors);
      if (normalized !== "[undefined]") result[key] = normalized;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function compareStableStringsOnStableValue(left: unknown, right: unknown): number {
  const leftValue = stableStringify(left) ?? "null";
  const rightValue = stableStringify(right) ?? "null";
  return compareStableStrings(leftValue, rightValue);
}

function cloneRaw(value: unknown): unknown {
  return canonicalRawValue(value, new Set<object>());
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Object.is(value, -0) ? 0 : value;
}

function rawPrimitive(value: unknown): number | string | boolean | null {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  return finiteNumber(value) ?? null;
}

function unwrapYahooRaw(value: unknown): unknown {
  if (value !== null && typeof value === "object" && "raw" in value) {
    return (value as { raw?: unknown }).raw;
  }
  return value;
}

function readFirstRaw(value: unknown): number | undefined {
  return finiteNumber(unwrapYahooRaw(value));
}

function readFirstDefined(values: unknown[]): number | undefined {
  for (const value of values) {
    const candidate = readFirstRaw(value);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function periodYear(period: string): number | undefined {
  const match = period.match(/(?:19|20)\d{2}/);
  if (!match) return undefined;
  const year = Number(match[0]);
  return Number.isInteger(year) ? year : undefined;
}

function periodDate(period: string): string | undefined {
  const match = period.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!match || !Number.isFinite(Date.parse(match))) return undefined;
  return match;
}

export function normalizeFactPeriod(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e12 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  if (value && typeof value === "object") {
    const record = value as { raw?: unknown; fmt?: unknown };
    return normalizeFactPeriod(record.raw ?? record.fmt);
  }
  const text = requiredText(value, "period");
  const date = periodDate(text);
  return date ?? text.trim();
}

export function createStablePeriodId(input: { ticker: string; period: string; periodType?: string; sourceId?: string }): string {
  return createStableId("PERIOD", {
    ticker: requiredText(input.ticker, "ticker").toUpperCase(),
    period: normalizeFactPeriod(input.period),
    periodType: input.periodType ?? null,
  }, "ai-first/period-id/v1");
}

function timestampFromValue(value: unknown): { timestamp?: string; source?: string } {
  if (value === null || value === undefined) return {};
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? { timestamp: value.toISOString(), source: "date" } : {};
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return {};
    const milliseconds = value > 1e12 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? { timestamp: date.toISOString(), source: "epoch" } : {};
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(trimmed)) return timestampFromValue(numeric);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? { timestamp: new Date(parsed).toISOString(), source: "string" } : {};
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const raw = timestampFromValue(record.raw);
    if (raw.timestamp) return { ...raw, source: `${raw.source ?? "object"}.raw` };
    const fmt = timestampFromValue(record.fmt);
    return fmt.timestamp ? { ...fmt, source: `${fmt.source ?? "object"}.fmt` } : {};
  }
  return {};
}

function delayedFlag(quote: Record<string, unknown>, price: Record<string, unknown>): { delayed: boolean; source?: string; delayMinutes?: number } {
  const values = [quote, price, quote.price as Record<string, unknown> | undefined, quote.financialData as Record<string, unknown> | undefined].filter((value): value is Record<string, unknown> => Boolean(value));
  for (const value of values) {
    for (const key of ["isDelayed", "delayed", "isRealTime", "isRealtime"]) {
      if (value[key] === true || value[key] === "true") return { delayed: key !== "isRealTime" && key !== "isRealtime", source: key };
      if ((value[key] === false || value[key] === "false") && (key === "isDelayed" || key === "delayed")) return { delayed: false, source: key };
    }
    const delayedBy = finiteNumber(unwrapYahooRaw(value.exchangeDataDelayedBy ?? value.dataDelayedBy));
    if (delayedBy !== undefined) return { delayed: delayedBy > 0, source: "exchangeDataDelayedBy", delayMinutes: delayedBy };
  }
  return { delayed: false };
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return scalarText(record.raw ?? record.fmt);
  }
  return undefined;
}

function currentPriceMetadata(input: {
  quote: Record<string, unknown>;
  price: Record<string, unknown>;
  value: number | undefined;
  retrievalTimestamp: string;
  sourceId: string;
  sourceName: string;
}): CurrentPriceMetadata {
  const financialData = input.quote.financialData && typeof input.quote.financialData === "object" ? input.quote.financialData as Record<string, unknown> : undefined;
  const priceTime = timestampFromValue(input.price.regularMarketTime ?? input.price.timestamp ?? input.price.asOfTime ?? input.quote.regularMarketTime ?? financialData?.regularMarketTime);
  const timestamp = priceTime.timestamp;
  const exchangeValue = input.price.exchangeName ?? input.price.exchange ?? input.price.fullExchangeName ?? input.quote.exchangeName ?? input.quote.exchange ?? financialData?.exchange;
  const sessionValue = input.price.marketState ?? input.price.session ?? input.price.sessionState ?? input.quote.marketState ?? financialData?.marketState;
  const exchange = scalarText(exchangeValue);
  const sessionValueText = scalarText(sessionValue);
  const session = sessionValueText ? sessionValueText.toUpperCase() : undefined;
  const delay = delayedFlag(input.quote, input.price);
  const retrieval = Date.parse(input.retrievalTimestamp);
  const observed = timestamp ? Date.parse(timestamp) : Number.NaN;
  const ageMs = Number.isFinite(retrieval) && Number.isFinite(observed) ? Math.max(0, retrieval - observed) : undefined;
  const staleAfterMs = 24 * 60 * 60 * 1000;
  const diagnostics: string[] = [];
  if (input.value === undefined) diagnostics.push("current_price_unavailable");
  if (!timestamp) diagnostics.push("current_price_timestamp_unavailable");
  if (!exchange) diagnostics.push("current_price_exchange_unavailable");
  if (!session) diagnostics.push("current_price_session_unavailable");
  if (delay.delayed) diagnostics.push("current_price_delayed");
  if (ageMs !== undefined && ageMs > staleAfterMs) diagnostics.push("current_price_stale");
  const status: CurrentPriceMetadata["status"] = input.value === undefined ? "unknown" : delay.delayed ? "delayed" : timestamp ? "realtime" : "unknown";
  const freshness: CurrentPriceMetadata["freshness"] = ageMs === undefined ? "unknown" : ageMs > staleAfterMs ? "stale" : "fresh";
  const rawSource = input.price.source ?? input.quote.source;
  const source = scalarText(rawSource) ?? input.sourceName;
  return {
    ...(input.value === undefined ? {} : { value: input.value }),
    ...(timestamp ? { timestamp, timestampSource: priceTime.source } : {}),
    ...(exchange ? { exchange } : {}),
    ...(session ? { session } : {}),
    status,
    delayedOrRealtime: status,
    sourceId: input.sourceId,
    ...(timestamp ? { asOfDate: timestamp.slice(0, 10) } : {}),
    ...(ageMs === undefined ? {} : { ageMs, ageSeconds: Math.floor(ageMs / 1000) }),
    freshness,
    stale: freshness === "stale",
    isStale: freshness === "stale",
    source,
    delayed: delay.delayed,
    isDelayed: delay.delayed,
    ...(delay.delayMinutes !== undefined ? { delaySeconds: delay.delayMinutes * 60 } : {}),
    diagnostics,
  };
}

function confidenceLevel(value: number): Fact["confidenceLevel"] {
  if (value <= 0) return "none";
  if (value < 0.5) return "low";
  if (value < 0.8) return "medium";
  return "high";
}

function factHasValue(fact: Fact): boolean {
  return fact.value !== undefined || (fact.textValue !== undefined && fact.textValue.length > 0);
}

export function canonicalObservationRank(fact: Pick<Fact, "sourcePath">): number {
  const path = fact.sourcePath ?? "";
  if (path.startsWith("quote-summary/")) return 0;
  if (path.startsWith("fundamentals-timeseries/")) return 1;
  return path ? 2 : 0;
}

export function createFactId(input: CreateFactIdInput): string {
  const ticker = requiredText(input.ticker, "ticker").toUpperCase();
  const metric = requiredText(input.metric, "metric");
  const period = normalizeFactPeriod(input.period);
  const reportingPeriod = normalizeFactPeriod(input.reportingPeriod ?? period);
  const fiscalPeriod = input.fiscalPeriod === undefined ? null : normalizeFactPeriod(input.fiscalPeriod);
  return createStableId(
    "FACT",
    {
      ticker,
      metric,
      period,
      reportingPeriod,
      fiscalPeriod,
      periodType: input.periodType ?? null,
      sourceId: input.sourceId ?? null,
      sourcePath: input.sourcePath?.trim() ? input.sourcePath.trim() : null,
    },
    "ai-first/fact-id/v1",
  );
}

interface CreateNormalizedFactInput {
  ticker: string;
  metric: string;
  label: string;
  period: string;
  value?: number;
  textValue?: string;
  rawValue?: unknown;
  currency?: string;
  unit?: string;
  source: FactSource;
  sourceId: string;
  sourcePath?: string;
  sourceMetadata: CanonicalSourceMetadata;
  retrievalTimestamp: string;
  asOfTimestamp?: string;
  priceTimestamp?: string;
  exchange?: string;
  session?: string;
  dataStatus?: CurrentPriceMetadata["status"];
  delayedOrRealtime?: CurrentPriceMetadata["status"];
  freshness?: CurrentPriceMetadata["freshness"];
  asOfDate?: string;
  fiscalPeriod?: string;
  reportingPeriod?: string;
  periodType: NonNullable<Fact["periodType"]>;
  restated: boolean;
  estimated: boolean;
  rawField: string;
  derivedFrom?: string[];
}

function createNormalizedFact(input: CreateNormalizedFactInput): Fact {
  const value = finiteNumber(input.value);
  const textValue = input.textValue === undefined || input.textValue.length === 0 ? undefined : input.textValue;
  const reportingPeriod = normalizeFactPeriod(input.reportingPeriod ?? input.period);
  const fiscalPeriod = input.fiscalPeriod === undefined ? undefined : normalizeFactPeriod(input.fiscalPeriod);
  const confidence = factHasValue({ value, textValue } as Fact) ? (input.estimated ? 0.6 : input.sourceMetadata.confidence) : 0;
  const currency = input.currency?.trim().toUpperCase() || undefined;
  const currencyConversion = {
    fromCurrency: currency ?? null,
    toCurrency: currency ?? null,
    rate: currency === undefined ? null : 1,
    method: currency === undefined ? "unavailable" : "identity",
    applied: false,
  };
  const shareBasisConversion = {
    fromBasis: input.unit === "shares" ? "reported" : "not_applicable",
    toBasis: input.unit === "shares" ? "reported" : "not_applicable",
    factor: 1,
    method: input.unit === "shares" ? "identity" : "not_applicable",
    applied: false,
  };
  const normalization: FactNormalizationMetadata = {
    version: FACT_NORMALIZATION_VERSION,
    method: "provider-payload-normalization",
    rawValue: rawPrimitive(input.rawValue ?? value ?? textValue ?? null),
    rawUnit: input.unit ?? null,
    normalizedUnit: input.unit ?? null,
    scaleFactor: 1,
    currencyConversion,
    shareBasisConversion,
    confidence,
  };
  const factId = createFactId({
    ticker: input.ticker,
    metric: input.metric,
    period: input.period,
    reportingPeriod,
    fiscalPeriod: input.fiscalPeriod,
    periodType: input.periodType,
    sourceId: input.sourceId,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
  });
  return {
    metric: input.metric,
    label: input.label,
    value,
    textValue,
    period: normalizeFactPeriod(input.period),
    periodId: createStablePeriodId({ ticker: input.ticker, period: input.period, periodType: input.periodType, sourceId: input.sourceId }),
    currency,
    unit: input.unit,
    source: input.source,
    sourceId: input.sourceId,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    sourceMetadata: input.sourceMetadata,
    factId,
    ticker: input.ticker,
    retrievalTimestamp: input.retrievalTimestamp,
    asOfTimestamp: input.asOfTimestamp,
    ...(input.priceTimestamp ? { priceTimestamp: input.priceTimestamp } : {}),
    ...(input.exchange ? { exchange: input.exchange } : {}),
    ...(input.session ? { session: input.session } : {}),
    ...(input.dataStatus ? { dataStatus: input.dataStatus } : {}),
    ...(input.delayedOrRealtime ? { delayedOrRealtime: input.delayedOrRealtime } : {}),
    ...(input.freshness ? { freshness: input.freshness } : {}),
    asOfDate: input.asOfDate,
    fiscalPeriod,
    fiscalYear: periodYear(reportingPeriod),
    reportingPeriod,
    periodType: input.periodType,
    restated: input.restated,
    estimated: input.estimated,
    rawField: input.rawField,
    normalization,
    currencyConversion,
    shareBasisConversion,
    confidence,
    confidenceLevel: confidenceLevel(confidence),
    ...(input.derivedFrom?.length ? { derivedFrom: [...new Set(input.derivedFrom)].sort(compareStableStrings) } : {}),
  };
}

interface RawRow {
  [key: string]: unknown;
}

interface YahooRow {
  period: string;
  values: Record<string, number | undefined>;
  rawValues: Record<string, unknown>;
  restated: boolean;
  sourcePath?: string;
}

function readYahooRows(rows: RawRow[] | undefined | null): YahooRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): YahooRow => {
      const end = (row.endDate || row.reportDate || row.asOfDate) as { fmt?: unknown; raw?: unknown } | undefined;
      const periodValue = end?.fmt ?? end?.raw ?? row.endDate ?? row.reportDate ?? row.asOfDate;
      let period = "unknown";
      try {
        period = normalizeFactPeriod(periodValue);
      } catch {
        period = "unknown";
      }
      const values: Record<string, number | undefined> = {};
      const rawValues: Record<string, unknown> = {};
      for (const key of Object.keys(row).sort(compareStableStrings)) {
        if (key === "endDate" || key === "reportDate" || key === "asOfDate" || key === "maxAge" || key === "restated" || key === "isRestated") continue;
        const raw = unwrapYahooRaw(row[key]);
        rawValues[key] = rawPrimitive(raw);
        values[key] = finiteNumber(raw);
      }
      return { period, values, rawValues, restated: row.restated === true || row.isRestated === true };
    })
    .sort((left, right) => compareStableStrings(left.period, right.period) || compareStableStringsOnStableValue(left.rawValues, right.rawValues));
}

export interface TimeseriesRow {
  period: string;
  periodType: NonNullable<Fact["periodType"]>;
  values: Record<string, number | undefined>;
  rawValues: Record<string, unknown>;
  restated: boolean;
  sourceType?: string;
  asOfTimestamp?: string;
}

function timeseriesMetric(typeName: string): string {
  const aliases: Record<string, string> = {
    annualTotalRevenue: "totalRevenue",
    annualOperatingRevenue: "operatingRevenue",
    annualNetIncomeCommonStockholders: "netIncome",
    annualNetIncome: "netIncome",
    annualTotalAssets: "totalAssets",
    annualTotalLiabilitiesNetMinorityInterest: "totalLiabilities",
    annualTotalEquityGrossMinorityInterest: "totalEquity",
    annualTotalDebt: "totalDebt",
    annualCashAndCashEquivalents: "cash",
    annualOperatingCashFlow: "operatingCashFlow",
    annualCapitalExpenditure: "capitalExpenditures",
    annualFreeCashFlow: "freeCashFlow",
    annualOrdinarySharesNumber: "ordinarySharesNumber",
    quarterlyTotalRevenue: "totalRevenue",
    quarterlyNetIncomeCommonStockholders: "netIncome",
    quarterlyTotalAssets: "totalAssets",
    quarterlyTotalDebt: "totalDebt",
    quarterlyTotalEquityGrossMinorityInterest: "totalEquity",
  };
  if (aliases[typeName]) return aliases[typeName];
  return typeName.replace(/^(?:annual|quarterly|trailing)/, "");
}

function timeseriesPeriodType(value: unknown): NonNullable<Fact["periodType"]> {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "3M" || normalized === "QUARTER" || normalized === "QUARTERLY") return "actual";
  if (normalized === "12M" || normalized === "ANNUAL" || normalized === "YEAR") return "actual";
  if (normalized === "ESTIMATE" || normalized === "FORECAST") return normalized === "FORECAST" ? "forecast" : "estimate";
  return "actual";
}

export function readTimeseriesRows(raw: unknown): TimeseriesRow[] {
  if (!raw || typeof raw !== "object") return [];
  const root = raw as Record<string, unknown>;
  const timeseries = root.timeseries;
  const result = Array.isArray(timeseries)
    ? timeseries
    : timeseries && typeof timeseries === "object"
      ? (timeseries as Record<string, unknown>).result ?? (timeseries as Record<string, unknown>).results
      : Array.isArray(root.result)
        ? root.result
        : Array.isArray(root)
          ? root
          : undefined;
  if (!Array.isArray(result)) {
    const direct = Object.keys(root).flatMap((key) => Array.isArray(root[key]) ? root[key] as unknown[] : []);
    if (direct.length === 0) return [];
    return readTimeseriesRows({ timeseries: { result: [{ meta: { type: Object.keys(root) }, ...Object.fromEntries(Object.keys(root).map((key) => [key, root[key]])) }] } });
  }
  const grouped = new Map<string, TimeseriesRow>();
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const meta = record.meta && typeof record.meta === "object" ? record.meta as Record<string, unknown> : undefined;
    const types = Array.isArray(meta?.type) ? meta.type : typeof meta?.type === "string" ? [meta.type] : [];
    for (const typeValue of types) {
      const typeName = String(typeValue ?? "");
      const series = record[typeName];
      if (!Array.isArray(series)) continue;
      for (const entry of series) {
        if (!entry || typeof entry !== "object") continue;
        const entryRecord = entry as Record<string, unknown>;
        const periodValue = entryRecord.asOfDate ?? entryRecord.endDate ?? entryRecord.date ?? entryReportDate(entryRecord);
        if (periodValue === undefined || periodValue === null) continue;
        let period: string;
        try {
          period = normalizeFactPeriod(periodValue);
        } catch {
          continue;
        }
        const reported = entryRecord.reportedValue && typeof entryRecord.reportedValue === "object" ? entryRecord.reportedValue as Record<string, unknown> : undefined;
        const rawValue = reported && Object.prototype.hasOwnProperty.call(reported, "raw") ? reported.raw : entryRecord.raw;
        const value = finiteNumber(unwrapYahooRaw(rawValue));
        if (value === undefined) continue;
        const metric = timeseriesMetric(typeName);
        const key = `${period}|${typeName}|${String(entryRecord.periodType ?? "")}`;
        const current = grouped.get(key) ?? {
          period,
          periodType: timeseriesPeriodType(entryRecord.periodType),
          values: {},
          rawValues: {},
          restated: entryRecord.restated === true || entryRecord.isRestated === true,
          sourceType: typeName,
          asOfTimestamp: timestampFromValue(entryRecord.asOfDate).timestamp,
        };
        if (current.values[metric] !== undefined && current.values[metric] !== value) {
          throw new FactPackIntegrityError(`Conflicting fundamentals timeseries values for ${metric} in ${period}`);
        }
        current.values[metric] = value;
        current.rawValues[metric] = rawPrimitive(unwrapYahooRaw(rawValue));
        current.restated = current.restated || entryRecord.restated === true || entryRecord.isRestated === true;
        grouped.set(key, current);
      }
    }
  }
  return [...grouped.values()].sort((left, right) => compareStableStrings(left.period, right.period) || compareStableStringsOnStableValue(left.rawValues, right.rawValues));
}

function entryReportDate(entry: Record<string, unknown>): unknown {
  return entry.reportDate ?? entry.fiscalPeriod ?? entry.period;
}

function priceDate(value: unknown): string | undefined {
  try {
    return normalizeFactPeriod(value);
  } catch {
    return undefined;
  }
}

interface PriceHistoryRow {
  period: string;
  values: Record<string, number | undefined>;
  rawValues: Record<string, unknown>;
}

function readPriceHistoryRows(raw: Record<string, unknown>): PriceHistoryRow[] {
  const candidates: unknown[] = [];
  const direct = raw.priceHistory ?? raw.price_history ?? raw.historicalPrices ?? raw.history;
  if (Array.isArray(direct)) candidates.push(...direct);
  else if (direct && typeof direct === "object") {
    const directRecord = direct as Record<string, unknown>;
    for (const key of ["history", "prices", "data", "rows"]) if (Array.isArray(directRecord[key])) candidates.push(...(directRecord[key] as unknown[]));
  }
  const chart = raw.chart && typeof raw.chart === "object" ? raw.chart as Record<string, unknown> : undefined;
  const chartResults = chart?.results ?? chart?.result;
  const firstChart = Array.isArray(chartResults) ? chartResults[0] : chartResults;
  if (firstChart && typeof firstChart === "object") {
    const chartRecord = firstChart as Record<string, unknown>;
    const timestamps = Array.isArray(chartRecord.timestamp) ? chartRecord.timestamp : [];
    const indicators = chartRecord.indicators && typeof chartRecord.indicators === "object" ? chartRecord.indicators as Record<string, unknown> : {};
    const quote = Array.isArray(indicators.quote) && indicators.quote[0] && typeof indicators.quote[0] === "object" ? indicators.quote[0] as Record<string, unknown> : {};
    const keys = ["open", "high", "low", "close", "volume"];
    timestamps.forEach((timestamp, index) => {
      const row: Record<string, unknown> = { timestamp };
      for (const key of keys) {
        const series = quote[key];
        if (Array.isArray(series)) row[key] = series[index];
      }
      candidates.push(row);
    });
  }
  const rows: PriceHistoryRow[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const period = priceDate(record.date ?? record.timestamp ?? record.endDate ?? record.asOfDate ?? record.datetime);
    if (!period) continue;
    const values: Record<string, number | undefined> = {};
    const rawValues: Record<string, unknown> = {};
    for (const key of ["open", "high", "low", "close", "volume", "adjClose"]) {
      if (!(key in record)) continue;
      const rawValue = unwrapYahooRaw(record[key]);
      const value = finiteNumber(rawValue);
      if (value === undefined) continue;
      values[key] = value;
      rawValues[key] = rawPrimitive(rawValue);
    }
    if (Object.keys(values).length > 0) rows.push({ period, values, rawValues });
  }
  return rows.sort((left, right) => compareStableStrings(left.period, right.period) || compareStableStringsOnStableValue(left.rawValues, right.rawValues));
}

function priceMetricName(key: string): string {
  return `price${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

function actionValue(value: unknown): number | undefined {
  return finiteNumber(unwrapYahooRaw(value));
}

function readCorporateActionRows(raw: Record<string, unknown>): Array<{ period: string; type: string; values: Record<string, number | undefined>; rawValues: Record<string, unknown>; text: string }> {
  const sources: unknown[] = [];
  for (const key of ["corporateActions", "corporate_actions", "actions", "events"]) {
    const value = raw[key];
    if (Array.isArray(value)) sources.push(...value);
    else if (value && typeof value === "object") sources.push(value);
  }
  const chart = raw.chart && typeof raw.chart === "object" ? raw.chart as Record<string, unknown> : undefined;
  const chartResults = chart?.results ?? chart?.result;
  const firstChart = Array.isArray(chartResults) ? chartResults[0] : chartResults;
  if (firstChart && typeof firstChart === "object") {
    const events = (firstChart as Record<string, unknown>).events;
    if (Array.isArray(events)) sources.push(...events);
  }
  const netActivity = raw.netSharePurchaseActivity;
  if (Array.isArray(netActivity)) sources.push(...netActivity);
  const byActionKey = new Map<string, { period: string; type: string; values: Record<string, number | undefined>; rawValues: Record<string, unknown>; text: string }>();
  const expanded: unknown[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    const nested = record.transaction ?? record.transactions ?? record.entries;
    if (Array.isArray(nested)) {
      for (const entry of nested) {
        if (entry && typeof entry === "object") expanded.push({ ...record, ...(entry as Record<string, unknown>), date: (entry as Record<string, unknown>).date ?? record.date ?? record.period });
      }
    } else {
      expanded.push(record);
    }
  }
  for (const source of expanded) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    const period = priceDate(record.date ?? record.timestamp ?? record.endDate ?? record.asOfDate ?? record.period ?? record.transactionDate ?? record.splitDate ?? record.exDate ?? record.payDate) ?? "unknown";
    const type = String(record.type ?? record.action ?? record.eventType ?? record.event ?? record.transaction ?? "corporate_action").trim().toLowerCase();
    const values: Record<string, number | undefined> = {};
    const rawValues: Record<string, unknown> = {};
    for (const key of ["ratio", "amount", "value", "shares", "price", "dividend", "splitRatio", "numberOfShares"]) {
      if (!(key in record)) continue;
      const value = actionValue(record[key]);
      if (value === undefined) continue;
      values[key] = value;
      rawValues[key] = rawPrimitive(unwrapYahooRaw(record[key]));
    }
    const textValue = String(record.label ?? record.description ?? record.text ?? type).trim();
    const actionKey = `${period}|${type}`;
    const existing = byActionKey.get(actionKey);
    if (existing) {
      existing.values = { ...values, ...existing.values };
      existing.rawValues = { ...rawValues, ...existing.rawValues };
      if (existing.text === existing.type && textValue && textValue !== type) existing.text = textValue;
    } else {
      byActionKey.set(actionKey, { period, type, values, rawValues, text: textValue || type });
    }
  }
  return [...byActionKey.values()].sort((left, right) => compareStableStrings(left.period, right.period) || compareStableStrings(left.type, right.type) || compareStableStringsOnStableValue(left.rawValues, right.rawValues));
}

function compareFacts(left: Fact, right: Fact): number {
  return compareStableStrings(left.metric, right.metric)
    || compareStableStrings(right.reportingPeriod ?? right.fiscalPeriod ?? right.period, left.reportingPeriod ?? left.fiscalPeriod ?? left.period)
    || compareStableStrings(left.factId ?? "", right.factId ?? "")
    || compareStableStrings(left.rawField ?? "", right.rawField ?? "");
}

function canonicalizeFacts(facts: Fact[]): Fact[] {
  const grouped = new Map<string, Fact[]>();
  for (const fact of facts) {
    const id = requiredText(fact.factId, "fact.factId");
    const group = grouped.get(id) ?? [];
    group.push(fact);
    grouped.set(id, group);
  }
  const selected: Fact[] = [];
  for (const [factId, group] of grouped) {
    const ordered = [...group].sort((left, right) => {
      const availability = Number(factHasValue(right)) - Number(factHasValue(left));
      return availability || compareStableStringsOnStableValue(left, right);
    });
    const first = ordered[0];
    if (!first) throw new FactPackIntegrityError(`Fact ${factId} has no content`);
    const firstAvailable = factHasValue(first);
    for (const candidate of ordered.slice(1)) {
      if (factHasValue(candidate) !== firstAvailable) continue;
      if (stableStringify(candidate) !== stableStringify(first)) {
        throw new FactPackIntegrityError(`Conflicting duplicate facts for ${factId}`);
      }
    }
    selected.push(first);
  }
  return selected.sort(compareFacts);
}

function section(name: string, facts: Fact[], raw?: unknown): FactSection {
  return {
    name,
    facts: canonicalizeFacts(facts),
    ...(raw === undefined ? {} : { raw: cloneRaw(raw) }),
  };
}

function defaultSourceMetadata(options: BuildFactPackOptions): CanonicalSourceMetadata {
  const override = options.sourceMetadata ?? {};
  return createCanonicalSourceMetadata({
    provider: "Yahoo Finance",
    ...override,
    type: override.type ?? "market_data_provider",
    sourceId: override.sourceId ?? YAHOO_FACT_SOURCE_ID,
  });
}

function numericFact(input: {
  ticker: string;
  metric: string;
  label: string;
  period: string;
  value: number | undefined;
  rawValue?: unknown;
  currency?: string;
  unit?: string;
  source: FactSource;
  sourceId: string;
  sourcePath?: string;
  sourceMetadata: CanonicalSourceMetadata;
  retrievalTimestamp: string;
  asOfTimestamp?: string;
  priceTimestamp?: string;
  exchange?: string;
  session?: string;
  dataStatus?: CurrentPriceMetadata["status"];
  delayedOrRealtime?: CurrentPriceMetadata["status"];
  freshness?: CurrentPriceMetadata["freshness"];
  asOfDate?: string;
  fiscalPeriod?: string;
  reportingPeriod?: string;
  periodType: NonNullable<Fact["periodType"]>;
  restated?: boolean;
  estimated?: boolean;
  rawField: string;
  derivedFrom?: string[];
}): Fact {
  return createNormalizedFact({ ...input, restated: input.restated ?? false, estimated: input.estimated ?? false });
}

function textFact(input: {
  ticker: string;
  metric: string;
  label: string;
  textValue: string | undefined;
  rawValue?: unknown;
  source: FactSource;
  sourceId: string;
  sourceMetadata: CanonicalSourceMetadata;
  retrievalTimestamp: string;
  asOfDate: string;
  rawField: string;
  period?: string;
  periodType?: NonNullable<Fact["periodType"]>;
}): Fact {
  return createNormalizedFact({
    ...input,
    period: input.period ?? "current",
    reportingPeriod: input.period ?? "current",
    periodType: input.periodType ?? "current",
    restated: false,
    estimated: false,
  });
}

function historyFacts(input: {
  rows: Array<YahooRow | TimeseriesRow>;
  ticker: string;
  currency?: string;
  source: FactSource;
  sourceId: string;
  sourcePath: string;
  sourceMetadata: CanonicalSourceMetadata;
  retrievalTimestamp: string;
}): Fact[] {
  const facts: Fact[] = [];
  for (const row of input.rows) {
    const rowPath = "sourceType" in row && row.sourceType ? `${input.sourcePath}/${row.sourceType}` : input.sourcePath;
    const periodDateValue = periodDate(row.period);
    for (const metric of Object.keys(row.values).sort(compareStableStrings)) {
      facts.push(numericFact({
        ticker: input.ticker,
        metric,
        label: humanizeRowKey(metric),
        period: row.period,
        value: row.values[metric],
        rawValue: row.rawValues[metric],
        currency: input.currency,
        source: input.source,
        sourceId: input.sourceId,
        sourcePath: rowPath,
        sourceMetadata: input.sourceMetadata,
        retrievalTimestamp: input.retrievalTimestamp,
        asOfTimestamp: "asOfTimestamp" in row ? row.asOfTimestamp : undefined,
        asOfDate: periodDateValue ?? input.retrievalTimestamp.slice(0, 10),
        fiscalPeriod: row.period === "unknown" ? undefined : row.period,
        reportingPeriod: row.period,
        periodType: "periodType" in row ? row.periodType : "actual",
        restated: row.restated,
        estimated: false,
        rawField: metric,
      }));
    }
  }
  return canonicalizeFacts(facts);
}

function humanizeRowKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function priceHistoryFacts(input: {
  rows: PriceHistoryRow[];
  ticker: string;
  currency?: string;
  source: FactSource;
  sourceId: string;
  sourceMetadata: CanonicalSourceMetadata;
  retrievalTimestamp: string;
}): Fact[] {
  const facts: Fact[] = [];
  for (const row of input.rows) {
    for (const key of Object.keys(row.values).sort(compareStableStrings)) {
      facts.push(numericFact({
        ticker: input.ticker,
        metric: priceMetricName(key),
        label: humanizeRowKey(key),
        period: row.period,
        value: row.values[key],
        rawValue: row.rawValues[key],
        currency: key === "volume" ? undefined : input.currency,
        unit: key === "volume" ? "shares" : input.currency,
        source: input.source,
        sourceId: input.sourceId,
        sourceMetadata: input.sourceMetadata,
        retrievalTimestamp: input.retrievalTimestamp,
        asOfDate: periodDate(row.period) ?? input.retrievalTimestamp.slice(0, 10),
        fiscalPeriod: row.period,
        reportingPeriod: row.period,
        periodType: "actual",
        restated: false,
        estimated: false,
        rawField: `priceHistory.${key}`,
      }));
    }
  }
  return canonicalizeFacts(facts);
}

function corporateActionFacts(input: {
  rows: Array<{ period: string; type: string; values: Record<string, number | undefined>; rawValues: Record<string, unknown>; text: string }>;
  ticker: string;
  currency?: string;
  source: FactSource;
  sourceId: string;
  sourceMetadata: CanonicalSourceMetadata;
  retrievalTimestamp: string;
}): Fact[] {
  const facts: Fact[] = [];
  for (const row of input.rows) {
    const typeMetric = `corporateAction_${row.type.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "event"}`;
    facts.push(textFact({
      ticker: input.ticker,
      metric: typeMetric,
      label: `Corporate action: ${row.type}`,
      textValue: row.text,
      rawValue: row.text,
      source: input.source,
      sourceId: input.sourceId,
      sourceMetadata: input.sourceMetadata,
      retrievalTimestamp: input.retrievalTimestamp,
      asOfDate: periodDate(row.period) ?? input.retrievalTimestamp.slice(0, 10),
      period: row.period,
      periodType: "actual",
      rawField: `corporateActions.${row.type}`,
    }));
    for (const key of Object.keys(row.values).sort(compareStableStrings)) {
      facts.push(numericFact({
        ticker: input.ticker,
        metric: `${typeMetric}_${key}`,
        label: `${humanizeRowKey(row.type)} ${humanizeRowKey(key)}`,
        period: row.period,
        value: row.values[key],
        rawValue: row.rawValues[key],
        currency: /amount|value|price|dividend/i.test(key) ? input.currency : undefined,
        source: input.source,
        sourceId: input.sourceId,
        sourceMetadata: input.sourceMetadata,
        retrievalTimestamp: input.retrievalTimestamp,
        asOfDate: periodDate(row.period) ?? input.retrievalTimestamp.slice(0, 10),
        fiscalPeriod: row.period,
        reportingPeriod: row.period,
        periodType: "actual",
        restated: false,
        estimated: false,
        rawField: `corporateActions.${row.type}.${key}`,
      }));
    }
  }
  return canonicalizeFacts(facts);
}

function factPackContent(pack: FactPack | Record<string, unknown>): unknown {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pack)) {
    if (key === "contentHash" || key === "factPackId") continue;
    content[key] = value;
  }
  return content;
}

export function hashFactPack(pack: FactPack | Record<string, unknown>): string {
  return stableHash(factPackContent(pack), "ai-first/fact-pack/v2");
}

function sourceMetadataIsCanonical(metadata: CanonicalSourceMetadata | undefined): boolean {
  return metadata?.taxonomyVersion === CANONICAL_SOURCE_TAXONOMY_VERSION
    && typeof metadata.sourceId === "string"
    && metadata.sourceId.length > 0
    && metadata.sourceId === metadata.sourceId.trim();
}

function validFact(fact: Fact, pack: FactPack): boolean {
  if (fact === null || typeof fact !== "object") return false;
  if (!fact.metric || !fact.label || !fact.period || !fact.ticker) return false;
  if ((fact.source as string) === "ai" || !sourceMetadataIsCanonical(fact.sourceMetadata)) return false;
  if (fact.sourceId !== fact.sourceMetadata?.sourceId) return false;
  if (fact.retrievalTimestamp !== pack.retrievalTimestamp) return false;
  if (fact.factId !== createFactId({
    ticker: fact.ticker,
    metric: fact.metric,
    period: fact.period,
    sourceId: fact.sourceId,
    ...(fact.sourcePath ? { sourcePath: fact.sourcePath } : {}),
    reportingPeriod: fact.reportingPeriod,
    fiscalPeriod: fact.fiscalPeriod,
    periodType: fact.periodType,
  })) return false;
  if (fact.periodId !== undefined && fact.periodId !== createStablePeriodId({ ticker: fact.ticker, period: fact.period, periodType: fact.periodType, sourceId: fact.sourceId })) return false;
  if (fact.confidence !== undefined && (!Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1)) return false;
  return true;
}

function sourceMetadataIdForPack(pack: FactPack): string {
  for (const sectionName of factPackSectionNames(pack)) {
    const currentSection = pack[sectionName];
    const fact = currentSection?.facts[0];
    if (fact?.sourceId) return fact.sourceId;
  }
  return "";
}

function factPackSectionNames(pack: FactPack): FactPackSectionName[] {
  return pack.fundamentalsTimeseries ? [...FACT_PACK_SECTIONS, "fundamentalsTimeseries" as FactPackSectionName] : [...FACT_PACK_SECTIONS];
}

export function verifyFactPack(value: unknown): value is FactPack {
  try {
    if (value === null || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
    const pack = value as FactPack;
    if (pack.version !== FACT_PACK_VERSION || !pack.ticker || !pack.retrievalTimestamp) return false;
    if (!/^[a-f0-9]{64}$/.test(pack.contentHash ?? "")) return false;
    if (pack.factPackId !== `FACTPACK-${pack.contentHash?.toUpperCase()}`) return false;
    if (hashFactPack(pack) !== pack.contentHash) return false;
    for (const sectionName of factPackSectionNames(pack)) {
      const currentSection = pack[sectionName];
      if (currentSection === null || typeof currentSection !== "object" || !Array.isArray(currentSection.facts)) return false;
      if (currentSection.name !== sectionName) return false;
      const facts = currentSection.facts;
      if (facts.some((fact) => !validFact(fact, pack))) return false;
      for (let index = 1; index < facts.length; index += 1) {
        if (compareFacts(facts[index - 1]!, facts[index]!) > 0) return false;
      }
      try {
        if (stableStringify(canonicalizeFacts(facts)) !== stableStringify(facts)) return false;
      } catch {
        return false;
      }
    }
    const current = pack.currentPriceMetadata;
    if (current) {
      if (current.sourceId !== sourceMetadataIdForPack(pack)) return false;
      if (current.value !== undefined && (!Number.isFinite(current.value) || current.value <= 0)) return false;
      if (current.status === "realtime" && current.delayed) return false;
      if (current.status === "delayed" && !current.delayed) return false;
      if (pack.currentPrice && stableStringify(pack.currentPrice) !== stableStringify(current)) return false;
      if (pack.currentPriceValue !== undefined && pack.currentPriceValue !== current.value) return false;
      if (pack.priceFreshness && stableStringify(pack.priceFreshness) !== stableStringify(current)) return false;
      if (pack.freshnessDiagnostics && stableStringify(pack.freshnessDiagnostics) !== stableStringify(current)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function assertFactPack(value: unknown): asserts value is FactPack {
  if (!verifyFactPack(value)) throw new FactPackIntegrityError("Fact pack failed content or immutability verification");
}

export function buildFactPack(
  rawQuoteSummary: Record<string, unknown>,
  ticker: string,
  options: BuildFactPackOptions | string = {},
): FactPack {
  if (rawQuoteSummary === null || typeof rawQuoteSummary !== "object" || Array.isArray(rawQuoteSummary)) {
    throw new TypeError("rawQuoteSummary must be an object");
  }
  const normalizedOptions = typeof options === "string" ? { retrievalTimestamp: options } : options;
  const normalizedTicker = requiredText(ticker, "ticker").toUpperCase();
  const retrievalTimestamp = normalizeTimestamp(normalizedOptions.retrievalTimestamp);
  const retrievalDate = retrievalTimestamp.slice(0, 10);
  const sourceMetadata = defaultSourceMetadata(normalizedOptions);
  const source: FactSource = sourceMetadata.type === "model_derived" ? "derived" : "yfinance";
  const quote = rawQuoteSummary as Record<string, any>;
  const assetProfile = quote.assetProfile ?? {};
  const price = quote.price ?? {};
  const summaryDetail = quote.summaryDetail ?? {};
  const financialData = quote.financialData ?? {};
  const keyStats = quote.defaultKeyStatistics ?? {};
  const currencyValue = price.currency ?? financialData.financialCurrency;
  const currency = typeof currencyValue === "string" && currencyValue.trim() ? currencyValue.trim().toUpperCase() : undefined;
  const rawCurrentPrice = readFirstRaw(price.regularMarketPrice ?? financialData.currentPrice);
  const currentPriceValue = rawCurrentPrice !== undefined && rawCurrentPrice > 0 ? rawCurrentPrice : undefined;
  const currentPrice = currentPriceMetadata({
    quote,
    price,
    value: currentPriceValue,
    retrievalTimestamp,
    sourceId: sourceMetadata.sourceId,
    sourceName: sourceMetadata.provider ?? "Yahoo Finance",
  });
  const currentAsOfDate = currentPrice.asOfDate ?? retrievalDate;

  const common = {
    ticker: normalizedTicker,
    source,
    sourceId: sourceMetadata.sourceId,
    sourceMetadata,
    retrievalTimestamp,
  } as const;
  const companyFacts = [
    textFact({ ...common, metric: "companyName", label: "Company name", textValue: String(price.longName || price.shortName || normalizedTicker), rawValue: price.longName ?? price.shortName ?? normalizedTicker, asOfDate: retrievalDate, rawField: "price.longName" }),
    textFact({ ...common, metric: "description", label: "Business description", textValue: String(assetProfile.longBusinessSummary ?? "").trim() || undefined, rawValue: assetProfile.longBusinessSummary, asOfDate: retrievalDate, rawField: "assetProfile.longBusinessSummary" }),
    textFact({ ...common, metric: "sector", label: "Sector (Yahoo classification)", textValue: String(assetProfile.sector ?? "").trim() || undefined, rawValue: assetProfile.sector, asOfDate: retrievalDate, rawField: "assetProfile.sector" }),
    textFact({ ...common, metric: "industry", label: "Industry (Yahoo classification)", textValue: String(assetProfile.industry ?? "").trim() || undefined, rawValue: assetProfile.industry, asOfDate: retrievalDate, rawField: "assetProfile.industry" }),
    textFact({ ...common, metric: "country", label: "Country", textValue: String(assetProfile.country ?? "").trim() || undefined, rawValue: assetProfile.country, asOfDate: retrievalDate, rawField: "assetProfile.country" }),
  ];

  const current = {
    ...common,
    period: "current",
    reportingPeriod: "current",
    periodType: "current" as const,
    asOfTimestamp: currentPrice.timestamp,
    priceTimestamp: currentPrice.timestamp,
    exchange: currentPrice.exchange,
    session: currentPrice.session,
    dataStatus: currentPrice.status,
    delayedOrRealtime: currentPrice.delayedOrRealtime,
    freshness: currentPrice.freshness,
    asOfDate: currentAsOfDate,
  };
  const marketFacts = [
    numericFact({ ...current, metric: "currentPrice", label: "Current price", value: currentPrice.value, rawValue: unwrapYahooRaw(price.regularMarketPrice ?? financialData.currentPrice), currency, rawField: price.regularMarketPrice === undefined ? "financialData.currentPrice" : "price.regularMarketPrice" }),
    numericFact({ ...current, metric: "marketCap", label: "Market cap", value: readFirstRaw(price.marketCap), rawValue: unwrapYahooRaw(price.marketCap), currency, rawField: "price.marketCap" }),
    numericFact({ ...current, metric: "sharesOutstanding", label: "Shares outstanding", value: readFirstRaw(keyStats.sharesOutstanding), rawValue: unwrapYahooRaw(keyStats.sharesOutstanding), unit: "shares", rawField: "defaultKeyStatistics.sharesOutstanding" }),
    numericFact({ ...current, metric: "floatShares", label: "Float shares", value: readFirstRaw(keyStats.floatShares), rawValue: unwrapYahooRaw(keyStats.floatShares), unit: "shares", rawField: "defaultKeyStatistics.floatShares" }),
    numericFact({ ...current, metric: "beta", label: "Beta (5Y monthly)", value: readFirstRaw(summaryDetail.beta), rawValue: unwrapYahooRaw(summaryDetail.beta), rawField: "summaryDetail.beta" }),
    numericFact({ ...current, metric: "bookValuePerShare", label: "Book value per share", value: readFirstRaw(keyStats.bookValue), rawValue: unwrapYahooRaw(keyStats.bookValue), currency, rawField: "defaultKeyStatistics.bookValue" }),
    numericFact({ ...current, metric: "trailingPE", label: "Trailing P/E", value: readFirstRaw(summaryDetail.trailingPE), rawValue: unwrapYahooRaw(summaryDetail.trailingPE), rawField: "summaryDetail.trailingPE" }),
    numericFact({ ...current, metric: "forwardPE", label: "Forward P/E", value: readFirstRaw(summaryDetail.forwardPE), rawValue: unwrapYahooRaw(summaryDetail.forwardPE), rawField: "summaryDetail.forwardPE" }),
    numericFact({ ...current, metric: "priceToBook", label: "Price-to-book", value: readFirstDefined([keyStats.priceToBook, summaryDetail.priceToBook]), rawValue: unwrapYahooRaw(keyStats.priceToBook ?? summaryDetail.priceToBook), rawField: "defaultKeyStatistics.priceToBook" }),
    numericFact({ ...current, metric: "enterpriseValue", label: "Enterprise value", value: readFirstDefined([financialData.enterpriseValue, summaryDetail.enterpriseValue]), rawValue: unwrapYahooRaw(financialData.enterpriseValue ?? summaryDetail.enterpriseValue), currency, rawField: "financialData.enterpriseValue" }),
    numericFact({ ...current, metric: "dividendYield", label: "Dividend yield", value: readFirstRaw(summaryDetail.dividendYield), rawValue: unwrapYahooRaw(summaryDetail.dividendYield), unit: "%", rawField: "summaryDetail.dividendYield" }),
    numericFact({ ...current, metric: "dividendRate", label: "Dividend rate", value: readFirstRaw(summaryDetail.dividendRate), rawValue: unwrapYahooRaw(summaryDetail.dividendRate), currency, rawField: "summaryDetail.dividendRate" }),
    numericFact({ ...current, metric: "targetMeanPrice", label: "Street target mean", value: readFirstRaw(financialData.targetMeanPrice), rawValue: unwrapYahooRaw(financialData.targetMeanPrice), currency, rawField: "financialData.targetMeanPrice" }),
    numericFact({ ...current, metric: "numberOfAnalystOpinions", label: "Analyst opinions", value: readFirstRaw(financialData.numberOfAnalystOpinions), rawValue: unwrapYahooRaw(financialData.numberOfAnalystOpinions), rawField: "financialData.numberOfAnalystOpinions" }),
  ];
  const recommendation = String(financialData.recommendationKey ?? "").trim();
  if (recommendation) {
    marketFacts.push(textFact({ ...common, metric: "recommendationKey", label: "Street recommendation", textValue: recommendation, rawValue: financialData.recommendationKey, asOfDate: retrievalDate, rawField: "financialData.recommendationKey" }));
  }

  const incomeHistory = readYahooRows(quote.incomeStatementHistory?.incomeStatementHistory);
  const balanceHistory = readYahooRows(quote.balanceSheetHistory?.balanceSheetHistory);
  const cashflowHistory = readYahooRows(quote.cashflowStatementHistory?.cashflowStatementHistory);
  const timeseriesRows = readTimeseriesRows(quote.fundamentalsTimeseries);
  const timeseriesFacts = historyFacts({ rows: timeseriesRows, ticker: normalizedTicker, currency, source, sourceId: sourceMetadata.sourceId, sourcePath: "fundamentals-timeseries", sourceMetadata, retrievalTimestamp });
  const isIncomeMetric = (metric: string): boolean => /revenue|income|profit|expense|ebit|eps|interest|tax|share|earnings/i.test(metric) && !/asset|liabil|equity|debt|cash|workingCapital|capitalExpenditure|freeCash/i.test(metric);
  const isBalanceMetric = (metric: string): boolean => /asset|liabil|equity|debt|cash|receivable|inventory|payable|workingCapital|capital/i.test(metric) && !/revenue|income|expense|ebit|eps|tax/i.test(metric);
  const isCashMetric = (metric: string): boolean => /operatingCash|investingCash|financingCash|capitalExpenditure|freeCash|dividend|changeInCash|cashFlow/i.test(metric);
  const incomeFacts = canonicalizeFacts([...incomeHistory.flatMap((row) => historyFacts({ rows: [row], ticker: normalizedTicker, currency, source, sourceId: sourceMetadata.sourceId, sourcePath: "quote-summary/income-statement-history", sourceMetadata, retrievalTimestamp })), ...timeseriesFacts.filter((fact) => isIncomeMetric(fact.metric))]);
  const balanceFacts = canonicalizeFacts([...balanceHistory.flatMap((row) => historyFacts({ rows: [row], ticker: normalizedTicker, currency, source, sourceId: sourceMetadata.sourceId, sourcePath: "quote-summary/balance-sheet-history", sourceMetadata, retrievalTimestamp })), ...timeseriesFacts.filter((fact) => isBalanceMetric(fact.metric))]);
  const cashflowFacts = canonicalizeFacts([...cashflowHistory.flatMap((row) => historyFacts({ rows: [row], ticker: normalizedTicker, currency, source, sourceId: sourceMetadata.sourceId, sourcePath: "quote-summary/cashflow-statement-history", sourceMetadata, retrievalTimestamp })), ...timeseriesFacts.filter((fact) => isCashMetric(fact.metric))]);
  const priceHistoryRows = readPriceHistoryRows(quote);
  const corporateActionRows = readCorporateActionRows(quote);
  const priceFacts = priceHistoryFacts({ rows: priceHistoryRows, ticker: normalizedTicker, currency, source, sourceId: sourceMetadata.sourceId, sourceMetadata, retrievalTimestamp });
  const actionFacts = corporateActionFacts({ rows: corporateActionRows, ticker: normalizedTicker, currency, source, sourceId: sourceMetadata.sourceId, sourceMetadata, retrievalTimestamp });

  const trendRows = Array.isArray(quote.earningsTrend?.trend) ? [...quote.earningsTrend.trend] : [];
  trendRows.sort((left: Record<string, unknown>, right: Record<string, unknown>) => compareStableStringsOnStableValue(left, right));
  const estimateFacts: Fact[] = [];
  for (const row of trendRows) {
    const period = String(row.period ?? row.endDate?.fmt ?? "unknown").trim() || "unknown";
    const growth = row.growth;
    const epsAverage = row.earningsEstimate?.avg;
    const revenueAverage = row.revenueEstimate?.avg;
    if (growth && typeof growth === "object" && finiteNumber(growth.raw) !== undefined) {
      estimateFacts.push(numericFact({ ...common, metric: `epsGrowthEstimate_${period}`, label: `EPS growth estimate (${period})`, period, reportingPeriod: period, periodType: "estimate", estimated: true, asOfDate: retrievalDate, value: finiteNumber(growth.raw), rawValue: unwrapYahooRaw(growth), unit: "%", rawField: "earningsTrend.trend.growth" }));
    }
    if (epsAverage && typeof epsAverage === "object" && finiteNumber(epsAverage.raw) !== undefined) {
      estimateFacts.push(numericFact({ ...common, metric: `epsEstimate_${period}`, label: `EPS estimate (${period})`, period, reportingPeriod: period, periodType: "estimate", estimated: true, asOfDate: retrievalDate, value: finiteNumber(epsAverage.raw), rawValue: unwrapYahooRaw(epsAverage), currency, rawField: "earningsTrend.trend.earningsEstimate.avg" }));
    }
    if (revenueAverage && typeof revenueAverage === "object" && finiteNumber(revenueAverage.raw) !== undefined) {
      estimateFacts.push(numericFact({ ...common, metric: `revenueEstimate_${period}`, label: `Revenue estimate (${period})`, period, reportingPeriod: period, periodType: "estimate", estimated: true, asOfDate: retrievalDate, value: finiteNumber(revenueAverage.raw), rawValue: unwrapYahooRaw(revenueAverage), currency, rawField: "earningsTrend.trend.revenueEstimate.avg" }));
    }
  }

  const holdersRaw = quote.majorHoldersBreakdown ?? {};
  const holderFacts = [
    numericFact({ ...current, metric: "insidersPercentHeld", label: "Insider percent held", value: readFirstRaw(holdersRaw.insidersPercentHeld), rawValue: unwrapYahooRaw(holdersRaw.insidersPercentHeld), unit: "%", rawField: "majorHoldersBreakdown.insidersPercentHeld" }),
    numericFact({ ...current, metric: "institutionsPercentHeld", label: "Institutions percent held", value: readFirstRaw(holdersRaw.institutionsPercentHeld), rawValue: unwrapYahooRaw(holdersRaw.institutionsPercentHeld), unit: "%", rawField: "majorHoldersBreakdown.institutionsPercentHeld" }),
    numericFact({ ...current, metric: "institutionsFloatPercentHeld", label: "Institutions % of float held", value: readFirstRaw(holdersRaw.institutionsFloatPercentHeld), rawValue: unwrapYahooRaw(holdersRaw.institutionsFloatPercentHeld), unit: "%", rawField: "majorHoldersBreakdown.institutionsFloatPercentHeld" }),
  ];
  const sharesFacts = [numericFact({ ...current, metric: "sharesOutstanding", label: "Shares outstanding", value: readFirstRaw(keyStats.sharesOutstanding), rawValue: unwrapYahooRaw(keyStats.sharesOutstanding), unit: "shares", rawField: "defaultKeyStatistics.sharesOutstanding" })];
  const estimates = canonicalizeFacts(estimateFacts);
  const diagnostics: FactPackDiagnostics = {
    currentPrice: currentPrice,
    fundamentalsTimeseries: { present: quote.fundamentalsTimeseries !== undefined && quote.fundamentalsTimeseries !== null, rows: timeseriesRows.length, facts: timeseriesFacts.length, diagnostics: [] },
    priceHistory: { present: priceHistoryRows.length > 0, rows: priceHistoryRows.length, facts: priceFacts.length, diagnostics: [] },
    corporateActions: { present: corporateActionRows.length > 0, rows: corporateActionRows.length, facts: actionFacts.length, diagnostics: [] },
    warnings: [...currentPrice.diagnostics],
  };
  const pack: FactPack = {
    ticker: normalizedTicker,
    company: section("company", companyFacts, assetProfile),
    market: section("market", marketFacts, { price, summaryDetail, financialData, keyStats }),
    incomeStatement: section("incomeStatement", incomeFacts, quote.incomeStatementHistory),
    balanceSheet: section("balanceSheet", balanceFacts, quote.balanceSheetHistory),
    cashFlow: section("cashFlow", cashflowFacts, quote.cashflowStatementHistory),
    shares: section("shares", sharesFacts, keyStats),
    earnings: section("earnings", estimates.filter((fact) => fact.metric.startsWith("eps")), quote.earningsTrend),
    estimates: section("estimates", estimates, quote.earningsTrend),
    corporateActions: section("corporateActions", actionFacts, quote.corporateActions ?? quote.netSharePurchaseActivity ?? quote.events),
    priceHistory: section("priceHistory", priceFacts, quote.priceHistory ?? quote.chart),
    fundamentalsTimeseries: section("fundamentalsTimeseries", timeseriesFacts, quote.fundamentalsTimeseries),
    holders: section("holders", holderFacts, {
      majorHoldersBreakdown: quote.majorHoldersBreakdown,
      institutionOwnership: quote.institutionOwnership,
      fundOwnership: quote.fundOwnership,
      insiderHolders: quote.insiderHolders,
    }),
    retrievalTimestamp,
    version: FACT_PACK_VERSION,
    currentPrice,
    ...(currentPrice.value === undefined ? {} : { currentPriceValue: currentPrice.value }),
    currentPriceMetadata: currentPrice,
    priceFreshness: currentPrice,
    freshnessDiagnostics: currentPrice,
    diagnostics,
  };
  const contentHash = hashFactPack(pack);
  const sealed = deepFreeze({
    ...pack,
    factPackId: `FACTPACK-${contentHash.toUpperCase()}`,
    contentHash,
  }) as FactPack;
  if (!verifyFactPack(sealed)) throw new FactPackIntegrityError("Built fact pack failed integrity verification");
  return sealed;
}

export function getCurrentPriceMetadata(
  rawQuoteSummary: Record<string, unknown>,
  ticker: string,
  retrievalTimestamp?: string,
  sourceMetadataOverride?: Partial<Omit<CanonicalSourceMetadata, "taxonomyVersion">>,
): CurrentPriceMetadata {
  const quote = rawQuoteSummary && typeof rawQuoteSummary === "object" ? rawQuoteSummary : {};
  const price = quote.price && typeof quote.price === "object" ? quote.price as Record<string, unknown> : {};
  const metadata = defaultSourceMetadata(sourceMetadataOverride ? { sourceMetadata: sourceMetadataOverride } : {});
  const financialData = quote.financialData && typeof quote.financialData === "object" ? quote.financialData as Record<string, unknown> : {};
  const rawValue = readFirstRaw(price.regularMarketPrice ?? financialData.currentPrice);
  const value = rawValue !== undefined && rawValue > 0 ? rawValue : undefined;
  return currentPriceMetadata({ quote, price, value, retrievalTimestamp: normalizeTimestamp(retrievalTimestamp), sourceId: metadata.sourceId, sourceName: metadata.provider ?? "Yahoo Finance" });
}

export const readCurrentPriceMetadata = getCurrentPriceMetadata;
export const extractCurrentPriceMetadata = getCurrentPriceMetadata;

export function listFactPackFacts(pack: FactPack): readonly Fact[] {
  const byId = new Map<string, Fact>();
  for (const sectionName of factPackSectionNames(pack)) {
    const currentSection = pack[sectionName];
    if (!currentSection) continue;
    for (const fact of currentSection.facts) {
      if (!byId.has(fact.factId ?? "")) byId.set(fact.factId ?? "", fact);
    }
  }
  return Object.freeze([...byId.values()].sort(compareFacts));
}

function factPeriodTimestamp(fact: Fact): number {
  const candidate = fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareLatestFacts(left: Fact, right: Fact): number {
  return factPeriodTimestamp(right) - factPeriodTimestamp(left)
    || canonicalObservationRank(left) - canonicalObservationRank(right)
    || compareStableStrings(right.reportingPeriod ?? right.fiscalPeriod ?? right.period, left.reportingPeriod ?? left.fiscalPeriod ?? left.period)
    || compareStableStrings(left.factId ?? "", right.factId ?? "");
}

export function selectLatestFacts(pack: FactPack, metric: string, limit = 1): readonly Fact[] {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError("Fact selection limit must be a non-negative integer");
  return Object.freeze(listFactPackFacts(pack)
    .filter((fact) => fact.metric === metric && factHasValue(fact))
    .sort(compareLatestFacts)
    .slice(0, limit));
}

export function selectLatestFact(pack: FactPack, metric: string): Fact | undefined {
  return selectLatestFacts(pack, metric, 1)[0];
}

export const selectLatestPeriodFact = selectLatestFact;
export const extractFundamentalsTimeseries = readTimeseriesRows;
export const readFundamentalsTimeseries = readTimeseriesRows;

export function selectLatestPeriodFacts(pack: FactPack, period?: string): readonly Fact[] {
  const available = listFactPackFacts(pack).filter(factHasValue);
  if (available.length === 0) return Object.freeze([]);
  if (period !== undefined) {
    const normalized = requiredText(period, "period");
    return Object.freeze(available.filter((fact) => (fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period) === normalized).sort(compareFacts));
  }
  const latestTimestamp = Math.max(...available.map(factPeriodTimestamp));
  return Object.freeze(available
    .filter((fact) => factPeriodTimestamp(fact) === latestTimestamp)
    .sort(compareFacts));
}

export function renderFactContext(pack: FactPack, sectionNames?: string[]): string {
  const wanted = new Set(sectionNames ?? []);
  const lines = [
    `CANONICAL FACT PACK — ticker ${pack.ticker} (yfinance, retrieved ${pack.retrievalTimestamp}).`,
    "These are the ONLY historical numbers you may use. Never invent data.",
    "",
  ];
  const sections = factPackSectionNames(pack)
    .map((sectionName) => pack[sectionName])
    .filter((currentSection): currentSection is FactSection => Boolean(currentSection))
    .filter((currentSection) => currentSection.name !== "priceHistory" && currentSection.name !== "corporateActions");
  for (const currentSection of sections) {
    if (wanted.size > 0 && !wanted.has(currentSection.name)) continue;
    if (currentSection.facts.length === 0) continue;
    lines.push(`## ${currentSection.name}`);
    for (const fact of currentSection.facts) {
      const value = fact.textValue !== undefined
        ? fact.textValue
        : fact.value !== undefined
          ? String(fact.value)
          : "Not available from yfinance";
      const unit = fact.unit ? ` ${fact.unit}` : "";
      const canonicalId = fact.factId ?? `F-${fact.metric}`;
      const legacyId = `F-${fact.metric}`;
      const compatibility = canonicalId === legacyId ? "" : ` (legacy [${legacyId}])`;
      lines.push(`- [${canonicalId}] ${fact.label}${unit} (${fact.period}): ${value}${compatibility}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
