import type { ThesisSpecification } from "@/lib/ai-first/types";
import { deepFreeze } from "./immutable";
import { compareStableStrings, stableHash, stableStringify } from "./stable";

export type ThesisSnapshot = Readonly<Partial<ThesisSpecification>> & Readonly<Record<string, unknown>>;

export type ThesisFieldChangeKind = "added" | "removed" | "changed";

export interface ThesisFieldChange {
  readonly field: string;
  readonly kind: ThesisFieldChangeKind;
  readonly before: unknown;
  readonly after: unknown;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
}

export interface ThesisFieldDiff {
  readonly fromRunId: string | null;
  readonly toRunId: string | null;
  readonly changedFields: readonly string[];
  readonly changes: readonly ThesisFieldChange[];
  readonly hasChanges: boolean;
  readonly hash: string;
}

export type ThesisBreakClassification = "intact" | "refinement" | "material-break" | "invalidated";
export type ThesisBreakSeverity = "none" | "minor" | "major" | "critical";
export type ThesisBreakReason =
  | "no-thesis-change"
  | "supporting-field-change"
  | "central-thesis-change"
  | "invalidation-condition-met";

export interface ThesisBreakAssessment {
  readonly classification: ThesisBreakClassification;
  readonly severity: ThesisBreakSeverity;
  readonly isBreak: boolean;
  readonly reason: ThesisBreakReason;
  readonly changedFields: readonly string[];
  readonly centralFieldsChanged: readonly string[];
  readonly invalidationSignals: readonly string[];
  readonly diffHash: string;
}

export interface ClassifyThesisBreakInput {
  readonly previous: ThesisSnapshot;
  readonly current: ThesisSnapshot;
  readonly fromRunId?: string;
  readonly toRunId?: string;
  readonly invalidationSignals?: readonly string[];
}

const CENTRAL_FIELDS = new Set([
  "thesis",
  "keyDebate",
  "whatMarketMayBeMissing",
  "whatCouldInvalidate",
]);

function canonicalClone(value: unknown, field: string): unknown {
  const serialized = stableStringify(value);
  if (serialized === undefined) return undefined;
  if (serialized === "null" || serialized[0] === "{" || serialized[0] === "[") {
    return JSON.parse(serialized) as unknown;
  }
  if (field.length === 0) throw new TypeError("Thesis field name must not be empty");
  return value;
}

function fieldNames(thesis: ThesisSnapshot): string[] {
  if (thesis === null || typeof thesis !== "object" || Array.isArray(thesis)) {
    throw new TypeError("Thesis snapshot must be an object");
  }
  stableStringify(thesis);
  return Object.keys(thesis)
    .filter((field) => thesis[field] !== undefined)
    .sort(compareStableStrings);
}

function optionalRunId(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Run IDs must be non-empty strings");
  return value.trim();
}

export function diffThesisFields(
  previous: ThesisSnapshot,
  current: ThesisSnapshot,
  identity: { fromRunId?: string; toRunId?: string } = {},
): ThesisFieldDiff {
  const previousFields = new Set(fieldNames(previous));
  const currentFields = new Set(fieldNames(current));
  const fields = [...new Set([...previousFields, ...currentFields])].sort(compareStableStrings);
  const changes: ThesisFieldChange[] = [];
  for (const field of fields) {
    const hadBefore = previousFields.has(field);
    const hasAfter = currentFields.has(field);
    if (hadBefore === hasAfter && stableStringify(previous[field]) === stableStringify(current[field])) continue;
    const kind: ThesisFieldChangeKind = !hadBefore ? "added" : !hasAfter ? "removed" : "changed";
    const before = canonicalClone(hadBefore ? previous[field] : null, field);
    const after = canonicalClone(hasAfter ? current[field] : null, field);
    changes.push({
      field,
      kind,
      before,
      after,
      beforeHash: hadBefore ? stableHash(previous[field], "research-ledger/thesis-field/v1") : null,
      afterHash: hasAfter ? stableHash(current[field], "research-ledger/thesis-field/v1") : null,
    });
  }
  const changedFields = changes.map((change) => change.field);
  const fromRunId = optionalRunId(identity.fromRunId);
  const toRunId = optionalRunId(identity.toRunId);
  const hash = stableHash(
    { fromRunId, toRunId, changes: changes.map((change) => ({ field: change.field, beforeHash: change.beforeHash, afterHash: change.afterHash })) },
    "research-ledger/thesis-diff/v1",
  );
  return deepFreeze({
    fromRunId,
    toRunId,
    changedFields,
    changes,
    hasChanges: changes.length > 0,
    hash,
  }) as ThesisFieldDiff;
}

export function classifyThesisBreak(input: ClassifyThesisBreakInput): ThesisBreakAssessment {
  if (input === null || typeof input !== "object") throw new TypeError("Thesis break input must be an object");
  const diff = diffThesisFields(input.previous, input.current, {
    ...(input.fromRunId === undefined ? {} : { fromRunId: input.fromRunId }),
    ...(input.toRunId === undefined ? {} : { toRunId: input.toRunId }),
  });
  const invalidationSignals = [...new Set((input.invalidationSignals ?? []).map((signal) => {
    if (typeof signal !== "string" || !signal.trim()) throw new TypeError("Invalidation signals must be non-empty strings");
    return signal.trim();
  }))].sort(compareStableStrings);
  const centralFieldsChanged = diff.changedFields.filter((field) => CENTRAL_FIELDS.has(field));
  let classification: ThesisBreakClassification;
  let severity: ThesisBreakSeverity;
  let reason: ThesisBreakReason;
  if (invalidationSignals.length > 0) {
    classification = "invalidated";
    severity = "critical";
    reason = "invalidation-condition-met";
  } else if (centralFieldsChanged.length > 0) {
    classification = "material-break";
    severity = "major";
    reason = "central-thesis-change";
  } else if (diff.hasChanges) {
    classification = "refinement";
    severity = "minor";
    reason = "supporting-field-change";
  } else {
    classification = "intact";
    severity = "none";
    reason = "no-thesis-change";
  }
  return deepFreeze({
    classification,
    severity,
    isBreak: classification === "material-break" || classification === "invalidated",
    reason,
    changedFields: diff.changedFields,
    centralFieldsChanged,
    invalidationSignals,
    diffHash: diff.hash,
  }) as ThesisBreakAssessment;
}
