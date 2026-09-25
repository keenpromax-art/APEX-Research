import { deepFreeze, isDeeplyFrozen } from "./immutable";
import { stableHash, stableStringify } from "./stable";
import {
  RESEARCH_RUN_VERSION,
  type DeepReadonly,
  type ResearchLedgerCompany,
  type ResearchRunEnvelope,
  type ResearchRunInput,
} from "./types";

export class RunIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunIntegrityError";
  }
}

function requiredText(value: string, field: string, maximum = 512): string {
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

function cloneCanonical<T>(value: T, field: string): T {
  const serialized = stableStringify(value);
  if (serialized === undefined) throw new TypeError(`${field} must be defined`);
  return JSON.parse(serialized) as T;
}

function normalizeCompany(company: ResearchLedgerCompany | string): ResearchLedgerCompany {
  if (typeof company === "string") {
    const value = requiredText(company, "company", 160);
    return { id: value, ticker: value };
  }
  if (company === null || typeof company !== "object") throw new TypeError("company must be a string or company record");
  const normalized: ResearchLedgerCompany = {
    id: requiredText(company.id, "company.id", 160),
    ticker: requiredText(company.ticker, "company.ticker", 80),
    ...(company.name === undefined ? {} : { name: requiredText(company.name, "company.name", 240) }),
    ...(company.exchange === undefined ? {} : { exchange: requiredText(company.exchange, "company.exchange", 120) }),
  };
  return cloneCanonical(normalized, "company");
}

type RunContent<TPayload> = Omit<ResearchRunEnvelope<TPayload>, "version" | "runId" | "contentHash" | "payload"> & {
  readonly payload: TPayload;
};

function runContent<TPayload>(envelope: RunContent<TPayload>): unknown {
  return {
    schemaVersion: envelope.schemaVersion,
    pipelineVersion: envelope.pipelineVersion,
    modelVersion: envelope.modelVersion,
    promptVersion: envelope.promptVersion,
    company: envelope.company,
    occurredAt: envelope.occurredAt,
    dataCutoff: envelope.dataCutoff,
    payload: envelope.payload,
    metadata: envelope.metadata,
  };
}

export function companyIdentityKey(company: ResearchLedgerCompany | string): string {
  const normalized = normalizeCompany(company);
  return normalized.id.trim().toLowerCase();
}

export function tickerIdentityKey(company: ResearchLedgerCompany | string): string {
  const normalized = normalizeCompany(company);
  return normalized.ticker.trim().toLowerCase();
}

export function createResearchRunEnvelope<TPayload>(input: ResearchRunInput<TPayload>): ResearchRunEnvelope<TPayload> {
  if (input === null || typeof input !== "object") throw new TypeError("Run input must be an object");
  const company = normalizeCompany(input.company);
  const occurredAt = timestamp(input.occurredAt, "occurredAt");
  const dataCutoff = timestamp(input.dataCutoff, "dataCutoff");
  if (Date.parse(dataCutoff) > Date.parse(occurredAt)) {
    throw new RangeError("dataCutoff must not be later than occurredAt");
  }
  const content: RunContent<TPayload> = {
    company,
    occurredAt,
    dataCutoff,
    schemaVersion: requiredText(input.schemaVersion ?? "research-ledger-payload-v1", "schemaVersion", 160),
    pipelineVersion: requiredText(input.pipelineVersion, "pipelineVersion", 160),
    modelVersion: requiredText(input.modelVersion, "modelVersion", 160),
    promptVersion: input.promptVersion === undefined ? null : requiredText(input.promptVersion, "promptVersion", 160),
    payload: cloneCanonical(input.payload, "payload"),
    metadata: cloneCanonical(input.metadata ?? {}, "metadata"),
  };
  const contentHash = stableHash(runContent(content), "research-ledger/run-envelope/v1");
  const suppliedRunId = input.runId === undefined ? null : requiredText(input.runId, "runId", 256);
  const runId = suppliedRunId ?? `RUN-${contentHash.toUpperCase()}`;
  return deepFreeze({
    version: RESEARCH_RUN_VERSION,
    runId,
    contentHash,
    ...content,
  }) as ResearchRunEnvelope<TPayload>;
}

export function isResearchRunEnvelope(value: unknown): value is ResearchRunEnvelope<unknown> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ResearchRunEnvelope<unknown>>;
  return candidate.version === RESEARCH_RUN_VERSION
    && typeof candidate.runId === "string"
    && /^[a-f0-9]{64}$/.test(candidate.contentHash ?? "")
    && candidate.company !== null
    && typeof candidate.company === "object"
    && typeof candidate.occurredAt === "string"
    && typeof candidate.dataCutoff === "string"
    && typeof candidate.schemaVersion === "string"
    && typeof candidate.pipelineVersion === "string"
    && typeof candidate.modelVersion === "string"
    && (candidate.promptVersion === null || typeof candidate.promptVersion === "string")
    && "payload" in candidate
    && candidate.metadata !== null
    && typeof candidate.metadata === "object";
}

export function verifyResearchRunEnvelope(value: unknown): value is ResearchRunEnvelope<unknown> {
  try {
    if (!isResearchRunEnvelope(value) || !isDeeplyFrozen(value)) return false;
    const content = runContent(value);
    return stableHash(content, "research-ledger/run-envelope/v1") === value.contentHash;
  } catch {
    return false;
  }
}

export function assertResearchRunEnvelope(value: unknown): asserts value is ResearchRunEnvelope<unknown> {
  if (!verifyResearchRunEnvelope(value)) throw new RunIntegrityError("Research run envelope failed integrity verification");
}
