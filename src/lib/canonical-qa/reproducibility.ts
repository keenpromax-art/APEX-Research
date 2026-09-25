import { deepFreeze } from "../research-ledger/immutable";
import { stableHash } from "../research-ledger/stable";
import { AI_FIRST_PROMPT_VERSION } from "../ai-first/llm";
import type { ReproducibilityMetadata } from "./types";
import { REPRODUCIBILITY_VERSION } from "./types";
function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function gitCommitOf(): string {
  const fromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    "";
  const trimmed = String(fromEnv).trim();
  if (/^[a-f0-9]{7,40}$/i.test(trimmed)) return trimmed.toLowerCase();
  return "unknown";
}
const VOLATILE_REPRO_KEYS = new Set(["researchRunId", "generationTimestamp", "generatedAt", "auditPackage", "auditPackageHash", "canonicalQa", "reproducibility", "qaDecision", "regenerationAttempts", "regenerationLog", "reviews", "reviewPassed", "reviewVersion"]);
function sanitizeForHash(value: unknown, ancestors: Set<object> = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value === "function") return null;
  if (typeof value === "symbol") return null;
  if (value instanceof Date) return value.toISOString();
  if (ancestors.has(value as object)) return null;
  ancestors.add(value as object);
  try {
    if (Array.isArray(value)) return (value as unknown[]).map((entry) => sanitizeForHash(entry, ancestors));
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (VOLATILE_REPRO_KEYS.has(key)) continue;
      if (record[key] === undefined) continue;
      if (typeof record[key] === "function") continue;
      out[key] = sanitizeForHash(record[key], ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value as object);
  }
}
export function hashDataSlice(value: unknown, domain: string): string {
  return stableHash(sanitizeForHash(value ?? null), domain);
}
export interface ReproducibilityInput {
  provider?: unknown;
  model?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  tokenBudget?: unknown;
  promptVersion?: unknown;
  promptText?: unknown;
  pipelineVersion?: unknown;
  factPackVersion?: unknown;
  factPack?: unknown;
  modelSpec?: unknown;
  assumptions?: unknown;
  forecast?: unknown;
  valuation?: unknown;
  report?: unknown;
  generatedAt?: unknown;
}
export function buildReproducibilityMetadata(input: ReproducibilityInput = {}): ReproducibilityMetadata {
  const generatedAt = text(input.generatedAt, new Date().toISOString());
  const promptText = text(input.promptText, text(input.promptVersion, AI_FIRST_PROMPT_VERSION));
  const metadata: ReproducibilityMetadata = {
    version: REPRODUCIBILITY_VERSION,
    gitCommit: gitCommitOf(),
    provider: text(input.provider, "mechanical"),
    model: text(input.model, "mechanical-preview"),
    temperature: finiteNumber(input.temperature, 0.3),
    maxTokens: Math.trunc(finiteNumber(input.maxTokens, 3000)),
    tokenBudget: Math.trunc(finiteNumber(input.tokenBudget, finiteNumber(input.maxTokens, 3000))),
    promptVersion: text(input.promptVersion, AI_FIRST_PROMPT_VERSION),
    promptHash: stableHash(promptText, "canonical-qa/prompt/v1"),
    pipelineVersion: text(input.pipelineVersion, "apex-ai-first-pipeline-v1"),
    factPackVersion: text(input.factPackVersion, "fact-pack-v1"),
    dataHash: hashDataSlice(input.factPack, "canonical-qa/data/v1"),
    factHash: hashDataSlice(input.factPack, "canonical-qa/fact/v1"),
    modelHash: hashDataSlice(input.modelSpec, "canonical-qa/model/v1"),
    assumptionHash: hashDataSlice(input.assumptions, "canonical-qa/assumptions/v1"),
    forecastHash: hashDataSlice(input.forecast, "canonical-qa/forecast/v1"),
    valuationHash: hashDataSlice(input.valuation, "canonical-qa/valuation/v1"),
    reportHash: hashDataSlice(input.report, "canonical-qa/report/v1"),
    generatedAt
  };
  return deepFreeze(metadata) as ReproducibilityMetadata;
}
export function verifyReproducibilityMetadata(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as ReproducibilityMetadata;
  if (candidate.version !== REPRODUCIBILITY_VERSION) return false;
  for (const key of ["dataHash", "factHash", "modelHash", "assumptionHash", "forecastHash", "valuationHash", "reportHash", "promptHash"] as const) {
    if (typeof candidate[key] !== "string" || (candidate[key] as string).length !== 64) return false;
  }
  if (typeof candidate.gitCommit !== "string" || candidate.gitCommit.length === 0) return false;
  if (typeof candidate.provider !== "string" || candidate.provider.length === 0) return false;
  if (typeof candidate.model !== "string" || candidate.model.length === 0) return false;
  return true;
}
export function hashReproducibilityMetadata(value: ReproducibilityMetadata): string {
  return stableHash(value, "canonical-qa/reproducibility/v1");
}
