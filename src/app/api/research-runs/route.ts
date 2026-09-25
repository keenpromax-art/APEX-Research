import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  RESEARCH_RUN_MAX_REQUEST_BYTES,
  ResearchRunPayloadTooLargeError,
  createResearchRunFromManifest,
  parseResearchRunJson,
  parseResearchRunListQuery,
  toResearchRunSummary,
} from "@/lib/research-runs";
import { getDurableResearchRunStore } from "@/lib/research-runs/server";
import { researchRunErrorResponse, researchRunStoreUnavailableResponse } from "./responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBoundedBody(request: NextRequest): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > RESEARCH_RUN_MAX_REQUEST_BYTES) {
    throw new ResearchRunPayloadTooLargeError(RESEARCH_RUN_MAX_REQUEST_BYTES);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > RESEARCH_RUN_MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ResearchRunPayloadTooLargeError(RESEARCH_RUN_MAX_REQUEST_BYTES);
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  let run;
  try {
    const raw = await readBoundedBody(request);
    run = createResearchRunFromManifest(parseResearchRunJson(raw));
  } catch (error) {
    return researchRunErrorResponse(error);
  }
  const store = await getDurableResearchRunStore();
  if (!store?.durable) return researchRunStoreUnavailableResponse();
  try {
    const result = await store.appendRun(run);
    const created = result.disposition === "created";
    return NextResponse.json(
      {
        run: {
          runId: result.run.runId,
          contentHash: result.run.contentHash,
        },
        disposition: result.disposition,
        duplicate: !created,
        durable: true,
      },
      {
        status: created ? 201 : 200,
        headers: {
          "Cache-Control": "no-store",
          Location: `/api/research-runs/${encodeURIComponent(result.run.runId)}`,
        },
      },
    );
  } catch (error) {
    return researchRunErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const query = parseResearchRunListQuery(request.nextUrl.searchParams);
    const store = await getDurableResearchRunStore();
    if (!store?.durable) return researchRunStoreUnavailableResponse();
    const page = await store.listRuns(query);
    return NextResponse.json(
      {
        items: page.runs.map(toResearchRunSummary),
        pagination: {
          limit: query.limit,
          offset: query.offset,
          hasMore: page.hasMore,
          order: query.order,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return researchRunErrorResponse(error);
  }
}
