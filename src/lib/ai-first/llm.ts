/**
 * APEX RESEARCH — AI-FIRST LLM CLIENT
 *
 * Thin transport over the existing multi-provider infrastructure
 * (ai-providers.ts / openrouter.ts). Provides: model selection, retry,
 * JSON schema validation, temperature control, token budgeting.
 *
 * All arithmetic is performed by deterministic code elsewhere; agents only
 * produce structured specifications.
 */

// Transport injected from openrouter.ts at call sites (no vendor lock-in).
export interface AiFirstTransport {
  complete(
    system: string,
    user: string,
    opts?: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
  ): Promise<string>;
}

export interface AiFirstAgentConfig {
  roleId: string;
  temperature: number;
  maxTokens: number;
  jsonMode?: boolean;
}

export const AI_FIRST_PROMPT_VERSION = "1.0.0";

/** Parse JSON from an LLM response, tolerating code fences / prose. */
export function parseLlmJson<T>(text: string): T | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // try to find the first {...} block
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
