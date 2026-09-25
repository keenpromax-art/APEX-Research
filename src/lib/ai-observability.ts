export interface TokenPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export type AiMetricAttribute = string | number | boolean | null;

export interface AiCallMetric {
  provider: string;
  model?: string;
  promptTokens?: number;
  inputTokens?: number;
  completionTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  costUsd?: number;
  pricing?: TokenPricing;
  success?: boolean;
  timestamp?: number;
  attributes?: Record<string, AiMetricAttribute>;
}

export interface NormalizedAiCallMetric {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
  success: boolean;
  timestamp: number;
  attributes: Record<string, AiMetricAttribute>;
}

export interface AiMetricsSummary {
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  averageCostUsd: number;
}

export interface AiMetricsSnapshot {
  recordedSamples: number;
  rejectedSamples: number;
  droppedSamples: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  totals: AiMetricsSummary;
  providers: Record<string, AiMetricsSummary>;
  models: Record<string, AiMetricsSummary>;
}

export interface AiMetricsCollectorOptions {
  maxSamples?: number;
}

const DEFAULT_MAX_SAMPLES = 10_000;
const MAX_COLLECTOR_SAMPLES = 100_000;
const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 8;
const MAX_REDACTED_ARRAY_ITEMS = 100;
const MAX_REDACTED_OBJECT_KEYS = 100;
const MAX_REDACTED_TEXT_LENGTH = 4_096;
const SECRET_KEY = /^(?:apikey|authorization|proxyauthorization|accesstoken|refreshtoken|idtoken|clientsecret|password|passwd|credential|cookie|setcookie|sessionid|token)$/i;
const REDACTION_PATTERNS: readonly RegExp[] = [
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{8,}\b/gi,
  /\bnvapi-[A-Za-z0-9_-]{8,}\b/gi,
  /\bgsk_[A-Za-z0-9_-]{8,}\b/gi,
  /\bAIza[A-Za-z0-9_-]{12,}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)\s*[=:]\s*["']?)[^"'\s,&}]+/gi,
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function truncateByCodePoint(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return Array.from(value).slice(0, maxLength).join("");
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key.replace(/[^A-Za-z0-9]/g, ""));
}

export function redactSensitiveText(
  input: unknown,
  secrets: readonly string[] = [],
  maxLength = MAX_REDACTED_TEXT_LENGTH
): string {
  if (typeof input !== "string") return "";
  let redacted = input;
  const literalSecrets = Array.from(new Set(secrets))
    .filter((secret) => typeof secret === "string" && secret.trim().length >= 4)
    .sort((left, right) => right.length - left.length);
  for (const secret of literalSecrets) {
    redacted = redacted.split(secret).join(REDACTED);
  }
  for (const pattern of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, REDACTED);
  }
  return truncateByCodePoint(redacted.replace(/[\u0000-\u001F\u007F-\u009F]/g, " "), Math.max(0, maxLength));
}

export function redactSensitiveData(
  value: unknown,
  secrets: readonly string[] = []
): unknown {
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number): unknown {
    if (current === null) return null;
    if (typeof current === "string") return redactSensitiveText(current, secrets);
    if (typeof current === "number") return Number.isFinite(current) ? current : null;
    if (typeof current === "boolean") return current;
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "undefined") return undefined;
    if (typeof current === "function") return "[Function]";
    if (typeof current === "symbol") return "[Symbol]";
    if (current instanceof Date) return current.toISOString();
    if (typeof current !== "object") return String(current);
    if (depth >= MAX_REDACTION_DEPTH) return "[Truncated]";
    if (seen.has(current)) return "[Circular]";
    seen.add(current);
    if (Array.isArray(current)) {
      const output = current
        .slice(0, MAX_REDACTED_ARRAY_ITEMS)
        .map((item) => visit(item, depth + 1));
      if (current.length > MAX_REDACTED_ARRAY_ITEMS) output.push("[Truncated]");
      return output;
    }
    if (!isPlainObject(current)) return `[${current.constructor?.name ?? "Object"}]`;
    const output: Record<string, unknown> = {};
    const entries = Object.entries(current);
    for (const [key, item] of entries.slice(0, MAX_REDACTED_OBJECT_KEYS)) {
      Object.defineProperty(output, key, {
        value: isSecretKey(key) ? REDACTED : visit(item, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (entries.length > MAX_REDACTED_OBJECT_KEYS) output.truncated = "[Truncated]";
    return output;
  }

  return visit(value, 0);
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function tokenValue(primary: unknown, alias: unknown): number | null {
  if (primary !== undefined) return nonnegativeNumber(primary);
  if (alias !== undefined) return nonnegativeNumber(alias);
  return 0;
}

function validPricing(value: unknown): value is TokenPricing {
  if (!isPlainObject(value)) return false;
  return (
    nonnegativeNumber(value.inputPerMillionUsd) !== null &&
    nonnegativeNumber(value.outputPerMillionUsd) !== null
  );
}

export function calculateTokenCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: TokenPricing
): number {
  if (!validPricing(pricing)) throw new RangeError("Token pricing must be finite and non-negative.");
  const input = nonnegativeNumber(inputTokens);
  const output = nonnegativeNumber(outputTokens);
  if (input === null || output === null) throw new RangeError("Token counts must be finite and non-negative.");
  return (input * pricing.inputPerMillionUsd + output * pricing.outputPerMillionUsd) / 1_000_000;
}

function safeDimension(value: unknown, fallback: string, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const redacted = redactSensitiveText(value.trim(), [], maxLength * 2);
  const cleaned = redacted.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === REDACTED) return fallback;
  return truncateByCodePoint(cleaned, maxLength);
}

function safeAttributes(value: unknown): Record<string, AiMetricAttribute> {
  if (!isPlainObject(value)) return {};
  const output: Record<string, AiMetricAttribute> = {};
  for (const [rawKey, item] of Object.entries(value).slice(0, 50)) {
    const key = truncateByCodePoint(rawKey.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""), 64);
    if (!key) continue;
    const safeValue: AiMetricAttribute = isSecretKey(key)
      ? REDACTED
      : item === null || typeof item === "boolean"
        ? item
        : typeof item === "number"
          ? Number.isFinite(item) ? item : null
          : typeof item === "string"
            ? truncateByCodePoint(redactSensitiveText(item, [], 512), 512)
            : null;
    Object.defineProperty(output, key, {
      value: safeValue,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

export function normalizeAiCallMetric(value: unknown): NormalizedAiCallMetric | null {
  if (!isPlainObject(value)) return null;
  const provider = safeDimension(value.provider, "", 80);
  if (!provider) return null;
  const model = safeDimension(value.model, "unknown", 160) ?? "unknown";
  const inputTokens = tokenValue(value.inputTokens, value.promptTokens);
  const outputTokens = tokenValue(value.outputTokens, value.completionTokens);
  if (inputTokens === null || outputTokens === null) return null;
  const suppliedTotal = value.totalTokens === undefined ? 0 : nonnegativeNumber(value.totalTokens);
  if (suppliedTotal === null) return null;
  const totalTokens = Math.max(suppliedTotal, inputTokens + outputTokens);
  const latencyMs = nonnegativeNumber(value.latencyMs);
  if (latencyMs === null) return null;
  if (value.success !== undefined && typeof value.success !== "boolean") return null;
  const success = value.success ?? true;

  let costUsd = nonnegativeNumber(value.costUsd);
  if (value.costUsd !== undefined && costUsd === null) return null;
  if (costUsd === null) {
    if (value.pricing !== undefined) {
      if (!validPricing(value.pricing)) return null;
      costUsd = calculateTokenCostUsd(inputTokens, outputTokens, value.pricing);
    } else {
      costUsd = 0;
    }
  }

  const timestamp = nonnegativeNumber(value.timestamp) ?? Date.now();
  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs,
    costUsd,
    success,
    timestamp,
    attributes: safeAttributes(value.attributes),
  };
}

function emptySummary(): AiMetricsSummary {
  return {
    calls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    successRate: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalLatencyMs: 0,
    averageLatencyMs: 0,
    minLatencyMs: 0,
    maxLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    totalCostUsd: 0,
    averageCostUsd: 0,
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarize(metrics: readonly NormalizedAiCallMetric[]): AiMetricsSummary {
  const summary = emptySummary();
  if (metrics.length === 0) return summary;
  const latencies: number[] = [];
  for (const metric of metrics) {
    summary.calls += 1;
    if (metric.success) summary.successfulCalls += 1;
    else summary.failedCalls += 1;
    summary.inputTokens += metric.inputTokens;
    summary.outputTokens += metric.outputTokens;
    summary.totalTokens += metric.totalTokens;
    summary.totalLatencyMs += metric.latencyMs;
    summary.totalCostUsd += metric.costUsd;
    latencies.push(metric.latencyMs);
  }
  latencies.sort((left, right) => left - right);
  summary.successRate = summary.successfulCalls / summary.calls;
  summary.averageLatencyMs = summary.totalLatencyMs / summary.calls;
  summary.minLatencyMs = latencies[0];
  summary.maxLatencyMs = latencies[latencies.length - 1];
  summary.p50LatencyMs = percentile(latencies, 0.5);
  summary.p95LatencyMs = percentile(latencies, 0.95);
  summary.averageCostUsd = summary.totalCostUsd / summary.calls;
  return summary;
}

function setRecordValue(
  target: Record<string, AiMetricsSummary>,
  key: string,
  value: AiMetricsSummary
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export class AiMetricsCollector {
  private readonly maxSamples: number;
  private samples: NormalizedAiCallMetric[] = [];
  private rejectedSamples = 0;
  private droppedSamples = 0;

  constructor(options: AiMetricsCollectorOptions = {}) {
    const requested = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.maxSamples = Number.isFinite(requested)
      ? Math.max(1, Math.min(Math.trunc(requested), MAX_COLLECTOR_SAMPLES))
      : DEFAULT_MAX_SAMPLES;
  }

  record(metric: AiCallMetric | unknown): boolean {
    const normalized = normalizeAiCallMetric(metric);
    if (!normalized) {
      this.rejectedSamples += 1;
      return false;
    }
    if (this.samples.length >= this.maxSamples) {
      this.samples.shift();
      this.droppedSamples += 1;
    }
    this.samples.push(normalized);
    return true;
  }

  snapshot(): AiMetricsSnapshot {
    const providerMetrics = new Map<string, NormalizedAiCallMetric[]>();
    const modelMetrics = new Map<string, NormalizedAiCallMetric[]>();
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    for (const metric of this.samples) {
      firstTimestamp = firstTimestamp === null ? metric.timestamp : Math.min(firstTimestamp, metric.timestamp);
      lastTimestamp = lastTimestamp === null ? metric.timestamp : Math.max(lastTimestamp, metric.timestamp);
      const providerKey = metric.provider;
      const modelKey = `${metric.provider}/${metric.model}`;
      const providerGroup = providerMetrics.get(providerKey) ?? [];
      const modelGroup = modelMetrics.get(modelKey) ?? [];
      providerGroup.push(metric);
      modelGroup.push(metric);
      providerMetrics.set(providerKey, providerGroup);
      modelMetrics.set(modelKey, modelGroup);
    }
    const providers: Record<string, AiMetricsSummary> = {};
    const models: Record<string, AiMetricsSummary> = {};
    for (const [provider, metrics] of providerMetrics) setRecordValue(providers, provider, summarize(metrics));
    for (const [model, metrics] of modelMetrics) setRecordValue(models, model, summarize(metrics));
    return {
      recordedSamples: this.samples.length,
      rejectedSamples: this.rejectedSamples,
      droppedSamples: this.droppedSamples,
      firstTimestamp,
      lastTimestamp,
      totals: summarize(this.samples),
      providers,
      models,
    };
  }

  reset(): void {
    this.samples = [];
    this.rejectedSamples = 0;
    this.droppedSamples = 0;
  }
}

export function aggregateAiMetrics(
  metrics: Iterable<unknown>,
  options: AiMetricsCollectorOptions = {}
): AiMetricsSnapshot {
  const collector = new AiMetricsCollector(options);
  for (const metric of metrics) collector.record(metric);
  return collector.snapshot();
}
