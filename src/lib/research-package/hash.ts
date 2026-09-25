import { deepFreeze, isDeeplyFrozen } from "@/lib/research-ledger/immutable";
import { stableHash, stableStringify } from "@/lib/research-ledger/stable";
import { verifyFactPack } from "@/lib/ai-first/fact-pack";
import { validateResearchLineageGraph, verifyResearchLineageGraph } from "@/lib/research-lineage/graph";
import { verifyCanonicalEvidenceRegistry } from "@/lib/research-retrieval/evidence";
import { verifyResearchRetrievalResult } from "@/lib/research-retrieval/retrieval";
import { verifyCanonicalQaResult } from "@/lib/canonical-qa/decision";
import { verifyMachineAuditPackage } from "@/lib/canonical-qa/audit-package";
import { verifyReproducibilityMetadata } from "@/lib/canonical-qa/reproducibility";
import {
  CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION,
  CANONICAL_RESEARCH_PACKAGE_VERSION,
  type CanonicalResearchPackage,
} from "./types";

const HASH_DOMAIN = "research-package/canonical-package/v1";

function hashValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (value instanceof Date) return value.toISOString();
  if (ancestors.has(value)) throw new TypeError("Research package cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => hashValue(entry, ancestors));
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === "packageHash" || key === "packageId" || key === "integrity") continue;
      if (record[key] === undefined) continue;
      output[key] = hashValue(record[key], ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function hashable(value: CanonicalResearchPackage | Record<string, unknown>): Record<string, unknown> {
  const record = value as unknown as Record<string, unknown>;
  const run = record.run && typeof record.run === "object" ? { ...(record.run as Record<string, unknown>) } : undefined;
  if (run) delete run.packageId;
  return hashValue({
    ...record,
    ...(run ? { run } : {}),
  }) as Record<string, unknown>;
}

export function hashCanonicalResearchPackage(value: CanonicalResearchPackage | Record<string, unknown>): string {
  return stableHash(hashable(value), HASH_DOMAIN);
}

export function packageIdForHash(hash: string): string {
  return `CRPKG-${hash.toUpperCase()}`;
}

export function sealCanonicalResearchPackage<T extends Omit<CanonicalResearchPackage, "packageHash" | "packageId" | "integrity"> & Partial<Pick<CanonicalResearchPackage, "packageHash" | "packageId" | "integrity">>>(
  value: T,
): CanonicalResearchPackage {
  const input = value as unknown as Record<string, unknown>;
  if (input.lineage !== undefined && !verifyResearchLineageGraph(input.lineage)) throw new TypeError("Canonical research package lineage failed integrity verification");
  if (input.retrieval !== undefined && !verifyResearchRetrievalResult(input.retrieval)) throw new TypeError("Canonical research package retrieval failed integrity verification");
  if (input.evidenceRegistry !== undefined && !verifyCanonicalEvidenceRegistry(input.evidenceRegistry)) throw new TypeError("Canonical research package evidence registry failed integrity verification");
  if (input.canonicalQa !== undefined && input.canonicalQa !== null && !verifyCanonicalQaResult(input.canonicalQa)) throw new TypeError("Canonical research package QA failed integrity verification");
  if (input.auditPackage !== undefined && input.auditPackage !== null && !verifyMachineAuditPackage(input.auditPackage)) throw new TypeError("Canonical research package audit failed integrity verification");
  if (input.reproducibility !== undefined && input.reproducibility !== null && !verifyReproducibilityMetadata(input.reproducibility)) throw new TypeError("Canonical research package reproducibility failed integrity verification");
  const quality = (input.quality ?? {}) as { status?: string; publicationStatus?: string; canPublish?: boolean };
  const provisional = {
    ...value,
    schemaVersion: CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION,
    packageVersion: CANONICAL_RESEARCH_PACKAGE_VERSION,
    sourceSnapshot: input.sourceSnapshot ?? (input.sourceContext as { source?: unknown } | undefined)?.source,
    normalizedSourceContext: input.normalizedSourceContext ?? input.sourceContext,
    qualityStatus: input.qualityStatus ?? quality.status ?? "blocked",
    publicationStatus: input.publicationStatus ?? quality.publicationStatus ?? "blocked",
    publicationBlocked: input.publicationBlocked ?? quality.canPublish !== true,
    integrity: {
      sealed: true,
      hashAlgorithm: "sha256" as const,
      hashMatches: true,
      immutable: true,
    },
  } as unknown as CanonicalResearchPackage;
  const hash = hashCanonicalResearchPackage(provisional);
  const sealed = deepFreeze({
    ...provisional,
    packageHash: hash,
    packageId: packageIdForHash(hash),
    integrity: {
      ...provisional.integrity,
      packageHash: hash,
    },
    run: {
      ...provisional.run,
      packageId: packageIdForHash(hash),
    },
  }) as CanonicalResearchPackage;
  return sealed;
}

export function verifyCanonicalResearchPackage(value: unknown, options: { requireImmutable?: boolean } = {}): value is CanonicalResearchPackage {
  try {
    if (!value || typeof value !== "object" || (options.requireImmutable !== false && !isDeeplyFrozen(value))) return false;
    const candidate = value as CanonicalResearchPackage;
    if (candidate.schemaVersion !== CANONICAL_RESEARCH_PACKAGE_SCHEMA_VERSION) return false;
    if (candidate.packageVersion !== CANONICAL_RESEARCH_PACKAGE_VERSION) return false;
    if (!candidate.ticker || !candidate.dataCutoff || !candidate.sourceSnapshotHash) return false;
    if (!verifyFactPack(candidate.factPack)) {
      if (options.requireImmutable === false && !isDeeplyFrozen(candidate.factPack)) deepFreeze(candidate.factPack);
      if (!verifyFactPack(candidate.factPack)) return false;
    }
    if (candidate.sourceContext?.factPack?.contentHash !== candidate.factPack.contentHash) return false;
    if (candidate.sourceContext?.ticker !== candidate.ticker || candidate.factPack.ticker !== candidate.ticker) return false;
    if (candidate.lineage !== undefined && !verifyResearchLineageGraph(candidate.lineage)) return false;
    if (candidate.retrieval !== undefined && !verifyResearchRetrievalResult(candidate.retrieval)) return false;
    if (candidate.evidenceRegistry !== undefined && !verifyCanonicalEvidenceRegistry(candidate.evidenceRegistry)) return false;
    if (candidate.researchReport?.retrieval !== undefined && !verifyResearchRetrievalResult(candidate.researchReport.retrieval)) return false;
    if (candidate.researchReport?.evidenceRegistry !== undefined && !verifyCanonicalEvidenceRegistry(candidate.researchReport.evidenceRegistry)) return false;
    if (candidate.retrieval && candidate.researchReport?.retrieval && candidate.retrieval.resultHash !== candidate.researchReport.retrieval.resultHash) return false;
    if (candidate.evidenceRegistry && candidate.researchReport?.evidenceRegistry && candidate.evidenceRegistry.contentHash !== candidate.researchReport.evidenceRegistry.contentHash) return false;
    if (candidate.lineage && candidate.researchReport?.lineage && candidate.lineage.contentHash !== candidate.researchReport.lineage.contentHash) return false;
    if (candidate.lineageValidation !== undefined && candidate.lineage) {
      const computedLineageValidation = validateResearchLineageGraph(candidate.lineage);
      if (stableStringify(candidate.lineageValidation) !== stableStringify(computedLineageValidation)) return false;
    }
    if (candidate.canonicalQa !== undefined && candidate.canonicalQa !== null && !verifyCanonicalQaResult(candidate.canonicalQa)) return false;
    if (candidate.auditPackage !== undefined && candidate.auditPackage !== null && !verifyMachineAuditPackage(candidate.auditPackage)) return false;
    if (candidate.reproducibility !== undefined && candidate.reproducibility !== null && !verifyReproducibilityMetadata(candidate.reproducibility)) return false;
    if (candidate.auditPackage && candidate.auditPackageHash && candidate.auditPackage.packageHash !== candidate.auditPackageHash) return false;
    if (!candidate.packageHash || !/^[a-f0-9]{64}$/.test(candidate.packageHash)) return false;
    if (candidate.packageId !== packageIdForHash(candidate.packageHash)) return false;
    if (candidate.integrity?.packageHash !== candidate.packageHash || candidate.integrity.hashMatches !== true) return false;
    if (candidate.run?.packageId !== candidate.packageId) return false;
    return hashCanonicalResearchPackage(candidate) === candidate.packageHash;
  } catch {
    return false;
  }
}

export const assertCanonicalResearchPackage = (value: unknown): asserts value is CanonicalResearchPackage => {
  if (!verifyCanonicalResearchPackage(value)) throw new TypeError("Canonical research package failed integrity verification");
};

export const hashResearchPackage = hashCanonicalResearchPackage;
export const verifyResearchPackage = verifyCanonicalResearchPackage;
export const createCanonicalResearchPackage = sealCanonicalResearchPackage;
export function hashDataSlice(value: unknown, domain: string): string {
  return stableHash(value ?? null, domain);
}
export function hashFactPackSlice(value: unknown): string {
  return stableHash(value ?? null, "canonical-qa/fact/v1");
}
export function hashForecastSlice(value: unknown): string {
  return stableHash(value ?? null, "canonical-qa/forecast/v1");
}
export function hashValuationSlice(value: unknown): string {
  return stableHash(value ?? null, "canonical-qa/valuation/v1");
}
export function hashReportSlice(value: unknown): string {
  return stableHash(value ?? null, "canonical-qa/report/v1");
}
export function hashModelSlice(value: unknown): string {
  return stableHash(value ?? null, "canonical-qa/model/v1");
}
export function hashAssumptionSlice(value: unknown): string {
  return stableHash(value ?? null, "canonical-qa/assumptions/v1");
}
