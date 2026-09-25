export type VolatileKey =
  | "generationTimestamp"
  | "generatedAt"
  | "retrievalTimestamp"
  | "asOfTimestamp"
  | "at"
  | "occurredAt"
  | "researchRunId"
  | "runId"
  | "factPackId"
  | "contentHash"
  | "packageHash"
  | "reportHash"
  | "inputHash"
  | "outputHash"
  | "auditHash"
  | "durationMs"
  | "latencyMs"
  | "provider"
  | "model"
  | "transport"
  | "promptVersion"
  | "modelVersion";

const VOLATILE_KEYS = new Set<string>([
  "generationTimestamp",
  "generatedAt",
  "retrievalTimestamp",
  "asOfTimestamp",
  "retrievedAt",
  "asOf",
  "now",
  "at",
  "occurredAt",
  "completedAt",
  "researchRunId",
  "runId",
  "factPackId",
  "contentHash",
  "packageHash",
  "reportHash",
  "inputHash",
  "outputHash",
  "auditHash",
  "idempotencyKey",
  "durationMs",
  "latencyMs",
  "elapsedMs",
  "provider",
  "providerId",
  "model",
  "modelId",
  "transport",
  "promptVersion",
  "modelVersion",
  "reviewVersion",
  "factPackVersion",
  "forecastVersion",
  "valuationVersion",
  "pipelineVersion",
  "dataVersion",
]);

const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;
const RUN_ID_PATTERN = /\b(RUN-|FACTPACK-|FCST-|VALSPEC-|MODEL-|REVPLAN-)[A-Z0-9_-]+\b/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HASH64_PATTERN = /\b[0-9a-f]{64}\b/gi;

export function normalizeStructural(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(TIMESTAMP_PATTERN, "<TIMESTAMP>")
      .replace(RUN_ID_PATTERN, "<RUNID>")
      .replace(UUID_PATTERN, "<UUID>")
      .replace(HASH64_PATTERN, "<HASH>");
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeStructural);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(key)) {
        out[key] = "<STRIPPED>";
        continue;
      }
      const lowered = key.toLowerCase();
      if (lowered.includes("timestamp") || lowered.includes("latency") || lowered.includes("duration") || lowered.includes("provider")) {
        out[key] = "<STRIPPED>";
        continue;
      }
      out[key] = normalizeStructural(entry);
    }
    return out;
  }
  return value;
}

export function structuralHash(value: unknown): string {
  const normalized = normalizeStructural(value);
  const text = JSON.stringify(normalized);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function isNormalizedDeterministic(first: unknown, second: unknown): boolean {
  return JSON.stringify(normalizeStructural(first)) === JSON.stringify(normalizeStructural(second));
}
