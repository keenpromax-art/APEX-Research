// ============================================================
// Multi-Provider AI Configuration & Failover Engine
// Supports OpenRouter, NVIDIA NIM, Google Gemini, Groq, and OpenAI
// ============================================================

export type SupportedProvider = "openrouter" | "nvidia" | "gemini" | "groq" | "openai";

export interface CustomKeyConfig {
  provider: SupportedProvider;
  apiKey: string;
  model?: string;
}

export interface ProviderMeta {
  id: SupportedProvider;
  name: string;
  badge: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
  candidateModels: string[];
  keyPlaceholder: string;
  keyPrefixHint: string;
  portalUrl: string;
  portalName: string;
  isFreeTierAvailable: boolean;
  freeTierNote: string;
}

export const SUPPORTED_PROVIDERS: Record<SupportedProvider, ProviderMeta> = {
  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    badge: "⚡ 1,000 Free Credits",
    description: "Enterprise accelerated AI endpoints hosted by NVIDIA on DGX Cloud.",
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    defaultModel: "meta/llama-3.3-70b-instruct",
    candidateModels: [
      "meta/llama-3.3-70b-instruct",
      "mistralai/mixtral-8x22b-instruct",
      "deepseek-ai/deepseek-r1",
      "nvidia/llama-3.1-nemotron-70b-instruct",
    ],
    keyPlaceholder: "nvapi-...",
    keyPrefixHint: "nvapi-",
    portalUrl: "https://build.nvidia.com/explore/discover",
    portalName: "build.nvidia.com",
    isFreeTierAvailable: true,
    freeTierNote: "Free 1,000 credits upon sign-in with any work or personal email.",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    badge: "🌐 Multi-Model Router",
    description: "Unified AI gateway with access to dozens of leading open and proprietary models.",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "dots-studio/dots-3-note-preview:free",
    candidateModels: [
      "dots-studio/dots-3-note-preview:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "minimax/minimax-m3:free",
      "inclusionai/ling-3.0-flash-fin:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemma-4-31b-it:free",
      "z-ai/glm-5.2:free",
    ],
    keyPlaceholder: "sk-or-v1-...",
    keyPrefixHint: "sk-or-v1-",
    portalUrl: "https://openrouter.ai/keys",
    portalName: "openrouter.ai",
    isFreeTierAvailable: true,
    freeTierNote: "Offers free model variants with zero credit balance requirement.",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    badge: "💎 Fast & Free Tier",
    description: "Google's state-of-the-art frontier multimodal and reasoning models.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.0-flash",
    candidateModels: [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ],
    keyPlaceholder: "AIzaSy...",
    keyPrefixHint: "AIzaSy",
    portalUrl: "https://aistudio.google.com/app/apikey",
    portalName: "Google AI Studio",
    isFreeTierAvailable: true,
    freeTierNote: "Generous free RPM/RPD limits on Gemini 2.0 Flash in Google AI Studio.",
  },
  groq: {
    id: "groq",
    name: "Groq Cloud",
    badge: "🚀 Ultra-Low Latency",
    description: "LPU inference engine delivering 500+ tokens per second on open models.",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    candidateModels: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
    ],
    keyPlaceholder: "gsk_...",
    keyPrefixHint: "gsk_",
    portalUrl: "https://console.groq.com/keys",
    portalName: "console.groq.com",
    isFreeTierAvailable: true,
    freeTierNote: "High-speed free tier on standard Llama models.",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    badge: "🧠 Industry Standard",
    description: "Direct OpenAI API access for GPT-4o and GPT-4o-mini models.",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    candidateModels: [
      "gpt-4o-mini",
      "gpt-4o",
    ],
    keyPlaceholder: "sk-proj-...",
    keyPrefixHint: "sk-",
    portalUrl: "https://platform.openai.com/api-keys",
    portalName: "platform.openai.com",
    isFreeTierAvailable: false,
    freeTierNote: "Requires pay-as-you-go credit balance in OpenAI platform account.",
  },
};

export class RateLimitError extends Error {
  public readonly isRateLimit = true;
  public readonly provider: string;
  public readonly statusCode: number;
  /** Machine-readable failure class so UI can show the right remedy. */
  public readonly kind: LlmFailureKind;

  constructor(provider: string, statusCode: number, message: string, kind: LlmFailureKind = "rate_limited") {
    super(message);
    this.name = "RateLimitError";
    this.provider = provider;
    this.statusCode = statusCode;
    this.kind = kind;
  }
}

export type LlmFailureKind = "rate_limited" | "key_exhausted" | "invalid_key" | "other";

/**
 * Thrown when a multi-agent run must pause on provider throttling WITHOUT
 * losing completed work. Carries the finished agents' raw results so the next
 * request resumes exactly where this one stopped instead of starting over.
 */
export class PausedForRateLimitError extends RateLimitError {
  public readonly partial: Record<string, unknown>;
  public readonly completedAgents: number;
  public readonly totalAgents: number;
  public readonly nextAgentId?: string;

  constructor(
    provider: string,
    statusCode: number,
    message: string,
    partial: Record<string, unknown>,
    completedAgents: number,
    totalAgents: number,
    nextAgentId?: string
  ) {
    super(provider, statusCode, message, "rate_limited");
    this.name = "PausedForRateLimitError";
    this.partial = partial;
    this.completedAgents = completedAgents;
    this.totalAgents = totalAgents;
    this.nextAgentId = nextAgentId;
  }
}

/**
 * Classifies an LLM HTTP failure so the caller can respond correctly:
 * - invalid_key: wrong/revoked key — retrying or failing over is pointless.
 * - key_exhausted: out of credits/quota — every model on the key fails the same way.
 * - rate_limited: per-minute/per-model throttle — paced retry or model failover helps.
 * - other: model errors (404/500/timeout) — model failover helps, no quota burned.
 */
export function classifyLlmFailure(status: number, responseText: string): LlmFailureKind {
  const lower = (responseText || "").toLowerCase();
  if (
    status === 401 ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication failed") ||
    lower.includes("invalid authentication")
  ) {
    return "invalid_key";
  }
  if (
    status === 402 ||
    (lower.includes("insufficient") && lower.includes("credit")) ||
    lower.includes("credits exceeded") ||
    lower.includes("out of credits") ||
    lower.includes("payment required") ||
    lower.includes("top up") ||
    lower.includes("top-up") ||
    (lower.includes("billing") && lower.includes("quota"))
  ) {
    return "key_exhausted";
  }
  if (isRateLimitResponse(status, responseText)) return "rate_limited";
  return "other";
}

/**
 * Checks if an HTTP response or error message indicates a rate limit or quota exhaustion.
 */
export function isRateLimitResponse(status: number, responseText: string): boolean {
  if (status === 429) return true;
  if (status === 402) return true; // Insufficient credits / payment required

  const lower = responseText.toLowerCase();
  if (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota_exceeded") ||
    lower.includes("resource_exhausted") ||
    lower.includes("resource exhausted") ||
    lower.includes("resource has been exhausted") ||
    lower.includes("credits exceeded") ||
    lower.includes("insufficient_quota") ||
    lower.includes("insufficient quota") ||
    lower.includes("too many requests") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("429")
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves the request parameters for a given provider and custom/default key.
 */
export function resolveProviderRequestConfig(
  customConfig?: CustomKeyConfig | null,
  fallbackEnvKey?: string
) {
  const providerKey = customConfig?.provider || "openrouter";
  const providerMeta = SUPPORTED_PROVIDERS[providerKey] || SUPPORTED_PROVIDERS.openrouter;

  const apiKey = customConfig?.apiKey?.trim() || fallbackEnvKey || process.env.OPENROUTER_API_KEY || "";
  const model = customConfig?.model?.trim() || providerMeta.defaultModel;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // OpenRouter requires HTTP-Referer and X-Title for rankings and free-tier attribution
  if (providerKey === "openrouter") {
    headers["HTTP-Referer"] = siteUrl;
    headers["X-Title"] = "Institutional Equity Research Engine";
  }

  return {
    provider: providerKey,
    providerMeta,
    apiKey,
    model,
    endpointUrl: providerMeta.baseUrl,
    headers,
  };
}
