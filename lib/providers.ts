export interface AIProvider {
  generate(
    messages: { role: string; content: string }[],
    opts: { temperature?: number; timeout?: number }
  ): Promise<string>;
}

const RETRY_DELAYS = [5, 15];

abstract class OpenAICompatibleProvider implements AIProvider {
  constructor(
    protected apiKey: string,
    protected model: string,
    protected baseUrl: string
  ) {}

  async generate(
    messages: { role: string; content: string }[],
    opts: { temperature?: number; timeout?: number } = {}
  ): Promise<string> {
    const timeout = (opts.timeout ?? 120) * 1000;
    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      response_format: { type: "json_object" },
    };
    try {
      return await this.post(payload, timeout);
    } catch {
      delete payload.response_format;
      return this.post(payload, timeout);
    }
  }

  private async post(payload: Record<string, unknown>, timeout: number): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeout),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { choices: { message: { content: string } }[] };
          return data.choices[0].message.content;
        }
        lastError = new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        if ([429, 500, 502, 503].includes(resp.status) && attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt] * 1000);
          continue;
        }
        throw lastError;
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError") throw new Error(`AI analysis timed out.`);
        const err: Error = e instanceof Error ? e : new Error(String(e));
        lastError = err;
        if (err.message.startsWith("AI analysis timed out")) throw err;
        if ([429, 500, 502, 503].some((s) => err.message.includes(`HTTP ${s}`)) && attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt] * 1000);
          continue;
        }
        throw err;
      }
    }
    throw lastError ?? new Error("AI provider failed");
  }
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, "https://openrouter.ai/api/v1");
  }
}

export class GroqProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model: string) {
    super(apiKey, model, "https://api.groq.com/openai/v1");
  }
}

export class GeminiProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string
  ) {}

  async generate(
    messages: { role: string; content: string }[],
    opts: { temperature?: number; timeout?: number } = {}
  ): Promise<string> {
    const timeout = (opts.timeout ?? 120) * 1000;
    const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const payload: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: opts.temperature ?? 0.2, responseMimeType: "application/json" },
    };
    if (systemParts.length > 0) {
      payload.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeout),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            candidates: { content: { parts: { text: string }[] } }[];
          };
          return data.candidates[0].content.parts.map((p) => p.text).join("");
        }
        lastError = new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        if ([429, 500, 502, 503].includes(resp.status) && attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt] * 1000);
          continue;
        }
        throw lastError;
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError") throw new Error(`AI analysis timed out.`);
        lastError = e instanceof Error ? e : new Error(String(e));
        throw lastError;
      }
    }
    throw lastError ?? new Error("AI provider failed");
  }
}

export type ProviderName = "gemini" | "openrouter" | "groq";

export interface ProviderCandidate {
  name: ProviderName;
  key: string;
  model: string;
}

const TRANSIENT = /HTTP (429|500|502|503|504)|timed out|rate-limit|ECONNRESET|fetch failed/i;

export function isTransientError(message: string): boolean {
  return TRANSIENT.test(message);
}

/**
 * Tries the selected model first, then falls back through the same provider's
 * other models when one is rate-limited or unavailable. A single unavailable
 * model should never fail the whole analysis.
 */
export class FailoverProvider implements AIProvider {
  constructor(private candidates: ProviderCandidate[]) {}

  async generate(
    messages: { role: string; content: string }[],
    opts: { temperature?: number; timeout?: number } = {}
  ): Promise<string> {
    const unique = this.candidates.filter(
      (c, i, arr) => c.model && arr.findIndex((x) => x.model === c.model) === i
    );
    let lastError: Error = new Error("No AI provider configured");
    for (const candidate of unique) {
      const provider = buildProvider(candidate.name, candidate.key, candidate.model);
      if (!provider) continue;
      try {
        return await provider.generate(messages, opts);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (!isTransientError(lastError.message)) throw lastError;
      }
    }
    throw lastError;
  }
}

export function buildProvider(
  name: ProviderName,
  apiKey: string | null,
  model: string | null
): AIProvider | null {
  if (!apiKey || !model) return null;
  if (name === "gemini") return new GeminiProvider(apiKey, model);
  if (name === "groq") return new GroqProvider(apiKey, model);
  return new OpenRouterProvider(apiKey, model);
}

/** Models to try, in order, when the primary is unavailable. */
export const FALLBACK_MODELS: Record<ProviderName, string[]> = {
  gemini: ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemma-4-26b-a4b-it"],
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
  openrouter: ["google/gemini-3.8-flash", "google/gemini-flash-1.5", "openai/gpt-4o-mini"],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
