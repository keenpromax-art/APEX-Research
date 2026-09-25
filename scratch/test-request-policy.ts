import assert from "node:assert/strict";
import {
  REQUEST_POLICY_LIMITS,
  describeProviderConfigSafely,
  resolveSafeProviderConfig,
  validateProviderConfig,
  validateRequestBodySize,
  validateRequestHeaders,
  validateTicker,
  type RequestPolicyError,
  type RequestPolicyErrorCode,
  type RequestPolicyResult,
} from "../src/lib/security/request-policy";

function expectFailure<T>(
  result: RequestPolicyResult<T>,
  code: RequestPolicyErrorCode
): RequestPolicyError {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected policy validation to fail");
  assert.equal(result.error.code, code);
  return result.error;
}

const validTicker = validateTicker(" brk-b ");
assert.equal(validTicker.ok, true);
if (validTicker.ok) assert.equal(validTicker.value, "BRK-B");
expectFailure(validateTicker("AAPL/../../etc"), "INVALID_TICKER");
expectFailure(validateTicker("AAPL\n"), "INVALID_TICKER");
expectFailure(validateTicker("A".repeat(REQUEST_POLICY_LIMITS.maxTickerLength + 1)), "TICKER_TOO_LONG");

const smallHeaders = validateRequestHeaders({ "X-Test": "ok", "Content-Length": "4" });
assert.equal(smallHeaders.ok, true);
if (smallHeaders.ok) {
  assert.equal(smallHeaders.value["x-test"], "ok");
  assert.equal(smallHeaders.value["content-length"], "4");
}
const oversizedHeaders = Object.fromEntries(
  Array.from({ length: 5 }, (_, index) => [`x-test-${index}`, "a".repeat(4_000)])
);
expectFailure(validateRequestHeaders(oversizedHeaders), "HEADERS_TOO_LARGE");
const tooManyHeaders = Object.fromEntries(
  Array.from({ length: REQUEST_POLICY_LIMITS.maxHeaderCount + 1 }, (_, index) => [`x-${index}`, "ok"])
);
expectFailure(validateRequestHeaders(tooManyHeaders), "TOO_MANY_HEADERS");

const body = "A".repeat(4);
const smallBody = validateRequestBodySize(body, { "content-length": "4" });
assert.deepEqual(smallBody, { ok: true, value: 4 });
expectFailure(
  validateRequestBodySize("{}", { "content-length": String(REQUEST_POLICY_LIMITS.maxBodyBytes + 1) }),
  "BODY_TOO_LARGE"
);
expectFailure(
  validateRequestBodySize(new Uint8Array(REQUEST_POLICY_LIMITS.maxBodyBytes + 1), { "content-length": "4" }),
  "BODY_TOO_LARGE"
);
const unicodeBody = validateRequestBodySize("界".repeat(2));
assert.equal(unicodeBody.ok, true);
if (unicodeBody.ok) assert.equal(unicodeBody.value, 6);

const secret = "sk-or-v1-private_test-key_123";
const provider = validateProviderConfig({ provider: "openrouter", apiKey: secret, model: "vendor/model:v1" });
assert.equal(provider.ok, true);
if (provider.ok) {
  assert.equal(provider.value.apiKey, secret);
  assert.equal(provider.value.model, "vendor/model:v1");
}
const defaultProvider = validateProviderConfig({ apiKey: "nvapi-test_key-123" });
assert.equal(defaultProvider.ok, true);
if (defaultProvider.ok) assert.equal(defaultProvider.value.provider, "openrouter");
expectFailure(validateProviderConfig({ provider: "unknown", apiKey: "valid-key" }), "UNSUPPORTED_PROVIDER");
expectFailure(validateProviderConfig({ provider: "openai", apiKey: "key with spaces" }), "INVALID_API_KEY");
expectFailure(validateProviderConfig({ provider: "openai", apiKey: "valid-key", model: "bad\nmodel" }), "INVALID_MODEL");
expectFailure(
  validateProviderConfig({ provider: "openai", apiKey: "valid-key", baseUrl: "http://127.0.0.1" }),
  "INVALID_PROVIDER_CONFIG"
);

const headerConfig = resolveSafeProviderConfig(
  { customKeyConfig: { provider: "openai", apiKey: "body-key" } },
  { "x-custom-api-key": secret, "x-custom-api-provider": "openrouter", "x-custom-api-model": "header/model" }
);
assert.equal(headerConfig.ok, true);
if (headerConfig.ok && headerConfig.value) {
  assert.equal(headerConfig.value.apiKey, secret);
  assert.equal(headerConfig.value.model, "header/model");
  const descriptor = describeProviderConfigSafely(headerConfig.value);
  assert.deepEqual(descriptor, { provider: "openrouter", model: "header/model", apiKeyConfigured: true });
  assert.doesNotMatch(JSON.stringify(descriptor), new RegExp(secret));
}

const invalidSecret = "private-key-value";
const invalidResult = validateProviderConfig({ provider: "openai", apiKey: `${invalidSecret}\ninj` });
assert.equal(invalidResult.ok, false);
if (!invalidResult.ok) assert.doesNotMatch(JSON.stringify(invalidResult.error), new RegExp(invalidSecret));

console.log("request-policy tests passed");
