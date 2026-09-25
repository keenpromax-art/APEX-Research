import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  assertCanonicalResearchRunId,
  parseResearchRunDetailQuery,
  toResearchRunDetail,
} from "@/lib/research-runs";
import { getDurableResearchRunStore } from "@/lib/research-runs/server";
import { researchRunErrorResponse, researchRunStoreUnavailableResponse } from "../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResearchRunRouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

export async function GET(request: NextRequest, context: ResearchRunRouteContext) {
  try {
    const { runId } = await context.params;
    assertCanonicalResearchRunId(runId);
    const historyLimit = parseResearchRunDetailQuery(request.nextUrl.searchParams);
    const store = await getDurableResearchRunStore();
    if (!store?.durable) return researchRunStoreUnavailableResponse();
    const run = await store.getRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: "Research run not found", code: "RUN_NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const history = await store.getRunHistory(runId, historyLimit);
    return NextResponse.json(
      { ...toResearchRunDetail(run, history), durable: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return researchRunErrorResponse(error);
  }
}
