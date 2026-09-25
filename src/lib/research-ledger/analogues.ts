import { verifyResearchEvent, verifyResearchLedgerEvent } from "./events";
import { deepFreeze } from "./immutable";
import { compareStableStrings } from "./stable";
import type { ResearchEvent, ResearchLedgerEvent } from "./types";

export interface AnalogueRankingOptions {
  readonly minimumSamples?: number;
  readonly limit?: number;
  readonly minimumScore?: number;
}

export interface AnalogueScoreComponents {
  readonly eventType: number;
  readonly tags: number;
  readonly text: number;
}

export interface AnalogueRanking {
  readonly rank: number;
  readonly event: ResearchEvent | ResearchLedgerEvent;
  readonly score: number;
  readonly components: AnalogueScoreComponents;
}

export type AnalogueRankingStatus = "ranked" | "insufficient-samples" | "below-threshold";

export interface AnalogueRankingResult {
  readonly status: AnalogueRankingStatus;
  readonly accepted: boolean;
  readonly reason: "ranked" | "insufficient-samples" | "minimum-score-not-met";
  readonly companyId: string;
  readonly targetEventId: string;
  readonly sameCompanySampleCount: number;
  readonly qualifiedSampleCount: number;
  readonly requiredMinimumSamples: number;
  readonly minimumScore: number;
  readonly rankings: readonly AnalogueRanking[];
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new RangeError(`${field} must be a positive integer`);
  return normalized;
}

function score(value: number): number {
  return Number(value.toFixed(6));
}

function tokenize(value: string): ReadonlySet<string> {
  const matches = value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(matches);
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function tagsOf(event: ResearchEvent | ResearchLedgerEvent): ReadonlySet<string> {
  return new Set(event.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
}

function similarity(
  target: ResearchEvent | ResearchLedgerEvent,
  candidate: ResearchEvent | ResearchLedgerEvent,
): { score: number; components: AnalogueScoreComponents } {
  const components: AnalogueScoreComponents = {
    eventType: target.type === candidate.type ? 30 : 0,
    tags: jaccard(tagsOf(target), tagsOf(candidate)) * 30,
    text: jaccard(tokenize(target.summary), tokenize(candidate.summary)) * 40,
  };
  return {
    score: score(components.eventType + components.tags + components.text),
    components,
  };
}

function comparableEvent(event: ResearchEvent | ResearchLedgerEvent): ResearchEvent | ResearchLedgerEvent {
  if (!verifyResearchEvent(event)) throw new TypeError("Every analogue event must pass integrity verification");
  if ("sequence" in event && !verifyResearchLedgerEvent(event)) {
    throw new TypeError("Every ledger analogue event must pass chain integrity verification");
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) throw new TypeError("Every analogue event must have a valid occurredAt");
  if (!Array.isArray(event.tags) || typeof event.summary !== "string") throw new TypeError("Every analogue event must have tags and a summary");
  return event;
}

export function rankSameCompanyAnalogues(
  target: ResearchEvent | ResearchLedgerEvent,
  events: readonly (ResearchEvent | ResearchLedgerEvent)[],
  options: AnalogueRankingOptions = {},
): AnalogueRankingResult {
  const targetEvent = comparableEvent(target);
  if (!Array.isArray(events)) throw new TypeError("Analogue events must be an array");
  const minimumSamples = positiveInteger(options.minimumSamples, 3, "minimumSamples");
  const limit = positiveInteger(options.limit, 5, "limit");
  const minimumScore = options.minimumScore ?? 0;
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 100) {
    throw new RangeError("minimumScore must be between 0 and 100");
  }
  const companyId = targetEvent.companyId.trim().toLowerCase();
  const byId = new Map<string, ResearchEvent | ResearchLedgerEvent>();
  for (const rawEvent of events) {
    const event = comparableEvent(rawEvent);
    const existing = byId.get(event.eventId);
    if (existing && existing.contentHash !== event.contentHash) {
      throw new Error(`Analogue event ID collision for ${event.eventId}`);
    }
    byId.set(event.eventId, event);
  }
  const sameCompany = [...byId.values()].filter((event) => (
    event.eventId !== targetEvent.eventId
    && event.companyId.trim().toLowerCase() === companyId
  ));
  const scored = sameCompany.map((event) => ({ event, ...similarity(targetEvent, event) }));
  const qualified = scored.filter((candidate) => candidate.score >= minimumScore);
  let status: AnalogueRankingStatus;
  let reason: AnalogueRankingResult["reason"];
  if (sameCompany.length < minimumSamples) {
    status = "insufficient-samples";
    reason = "insufficient-samples";
  } else if (qualified.length < minimumSamples) {
    status = "insufficient-samples";
    reason = "minimum-score-not-met";
  } else {
    status = "ranked";
    reason = "ranked";
  }
  const ordered = qualified.sort((left, right) => {
    const scoreOrder = right.score - left.score;
    if (scoreOrder !== 0) return scoreOrder;
    const timeOrder = Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt);
    if (timeOrder !== 0) return timeOrder;
    return compareStableStrings(left.event.eventId, right.event.eventId);
  });
  const rankings = status === "ranked"
    ? ordered.slice(0, limit).map((candidate, index) => ({
      rank: index + 1,
      event: candidate.event,
      score: candidate.score,
      components: candidate.components,
    }))
    : [];
  return deepFreeze({
    status,
    accepted: status === "ranked",
    reason,
    companyId,
    targetEventId: targetEvent.eventId,
    sameCompanySampleCount: sameCompany.length,
    qualifiedSampleCount: qualified.length,
    requiredMinimumSamples: minimumSamples,
    minimumScore,
    rankings,
  }) as AnalogueRankingResult;
}

export function rankAnalogueEvents(
  target: ResearchEvent | ResearchLedgerEvent,
  events: readonly (ResearchEvent | ResearchLedgerEvent)[],
  options: AnalogueRankingOptions = {},
): AnalogueRankingResult {
  return rankSameCompanyAnalogues(target, events, options);
}
