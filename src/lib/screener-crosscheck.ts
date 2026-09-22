/**
 * APEX RESEARCH — Screener.in Advisory Cross-Check (India-only, Yahoo remains authoritative)
 * -------------------------------------------------------------------------------------------
 * WHAT: best-effort secondary read of a Screener.in consolidated company page for
 * Indian listings (.NS/.BO) to ELABORATE inconsistencies (share-base splits, revenue
 * scale) already seen in Yahoo data — e.g. quote-vs-statement share drift.
 *
 * HARD INVARIANT: Screener numbers NEVER enter the valuation pipeline. They flow
 * only into QA annex WARN-grade notes (SRC-02) and the `screenerCrosscheck` response
 * annex. Ledger, DCF, canonical facts, masterReportFacts and every priced figure in
 * the PDF remain 100% Yahoo Finance. A failed/unavailable cross-check degrades to
 * `{available:false}` silently — it can never block publication.
 *
 * RESPECTFUL FETCH: robots.txt permits company pages (only /user/* and query-sort
 * URLs are disallowed). One GET per report, 8s abort timeout, desktop browser UA,
 * no auth, no crawling. Any bot-block/parse-failure returns unavailable.
 */

export interface ScreenerFinding {
  field: "shares" | "revenue" | "netProfit";
  /** Yahoo authoritative value in raw units (shares count / INR). */
  yahoo: number | null;
  /** Screener cross-check value in raw units (shares count / INR). */
  screener: number | null;
  /** |screener − yahoo| / max(|yahoo|,|screener|), null when incomparable. */
  driftPct: number | null;
  /** Human-readable elaboration for the QA annex. */
  note: string;
}

export interface ScreenerCrosscheck {
  available: boolean;
  reason?: string;
  screenerSymbol?: string;
  url?: string;
  /** Screener price (INR), marketCap (Rs Cr), revenue/profit (Rs Cr) as printed. */
  price?: number | null;
  marketCapCr?: number | null;
  revenueCr?: number | null;
  profitCr?: number | null;
  faceValue?: number | null;
  /** Screener-implied shares = marketCap / price (all-class, vs Yahoo quote class). */
  impliedShares?: number | null;
  findings: ScreenerFinding[];
  fetchedAt: string;
}

/** Indian listings only — Screener.in covers NSE/BSE. US/global tickers skip. */
export function toScreenerSymbol(ticker: string, country?: string): string | null {
  const t = (ticker || "").toUpperCase().trim();
  const isIndian =
    t.endsWith(".NS") || t.endsWith(".BO") || (country || "").toLowerCase().includes("india");
  if (!isIndian) return null;
  const base = t.replace(/\.(NS|BO)$/, "").replace(/[^A-Z0-9&-]/g, "");
  return base.length >= 2 ? base : null;
}

/** Parse Indian grouped numerals ("11,23,055" → 1123055). */
function numIn(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

const drift = (a: number | null, b: number | null): number | null => {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base <= 0) return a === b ? 0 : 1;
  return Math.abs(a - b) / base;
};

function finding(
  field: ScreenerFinding["field"],
  yahoo: number | null,
  screener: number | null,
  label: string
): ScreenerFinding {
  const d = drift(yahoo, screener);
  const pct = d === null ? "n/a" : `${(d * 100).toFixed(1)}%`;
  const verdict =
    d === null
      ? "incomparable (missing side)"
      : d <= 0.1
        ? "reconciled"
        : d <= 0.25
          ? "divergent — plausible class/dilution gap, Yahoo retained"
          : "materially divergent — investigate feed, Yahoo retained";
  return {
    field,
    yahoo,
    screener,
    driftPct: d,
    note:
      `${label}: Yahoo ${yahoo !== null ? Math.round(yahoo).toLocaleString("en") : "n/a"} vs ` +
      `Screener ${screener !== null ? Math.round(screener).toLocaleString("en") : "n/a"} ` +
      `(drift ${pct} — ${verdict}; priced figures stay Yahoo-only).`,
  };
}

/**
 * Fetch + parse one Screener.in consolidated page. Never throws — every failure
 * mode (non-Indian, timeout, bot-block, parse miss) returns `{available:false}`.
 */
export async function fetchScreenerSnapshot(
  ticker: string,
  country: string | undefined,
  yahoo: { shares: number | null; revenue: number | null; netIncome: number | null },
  timeoutMs = 8000
): Promise<ScreenerCrosscheck> {
  const fetchedAt = new Date().toISOString();
  const screenerSymbol = toScreenerSymbol(ticker, country);
  if (!screenerSymbol) {
    return { available: false, reason: "non-Indian ticker — Screener.in covers NSE/BSE only", findings: [], fetchedAt };
  }
  const url = `https://www.screener.in/company/${encodeURIComponent(screenerSymbol)}/consolidated/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      return { available: false, reason: `Screener HTTP ${res.status} — cross-check skipped`, screenerSymbol, url, findings: [], fetchedAt };
    }
    const html = await res.text();
    if (!html || html.length < 20000 || !/screener\.in/i.test(html)) {
      return { available: false, reason: "Screener page unparseable (bot-check?) — skipped", screenerSymbol, url, findings: [], fetchedAt };
    }

    // Meta description carries the freshest headline figures:
    // "Mkt Cap: 16,88,048 Crore ... Revenue: 11,23,055 Cr · Profit: 88,167 Cr"
    const meta = html.match(/<meta name="description" content="([^"]*)"/i)?.[1] || "";
    const marketCapCr = numIn(meta.match(/Mkt Cap:\s*([\d,]+)\s*Crore/i)?.[1]);
    const revenueCr = numIn(meta.match(/Revenue:\s*([\d,]+)\s*Cr/i)?.[1]);
    const profitCr = numIn(meta.match(/Profit:\s*([\d,]+)\s*Cr/i)?.[1]);

    // Current price near the top card: <span>₹ 1,247</span> (first ₹ figure).
    const price = numIn(html.match(/<span>₹\s*([\d,]+(?:\.\d+)?)\s*<\/span>/)?.[1]);

    // Face Value from top-ratios block.
    const faceValue = numIn(
      html.match(/Face Value[\s\S]{0,600}?<span class="number">([\d,.]+)<\/span>/i)?.[1]
    );

    if (revenueCr === null && profitCr === null && marketCapCr === null) {
      return { available: false, reason: "Screener headline figures not found — skipped", screenerSymbol, url, findings: [], fetchedAt };
    }

    // Implied all-class shares from Screener's own mcap ÷ price (independent of
    // Yahoo's quote-class count — exactly the gap FINCONS-03 trips on).
    const impliedShares =
      marketCapCr !== null && price !== null && price > 0 ? (marketCapCr * 1e7) / price : null;

    const findings: ScreenerFinding[] = [
      finding("shares", yahoo.shares, impliedShares, "Share base"),
      finding("revenue", yahoo.revenue, revenueCr !== null ? revenueCr * 1e7 : null, "Latest revenue (INR raw)"),
      finding("netProfit", yahoo.netIncome, profitCr !== null ? profitCr * 1e7 : null, "Latest net profit (INR raw)"),
    ];

    return {
      available: true,
      screenerSymbol,
      url,
      price,
      marketCapCr,
      revenueCr,
      profitCr,
      faceValue,
      impliedShares,
      findings,
      fetchedAt,
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "timeout — skipped" : "fetch failed — skipped";
    return { available: false, reason: `Screener ${reason}`, screenerSymbol, url, findings: [], fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}

export default { toScreenerSymbol, fetchScreenerSnapshot };
