import { compareStableStrings, createStableId, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import type { ResearchDocumentEvidence, ResearchRetrievalResult } from "@/lib/research-retrieval/types";
import {
  MANAGEMENT_CREDIBILITY_VERSION,
  MAXIMUM_CREDIBILITY_SCORE,
  type BuildManagementCredibilityLedgerInput,
  type CredibilityBand,
  type ManagementActual,
  type ManagementBias,
  type ManagementCredibilityEntry,
  type ManagementCredibilityLedger,
  type ManagementCredibilityStatus,
  type ManagementPromise,
  type ManagementPromiseDirection,
  type ManagementPromiseInput,
  type ManagementPromiseSourceType,
  type ManagementPromiseStatus,
} from "./types";

const CREDIBILITY_DOMAIN = "management-credibility/ledger/v1";
const DEFAULT_MINIMUM_SAMPLE = 3;
const MAX_MISS_PENALTY = 0.25;
const PROMPT_PATTERN = /\b(we (?:expect|anticipate|forecast|target|guide|plan to|aim)|guidance|outlook|target of|we project)\b/i;
const TARGET_PATTERN = /(?:~|approximately|about|around)?\s*([+-]?\d+(?:\.\d+)?)\s*(%|x|bn|mn|cr|million|billion)?/gi;

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function margin(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return round6(numerator / Math.abs(denominator));
}

function metricKindOf(metric: string): ManagementPromise["metricKind"] {
  const value = metric.toLowerCase();
  if (/revenue|sales|turnover|top ?line/.test(value)) return "revenue";
  if (/ebit|operating ?profit|operating ?income/.test(value)) return "ebit";
  if (/margin/.test(value)) return "margin";
  if (/eps|earnings per share|diluted/.test(value)) return "eps";
  if (/capex|capital expenditure/.test(value)) return "capex";
  if (/dividend|payout/.test(value)) return "dividend";
  if (/roic|return on invested/.test(value)) return "roic";
  return "custom";
}

function directionOf(kind: ManagementPromise["metricKind"]): ManagementPromiseDirection {
  if (kind === "capex") return "lower-better";
  if (kind === "dividend") return "two-sided";
  return "higher-better";
}

function periodEndYear(period: string): number | null {
  const match = period.match(/(\d{4})/);
  if (!match) return null;
  return Number(match[1]);
}

function isElapsed(period: string, asOf: string): boolean {
  const endYear = periodEndYear(period);
  const asOfYear = periodEndYear(asOf);
  if (endYear === null || asOfYear === null) return false;
  return asOfYear > endYear;
}

export function normalizeManagementPromise(input: ManagementPromiseInput, index: number): ManagementPromise {
  const metric = String(input.metric ?? "").trim() || "unnamed-metric";
  const period = String(input.period ?? "").trim() || "unknown";
  const target = input.target;
  const id = String(input.id ?? "").trim() || createStableId("MPROMISE", {
    metric,
    period,
    target,
    issuedAt: input.issuedAt,
    source: input.source,
    index,
  }, CREDIBILITY_DOMAIN);
  const low = typeof input.low === "number" && Number.isFinite(input.low) ? input.low : null;
  const high = typeof input.high === "number" && Number.isFinite(input.high) ? input.high : null;
  const metricKind = input.metricKind ?? metricKindOf(metric);
  return {
    id,
    metric,
    metricKind,
    direction: input.direction ?? directionOf(metricKind),
    unit: String(input.unit ?? "").trim() || "unitless",
    period,
    target,
    ...(low === null ? {} : { low }),
    ...(high === null ? {} : { high }),
    issuedAt: input.issuedAt,
    source: String(input.source ?? "").trim() || "unavailable",
    sourceType: input.sourceType ?? "other",
    text: String(input.text ?? "").trim(),
    status: input.status ?? "pending",
    supersedesId: input.supersedesId ?? null,
    evidenceIds: [...new Set((input.evidenceIds ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort(compareStableStrings),
  };
}

function bandOf(score: number | null): CredibilityBand {
  if (score === null) return "unverified";
  if (score >= 0.8) return "strong";
  if (score >= 0.6) return "credible";
  if (score >= 0.4) return "mixed";
  return "weak";
}

function promiseRange(promise: ManagementPromise): { low: number; high: number } {
  const low = promise.low ?? promise.target;
  const high = promise.high ?? promise.target;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function resolveEntry(input: {
  readonly promise: ManagementPromise;
  readonly actual: ManagementActual | undefined;
  readonly asOf: string;
}): ManagementCredibilityEntry {
  const promise = input.promise;
  const range = promiseRange(promise);
  const actual = input.actual;
  const evidenceIds = [...new Set([...promise.evidenceIds, ...(actual?.evidenceIds ?? [])])].sort(compareStableStrings);
  if (!actual || !Number.isFinite(actual.actual)) {
    const retired = promise.status === "withdrawn" || promise.status === "superseded";
    const elapsed = isElapsed(promise.period, input.asOf);
    const status: ManagementPromiseStatus = retired ? promise.status : elapsed && promise.status === "pending" ? "unverified" : promise.status;
    return {
      promise: { ...promise, status },
      outcome: {
        status: "unmeasured",
        actual: null,
        variance: null,
        variancePct: null,
        withinRange: null,
        source: null,
        factIds: Object.freeze([]) as readonly string[],
        evidenceIds,
      },
      hit: null,
      score: null,
      band: "unverified",
      confidence: 0,
      note: retired
        ? `the promise was ${status} before an actual is on record, so it is excluded from the hit rate`
        : elapsed
          ? `the promised period has elapsed with no matching actual on record, so this promise stays unverified rather than being scored as a miss`
          : "the promised period has not yet elapsed, so this promise is pending and carries no score",
    };
  }
  const ranged = promise.low !== undefined && promise.high !== undefined;
  const withinRange = ranged
    ? actual.actual >= (promiseRange(promise).low) && actual.actual <= (promiseRange(promise).high)
    : promise.direction === "higher-better"
      ? actual.actual >= promise.target
      : promise.direction === "lower-better"
        ? actual.actual <= promise.target
        : margin(actual.actual - promise.target, promise.target) !== null && Math.abs(margin(actual.actual - promise.target, promise.target) as number) <= 0.05;
  const variance = round6(actual.actual - promise.target);
  const variancePct = margin(variance, promise.target);
  const magnitude = Math.abs(variancePct ?? 0);
  const score = withinRange
    ? MAXIMUM_CREDIBILITY_SCORE
    : round6(Math.max(0, Math.min(0.55, 0.4 - magnitude / 2)));
  const target = promiseRange(promise);
  const targetText = target.low === target.high ? `${round6(target.low)}` : `${round6(target.low)}-${round6(target.high)}`;
  return {
    promise: { ...promise, status: withinRange ? "met" : "missed" },
    outcome: {
      status: "measured",
      actual: round6(actual.actual),
      variance,
      variancePct,
      withinRange,
      source: actual.source,
      factIds: [...(actual.factIds ?? [])].sort(compareStableStrings),
      evidenceIds,
    },
    hit: withinRange,
    score,
    band: bandOf(score),
    confidence: 1,
    note: `actual ${round6(actual.actual)} against a ${target} target in ${promise.period}: ${withinRange ? "met" : `missed by ${variancePct === null ? "an unmeasurable margin" : `${round6(magnitude * 100).toFixed(1)}%`}`}`,
  };
}

function biasOf(entries: readonly ManagementCredibilityEntry[]): ManagementBias {
  const measured = entries.filter((entry) => entry.outcome.variancePct !== null);
  if (measured.length < 2) return "unknown";
  const mean = measured.reduce((total, entry) => total + (entry.outcome.variancePct ?? 0), 0) / measured.length;
  if (mean <= -0.05) return "over-optimistic";
  if (mean >= 0.05) return "over-cautious";
  return "balanced";
}

export function buildManagementCredibilityLedger(input: BuildManagementCredibilityLedgerInput): ManagementCredibilityLedger {
  const subjectId = (input.subjectId ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const generatedAt = input.generatedAt ?? "unknown";
  const minimumSample = Math.max(1, Math.trunc(input.minimumSampleForScore ?? DEFAULT_MINIMUM_SAMPLE));
  const promises = (input.promises ?? []).map((promise, index) => normalizeManagementPromise(promise, index));
  const actuals = new Map<string, ManagementActual>();
  for (const actual of input.actuals ?? []) {
    if (!Number.isFinite(actual.actual)) continue;
    actuals.set(actual.promiseId, actual);
  }
  const entries = promises
    .map((promise) => resolveEntry({ promise, actual: actuals.get(promise.id), asOf: generatedAt }))
    .sort((left, right) => compareStableStrings(left.promise.issuedAt, right.promise.issuedAt) || left.promise.id.localeCompare(right.promise.id));
  const resolved = entries.filter((entry) => entry.hit !== null);
  const met = resolved.filter((entry) => entry.hit === true).length;
  const missed = resolved.filter((entry) => entry.hit === false).length;
  const withdrawn = entries.filter((entry) => entry.promise.status === "withdrawn" || entry.promise.status === "superseded").length;
  const unverified = entries.length - resolved.length - withdrawn;
  const hitRate = resolved.length > 0 ? round6(met / resolved.length) : null;
  const sampleConfidence = resolved.length === 0 ? 0 : Math.min(1, resolved.length / minimumSample);
  const averageVariance = resolved.length > 0
    ? resolved.reduce((total, entry) => total + (entry.outcome.variancePct ?? 0), 0) / resolved.length
    : 0;
  const magnitudePenalty = Math.min(MAX_MISS_PENALTY, Math.abs(averageVariance) / 4);
  const status: ManagementCredibilityStatus = resolved.length === 0 ? "UNVERIFIED" : "VERIFIED";
  const score = status === "UNVERIFIED" ? null : round6(Math.max(0, Math.min(MAXIMUM_CREDIBILITY_SCORE, (hitRate as number) - magnitudePenalty)));
  const confidence = status === "UNVERIFIED" ? 0 : round6(sampleConfidence * (score as number));
  const diagnostics: string[] = [];
  if (status === "UNVERIFIED") {
    diagnostics.push(promises.length === 0 ? "MANAGEMENT_PROMISES_UNAVAILABLE" : "MANAGEMENT_PROMISES_UNRESOLVED");
  }
  if (status === "VERIFIED" && resolved.length < minimumSample) diagnostics.push("MANAGEMENT_SAMPLE_THIN");
  if (missed > 0) diagnostics.push(`MANAGEMENT_MISSES:${missed}`);
  if (unverified > 0) diagnostics.push(`MANAGEMENT_UNVERIFIED_COUNT:${unverified}`);
  const streakValues: number[] = [...resolved].reverse().map((entry) => (entry.hit ? 1 : 0));
  let currentStreak: number | null = null;
  if (streakValues.length > 0) {
    const latest = streakValues[0] as number;
    let length = 0;
    for (const value of streakValues) {
      if (value !== latest) break;
      length += 1;
    }
    currentStreak = length;
  }
  const midpoint = Math.ceil(streakValues.length / 2);
  const earlyRate = streakValues.length === 0 ? null : streakValues.slice(0, midpoint).reduce((total, value) => total + value, 0) / midpoint;
  const lateRate = streakValues.length === 0 ? null : streakValues.slice(midpoint).reduce((total, value) => total + value, 0) / Math.max(1, streakValues.length - midpoint);
  const direction = earlyRate === null || lateRate === null
    ? "unknown"
    : lateRate > earlyRate
      ? "improving"
      : lateRate < earlyRate
        ? "declining"
        : "stable";
  const content = {
    version: MANAGEMENT_CREDIBILITY_VERSION,
    subjectId,
    status,
    reason: status === "UNVERIFIED"
      ? promises.length === 0
        ? "no dated management KPI promise is on record, so management credibility is UNVERIFIED and unscored"
        : `${promises.length} dated promise(s) are on record but none has a matching actual, so management credibility is UNVERIFIED and unscored`
      : `${resolved.length} of ${promises.length} promise(s) resolved against a reported actual at a ${round6((hitRate as number) * 100).toFixed(1)}% hit rate, capped at ${MAXIMUM_CREDIBILITY_SCORE}`,
    generatedAt,
    observations: Object.freeze(entries),
    score,
    confidence,
    band: bandOf(score),
    bias: biasOf(entries),
    hitRate,
    counts: {
      promises: promises.length,
      resolved: resolved.length,
      met,
      missed,
      withdrawn,
      unverified: Math.max(0, unverified),
    },
    streak: { current: currentStreak, direction },
    diagnostics: Object.freeze([...new Set(diagnostics)].sort(compareStableStrings)),
    evidenceIds: Object.freeze([...new Set([...(input.evidenceIds ?? []), ...entries.flatMap((entry) => [...entry.promise.evidenceIds, ...entry.outcome.evidenceIds])])].sort(compareStableStrings)),
  } satisfies Omit<ManagementCredibilityLedger, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, CREDIBILITY_DOMAIN) }) as ManagementCredibilityLedger;
}

export interface ExtractedManagementPromise {
  readonly promise: ManagementPromiseInput;
  readonly documentId: string;
  readonly evidenceId: string;
  readonly quote: string;
}

function sourceTypeFor(value: string): ManagementPromiseSourceType {
  if (value === "earnings_call") return "earnings_call";
  if (value === "investor_presentation") return "investor_presentation";
  if (value === "exchange_filing" || value === "regulatory_filing") return "exchange_filing";
  if (value === "annual_report") return "annual_report";
  if (value === "news") return "press_release";
  return "other";
}

function isGuidanceStatement(evidence: ResearchDocumentEvidence): evidence is Extract<ResearchDocumentEvidence, { statementType: string }> {
  return "statementType" in evidence;
}

export function extractManagementPromises(retrieval: ResearchRetrievalResult | null | undefined): readonly ExtractedManagementPromise[] {
  const out: ExtractedManagementPromise[] = [];
  for (const document of retrieval?.documents ?? []) {
    for (const evidence of document.evidence) {
      if (!isGuidanceStatement(evidence) || evidence.statementType !== "management_guidance") continue;
      const text = evidence.text ?? "";
      if (!PROMPT_PATTERN.test(text)) continue;
      const metricMatch = text.match(/\b(revenue|sales|ebit|operating income|operating profit|margin|eps|earnings per share|capex|capital expenditure|dividend|roic)\b/i);
      const metric = metricMatch?.[1] ?? "unnamed-metric";
      TARGET_PATTERN.lastIndex = 0;
      const values: number[] = [];
      let match: RegExpExecArray | null = TARGET_PATTERN.exec(text);
      while (match !== null) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed)) values.push(parsed);
        match = TARGET_PATTERN.exec(text);
      }
      if (values.length === 0) continue;
      const asOf = evidence.asOf ?? document.publication.asOfDate ?? document.publication.publishedAt ?? document.retrieval.retrievedAt;
      out.push({
        promise: {
          metric,
          period: (asOf ?? "").slice(0, 4) || "unknown",
          target: values[0] as number,
          issuedAt: asOf ?? "unknown",
          source: document.title,
          sourceType: sourceTypeFor(document.sourceType),
          text: text.slice(0, 400),
          unit: /margin|%/i.test(metric) ? "pct" : "unitless",
          evidenceIds: [evidence.id],
        },
        documentId: document.documentId,
        evidenceId: evidence.id,
        quote: text.slice(0, 400),
      });
    }
  }
  return out.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

export const buildManagementCredibility = buildManagementCredibilityLedger;
export const managementCredibilityLedger = buildManagementCredibilityLedger;
export const MANAGEMENT_PROMISE_STATUSES: readonly ManagementPromiseStatus[] = Object.freeze([
  "pending",
  "met",
  "missed",
  "withdrawn",
  "unverified",
  "superseded",
] as const);
