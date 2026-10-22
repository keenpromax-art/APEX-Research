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

export type ProviderName = "openrouter" | "groq";

export function buildProvider(
  name: ProviderName,
  apiKey: string | null,
  model: string | null
): AIProvider | null {
  if (!apiKey || !model) return null;
  if (name === "groq") return new GroqProvider(apiKey, model);
  return new OpenRouterProvider(apiKey, model);
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
