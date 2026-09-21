// ============================================================
// API Route: /api/analyze-ai-first — AI-first research pipeline
// TICKER -> yfinance fact pack -> AI understanding/model/valuation/
// scenarios/narratives -> deterministic execution -> quality review
// -> versioned ResearchReport. No sector gates, no archetype dispatch.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { fetchQuoteSummary } from "@/lib/yahoo-finance";
import { normalizeTicker } from "@/lib/request-validation";
import type {
  CustomKeyConfig,
  SupportedProvider,
} from "@/lib/ai-providers";
import { runAiFirstResearch } from "@/lib/ai-first/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const headerApiKey = request.headers.get("x-custom-api-key")?.trim();
  const headerProvider = (request.headers.get("x-custom-api-provider")?.trim() ||
    "openrouter") as SupportedProvider;
  const headerModel = request.headers.get("x-custom-api-model")?.trim() || undefined;

  let body: {
    ticker?: string;
    symbol?: string;
    customKeyConfig?: CustomKeyConfig;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawTicker = body.ticker ?? body.symbol ?? "";
  const symbol = normalizeTicker(rawTicker);
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid ticker symbol is required." },
      { status: 400 }
    );
  }

  let customConfig: CustomKeyConfig | null = null;
  if (headerApiKey) {
    customConfig = { provider: headerProvider, apiKey: headerApiKey, model: headerModel };
  } else if (body.customKeyConfig?.apiKey?.trim()) {
    customConfig = {
      provider: body.customKeyConfig.provider || "openrouter",
      apiKey: body.customKeyConfig.apiKey.trim(),
      model: body.customKeyConfig.model?.trim(),
    };
  } else if (headerModel && process.env.OPENROUTER_API_KEY) {
    customConfig = {
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: headerModel,
    };
  }

  const wantsStream =
    request.headers.get("accept")?.includes("text/event-stream") ||
    request.nextUrl.searchParams.get("stream") === "true";

  const emit = wantsStream
    ? (send: (d: unknown) => void) => (p: { stage: string; detail?: string }) =>
        send({ type: "progress", ...p })
    : undefined;

  try {
    const raw = (await fetchQuoteSummary(symbol)) as unknown as Record<
      string,
      unknown
    >;

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: unknown) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
              );
            } catch {}
          };
          try {
            const result = await runAiFirstResearch(symbol, raw, {
              customKeyConfig: customConfig,
              onProgress: emit?.(send),
            });
            send({ type: "done", report: result.report, aiUsed: result.aiUsed });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "AI-first analysis failed";
            send({ type: "error", message });
          } finally {
            try {
              controller.close();
            } catch {}
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const result = await runAiFirstResearch(symbol, raw, {
      customKeyConfig: customConfig,
    });
    return NextResponse.json({
      report: result.report,
      aiUsed: result.aiUsed,
      regenerationCandidates: result.regenerationCandidates,
    });
  } catch (error) {
    console.error("AI-first analysis error:", error);
    const message =
      error instanceof Error ? error.message : "AI-first analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
