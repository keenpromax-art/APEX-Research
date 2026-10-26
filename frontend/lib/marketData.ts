const CACHE_PREFIX = "apex_market_";
const TTL_MS = 10 * 60 * 1000;

export type FixtureOrigin = "provider" | "cache";

export type FixtureResult = {
  fixture: any;
  origin: FixtureOrigin;
  fetchedAt: string;
};

function cacheKey(ticker: string): string {
  return `${CACHE_PREFIX}${ticker}`;
}

function readCache(ticker: string): FixtureResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(ticker));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.fixture?.info || !Array.isArray(parsed.fixture?.annual?.income_statement)) return null;
    return {
      fixture: parsed.fixture,
      origin: "cache",
      fetchedAt: String(parsed.fetched_at || parsed.fixture.retrieved_at || ""),
    };
  } catch {
    return null;
  }
}

function writeCache(ticker: string, fixture: any) {
  try {
    localStorage.setItem(
      cacheKey(ticker),
      JSON.stringify({ fetched_at: new Date().toISOString(), fixture }),
    );
  } catch {
    // Storage may be full or unavailable; the in-memory fetch result is still returned.
  }
}

export function isFixtureFresh(result: FixtureResult, now = Date.now()): boolean {
  const fetched = Date.parse(result.fetchedAt);
  return Number.isFinite(fetched) && now - fetched < TTL_MS;
}

/**
 * Resolve market data for a ticker: provider proxy first, localStorage cache as
 * fallback. Returns null when neither is available so callers can decide how to
 * degrade (the engine degrades to a clearly-labelled synthetic fixture).
 */
export async function fetchTickerFixture(
  ticker: string,
  forceRefresh = false,
): Promise<{ result: FixtureResult | null; error: string | null }> {
  const cached = readCache(ticker);
  if (!forceRefresh && cached && isFixtureFresh(cached)) {
    return { result: cached, error: null };
  }

  try {
    const response = await fetch(
      `/api/market/${encodeURIComponent(ticker)}${forceRefresh ? "?refresh=1" : ""}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25000) },
    );
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.ok && payload.fixture?.info && Array.isArray(payload.fixture?.annual?.income_statement)) {
      const fixture = payload.fixture;
      writeCache(ticker, fixture);
      return {
        result: { fixture, origin: "provider", fetchedAt: String(fixture.retrieved_at || new Date().toISOString()) },
        error: null,
      };
    }
    const error = payload?.error || `HTTP ${response.status}`;
    if (cached) return { result: cached, error: String(error) };
    return { result: null, error: String(error) };
  } catch (fetchError) {
    const error = String((fetchError as any)?.message || fetchError);
    if (cached) return { result: cached, error };
    return { result: null, error };
  }
}
