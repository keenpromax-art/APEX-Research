import { deepFreeze } from "../research-ledger/immutable";
import { compareStableStrings, stableHash, stableStringify } from "../research-ledger/stable";
import type { LongitudinalMemoryEntry, ResearchUpdateMode, WhatChangedDelta, WhatChangedReport } from "./types";
import { RESEARCH_MEMORY_VERSION } from "./types";
export const RESEARCH_UPDATE_MODES: ResearchUpdateMode[] = ["initiation", "update", "event", "thesis-change", "deep-dive"];
export const MEMORY_SNAPSHOT_FIELDS = ["thesis", "valuation", "forecast", "assumptions", "risks", "catalysts", "guidance", "unknowns", "evidence"] as const;
export type MemorySnapshotField = (typeof MEMORY_SNAPSHOT_FIELDS)[number];
function sanitizeClone(value: unknown, ancestors: Set<object> = new Set<object>()): unknown {
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
    if (Array.isArray(value)) return (value as unknown[]).map((entry) => sanitizeClone(entry, ancestors));
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      if (typeof record[key] === "function") continue;
      out[key] = sanitizeClone(record[key], ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value as object);
  }
}
function cloneJson(value: unknown): unknown {
  const sanitized = sanitizeClone(value ?? null);
  const serialized = stableStringify(sanitized);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as unknown;
}
function hashSanitized(value: unknown, domain: string): string {
  return stableHash(sanitizeClone(value ?? null), domain);
}
function fieldOf(snapshot: Record<string, unknown>, field: string): unknown {
  return snapshot[field] ?? null;
}
export function diffSnapshots(previous: Record<string, unknown> | null, current: Record<string, unknown>): WhatChangedDelta[] {
  const fields = new Set<string>();
  if (previous) for (const key of Object.keys(previous)) fields.add(key);
  for (const key of Object.keys(current)) fields.add(key);
  const deltas: WhatChangedDelta[] = [];
  for (const field of [...fields].sort(compareStableStrings)) {
    const before = previous ? fieldOf(previous, field) : undefined;
    const after = fieldOf(current, field);
    const beforeSer = previous ? stableStringify(before) : undefined;
    const afterSer = stableStringify(after);
    if (beforeSer === afterSer) {
      deltas.push({ field, kind: "unchanged", beforeHash: beforeSer !== undefined ? stableHash(before, "research-memory/field/v1") : null, afterHash: afterSer !== undefined ? stableHash(after, "research-memory/field/v1") : null, before: cloneJson(before), after: cloneJson(after) });
      continue;
    }
    let kind: WhatChangedDelta["kind"] = "changed";
    if (previous && !(field in (previous as Record<string, unknown>))) kind = "added";
    else if (!(field in current)) kind = "removed";
    deltas.push({
      field,
      kind,
      beforeHash: previous && field in (previous as Record<string, unknown>) ? hashSanitized(before, "research-memory/field/v1") : null,
      afterHash: field in current ? hashSanitized(after, "research-memory/field/v1") : null,
      before: previous ? cloneJson(before) : null,
      after: cloneJson(after)
    });
  }
  return deltas;
}
export function buildWhatChangedReport(input: {
  previousSnapshot?: Record<string, unknown> | null;
  currentSnapshot: Record<string, unknown>;
  fromRunId?: string | null;
  toRunId: string;
  mode: ResearchUpdateMode;
  generatedAt?: string;
}): WhatChangedReport {
  const generatedAt = typeof input.generatedAt === "string" && input.generatedAt.trim().length > 0 ? input.generatedAt : new Date().toISOString();
  const deltas = diffSnapshots(input.previousSnapshot ?? null, input.currentSnapshot);
  const changedFields = deltas.filter((d) => d.kind !== "unchanged").map((d) => d.field);
  const hash = hashSanitized({ fromRunId: input.fromRunId ?? null, toRunId: input.toRunId, mode: input.mode, deltas: deltas.map((d) => ({ field: d.field, kind: d.kind, beforeHash: d.beforeHash, afterHash: d.afterHash })) }, "research-memory/delta/v1");
  return deepFreeze({
    version: RESEARCH_MEMORY_VERSION,
    fromRunId: input.fromRunId ?? null,
    toRunId: input.toRunId,
    mode: input.mode,
    generatedAt,
    deltas,
    changedFields,
    hasChanges: changedFields.length > 0,
    hash
  }) as WhatChangedReport;
}
export function deriveUpdateMode(input: {
  previousRunId?: string | null;
  thesisBreak?: unknown;
  eventIds?: unknown;
  deepDive?: unknown;
}): ResearchUpdateMode {
  if (!input.previousRunId) return "initiation";
  if (input.deepDive === true) return "deep-dive";
  const thesis = input.thesisBreak as { isBreak?: boolean; classification?: string } | null | undefined;
  if (thesis && (thesis.isBreak === true || thesis.classification === "material-break" || thesis.classification === "invalidated")) return "thesis-change";
  if (Array.isArray(input.eventIds) && (input.eventIds as unknown[]).length > 0) return "event";
  return "update";
}
export function snapshotForMemory(input: {
  thesis?: unknown;
  valuation?: unknown;
  forecast?: unknown;
  assumptions?: unknown;
  risks?: unknown;
  catalysts?: unknown;
  guidance?: unknown;
  unknowns?: unknown;
  evidence?: unknown;
}): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of MEMORY_SNAPSHOT_FIELDS) {
    (snapshot as Record<string, unknown>)[field] = cloneJson((input as Record<string, unknown>)[field] ?? null);
  }
  return snapshot;
}
export function appendLongitudinalMemory(input: {
  store: LongitudinalMemoryEntry[];
  companyId: string;
  runId: string;
  mode: ResearchUpdateMode;
  occurredAt: string;
  dataCutoff: string;
  snapshot: Record<string, unknown>;
  generatedAt?: string;
}): { entry: LongitudinalMemoryEntry; store: LongitudinalMemoryEntry[]; delta: WhatChangedReport } {
  const trimmedCompany = String(input.companyId).trim();
  const trimmedRun = String(input.runId).trim();
  if (!trimmedCompany) throw new TypeError("companyId is required");
  if (!trimmedRun) throw new TypeError("runId is required");
  const companyEntries = input.store.filter((e) => e.companyId === trimmedCompany);
  const previous = companyEntries.length > 0 ? companyEntries[companyEntries.length - 1] as LongitudinalMemoryEntry : null;
  const lineage = previous ? [...previous.lineage, previous.runId] : [];
  const snapshot = cloneJson(input.snapshot) as Record<string, unknown>;
  const snapshotHash = hashSanitized(snapshot, "research-memory/snapshot/v1");
  const delta = buildWhatChangedReport({ previousSnapshot: previous ? (cloneJson(previous.snapshot) as Record<string, unknown>) : null, currentSnapshot: snapshot, fromRunId: previous ? previous.runId : null, toRunId: trimmedRun, mode: input.mode, generatedAt: input.generatedAt });
  const status = previous ? (delta.hasChanges ? "updated" : "unchanged") : "initiated";
  const contentHash = hashSanitized({ companyId: trimmedCompany, runId: trimmedRun, mode: input.mode, occurredAt: input.occurredAt, dataCutoff: input.dataCutoff, previousRunId: previous ? previous.runId : null, snapshotHash, deltaHash: delta.hash }, "research-memory/entry/v1");
  const entry = deepFreeze({
    version: RESEARCH_MEMORY_VERSION,
    companyId: trimmedCompany,
    runId: trimmedRun,
    mode: input.mode,
    occurredAt: input.occurredAt,
    dataCutoff: input.dataCutoff,
    previousRunId: previous ? previous.runId : null,
    lineage,
    status,
    contentHash,
    snapshotHash,
    deltaHash: delta.hash,
    snapshot
  }) as LongitudinalMemoryEntry;
  return { entry, store: [...input.store, entry], delta };
}
export function verifyLongitudinalMemoryEntry(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  const candidate = entry as LongitudinalMemoryEntry;
  if (candidate.version !== RESEARCH_MEMORY_VERSION) return false;
  if (typeof candidate.companyId !== "string" || !candidate.companyId.trim()) return false;
  if (typeof candidate.runId !== "string" || !candidate.runId.trim()) return false;
  if (!RESEARCH_UPDATE_MODES.includes(candidate.mode)) return false;
  const snapshotHash = hashSanitized(candidate.snapshot ?? null, "research-memory/snapshot/v1");
  if (snapshotHash !== candidate.snapshotHash) return false;
  const recomputed = hashSanitized({ companyId: candidate.companyId, runId: candidate.runId, mode: candidate.mode, occurredAt: candidate.occurredAt, dataCutoff: candidate.dataCutoff, previousRunId: candidate.previousRunId, snapshotHash, deltaHash: candidate.deltaHash }, "research-memory/entry/v1");
  return recomputed === candidate.contentHash;
}
export function serverStatusForMemoryEntry(hasPrevious: boolean, hasChanges: boolean): string {
  if (!hasPrevious) return "initiated";
  if (hasChanges) return "updated";
  return "unchanged";
}
