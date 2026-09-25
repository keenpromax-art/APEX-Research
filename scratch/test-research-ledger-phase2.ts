import assert from "node:assert/strict";
import {
  InMemoryResearchLedgerRepository,
  RunIdCollisionError,
  classifyThesisBreak,
  createResearchEvent,
  createResearchRunEnvelope,
  createUnknownRegistry,
  diffThesisFields,
  issueCanonicalForecast,
  issueForecast,
  rankAnalogueEvents,
  registerUnknown,
  scoreForecastActual,
  scoreForecastActuals,
  sha256,
  stableHash,
  stableStringify,
  transitionUnknown,
  verifyResearchRunEnvelope,
  verifyUnknownRegistry,
  type ResearchEvent,
  type ResearchRunInput,
  type ThesisSnapshot,
} from "../src/lib/research-ledger";
import type { CanonicalForecast } from "../src/lib/canonical-forecast";

let passed = 0;
let failed = 0;

function check(name: string, assertion: () => void): void {
  try {
    assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runInput(overrides: Partial<ResearchRunInput> = {}): ResearchRunInput {
  return {
    company: { id: "IN:RELIANCE", ticker: "RELIANCE.NS", name: "Reliance Industries" },
    occurredAt: "2026-01-01T00:00:00.000Z",
    dataCutoff: "2025-12-31T23:59:59.000Z",
    pipelineVersion: "research-pipeline-v1",
    modelVersion: "test-model-v1",
    payload: { thesis: { thesis: "Durable digital-led growth" } },
    ...overrides,
  };
}

function thesis(overrides: Partial<Record<string, unknown>> = {}): ThesisSnapshot {
  return {
    thesis: "Digital scale compounds distribution economics",
    bullCase: ["Distribution reaches new cohorts"],
    bearCase: ["Returns fail to improve"],
    keyDebate: "Can digital economics offset legacy pressure?",
    keyInflectionPoints: ["Digital mix"],
    whatMarketMayBeMissing: "Cross-sell optionality",
    whatCouldInvalidate: ["Active users decline"],
    ...overrides,
  };
}

function event(id: string, company: string, summary: string, tags: string[], occurredAt: string): ResearchEvent {
  return createResearchEvent({ eventId: id, type: "earnings", company, summary, tags, occurredAt });
}

console.log("RESEARCH LEDGER PHASE 2 TESTS");

check("stable serialization orders object keys", () => {
  assert.equal(stableStringify({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

check("run envelopes are content-addressed and deeply immutable", () => {
  const payload = { nested: { values: [3, 2, 1] } };
  const first = createResearchRunEnvelope(runInput({ payload }));
  const second = createResearchRunEnvelope(runInput({ payload: { nested: { values: [3, 2, 1] } } }));
  assert.equal(first.runId, second.runId);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(verifyResearchRunEnvelope(first), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload.nested), true);
  assert.equal(Object.isFrozen(payload), false);
});

check("repository append is idempotent and rejects ID collisions", () => {
  const repository = new InMemoryResearchLedgerRepository();
  const first = repository.appendRun(runInput());
  const duplicate = repository.appendRun(runInput());
  assert.equal(first.appended, true);
  assert.equal(duplicate.appended, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(repository.runCount, 1);
  assert.equal(repository.eventCount, 1);
  assert.throws(
    () => repository.appendRun(runInput({ runId: first.run.runId, payload: { thesis: { thesis: "Changed" } } })),
    RunIdCollisionError,
  );
});

check("repository event history is append-only and filterable", () => {
  const repository = new InMemoryResearchLedgerRepository();
  const appended = repository.appendRun(runInput());
  const input = {
    type: "forecast-issued",
    company: "IN:RELIANCE",
    runId: appended.run.runId,
    occurredAt: "2026-01-02T00:00:00.000Z",
    summary: "FY27 revenue forecast issued",
    tags: ["revenue", "forecast"],
  };
  const first = repository.appendEvent(input);
  const duplicate = repository.appendEvent(input);
  assert.equal(first.appended, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(repository.eventCount, 2);
  assert.equal(repository.getEventHistory({ companyId: "IN:RELIANCE" }).length, 2);
  assert.equal(repository.getEventHistory({ type: "forecast-issued" }).length, 1);
  assert.deepEqual(repository.history().map((entry) => entry.sequence), [1, 2]);
});

check("thesis field diff and break classification are deterministic", () => {
  const previous = thesis();
  const material = thesis({ keyDebate: "Can digital scale offset legacy pressure?" });
  const diff = diffThesisFields(previous, material, { fromRunId: "RUN-1", toRunId: "RUN-2" });
  assert.deepEqual(diff.changedFields, ["keyDebate"]);
  assert.equal(diff.changes[0]?.kind, "changed");
  const classification = classifyThesisBreak({ previous, current: material, invalidationSignals: [] });
  assert.equal(classification.classification, "material-break");
  assert.equal(classification.isBreak, true);
  assert.equal(Object.isFrozen(diff), true);
  assert.equal(classifyThesisBreak({ previous, current: previous }).classification, "intact");
  assert.equal(
    classifyThesisBreak({ previous, current: previous, invalidationSignals: ["active users declined"] }).classification,
    "invalidated",
  );
});

check("forecast issuance and range scoring are deterministic", () => {
  const range = issueForecast({
    companyId: "IN:RELIANCE",
    runId: "RUN-1",
    period: "FY2027",
    metric: "revenue",
    range: { low: 900, high: 1_100 },
    issuedAt: "2026-01-01T00:00:00.000Z",
  });
  const hit = scoreForecastActual(range, {
    value: 1_000,
    period: "FY2027",
    metric: "revenue",
    observedAt: "2027-03-31T00:00:00.000Z",
  });
  const miss = scoreForecastActual(range, {
    value: 1_200,
    period: "FY2027",
    metric: "revenue",
    observedAt: "2027-03-31T00:00:00.000Z",
  });
  assert.equal(hit.status, "hit");
  assert.equal(hit.reason, "within-range");
  assert.equal(miss.status, "miss");
  assert.equal(miss.reason, "above-range");
  assert.equal(Object.isFrozen(range), true);
  assert.equal(Object.isFrozen(hit), true);
  assert.throws(() => issueForecast({
    companyId: "IN:RELIANCE",
    runId: "RUN-1",
    period: "FY2027",
    metric: "revenue",
    range: { low: 100, high: 90 },
    issuedAt: "2026-01-01T00:00:00.000Z",
  }), RangeError);
});

check("zero denominators and missing actuals never produce invalid scores", () => {
  const zero = issueForecast({
    companyId: "IN:RELIANCE",
    runId: "RUN-1",
    period: "FY2027",
    metric: "margin",
    point: 0,
    issuedAt: "2026-01-01T00:00:00.000Z",
  });
  const exactZero = scoreForecastActual(zero, { value: 0, observedAt: "2027-03-31T00:00:00.000Z" });
  const nonZero = scoreForecastActual(zero, { value: 5, observedAt: "2027-03-31T00:00:00.000Z" });
  const missing = scoreForecastActual(zero, null);
  assert.equal(exactZero.status, "hit");
  assert.equal(exactZero.relativeError, null);
  assert.equal(nonZero.status, "miss");
  assert.equal(nonZero.relativeError, 1);
  assert.equal(Number.isFinite(nonZero.normalizedError ?? Number.NaN), true);
  assert.equal(missing.status, "missing");
  assert.equal(missing.score, null);
  assert.deepEqual(scoreForecastActuals([zero], []).map((score) => score.reason), ["actual-missing"]);
});

check("canonical forecast rows can issue ledger forecasts", () => {
  const canonical = {
    projections: [{ year: 2027, label: "FY27E", revenue: 1_050 }],
  } as unknown as CanonicalForecast;
  const forecast = issueCanonicalForecast({
    companyId: "IN:RELIANCE",
    runId: "RUN-1",
    forecast: canonical,
    metric: "revenue",
    period: "FY27E",
    issuedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(forecast.expectation.kind, "point");
  assert.equal(forecast.expectation.kind === "point" ? forecast.expectation.value : null, 1_050);
});

check("unknown registry enforces valid lifecycle transitions", () => {
  const initial = createUnknownRegistry("IN:RELIANCE");
  const registered = registerUnknown(initial, {
    statement: "Digital ARPU trajectory is not yet disclosed",
    source: "data-gap",
    evidenceNeeded: "Segment disclosure",
    registeredAt: "2026-01-01T00:00:00.000Z",
  });
  const duplicate = registerUnknown(registered.registry, {
    statement: "Digital ARPU trajectory is not yet disclosed",
    source: "data-gap",
    evidenceNeeded: "Segment disclosure",
    registeredAt: "2026-01-01T00:00:00.000Z",
  });
  const started = transitionUnknown(registered.registry, {
    unknownId: registered.entry.unknownId,
    action: "start",
    at: "2026-01-02T00:00:00.000Z",
    reason: "Investigation opened",
  });
  const resolved = transitionUnknown(started.registry, {
    unknownId: registered.entry.unknownId,
    action: "resolve",
    at: "2026-01-03T00:00:00.000Z",
    reason: "Disclosure found",
    evidenceIds: ["EV-1"],
  });
  const repeatedResolution = transitionUnknown(resolved.registry, {
    unknownId: registered.entry.unknownId,
    action: "resolve",
    at: "2026-01-03T00:00:00.000Z",
    reason: "Disclosure found",
    evidenceIds: ["EV-1"],
  });
  const reopened = transitionUnknown(resolved.registry, {
    unknownId: registered.entry.unknownId,
    action: "reopen",
    at: "2026-01-04T00:00:00.000Z",
    reason: "New disclosure changes interpretation",
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(started.entry.status, "investigating");
  assert.equal(resolved.entry.status, "resolved");
  assert.equal(repeatedResolution.duplicate, true);
  assert.equal(reopened.entry.status, "open");
  assert.equal(verifyUnknownRegistry(reopened.registry), true);
  assert.throws(() => transitionUnknown(reopened.registry, {
    unknownId: registered.entry.unknownId,
    action: "reopen",
    at: "2026-01-05T00:00:00.000Z",
    reason: "Already open",
  }), /not valid/);
});

check("same-company analogue ranking refuses insufficient samples", () => {
  const target = event("EVT-TARGET", "IN:RELIANCE", "Digital monetization inflection", ["digital", "monetization"], "2026-06-01T00:00:00.000Z");
  const first = event("EVT-1", "IN:RELIANCE", "Digital monetization improves", ["digital", "monetization"], "2025-01-01T00:00:00.000Z");
  const second = event("EVT-2", "IN:RELIANCE", "Legacy pressure persists", ["legacy"], "2024-01-01T00:00:00.000Z");
  const third = event("EVT-3", "IN:RELIANCE", "Digital monetization resets", ["digital", "pricing"], "2023-01-01T00:00:00.000Z");
  const other = event("EVT-4", "IN:OTHER", "Digital monetization inflection", ["digital", "monetization"], "2025-01-01T00:00:00.000Z");
  const insufficient = rankAnalogueEvents(target, [first, second, other]);
  assert.equal(insufficient.accepted, false);
  assert.equal(insufficient.status, "insufficient-samples");
  assert.equal(insufficient.sameCompanySampleCount, 2);
  assert.equal(insufficient.rankings.length, 0);
  const ranked = rankAnalogueEvents(target, [other, third, second, first]);
  const reversed = rankAnalogueEvents(target, [first, second, third, other]);
  assert.equal(ranked.accepted, true);
  assert.equal(ranked.sameCompanySampleCount, 3);
  assert.equal(ranked.rankings[0]?.event.eventId, "EVT-1");
  assert.equal(JSON.stringify(ranked), JSON.stringify(reversed));
});

console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
