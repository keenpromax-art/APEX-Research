import { deepFreeze } from "@/lib/research-ledger/immutable";
import { assertResearchRunEnvelope, createResearchRunEnvelope } from "@/lib/research-ledger/run-envelope";
import { compareStableStrings, stableStringify } from "@/lib/research-ledger/stable";
import { RESEARCH_RUN_VERSION, type ResearchRunEnvelope } from "@/lib/research-ledger/types";
import { validateReportArtifactV1 } from "@/lib/report-artifact";
import type { ReportArtifactV1 } from "@/lib/report-artifact";
import { isReportTypeId } from "@/lib/report-types";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";
import { validateTicker } from "@/lib/security/request-policy";

export const RESEARCH_RUN_MANIFEST_VERSION = "research-run-manifest-v1" as const;
export const RESEARCH_RUN_MAX_REQUEST_BYTES = 131_072;
export const RESEARCH_RUN_MAX_MANIFEST_BYTES = 98_304;
export const RESEARCH_RUN_MAX_STORED_BYTES = 135_168;
export const RESEARCH_RUN_MAX_ARTIFACT_BYTES = 16_384;
export const RESEARCH_RUN_LIST_ORDER = "occurredAt:desc,runId:desc" as const;

export type ResearchRunStatus = "draft" | "complete" | "partial" | "failed";
export type ResearchRunIdempotencyDisposition = "created" | "duplicate" | "conflict";
export type ResearchRunOrder = typeof RESEARCH_RUN_LIST_ORDER;

export interface ResearchRunCompanyV1 {
  readonly id: string;
  readonly ticker: string;
  readonly name: string | null;
  readonly exchange: string | null;
}

export interface ResearchRunReportSelectionV1 {
  readonly type: ReportTypeId;
  readonly depth: ResearchDepth;
}

export interface ResearchRunForecastRowV1 {
  readonly period: string;
  readonly revenue: number | null;
  readonly ebit: number | null;
  readonly freeCashFlow: number | null;
  readonly eps: number | null;
}

export interface ResearchRunSummaryV1 {
  readonly thesis: {
    readonly statement: string;
    readonly keyDebate: string | null;
    readonly invalidation: readonly string[];
  };
  readonly forecast: {
    readonly projectionCount: number;
    readonly rows: readonly ResearchRunForecastRowV1[];
  };
}

export interface ResearchRunEvidenceV1 {
  readonly evidenceCount: number;
  readonly conflictCount: number;
  readonly graphNodeCount: number;
  readonly graphEdgeCount: number;
  readonly graphHash: string | null;
}

export interface ResearchRunManifestV1 {
  readonly version: typeof RESEARCH_RUN_MANIFEST_VERSION;
  readonly company: ResearchRunCompanyV1;
  readonly occurredAt: string;
  readonly dataCutoff: string;
  readonly schemaVersion: string;
  readonly pipelineVersion: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly caseId: string;
  readonly report: ResearchRunReportSelectionV1;
  readonly status: ResearchRunStatus;
  readonly reportArtifact: ReportArtifactV1 | null;
  readonly summary: ResearchRunSummaryV1;
  readonly evidence: ResearchRunEvidenceV1;
  readonly sourceRunIds: readonly string[];
  readonly idempotencyKey: string;
}

export interface ResearchRunPayloadV1 {
  readonly manifestVersion: typeof RESEARCH_RUN_MANIFEST_VERSION;
  readonly caseId: string;
  readonly report: ResearchRunReportSelectionV1;
  readonly status: ResearchRunStatus;
  readonly reportArtifact: ReportArtifactV1 | null;
  readonly summary: ResearchRunSummaryV1;
  readonly evidence: ResearchRunEvidenceV1;
  readonly sourceRunIds: readonly string[];
  readonly idempotencyKey: string;
}

export interface ResearchRunValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export class ResearchRunManifestValidationError extends Error {
  readonly issues: readonly ResearchRunValidationIssue[];

  constructor(issues: readonly ResearchRunValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ResearchRunManifestValidationError";
    this.issues = deepFreeze([...issues]);
  }
}

export class ResearchRunPayloadTooLargeError extends Error {
  constructor(maximum: number) {
    super(`Research run payload must not exceed ${maximum} bytes`);
    this.name = "ResearchRunPayloadTooLargeError";
  }
}

export class ResearchRunIntegrityError extends Error {
  constructor(message = "Research run failed integrity verification") {
    super(message);
    this.name = "ResearchRunIntegrityError";
  }
}

export class ResearchRunQueryValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ResearchRunQueryValidationError";
    this.field = field;
  }
}

const manifestKeys = new Set([
  "version",
  "company",
  "occurredAt",
  "dataCutoff",
  "schemaVersion",
  "pipelineVersion",
  "modelVersion",
  "promptVersion",
  "caseId",
  "report",
  "status",
  "reportArtifact",
  "summary",
  "evidence",
  "sourceRunIds",
  "idempotencyKey",
]);

const companyKeys = new Set(["id", "ticker", "name", "exchange"]);
const reportKeys = new Set(["type", "depth"]);
const summaryKeys = new Set(["thesis", "forecast"]);
const thesisKeys = new Set(["statement", "keyDebate", "invalidation"]);
const forecastKeys = new Set(["projectionCount", "rows"]);
const forecastRowKeys = new Set(["period", "revenue", "ebit", "freeCashFlow", "eps"]);
const evidenceKeys = new Set(["evidenceCount", "conflictCount", "graphNodeCount", "graphEdgeCount", "graphHash"]);
const payloadKeys = new Set([
  "manifestVersion",
  "caseId",
  "report",
  "status",
  "reportArtifact",
  "summary",
  "evidence",
  "sourceRunIds",
  "idempotencyKey",
]);
const envelopeKeys = new Set([
  "version",
  "runId",
  "contentHash",
  "company",
  "occurredAt",
  "dataCutoff",
  "schemaVersion",
  "pipelineVersion",
  "modelVersion",
  "promptVersion",
  "payload",
  "metadata",
]);
const statusValues = new Set<ResearchRunStatus>(["draft", "complete", "partial", "failed"]);
const depths = new Set<ResearchDepth>(["concise", "full"]);
const encoder = new TextEncoder();
const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|pk)-(?:or-v1-)?[A-Za-z0-9_-]{16,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:api[_-]?key|secret|authorization)\s*[:=]\s*\S+/i,
];

function addIssue(issues: ResearchRunValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectRecord(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  issues: ResearchRunValidationIssue[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    addIssue(issues, path, "PLAIN_OBJECT", "expected a plain object");
    return {};
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key === "symbol") {
      addIssue(issues, `${path}.${String(key)}`, "SYMBOL_KEY", "symbol keys are not allowed");
      continue;
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      addIssue(issues, `${path}.${key}`, "NON_JSON_PROPERTY", "expected an enumerable data property");
      continue;
    }
    if (!allowed.has(key)) addIssue(issues, `${path}.${key}`, "UNEXPECTED_FIELD", "field is not allow-listed");
  }
  return value;
}

function hasSecret(value: string): boolean {
  return secretPatterns.some((pattern) => pattern.test(value));
}

function readText(
  value: unknown,
  path: string,
  maximum: number,
  issues: ResearchRunValidationIssue[],
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    addIssue(issues, path, "STRING", "expected a string");
    return "";
  }
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) addIssue(issues, path, "EMPTY", "must not be empty");
  if (normalized.length > maximum) addIssue(issues, path, "TOO_LONG", `must not exceed ${maximum} characters`);
  if (hasSecret(normalized)) addIssue(issues, path, "SECRET", "secret-like content is not allowed");
  return normalized;
}

function readVersion(value: unknown, path: string, issues: ResearchRunValidationIssue[]): string {
  const normalized = readText(value, path, 160, issues);
  if (normalized && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized)) {
    addIssue(issues, path, "VERSION_FORMAT", "expected a version identifier");
  }
  return normalized;
}

function readIdentifier(
  value: unknown,
  path: string,
  maximum: number,
  issues: ResearchRunValidationIssue[],
): string {
  const normalized = readText(value, path, maximum, issues).toUpperCase();
  if (normalized && !/^[A-Z0-9][A-Z0-9._:=-]*$/.test(normalized)) {
    addIssue(issues, path, "IDENTIFIER_FORMAT", "expected a safe identifier");
  }
  return normalized;
}

function readCount(value: unknown, path: string, issues: ResearchRunValidationIssue[], maximum = 1_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    addIssue(issues, path, "COUNT", `expected an integer between 0 and ${maximum}`);
    return 0;
  }
  return value;
}

function readNullableNumber(value: unknown, path: string, issues: ResearchRunValidationIssue[]): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e18) {
    addIssue(issues, path, "NUMBER", "expected a finite number within bounds or null");
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function readTimestamp(value: unknown, path: string, issues: ResearchRunValidationIssue[]): string {
  if (typeof value !== "string") {
    addIssue(issues, path, "TIMESTAMP", "expected an RFC 3339 timestamp");
    return "";
  }
  const normalized = normalizeTimestamp(value.trim());
  if (!normalized) {
    addIssue(issues, path, "TIMESTAMP", "expected a valid RFC 3339 timestamp with a timezone");
    return "";
  }
  return normalized;
}

function readStringArray(
  value: unknown,
  path: string,
  maximumItems: number,
  maximumLength: number,
  issues: ResearchRunValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "ARRAY", "expected an array");
    return [];
  }
  if (value.length > maximumItems) addIssue(issues, path, "TOO_MANY_ITEMS", `must not contain more than ${maximumItems} entries`);
  const expectedKeys = new Set(value.map((_, index) => String(index)));
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key === "symbol" || !expectedKeys.has(key)) {
      addIssue(issues, `${path}.${String(key)}`, "ARRAY_PROPERTY", "array custom properties are not allowed");
    }
  }
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = readText(value[index], `${path}[${index}]`, maximumLength, issues, true);
    if (entry && !output.includes(entry)) output.push(entry);
  }
  return output;
}

function readCompany(value: unknown, issues: ResearchRunValidationIssue[]): ResearchRunCompanyV1 {
  const record = inspectRecord(value, "$.company", companyKeys, issues);
  const id = readIdentifier(record.id, "$.company.id", 160, issues);
  const tickerResult = validateTicker(record.ticker);
  let ticker = "";
  if (!tickerResult.ok) addIssue(issues, "$.company.ticker", "TICKER", tickerResult.error.message);
  else ticker = tickerResult.value;
  const name = record.name === null
    ? null
    : readText(record.name, "$.company.name", 240, issues);
  const exchange = record.exchange === null
    ? null
    : readText(record.exchange, "$.company.exchange", 64, issues).toUpperCase();
  if (exchange && !/^[A-Z0-9._:/-]+$/.test(exchange)) {
    addIssue(issues, "$.company.exchange", "EXCHANGE_FORMAT", "expected a safe exchange identifier");
  }
  return { id, ticker, name, exchange };
}

function readReport(value: unknown, issues: ResearchRunValidationIssue[]): ResearchRunReportSelectionV1 {
  const record = inspectRecord(value, "$.report", reportKeys, issues);
  const type = readText(record.type, "$.report.type", 80, issues);
  if (type && !isReportTypeId(type)) addIssue(issues, "$.report.type", "REPORT_TYPE", "unsupported report type");
  const depth = readText(record.depth, "$.report.depth", 16, issues) as ResearchDepth;
  if (depth && !depths.has(depth)) addIssue(issues, "$.report.depth", "REPORT_DEPTH", "unsupported research depth");
  return { type: type as ReportTypeId, depth };
}

function readSummary(value: unknown, issues: ResearchRunValidationIssue[]): ResearchRunSummaryV1 {
  const record = inspectRecord(value, "$.summary", summaryKeys, issues);
  const thesisRecord = inspectRecord(record.thesis, "$.summary.thesis", thesisKeys, issues);
  const forecastRecord = inspectRecord(record.forecast, "$.summary.forecast", forecastKeys, issues);
  const statement = readText(thesisRecord.statement, "$.summary.thesis.statement", 2_000, issues, true);
  const keyDebate = thesisRecord.keyDebate === null
    ? null
    : readText(thesisRecord.keyDebate, "$.summary.thesis.keyDebate", 1_200, issues);
  const invalidation = readStringArray(thesisRecord.invalidation, "$.summary.thesis.invalidation", 8, 500, issues);
  const projectionCount = readCount(forecastRecord.projectionCount, "$.summary.forecast.projectionCount", issues, 100);
  if (!Array.isArray(forecastRecord.rows)) addIssue(issues, "$.summary.forecast.rows", "ARRAY", "expected an array");
  const rows: ResearchRunForecastRowV1[] = [];
  const rawRows = Array.isArray(forecastRecord.rows) ? forecastRecord.rows : [];
  if (rawRows.length > 12) addIssue(issues, "$.summary.forecast.rows", "TOO_MANY_ITEMS", "must not contain more than 12 entries");
  for (let index = 0; index < rawRows.length; index += 1) {
    const row = inspectRecord(rawRows[index], `$.summary.forecast.rows[${index}]`, forecastRowKeys, issues);
    rows.push({
      period: readText(row.period, `$.summary.forecast.rows[${index}].period`, 40, issues),
      revenue: readNullableNumber(row.revenue, `$.summary.forecast.rows[${index}].revenue`, issues),
      ebit: readNullableNumber(row.ebit, `$.summary.forecast.rows[${index}].ebit`, issues),
      freeCashFlow: readNullableNumber(row.freeCashFlow, `$.summary.forecast.rows[${index}].freeCashFlow`, issues),
      eps: readNullableNumber(row.eps, `$.summary.forecast.rows[${index}].eps`, issues),
    });
  }
  if (projectionCount < rows.length) addIssue(issues, "$.summary.forecast.projectionCount", "COUNT_MISMATCH", "must include every compact forecast row");
  return {
    thesis: { statement, keyDebate, invalidation },
    forecast: { projectionCount, rows },
  };
}

function readEvidence(value: unknown, issues: ResearchRunValidationIssue[]): ResearchRunEvidenceV1 {
  const record = inspectRecord(value, "$.evidence", evidenceKeys, issues);
  let graphHash: string | null = null;
  if (record.graphHash !== null) {
    const candidate = typeof record.graphHash === "string" ? record.graphHash.trim().toLowerCase() : "";
    if (!/^[a-f0-9]{64}$/.test(candidate)) addIssue(issues, "$.evidence.graphHash", "HASH", "expected a SHA-256 graph hash or null");
    else graphHash = candidate;
  }
  return {
    evidenceCount: readCount(record.evidenceCount, "$.evidence.evidenceCount", issues),
    conflictCount: readCount(record.conflictCount, "$.evidence.conflictCount", issues),
    graphNodeCount: readCount(record.graphNodeCount, "$.evidence.graphNodeCount", issues),
    graphEdgeCount: readCount(record.graphEdgeCount, "$.evidence.graphEdgeCount", issues),
    graphHash,
  };
}

function readArtifact(
  value: unknown,
  companyTicker: string,
  occurredAt: string,
  issues: ResearchRunValidationIssue[],
): ReportArtifactV1 | null {
  if (value === null || value === undefined) return null;
  const validation = validateReportArtifactV1(value);
  for (const error of validation.errors) addIssue(issues, `$.reportArtifact${error.path.slice(1)}`, error.code, error.message);
  if (!validation.valid) return null;
  const artifact = value as ReportArtifactV1;
  let serialized: string;
  try {
    serialized = stableStringify(artifact) ?? "";
  } catch {
    addIssue(issues, "$.reportArtifact", "JSON", "expected JSON data");
    return null;
  }
  if (encoder.encode(serialized).byteLength > RESEARCH_RUN_MAX_ARTIFACT_BYTES) {
    addIssue(issues, "$.reportArtifact", "TOO_LARGE", `must not exceed ${RESEARCH_RUN_MAX_ARTIFACT_BYTES} bytes`);
    return null;
  }
  const ticker = readText(artifact.ticker, "$.reportArtifact.ticker", 32, issues).toUpperCase();
  if (ticker && ticker !== companyTicker) addIssue(issues, "$.reportArtifact.ticker", "TICKER_MISMATCH", "must match the run company ticker");
  const companyName = artifact.companyName === null
    ? null
    : readText(artifact.companyName, "$.reportArtifact.companyName", 240, issues);
  const asOf = readTimestamp(artifact.asOf, "$.reportArtifact.asOf", issues);
  if (asOf && occurredAt && Date.parse(asOf) > Date.parse(occurredAt)) {
    addIssue(issues, "$.reportArtifact.asOf", "TIMESTAMP_ORDER", "must not be later than occurredAt");
  }
  const currency = artifact.currency === null
    ? null
    : readText(artifact.currency, "$.reportArtifact.currency", 12, issues).toUpperCase();
  if (currency && !/^[A-Z0-9]+$/.test(currency)) addIssue(issues, "$.reportArtifact.currency", "CURRENCY_FORMAT", "expected a safe currency code");
  const method = readText(artifact.valuation.method, "$.reportArtifact.valuation.method", 160, issues);
  return {
    version: artifact.version,
    ticker: ticker || artifact.ticker,
    companyName,
    asOf: asOf || artifact.asOf,
    currency,
    valuation: {
      method: method || artifact.valuation.method,
      wacc: artifact.valuation.wacc,
      terminalGrowthRate: artifact.valuation.terminalGrowthRate,
      enterpriseValue: artifact.valuation.enterpriseValue,
      equityValue: artifact.valuation.equityValue,
      fairValuePerShare: artifact.valuation.fairValuePerShare,
    },
    recommendation: {
      rating: artifact.recommendation.rating,
      currentPrice: artifact.recommendation.currentPrice,
      targetPrice: artifact.recommendation.targetPrice,
      upsideDownside: artifact.recommendation.upsideDownside,
    },
  };
}

function manifestPayload(manifest: ResearchRunManifestV1): ResearchRunPayloadV1 {
  return {
    manifestVersion: manifest.version,
    caseId: manifest.caseId,
    report: manifest.report,
    status: manifest.status,
    reportArtifact: manifest.reportArtifact,
    summary: manifest.summary,
    evidence: manifest.evidence,
    sourceRunIds: manifest.sourceRunIds,
    idempotencyKey: manifest.idempotencyKey,
  };
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function assertManifestSize(serialized: string): void {
  if (byteLength(serialized) > RESEARCH_RUN_MAX_MANIFEST_BYTES) {
    throw new ResearchRunPayloadTooLargeError(RESEARCH_RUN_MAX_MANIFEST_BYTES);
  }
}

export function parseResearchRunManifest(value: unknown): ResearchRunManifestV1 {
  let serialized: string;
  try {
    serialized = stableStringify(value) ?? "";
  } catch {
    throw new ResearchRunManifestValidationError([{ path: "$", code: "JSON", message: "expected plain JSON data" }]);
  }
  assertManifestSize(serialized);
  const issues: ResearchRunValidationIssue[] = [];
  const record = inspectRecord(value, "$", manifestKeys, issues);
  if (record.version !== RESEARCH_RUN_MANIFEST_VERSION) {
    addIssue(issues, "$.version", "VERSION", "unsupported research run manifest version");
  }
  const company = readCompany(record.company, issues);
  const occurredAt = readTimestamp(record.occurredAt, "$.occurredAt", issues);
  const dataCutoff = readTimestamp(record.dataCutoff, "$.dataCutoff", issues);
  if (occurredAt && dataCutoff && Date.parse(dataCutoff) > Date.parse(occurredAt)) {
    addIssue(issues, "$.dataCutoff", "TIMESTAMP_ORDER", "must not be later than occurredAt");
  }
  const report = readReport(record.report, issues);
  const status = readText(record.status, "$.status", 16, issues) as ResearchRunStatus;
  if (status && !statusValues.has(status)) addIssue(issues, "$.status", "STATUS", "unsupported run status");
  const idempotencyKey = readText(record.idempotencyKey, "$.idempotencyKey", 256, issues);
  if (idempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(idempotencyKey)) {
    addIssue(issues, "$.idempotencyKey", "IDEMPOTENCY_FORMAT", "expected a safe idempotency key");
  }
  const sourceRunIds = readStringArray(record.sourceRunIds, "$.sourceRunIds", 32, 256, issues)
    .map((id) => id.toUpperCase())
    .filter((id) => {
      if (!id) return false;
      if (!/^RUN-[A-Z0-9._:-]{1,252}$/.test(id)) {
        addIssue(issues, "$.sourceRunIds", "RUN_ID_FORMAT", "expected safe source run identifiers");
        return false;
      }
      return true;
    })
    .sort(compareStableStrings);
  const schemaVersion = readVersion(record.schemaVersion, "$.schemaVersion", issues);
  const pipelineVersion = readVersion(record.pipelineVersion, "$.pipelineVersion", issues);
  const modelVersion = readVersion(record.modelVersion, "$.modelVersion", issues);
  const promptVersion = readVersion(record.promptVersion, "$.promptVersion", issues);
  const caseId = readIdentifier(record.caseId, "$.caseId", 160, issues);
  const reportArtifact = readArtifact(record.reportArtifact, company.ticker, occurredAt, issues);
  const summary = readSummary(record.summary, issues);
  const evidence = readEvidence(record.evidence, issues);
  if (issues.length > 0) throw new ResearchRunManifestValidationError(issues);
  return deepFreeze({
    version: RESEARCH_RUN_MANIFEST_VERSION,
    company,
    occurredAt,
    dataCutoff,
    schemaVersion,
    pipelineVersion,
    modelVersion,
    promptVersion,
    caseId,
    report,
    status,
    reportArtifact,
    summary,
    evidence,
    sourceRunIds,
    idempotencyKey,
  });
}

export function parseResearchRunJson(value: string): ResearchRunManifestV1 {
  if (byteLength(value) > RESEARCH_RUN_MAX_REQUEST_BYTES) {
    throw new ResearchRunPayloadTooLargeError(RESEARCH_RUN_MAX_REQUEST_BYTES);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ResearchRunManifestValidationError([{ path: "$", code: "INVALID_JSON", message: "body must contain valid JSON" }]);
  }
  return parseResearchRunManifest(parsed);
}

export function createResearchRunFromManifest(
  value: unknown,
): ResearchRunEnvelope<ResearchRunPayloadV1> {
  const manifest = parseResearchRunManifest(value);
  const run = createResearchRunEnvelope<ResearchRunPayloadV1>({
    company: {
      id: manifest.company.id,
      ticker: manifest.company.ticker,
      ...(manifest.company.name === null ? {} : { name: manifest.company.name }),
      ...(manifest.company.exchange === null ? {} : { exchange: manifest.company.exchange }),
    },
    occurredAt: manifest.occurredAt,
    dataCutoff: manifest.dataCutoff,
    schemaVersion: manifest.schemaVersion,
    pipelineVersion: manifest.pipelineVersion,
    modelVersion: manifest.modelVersion,
    promptVersion: manifest.promptVersion,
    payload: manifestPayload(manifest),
    metadata: {},
  });
  const serialized = stableStringify(run);
  if (!serialized || byteLength(serialized) > RESEARCH_RUN_MAX_STORED_BYTES) {
    throw new ResearchRunPayloadTooLargeError(RESEARCH_RUN_MAX_STORED_BYTES);
  }
  assertResearchRunEnvelope(run);
  return run;
}

export function researchRunManifestFromEnvelope(
  value: ResearchRunEnvelope<ResearchRunPayloadV1>,
): ResearchRunManifestV1 {
  assertResearchRunEnvelope(value);
  const payload = value.payload;
  return parseResearchRunManifest({
    version: payload.manifestVersion,
    company: value.company,
    occurredAt: value.occurredAt,
    dataCutoff: value.dataCutoff,
    schemaVersion: value.schemaVersion,
    pipelineVersion: value.pipelineVersion,
    modelVersion: value.modelVersion,
    promptVersion: value.promptVersion,
    caseId: payload.caseId,
    report: payload.report,
    status: payload.status,
    reportArtifact: payload.reportArtifact,
    summary: payload.summary,
    evidence: payload.evidence,
    sourceRunIds: payload.sourceRunIds,
    idempotencyKey: payload.idempotencyKey,
  });
}

export function rehydrateResearchRunJson(value: string): ResearchRunEnvelope<ResearchRunPayloadV1> {
  if (byteLength(value) > RESEARCH_RUN_MAX_STORED_BYTES) {
    throw new ResearchRunIntegrityError("Stored research run exceeds the size boundary");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ResearchRunIntegrityError("Stored research run is not valid JSON");
  }
  return rehydrateResearchRunEnvelope(parsed);
}

export function rehydrateResearchRunEnvelope(value: unknown): ResearchRunEnvelope<ResearchRunPayloadV1> {
  const issues: ResearchRunValidationIssue[] = [];
  const record = inspectRecord(value, "$", envelopeKeys, issues);
  if (record.version !== RESEARCH_RUN_VERSION) addIssue(issues, "$.version", "VERSION", "unsupported run envelope version");
  if (typeof record.runId !== "string" || !/^RUN-[A-F0-9]{64}$/.test(record.runId)) {
    addIssue(issues, "$.runId", "RUN_ID", "expected a canonical content-addressed run ID");
  }
  if (typeof record.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(record.contentHash)) {
    addIssue(issues, "$.contentHash", "HASH", "expected a server content hash");
  }
  const metadata = inspectRecord(record.metadata, "$.metadata", new Set<string>(), issues);
  if (Object.keys(metadata).length > 0) addIssue(issues, "$.metadata", "METADATA", "metadata must be empty");
  if (issues.length > 0) throw new ResearchRunIntegrityError("Stored research run envelope is not allow-listed");
  const payload = inspectRecord(record.payload, "$.payload", payloadKeys, issues);
  if (issues.length > 0) throw new ResearchRunIntegrityError("Stored research run payload is not allow-listed");
  let manifest: ReturnType<typeof parseResearchRunManifest>;
  try {
    manifest = parseResearchRunManifest({
      version: payload.manifestVersion,
      company: record.company,
      occurredAt: record.occurredAt,
      dataCutoff: record.dataCutoff,
      schemaVersion: record.schemaVersion,
      pipelineVersion: record.pipelineVersion,
      modelVersion: record.modelVersion,
      promptVersion: record.promptVersion,
      caseId: payload.caseId,
      report: payload.report,
      status: payload.status,
      reportArtifact: payload.reportArtifact,
      summary: payload.summary,
      evidence: payload.evidence,
      sourceRunIds: payload.sourceRunIds,
      idempotencyKey: payload.idempotencyKey,
    });
  } catch {
    throw new ResearchRunIntegrityError("Stored research run payload failed manifest validation");
  }
  const rebuilt = createResearchRunFromManifest(manifest);
  if (rebuilt.runId !== record.runId || rebuilt.contentHash !== record.contentHash) {
    throw new ResearchRunIntegrityError("Stored research run failed content-hash verification");
  }
  return rebuilt;
}

export function serializeResearchRun(run: ResearchRunEnvelope<ResearchRunPayloadV1>): string {
  assertResearchRunEnvelope(run);
  const serialized = stableStringify(run);
  if (!serialized) throw new ResearchRunIntegrityError("Research run could not be serialized");
  if (byteLength(serialized) > RESEARCH_RUN_MAX_STORED_BYTES) {
    throw new ResearchRunPayloadTooLargeError(RESEARCH_RUN_MAX_STORED_BYTES);
  }
  return serialized;
}

export interface ResearchRunListQueryInput {
  readonly companyId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ResearchRunListQuery {
  readonly companyId: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly limit: number;
  readonly offset: number;
  readonly order: ResearchRunOrder;
}

const listInputKeys = new Set(["companyId", "from", "to", "limit", "offset"]);
const listParamKeys = new Set(["companyId", "from", "to", "limit", "offset"]);
const detailParamKeys = new Set(["historyLimit"]);

function queryBoundary(value: string, end: boolean): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(`${trimmed}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return normalizeTimestamp(trimmed);
}

function readBoundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ResearchRunQueryValidationError(field, `${field} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new ResearchRunQueryValidationError(field, `${field} must be between 0 and ${maximum}`);
  }
  return parsed;
}

function assertParamKeys(params: URLSearchParams, allowed: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new ResearchRunQueryValidationError(key, `${key} is not an allow-listed query parameter`);
    if (seen.has(key)) throw new ResearchRunQueryValidationError(key, `${key} must not be repeated`);
    seen.add(key);
  }
}

export function normalizeResearchRunListQuery(input: ResearchRunListQueryInput = {}): ResearchRunListQuery {
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ResearchRunQueryValidationError("query", "query must be a plain object");
  }
  for (const key of Object.keys(input)) {
    if (!listInputKeys.has(key)) throw new ResearchRunQueryValidationError(key, `${key} is not an allow-listed query field`);
  }
  let companyId: string | null = null;
  if (input.companyId !== undefined) {
    const companyIssues: ResearchRunValidationIssue[] = [];
    const normalizedCompanyId = readIdentifier(input.companyId, "companyId", 160, companyIssues);
    if (companyIssues.length > 0 || !normalizedCompanyId) {
      throw new ResearchRunQueryValidationError("companyId", companyIssues[0]?.message ?? "companyId must be a safe identifier");
    }
    companyId = normalizedCompanyId.toLowerCase();
  }
  const from = input.from === undefined ? null : queryBoundary(input.from, false);
  const to = input.to === undefined ? null : queryBoundary(input.to, true);
  if (input.from !== undefined && from === null) throw new ResearchRunQueryValidationError("from", "from must be an RFC 3339 timestamp or date");
  if (input.to !== undefined && to === null) throw new ResearchRunQueryValidationError("to", "to must be an RFC 3339 timestamp or date");
  if (from !== null && to !== null && Date.parse(from) > Date.parse(to)) {
    throw new ResearchRunQueryValidationError("from", "from must not be later than to");
  }
  const rawLimit = input.limit;
  const rawOffset = input.offset;
  if (rawLimit !== undefined && (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)) {
    throw new ResearchRunQueryValidationError("limit", "limit must be between 1 and 100");
  }
  if (rawOffset !== undefined && (!Number.isSafeInteger(rawOffset) || rawOffset < 0 || rawOffset > 10_000)) {
    throw new ResearchRunQueryValidationError("offset", "offset must be between 0 and 10000");
  }
  return {
    companyId,
    from,
    to,
    limit: rawLimit ?? 25,
    offset: rawOffset ?? 0,
    order: RESEARCH_RUN_LIST_ORDER,
  };
}

export function parseResearchRunListQuery(params: URLSearchParams): ResearchRunListQuery {
  assertParamKeys(params, listParamKeys);
  return normalizeResearchRunListQuery({
    ...(params.has("companyId") ? { companyId: params.get("companyId") ?? "" } : {}),
    ...(params.has("from") ? { from: params.get("from") ?? "" } : {}),
    ...(params.has("to") ? { to: params.get("to") ?? "" } : {}),
    ...(params.has("limit") ? { limit: readBoundedInteger(params.get("limit"), "limit", 25, 100) } : {}),
    ...(params.has("offset") ? { offset: readBoundedInteger(params.get("offset"), "offset", 0, 10_000) } : {}),
  });
}

export function parseResearchRunDetailQuery(params: URLSearchParams): number {
  assertParamKeys(params, detailParamKeys);
  const historyLimit = readBoundedInteger(params.get("historyLimit") ?? undefined, "historyLimit", 10, 20);
  if (historyLimit < 1) throw new ResearchRunQueryValidationError("historyLimit", "historyLimit must be between 1 and 20");
  return historyLimit;
}

export function assertCanonicalResearchRunId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^RUN-[A-F0-9]{64}$/.test(value)) {
    throw new ResearchRunQueryValidationError("runId", "runId must be a canonical ResearchRunEnvelope.runId");
  }
}
