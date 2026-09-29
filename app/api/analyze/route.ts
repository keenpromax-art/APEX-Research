import { NextRequest } from "next/server";
import { AnalysisPipeline, parseTickers } from "@/lib/pipeline";
import { loadServerSettings, providerFor } from "@/lib/serverConfig";
import type { ProviderName } from "@/lib/providers";
import type { Depth } from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VALID_PROVIDERS: ProviderName[] = ["gemini", "openrouter", "groq"];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tickersParam = params.get("tickers") ?? "";
  const userRequest = params.get("request") ?? "Analyze this company.";
  const providerParam = params.get("provider");
  const keyParam = params.get("key") ?? "";
  const depthParam = params.get("depth");
  const depth: Depth =
    depthParam === "brief" || depthParam === "deep" ? depthParam : "standard";

  let tickers: string[];
  try {
    tickers = parseTickers(tickersParam);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid input." }, { status: 400 });
  }

  const settings = loadServerSettings();
  const modelParam = params.get("model");
  let providerName: ProviderName | null = null;
  let apiKey: string | null = null;
  let model: string | null = null;

  if (providerParam) {
    if (!VALID_PROVIDERS.includes(providerParam as ProviderName)) {
      return Response.json({ error: `Unknown AI provider '${providerParam}'.` }, { status: 400 });
    }
    if (!keyParam) {
      return Response.json({ error: "An API key is required when specifying a provider." }, { status: 400 });
    }
    providerName = providerParam as ProviderName;
    apiKey = keyParam;
    model = modelParam ?? providerFor(settings, providerName).model;
  } else {
    providerName = settings.aiProvider;
    const configured = providerFor(settings, providerName);
    apiKey = configured.apiKey;
    model = modelParam ?? configured.model;
  }

  const origin = new URL(request.url).origin;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        const pipeline = new AnalysisPipeline({
          providerName,
          apiKey,
          model,
          aiTimeout: settings.aiTimeout,
          depth,
          fetchFn: async (ticker) => {
            const resp = await fetch(`${origin}/api/fetch/${encodeURIComponent(ticker)}`);
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || `Unable to retrieve data for '${ticker}'.`);
            return data;
          },
        });
        const result = await pipeline.run(tickers, userRequest, (s) => send("status", s));
        send("result", result);
      } catch (e) {
        send("error", {
          message: e instanceof Error ? e.message : "Unexpected server error.",
          status: e instanceof Error && e.message.includes("timed out") ? 504 : 502,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
