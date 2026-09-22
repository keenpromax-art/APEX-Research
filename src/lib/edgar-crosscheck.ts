/**
 * APEX RESEARCH — SEC EDGAR Advisory Cross-Check (US listings, Yahoo remains authoritative)
 * ------------------------------------------------------------------------------------------
 * WHAT: filing-grade secondary read for US tickers — shares outstanding, revenue and
 * net income from 10-K XBRL companyfacts — to ELABORATE Yahoo inconsistencies
 * (multi-class share splits like META, SBC dilution gaps like PLTR).
 *
 * HARD INVARIANT: EDGAR numbers NEVER enter the valuation pipeline. They flow only
 * into QA annex WARN-grade notes (SRC-03) and the `globalCrosscheck.edgar` response
 * annex. Ledger, DCF, canonical facts, masterReportFacts and every priced figure
 * remain 100% Yahoo Finance. Any failure returns `{available:false}` silently.
 *
 * RESPECTFUL FETCH: official data.sec.gov JSON APIs (no scraping). One CIK-map
 * fetch per server instance (cached), one companyfacts fetch per report, 10s abort
 * timeout, descriptive User-Agent per SEC fair-access rules (10 req/s — one report
 * issues ~1 request after cache warm). Failures degrade silently, never block.
 */

export interface EdgarFinding {
  field: "shares" | "revenue" | "netIncome";
  /** Yahoo authoritative value in raw units. */
  yahoo: number | null;
  /** EDGAR 10-K value in raw units (USD / shares). */
  edgar: number | null;
  /** Filing period end (e.g. "2024-12-31") behind the EDGAR value. */
  periodEnd?: string | null;
  driftPct: number | null;
  note: string;
}

export interface EdgarCrosscheck {
  available: boolean;
  reason?: string;
  cik?: string;
  company?: string;
  findings: EdgarFinding[];
  fetchedAt: string;
}

/** US listings: no exchange suffix (AAPL, META) — .NS/.BO/.L/.T/.HK route elsewhere. */
export function isEdgarEligible(ticker: string, country?: string): boolean {
  const t = (ticker || "").toUpperCase().trim();
  if (/\.(NS|BO|L|T|HK|AS|PA|DE|MI|MC|AX|TO|SA)$/.test(t)) return false;
  if (/\.(NS|BO)$/.test(t)) return false;
  const c = (country || "").toLowerCase();
  if (c.includes("india") || c.includes("united kingdom") || c.includes("japan")) return false;
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t);
}

const drift = (a: number | null, b: number | null): number | null => {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base <= 0) return a === b ? 0 : 1;
  return Math.abs(a - b) / base;
};

function finding(
  field: EdgarFinding["field"],
  yahoo: number | null,
  edgar: number | null,
  periodEnd: string | null | undefined,
  label: string
): EdgarFinding {
  const d = drift(yahoo, edgar);
  const pct = d === null ? "n/a" : `${(d * 100).toFixed(1)}%`;
  const verdict =
    d === null
      ? "incomparable (missing side)"
      : d <= 0.1
        ? "reconciled with filing"
        : d <= 0.25
          ? "divergent — plausible class/dilution/timing gap, Yahoo retained"
          : "materially divergent — investigate feed vs filing, Yahoo retained";
  return {
    field,
    yahoo,
    edgar,
    periodEnd: periodEnd ?? null,
    driftPct: d,
    note:
      `${label}: Yahoo ${yahoo !== null ? Math.round(yahoo).toLocaleString("en") : "n/a"} vs ` +
      `EDGAR 10-K ${edgar !== null ? Math.round(edgar).toLocaleString("en") : "n/a"}` +
      `${periodEnd ? ` (${periodEnd})` : ""} (drift ${pct} — ${verdict}; priced figures stay Yahoo-only).`,
  };
}

// ── CIK map (process cache — company_tickers.json is ~1MB, fetched once) ──
let cikCache: Map<string, { cik: string; title: string }> | null = null;
let cikCacheAt = 0;
const CIK_TTL_MS = 24 * 3600 * 1000;

const UA = {
  "User-Agent": "APEX-RESEARCH cross-check/1.0 (contact: admin@localhost)",
  Accept: "application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function resolveCik(ticker: string, signal: AbortSignal): Promise<{ cik: string; title: string } | null> {
  const key = ticker.toUpperCase().replace(/\./g, "-");
  if (!cikCache || Date.now() - cikCacheAt > CIK_TTL_MS) {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", { signal, headers: UA });
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const map = new Map<string, { cik: string; title: string }>();
    for (const row of Object.values(raw)) {
      map.set(String(row.ticker).toUpperCase(), {
        cik: String(row.cik_str).padStart(10, "0"),
        title: row.title,
      });
    }
    cikCache = map;
    cikCacheAt = Date.now();
  }
  return cikCache.get(key) ?? null;
}

interface XbrlPoint { end: string; val: number; form: string; fy?: string; fp?: string }

/**
 * Latest 10-K point across alias tags (pooled, then newest wins).
 * Per-tag first-match misfires when a tag carries only stale history
 * (AAPL precedent: "Revenues" held a 2018 point while "SalesRevenueNet"
 * held FY2025) — so candidates from every alias compete by period end.
 */
function latest10K(facts: any, tags: string[]): { val: number; end: string } | null {
  const gaap = facts?.facts?.["us-gaap"];
  if (!gaap) return null;
  let best: { val: number; end: string } | null = null;
  for (const tag of tags) {
    const units = gaap[tag]?.units;
    if (!units) continue;
    // Each tag carries a single natural unit (USD / Shares) — first key.
    const key = Object.keys(units)[0];
    const pts = (units[key] || []) as XbrlPoint[];
    for (const p of pts) {
      if (p.form !== "10-K" || !Number.isFinite(Number(p.val))) continue;
      if (!best || p.end > best.end) best = { val: Number(p.val), end: p.end };
    }
  }
  return best;
}

/**
 * Fetch EDGAR 10-K facts and compare vs Yahoo. Never throws.
 */
export async function fetchEdgarSnapshot(
  ticker: string,
  country: string | undefined,
  yahoo: { shares: number | null; revenue: number | null; netIncome: number | null },
  timeoutMs = 10000
): Promise<EdgarCrosscheck> {
  const fetchedAt = new Date().toISOString();
  if (!isEdgarEligible(ticker, country)) {
    return { available: false, reason: "non-US ticker — EDGAR covers US filers only", findings: [], fetchedAt };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const id = await resolveCik(ticker, ctrl.signal);
    if (!id) {
      return { available: false, reason: "ticker has no SEC CIK (no 10-K filer) — skipped", findings: [], fetchedAt };
    }
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id.cik}.json`, {
      signal: ctrl.signal,
      headers: UA,
    });
    if (!res.ok) {
      return { available: false, reason: `EDGAR HTTP ${res.status} — skipped`, cik: id.cik, findings: [], fetchedAt };
    }
    const facts = await res.json();
    const rev = latest10K(facts, ["Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerExcludingAssessedTax"]);
    const ni = latest10K(facts, ["NetIncomeLoss", "ProfitLoss"]);
    // META precedent: filer reports WeightedAverageNumberOfDilutedSharesOutstanding
    // (with Outstanding suffix) — the bare alias misses it entirely.
    const sh = latest10K(facts, ["CommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfDilutedShares", "WeightedAverageNumberOfSharesOutstandingBasic"]);

    if (!rev && !ni && !sh) {
      return { available: false, reason: "no 10-K money/share tags — skipped", cik: id.cik, company: id.title, findings: [], fetchedAt };
    }
    return {
      available: true,
      cik: id.cik,
      company: id.title,
      findings: [
        finding("shares", yahoo.shares, sh?.val ?? null, sh?.end, "Share base"),
        finding("revenue", yahoo.revenue, rev?.val ?? null, rev?.end, "Latest revenue (USD raw)"),
        finding("netIncome", yahoo.netIncome, ni?.val ?? null, ni?.end, "Latest net income (USD raw)"),
      ],
      fetchedAt,
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === "AbortError" ? "timeout — skipped" : "fetch failed — skipped";
    return { available: false, reason: `EDGAR ${reason}`, findings: [], fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}

export default { isEdgarEligible, fetchEdgarSnapshot };
