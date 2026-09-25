import { deepFreeze } from "../research-ledger/immutable";
import { stableHash, stableStringify } from "../research-ledger/stable";
export const STAGE_CACHE_VERSION = "stage-cache-v1" as const;
export interface StageCacheKeyInput {
  stage: string;
  inputHash: string;
  pipelineVersion: string;
  modelVersion: string;
  promptVersion: string;
  dataVersion: string;
}
export interface StageCacheEntry {
  version: typeof STAGE_CACHE_VERSION;
  key: string;
  stage: string;
  inputHash: string;
  pipelineVersion: string;
  modelVersion: string;
  promptVersion: string;
  dataVersion: string;
  outputHash: string;
  output: unknown;
  dependencies: Record<string, string>;
  createdAt: string;
  hits: number;
}
export interface StageCacheSnapshot {
  version: typeof STAGE_CACHE_VERSION;
  entries: StageCacheEntry[];
}
export function stageCacheKey(input: StageCacheKeyInput): string {
  const normalized = {
    stage: String(input.stage).trim().toLowerCase(),
    inputHash: String(input.inputHash).trim().toLowerCase(),
    pipelineVersion: String(input.pipelineVersion).trim(),
    modelVersion: String(input.modelVersion).trim(),
    promptVersion: String(input.promptVersion).trim(),
    dataVersion: String(input.dataVersion).trim()
  };
  return stableHash(normalized, "research-runs/stage-cache/v1");
}
function sanitizeStageValue(value: unknown, ancestors: Set<object> = new Set<object>()): unknown {
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
    if (Array.isArray(value)) return (value as unknown[]).map((entry) => sanitizeStageValue(entry, ancestors));
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      if (typeof record[key] === "function") continue;
      out[key] = sanitizeStageValue(record[key], ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value as object);
  }
}
export function hashStageInput(value: unknown): string {
  return stableHash(sanitizeStageValue(value ?? null), "research-runs/stage-input/v1");
}
export class ServerStageCache {
  private entries = new Map<string, StageCacheEntry>();
  get(input: StageCacheKeyInput): StageCacheEntry | null {
    const key = stageCacheKey(input);
    const entry = this.entries.get(key);
    if (!entry) return null;
    const updated: StageCacheEntry = { ...entry, hits: entry.hits + 1 };
    this.entries.set(key, updated);
    return updated;
  }
  peek(input: StageCacheKeyInput): StageCacheEntry | null {
    const key = stageCacheKey(input);
    return this.entries.get(key) ?? null;
  }
  set(input: StageCacheKeyInput, output: unknown, dependencies: Record<string, string> = {}, createdAt?: string): StageCacheEntry {
    const key = stageCacheKey(input);
    const sanitized = sanitizeStageValue(output ?? null);
    const serialized = stableStringify(sanitized);
    const outputHash = stableHash(serialized === undefined ? null : JSON.parse(serialized) as unknown, "research-runs/stage-output/v1");
    const entry: StageCacheEntry = deepFreeze({
      version: STAGE_CACHE_VERSION,
      key,
      stage: String(input.stage).trim().toLowerCase(),
      inputHash: String(input.inputHash).trim().toLowerCase(),
      pipelineVersion: String(input.pipelineVersion).trim(),
      modelVersion: String(input.modelVersion).trim(),
      promptVersion: String(input.promptVersion).trim(),
      dataVersion: String(input.dataVersion).trim(),
      outputHash,
      output: serialized === undefined ? null : (JSON.parse(serialized) as unknown),
      dependencies: { ...dependencies },
      createdAt: typeof createdAt === "string" ? createdAt : new Date().toISOString(),
      hits: 0
    }) as StageCacheEntry;
    this.entries.set(key, entry);
    return entry;
  }
  isDirty(input: StageCacheKeyInput, currentDependencies: Record<string, string> = {}): boolean {
    const entry = this.peek(input);
    if (!entry) return true;
    for (const key of Object.keys(currentDependencies)) {
      if (entry.dependencies[key] !== currentDependencies[key]) return true;
    }
    for (const key of Object.keys(entry.dependencies)) {
      if (!(key in currentDependencies)) return true;
    }
    return false;
  }
  invalidateStage(stage: string): number {
    const normalized = String(stage).trim().toLowerCase();
    let removed = 0;
    for (const [key, entry] of [...this.entries]) {
      if (entry.stage === normalized) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
  clear(): void {
    this.entries.clear();
  }
  size(): number {
    return this.entries.size;
  }
  snapshot(): StageCacheSnapshot {
    return deepFreeze({ version: STAGE_CACHE_VERSION, entries: [...this.entries.values()] }) as StageCacheSnapshot;
  }
  restore(snapshot: StageCacheSnapshot): void {
    this.entries.clear();
    if (!snapshot || (snapshot as StageCacheSnapshot).version !== STAGE_CACHE_VERSION) return;
    for (const entry of (snapshot as StageCacheSnapshot).entries ?? []) {
      if (entry && typeof entry.key === "string") this.entries.set(entry.key, entry);
    }
  }
}
export interface DurableCheckpoint {
  stage: string;
  status: string;
  at: string;
  detail?: string;
}
export function checkpointsFromDurableState(checkpoints: unknown): DurableCheckpoint[] {
  if (!Array.isArray(checkpoints)) return [];
  const out: DurableCheckpoint[] = [];
  for (const item of checkpoints) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.stage !== "string" || !record.stage.trim()) continue;
    if (typeof record.at !== "string" || !record.at.trim()) continue;
    out.push({
      stage: String(record.stage).trim().toLowerCase(),
      status: typeof record.status === "string" ? String(record.status) : "completed",
      at: String(record.at),
      ...(typeof record.detail === "string" && record.detail.trim() ? { detail: String(record.detail) } : {})
    });
  }
  const seen = new Set<string>();
  const deduped: DurableCheckpoint[] = [];
  for (const checkpoint of out) {
    const key = `${checkpoint.stage}:${checkpoint.status}:${checkpoint.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(checkpoint);
  }
  return deduped;
}
export function resumePlanFromCheckpoints(checkpoints: DurableCheckpoint[], orderedStages: string[]): { completed: string[]; remaining: string[] } {
  const completedSet = new Set(checkpoints.filter((c) => c.status === "completed").map((c) => c.stage));
  const completed: string[] = [];
  const remaining: string[] = [];
  for (const stage of orderedStages) {
    const normalized = String(stage).trim().toLowerCase();
    if (completedSet.has(normalized)) completed.push(normalized);
    else remaining.push(normalized);
  }
  return { completed, remaining };
}
export const globalStageCache = new ServerStageCache();
