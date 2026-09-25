import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  InMemoryResearchRunStore,
  RESEARCH_RUN_MANIFEST_VERSION,
  ResearchRunIdempotencyConflictError,
  ResearchRunIntegrityError,
  ResearchRunManifestValidationError,
  ResearchRunPayloadTooLargeError,
  ResearchRunQueryValidationError,
  createResearchRunFromManifest,
  normalizeResearchRunListQuery,
  parseResearchRunJson,
  parseResearchRunListQuery,
  rehydrateResearchRunJson,
  serializeResearchRun,
  type ResearchRunListQuery,
} from "../src/lib/research-runs";
import { D1ResearchRunStore } from "../src/lib/research-runs/d1-store";
import { GET as getRuns, POST as postRun } from "../src/app/api/research-runs/route";
import { GET as getRun } from "../src/app/api/research-runs/[runId]/route";

let passed = 0;
let failed = 0;

async function check(name: string, assertion: () => void | Promise<void>): Promise<void> {
  try {
    await assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: RESEARCH_RUN_MANIFEST_VERSION,
    company: {
      id: "IN:RELIANCE",
      ticker: "RELIANCE.NS",
      name: "Reliance Industries",
      exchange: "NSE",
    },
    occurredAt: "2026-01-03T12:00:00.000Z",
    dataCutoff: "2026-01-02T23:59:59.000Z",
    schemaVersion: "research-run-manifest-v1",
    pipelineVersion: "apex-report-pipeline-v1",
    modelVersion: "test-model-v1",
    promptVersion: "test-prompt-v1",
    caseId: "RC-RELIANCE-123",
    report: {
      type: "institutional_equity_v1",
      depth: "full",
    },
    status: "complete",
    reportArtifact: null,
    summary: {
      thesis: {
        statement: "Digital scale compounds distribution economics.",
        keyDebate: "Can digital economics offset legacy pressure?",
        invalidation: ["Active users decline"],
      },
      forecast: {
        projectionCount: 1,
        rows: [
          {
            period: "FY27E",
            revenue: 1_050,
            ebit: 180,
            freeCashFlow: 120,
            eps: 12,
          },
        ],
      },
    },
    evidence: {
      evidenceCount: 4,
      conflictCount: 1,
      graphNodeCount: 8,
      graphEdgeCount: 7,
      graphHash: "a".repeat(64),
    },
    sourceRunIds: [],
    idempotencyKey: "finalized:RELIANCE.NS:2026-01-03",
    ...overrides,
  };
}

function query(overrides: Partial<ResearchRunListQuery> = {}): ResearchRunListQuery {
  return normalizeResearchRunListQuery(overrides);
}

type FakeValue = string | number | null;

class FakeD1Statement {
  constructor(
    private readonly database: FakeD1Database,
    private readonly query: string,
    private readonly values: readonly FakeValue[] = [],
  ) {}

  bind(...values: FakeValue[]): FakeD1Statement {
    return new FakeD1Statement(this.database, this.query, values);
  }

  async first<T extends Record<string, unknown>>(): Promise<T | null> {
    return this.database.execute(this.query, this.values).first as T | null;
  }

  async all<T extends Record<string, unknown>>(): Promise<T[]> {
    return this.database.execute(this.query, this.values).results as T[];
  }

  async run<T extends Record<string, unknown>>() {
    return this.database.execute(this.query, this.values) as {
      results: T[];
      success: boolean;
      meta: { changes: number };
    };
  }
}

class FakeD1Database {
  readonly runs = new Map<string, Record<string, unknown>>();
  readonly events = new Map<string, string>();

  prepare(query: string): FakeD1Statement {
    return new FakeD1Statement(this, query);
  }

  async batch(statements: FakeD1Statement[]) {
    const results: ReturnType<FakeD1Database["execute"]>[] = [];
    for (const statement of statements) {
      const bound = statement as unknown as { query: string; values: readonly FakeValue[] };
      results.push(this.execute(bound.query, bound.values));
    }
    return results;
  }

  execute(query: string, values: readonly FakeValue[]) {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("INSERT OR IGNORE INTO research_runs")) {
      const [runId, idempotencyKey, companyId, ticker, occurredAt, dataCutoff, contentHash, envelopeJson] = values;
      const duplicate = [...this.runs.values()].some((row) => row.run_id === runId || row.idempotency_key === idempotencyKey);
      if (!duplicate && runId && idempotencyKey && companyId && ticker && occurredAt && dataCutoff && contentHash && envelopeJson) {
        this.runs.set(runId, {
          sequence: this.runs.size + 1,
          run_id: runId,
          idempotency_key: idempotencyKey,
          company_id: companyId,
          ticker,
          occurred_at: occurredAt,
          data_cutoff: dataCutoff,
          content_hash: contentHash,
          envelope_json: envelopeJson,
        });
        return { first: null, results: [], success: true, meta: { changes: 1 } };
      }
      return { first: null, results: [], success: true, meta: { changes: 0 } };
    }
    if (normalized.startsWith("INSERT OR IGNORE INTO research_run_events")) {
      const [runId, eventJson] = values;
      if (runId && eventJson && this.runs.has(runId) && !this.events.has(runId)) this.events.set(runId, eventJson);
      return { first: null, results: [], success: true, meta: { changes: 1 } };
    }
    if (normalized.includes("FROM research_run_events")) {
      const runId = values[0];
      const eventJson = typeof runId === "string" ? this.events.get(runId) : undefined;
      const rows = eventJson ? [{ event_json: eventJson }] : [];
      return { first: rows[0] ?? null, results: rows, success: true, meta: { changes: 0 } };
    }
    if (normalized.includes("FROM research_runs")) {
      let rows = [...this.runs.values()];
      if (normalized.includes("WHERE idempotency_key = ?")) rows = rows.filter((row) => row.idempotency_key === values[0]);
      if (normalized.includes("WHERE run_id = ?")) rows = rows.filter((row) => row.run_id === values[0]);
      if (normalized.includes("company_id = ?")) rows = rows.filter((row) => row.company_id === values[0]);
      if (normalized.includes("ORDER BY occurred_at DESC")) {
        rows.sort((left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)) || String(right.run_id).localeCompare(String(left.run_id)));
        if (normalized.includes("LIMIT ? OFFSET ?")) {
          const limit = Number(values[values.length - 2]);
          const offset = Number(values[values.length - 1]);
          rows = rows.slice(offset, offset + limit + 1);
        }
      }
      return { first: rows[0] ?? null, results: rows, success: true, meta: { changes: 0 } };
    }
    throw new Error(`Unsupported fake D1 query: ${normalized}`);
  }
}

async function main(): Promise<void> {
  console.log("RESEARCH RUN PERSISTENCE TESTS");

  await check("manifest is allow-listed, normalized, frozen, and content-addressed", () => {
    const parsed = parseResearchRunJson(JSON.stringify(manifest({
      company: {
        id: "in:reliance",
        ticker: "reliance.ns",
        name: "Reliance Industries",
        exchange: "nse",
      },
    })));
    const run = createResearchRunFromManifest(parsed);
    assert.equal(parsed.company.ticker, "RELIANCE.NS");
    assert.equal(parsed.company.id, "IN:RELIANCE");
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.summary.forecast.rows[0]), true);
    assert.match(run.runId, /^RUN-[A-F0-9]{64}$/);
    assert.equal(run.contentHash, run.runId.slice(4).toLowerCase());
    assert.deepEqual(run.metadata, {});
    const withArtifact = createResearchRunFromManifest(manifest({
      reportArtifact: {
        version: "report-artifact-v1",
        ticker: "RELIANCE.NS",
        companyName: "Reliance Industries",
        asOf: "2026-01-02T23:59:59.000Z",
        currency: "INR",
        valuation: {
          method: "DCF",
          wacc: 0.1,
          terminalGrowthRate: 0.04,
          enterpriseValue: 1_000,
          equityValue: 900,
          fairValuePerShare: 100,
        },
        recommendation: {
          rating: "HOLD",
          currentPrice: 95,
          targetPrice: 100,
          upsideDownside: 0.05,
        },
      },
    }));
    assert.equal(withArtifact.payload.reportArtifact?.currency, "INR");
  });

  await check("arbitrary metadata, raw prompts, secrets, and invalid artifacts are rejected", () => {
    assert.throws(() => parseResearchRunJson(JSON.stringify(manifest({ metadata: { apiKey: "secret" } }))), ResearchRunManifestValidationError);
    assert.throws(() => parseResearchRunJson(JSON.stringify(manifest({ rawPrompt: "system prompt" }))), ResearchRunManifestValidationError);
    assert.throws(() => parseResearchRunJson(JSON.stringify(manifest({ runId: `RUN-${"A".repeat(64)}` }))), ResearchRunManifestValidationError);
    assert.throws(() => parseResearchRunJson(JSON.stringify(manifest({ contentHash: "a".repeat(64) }))), ResearchRunManifestValidationError);
    assert.throws(() => parseResearchRunJson(JSON.stringify(manifest({ pipelineVersion: "sk-or-v1-abcdefghijklmnopqrstuvwxyz123456" }))), ResearchRunManifestValidationError);
    assert.throws(() => parseResearchRunJson(JSON.stringify(manifest({
      reportArtifact: {
        version: "report-artifact-v1",
        ticker: "AAPL",
        companyName: null,
        asOf: "2026-01-02T00:00:00.000Z",
        currency: "USD",
        valuation: { method: "DCF", wacc: null, terminalGrowthRate: null, enterpriseValue: null, equityValue: null, fairValuePerShare: null },
        recommendation: { rating: "BUY", currentPrice: null, targetPrice: null, upsideDownside: null },
        secret: "rejected",
      },
    }))), ResearchRunManifestValidationError);
  });

  await check("request and artifact size boundaries fail closed", () => {
    assert.throws(() => parseResearchRunJson(" ".repeat(140_000)), ResearchRunPayloadTooLargeError);
  });

  await check("in-memory append is exact-duplicate idempotent and rejects key conflicts", async () => {
    const store = new InMemoryResearchRunStore();
    const input = manifest();
    const first = await store.appendRun(createResearchRunFromManifest(input));
    const duplicate = await store.appendRun(createResearchRunFromManifest(input));
    assert.equal(first.disposition, "created");
    assert.equal(duplicate.disposition, "duplicate");
    assert.equal(duplicate.run.runId, first.run.runId);
    await assert.rejects(
      () => store.appendRun(createResearchRunFromManifest(manifest({ status: "partial" }))),
      ResearchRunIdempotencyConflictError,
    );
    const history = await store.getRunHistory(first.run.runId, 10);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.runId, first.run.runId);
    assert.equal(history[0]?.type, "run-appended");
  });

  await check("D1 adapter distinguishes created, duplicate, and conflicting appends", async () => {
    const database = new FakeD1Database();
    const store = new D1ResearchRunStore(database as never);
    const run = createResearchRunFromManifest(manifest({ idempotencyKey: "run:d1" }));
    const created = await store.appendRun(run);
    assert.equal(created.disposition, "created");
    const duplicate = await store.appendRun(run);
    assert.equal(duplicate.disposition, "duplicate");
    await assert.rejects(
      () => store.appendRun(createResearchRunFromManifest(manifest({ idempotencyKey: "run:d1", status: "partial" }))),
      ResearchRunIdempotencyConflictError,
    );
    const fetched = await store.getRun(run.runId);
    assert.equal(fetched?.runId, run.runId);
    const history = await store.getRunHistory(run.runId, 10);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.type, "run-appended");
  });

  await check("stored JSON rehydrates to a frozen envelope and rejects tampering", () => {
    const run = createResearchRunFromManifest(manifest());
    const serialized = serializeResearchRun(run);
    const rehydrated = rehydrateResearchRunJson(serialized);
    assert.equal(rehydrated.runId, run.runId);
    assert.equal(Object.isFrozen(rehydrated), true);
    assert.equal(Object.isFrozen(rehydrated.payload), true);

    const changedPayload = JSON.parse(serialized) as Record<string, any>;
    changedPayload.payload.summary.thesis.statement = "Tampered";
    assert.throws(() => rehydrateResearchRunJson(JSON.stringify(changedPayload)), ResearchRunIntegrityError);

    const changedRunId = JSON.parse(serialized) as Record<string, any>;
    changedRunId.runId = `RUN-${"0".repeat(64)}`;
    assert.throws(() => rehydrateResearchRunJson(JSON.stringify(changedRunId)), ResearchRunIntegrityError);

    const addedMetadata = JSON.parse(serialized) as Record<string, any>;
    addedMetadata.metadata = { prompt: "raw" };
    assert.throws(() => rehydrateResearchRunJson(JSON.stringify(addedMetadata)), ResearchRunIntegrityError);
  });

  await check("list filters, deterministic order, and bounded pagination are enforced", async () => {
    const store = new InMemoryResearchRunStore();
    const first = createResearchRunFromManifest(manifest({ idempotencyKey: "run:first" }));
    const second = createResearchRunFromManifest(manifest({
      occurredAt: "2026-01-02T12:00:00.000Z",
      dataCutoff: "2026-01-02T11:59:59.000Z",
      idempotencyKey: "run:second",
    }));
    const other = createResearchRunFromManifest(manifest({
      company: { id: "US:APPLE", ticker: "AAPL", name: "Apple", exchange: "NASDAQ" },
      idempotencyKey: "run:other",
    }));
    await store.appendRun(first);
    await store.appendRun(second);
    await store.appendRun(other);
    const filtered = await store.listRuns(query({
      companyId: "in:reliance",
      from: "2026-01-02",
      to: "2026-01-03",
      limit: 1,
      offset: 0,
    }));
    assert.equal(filtered.runs.length, 1);
    assert.equal(filtered.runs[0]?.runId, first.runId);
    assert.equal(filtered.hasMore, true);
    const all = await store.listRuns(query({ limit: 3 }));
    assert.equal(all.runs.length, 3);
    assert.equal(all.runs[0]?.occurredAt, first.occurredAt);
    assert.throws(() => normalizeResearchRunListQuery({ limit: 101 }), ResearchRunQueryValidationError);
    assert.throws(() => normalizeResearchRunListQuery({ companyId: "" }), ResearchRunQueryValidationError);
    assert.throws(() => normalizeResearchRunListQuery({ offset: -1 }), ResearchRunQueryValidationError);
    assert.throws(() => normalizeResearchRunListQuery({ from: "not-a-date" }), ResearchRunQueryValidationError);
    assert.throws(() => parseResearchRunListQuery(new URLSearchParams([["unknown", "value"]])), ResearchRunQueryValidationError);
    assert.throws(() => parseResearchRunListQuery(new URLSearchParams([["limit", "101"]])), ResearchRunQueryValidationError);
  });

  await check("API rejects invalid, oversized, and unbounded requests before persistence", async () => {
    const invalid = await postRun(new NextRequest("http://localhost/api/research-runs", {
      method: "POST",
      body: JSON.stringify(manifest({ metadata: { rawPrompt: "secret" } })),
    }));
    assert.equal(invalid.status, 422);
    const oversized = await postRun(new NextRequest("http://localhost/api/research-runs", {
      method: "POST",
      body: " ".repeat(140_000),
    }));
    assert.equal(oversized.status, 413);
    const unbounded = await getRuns(new NextRequest("http://localhost/api/research-runs?limit=101"));
    assert.equal(unbounded.status, 422);
  });

  await check("API explicitly reports unavailable durable storage", async () => {
    const response = await postRun(new NextRequest("http://localhost/api/research-runs", {
      method: "POST",
      body: JSON.stringify(manifest()),
    }));
    assert.equal(response.status, 503);
    const body = await response.json() as { code?: string; durable?: boolean };
    assert.equal(body.code, "STORE_UNAVAILABLE");
    assert.equal(body.durable, false);
  });

  await check("detail API validates run ID and history bounds", async () => {
    const response = await getRun(
      new NextRequest(`http://localhost/api/research-runs/RUN-${"A".repeat(64)}?historyLimit=21`),
      { params: Promise.resolve({ runId: `RUN-${"A".repeat(64)}` }) },
    );
    assert.equal(response.status, 422);
  });

  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
