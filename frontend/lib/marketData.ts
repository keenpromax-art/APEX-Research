const CACHE_PREFIX = "apex_market_";
const TTL_MS = 10 * 60 * 1000;

// Retry policy: wait for Yahoo to deliver sufficient real data before giving up.
// Transient failures (timeouts, network drops, 5xx, 429, empty payloads) are
// retried with bounded backoff under an overall deadline; permanent failures
// (unknown ticker 4xx, misconfigured request) fail fast because retrying cannot
// help. When no real data can be obtained the caller receives `null` — synthetic
// or fabricated data is never substituted.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1200];
const ATTEMPT_TIMEOUT_MS = 12000;
const OVERALL_DEADLINE_MS = 45000;

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

/** A payload counts as sufficient when it carries identity, a price anchor and
 * at least one reported income period — the minimum needed to model the company. */
function isSufficient(fixture: any): boolean {
  if (!fixture?.info || !fixture.price_summary || !(Number(fixture.price_summary.last_close) > 0)) return false;
  const annual = fixture.annual?.income_statement;
  const quarterly = fixture.quarterly?.income_statement;
  return (Array.isArray(annual) && annual.length > 0) || (Array.isArray(quarterly) && quarterly.length > 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** URL-construction failures mean this environment cannot issue the request at
 * all; retrying the identical request would only waste the caller's time. */
function isPermanentError(error: unknown): boolean {
  const message = String((error as any)?.message || error);
  return /Failed to parse URL|Invalid URL|network access (is not allowed|denied)/i.test(message);
}

function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429 && status !== 408;
}

/**
 * Resolve market data for a ticker: provider proxy first, localStorage cache as
 * fallback. The provider is retried with bounded backoff until it returns
 * sufficient real data. Returns null when no real data exists so callers can
 * degrade to an explicit "data unavailable" state — never to synthetic data.
 */
export async function fetchTickerFixture(
  ticker: string,
  forceRefresh = false,
): Promise<{ result: FixtureResult | null; error: string | null }> {
  const cached = readCache(ticker);
  if (!forceRefresh && cached && isFixtureFresh(cached)) {
    return { result: cached, error: null };
  }

  const deadline = Date.now() + OVERALL_DEADLINE_MS;
  let lastError = "market-data provider unavailable";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (Date.now() >= deadline) {
      lastError = `${lastError} (retries exhausted after ${MAX_ATTEMPTS} attempts)`;
      break;
    }
    try {
      const response = await fetch(
        `/api/market/${encodeURIComponent(ticker)}${forceRefresh ? "?refresh=1" : ""}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) },
      );
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.ok && isSufficient(payload.fixture)) {
        const fixture = payload.fixture;
        writeCache(ticker, fixture);
        return {
          result: { fixture, origin: "provider", fetchedAt: String(fixture.retrieved_at || new Date().toISOString()) },
          error: null,
        };
      }

      if (!response.ok) {
        lastError = payload?.error || `HTTP ${response.status}`;
        if (isPermanentStatus(response.status)) break;
      } else {
        // Provider answered but the payload is insufficient (e.g. no statements):
        // keep waiting for the provider rather than fabricating the gap.
        lastError = payload?.error || "provider returned insufficient data (no reported statements)";
      }
    } catch (fetchError) {
      lastError = String((fetchError as any)?.message || fetchError);
      if (isPermanentError(fetchError)) break;
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      if (Date.now() + wait >= deadline) break;
      await sleep(wait);
    }
  }

  // Stale cache still holds real, previously-retrieved provider data; use it
  // with disclosure rather than anything synthetic.
  if (cached) return { result: cached, error: lastError };
  return { result: null, error: lastError };
}
