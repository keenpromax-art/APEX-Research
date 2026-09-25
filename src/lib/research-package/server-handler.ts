import { NextRequest, NextResponse } from "next/server";
import { PausedForRateLimitError, RateLimitError } from "@/lib/ai-providers";
import { resolveSafeProviderConfig, validateRequestBodySize, validateTicker } from "@/lib/security/request-policy";
import { normalizeTicker } from "@/lib/request-validation";
import { runCanonicalResearch } from "./pipeline";
import { RESEARCH_RUN_EVENT_SCHEMA_VERSION, type ResearchRunEvent } from "./types";

export const analyzeRuntime = "nodejs";
export const analyzeMaxDuration = 300;

type AnalyzeBody = {
  ticker?: string;
  symbol?: string;
  options?: {
    reportTypeId?: string;
    reportType?: string;
    depth?: string;
    researchDepth?: string;
    dataCutoff?: string;
    resumeFrom?: Record<string, unknown> | null;
  };
  selector?: {
    reportTypeId?: string;
    depth?: string;
  };
  reportTypeId?: string;
  reportType?: string;
  depth?: string;
  researchDepth?: string;
  dataCutoff?: string;
  resumeFrom?: Record<string, unknown> | null;
  customKeyConfig?: unknown;
};

function jsonError(error: string, status: number, code?: string): NextResponse {
  return NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
}

function parseBody(raw: string): AnalyzeBody | null {
  if (!raw.trim()) return {};
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AnalyzeBody;
}

function requestedStream(request: NextRequest): boolean {
  const query = request.nextUrl.searchParams.get("stream");
  if (query === "false") return false;
  if (query === "true") return true;
  return true;
}

function eventLine(event: ResearchRunEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function pausedResponse(error: unknown): NextResponse {
  if (error instanceof PausedForRateLimitError) {
    return NextResponse.json({
      error: "RATE_PAUSED",
      provider: error.provider,
      kind: error.kind,
      message: error.message,
      resumeFrom: error.partial,
      completed: error.completedAgents,
      total: error.totalAgents,
      nextAgent: error.nextAgentId,
    }, { status: 429 });
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json({
      error: "RATE_PAUSED",
      provider: error.provider,
      kind: error.kind,
      message: error.message,
    }, { status: 429 });
  }
  const message = error instanceof Error ? error.message : "Research generation failed";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function handleAnalyzeRequest(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();
  const bodySize = validateRequestBodySize(rawBody, request.headers);
  if (!bodySize.ok) return jsonError(bodySize.error.message, bodySize.error.code === "BODY_TOO_LARGE" ? 413 : 400, bodySize.error.code);
  let body: AnalyzeBody;
  try {
    const parsed = parseBody(rawBody);
    if (!parsed) return jsonError("Request body must be a JSON object.", 400, "INVALID_BODY");
    body = parsed;
  } catch {
    return jsonError("Invalid JSON body.", 400, "INVALID_BODY");
  }
  if ("profile" in body || "stockData" in body || "annualFinancials" in body || "dcf" in body) {
    return jsonError("Legacy persona payloads are not accepted. Send ticker and options only.", 400, "LEGACY_PAYLOAD_REJECTED");
  }
  const tickerInput = body.ticker ?? body.symbol ?? "";
  const tickerPolicy = validateTicker(tickerInput);
  if (!tickerPolicy.ok) return jsonError(tickerPolicy.error.message, 400, tickerPolicy.error.code);
  const ticker = normalizeTicker(tickerPolicy.value);
  if (!ticker) return jsonError("A valid ticker symbol is required.", 400, "INVALID_TICKER");
  const safeConfig = resolveSafeProviderConfig(body, request.headers);
  if (!safeConfig.ok) return jsonError(safeConfig.error.message, 400, safeConfig.error.code);
  const headerModel = request.headers.get("x-custom-api-model")?.trim() || undefined;
  let customKeyConfig = safeConfig.value;
  if (!customKeyConfig && headerModel && process.env.OPENROUTER_API_KEY) {
    customKeyConfig = { provider: "openrouter", apiKey: process.env.OPENROUTER_API_KEY, model: headerModel };
  }
  const options = body.options ?? {};
  const reportTypeId = typeof options.reportTypeId === "string" ? options.reportTypeId : typeof options.reportType === "string" ? options.reportType : body.reportTypeId ?? body.reportType ?? body.selector?.reportTypeId;
  const depth = typeof options.depth === "string" ? options.depth : typeof options.researchDepth === "string" ? options.researchDepth : body.depth ?? body.researchDepth ?? body.selector?.depth;
  const dataCutoff = typeof options.dataCutoff === "string" ? options.dataCutoff : body.dataCutoff;
  if (dataCutoff !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dataCutoff)) return jsonError("Data cutoff must be YYYY-MM-DD.", 400, "INVALID_DATA_CUTOFF");
  if (depth !== undefined && depth !== "concise" && depth !== "full") return jsonError("Depth must be concise or full.", 400, "INVALID_DEPTH");
  const resumeFrom = options.resumeFrom ?? body.resumeFrom ?? null;
  const runOptions = {
    ...(reportTypeId ? { reportTypeId } : {}),
    ...(depth ? { depth } : {}),
    ...(dataCutoff ? { dataCutoff } : {}),
    ...(customKeyConfig ? { customKeyConfig } : {}),
    ...(resumeFrom ? { resumeFrom } : {}),
  };
  if (!requestedStream(request)) {
    try {
      const result = await runCanonicalResearch(ticker, runOptions);
      return NextResponse.json({
        schemaVersion: RESEARCH_RUN_EVENT_SCHEMA_VERSION,
        run: result.run,
        package: result.package,
      });
    } catch (error) {
      return pausedResponse(error);
    }
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sentTypes = new Set<string>();
      const send = (value: ResearchRunEvent) => {
        sentTypes.add(value.type);
        try {
          controller.enqueue(encoder.encode(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`));
        } catch {
          return;
        }
      };
      try {
        await runCanonicalResearch(ticker, { ...runOptions, onEvent: send });
      } catch (error) {
        if (error instanceof RateLimitError && !sentTypes.has("paused")) {
          const paused = error instanceof PausedForRateLimitError ? error : null;
          send({
            schemaVersion: RESEARCH_RUN_EVENT_SCHEMA_VERSION,
            type: "paused",
            runId: "pending",
            ticker,
            sequence: 0,
            emittedAt: new Date().toISOString(),
            data: { provider: error.provider, kind: error.kind, message: error.message, ...(paused ? { resumeFrom: paused.partial } : {}) },
          });
        } else if (!sentTypes.has("failed")) {
          send({
            schemaVersion: RESEARCH_RUN_EVENT_SCHEMA_VERSION,
            type: "failed",
            runId: "pending",
            ticker,
            sequence: 0,
            emittedAt: new Date().toISOString(),
            error: { code: "RESEARCH_RUN_FAILED", message: error instanceof Error ? error.message : "Research generation failed" },
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          return;
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Research-Event-Schema": RESEARCH_RUN_EVENT_SCHEMA_VERSION,
    },
  });
}

export const POST = handleAnalyzeRequest;
export { eventLine };
