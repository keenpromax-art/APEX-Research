import { deepFreeze, isDeeplyFrozen } from "./immutable";
import { companyIdentityKey } from "./run-envelope";
import { compareStableStrings, stableHash, stableStringify } from "./stable";
import {
  RESEARCH_EVENT_VERSION,
  type EventQuery,
  type ResearchEvent,
  type ResearchEventInput,
  type ResearchLedgerEvent,
} from "./types";

export class EventIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventIntegrityError";
  }
}

function requiredText(value: string, field: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must not be empty`);
  if (normalized.length > maximum) throw new RangeError(`${field} must not exceed ${maximum} characters`);
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${field} must be a valid timestamp`);
  return normalized;
}

function canonicalClone<T>(value: T, field: string): T {
  const serialized = stableStringify(value);
  if (serialized === undefined) throw new TypeError(`${field} must be defined`);
  return JSON.parse(serialized) as T;
}

function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags)) throw new TypeError("tags must be an array");
  if (tags.length > 64) throw new RangeError("tags must not contain more than 64 entries");
  const byKey = new Map<string, string>();
  for (const raw of tags) {
    const value = requiredText(raw, "tag", 120);
    const key = value.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()].sort(compareStableStrings);
}

function normalizeMetrics(metrics: Readonly<Record<string, number>> | undefined): Readonly<Record<string, number>> {
  if (metrics === undefined) return {};
  if (metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new TypeError("metrics must be a record");
  }
  const normalized: Record<string, number> = {};
  for (const key of Object.keys(metrics).sort()) {
    const name = requiredText(key, "metric name", 120);
    const value = metrics[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`metrics.${name} must be a finite number`);
    }
    normalized[name] = value;
  }
  return normalized;
}

function eventContent(event: Omit<ResearchEvent, "version" | "eventId" | "contentHash">): unknown {
  return {
    companyId: event.companyId,
    runId: event.runId,
    type: event.type,
    occurredAt: event.occurredAt,
    summary: event.summary,
    tags: event.tags,
    metrics: event.metrics,
    details: event.details,
  };
}

export function createResearchEvent(input: ResearchEventInput): ResearchEvent {
  if (input === null || typeof input !== "object") throw new TypeError("Event input must be an object");
  const event: Omit<ResearchEvent, "contentHash" | "eventId"> = {
    version: RESEARCH_EVENT_VERSION,
    companyId: companyIdentityKey(input.company),
    runId: input.runId === undefined ? null : requiredText(input.runId, "runId", 256),
    type: requiredText(input.type, "type", 160),
    occurredAt: timestamp(input.occurredAt, "occurredAt"),
    summary: requiredText(input.summary, "summary", 2_000),
    tags: normalizeTags(input.tags),
    metrics: normalizeMetrics(input.metrics),
    details: canonicalClone(input.details ?? {}, "details"),
  };
  const contentHash = stableHash(eventContent(event), "research-ledger/event/v1");
  const eventId = input.eventId === undefined
    ? `EVT-${contentHash.toUpperCase()}`
    : requiredText(input.eventId, "eventId", 320);
  return deepFreeze({ eventId, contentHash, ...event }) as ResearchEvent;
}

export function verifyResearchEvent(value: unknown): value is ResearchEvent {
  try {
    if (value === null || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
    const event = value as Partial<ResearchEvent>;
    if (event.version !== RESEARCH_EVENT_VERSION) return false;
    if (typeof event.eventId !== "string" || !event.eventId.trim()) return false;
    if (typeof event.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(event.contentHash)) return false;
    if (typeof event.companyId !== "string" || !event.companyId.trim()) return false;
    if (event.runId !== null && typeof event.runId !== "string") return false;
    if (typeof event.type !== "string" || !event.type.trim()) return false;
    if (typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))) return false;
    if (typeof event.summary !== "string" || !event.summary.trim()) return false;
    if (!Array.isArray(event.tags) || event.metrics === null || typeof event.metrics !== "object") return false;
    if (event.details === null || typeof event.details !== "object") return false;
    return stableHash(eventContent(event as ResearchEvent), "research-ledger/event/v1") === event.contentHash;
  } catch {
    return false;
  }
}

export function sealResearchLedgerEvent(
  event: ResearchEvent,
  sequence: number,
  previousEventHash: string | null,
): ResearchLedgerEvent {
  if (!verifyResearchEvent(event)) throw new EventIntegrityError("Research event failed integrity verification");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RangeError("Event sequence must be a positive integer");
  if (previousEventHash !== null && !/^[a-f0-9]{64}$/.test(previousEventHash)) {
    throw new TypeError("previousEventHash must be null or a SHA-256 hash");
  }
  const eventHash = stableHash(
    { contentHash: event.contentHash, sequence, previousEventHash },
    "research-ledger/event-chain/v1",
  );
  return deepFreeze({
    ...event,
    sequence,
    previousEventHash,
    eventHash,
  }) as ResearchLedgerEvent;
}

export function verifyResearchLedgerEvent(value: unknown): value is ResearchLedgerEvent {
  try {
    if (value === null || typeof value !== "object" || !verifyResearchEvent(value)) return false;
    const event = value as ResearchLedgerEvent;
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) return false;
    if (event.previousEventHash !== null && !/^[a-f0-9]{64}$/.test(event.previousEventHash)) return false;
    if (!/^[a-f0-9]{64}$/.test(event.eventHash)) return false;
    return stableHash(
      { contentHash: event.contentHash, sequence: event.sequence, previousEventHash: event.previousEventHash },
      "research-ledger/event-chain/v1",
    ) === event.eventHash;
  } catch {
    return false;
  }
}

export function buildResearchEventHistory(events: readonly ResearchLedgerEvent[]): readonly ResearchLedgerEvent[] {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const byId = new Map<string, ResearchLedgerEvent>();
  for (const event of events) {
    if (!verifyResearchLedgerEvent(event)) throw new EventIntegrityError("Event history contains an invalid event");
    const existing = byId.get(event.eventId);
    if (existing) {
      if (existing.contentHash !== event.contentHash || existing.eventHash !== event.eventHash) {
        throw new EventIntegrityError(`Event ID collision for ${event.eventId}`);
      }
      continue;
    }
    byId.set(event.eventId, event);
  }
  return Object.freeze([...byId.values()].sort((left, right) => left.sequence - right.sequence));
}

export function queryResearchEventHistory(
  events: readonly ResearchLedgerEvent[],
  query: EventQuery = {},
): readonly ResearchLedgerEvent[] {
  const companyId = query.companyId === undefined ? null : companyIdentityKey(query.companyId);
  const from = query.from === undefined ? null : Date.parse(query.from);
  const to = query.to === undefined ? null : Date.parse(query.to);
  if ((query.from !== undefined && !Number.isFinite(from)) || (query.to !== undefined && !Number.isFinite(to))) {
    throw new TypeError("Event history query dates must be valid timestamps");
  }
  if (from !== null && to !== null && from > to) throw new RangeError("Event history from must not be later than to");
  return Object.freeze(buildResearchEventHistory(events).filter((event) => {
    const occurred = Date.parse(event.occurredAt);
    return (companyId === null || event.companyId === companyId)
      && (query.runId === undefined || event.runId === query.runId)
      && (query.type === undefined || event.type === query.type)
      && (from === null || occurred >= from)
      && (to === null || occurred <= to);
  }));
}
