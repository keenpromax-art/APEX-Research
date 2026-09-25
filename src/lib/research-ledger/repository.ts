import {
  buildResearchEventHistory,
  createResearchEvent,
  queryResearchEventHistory,
  sealResearchLedgerEvent,
} from "./events";
import {
  assertResearchRunEnvelope,
  companyIdentityKey,
  createResearchRunEnvelope,
  isResearchRunEnvelope,
} from "./run-envelope";
import { compareStableStrings, sameStableValue } from "./stable";
import {
  type AppendEventResult,
  type AppendRunResult,
  type EventQuery,
  type ResearchEventInput,
  type ResearchLedgerEvent,
  type ResearchRunEnvelope,
  type ResearchRunInput,
  type RunQuery,
} from "./types";

export class RunIdCollisionError extends Error {
  constructor(runId: string) {
    super(`Research run ID ${runId} already exists with different content`);
    this.name = "RunIdCollisionError";
  }
}

export class RunAliasError extends Error {
  constructor(contentHash: string, existingRunId: string, incomingRunId: string) {
    super(`Research run content ${contentHash} is already addressed by ${existingRunId}, not ${incomingRunId}`);
    this.name = "RunAliasError";
  }
}

export class EventIdCollisionError extends Error {
  constructor(eventId: string) {
    super(`Research event ID ${eventId} already exists with different content`);
    this.name = "EventIdCollisionError";
  }
}

export class InMemoryResearchLedgerRepository {
  readonly #runs = new Map<string, ResearchRunEnvelope<unknown>>();
  readonly #runSequence = new Map<string, number>();
  readonly #runIdByContentHash = new Map<string, string>();
  readonly #events = new Map<string, ResearchLedgerEvent>();

  constructor(initialRuns: readonly ResearchRunEnvelope<unknown>[] = []) {
    if (!Array.isArray(initialRuns)) throw new TypeError("initialRuns must be an array");
    for (const run of initialRuns) this.appendRun(run);
  }

  appendRun<TPayload>(
    input: ResearchRunInput<TPayload> | ResearchRunEnvelope<TPayload>,
  ): AppendRunResult<TPayload> {
    let run: ResearchRunEnvelope<TPayload>;
    if (isResearchRunEnvelope(input)) {
      assertResearchRunEnvelope(input);
      run = createResearchRunEnvelope<TPayload>({
        runId: input.runId,
        company: input.company,
        occurredAt: input.occurredAt,
        dataCutoff: input.dataCutoff,
        schemaVersion: input.schemaVersion,
        pipelineVersion: input.pipelineVersion,
        modelVersion: input.modelVersion,
        ...(input.promptVersion === null ? {} : { promptVersion: input.promptVersion }),
        payload: input.payload as TPayload,
        metadata: input.metadata,
      });
    } else {
      run = createResearchRunEnvelope(input);
    }

    const existing = this.#runs.get(run.runId) as ResearchRunEnvelope<TPayload> | undefined;
    if (existing) {
      if (sameStableValue(existing, run)) {
        return {
          run: existing,
          appended: false,
          duplicate: true,
          sequence: this.#runSequence.get(run.runId) as number,
        };
      }
      throw new RunIdCollisionError(run.runId);
    }

    const aliasedRunId = this.#runIdByContentHash.get(run.contentHash);
    if (aliasedRunId && aliasedRunId !== run.runId) {
      throw new RunAliasError(run.contentHash, aliasedRunId, run.runId);
    }

    const sequence = this.#runs.size + 1;
    this.#runs.set(run.runId, run as ResearchRunEnvelope<unknown>);
    this.#runSequence.set(run.runId, sequence);
    this.#runIdByContentHash.set(run.contentHash, run.runId);
    const event = createResearchEvent({
      type: "run-appended",
      company: run.company,
      runId: run.runId,
      occurredAt: run.occurredAt,
      summary: `Research run ${run.runId} appended`,
      tags: ["research-run", run.company.ticker],
      details: {
        schemaVersion: run.schemaVersion,
        pipelineVersion: run.pipelineVersion,
        modelVersion: run.modelVersion,
        promptVersion: run.promptVersion,
      },
    });
    this.#appendEvent(event);
    return { run, appended: true, duplicate: false, sequence };
  }

  getRun(runId: string): ResearchRunEnvelope<unknown> | null {
    return this.#runs.get(runId) ?? null;
  }

  hasRun(runId: string): boolean {
    return this.#runs.has(runId);
  }

  listRuns(query: RunQuery = {}): readonly ResearchRunEnvelope<unknown>[] {
    const companyId = query.companyId === undefined ? null : companyIdentityKey(query.companyId);
    const from = query.from === undefined ? null : Date.parse(query.from);
    const to = query.to === undefined ? null : Date.parse(query.to);
    if ((query.from !== undefined && !Number.isFinite(from)) || (query.to !== undefined && !Number.isFinite(to))) {
      throw new TypeError("Run query dates must be valid timestamps");
    }
    if (from !== null && to !== null && from > to) throw new RangeError("Run query from must not be later than to");
    return Object.freeze([...this.#runs.values()].filter((run) => {
      const occurred = Date.parse(run.occurredAt);
      return (companyId === null || run.company.id.toLowerCase() === companyId)
        && (from === null || occurred >= from)
        && (to === null || occurred <= to);
    }));
  }

  getLatestRun(companyId: string): ResearchRunEnvelope<unknown> | null {
    const key = companyIdentityKey(companyId);
    const runs = [...this.#runs.values()].filter((run) => run.company.id.toLowerCase() === key);
    if (runs.length === 0) return null;
    return runs.sort((left, right) => {
      const time = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
      return time || compareStableStrings(left.runId, right.runId);
    })[0] ?? null;
  }

  appendEvent(input: ResearchEventInput): AppendEventResult {
    if (input === null || typeof input !== "object") throw new TypeError("Event input must be an object");
    if (input.type === "run-appended") throw new TypeError("run-appended events are created only by appendRun");
    const companyId = companyIdentityKey(input.company);
    if (input.runId !== undefined) {
      const run = this.#runs.get(input.runId);
      if (!run) throw new Error(`Research run ${input.runId} must be appended before its events`);
      if (run.company.id.toLowerCase() !== companyId) {
        throw new Error(`Event company ${companyId} does not match run company ${run.company.id.toLowerCase()}`);
      }
      if (Date.parse(input.occurredAt) < Date.parse(run.occurredAt)) {
        throw new RangeError("Event occurredAt must not precede its linked run");
      }
    }
    return this.#appendEvent(createResearchEvent({ ...input, company: companyId }));
  }

  getEventHistory(query: EventQuery = {}): readonly ResearchLedgerEvent[] {
    return queryResearchEventHistory([...this.#events.values()], query);
  }

  history(query: EventQuery = {}): readonly ResearchLedgerEvent[] {
    return this.getEventHistory(query);
  }

  allEvents(): readonly ResearchLedgerEvent[] {
    return buildResearchEventHistory([...this.#events.values()]);
  }

  get runCount(): number {
    return this.#runs.size;
  }

  get eventCount(): number {
    return this.#events.size;
  }

  #appendEvent(event: Parameters<typeof sealResearchLedgerEvent>[0]): AppendEventResult {
    const existing = this.#events.get(event.eventId);
    if (existing) {
      if (existing.contentHash === event.contentHash) {
        return { event: existing, appended: false, duplicate: true };
      }
      throw new EventIdCollisionError(event.eventId);
    }
    const orderedEvents = [...this.#events.values()];
    const previous = orderedEvents.length === 0 ? null : orderedEvents[orderedEvents.length - 1]?.eventHash ?? null;
    const sealed = sealResearchLedgerEvent(event, this.#events.size + 1, previous);
    this.#events.set(event.eventId, sealed);
    return { event: sealed, appended: true, duplicate: false };
  }
}
