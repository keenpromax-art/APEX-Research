// ============================================================
// API Route: /api/analyze-ai-first — AI-first research pipeline
// TICKER -> yfinance fact pack -> AI understanding/model/valuation/
// scenarios/narratives -> deterministic execution -> quality review
// -> versioned ResearchReport. No sector gates, no archetype dispatch.
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { fetchQuoteSummary } from "@/lib/yahoo-finance";
import { normalizeTicker } from "@/lib/request-validation";
import type { CustomKeyConfig } from "@/lib/ai-providers";
import { runAiFirstResearch } from "@/lib/ai-first/pipeline";
import { resolveSafeProviderConfig, validateRequestBodySize, validateTicker } from "@/lib/security/request-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const bodySize = validateRequestBodySize(rawBody, request.headers);
  if (!bodySize.ok) {
    return NextResponse.json({ error: bodySize.error.message, code: bodySize.error.code }, { status: bodySize.error.code === "BODY_TOO_LARGE" ? 413 : 400 });
  }

  let body: {
    ticker?: string;
    symbol?: string;
    customKeyConfig?: CustomKeyConfig;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const safeConfig = resolveSafeProviderConfig(body, request.headers);
  if (!safeConfig.ok) {
    return NextResponse.json({ error: safeConfig.error.message, code: safeConfig.error.code }, { status: 400 });
  }
  const headerModel = request.headers.get("x-custom-api-model")?.trim() || undefined;
  const rawTicker = body.ticker ?? body.symbol ?? "";
  const tickerPolicy = validateTicker(rawTicker);
  if (!tickerPolicy.ok) {
    return NextResponse.json({ error: tickerPolicy.error.message, code: tickerPolicy.error.code }, { status: 400 });
  }
  const symbol = normalizeTicker(tickerPolicy.value);
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid ticker symbol is required." },
      { status: 400 }
    );
  }

  let customConfig: CustomKeyConfig | null = safeConfig.value;
  if (!customConfig && headerModel && process.env.OPENROUTER_API_KEY) {
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
            send({ type: "done", report: result.report, researchPlan: result.researchPlan, aiUsed: result.aiUsed });
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
      researchPlan: result.researchPlan,
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
