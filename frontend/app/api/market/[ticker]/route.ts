import { NextRequest, NextResponse } from "next/server";
import { fetchYahooSnapshot, sanitizeSymbol } from "../../../../lib/server/yahoo";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; fixture: any }>();

export async function GET(request: NextRequest, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  let symbol: string;
  try {
    symbol = sanitizeSymbol(decodeURIComponent(ticker || ""));
  } catch (error) {
    return NextResponse.json({ ok: false, error: String((error as any)?.message || error) }, { status: 400 });
  }

  const force = request.nextUrl.searchParams.get("refresh") === "true";
  const hit = cache.get(symbol);
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, fixture: hit.fixture });
  }

  try {
    const fixture = await fetchYahooSnapshot(symbol);
    cache.set(symbol, { at: Date.now(), fixture });
    return NextResponse.json({ ok: true, cached: false, fixture });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String((error as any)?.message || error) }, { status: 502 });
  }
}
