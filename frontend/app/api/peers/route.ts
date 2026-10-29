import { NextRequest, NextResponse } from "next/server";
import { fetchValidPeers } from "@/lib/server/yahoo";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; result: any }>();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const target = (searchParams.get("target") || "").trim().toUpperCase();
  if (!target) {
    return NextResponse.json({ ok: false, error: "target ticker is required" }, { status: 400 });
  }

  const minCount = Number(searchParams.get("minCount") || "3");
  const maxCount = Number(searchParams.get("maxCount") || "5");

  const cacheKey = `${target}:${minCount}:${maxCount}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...hit.result });
  }

  try {
    const result = await fetchValidPeers(target, { minCount, maxCount });
    cache.set(cacheKey, { at: Date.now(), result });
    return NextResponse.json({ ok: true, cached: false, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String((error as any)?.message || error), peers: [], sector: null, target },
      { status: 502 },
    );
  }
}
