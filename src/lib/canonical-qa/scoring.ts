import { stableHash } from "../research-ledger/stable";
import type { CanonicalDimensionScore, CanonicalIntegrityScores, CanonicalQaDiagnostic, CanonicalQaDimension } from "./types";
import { CANONICAL_QA_VERSION } from "./types";
export const CANONICAL_QA_DIMENSIONS: CanonicalQaDimension[] = [
  "numerical",
  "accounting",
  "evidence",
  "model",
  "forecast",
  "valuation",
  "scenario",
  "competitive",
  "narrative",
  "cross-section",
  "contamination",
  "freshness",
  "reproducibility",
  "pdf-plumbing"
];
function deduction(severity: CanonicalQaDiagnostic["severity"]): number {
  if (severity === "blocker") return 25;
  if (severity === "major") return 10;
  if (severity === "minor") return 3;
  return 0;
}
export function scoreCanonicalQa(diagnostics: CanonicalQaDiagnostic[]): CanonicalIntegrityScores {
  const dimensions: CanonicalDimensionScore[] = CANONICAL_QA_DIMENSIONS.map((dimension) => {
    const scoped = diagnostics.filter((d) => d.dimension === dimension);
    const blockerCount = scoped.filter((d) => d.severity === "blocker").length;
    const majorCount = scoped.filter((d) => d.severity === "major").length;
    const minorCount = scoped.filter((d) => d.severity === "minor").length;
    const infoCount = scoped.filter((d) => d.severity === "info").length;
    let score = 100;
    for (const d of scoped) score -= deduction(d.severity);
    if (score < 0) score = 0;
    if (score > 100) score = 100;
    return { dimension, score, passed: blockerCount === 0, blockerCount, majorCount, minorCount, infoCount };
  });
  let overall = 0;
  for (const d of dimensions) overall += d.score;
  overall = Math.round(overall / dimensions.length);
  const blockerCount = diagnostics.filter((d) => d.severity === "blocker").length;
  const majorCount = diagnostics.filter((d) => d.severity === "major").length;
  const minorCount = diagnostics.filter((d) => d.severity === "minor").length;
  const infoCount = diagnostics.filter((d) => d.severity === "info").length;
  let grade = "A";
  if (overall < 50) grade = "F";
  else if (overall < 60) grade = "D";
  else if (overall < 70) grade = "C";
  else if (overall < 85) grade = "B";
  return { version: CANONICAL_QA_VERSION, dimensions, overall, grade, blockerCount, majorCount, minorCount, infoCount };
}
const VOLATILE_QA_KEYS = new Set(["researchRunId", "generationTimestamp", "generatedAt", "auditPackage", "auditPackageHash", "canonicalQa", "reproducibility", "qaDecision", "regenerationAttempts", "regenerationLog", "reviews", "reviewPassed", "reviewVersion"]);
function sanitizeValue(value: unknown, ancestors: Set<object> = new Set<object>()): unknown {
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
    if (Array.isArray(value)) return (value as unknown[]).map((entry) => sanitizeValue(entry, ancestors));
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (VOLATILE_QA_KEYS.has(key)) continue;
      if (record[key] === undefined) continue;
      if (typeof record[key] === "function") continue;
      out[key] = sanitizeValue(record[key], ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value as object);
  }
}
export function hashCanonicalQaInput(value: unknown): string {
  return stableHash(sanitizeValue(value ?? null), "canonical-qa/input/v1");
}
export function hashReportForQa(report: unknown): string {
  return stableHash(sanitizeValue(report ?? null), "canonical-qa/report/v1");
}
