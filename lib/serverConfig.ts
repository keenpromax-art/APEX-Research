import type { ProviderName } from "./providers";

export interface ServerSettings {
  aiProvider: ProviderName;
  groqApiKey: string | null;
  groqModel: string;
  openrouterApiKey: string | null;
  openrouterModel: string;
  aiTimeout: number;
}

export function loadServerSettings(): ServerSettings {
  const provider = (process.env.AI_PROVIDER ?? "openrouter") as ProviderName;
  return {
    aiProvider: provider,
    groqApiKey: process.env.GROQ_API_KEY ?? null,
    groqModel: process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? null,
    openrouterModel: process.env.OPENROUTER_MODEL ?? "google/gemini-flash-1.5",
    aiTimeout: Number(process.env.AI_TIMEOUT_SECONDS ?? 120),
  };
}

export function providerFor(settings: ServerSettings, name: ProviderName) {
  if (name === "groq") return { apiKey: settings.groqApiKey, model: settings.groqModel };
  return { apiKey: settings.openrouterApiKey, model: settings.openrouterModel };
}
