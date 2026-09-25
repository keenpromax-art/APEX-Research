import { createResearchEvent } from "@/lib/research-ledger/events";
import {
  InMemoryResearchLedgerRepository,
  RunIdCollisionError,
} from "@/lib/research-ledger/repository";
import type { ResearchEvent, ResearchRunEnvelope } from "@/lib/research-ledger/types";
import {
  RESEARCH_RUN_MANIFEST_VERSION,
  assertCanonicalResearchRunId,
  normalizeResearchRunListQuery,
  researchRunManifestFromEnvelope,
  serializeResearchRun,
  type ResearchRunIdempotencyDisposition,
  type ResearchRunListQuery,
  type ResearchRunListQueryInput,
  type ResearchRunPayloadV1,
} from "./manifest";

export interface ResearchRunAppendResult {
  readonly run: ResearchRunEnvelope<ResearchRunPayloadV1>;
  readonly disposition: ResearchRunIdempotencyDisposition;
  readonly sequence: number | null;
}

export interface ResearchRunPage {
  readonly runs: readonly ResearchRunEnvelope<ResearchRunPayloadV1>[];
  readonly hasMore: boolean;
}

export interface ResearchRunStore {
  readonly providerId: "memory" | "cloudflare-d1";
  readonly durable: boolean;
  appendRun(run: ResearchRunEnvelope<ResearchRunPayloadV1>): Promise<ResearchRunAppendResult>;
  getRun(runId: string): Promise<ResearchRunEnvelope<ResearchRunPayloadV1> | null>;
  listRuns(query: ResearchRunListQuery): Promise<ResearchRunPage>;
  getRunHistory(runId: string, limit: number): Promise<readonly ResearchEvent[]>;
}

export class ResearchRunIdempotencyConflictError extends Error {
  readonly existingRunId: string;
  readonly incomingRunId: string;

  constructor(existingRunId: string, incomingRunId: string) {
    super(`Idempotency key is already bound to research run ${existingRunId}`);
    this.name = "ResearchRunIdempotencyConflictError";
    this.existingRunId = existingRunId;
    this.incomingRunId = incomingRunId;
  }
}

export class ResearchRunStoreUnavailableError extends Error {
  constructor() {
    super("Research run storage is unavailable");
    this.name = "ResearchRunStoreUnavailableError";
  }
}

const eventKeys = new Set([
  "version",
  "eventId",
  "contentHash",
  "companyId",
  "runId",
  "type",
  "occurredAt",
  "summary",
  "tags",
  "metrics",
  "details",
]);

const eventDetailKeys = new Set(["caseId", "reportType", "reportDepth", "status"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createRunAppendedEvent(run: ResearchRunEnvelope<ResearchRunPayloadV1>): ResearchEvent {
  const manifest = researchRunManifestFromEnvelope(run);
  return createResearchEvent({
    type: "run-appended",
    company: manifest.company.id,
    runId: run.runId,
    occurredAt: run.occurredAt,
    summary: `Research run ${run.runId} appended`,
    tags: ["research-run", manifest.company.ticker],
    details: {
      caseId: manifest.caseId,
      reportType: manifest.report.type,
      reportDepth: manifest.report.depth,
      status: manifest.status,
    },
  });
}

export function rehydrateResearchRunEvent(value: unknown): ResearchEvent {
  if (!isPlainRecord(value)) throw new Error("Research run event must be a plain object");
  for (const key of Object.keys(value)) {
    if (!eventKeys.has(key)) throw new Error("Research run event contains an unsupported field");
  }
  if (value.version !== "research-event-v1") throw new Error("Research run event version is unsupported");
  if (typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw new Error("Research run event hash is invalid");
  }
  if (typeof value.runId !== "string") throw new Error("Research run event run ID is invalid");
  if (!isPlainRecord(value.metrics) || Object.keys(value.metrics).length > 0) {
    throw new Error("Research run event metrics are invalid");
  }
  if (!isPlainRecord(value.details)) throw new Error("Research run event details are invalid");
  for (const key of Object.keys(value.details)) {
    if (!eventDetailKeys.has(key)) throw new Error("Research run event details are not allow-listed");
  }
  try {
    const rebuilt = createResearchEvent({
      eventId: value.eventId as string,
      type: value.type as string,
      company: value.companyId as string,
      runId: value.runId,
      occurredAt: value.occurredAt as string,
      summary: value.summary as string,
      tags: value.tags as string[],
      metrics: {},
      details: value.details,
    });
    if (rebuilt.contentHash !== value.contentHash || rebuilt.eventId !== value.eventId) {
      throw new Error("Research run event content hash mismatch");
    }
    return rebuilt;
  } catch {
    throw new Error("Research run event failed integrity verification");
  }
}

function normalizeStoreQuery(query: ResearchRunListQuery): ResearchRunListQuery {
  if (query.order !== "occurredAt:desc,runId:desc") throw new TypeError("Unsupported research run query order");
  const input: ResearchRunListQueryInput = {
    limit: query.limit,
    offset: query.offset,
    ...(query.companyId === null ? {} : { companyId: query.companyId }),
    ...(query.from === null ? {} : { from: query.from }),
    ...(query.to === null ? {} : { to: query.to }),
  };
  return normalizeResearchRunListQuery(input);
}

function compareRuns(
  left: ResearchRunEnvelope<ResearchRunPayloadV1>,
  right: ResearchRunEnvelope<ResearchRunPayloadV1>,
): number {
  const occurred = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  return occurred || right.runId.localeCompare(left.runId);
}

function matchesQuery(
  run: ResearchRunEnvelope<ResearchRunPayloadV1>,
  query: ResearchRunListQuery,
): boolean {
  const companyId = researchRunManifestFromEnvelope(run).company.id.toLowerCase();
  const occurred = Date.parse(run.occurredAt);
  return (query.companyId === null || companyId === query.companyId)
    && (query.from === null || occurred >= Date.parse(query.from))
    && (query.to === null || occurred <= Date.parse(query.to));
}

function exactRun(
  existing: ResearchRunEnvelope<ResearchRunPayloadV1>,
  incoming: ResearchRunEnvelope<ResearchRunPayloadV1>,
): boolean {
  return existing.runId === incoming.runId && existing.contentHash === incoming.contentHash;
}

export class InMemoryResearchRunStore implements ResearchRunStore {
  readonly providerId = "memory" as const;
  readonly durable = false;
  readonly #repository = new InMemoryResearchLedgerRepository();
  readonly #idempotency = new Map<string, string>();

  constructor(initialRuns: readonly ResearchRunEnvelope<ResearchRunPayloadV1>[] = []) {
    for (const run of initialRuns) this.#append(run);
  }

  async appendRun(run: ResearchRunEnvelope<ResearchRunPayloadV1>): Promise<ResearchRunAppendResult> {
    return this.#append(run);
  }

  async getRun(runId: string): Promise<ResearchRunEnvelope<ResearchRunPayloadV1> | null> {
    assertCanonicalResearchRunId(runId);
    const run = this.#repository.getRun(runId) as ResearchRunEnvelope<ResearchRunPayloadV1> | null;
    if (run) researchRunManifestFromEnvelope(run);
    return run;
  }

  async listRuns(query: ResearchRunListQuery): Promise<ResearchRunPage> {
    const normalized = normalizeStoreQuery(query);
    const runs = (this.#repository.listRuns() as ResearchRunEnvelope<ResearchRunPayloadV1>[])
      .filter((run) => matchesQuery(run, normalized))
      .sort(compareRuns);
    const page = runs.slice(normalized.offset, normalized.offset + normalized.limit);
    return {
      runs: Object.freeze([...page]),
      hasMore: normalized.offset + page.length < runs.length,
    };
  }

  async getRunHistory(runId: string, limit: number): Promise<readonly ResearchEvent[]> {
    assertCanonicalResearchRunId(runId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new RangeError("History limit must be between 1 and 20");
    return Object.freeze([...this.#repository.getEventHistory({ runId }).slice(0, limit)]);
  }

  #append(run: ResearchRunEnvelope<ResearchRunPayloadV1>): ResearchRunAppendResult {
    assertCanonicalResearchRunId(run.runId);
    const manifest = researchRunManifestFromEnvelope(run);
    const boundRunId = this.#idempotency.get(manifest.idempotencyKey);
    if (boundRunId) {
      const boundRun = this.#repository.getRun(boundRunId) as ResearchRunEnvelope<ResearchRunPayloadV1>;
      if (boundRun && exactRun(boundRun, run)) {
        return { run: boundRun, disposition: "duplicate", sequence: null };
      }
      throw new ResearchRunIdempotencyConflictError(boundRunId, run.runId);
    }
    const existing = this.#repository.getRun(run.runId) as ResearchRunEnvelope<ResearchRunPayloadV1> | null;
    if (existing) {
      if (exactRun(existing, run)) return { run: existing, disposition: "duplicate", sequence: null };
      throw new RunIdCollisionError(run.runId);
    }
    const appended = this.#repository.appendRun(run);
    this.#idempotency.set(manifest.idempotencyKey, run.runId);
    return { run: appended.run, disposition: "created", sequence: appended.sequence };
  }
}

export function researchRunEventJson(run: ResearchRunEnvelope<ResearchRunPayloadV1>): string {
  return JSON.stringify(createRunAppendedEvent(run));
}

export function assertRunPayloadVersion(run: ResearchRunEnvelope<ResearchRunPayloadV1>): void {
  if (run.payload.manifestVersion !== RESEARCH_RUN_MANIFEST_VERSION) {
    throw new TypeError("Research run payload version is unsupported");
  }
  serializeResearchRun(run);
}
