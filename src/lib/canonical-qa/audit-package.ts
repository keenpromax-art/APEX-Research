import { deepFreeze, isDeeplyFrozen } from "../research-ledger/immutable";
import { stableHash, stableStringify } from "../research-ledger/stable";
import type { MachineAuditPackage } from "./types";
import { MACHINE_AUDIT_PACKAGE_VERSION } from "./types";
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
export interface AuditPackageInput {
  report?: unknown;
  evidenceRegistry?: unknown;
  model?: unknown;
  forecast?: unknown;
  valuation?: unknown;
  assumptions?: unknown;
  qa?: unknown;
  researchPlan?: unknown;
  lineage?: unknown;
  reproducibility?: unknown;
  generatedAt?: unknown;
}
export function buildMachineAuditPackage(input: AuditPackageInput = {}): MachineAuditPackage {
  const generatedAt = typeof input.generatedAt === "string" && input.generatedAt.trim().length > 0 ? input.generatedAt : new Date().toISOString();
  const report = cloneJson(input.report);
  const evidenceRegistry = cloneJson(input.evidenceRegistry);
  const model = cloneJson(input.model);
  const forecast = cloneJson(input.forecast);
  const valuation = cloneJson(input.valuation);
  const assumptions = cloneJson(input.assumptions);
  const qa = cloneJson(input.qa);
  const researchPlan = cloneJson(input.researchPlan);
  const lineage = cloneJson(input.lineage);
  const reproducibility = cloneJson(input.reproducibility);
  const hashes: Record<string, string> = {
    report: hashSanitized(report, "machine-audit/report/v1"),
    evidenceRegistry: hashSanitized(evidenceRegistry, "machine-audit/evidence/v1"),
    model: hashSanitized(model, "machine-audit/model/v1"),
    forecast: hashSanitized(forecast, "machine-audit/forecast/v1"),
    valuation: hashSanitized(valuation, "machine-audit/valuation/v1"),
    assumptions: hashSanitized(assumptions, "machine-audit/assumptions/v1"),
    qa: hashSanitized(qa, "machine-audit/qa/v1"),
    researchPlan: hashSanitized(researchPlan, "machine-audit/plan/v1"),
    lineage: hashSanitized(lineage, "machine-audit/lineage/v1"),
    reproducibility: hashSanitized(reproducibility, "machine-audit/reproducibility/v1")
  };
  const packageHash = stableHash({ generatedAt, hashes }, "machine-audit/package/v1");
  const sealed: MachineAuditPackage = {
    version: MACHINE_AUDIT_PACKAGE_VERSION,
    generatedAt,
    packageHash,
    reportHash: hashes.report as string,
    hashes,
    report,
    evidenceRegistry,
    model,
    forecast,
    valuation,
    assumptions,
    qa,
    researchPlan,
    lineage,
    reproducibility
  };
  return deepFreeze(sealed) as MachineAuditPackage;
}
export function verifyMachineAuditPackage(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!isDeeplyFrozen(value)) return false;
  const candidate = value as MachineAuditPackage;
  if (candidate.version !== MACHINE_AUDIT_PACKAGE_VERSION) return false;
  if (typeof candidate.packageHash !== "string" || candidate.packageHash.length !== 64) return false;
  const expected: Record<string, unknown> = {
    report: hashSanitized(candidate.report ?? null, "machine-audit/report/v1"),
    evidenceRegistry: hashSanitized(candidate.evidenceRegistry ?? null, "machine-audit/evidence/v1"),
    model: hashSanitized(candidate.model ?? null, "machine-audit/model/v1"),
    forecast: hashSanitized(candidate.forecast ?? null, "machine-audit/forecast/v1"),
    valuation: hashSanitized(candidate.valuation ?? null, "machine-audit/valuation/v1"),
    assumptions: hashSanitized(candidate.assumptions ?? null, "machine-audit/assumptions/v1"),
    qa: hashSanitized(candidate.qa ?? null, "machine-audit/qa/v1"),
    researchPlan: hashSanitized(candidate.researchPlan ?? null, "machine-audit/plan/v1"),
    lineage: hashSanitized(candidate.lineage ?? null, "machine-audit/lineage/v1"),
    reproducibility: hashSanitized(candidate.reproducibility ?? null, "machine-audit/reproducibility/v1")
  };
  for (const key of Object.keys(expected)) {
    if ((candidate.hashes as Record<string, string>)[key] !== expected[key]) return false;
  }
  if (candidate.reportHash !== expected.report) return false;
  const recomputed = stableHash({ generatedAt: candidate.generatedAt, hashes: candidate.hashes }, "machine-audit/package/v1");
  return recomputed === candidate.packageHash;
}
export function hashMachineAuditPackage(value: MachineAuditPackage): string {
  return stableHash(value, "machine-audit/envelope/v1");
}
