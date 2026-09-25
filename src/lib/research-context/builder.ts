import { fetchQuoteSummary, parseQuoteSummary } from "@/lib/yahoo-finance";
import { fetchFxRate, normalizeCrossListing, type CrossListingInfo } from "@/lib/cross-listing";
import { buildFactPack, hashFactPack, verifyFactPack } from "@/lib/ai-first/fact-pack";
import type { CurrentPriceMetadata, FactPack } from "@/lib/ai-first/types";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import { stableHash } from "@/lib/research-ledger/stable";
import type {
  AnnualFinancials,
  CompanyProfile,
  QuarterlyFinancials,
  ShareholdingData,
  StockData,
} from "@/types/report";

export const RESEARCH_SOURCE_CONTEXT_VERSION = "research-source-context-v1";

export interface ResearchSourceSnapshot {
  provider: "yahoo-finance";
  ticker: string;
  fetchedAt: string;
  dataCutoff: string;
  quoteSummary: Record<string, unknown>;
  fundamentalsTimeseries: Record<string, unknown> | null;
  snapshotHash: string;
}

export interface ResearchCurrencyBasis {
  reportingCurrency: string | null;
  tradingCurrency: string | null;
  normalizedCurrency: string | null;
  fxReportingToTrading: number;
  fxSource: string | null;
  shareBasis: string;
  depositaryRatio: number;
  normalized: boolean;
  blocked: boolean;
  notes: string[];
}

export interface NormalizedResearchSourceContext {
  version: typeof RESEARCH_SOURCE_CONTEXT_VERSION;
  schemaVersion: typeof RESEARCH_SOURCE_CONTEXT_VERSION;
  ticker: string;
  dataCutoff: string;
  retrievedAt: string;
  sourceSnapshotHash: string;
  source: ResearchSourceSnapshot;
  pipelineQuoteSummary: Record<string, unknown>;
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  quarterlyFinancials: QuarterlyFinancials[];
  shareholding: ShareholdingData;
  factPack: FactPack;
  currentPriceMetadata?: CurrentPriceMetadata;
  currencyBasis: ResearchCurrencyBasis;
  news: [];
  fetchCounts: {
    quote: number;
    timeseries: number;
  };
}

export interface ResearchSourceFetchers {
  fetchSnapshot?: (ticker: string) => Promise<Record<string, unknown>>;
  fetchQuote?: (ticker: string) => Promise<Record<string, unknown>>;
  fetchTimeseries?: (ticker: string) => Promise<Record<string, unknown> | null>;
  fetchFxRate?: typeof fetchFxRate;
}

export interface BuildResearchSourceContextOptions extends ResearchSourceFetchers {
  ticker: string;
  retrievalTimestamp?: string;
  dataCutoff?: string;
}

function isoTimestamp(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("retrievalTimestamp must be a valid timestamp");
  return new Date(parsed).toISOString();
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function numericValue(value: unknown): number | null {
  if (value && typeof value === "object" && "raw" in value) {
    return numericValue((value as { raw?: unknown }).raw);
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match && Number.isFinite(Date.parse(match[0]))) return match[0];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return dateFromUnknown(record.raw) ?? dateFromUnknown(record.fmt);
  }
  return null;
}

function inferDataCutoff(raw: Record<string, unknown>, fallback: string): string {
  const candidates: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["regularMarketTime", "endDate", "reportDate", "asOfDate", "publishedAt", "date", "timestamp", "datetime"]) {
      const date = dateFromUnknown(record[key]);
      if (date) candidates.push(date);
    }
    for (const [key, entry] of Object.entries(record)) {
      if (/raw|fmt|value|price|close|open|high|low|volume/i.test(key)) continue;
      visit(entry, depth + 1);
    }
  };
  visit(raw, 0);
  candidates.sort();
  return candidates.at(-1) ?? fallback.slice(0, 10);
}

function extractTimeseries(raw: Record<string, unknown>): Record<string, unknown> | null {
  const value = raw.fundamentalsTimeseries;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function withoutTimeseries(raw: Record<string, unknown>): Record<string, unknown> {
  const { fundamentalsTimeseries: _ignored, ...quote } = raw;
  return quote;
}

function hashSnapshot(raw: Record<string, unknown>): string {
  const serializable = JSON.stringify(raw, (_key, value) => typeof value === "number" && !Number.isFinite(value) ? null : value);
  const normalized = serializable ? JSON.parse(serializable) as Record<string, unknown> : {};
  return stableHash(normalized, "research-package/source-snapshot/v1");
}

function identityBasis(profile: CompanyProfile): ResearchCurrencyBasis {
  const reportingCurrency = textValue(profile.reportingCurrency ?? profile.currency);
  const tradingCurrency = textValue(profile.tradingCurrency ?? profile.currency);
  const normalizedCurrency = tradingCurrency ?? reportingCurrency;
  return {
    reportingCurrency,
    tradingCurrency,
    normalizedCurrency,
    fxReportingToTrading: 1,
    fxSource: "identity",
    shareBasis: "provider-reported",
    depositaryRatio: 1,
    normalized: Boolean(normalizedCurrency),
    blocked: !normalizedCurrency,
    notes: normalizedCurrency ? [] : ["Currency is unavailable; normalized basis is unavailable."],
  };
}

function rowWithValues(row: AnnualFinancials): Record<string, unknown> {
  const source = row as unknown as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "year" || key === "fiscalYearEnd" || key === "estimatesUsed") continue;
    if (typeof value === "number" && Number.isFinite(value)) values[key] = { raw: value, fmt: String(value) };
    if (typeof value === "string" && key === "statementType") values[key] = value;
  }
  const date = source.fiscalYearEnd ?? source.year;
  values.endDate = { raw: date, fmt: date };
  return values;
}

function normalizedPipelinePayload(
  raw: Record<string, unknown>,
  annualFinancials: AnnualFinancials[],
  quarterlyFinancials: QuarterlyFinancials[],
  profile: CompanyProfile,
): Record<string, unknown> {
  const payload = structuredClone(raw);
  const timeseries = extractTimeseries(raw);
  if (timeseries) payload.fundamentalsTimeseries = structuredClone(timeseries);
  const incomeRows = annualFinancials.map(rowWithValues);
  const balanceRows = annualFinancials.map(rowWithValues);
  const cashRows = annualFinancials.map(rowWithValues);
  payload.incomeStatementHistory = { incomeStatementHistory: incomeRows };
  payload.balanceSheetHistory = { balanceSheetHistory: balanceRows };
  payload.cashflowStatementHistory = { cashflowStatements: cashRows };
  payload.incomeStatementHistoryQuarterly = { incomeStatementHistory: quarterlyFinancials.map((row) => {
    const value = row as unknown as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "number" && Number.isFinite(entry)) output[key] = { raw: entry, fmt: String(entry) };
    }
    output.endDate = { raw: value.endDate ?? value.period, fmt: value.endDate ?? value.period };
    return output;
  }) };
  payload.financialData = {
    ...(payload.financialData && typeof payload.financialData === "object" ? payload.financialData : {}),
    financialCurrency: profile.currency,
  };
  return payload;
}

function annotateCrossListingFactPack(pack: FactPack, basis: ResearchCurrencyBasis): FactPack {
  if (!basis.reportingCurrency || !basis.tradingCurrency || basis.fxReportingToTrading === 1) return pack;
  const mutable = structuredClone(pack) as FactPack;
  const sectionNames = ["company", "market", "incomeStatement", "balanceSheet", "cashFlow", "shares", "earnings", "estimates", "corporateActions", "priceHistory", "holders", "fundamentalsTimeseries"] as const;
  for (const sectionName of sectionNames) {
    const currentSection = mutable[sectionName];
    if (!currentSection) continue;
    for (const fact of currentSection.facts) {
      fact.currencyConversion = {
        fromCurrency: basis.reportingCurrency,
        toCurrency: basis.tradingCurrency,
        rate: basis.fxReportingToTrading,
        method: basis.fxSource ?? "cross-listing-fx",
        applied: true,
      };
      fact.shareBasisConversion = {
        fromBasis: "provider-reported",
        toBasis: basis.depositaryRatio === 1 ? "trading" : "depositary-restated",
        factor: basis.depositaryRatio,
        method: basis.depositaryRatio === 1 ? "identity" : "cross-listing-depositary-ratio",
        applied: basis.depositaryRatio !== 1,
      };
      if (fact.normalization) {
        fact.normalization = {
          ...fact.normalization,
          method: "cross-listing-normalization",
          scaleFactor: basis.fxReportingToTrading * (fact.unit === "shares" ? basis.depositaryRatio : 1),
          currencyConversion: fact.currencyConversion,
          shareBasisConversion: fact.shareBasisConversion,
        };
      }
    }
  }
  const contentHash = hashFactPack(mutable);
  mutable.contentHash = contentHash;
  mutable.factPackId = `FACTPACK-${contentHash.toUpperCase()}`;
  const sealed = deepFreeze(mutable) as FactPack;
  if (!verifyFactPack(sealed)) throw new TypeError("Cross-listing FactPack failed integrity verification");
  return sealed;
}

async function fetchSource(options: BuildResearchSourceContextOptions): Promise<{ raw: Record<string, unknown>; quoteCount: number; timeseriesCount: number }> {
  if (options.fetchSnapshot) {
    return { raw: await options.fetchSnapshot(options.ticker), quoteCount: 1, timeseriesCount: 1 };
  }
  if (options.fetchQuote || options.fetchTimeseries) {
    const quotePromise = options.fetchQuote ? options.fetchQuote(options.ticker) : Promise.resolve(null);
    const timeseriesPromise = options.fetchTimeseries ? options.fetchTimeseries(options.ticker) : Promise.resolve(null);
    const [quote, timeseries] = await Promise.all([quotePromise, timeseriesPromise]);
    const raw = quote ? { ...quote } : {};
    if (timeseries) raw.fundamentalsTimeseries = timeseries;
    return { raw, quoteCount: quote ? 1 : 0, timeseriesCount: timeseries ? 1 : 0 };
  }
  return { raw: await fetchQuoteSummary(options.ticker), quoteCount: 1, timeseriesCount: 1 };
}

export async function buildResearchSourceContext(options: BuildResearchSourceContextOptions): Promise<NormalizedResearchSourceContext> {
  const ticker = options.ticker.trim().toUpperCase();
  if (!ticker) throw new TypeError("ticker is required");
  const retrievedAt = isoTimestamp(options.retrievalTimestamp);
  const fetched = await fetchSource({ ...options, ticker });
  const raw = fetched.raw && typeof fetched.raw === "object" ? fetched.raw : {};
  const parsed = parseQuoteSummary(raw, ticker);
  let profile: CompanyProfile = parsed.companyProfile as CompanyProfile;
  let annualFinancials = [...parsed.annualFinancials];
  let quarterlyFinancials = [...parsed.quarterlyFinancials];
  let currencyBasis = identityBasis(profile);
  const reportingCurrency = textValue(profile.reportingCurrency ?? profile.currency);
  const tradingCurrency = textValue(profile.tradingCurrency ?? profile.currency);
  if (reportingCurrency && tradingCurrency && reportingCurrency !== tradingCurrency) {
    const fxFetcher = options.fetchFxRate ?? fetchFxRate;
    const fx = await fxFetcher(reportingCurrency, tradingCurrency);
    if (fx && fx.rate > 0 && Number.isFinite(fx.rate)) {
      const normalized = normalizeCrossListing({
        annualFinancials,
        quarterlyFinancials,
        quoteShares: parsed.stockData.sharesOutstanding > 0 ? parsed.stockData.sharesOutstanding : null,
        reportingCurrency,
        tradingCurrency,
        fxReportingToTrading: fx.rate,
        fxSource: fx.source,
      });
      annualFinancials = normalized.annualFinancials;
      quarterlyFinancials = normalized.quarterlyFinancials ?? quarterlyFinancials;
      const info: CrossListingInfo = normalized.info;
      currencyBasis = {
        reportingCurrency,
        tradingCurrency,
        normalizedCurrency: tradingCurrency,
        fxReportingToTrading: info.fxReportingToTrading,
        fxSource: info.fxSource,
        shareBasis: info.depositaryRatio === 1 ? "provider-reported" : "depositary-restated",
        depositaryRatio: info.depositaryRatio,
        normalized: true,
        blocked: false,
        notes: info.notes,
      };
      profile = {
        ...profile,
        currency: tradingCurrency,
        reportingCurrency,
        tradingCurrency,
        fxReportingToTrading: info.fxReportingToTrading,
        fxSource: info.fxSource,
        depositaryRatio: info.depositaryRatio,
        crossListingNote: info.notes.join(" "),
      } as CompanyProfile;
    } else {
      currencyBasis = {
        ...currencyBasis,
        normalizedCurrency: null,
        normalized: false,
        blocked: true,
        notes: ["Cross-listing FX unavailable; normalized basis is unavailable."],
      };
    }
  }
  const dataCutoff = options.dataCutoff ?? inferDataCutoff(raw, retrievedAt);
  const pipelinePayload = currencyBasis.normalized && currencyBasis.fxReportingToTrading !== 1
    ? normalizedPipelinePayload(raw, annualFinancials, quarterlyFinancials, profile)
    : structuredClone(raw);
  const factPack = annotateCrossListingFactPack(buildFactPack(pipelinePayload, ticker, { retrievalTimestamp: retrievedAt }), currencyBasis);
  const quoteSummary = withoutTimeseries(raw);
  const timeseries = extractTimeseries(raw);
  const source: ResearchSourceSnapshot = {
    provider: "yahoo-finance",
    ticker,
    fetchedAt: retrievedAt,
    dataCutoff,
    quoteSummary,
    fundamentalsTimeseries: timeseries,
    snapshotHash: hashSnapshot(raw),
  };
  return deepFreeze({
    version: RESEARCH_SOURCE_CONTEXT_VERSION,
    schemaVersion: RESEARCH_SOURCE_CONTEXT_VERSION,
    ticker,
    dataCutoff,
    retrievedAt,
    sourceSnapshotHash: source.snapshotHash,
    source,
    pipelineQuoteSummary: pipelinePayload,
    profile,
    stockData: parsed.stockData,
    annualFinancials,
    quarterlyFinancials,
    shareholding: parsed.shareholding,
    factPack,
    ...(factPack.currentPriceMetadata ? { currentPriceMetadata: factPack.currentPriceMetadata } : {}),
    currencyBasis,
    news: [],
    fetchCounts: {
      quote: fetched.quoteCount,
      timeseries: fetched.timeseriesCount,
    },
  }) as NormalizedResearchSourceContext;
}

export async function buildResearchSourceContextForTicker(ticker: string, options: Omit<BuildResearchSourceContextOptions, "ticker"> = {}): Promise<NormalizedResearchSourceContext> {
  return buildResearchSourceContext({ ...options, ticker });
}

export const buildSourceContext = buildResearchSourceContext;
export const createSourceContext = buildResearchSourceContext;
export const buildResearchContext = buildResearchSourceContext;
export const buildNormalizedSourceContext = buildResearchSourceContext;
export type ResearchSourceContext = NormalizedResearchSourceContext;
