import type { ProviderName } from "./providers";

export interface ServerSettings {
  aiProvider: ProviderName;
  geminiApiKey: string | null;
  geminiModel: string;
  groqApiKey: string | null;
  groqModel: string;
  openrouterApiKey: string | null;
  openrouterModel: string;
  aiTimeout: number;
}

export function loadServerSettings(): ServerSettings {
  const provider = (process.env.AI_PROVIDER ?? "gemini") as ProviderName;
  const upper = provider.toUpperCase();
  return {
    aiProvider: provider,
    geminiApiKey: process.env.GEMINI_API_KEY ?? null,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-3-flash-preview",
    groqApiKey: process.env.GROQ_API_KEY ?? null,
    groqModel: process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? null,
    openrouterModel: process.env.OPENROUTER_MODEL ?? "google/gemini-flash-1.5",
    aiTimeout: Number(process.env.AI_TIMEOUT_SECONDS ?? 120),
  };
}

export function providerFor(settings: ServerSettings, name: ProviderName) {
  if (name === "gemini") return { apiKey: settings.geminiApiKey, model: settings.geminiModel };
  if (name === "groq") return { apiKey: settings.groqApiKey, model: settings.groqModel };
  return { apiKey: settings.openrouterApiKey, model: settings.openrouterModel };
}
