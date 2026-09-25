export const REPORT_ARTIFACT_VERSION = "report-artifact-v1" as const;
export const REPORT_ARTIFACT_HASH_ALGORITHM = "fnv1a32" as const;

export type ReportArtifactRating = "BUY" | "HOLD" | "SELL" | "NR";

export interface ReportArtifactValuationV1 {
  method: string;
  wacc: number | null;
  terminalGrowthRate: number | null;
  enterpriseValue: number | null;
  equityValue: number | null;
  fairValuePerShare: number | null;
}

export interface ReportArtifactRecommendationV1 {
  rating: ReportArtifactRating | null;
  currentPrice: number | null;
  targetPrice: number | null;
  upsideDownside: number | null;
}

export interface ReportArtifactV1 {
  version: typeof REPORT_ARTIFACT_VERSION;
  ticker: string;
  companyName: string | null;
  asOf: string;
  currency: string | null;
  valuation: ReportArtifactValuationV1;
  recommendation: ReportArtifactRecommendationV1;
}

export interface ReportArtifactValuationInput {
  method?: string;
  wacc?: number | null;
  terminalGrowthRate?: number | null;
  terminalGrowth?: number | null;
  enterpriseValue?: number | null;
  equityValue?: number | null;
  fairValuePerShare?: number | null;
  fairValue?: number | null;
  [key: string]: unknown;
}

export interface ReportArtifactRecommendationInput {
  rating?: string | null;
  currentPrice?: number | null;
  targetPrice?: number | null;
  upsideDownside?: number | null;
  [key: string]: unknown;
}

export interface ReportArtifactV1Input {
  ticker?: string;
  symbol?: string;
  companyName?: string | null;
  asOf?: string;
  asOfDate?: string;
  currency?: string | null;
  valuation?: ReportArtifactValuationInput;
  method?: string;
  wacc?: number | null;
  terminalGrowthRate?: number | null;
  terminalGrowth?: number | null;
  enterpriseValue?: number | null;
  equityValue?: number | null;
  fairValuePerShare?: number | null;
  fairValue?: number | null;
  recommendation?: ReportArtifactRecommendationInput;
  currentPrice?: number | null;
  targetPrice?: number | null;
  upsideDownside?: number | null;
  rating?: string | null;
  [key: string]: unknown;
}

export type MinimalReportArtifactInput = ReportArtifactV1Input;

export interface ReportArtifactValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ReportArtifactValidationResult {
  valid: boolean;
  errors: ReportArtifactValidationIssue[];
}

export interface SealedReportArtifactV1 {
  artifact: ReportArtifactV1;
  serialized: string;
  hash: string;
}

export class ReportArtifactValidationError extends Error {
  readonly issues: ReportArtifactValidationIssue[];

  constructor(issues: ReportArtifactValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "ReportArtifactValidationError";
    this.issues = issues;
  }
}

export class ReportArtifactSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportArtifactSerializationError";
  }
}

const valuationKeys = new Set([
  "method",
  "wacc",
  "terminalGrowthRate",
  "enterpriseValue",
  "equityValue",
  "fairValuePerShare",
]);

const recommendationKeys = new Set([
  "rating",
  "currentPrice",
  "targetPrice",
  "upsideDownside",
]);

const artifactKeys = new Set([
  "version",
  "ticker",
  "companyName",
  "asOf",
  "currency",
  "valuation",
  "recommendation",
]);

const ratingValues = new Set<ReportArtifactRating>(["BUY", "HOLD", "SELL", "NR"]);

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inputError(path: string, message: string): never {
  throw new ReportArtifactValidationError([{ path, code: "INVALID_INPUT", message }]);
}

function readString(source: Record<string, unknown>, key: string, path: string): string | null | undefined {
  if (!hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") inputError(`${path}.${key}`, "expected a string or null");
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readNumber(source: Record<string, unknown>, key: string, path: string): number | null | undefined {
  if (!hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) inputError(`${path}.${key}`, "expected a finite number or null");
  return value;
}

function firstString(source: Record<string, unknown>, keys: string[], path: string): string | null {
  for (const key of keys) {
    const value = readString(source, key, path);
    if (value !== undefined) return value;
  }
  return null;
}

function firstNumber(source: Record<string, unknown>, keys: string[], path: string): number | null {
  for (const key of keys) {
    const value = readNumber(source, key, path);
    if (value !== undefined) return value;
  }
  return null;
}

function readNullableString(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.length === 0 ? null : value;
}

function readNullableNumber(value: number | null | undefined): number | null {
  return value === undefined ? null : value;
}

function readValuationSource(input: Record<string, unknown>): Record<string, unknown> {
  const valuation = input.valuation ?? input.dcf;
  if (valuation === undefined || valuation === null) return input;
  if (!isRecord(valuation)) inputError("valuation", "expected an object");
  return valuation;
}

function readRecommendationSource(input: Record<string, unknown>): Record<string, unknown> {
  const recommendation = input.recommendation;
  if (recommendation === undefined || recommendation === null) return input;
  if (!isRecord(recommendation)) inputError("recommendation", "expected an object");
  return recommendation;
}

function normalizeRating(value: string | null): ReportArtifactRating | null {
  if (value === null) return null;
  const normalized = value.toUpperCase();
  if (!ratingValues.has(normalized as ReportArtifactRating)) inputError("recommendation.rating", "unsupported rating");
  return normalized as ReportArtifactRating;
}

export function projectReportArtifactV1(input: ReportArtifactV1Input): ReportArtifactV1 {
  if (!isRecord(input)) inputError("$", "expected an object");
  const company = isRecord(input.company) ? input.company : {};
  const profile = isRecord(input.profile) ? input.profile : {};
  const valuationSource = readValuationSource(input);
  const recommendationSource = readRecommendationSource(input);
  const ticker = firstString(input, ["ticker", "symbol"], "$") ?? firstString(company, ["ticker", "symbol"], "$.company") ?? firstString(profile, ["ticker", "symbol"], "$.profile");
  if (!ticker) inputError("$.ticker", "a non-empty ticker is required");
  const asOf = firstString(input, ["asOf", "asOfDate", "reportDate", "generatedAt"], "$") ?? firstString(profile, ["asOf", "asOfDate"], "$.profile");
  if (!asOf) inputError("$.asOf", "a non-empty as-of date is required");
  const companyName = readNullableString(firstString(input, ["companyName"], "$") ?? firstString(company, ["name", "companyName"], "$.company") ?? firstString(profile, ["name", "companyName"], "$.profile"));
  const currency = readNullableString(firstString(input, ["currency"], "$") ?? firstString(company, ["currency"], "$.company") ?? firstString(profile, ["currency"], "$.profile"));
  const method = firstString(valuationSource, ["method"], "$.valuation") ?? firstString(input, ["method"], "$") ?? "UNKNOWN";
  const wacc = firstNumber(valuationSource, ["wacc"], "$.valuation") ?? firstNumber(input, ["wacc"], "$");
  const terminalGrowthRate = firstNumber(valuationSource, ["terminalGrowthRate", "terminalGrowth"], "$.valuation") ?? firstNumber(input, ["terminalGrowthRate", "terminalGrowth"], "$");
  const enterpriseValue = firstNumber(valuationSource, ["enterpriseValue"], "$.valuation") ?? firstNumber(input, ["enterpriseValue"], "$");
  const equityValue = firstNumber(valuationSource, ["equityValue"], "$.valuation") ?? firstNumber(input, ["equityValue"], "$");
  const fairValuePerShare = firstNumber(valuationSource, ["fairValuePerShare", "fairValue"], "$.valuation") ?? firstNumber(input, ["fairValuePerShare", "fairValue"], "$");
  const rating = normalizeRating(firstString(recommendationSource, ["rating"], "$.recommendation") ?? firstString(input, ["rating"], "$"));
  const currentPrice = firstNumber(recommendationSource, ["currentPrice"], "$.recommendation") ?? firstNumber(input, ["currentPrice"], "$");
  const targetPrice = firstNumber(recommendationSource, ["targetPrice"], "$.recommendation") ?? firstNumber(input, ["targetPrice"], "$");
  const upsideDownside = firstNumber(recommendationSource, ["upsideDownside"], "$.recommendation") ?? firstNumber(input, ["upsideDownside"], "$");
  const artifact: ReportArtifactV1 = {
    version: REPORT_ARTIFACT_VERSION,
    ticker,
    companyName,
    asOf,
    currency: currency === null ? null : currency.toUpperCase(),
    valuation: {
      method,
      wacc: readNullableNumber(wacc),
      terminalGrowthRate: readNullableNumber(terminalGrowthRate),
      enterpriseValue: readNullableNumber(enterpriseValue),
      equityValue: readNullableNumber(equityValue),
      fairValuePerShare: readNullableNumber(fairValuePerShare),
    },
    recommendation: {
      rating,
      currentPrice: readNullableNumber(currentPrice),
      targetPrice: readNullableNumber(targetPrice),
      upsideDownside: readNullableNumber(upsideDownside),
    },
  };
  const validation = validateReportArtifactV1(artifact);
  if (!validation.valid) throw new ReportArtifactValidationError(validation.errors);
  return artifact;
}

function addIssue(errors: ReportArtifactValidationIssue[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function validateJsonValue(value: unknown, path: string, errors: ReportArtifactValidationIssue[], seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) addIssue(errors, path, "NON_FINITE_NUMBER", "only finite numbers are allowed");
    return;
  }
  if (typeof value === "undefined") {
    addIssue(errors, path, "UNDEFINED", "undefined is not allowed");
    return;
  }
  if (typeof value === "function") {
    addIssue(errors, path, "FUNCTION", "functions are not allowed");
    return;
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    addIssue(errors, path, "NON_JSON_VALUE", "value is not JSON serializable");
    return;
  }
  if (!isRecord(value)) {
    addIssue(errors, path, "NON_OBJECT", "only plain objects and arrays are allowed");
    return;
  }
  if (seen.has(value)) {
    addIssue(errors, path, "CYCLE", "cyclic values are not allowed");
    return;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    addIssue(errors, path, "SYMBOL_KEY", "symbol keys are not allowed");
  }
  if (Array.isArray(value)) {
    seen.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        addIssue(errors, `${path}[${index}]`, "ARRAY_HOLE", "sparse arrays are not allowed");
        continue;
      }
      if (!("value" in descriptor)) addIssue(errors, `${path}[${index}]`, "ACCESSOR", "accessor properties are not allowed");
      else validateJsonValue(descriptor.value, `${path}[${index}]`, errors, seen);
    }
    const extraKeys = Object.keys(value).filter((key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length);
    for (const key of extraKeys) {
      addIssue(errors, `${path}.${key}`, "ARRAY_PROPERTY", "array custom properties are not allowed");
    }
    seen.delete(value);
    return;
  }
  if (!isPlainRecord(value)) {
    addIssue(errors, path, "NON_PLAIN_OBJECT", "only plain objects are allowed");
    return;
  }
  seen.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      addIssue(errors, `${path}.${key}`, "ACCESSOR", "accessor properties are not allowed");
      continue;
    }
    validateJsonValue(descriptor.value, `${path}.${key}`, errors, seen);
  }
  seen.delete(value);
}

function validateStringField(value: unknown, path: string, allowNull: boolean, errors: ReportArtifactValidationIssue[]): void {
  if (allowNull && value === null) return;
  if (typeof value !== "string" || value.trim().length === 0) addIssue(errors, path, "INVALID_STRING", "expected a non-empty string");
}

function validateNumberField(value: unknown, path: string, errors: ReportArtifactValidationIssue[]): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) addIssue(errors, path, "INVALID_NUMBER", "expected a finite number or null");
}

function validateObjectKeys(value: Record<string, unknown>, allowed: Set<string>, path: string, errors: ReportArtifactValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(errors, `${path}.${key}`, "UNEXPECTED_FIELD", "field is not part of the public artifact");
  }
}

export function validateReportArtifactV1(value: unknown): ReportArtifactValidationResult {
  const errors: ReportArtifactValidationIssue[] = [];
  validateJsonValue(value, "$", errors, new Set<object>());
  if (!isPlainRecord(value)) {
    if (!errors.some((issue) => issue.path === "$" && issue.code === "NON_OBJECT")) addIssue(errors, "$", "NON_OBJECT", "expected a plain object");
    return { valid: false, errors };
  }
  validateObjectKeys(value, artifactKeys, "$", errors);
  if (value.version !== REPORT_ARTIFACT_VERSION) addIssue(errors, "$.version", "VERSION", "unsupported artifact version");
  validateStringField(value.ticker, "$.ticker", false, errors);
  validateStringField(value.companyName, "$.companyName", true, errors);
  validateStringField(value.asOf, "$.asOf", false, errors);
  validateStringField(value.currency, "$.currency", true, errors);
  const valuation = value.valuation;
  if (!isPlainRecord(valuation)) {
    addIssue(errors, "$.valuation", "INVALID_OBJECT", "expected a plain object");
  } else {
    validateObjectKeys(valuation, valuationKeys, "$.valuation", errors);
    validateStringField(valuation.method, "$.valuation.method", false, errors);
    validateNumberField(valuation.wacc, "$.valuation.wacc", errors);
    validateNumberField(valuation.terminalGrowthRate, "$.valuation.terminalGrowthRate", errors);
    validateNumberField(valuation.enterpriseValue, "$.valuation.enterpriseValue", errors);
    validateNumberField(valuation.equityValue, "$.valuation.equityValue", errors);
    validateNumberField(valuation.fairValuePerShare, "$.valuation.fairValuePerShare", errors);
  }
  const recommendation = value.recommendation;
  if (!isPlainRecord(recommendation)) {
    addIssue(errors, "$.recommendation", "INVALID_OBJECT", "expected a plain object");
  } else {
    validateObjectKeys(recommendation, recommendationKeys, "$.recommendation", errors);
    if (recommendation.rating !== null && (typeof recommendation.rating !== "string" || !ratingValues.has(recommendation.rating as ReportArtifactRating))) {
      addIssue(errors, "$.recommendation.rating", "INVALID_RATING", "unsupported rating");
    }
    validateNumberField(recommendation.currentPrice, "$.recommendation.currentPrice", errors);
    validateNumberField(recommendation.targetPrice, "$.recommendation.targetPrice", errors);
    validateNumberField(recommendation.upsideDownside, "$.recommendation.upsideDownside", errors);
  }
  return { valid: errors.length === 0, errors };
}

export function isReportArtifactV1(value: unknown): value is ReportArtifactV1 {
  return validateReportArtifactV1(value).valid;
}

export function isValidReportArtifactV1(value: unknown): boolean {
  return validateReportArtifactV1(value).valid;
}

export function assertReportArtifactV1(value: unknown): ReportArtifactV1 {
  const validation = validateReportArtifactV1(value);
  if (!validation.valid) throw new ReportArtifactValidationError(validation.errors);
  return value as ReportArtifactV1;
}

function stableStringifyValue(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ReportArtifactSerializationError(`${path} is not finite`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") throw new ReportArtifactSerializationError(`${path} is not JSON serializable`);
  if (seen.has(value)) throw new ReportArtifactSerializationError(`${path} contains a cycle`);
  if (Array.isArray(value)) {
    seen.add(value);
    const result = `[${value.map((item, index) => stableStringifyValue(item, `${path}[${index}]`, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isPlainRecord(value)) throw new ReportArtifactSerializationError(`${path} is not a plain object`);
  seen.add(value);
  const result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyValue(value[key], `${path}.${key}`, seen)}`).join(",")}}`;
  seen.delete(value);
  return result;
}

export function stableStringify(value: unknown): string {
  const errors: ReportArtifactValidationIssue[] = [];
  validateJsonValue(value, "$", errors, new Set<object>());
  if (errors.length > 0) throw new ReportArtifactSerializationError(errors[0].message);
  return stableStringifyValue(value, "$", new Set<object>());
}

export function serializeReportArtifactV1(artifact: ReportArtifactV1): string {
  assertReportArtifactV1(artifact);
  return stableStringify(artifact);
}

export function hashReportArtifactV1(artifact: ReportArtifactV1): string {
  const serialized = serializeReportArtifactV1(artifact);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ra1_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sealReportArtifactV1(artifact: ReportArtifactV1): SealedReportArtifactV1 {
  const serialized = serializeReportArtifactV1(artifact);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const sealedHash = `ra1_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  return { artifact, serialized, hash: sealedHash };
}

export function verifyReportArtifactV1(artifact: ReportArtifactV1, expectedHash: string): boolean {
  return hashReportArtifactV1(artifact) === expectedHash;
}

export const createReportArtifactV1 = projectReportArtifactV1;
export const buildReportArtifactV1 = projectReportArtifactV1;
export const projectReportArtifact = projectReportArtifactV1;
export const serializeReportArtifact = serializeReportArtifactV1;
export const hashReportArtifact = hashReportArtifactV1;
export const validateReportArtifact = validateReportArtifactV1;
export const assertReportArtifact = assertReportArtifactV1;
export const sealReportArtifact = sealReportArtifactV1;
export const isValidReportArtifact = isValidReportArtifactV1;
