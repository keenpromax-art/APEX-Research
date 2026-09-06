// ============================================================
// API Route: /api/test-key — Test connection & validate AI API keys
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import {
  SUPPORTED_PROVIDERS,
  SupportedProvider,
  resolveProviderRequestConfig,
  isRateLimitResponse,
} from "@/lib/ai-providers";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: {
    provider?: SupportedProvider;
    apiKey?: string;
    model?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider = "openrouter", apiKey, model } = body;

  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return NextResponse.json(
      { success: false, error: "API key cannot be empty." },
      { status: 400 }
    );
  }

  const providerMeta = SUPPORTED_PROVIDERS[provider];
  if (!providerMeta) {
    return NextResponse.json(
      { success: false, error: `Unsupported provider '${provider}'.` },
      { status: 400 }
    );
  }

  const config = resolveProviderRequestConfig({
    provider,
    apiKey: apiKey.trim(),
    model: model?.trim(),
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12-second test timeout

    const res = await fetch(config.endpointUrl, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "user", content: "Institutional connection ping. Reply with 'ACK'." },
        ],
        max_tokens: 8,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await res.text();

    if (isRateLimitResponse(res.status, responseText)) {
      return NextResponse.json(
        {
          success: false,
          isRateLimit: true,
          error: `Rate limit / quota exceeded on ${providerMeta.name} (HTTP ${res.status}). Response: ${responseText.slice(0, 160)}`,
        },
        { status: 429 }
      );
    }

    if (!res.ok) {
      let friendlyError = `HTTP ${res.status}: `;
      try {
        const parsed = JSON.parse(responseText);
        friendlyError += parsed.error?.message || parsed.message || responseText.slice(0, 150);
      } catch {
        friendlyError += responseText.slice(0, 150);
      }

      return NextResponse.json(
        { success: false, error: `${providerMeta.name} error — ${friendlyError}` },
        { status: res.status }
      );
    }

    let parsedContent = "";
    try {
      const parsed = JSON.parse(responseText);
      parsedContent = parsed.choices?.[0]?.message?.content || "";
    } catch {}

    return NextResponse.json({
      success: true,
      provider: providerMeta.name,
      model: config.model,
      message: `Connection successful! ${providerMeta.name} authenticated and active with model '${config.model}'.`,
      preview: parsedContent.slice(0, 50),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort")) {
      return NextResponse.json(
        { success: false, error: `Connection timed out after 12s while reaching ${providerMeta.name}.` },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { success: false, error: `Network error connecting to ${providerMeta.name}: ${message}` },
      { status: 500 }
    );
  }
}
