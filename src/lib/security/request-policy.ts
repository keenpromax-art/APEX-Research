import {
  SUPPORTED_PROVIDERS,
  type CustomKeyConfig,
  type SupportedProvider,
} from "../ai-providers";

export const REQUEST_POLICY_LIMITS = Object.freeze({
  maxTickerLength: 32,
  maxHeaderNameLength: 128,
  maxHeaderValueLength: 4_096,
  maxHeaderCount: 64,
  maxHeaderBytes: 16_384,
  maxBodyBytes: 1_048_576,
  maxApiKeyLength: 512,
  maxModelLength: 200,
});

export type RequestPolicyErrorCode =
  | "INVALID_TICKER"
  | "TICKER_TOO_LONG"
  | "INVALID_HEADERS"
  | "TOO_MANY_HEADERS"
  | "HEADER_NAME_TOO_LONG"
  | "HEADER_VALUE_TOO_LONG"
  | "HEADERS_TOO_LARGE"
  | "INVALID_CONTENT_LENGTH"
  | "INVALID_BODY"
  | "BODY_TOO_LARGE"
  | "INVALID_PROVIDER_CONFIG"
  | "UNSUPPORTED_PROVIDER"
  | "INVALID_API_KEY"
  | "INVALID_MODEL";

export interface RequestPolicyError {
  code: RequestPolicyErrorCode;
  field: string;
  message: string;
}

export type RequestPolicyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RequestPolicyError };

export interface ValidatedProviderConfig extends CustomKeyConfig {
  provider: SupportedProvider;
  apiKey: string;
  model: string;
}

export interface SafeProviderDescriptor {
  provider: SupportedProvider;
  model: string;
  apiKeyConfigured: true;
}

type BodyForSize = string | ArrayBuffer | ArrayBufferView | Blob;

const TICKER_PATTERN = /^[A-Z0-9^.=\-]+$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const API_KEY_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const encoder = new TextEncoder();

function failure<T>(
  code: RequestPolicyErrorCode,
  field: string,
  message: string
): RequestPolicyResult<T> {
  return { ok: false, error: { code, field, message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function parseHeaders(headers: HeadersInit): Headers | null {
  try {
    return new Headers(headers);
  } catch {
    return null;
  }
}

function declaredContentLength(headers?: HeadersInit): string | null {
  if (headers === undefined) return null;
  const parsed = parseHeaders(headers);
  return parsed?.get("content-length") ?? null;
}

export function validateTicker(input: unknown): RequestPolicyResult<string> {
  if (typeof input !== "string") {
    return failure("INVALID_TICKER", "ticker", "Ticker must be a string.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(input)) {
    return failure("INVALID_TICKER", "ticker", "Ticker contains unsupported characters.");
  }
  const normalized = input.trim().toUpperCase();
  if (!normalized) {
    return failure("INVALID_TICKER", "ticker", "Ticker is required.");
  }
  if (normalized.length > REQUEST_POLICY_LIMITS.maxTickerLength) {
    return failure("TICKER_TOO_LONG", "ticker", "Ticker exceeds the maximum length.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(normalized) || !TICKER_PATTERN.test(normalized)) {
    return failure("INVALID_TICKER", "ticker", "Ticker contains unsupported characters.");
  }
  return { ok: true, value: normalized };
}

export function validateRequestHeaders(
  headers: HeadersInit
): RequestPolicyResult<Record<string, string>> {
  const parsed = parseHeaders(headers);
  if (!parsed) {
    return failure("INVALID_HEADERS", "headers", "Headers are invalid.");
  }
  const entries = Array.from(parsed.entries());
  if (entries.length > REQUEST_POLICY_LIMITS.maxHeaderCount) {
    return failure("TOO_MANY_HEADERS", "headers", "Header count exceeds the limit.");
  }

  let totalBytes = 0;
  const safeHeaders: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!name || name.length > REQUEST_POLICY_LIMITS.maxHeaderNameLength || !HEADER_NAME_PATTERN.test(name)) {
      return failure("INVALID_HEADERS", "headers", "A header name is invalid.");
    }
    if (rawValue.length > REQUEST_POLICY_LIMITS.maxHeaderValueLength) {
      return failure("HEADER_VALUE_TOO_LONG", `headers.${name}`, "A header value exceeds the limit.");
    }
    if (/[\u0000-\u001F\u007F-\u009F]/.test(rawValue)) {
      return failure("INVALID_HEADERS", `headers.${name}`, "A header value contains control characters.");
    }
    const contentLength = name === "content-length" ? rawValue.trim() : null;
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength)))) {
      return failure("INVALID_CONTENT_LENGTH", "headers.content-length", "Content-Length is invalid.");
    }
    totalBytes += byteLength(`${name}: ${rawValue}\r\n`);
    if (totalBytes > REQUEST_POLICY_LIMITS.maxHeaderBytes) {
      return failure("HEADERS_TOO_LARGE", "headers", "Combined headers exceed the size limit.");
    }
    safeHeaders[name] = rawValue;
  }
  return { ok: true, value: safeHeaders };
}

function measuredBodyLength(body: BodyForSize): number | null {
  if (typeof body === "string") return byteLength(body);
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  return null;
}

export function validateRequestBodySize(
  body: BodyForSize,
  headers?: HeadersInit
): RequestPolicyResult<number> {
  const declared = declaredContentLength(headers);
  if (declared !== null) {
    const trimmed = declared.trim();
    if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
      return failure("INVALID_CONTENT_LENGTH", "headers.content-length", "Content-Length is invalid.");
    }
    if (Number(trimmed) > REQUEST_POLICY_LIMITS.maxBodyBytes) {
      return failure("BODY_TOO_LARGE", "body", "Request body exceeds the size limit.");
    }
  }
  const measured = measuredBodyLength(body);
  if (measured === null || !Number.isSafeInteger(measured) || measured < 0) {
    return failure("INVALID_BODY", "body", "Request body must be a supported binary or text value.");
  }
  if (measured > REQUEST_POLICY_LIMITS.maxBodyBytes) {
    return failure("BODY_TOO_LARGE", "body", "Request body exceeds the size limit.");
  }
  return { ok: true, value: measured };
}

function validateProviderName(value: unknown): RequestPolicyResult<SupportedProvider> {
  if (value === undefined) return { ok: true, value: "openrouter" };
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(SUPPORTED_PROVIDERS, value)) {
    return failure("UNSUPPORTED_PROVIDER", "provider", "Provider is not supported.");
  }
  return { ok: true, value: value as SupportedProvider };
}

export function validateProviderConfig(
  input: unknown
): RequestPolicyResult<ValidatedProviderConfig> {
  if (!isPlainObject(input)) {
    return failure("INVALID_PROVIDER_CONFIG", "providerConfig", "Provider configuration must be an object.");
  }
  const allowedKeys = new Set(["provider", "apiKey", "model"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return failure("INVALID_PROVIDER_CONFIG", "providerConfig", "Provider configuration contains unsupported fields.");
  }
  const providerResult = validateProviderName(input.provider);
  if (!providerResult.ok) return providerResult;
  const provider = providerResult.value;
  if (typeof input.apiKey !== "string") {
    return failure("INVALID_API_KEY", "providerConfig.apiKey", "API key is required.");
  }
  const apiKey = input.apiKey.trim();
  if (
    !apiKey ||
    apiKey.length > REQUEST_POLICY_LIMITS.maxApiKeyLength ||
    !API_KEY_PATTERN.test(apiKey)
  ) {
    return failure("INVALID_API_KEY", "providerConfig.apiKey", "API key is invalid.");
  }
  const rawModel = input.model;
  if (rawModel !== undefined && typeof rawModel !== "string") {
    return failure("INVALID_MODEL", "providerConfig.model", "Model must be a string.");
  }
  const model = rawModel?.trim() || SUPPORTED_PROVIDERS[provider].defaultModel;
  if (
    model.length > REQUEST_POLICY_LIMITS.maxModelLength ||
    !MODEL_PATTERN.test(model)
  ) {
    return failure("INVALID_MODEL", "providerConfig.model", "Model identifier is invalid.");
  }
  return { ok: true, value: { provider, apiKey, model } };
}

export function resolveSafeProviderConfig(
  body: unknown,
  headers: HeadersInit = {}
): RequestPolicyResult<ValidatedProviderConfig | null> {
  const headerResult = validateRequestHeaders(headers);
  if (!headerResult.ok) return headerResult;
  const safeHeaders = headerResult.value;
  const headerApiKey = safeHeaders["x-custom-api-key"];
  if (headerApiKey !== undefined) {
    return validateProviderConfig({
      provider: safeHeaders["x-custom-api-provider"] || "openrouter",
      apiKey: headerApiKey,
      model: safeHeaders["x-custom-api-model"] || undefined,
    });
  }
  if (!isPlainObject(body)) return { ok: true, value: null };
  if (body.customKeyConfig === undefined || body.customKeyConfig === null) {
    return { ok: true, value: null };
  }
  const configResult = validateProviderConfig(body.customKeyConfig);
  return configResult.ok
    ? { ok: true, value: configResult.value }
    : configResult;
}

export function describeProviderConfigSafely(
  config: ValidatedProviderConfig
): SafeProviderDescriptor {
  return {
    provider: config.provider,
    model: config.model,
    apiKeyConfigured: true,
  };
}
