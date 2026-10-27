import { NextRequest, NextResponse } from "next/server";
import { fetchYahooSnapshot, sanitizeSymbol } from "../../../../lib/server/yahoo";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; fixture: any }>();

// Simple per-IP rate limiter: 60 requests per minute.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

export async function GET(request: NextRequest, context: { params: Promise<{ ticker: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ ok: false, error: "Rate limit exceeded; try again shortly." }, { status: 429 });
  }
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
