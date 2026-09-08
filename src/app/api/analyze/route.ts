// ============================================================
// API Route: /api/analyze — generate AI analysis via Multi-Provider AI Engine
// Supports OpenRouter, NVIDIA NIM, Google Gemini, Groq, and OpenAI
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { generateAIAnalysis, RateLimitError } from "@/lib/openrouter";
import { PausedForRateLimitError } from "@/lib/ai-providers";
import type { SupportedProvider, CustomKeyConfig } from "@/lib/ai-providers";
import type { CompanyProfile, StockData, AnnualFinancials, DCFResult, TickerNewsItem } from "@/types/report";

export const runtime = "nodejs";
// Slow-but-sure synthesis: 7 personas run fully serialized with 5s+ gaps and
// deep 429 backoff, so a complete report can take several minutes by design.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Extract custom API key headers if supplied by the client
  const headerApiKey = request.headers.get("x-custom-api-key")?.trim();
  const headerProvider = (request.headers.get("x-custom-api-provider")?.trim() || "openrouter") as SupportedProvider;
  const headerModel = request.headers.get("x-custom-api-model")?.trim() || undefined;

  let body: {
    profile: CompanyProfile;
    stockData: StockData;
    annualFinancials: AnnualFinancials[];
    dcf: DCFResult;
    news?: TickerNewsItem[];
    customKeyConfig?: CustomKeyConfig;
    assumptionsLedger?: any;
    // Checkpoint resume: raw per-agent results from an interrupted run.
    resumeFrom?: Record<string, unknown> | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Resolve custom key configuration: prioritize HTTP headers, then JSON body
  let customConfig: CustomKeyConfig | null = null;
  if (headerApiKey) {
    customConfig = {
      provider: headerProvider,
      apiKey: headerApiKey,
      model: headerModel,
    };
  } else if (body.customKeyConfig && body.customKeyConfig.apiKey?.trim()) {
    customConfig = {
      provider: body.customKeyConfig.provider || "openrouter",
      apiKey: body.customKeyConfig.apiKey.trim(),
      model: body.customKeyConfig.model?.trim(),
    };
  }

  // If no server key and no custom key provided, prompt user to supply key
  if (!process.env.OPENROUTER_API_KEY && !customConfig?.apiKey) {
    return NextResponse.json(
      {
        error: "RATE_LIMIT_EXCEEDED",
        provider: "server",
        message: "No default server API key configured. Please supply a custom API key from OpenRouter, NVIDIA NIM, Gemini, Groq, or OpenAI.",
      },
      { status: 429 }
    );
  }

  const { profile, stockData, annualFinancials, dcf, news } = body;
  // Canonical ledger (when the client computed it pre-synthesis) threads the
  // authoritative moat/rating into deterministic narratives for harmonization.
  const ledgerForAnalysis = (body as any).assumptionsLedger || undefined;
  const resumeFrom = ((body as any).resumeFrom && typeof (body as any).resumeFrom === "object")
    ? (body as any).resumeFrom as Record<string, unknown>
    : undefined;

  if (!profile || !stockData || !annualFinancials?.length || !dcf) {
    return NextResponse.json(
      { error: "Missing required fields: profile, stockData, annualFinancials, dcf" },
      { status: 400 }
    );
  }

  const wantsStream =
    request.headers.get("accept")?.includes("text/event-stream") ||
    request.nextUrl.searchParams.get("stream") === "true";

  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {}
        };

        try {
          const aiAnalysis = await generateAIAnalysis(
            profile,
            stockData,
            annualFinancials,
            dcf,
            news,
            (event) => send(event),
            customConfig,
            ledgerForAnalysis,
            resumeFrom
          );

          send({ type: "done", aiAnalysis });
        } catch (error) {
          console.error("AI analysis error in stream:", error);
          if (error instanceof PausedForRateLimitError) {
            // Paused, not failed: finished agents' results travel back so the
            // client resumes exactly where this run stopped.
            send({
              type: "rate_paused",
              partial: error.partial,
              completed: error.completedAgents,
              total: error.totalAgents,
              nextAgent: error.nextAgentId,
              provider: error.provider,
              kind: error.kind,
              message: error.message,
            });
          } else if (error instanceof RateLimitError) {
            send({
              type: "rate_limit",
              provider: error.provider,
              statusCode: error.statusCode,
              kind: error.kind,
              message: error.message,
            });
          } else {
            const message = error instanceof Error ? error.message : "AI analysis failed";
            send({ type: "error", message });
          }
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
        "Connection": "keep-alive",
      },
    });
  }

  try {
    const aiAnalysis = await generateAIAnalysis(
      profile,
      stockData,
      annualFinancials,
      dcf,
      news,
      undefined,
      customConfig,
      ledgerForAnalysis,
      resumeFrom
    );

    return NextResponse.json({ aiAnalysis });
  } catch (error) {
    console.error("AI analysis error:", error);
    if (error instanceof PausedForRateLimitError) {
      return NextResponse.json(
        {
          error: "RATE_PAUSED",
          partial: error.partial,
          completed: error.completedAgents,
          total: error.totalAgents,
          nextAgent: error.nextAgentId,
          provider: error.provider,
          kind: error.kind,
          message: error.message,
        },
        { status: 429 }
      );
    }
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          error: "RATE_LIMIT_EXCEEDED",
          provider: error.provider,
          statusCode: error.statusCode,
          kind: error.kind,
          message: error.message,
        },
        { status: 429 }
      );
    }
    const message = error instanceof Error ? error.message : "AI analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
