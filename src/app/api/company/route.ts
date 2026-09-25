import { NextRequest, NextResponse } from "next/server";
import { buildResearchSourceContext } from "@/lib/research-context/builder";
import { normalizeTicker } from "@/lib/request-validation";
import { validateTicker } from "@/lib/security/request-policy";
import { RESEARCH_SOURCE_CONTEXT_VERSION } from "@/lib/research-context/builder";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(request: NextRequest) {
  const tickerPolicy = validateTicker(request.nextUrl.searchParams.get("symbol") ?? "");
  if (!tickerPolicy.ok) return NextResponse.json({ error: tickerPolicy.error.message, code: tickerPolicy.error.code }, { status: 400 });
  const ticker = normalizeTicker(tickerPolicy.value);
  if (!ticker) return NextResponse.json({ error: "A valid ticker symbol is required." }, { status: 400 });
  try {
    const sourceContext = await buildResearchSourceContext({ ticker });
    return NextResponse.json({
      schemaVersion: RESEARCH_SOURCE_CONTEXT_VERSION,
      diagnostic: true,
      authority: "diagnostic-source-only",
      ticker,
      dataCutoff: sourceContext.dataCutoff,
      sourceSnapshotHash: sourceContext.source.snapshotHash,
      fetchCounts: sourceContext.fetchCounts,
      currencyBasis: sourceContext.currencyBasis,
      profile: sourceContext.profile,
      stockData: sourceContext.stockData,
      annualFinancials: sourceContext.annualFinancials,
      quarterlyFinancials: sourceContext.quarterlyFinancials,
      shareholding: sourceContext.shareholding,
      factPack: sourceContext.factPack,
      factPackHash: sourceContext.factPack.contentHash,
      sourceContext,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Normalized source context unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
