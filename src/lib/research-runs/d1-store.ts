import {
  assertCanonicalResearchRunId,
  normalizeResearchRunListQuery,
  rehydrateResearchRunJson,
  ResearchRunIntegrityError,
  researchRunManifestFromEnvelope,
  serializeResearchRun,
  type ResearchRunListQuery,
  type ResearchRunListQueryInput,
  type ResearchRunPayloadV1,
} from "./manifest";
import {
  ResearchRunIdempotencyConflictError,
  ResearchRunStoreUnavailableError,
  assertRunPayloadVersion,
  rehydrateResearchRunEvent,
  researchRunEventJson,
  type ResearchRunAppendResult,
  type ResearchRunPage,
  type ResearchRunStore,
} from "./store";
import { RunIdCollisionError } from "@/lib/research-ledger/repository";
import type { ResearchEvent, ResearchRunEnvelope } from "@/lib/research-ledger/types";

type D1Value = string | number | null;

export interface D1ResearchRunStatement {
  bind(...values: D1Value[]): D1ResearchRunStatement;
  first<T extends Record<string, unknown>>(): Promise<T | null>;
  all<T extends Record<string, unknown>>(): Promise<T[]>;
  run<T extends Record<string, unknown>>(): Promise<D1ResearchRunResult<T>>;
}

export interface D1ResearchRunResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly results?: T[];
  readonly success: boolean;
  readonly meta: {
    readonly changes?: number;
    readonly last_row_id?: number;
  };
}

export interface D1ResearchRunDatabase {
  prepare(query: string): D1ResearchRunStatement;
  batch<T extends Record<string, unknown> = Record<string, unknown>>(
    statements: D1ResearchRunStatement[],
  ): Promise<D1ResearchRunResult<T>[]>;
}

interface D1ResearchRunRow extends Record<string, unknown> {
  readonly sequence: number;
  readonly run_id: string;
  readonly idempotency_key: string;
  readonly company_id: string;
  readonly ticker: string;
  readonly occurred_at: string;
  readonly data_cutoff: string;
  readonly content_hash: string;
  readonly envelope_json: string;
}

interface D1ResearchRunEventRow extends Record<string, unknown> {
  readonly event_json: string;
}

const runColumns = "sequence, run_id, idempotency_key, company_id, ticker, occurred_at, data_cutoff, content_hash, envelope_json";

export function isD1ResearchRunDatabase(value: unknown): value is D1ResearchRunDatabase {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { prepare?: unknown; batch?: unknown };
  return typeof candidate.prepare === "function" && typeof candidate.batch === "function";
}

function normalizeQuery(query: ResearchRunListQuery): ResearchRunListQuery {
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

function exactRun(
  existing: ResearchRunEnvelope<ResearchRunPayloadV1>,
  incoming: ResearchRunEnvelope<ResearchRunPayloadV1>,
): boolean {
  return existing.runId === incoming.runId && existing.contentHash === incoming.contentHash;
}

export class D1ResearchRunStore implements ResearchRunStore {
  readonly providerId = "cloudflare-d1" as const;
  readonly durable = true;
  readonly #database: D1ResearchRunDatabase;

  constructor(database: D1ResearchRunDatabase) {
    if (!isD1ResearchRunDatabase(database)) throw new TypeError("A D1-compatible database is required");
    this.#database = database;
  }

  async appendRun(run: ResearchRunEnvelope<ResearchRunPayloadV1>): Promise<ResearchRunAppendResult> {
    assertCanonicalResearchRunId(run.runId);
    assertRunPayloadVersion(run);
    const manifest = researchRunManifestFromEnvelope(run);
    const envelopeJson = serializeResearchRun(run);
    const eventJson = researchRunEventJson(run);
    const values: D1Value[] = [
      run.runId,
      manifest.idempotencyKey,
      manifest.company.id.toLowerCase(),
      manifest.company.ticker,
      run.occurredAt,
      run.dataCutoff,
      run.contentHash,
      envelopeJson,
    ];
    const insertRun = this.#database.prepare(
      `INSERT OR IGNORE INTO research_runs (
        run_id, idempotency_key, company_id, ticker, occurred_at, data_cutoff, content_hash, envelope_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...values);
    const insertEvent = this.#database.prepare(
      `INSERT OR IGNORE INTO research_run_events (run_id, event_json)
       SELECT ?, ? WHERE EXISTS (SELECT 1 FROM research_runs WHERE run_id = ?)`,
    ).bind(run.runId, eventJson, run.runId);
    const selectByIdempotency = this.#database.prepare(
      `SELECT ${runColumns} FROM research_runs WHERE idempotency_key = ? LIMIT 1`,
    ).bind(manifest.idempotencyKey);
    const selectByRunId = this.#database.prepare(
      `SELECT ${runColumns} FROM research_runs WHERE run_id = ? LIMIT 1`,
    ).bind(run.runId);
    const results = await this.#execute(() => this.#database.batch([insertRun, insertEvent, selectByIdempotency, selectByRunId]));
    if (results.some((result) => !result.success)) throw new ResearchRunStoreUnavailableError();
    const changes = results[0]?.meta.changes;
    const byIdempotencyRow = results[2]?.results?.[0] as D1ResearchRunRow | undefined;
    const byRunIdRow = results[3]?.results?.[0] as D1ResearchRunRow | undefined;
    const byIdempotency = byIdempotencyRow ? this.#rehydrateRow(byIdempotencyRow) : null;
    const byRunId = byRunIdRow ? this.#rehydrateRow(byRunIdRow) : null;
    if (changes === 1) {
      const inserted = byIdempotency ?? byRunId;
      if (!inserted || !exactRun(inserted, run)) {
        throw new ResearchRunIntegrityError("D1 append did not persist the canonical run");
      }
      return { run: inserted, disposition: "created", sequence: null };
    }
    if (changes !== 0) throw new ResearchRunIntegrityError("D1 append returned an indeterminate state");
    if (byIdempotency) {
      if (!exactRun(byIdempotency, run)) {
        throw new ResearchRunIdempotencyConflictError(byIdempotency.runId, run.runId);
      }
      return { run: byIdempotency, disposition: "duplicate", sequence: null };
    }
    if (byRunId) {
      if (!exactRun(byRunId, run)) throw new RunIdCollisionError(run.runId);
      return { run: byRunId, disposition: "duplicate", sequence: null };
    }
    throw new ResearchRunIntegrityError("D1 append did not resolve a durable run");
  }

  async getRun(runId: string): Promise<ResearchRunEnvelope<ResearchRunPayloadV1> | null> {
    assertCanonicalResearchRunId(runId);
    return this.#findByRunId(runId);
  }

  async listRuns(query: ResearchRunListQuery): Promise<ResearchRunPage> {
    const normalized = normalizeQuery(query);
    const conditions: string[] = [];
    const bindings: D1Value[] = [];
    if (normalized.companyId !== null) {
      conditions.push("company_id = ?");
      bindings.push(normalized.companyId);
    }
    if (normalized.from !== null) {
      conditions.push("occurred_at >= ?");
      bindings.push(normalized.from);
    }
    if (normalized.to !== null) {
      conditions.push("occurred_at <= ?");
      bindings.push(normalized.to);
    }
    const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
    const statement = this.#database.prepare(
      `SELECT ${runColumns} FROM research_runs${where}
       ORDER BY occurred_at DESC, run_id DESC
       LIMIT ? OFFSET ?`,
    ).bind(...bindings, normalized.limit + 1, normalized.offset);
    const rows = await this.#execute(() => statement.all<D1ResearchRunRow>());
    const hasMore = rows.length > normalized.limit;
    const runs = rows.slice(0, normalized.limit).map((row) => this.#rehydrateRow(row));
    return { runs: Object.freeze(runs), hasMore };
  }

  async getRunHistory(runId: string, limit: number): Promise<readonly ResearchEvent[]> {
    assertCanonicalResearchRunId(runId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new RangeError("History limit must be between 1 and 20");
    const statement = this.#database.prepare(
      "SELECT event_json FROM research_run_events WHERE run_id = ? ORDER BY rowid ASC LIMIT ?",
    ).bind(runId, limit);
    const rows = await this.#execute(() => statement.all<D1ResearchRunEventRow>());
    return Object.freeze(rows.map((row) => {
      try {
        const event = rehydrateResearchRunEvent(JSON.parse(row.event_json) as unknown);
        if (event.runId !== runId) throw new ResearchRunIntegrityError("D1 event run ID mismatch");
        return event;
      } catch (error) {
        if (error instanceof ResearchRunIntegrityError) throw error;
        throw new ResearchRunIntegrityError("Stored research run event failed integrity verification");
      }
    }));
  }

  async #findByIdempotencyKey(idempotencyKey: string): Promise<ResearchRunEnvelope<ResearchRunPayloadV1> | null> {
    const row = await this.#execute(() => this.#database.prepare(
      `SELECT ${runColumns} FROM research_runs WHERE idempotency_key = ? LIMIT 1`,
    ).bind(idempotencyKey).first<D1ResearchRunRow>());
    return row ? this.#rehydrateRow(row) : null;
  }

  async #findByRunId(runId: string): Promise<ResearchRunEnvelope<ResearchRunPayloadV1> | null> {
    const row = await this.#execute(() => this.#database.prepare(
      `SELECT ${runColumns} FROM research_runs WHERE run_id = ? LIMIT 1`,
    ).bind(runId).first<D1ResearchRunRow>());
    return row ? this.#rehydrateRow(row) : null;
  }

  #rehydrateRow(row: D1ResearchRunRow): ResearchRunEnvelope<ResearchRunPayloadV1> {
    const run = rehydrateResearchRunJson(row.envelope_json);
    const manifest = researchRunManifestFromEnvelope(run);
    if (
      row.run_id !== run.runId
      || row.content_hash !== run.contentHash
      || row.idempotency_key !== manifest.idempotencyKey
      || row.company_id !== manifest.company.id.toLowerCase()
      || row.ticker !== manifest.company.ticker
      || row.occurred_at !== run.occurredAt
      || row.data_cutoff !== run.dataCutoff
    ) {
      throw new ResearchRunIntegrityError("D1 research run columns failed integrity verification");
    }
    return run;
  }

  async #execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ResearchRunStoreUnavailableError) throw error;
      throw new ResearchRunStoreUnavailableError();
    }
  }
}
