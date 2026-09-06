import { NextRequest, NextResponse } from "next/server";
import { HISTORICAL_BACKTEST_RECORDS, computeBacktestMetrics } from "@/lib/backtest";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sector = searchParams.get("sector");
    const rating = searchParams.get("rating");
    const region = searchParams.get("region");

    let filtered = [...HISTORICAL_BACKTEST_RECORDS];

    if (sector && sector !== "ALL") {
      filtered = filtered.filter(r => r.sector.toLowerCase() === sector.toLowerCase());
    }

    if (rating && rating !== "ALL") {
      filtered = filtered.filter(r => r.rating.toUpperCase() === rating.toUpperCase());
    }

    if (region && region !== "ALL") {
      filtered = filtered.filter(r => r.region.toLowerCase() === region.toLowerCase());
    }

    const summary = computeBacktestMetrics(filtered);

    return NextResponse.json({
      summary,
      records: filtered,
      totalUniverseCount: HISTORICAL_BACKTEST_RECORDS.length,
      asOfDate: "2026-09-01",
    });
  } catch (error) {
    console.error("Backtest API error:", error);
    const message = error instanceof Error ? error.message : "Failed to compute backtest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
