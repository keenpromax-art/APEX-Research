import type { ResearchUnknown, UnknownSource } from "@/lib/research-case/types";
import { deepFreeze, isDeeplyFrozen } from "./immutable";
import { companyIdentityKey } from "./run-envelope";
import { compareStableStrings, stableHash, stableStringify } from "./stable";
import { UNKNOWN_REGISTRY_VERSION } from "./types";

export type UnknownStatus = "open" | "investigating" | "resolved" | "dismissed";
export type UnknownTransitionAction = "start" | "resolve" | "dismiss" | "reopen";

export type UnknownEntry = Readonly<Omit<ResearchUnknown, "id" | "evidenceNeeded">> & {
  readonly unknownId: string;
  readonly contentHash: string;
  readonly companyId: string;
  readonly evidenceNeeded: string | null;
  readonly status: UnknownStatus;
  readonly registeredAt: string;
  readonly updatedAt: string;
  readonly revision: number;
};

export interface UnknownTransition {
  readonly transitionId: string;
  readonly transitionHash: string;
  readonly unknownId: string;
  readonly companyId: string;
  readonly action: UnknownTransitionAction;
  readonly fromStatus: UnknownStatus;
  readonly toStatus: UnknownStatus;
  readonly at: string;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
  readonly revision: number;
  readonly previousTransitionHash: string | null;
}

export interface UnknownRegistry {
  readonly version: typeof UNKNOWN_REGISTRY_VERSION;
  readonly companyId: string;
  readonly entries: readonly UnknownEntry[];
  readonly transitions: readonly UnknownTransition[];
  readonly hash: string;
}

export interface RegisterUnknownInput {
  readonly unknownId?: string;
  readonly companyId?: string;
  readonly statement: string;
  readonly source: UnknownSource;
  readonly evidenceNeeded?: string;
  readonly registeredAt: string;
}

export interface RegisterUnknownResult {
  readonly registry: UnknownRegistry;
  readonly entry: UnknownEntry;
  readonly appended: boolean;
  readonly duplicate: boolean;
}

export interface TransitionUnknownInput {
  readonly unknownId: string;
  readonly action: UnknownTransitionAction;
  readonly at: string;
  readonly reason: string;
  readonly evidenceIds?: readonly string[];
}

export interface TransitionUnknownResult {
  readonly registry: UnknownRegistry;
  readonly entry: UnknownEntry;
  readonly transition: UnknownTransition;
  readonly transitioned: boolean;
  readonly duplicate: boolean;
}

export class UnknownRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownRegistryError";
  }
}

export class UnknownTransitionError extends UnknownRegistryError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownTransitionError";
  }
}

export class UnknownIdCollisionError extends UnknownRegistryError {
  constructor(unknownId: string) {
    super(`Unknown ID ${unknownId} already exists with different content`);
    this.name = "UnknownIdCollisionError";
  }
}

const SOURCES = new Set<UnknownSource>(["planner", "epistemic", "data-gap", "analyst"]);

function requiredText(value: string, field: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must not be empty`);
  if (normalized.length > maximum) throw new RangeError(`${field} must not exceed ${maximum} characters`);
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(`${field} must be a valid timestamp`);
  return normalized;
}

function optionalText(value: string | undefined, field: string, maximum: number): string | null {
  return value === undefined ? null : requiredText(value, field, maximum);
}

function evidenceIds(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError("evidenceIds must be an array");
  return Object.freeze([...new Set(values.map((value) => requiredText(value, "evidence ID", 256)))].sort(compareStableStrings));
}

function unknownContent(entry: Omit<UnknownEntry, "unknownId" | "contentHash" | "status" | "registeredAt" | "updatedAt" | "revision">): unknown {
  return {
    companyId: entry.companyId,
    statement: entry.statement,
    source: entry.source,
    evidenceNeeded: entry.evidenceNeeded,
  };
}

function registryContent(registry: Omit<UnknownRegistry, "version" | "hash">): unknown {
  return {
    companyId: registry.companyId,
    entries: registry.entries,
    transitions: registry.transitions,
  };
}

function transitionHash(transition: Omit<UnknownTransition, "transitionId" | "transitionHash">): string {
  return stableHash(transition, "research-ledger/unknown-transition/v1");
}

function sameUnknownContent(left: UnknownEntry, right: UnknownEntry): boolean {
  return left.contentHash === right.contentHash
    && left.companyId === right.companyId
    && left.statement === right.statement
    && left.source === right.source
    && left.evidenceNeeded === right.evidenceNeeded;
}

function nextState(status: UnknownStatus, action: UnknownTransitionAction): UnknownStatus {
  if (action === "start" && status === "open") return "investigating";
  if (action === "resolve" && (status === "open" || status === "investigating")) return "resolved";
  if (action === "dismiss" && (status === "open" || status === "investigating")) return "dismissed";
  if (action === "reopen" && (status === "resolved" || status === "dismissed")) return "open";
  throw new UnknownTransitionError(`Action ${action} is not valid while unknown is ${status}`);
}

export function createUnknownRegistry(companyId: string): UnknownRegistry {
  const content = {
    companyId: companyIdentityKey(companyId),
    entries: Object.freeze([] as readonly UnknownEntry[]),
    transitions: Object.freeze([] as readonly UnknownTransition[]),
  };
  return deepFreeze({
    version: UNKNOWN_REGISTRY_VERSION,
    ...content,
    hash: stableHash(registryContent(content), "research-ledger/unknown-registry/v1"),
  }) as UnknownRegistry;
}

export function registerUnknown(
  registry: UnknownRegistry,
  input: RegisterUnknownInput,
): RegisterUnknownResult {
  if (registry === null || typeof registry !== "object") throw new TypeError("Unknown registry must be an object");
  if (input === null || typeof input !== "object") throw new TypeError("Unknown registration must be an object");
  const companyId = companyIdentityKey(input.companyId ?? registry.companyId);
  if (companyId !== registry.companyId) throw new UnknownRegistryError("Unknown company must match the registry company");
  if (!SOURCES.has(input.source)) throw new TypeError(`Unsupported unknown source ${String(input.source)}`);
  const registeredAt = timestamp(input.registeredAt, "registeredAt");
  const semantic: Omit<UnknownEntry, "unknownId" | "contentHash" | "status" | "registeredAt" | "updatedAt" | "revision"> = {
    companyId,
    statement: requiredText(input.statement, "statement", 4_000),
    source: input.source,
    evidenceNeeded: optionalText(input.evidenceNeeded, "evidenceNeeded", 2_000),
  };
  const contentHash = stableHash(unknownContent(semantic), "research-ledger/unknown/v1");
  const unknownId = input.unknownId === undefined
    ? `UNK-${contentHash.toUpperCase()}`
    : requiredText(input.unknownId, "unknownId", 320);
  const entry: UnknownEntry = {
    ...semantic,
    unknownId,
    contentHash,
    status: "open",
    registeredAt,
    updatedAt: registeredAt,
    revision: 0,
  };
  const existing = registry.entries.find((candidate) => candidate.unknownId === unknownId);
  if (existing) {
    if (sameUnknownContent(existing, entry)) return { registry, entry: existing, appended: false, duplicate: true };
    throw new UnknownIdCollisionError(unknownId);
  }
  const nextRegistryContent = {
    companyId: registry.companyId,
    entries: [...registry.entries, entry],
    transitions: registry.transitions,
  };
  const nextRegistry = deepFreeze({
    version: UNKNOWN_REGISTRY_VERSION,
    ...nextRegistryContent,
    hash: stableHash(registryContent(nextRegistryContent), "research-ledger/unknown-registry/v1"),
  }) as UnknownRegistry;
  return { registry: nextRegistry, entry: deepFreeze(entry) as UnknownEntry, appended: true, duplicate: false };
}

export function transitionUnknown(
  registry: UnknownRegistry,
  input: TransitionUnknownInput,
): TransitionUnknownResult {
  if (registry === null || typeof registry !== "object") throw new TypeError("Unknown registry must be an object");
  if (input === null || typeof input !== "object") throw new TypeError("Unknown transition must be an object");
  const unknownId = requiredText(input.unknownId, "unknownId", 320);
  const entry = registry.entries.find((candidate) => candidate.unknownId === unknownId);
  if (!entry) throw new UnknownRegistryError(`Unknown ${unknownId} is not registered`);
  const at = timestamp(input.at, "at");
  const reason = requiredText(input.reason, "reason", 4_000);
  const ids = evidenceIds(input.evidenceIds);
  const existingTransition = registry.transitions.find((candidate) => (
    candidate.unknownId === unknownId
    && candidate.action === input.action
    && candidate.at === at
    && candidate.reason === reason
    && stableStringify(candidate.evidenceIds) === stableStringify(ids)
  ));
  if (existingTransition) {
    return {
      registry,
      entry,
      transition: existingTransition,
      transitioned: false,
      duplicate: true,
    };
  }
  const revision = entry.revision + 1;
  const fromStatus = entry.status;
  const transitionContent: Omit<UnknownTransition, "transitionId" | "transitionHash" | "toStatus"> = {
    unknownId,
    companyId: entry.companyId,
    action: input.action,
    fromStatus,
    at,
    reason,
    evidenceIds: ids,
    revision,
    previousTransitionHash: null,
  };
  const idHash = stableHash(transitionContent, "research-ledger/unknown-transition-id/v1");
  const transitionId = `TRN-${idHash.toUpperCase()}`;
  const idCollision = registry.transitions.find((candidate) => candidate.transitionId === transitionId);
  if (idCollision) {
    return {
      registry,
      entry,
      transition: idCollision,
      transitioned: false,
      duplicate: true,
    };
  }
  const toStatus = nextState(fromStatus, input.action);
  if (Date.parse(at) <= Date.parse(entry.updatedAt)) {
    throw new UnknownTransitionError("Unknown transition time must be later than its latest update");
  }
  const priorTransitions = registry.transitions.filter((candidate) => candidate.unknownId === unknownId);
  const previous = priorTransitions.length === 0 ? null : priorTransitions[priorTransitions.length - 1] ?? null;
  const transitionBase: Omit<UnknownTransition, "transitionId" | "transitionHash"> = {
    ...transitionContent,
    toStatus,
    previousTransitionHash: previous?.transitionHash ?? null,
  };
  const transition: UnknownTransition = {
    ...transitionBase,
    transitionId,
    transitionHash: transitionHash(transitionBase),
  };
  const nextEntry: UnknownEntry = {
    ...entry,
    status: toStatus,
    updatedAt: at,
    revision,
  };
  const nextRegistryContent = {
    companyId: registry.companyId,
    entries: registry.entries.map((candidate) => candidate.unknownId === unknownId ? nextEntry : candidate),
    transitions: [...registry.transitions, transition],
  };
  const nextRegistry = deepFreeze({
    version: UNKNOWN_REGISTRY_VERSION,
    ...nextRegistryContent,
    hash: stableHash(registryContent(nextRegistryContent), "research-ledger/unknown-registry/v1"),
  }) as UnknownRegistry;
  return {
    registry: nextRegistry,
    entry: deepFreeze(nextEntry) as UnknownEntry,
    transition: deepFreeze(transition) as UnknownTransition,
    transitioned: true,
    duplicate: false,
  };
}

export function getUnknown(registry: UnknownRegistry, unknownId: string): UnknownEntry | null {
  return registry.entries.find((entry) => entry.unknownId === unknownId) ?? null;
}

export function listUnknowns(registry: UnknownRegistry, status?: UnknownStatus): readonly UnknownEntry[] {
  return Object.freeze(status === undefined ? [...registry.entries] : registry.entries.filter((entry) => entry.status === status));
}

export function getUnknownHistory(registry: UnknownRegistry, unknownId: string): readonly UnknownTransition[] {
  return Object.freeze(registry.transitions.filter((transition) => transition.unknownId === unknownId));
}

export function verifyUnknownRegistry(value: unknown): value is UnknownRegistry {
  try {
    if (value === null || typeof value !== "object" || !isDeeplyFrozen(value)) return false;
    const registry = value as Partial<UnknownRegistry>;
    if (registry.version !== UNKNOWN_REGISTRY_VERSION) return false;
    if (typeof registry.companyId !== "string" || !registry.companyId) return false;
    if (!Array.isArray(registry.entries) || !Array.isArray(registry.transitions)) return false;
    if (typeof registry.hash !== "string" || !/^[a-f0-9]{64}$/.test(registry.hash)) return false;
    if (stableHash(registryContent(registry as UnknownRegistry), "research-ledger/unknown-registry/v1") !== registry.hash) return false;
    for (const entry of registry.entries) {
      if (typeof entry.unknownId !== "string" || !entry.unknownId.trim()) return false;
      if (stableHash(unknownContent(entry), "research-ledger/unknown/v1") !== entry.contentHash) return false;
    }
    for (const transition of registry.transitions) {
      const { transitionId, transitionHash: hash, ...content } = transition;
      if (!/^TRN-[A-F0-9]{64}$/.test(transitionId)) return false;
      if (transitionHash(content) !== hash) return false;
    }
    return true;
  } catch {
    return false;
  }
}
