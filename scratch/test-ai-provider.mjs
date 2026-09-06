// ============================================================
// Test Suite: Multi-Provider AI Engine & Rate Limit Detection
// ============================================================
import assert from "node:assert";
import {
  SUPPORTED_PROVIDERS,
  RateLimitError,
  isRateLimitResponse,
  resolveProviderRequestConfig,
} from "../src/lib/ai-providers.ts";

console.log("\n=======================================================");
console.log("TESTING MULTI-PROVIDER AI CONFIGURATION & RATE LIMITS");
console.log("=======================================================\n");

// 1. Check all 5 providers are defined and properly configured
const expectedProviders = ["openrouter", "nvidia", "gemini", "groq", "openai"];
console.log("--- 1. Provider Definitions ---");
for (const p of expectedProviders) {
  const meta = SUPPORTED_PROVIDERS[p];
  assert(meta, `Provider ${p} must be defined`);
  assert(meta.baseUrl.startsWith("https://"), `Provider ${p} must have a valid HTTPS baseUrl`);
  assert(meta.defaultModel && meta.defaultModel.length > 0, `Provider ${p} must have defaultModel`);
  assert(meta.candidateModels.length >= 2, `Provider ${p} must have at least 2 candidate models`);
  assert(meta.portalUrl.startsWith("https://"), `Provider ${p} must have portalUrl`);
  console.log(`  ✓ PASS: Provider '${meta.name}' (${p}) correctly configured with default model '${meta.defaultModel}'`);
}

// 2. Test Rate Limit Detection
console.log("\n--- 2. Rate Limit & Quota Exhaustion Detection ---");
assert.strictEqual(isRateLimitResponse(429, "Too Many Requests"), true, "HTTP 429 must trigger rate limit");
assert.strictEqual(isRateLimitResponse(402, "Payment Required"), true, "HTTP 402 (quota payment) must trigger rate limit");
assert.strictEqual(isRateLimitResponse(400, "error: rate_limit_exceeded for current tier"), true, "rate_limit_exceeded must trigger rate limit");
assert.strictEqual(isRateLimitResponse(403, "Resource has been exhausted (e.g. check quota)"), true, "Resource exhausted must trigger rate limit");
assert.strictEqual(isRateLimitResponse(500, "Internal Server Error"), false, "Generic 500 must not trigger rate limit");
assert.strictEqual(isRateLimitResponse(200, "OK"), false, "200 OK must not trigger rate limit");
console.log("  ✓ PASS: HTTP 429 strictly identified as rate limit");
console.log("  ✓ PASS: HTTP 402 strictly identified as quota exhaustion");
console.log("  ✓ PASS: 'rate_limit_exceeded' string detected across HTTP error responses");
console.log("  ✓ PASS: 'Resource has been exhausted' detected across HTTP error responses");
console.log("  ✓ PASS: Standard server errors (500) and OK responses not flagged as rate limit");

// 3. Test RateLimitError class
console.log("\n--- 3. RateLimitError Class ---");
const err = new RateLimitError("NVIDIA NIM", 429, "Rate limit reached on NVIDIA NIM key");
assert.strictEqual(err.isRateLimit, true);
assert.strictEqual(err.provider, "NVIDIA NIM");
assert.strictEqual(err.statusCode, 429);
assert.strictEqual(err.message, "Rate limit reached on NVIDIA NIM key");
console.log("  ✓ PASS: RateLimitError encapsulates provider, status, and isRateLimit flag");

// 4. Test Config Resolution: Default vs Custom
console.log("\n--- 4. Request Configuration Resolution ---");
// Case A: Default server key
const defConfig = resolveProviderRequestConfig(null, "test-server-key");
assert.strictEqual(defConfig.provider, "openrouter");
assert.strictEqual(defConfig.apiKey, "test-server-key");
assert.strictEqual(defConfig.endpointUrl, "https://openrouter.ai/api/v1/chat/completions");
assert.strictEqual(defConfig.headers["Authorization"], "Bearer test-server-key");
assert.strictEqual(defConfig.headers["X-Title"], "Institutional Equity Research Engine");
console.log("  ✓ PASS: Default request correctly falls back to OpenRouter server key and sets attribution headers");

// Case B: Custom NVIDIA key
const nvidiaConfig = resolveProviderRequestConfig({
  provider: "nvidia",
  apiKey: "nvapi-custom-secret-key-12345",
  model: "deepseek-ai/deepseek-r1",
});
assert.strictEqual(nvidiaConfig.provider, "nvidia");
assert.strictEqual(nvidiaConfig.apiKey, "nvapi-custom-secret-key-12345");
assert.strictEqual(nvidiaConfig.model, "deepseek-ai/deepseek-r1");
assert.strictEqual(nvidiaConfig.endpointUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
assert.strictEqual(nvidiaConfig.headers["Authorization"], "Bearer nvapi-custom-secret-key-12345");
console.log("  ✓ PASS: Custom NVIDIA NIM key routed to integrate.api.nvidia.com with user model override");

// Case C: Custom Google Gemini key
const geminiConfig = resolveProviderRequestConfig({
  provider: "gemini",
  apiKey: "AIzaSyTestGeminiKey",
});
assert.strictEqual(geminiConfig.provider, "gemini");
assert.strictEqual(geminiConfig.apiKey, "AIzaSyTestGeminiKey");
assert.strictEqual(geminiConfig.endpointUrl, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
assert.strictEqual(geminiConfig.model, "gemini-2.0-flash");
console.log("  ✓ PASS: Custom Google Gemini key routed to generativelanguage.googleapis.com OpenAI endpoint");

// Case D: Custom Groq key
const groqConfig = resolveProviderRequestConfig({
  provider: "groq",
  apiKey: "gsk_custom_groq_key",
});
assert.strictEqual(groqConfig.provider, "groq");
assert.strictEqual(groqConfig.apiKey, "gsk_custom_groq_key");
assert.strictEqual(groqConfig.endpointUrl, "https://api.groq.com/openai/v1/chat/completions");
assert.strictEqual(groqConfig.model, "llama-3.3-70b-versatile");
console.log("  ✓ PASS: Custom Groq key routed to api.groq.com with default llama-3.3-70b-versatile");

// Case E: Custom OpenAI key
const openaiConfig = resolveProviderRequestConfig({
  provider: "openai",
  apiKey: "sk-proj-openai-key",
});
assert.strictEqual(openaiConfig.provider, "openai");
assert.strictEqual(openaiConfig.apiKey, "sk-proj-openai-key");
assert.strictEqual(openaiConfig.endpointUrl, "https://api.openai.com/v1/chat/completions");
assert.strictEqual(openaiConfig.model, "gpt-4o-mini");
console.log("  ✓ PASS: Custom OpenAI key routed to api.openai.com with gpt-4o-mini");

console.log("\n=======================================================");
console.log("ALL MULTI-PROVIDER AI CONFIGURATION TESTS PASSED (16/16)");
console.log("=======================================================\n");
