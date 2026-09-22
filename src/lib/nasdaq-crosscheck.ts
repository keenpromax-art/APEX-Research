/**
 * APEX RESEARCH — Nasdaq Price Sanity Check (US listings, Yahoo remains authoritative)
 * ------------------------------------------------------------------------------------
 * WHAT: one lightweight official quote read (last sale price) as an independent
 * price sanity leg for US tickers — catches stale/partial-class Yahoo quote feeds
 * of the META kind from a second exchange-data family (Nasdaq official API).
 *
 * (Stooq was evaluated for this slot and rejected: it now sits behind a
 * JavaScript browser-verification wall, so no server can fetch it. Nasdaq's
 * official quote API serves the same role from an authoritative source.)
 *
 * HARD INVARIANT: the Nasdaq close NEVER enters pricing. It feeds one WARN-grade
 * note (`globalCrosscheck.nasdaq`) in the QA annex; CMP/marketCap stay Yahoo-only.
 * Any failure returns `{available:false}` silently — never blocks.
 *
 * RESPECTFUL FETCH: single quote call per report, 6s abort timeout, browser UA,
 * no key, no crawl. Non-US tickers skip (best effort by listing).
 */

export interface NasdaqCheck {
  available: boolean;
  reason?: string;
  symbol?: string;
  close?: number | null;
  /** |nasdaq − yahoo| / max — null when incomparable. */
  driftPct?: number | null;
  note?: string;
  fetchedAt: string;
}

/** US listings only (AAPL, META, BRK-B → BRK-B). Others skip. */
export function toNasdaqSymbol(ticker: string, country?: string): string | null {
  const t = (ticker || "").toUpperCase().trim();
  if (/\.(NS|BO|L|T|HK|AS|PA|DE|MI|MC|AX|TO|SA)$/.test(t)) return null;
  const c = (country || "").toLowerCase();
  if (c.includes("india") || c.includes("united kingdom") || c.includes("japan")) return null;
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(t)) return null;
  return t.replace(/\./g, "-");
}

/** Fetch Nasdaq last-sale price and compare vs Yahoo price. Never throws. */
export async function fetchNasdaqCheck(
  ticker: string,
  country: string | undefined,
  yahooPrice: number | null,
  timeoutMs = 6000
): Promise<NasdaqCheck> {
  const fetchedAt = new Date().toISOString();
  const symbol = toNasdaqSymbol(ticker, country);
  if (!symbol) return { available: false, reason: "non-US ticker — skipped", fetchedAt };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`,
      {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json,*/*;q=0.8",
        },
      }
    );
    if (!res.ok) return { available: false, reason: `Nasdaq HTTP ${res.status} — skipped`, symbol, fetchedAt };
    const body = (await res.json()) as any;
    const raw = body?.data?.primaryData?.lastSalePrice as string | undefined;
    const close = raw ? Number(String(raw).replace(/[$,]/g, "").trim()) : NaN;
    if (!Number.isFinite(close) || close <= 0) {
      return { available: false, reason: "no Nasdaq last-sale price — skipped", symbol, fetchedAt };
    }
    const driftPct =
      yahooPrice !== null && yahooPrice > 0 ? Math.abs(close - yahooPrice) / Math.max(close, yahooPrice) : null;
    const verdict =
      driftPct === null
        ? "incomparable"
        : driftPct <= 0.03
          ? "reconciled (intraday/close timing)"
          : driftPct <= 0.1
            ? "divergent — likely quote timing, Yahoo retained"
            : "materially divergent — verify quote feed, Yahoo retained";
    return {
      available: true,
      symbol,
      close,
      driftPct,
      note: `Price sanity: Yahoo ${yahooPrice ?? "n/a"} vs Nasdaq ${close} (drift ${
        driftPct === null ? "n/a" : `${(driftPct * 100).toFixed(1)}%`
      } — ${verdict}; CMP stays Yahoo-only).`,
      fetchedAt,
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "timeout — skipped" : "fetch failed — skipped";
    return { available: false, reason: `Nasdaq ${reason}`, symbol, fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}

export default { toNasdaqSymbol, fetchNasdaqCheck };
