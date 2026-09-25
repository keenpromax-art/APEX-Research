import assert from "node:assert/strict";
import {
  AiMetricsCollector,
  aggregateAiMetrics,
  calculateTokenCostUsd,
  normalizeAiCallMetric,
  redactSensitiveData,
  redactSensitiveText,
} from "../src/lib/ai-observability";

const privateKey = "sk-or-v1-private_test-key_123456";
const redactedText = redactSensitiveText(`Authorization: Bearer ${privateKey}; apiKey=${privateKey}`);
assert.doesNotMatch(redactedText, new RegExp(privateKey));
assert.match(redactedText, /\[REDACTED\]/);

const circular: Record<string, unknown> = {
  apiKey: privateKey,
  nested: { refresh_token: "refresh-secret", safe: `used ${privateKey}` },
};
circular.self = circular;
const redactedData = redactSensitiveData(circular) as Record<string, unknown>;
assert.equal(redactedData.apiKey, "[REDACTED]");
assert.equal((redactedData.nested as Record<string, unknown>).refresh_token, "[REDACTED]");
assert.equal(redactedData.self, "[Circular]");
assert.doesNotMatch(JSON.stringify(redactedData), /private_test-key|refresh-secret/);

const normalized = normalizeAiCallMetric({
  provider: "openai",
  model: "gpt-test",
  inputTokens: 100,
  outputTokens: 50,
  latencyMs: 250,
  attributes: { apiKey: privateKey, requestId: "abc", attempt: 2 },
  timestamp: 100,
});
assert.ok(normalized);
assert.equal(normalized?.attributes.apiKey, "[REDACTED]");
assert.equal(normalized?.totalTokens, 150);

const snapshot = aggregateAiMetrics([
  {
    provider: "openai",
    model: "gpt-test",
    inputTokens: 1_000,
    outputTokens: 500,
    latencyMs: 100,
    costUsd: 0.01,
    success: true,
    timestamp: 100,
  },
  {
    provider: "openai",
    model: "gpt-test",
    inputTokens: 2_000,
    outputTokens: 1_000,
    latencyMs: 300,
    costUsd: 0.02,
    success: false,
    timestamp: 200,
  },
  {
    provider: "groq",
    model: "llama-test",
    promptTokens: 100,
    completionTokens: 50,
    latencyMs: 50,
    pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
    timestamp: 300,
  },
]);

assert.equal(snapshot.recordedSamples, 3);
assert.equal(snapshot.firstTimestamp, 100);
assert.equal(snapshot.lastTimestamp, 300);
assert.equal(snapshot.totals.calls, 3);
assert.equal(snapshot.totals.successfulCalls, 2);
assert.equal(snapshot.totals.failedCalls, 1);
assert.equal(snapshot.totals.successRate, 2 / 3);
assert.equal(snapshot.totals.inputTokens, 3_100);
assert.equal(snapshot.totals.outputTokens, 1_550);
assert.equal(snapshot.totals.totalTokens, 4_650);
assert.equal(snapshot.totals.averageLatencyMs, 150);
assert.equal(snapshot.totals.p50LatencyMs, 100);
assert.equal(snapshot.totals.p95LatencyMs, 300);
assert.ok(Math.abs(snapshot.totals.totalCostUsd - 0.0302) < 1e-12);
assert.equal(snapshot.providers.openai.calls, 2);
assert.equal(snapshot.providers.groq.calls, 1);
assert.equal(snapshot.models["openai/gpt-test"].calls, 2);
assert.ok(Math.abs(calculateTokenCostUsd(1_000_000, 500_000, { inputPerMillionUsd: 2, outputPerMillionUsd: 4 }) - 4) < 1e-12);

const bounded = new AiMetricsCollector({ maxSamples: 2 });
assert.equal(bounded.record({ provider: "one", latencyMs: 1, timestamp: 1 }), true);
assert.equal(bounded.record({ provider: "two", latencyMs: 2, timestamp: 2 }), true);
assert.equal(bounded.record({ provider: "three", latencyMs: 3, timestamp: 3 }), true);
assert.equal(bounded.record({ provider: "bad", latencyMs: -1 }), false);
const boundedSnapshot = bounded.snapshot();
assert.equal(boundedSnapshot.recordedSamples, 2);
assert.equal(boundedSnapshot.droppedSamples, 1);
assert.equal(boundedSnapshot.rejectedSamples, 1);
assert.equal(boundedSnapshot.totals.calls, 2);
assert.equal(boundedSnapshot.providers.one, undefined);
assert.equal(boundedSnapshot.providers.three.calls, 1);
bounded.reset();
assert.equal(bounded.snapshot().totals.calls, 0);

console.log("ai-observability tests passed");
