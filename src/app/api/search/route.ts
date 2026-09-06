// ============================================================
// API Route: /api/search — company search autocomplete
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { searchCompanies } from "@/lib/yahoo-finance";
import { normalizeSearchQuery } from "@/lib/request-validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q");
  const q = normalizeSearchQuery(rawQuery);
  if (!q) {
    const invalid = Boolean(rawQuery?.trim());
    return NextResponse.json(
      invalid ? { error: "Search queries must be 1–80 printable characters.", results: [] } : { results: [] },
      { status: invalid ? 400 : 200 }
    );
  }

  try {
    const raw = await searchCompanies(q);
    const results = raw
      .filter(r => r.typeDisp === "Equity" || r.typeDisp === "ETF" || !r.typeDisp)
      .slice(0, 10)
      .map(r => ({
        symbol: r.symbol,
        shortname: r.shortname || r.symbol,
        longname: r.longname || r.shortname || r.symbol,
        exchange: r.exchange || "",
        exchDisp: r.exchDisp || r.exchange || "",
        typeDisp: r.typeDisp || "Equity",
        sector: r.sector,
        industry: r.industry,
      }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed. Please try again.", results: [] },
      { status: 500 }
    );
  }
}
