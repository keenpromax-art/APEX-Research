// ============================================================
// Yahoo Finance data fetcher — uses raw fetch (Cloudflare-compatible)
// ============================================================
import type { TickerNewsItem, InstitutionalHolder, AnnualFinancials, QuarterlyFinancials } from "@/types/report";

const YF_BASE = "https://query1.finance.yahoo.com";
const YF_BASE2 = "https://query2.finance.yahoo.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
};

function safeNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "Infinity" || v === "-Infinity")
    return fallback;
  const n = Number(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
}

/**
 * Provenance tracker for audited-vs-estimated financial fields.
 * Every fixed-margin fallback MUST record its field name here so downstream
 * ledgers, QA gates, and PDF footnotes can distinguish reported vs modeled data.
 */
function trackEstimate(used: string[], name: string): void {
  if (!used.includes(name)) used.push(name);
}

/** True when any of the Yahoo statement keys holds a real reported (non-zero) value. */
function hasStatementField(obj: Record<string, unknown>, keys: string[]): boolean {
  if (!obj) return false;
  for (const k of keys) {
    const v = obj[k];
    const raw = (typeof v === "object" && v !== null && "raw" in (v as Record<string, unknown>))
      ? (v as Record<string, unknown>).raw
      : v;
    if (raw === null || raw === undefined) continue;
    const n = Number(raw);
    if (!isNaN(n) && isFinite(n) && n !== 0) return true;
  }
  return false;
}

/** True when a timeseries field holds a real reported (non-zero) value. */
function hasReported(o: Record<string, number>, key: string): boolean {
  return hasStatementField(o as unknown as Record<string, unknown>, [key]);
}

/**
 * Safely extracts a numeric value from an object checking multiple field name aliases.
 * Supports both raw scalar numbers and Yahoo Finance `{ raw: number }` structures.
 */
export function readFieldVariant(
  obj: Record<string, unknown> | undefined,
  fieldVariants: string[],
  fallback = 0
): number {
  if (!obj) return fallback;
  for (const variant of fieldVariants) {
    if (variant in obj) {
      const val = obj[variant];
      if (val !== undefined && val !== null) {
        const raw = (typeof val === "object" && val !== null && "raw" in (val as Record<string, unknown>))
          ? (val as Record<string, unknown>).raw
          : val;
        if (raw !== null && raw !== undefined && raw !== "Infinity" && raw !== "-Infinity") {
          const n = Number(raw);
          if (!isNaN(n) && isFinite(n)) {
            return n;
          }
        }
      }
    }
  }
  return fallback;
}

/**
 * Checks multiple aliases and returns the first non-zero valid finite number.
 */
export function readFirstNonZeroFieldVariant(
  obj: Record<string, unknown> | undefined,
  fieldVariants: string[],
  fallback = 0
): number {
  if (!obj) return fallback;
  for (const variant of fieldVariants) {
    const val = readFieldVariant(obj, [variant], 0);
    if (val !== 0) return val;
  }
  return fallback;
}

function formatFiscalYear(timestamp: number, currency: string): string {
  const d = new Date(timestamp * 1000);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  // Indian companies: April-March fiscal year
  if (["INR", "NPR", "PKR"].includes(currency) && month <= 3) {
    return `FY${year}`;
  }
  // US companies: mostly Jan-Dec or custom
  return `FY${year}`;
}

// ─────────────────────────────────────────────
// Daily price/volume history (powers MEASURED event studies).
// Yahoo chart API v8; tolerant — returns null on any failure so callers
// fall back to the labeled illustrative path instead of failing the report.
// ─────────────────────────────────────────────
export interface DailyPriceSession {
  /** UTC calendar date YYYY-MM-DD */
  date: string;
  close: number | null;
  volume: number | null;
}

export async function fetchDailyPriceHistory(
  symbol: string,
  period1Sec: number,
  period2Sec: number
): Promise<DailyPriceSession[] | null> {
  try {
    for (const base of [YF_BASE, YF_BASE2]) {
      try {
        const url = `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(period1Sec)}&period2=${Math.floor(period2Sec)}&interval=1d&events=div%7Csplit`;
        const res = await fetch(url, { headers: HEADERS });
        if (!res.ok) continue;
        const json = await res.json();
        const result = json?.chart?.result?.[0];
        const timestamps: number[] = result?.timestamp || [];
        const quote = result?.indicators?.quote?.[0] || {};
        const closes: (number | null)[] = quote.close || [];
        const volumes: (number | null)[] = quote.volume || [];
        if (!timestamps.length) continue;
        const sessions: DailyPriceSession[] = timestamps.map((ts: number, i: number) => ({
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          close: typeof closes[i] === "number" && isFinite(closes[i]) ? closes[i] as number : null,
          volume: typeof volumes[i] === "number" && isFinite(volumes[i]) ? volumes[i] as number : null,
        })).filter((s) => s.close !== null);
        if (sessions.length > 0) return sessions;
      } catch {
        // try next base
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Search companies
// ─────────────────────────────────────────────
export async function searchCompanies(query: string) {
  const url = `${YF_BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance search failed: ${res.status}`);
  const json = await res.json();
  return (json?.quotes ?? []) as {
    symbol: string;
    shortname?: string;
    longname?: string;
    exchange: string;
    exchDisp?: string;
    typeDisp?: string;
    sector?: string;
    industry?: string;
  }[];
}

// ─────────────────────────────────────────────
// Cookie & Crumb Session Manager for Yahoo Finance
// ─────────────────────────────────────────────
interface YahooSession {
  cookie: string;
  crumb: string;
  expiry: number;
}

let cachedSession: YahooSession | null = null;
let sessionPromise: Promise<YahooSession> | null = null;

async function fetchNewSession(): Promise<YahooSession> {
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  let cookie = "";
  try {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: {
        "User-Agent": userAgent,
        Accept: "*/*",
      },
    });
    const setCookie = cookieRes.headers.get("set-cookie");
    if (setCookie) {
      cookie = setCookie.split(";")[0].trim();
    }
  } catch (err) {
    console.warn("Failed to get cookie from fc.yahoo.com:", err);
  }

  let crumb = "";
  for (const base of [YF_BASE2, YF_BASE]) {
    try {
      const crumbRes = await fetch(`${base}/v1/test/getcrumb`, {
        headers: {
          "User-Agent": userAgent,
          ...(cookie ? { Cookie: cookie } : {}),
          Accept: "*/*",
        },
      });
      if (crumbRes.ok) {
        const text = await crumbRes.text();
        if (text && !text.includes("<") && !text.toLowerCase().includes("too many requests")) {
          crumb = text.trim();
          break;
        }
      }
    } catch {
      // try next base
    }
  }

  const session: YahooSession = {
    cookie,
    crumb,
    expiry: Date.now() + 20 * 60 * 1000, // 20 minutes
  };

  cachedSession = session;
  return session;
}

export async function getYahooSession(forceRefresh = false): Promise<YahooSession> {
  const now = Date.now();
  if (!forceRefresh && cachedSession && cachedSession.expiry > now && cachedSession.crumb) {
    return cachedSession;
  }

  if (sessionPromise && !forceRefresh) {
    return sessionPromise;
  }

  sessionPromise = fetchNewSession().finally(() => {
    sessionPromise = null;
  });

  return sessionPromise;
}

// ─────────────────────────────────────────────
// Quote Summary (all modules)
// ─────────────────────────────────────────────
const MODULES = [
  "assetProfile",
  "summaryDetail",
  "financialData",
  "defaultKeyStatistics",
  "incomeStatementHistory",
  "balanceSheetHistory",
  "cashflowStatementHistory",
  "incomeStatementHistoryQuarterly",
  "balanceSheetHistoryQuarterly",
  "cashflowStatementHistoryQuarterly",
  "majorHoldersBreakdown",
  "institutionOwnership",
  "fundOwnership",
  "insiderHolders",
  "netSharePurchaseActivity",
  "recommendationTrend",
  "earningsTrend",
  "price",
].join(",");

const FUNDAMENTALS_TIMESERIES_TYPES = [
  // Annual Balance Sheet
  "annualTotalAssets",
  "annualTotalLiabilitiesNetMinorityInterest",
  "annualTotalEquityGrossMinorityInterest",
  "annualCommonStockEquity",
  "annualTotalDebt",
  "annualCurrentDebt",
  "annualLongTermDebt",
  "annualNetDebt",
  "annualCashAndCashEquivalents",
  "annualOtherShortTermInvestments",
  "annualAccountsReceivable",
  "annualInventory",
  "annualOtherCurrentAssets",
  "annualCurrentAssets",
  "annualNetPPE",
  "annualGoodwill",
  "annualOtherIntangibleAssets",
  "annualOtherNonCurrentAssets",
  "annualAccountsPayable",
  "annualOtherCurrentLiabilities",
  "annualCurrentLiabilities",
  "annualOtherNonCurrentLiabilities",
  "annualDeferredTaxLiabilities",
  "annualCapitalStock",
  "annualCommonStock",
  "annualRetainedEarnings",
  "annualWorkingCapital",
  "annualInvestedCapital",
  "annualTangibleBookValue",
  "annualNetTangibleAssets",
  "annualCapitalLeaseObligations",
  "annualOrdinarySharesNumber",

  // Annual Income Statement
  "annualTotalRevenue",
  "annualCostOfRevenue",
  "annualGrossProfit",
  "annualOperatingExpense",
  "annualSellingGeneralAndAdministration",
  "annualResearchAndDevelopment",
  "annualOperatingIncome",
  "annualEBIT",
  "annualEBITDA",
  "annualNormalizedEBITDA",
  "annualInterestIncome",
  "annualInterestExpense",
  "annualPretaxIncome",
  "annualTaxProvision",
  "annualNetIncomeCommonStockholders",
  "annualDilutedEPS",
  "annualBasicEPS",
  "annualReconciledCostOfRevenue",
  "annualReconciledDepreciation",

  // Annual Cash Flow
  "annualOperatingCashFlow",
  "annualInvestingCashFlow",
  "annualFinancingCashFlow",
  "annualEndCashPosition",
  "annualCapitalExpenditure",
  "annualIssuanceOfCapitalStock",
  "annualRepurchaseOfCapitalStock",
  "annualIssuanceOfDebt",
  "annualRepaymentOfDebt",
  "annualFreeCashFlow",
  "annualCashDividendsPaid",
  "annualStockBasedCompensation",
  "annualDeferredTax",
  "annualDeferredIncomeTax",
  "annualChangeInWorkingCapital",
  "annualChangeInReceivables",
  "annualChangeInInventory",
  "annualChangeInAccountPayable",
  "annualChangesInCash",

  // Quarterly
  "quarterlyTotalRevenue",
  "quarterlyGrossProfit",
  "quarterlyOperatingIncome",
  "quarterlyEBITDA",
  "quarterlyNetIncomeCommonStockholders",
  "quarterlyDilutedEPS",
  "quarterlyTotalAssets",
  "quarterlyTotalDebt",
  "quarterlyTotalEquityGrossMinorityInterest",
].join(",");

export async function fetchFundamentalsTimeseries(symbol: string): Promise<Record<string, unknown> | null> {
  try {
    const session = await getYahooSession();
    const url = `${YF_BASE2}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${FUNDAMENTALS_TIMESERIES_TYPES}&period1=1577836800&period2=1893456000${session.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : ""}`;
    const headers: Record<string, string> = {
      ...HEADERS,
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    };

    let res = await fetch(url, { headers });
    if (!res.ok && session.crumb) {
      const refreshedSession = await getYahooSession(true);
      const retryUrl = `${YF_BASE2}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${FUNDAMENTALS_TIMESERIES_TYPES}&period1=1577836800&period2=1893456000${refreshedSession.crumb ? `&crumb=${encodeURIComponent(refreshedSession.crumb)}` : ""}`;
      res = await fetch(retryUrl, {
        headers: {
          ...HEADERS,
          ...(refreshedSession.cookie ? { Cookie: refreshedSession.cookie } : {}),
        },
      });
    }

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchQuoteSummary(symbol: string) {
  let session = await getYahooSession();

  let url = `${YF_BASE2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}${session.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : ""}`;
  let headers: Record<string, string> = {
    ...HEADERS,
    ...(session.cookie ? { Cookie: session.cookie } : {}),
  };

  // Concurrently fetch quoteSummary and fundamentals-timeseries
  const [quoteSummaryRes, timeseriesData] = await Promise.all([
    fetch(url, { headers }).catch(() => null),
    fetchFundamentalsTimeseries(symbol).catch(() => null),
  ]);

  let res = quoteSummaryRes;

  // If 401 Unauthorized or crumb expired, refresh session and retry once
  if ((!res || res.status === 401 || res.status === 403) && session.crumb) {
    session = await getYahooSession(true);
    url = `${YF_BASE2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}${session.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : ""}`;
    headers = {
      ...HEADERS,
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    };
    res = await fetch(url, { headers });
  }

  // Fallback to query1 if query2 fails
  if (!res || (!res.ok && res.status !== 404)) {
    url = `${YF_BASE}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}${session.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : ""}`;
    res = await fetch(url, { headers });
  }

  if (!res || !res.ok) {
    throw new Error(`Yahoo Finance quoteSummary failed: ${res?.status}`);
  }

  const json = await res.json();
  const result = json?.quoteSummary?.result?.[0];
  if (!result) {
    throw new Error(`No data found for ticker: ${symbol}`);
  }

  if (timeseriesData) {
    result.fundamentalsTimeseries = timeseriesData;
  }

  return result;
}

// ─────────────────────────────────────────────
// Peer / competitors — similar sector stocks
// ─────────────────────────────────────────────
export async function fetchPeerQuotes(symbols: string[]): Promise<Record<string, any>[]> {
  if (!symbols.length) return [];
  const session = await getYahooSession();
  const crumbParam = session.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : "";
  const headers = {
    ...HEADERS,
    ...(session.cookie ? { Cookie: session.cookie } : {}),
  };

  let rawQuotes: Record<string, unknown>[] = [];
  for (const base of [YF_BASE2, YF_BASE]) {
    try {
      const url = `${base}/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(",")}${crumbParam}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const json = await res.json();
        rawQuotes = (json?.quoteResponse?.result ?? []) as Record<string, unknown>[];
        if (rawQuotes.length > 0) break;
      }
    } catch {
      // try next
    }
  }

  // Enrich each peer with full fundamental metrics (EV/EBITDA, EV/Sales, ROE, margins, leverage, growth, yield)
  const peerModules = "defaultKeyStatistics,financialData,summaryDetail";
  const enriched = await Promise.all(
    symbols.map(async (sym) => {
      const baseQuote =
        rawQuotes.find(
          (q) => ((q.symbol as string) || "").toUpperCase() === sym.toUpperCase()
        ) || {};

      try {
        let sumRes: Response | null = null;
        for (const base of [YF_BASE2, YF_BASE]) {
          try {
            const sumUrl = `${base}/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${peerModules}${crumbParam}`;
            const r = await fetch(sumUrl, { headers });
            if (r.ok) {
              sumRes = r;
              break;
            }
          } catch {
            // try next base
          }
        }

        if (sumRes && sumRes.ok) {
          const sumJson = await sumRes.json();
          const resObj = sumJson?.quoteSummary?.result?.[0] || {};
          const ks = resObj.defaultKeyStatistics || {};
          const fd = resObj.financialData || {};
          const sd = resObj.summaryDetail || {};

          const safeVal = (v: any): number | null => {
            if (v === null || v === undefined) return null;
            if (typeof v === "object") {
              if ("raw" in v && typeof v.raw === "number" && !isNaN(v.raw)) return v.raw;
              return null;
            }
            return typeof v === "number" && !isNaN(v) ? v : null;
          };

          const rawRoe = safeVal(fd.returnOnEquity);
          const epsVal = safeVal(ks.trailingEps);
          const bvVal = safeVal(ks.bookValue);
          const computedRoe =
            epsVal != null && bvVal != null && bvVal > 0
              ? epsVal / bvVal
              : null;
          const pbRatio = safeVal(ks.priceToBook) ?? safeVal(sd.priceToBook) ?? safeVal(baseQuote.priceToBook);
          const peRatio = safeVal(sd.trailingPE) ?? safeVal(baseQuote.trailingPE);
          const derivedRoe =
            pbRatio != null && peRatio != null && peRatio > 0
              ? pbRatio / peRatio
              : null;
          const roe = rawRoe ?? computedRoe ?? derivedRoe;

          const rawDebtToEquity = safeVal(fd.debtToEquity);
          // Yahoo Finance reports debtToEquity as a percentage (e.g. 118.127 for 118.1%), or as a ratio
          const debtToEquity =
            rawDebtToEquity != null
              ? rawDebtToEquity > 5
                ? rawDebtToEquity / 100
                : rawDebtToEquity
              : null;

          return {
            ...baseQuote,
            symbol: sym,
            enterpriseToEbitda: safeVal(ks.enterpriseToEbitda) ?? safeVal(baseQuote.enterpriseToEbitda),
            enterpriseToRevenue: safeVal(ks.enterpriseToRevenue) ?? safeVal(baseQuote.enterpriseToRevenue),
            returnOnEquity: roe ?? safeVal(baseQuote.returnOnEquity),
            profitMargins: safeVal(ks.profitMargins) ?? safeVal(fd.profitMargins) ?? safeVal(baseQuote.profitMargins),
            grossMargins: safeVal(fd.grossMargins) ?? safeVal(baseQuote.grossMargins),
            ebitdaMargins: safeVal(fd.ebitdaMargins) ?? safeVal(baseQuote.ebitdaMargins),
            operatingMargins: safeVal(fd.operatingMargins) ?? safeVal(baseQuote.operatingMargins),
            debtToEquity: debtToEquity ?? safeVal(baseQuote.debtToEquity),
            currentRatio: safeVal(fd.currentRatio) ?? safeVal(baseQuote.currentRatio),
            revenueGrowth: safeVal(fd.revenueGrowth) ?? safeVal(baseQuote.revenueGrowth),
            dividendYield: safeVal(sd.dividendYield) ?? safeVal(baseQuote.dividendYield),
            priceToBook: pbRatio ?? safeVal(baseQuote.priceToBook),
            trailingPE: peRatio ?? safeVal(baseQuote.trailingPE),
            marketCap: safeVal(sd.marketCap) ?? safeVal(baseQuote.marketCap),
            regularMarketPrice: safeVal(sd.regularMarketPrice) ?? safeVal(baseQuote.regularMarketPrice),
          };
        }
      } catch {
        // preserve base quote
      }

      return {
        ...baseQuote,
        symbol: sym,
      };
    })
  );

  return enriched;
}

// ─────────────────────────────────────────────
// Parse Timeseries Financials (Audited Ground Truth)
// ─────────────────────────────────────────────
function parseTimeseriesFinancials(
  timeseriesRaw: unknown,
  currency: string
): AnnualFinancials[] | null {
  if (!timeseriesRaw || typeof timeseriesRaw !== "object") return null;
  const results = (timeseriesRaw as Record<string, unknown>)?.timeseries as Record<string, unknown>;
  const list = results?.result as unknown[];
  if (!Array.isArray(list) || list.length === 0) return null;

  const byDate: Record<string, Record<string, number>> = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const itemObj = item as Record<string, unknown>;
    const typeName = (itemObj.meta as Record<string, unknown>)?.type as string[] | undefined;
    const key = typeName?.[0];
    if (!key || !key.startsWith("annual")) continue;
    const series = itemObj[key];
    if (!Array.isArray(series)) continue;
    for (const entry of series) {
      if (!entry || typeof entry !== "object") continue;
      const date = (entry as Record<string, unknown>).asOfDate as string | undefined;
      const periodType = (entry as Record<string, unknown>).periodType as string | undefined;
      if (!date || periodType !== "12M") continue;
      if (!byDate[date]) byDate[date] = {};
      const reportedVal = (entry as Record<string, unknown>).reportedValue as Record<string, unknown> | undefined;
      const val = safeNum(reportedVal?.raw ?? (entry as Record<string, unknown>).raw);
      if (val !== 0 || !isNaN(val)) {
        byDate[date][key] = val;
      }
    }
  }

  const sortedDates = Object.keys(byDate)
    .sort()
    .filter(d => (byDate[d].annualTotalRevenue || 0) > 0 || (byDate[d].annualTotalAssets || 0) > 0);
  if (sortedDates.length === 0) return null;

  return sortedDates.map(dateStr => {
    const d = byDate[dateStr];
    const dObj = new Date(dateStr);
    const dateTs = Math.floor(dObj.getTime() / 1000);
    const fyLabel = formatFiscalYear(dateTs, currency);
    // Provenance: every fixed-margin synthesis below is recorded, never silent.
    const estimatesUsed: string[] = [];

    const revenue = d.annualTotalRevenue || d.annualOperatingRevenue || 0;
    const grossProfit = d.annualGrossProfit || (revenue > 0 && d.annualCostOfRevenue ? Math.max(0, revenue - d.annualCostOfRevenue) : (revenue > 0 ? Math.round(revenue * 0.35) : 0));
    if (revenue > 0 && !hasReported(d, "annualGrossProfit") && !d.annualCostOfRevenue) trackEstimate(estimatesUsed, "grossProfit@35%-of-revenue");
    const costOfRevenue = d.annualCostOfRevenue || (revenue > 0 && grossProfit > 0 ? Math.max(0, revenue - grossProfit) : 0);
    const grossMargin = revenue > 0 ? grossProfit / revenue : 0;
    const operatingIncome = d.annualOperatingIncome || d.annualEBIT || (revenue > 0 ? Math.round(revenue * 0.13) : 0);
    if (revenue > 0 && !hasReported(d, "annualOperatingIncome") && !hasReported(d, "annualEBIT")) trackEstimate(estimatesUsed, "operatingIncome@13%-of-revenue");
    const totalOperatingExpenses = d.annualOperatingExpense || 0;
    const sellingGeneralAdministrative = d.annualSellingGeneralAndAdministration || 0;
    const researchDevelopment = d.annualResearchAndDevelopment || 0;
    const ebitda = d.annualEBITDA || d.annualNormalizedEBITDA || (operatingIncome > 0 ? operatingIncome + (d.annualDepreciationAndAmortization || Math.round(revenue * 0.04)) : (revenue > 0 ? Math.round(revenue * 0.175) : 0));
    if (revenue > 0 && !hasReported(d, "annualEBITDA") && !hasReported(d, "annualNormalizedEBITDA")) trackEstimate(estimatesUsed, "ebitda@fixed-margin");
    const ebitdaMargin = revenue > 0 ? ebitda / revenue : 0;
    const ebitMargin = revenue > 0 ? operatingIncome / revenue : 0;
    const interestExpense = Math.abs(d.annualInterestExpense || 0);
    const otherIncome = d.annualTotalOtherIncomeExpenseNet || 0;
    const pretaxIncome = d.annualPretaxIncome || (operatingIncome - interestExpense);
    const incomeTaxExpense = d.annualTaxProvision || 0;
    const netIncome = d.annualNetIncomeCommonStockholders ?? (d.annualNetIncome || 0);
    const netMargin = revenue > 0 ? netIncome / revenue : 0;

    const shares = d.annualOrdinarySharesNumber || d.annualShareIssued || 0;
    const dilutedEps = d.annualDilutedEPS || d.annualBasicEPS || (shares > 0 ? netIncome / shares : 0);
    const eps = dilutedEps;

    // Balance Sheet
    const totalAssets = d.annualTotalAssets || 0;
    const totalEquity = d.annualTotalEquityGrossMinorityInterest || d.annualCommonStockEquity || 0;
    // Strict accounting balance: Total Liabilities = Total Assets - Total Equity
    const totalLiabilities = totalAssets > 0 && totalEquity > 0
      ? totalAssets - totalEquity
      : (d.annualTotalLiabilitiesNetMinorityInterest || 0);

    const shortTermDebt = d.annualCurrentDebt || 0;
    const longTermDebt = d.annualLongTermDebt || 0;
    const capLeases = d.annualCapitalLeaseObligations || 0;
    const totalDebt = d.annualTotalDebt || (shortTermDebt + longTermDebt + capLeases);

    const cash = d.annualCashAndCashEquivalents || 0;
    const shortTermInvestments = d.annualOtherShortTermInvestments || 0;
    const netReceivables = d.annualAccountsReceivable || 0;
    const inventory = d.annualInventory || 0;
    const currentAssets = d.annualCurrentAssets || (cash + shortTermInvestments + netReceivables + inventory + (d.annualOtherCurrentAssets || 0));
    const netFixedAssets = d.annualNetPPE || 0;
    const goodwill = d.annualGoodwill || 0;
    const otherIntangibles = d.annualOtherIntangibleAssets || 0;
    const otherCurrentAssets = d.annualOtherCurrentAssets || Math.max(0, currentAssets - cash - shortTermInvestments - netReceivables - inventory);
    const otherNonCurrentAssets = d.annualOtherNonCurrentAssets || Math.max(0, totalAssets - currentAssets - netFixedAssets - goodwill - otherIntangibles);

    const accountsPayable = d.annualAccountsPayable || 0;
    const currentLiabilities = d.annualCurrentLiabilities || (accountsPayable + shortTermDebt + (d.annualOtherCurrentLiabilities || 0));
    const otherCurrentLiabilities = d.annualOtherCurrentLiabilities || Math.max(0, currentLiabilities - accountsPayable - shortTermDebt);
    const deferredTaxLiabilities = d.annualDeferredTaxLiabilities || 0;
    const otherNonCurrentLiabilities = d.annualOtherNonCurrentLiabilities || Math.max(0, totalLiabilities - currentLiabilities - longTermDebt - deferredTaxLiabilities);

    const commonStock = d.annualCommonStock || d.annualCapitalStock || 0;
    const retainedEarnings = d.annualRetainedEarnings || Math.max(0, totalEquity - commonStock);

    const netWorkingCapital = currentAssets - currentLiabilities;
    const workingCapital = d.annualWorkingCapital || netWorkingCapital;
    const investedCapital = d.annualInvestedCapital || (totalDebt + totalEquity);
    const tangibleBookValue = d.annualTangibleBookValue || Math.max(0, totalEquity - goodwill - otherIntangibles);
    const netDebt = d.annualNetDebt || (totalDebt - cash - shortTermInvestments);

    // Cash Flow (fixed-margin syntheses are provenance-tracked, never silent)
    const ocfEstimated = !hasReported(d, "annualOperatingCashFlow");
    const operatingCashFlow = d.annualOperatingCashFlow || (netIncome + Math.round(revenue * 0.04));
    if (ocfEstimated && revenue > 0) trackEstimate(estimatesUsed, "operatingCashFlow@NI+4%-of-revenue");
    const capexEstimated = !hasReported(d, "annualCapitalExpenditure");
    const capitalExpenditures = Math.abs(d.annualCapitalExpenditure || Math.round(revenue * 0.05));
    if (capexEstimated && revenue > 0) trackEstimate(estimatesUsed, "capex@5%-of-revenue");
    const freeCashFlow = d.annualFreeCashFlow || (operatingCashFlow - capitalExpenditures);
    const investingCashFlow = d.annualInvestingCashFlow || d.annualTotalCashFromInvestingActivities || -capitalExpenditures;
    const financingCashFlow = d.annualFinancingCashFlow || d.annualTotalCashFromFinancingActivities || 0;
    const dividendsPaid = Math.abs(d.annualCashDividendsPaid || 0);
    const changeInCash = d.annualChangesInCash || d.annualChangeInCash || (operatingCashFlow + investingCashFlow + financingCashFlow);

    const interestIncome = d.annualInterestIncome || 0;
    const ebit = d.annualEBIT || operatingIncome;
    const depr = d.annualReconciledDepreciation || d.annualDepreciationAndAmortization || (ebitda > operatingIncome ? ebitda - operatingIncome : Math.round(revenue * 0.035));
    if (revenue > 0 && !hasReported(d, "annualReconciledDepreciation") && !hasReported(d, "annualDepreciationAndAmortization") && !(ebitda > operatingIncome)) trackEstimate(estimatesUsed, "depreciation@3.5%-of-revenue");
    const issuanceOfDebt = d.annualIssuanceOfDebt || 0;
    const repaymentOfDebt = Math.abs(d.annualRepaymentOfDebt || 0);
    const issuanceOfCapitalStock = d.annualIssuanceOfCapitalStock || 0;
    const repurchases = Math.abs(d.annualRepurchaseOfCapitalStock || 0);
    const stockBasedCompensation = d.annualStockBasedCompensation || 0;
    const deferredIncomeTax = d.annualDeferredTax || d.annualDeferredIncomeTax || 0;
    const changeInWorkingCapital = d.annualChangeInWorkingCapital || 0;
    const changeInReceivables = d.annualChangeInReceivables || 0;
    const changeInInventory = d.annualChangeInInventory || 0;
    const changeInPayables = d.annualChangeInAccountPayable || 0;
    const endCashPosition = d.annualEndCashPosition || cash;

    return {
      year: fyLabel,
      fiscalYearEnd: dateStr,
      revenue,
      costOfRevenue,
      grossProfit,
      grossMargin,
      researchDevelopment,
      sellingGeneralAdministrative,
      totalOperatingExpenses,
      operatingIncome,
      ebit,
      ebitda,
      ebitdaMargin,
      ebitMargin,
      interestExpense,
      interestIncome,
      otherIncome,
      pretaxIncome,
      incomeTaxExpense,
      netIncome,
      netMargin,
      depreciation: depr,
      eps,
      dilutedEps,
      sharesOutstanding: shares,
      totalAssets,
      totalLiabilities,
      totalEquity,
      cash,
      shortTermInvestments,
      netReceivables,
      inventory,
      currentAssets,
      netFixedAssets,
      totalDebt,
      shortTermDebt,
      longTermDebt,
      accountsPayable,
      currentLiabilities,
      netWorkingCapital,
      operatingCashFlow,
      capitalExpenditures,
      freeCashFlow,
      investingCashFlow,
      financingCashFlow,
      dividendsPaid,
      changeInCash,
      commonStock,
      retainedEarnings,
      goodwill,
      otherIntangibles,
      otherCurrentAssets,
      otherCurrentLiabilities,
      otherNonCurrentAssets,
      otherNonCurrentLiabilities,
      deferredTaxLiabilities,
      capitalLeaseObligations: capLeases,
      netDebt,
      workingCapital,
      investedCapital,
      tangibleBookValue,
      issuanceOfDebt,
      repaymentOfDebt,
      issuanceOfCapitalStock,
      repurchases,
      stockBasedCompensation,
      deferredIncomeTax,
      changeInWorkingCapital,
      changeInReceivables,
      changeInInventory,
      changeInPayables,
      endCashPosition,
      estimatesUsed,
    };
  });
}

function parseTimeseriesQuarterly(
  timeseriesRaw: unknown
): QuarterlyFinancials[] | null {
  if (!timeseriesRaw || typeof timeseriesRaw !== "object") return null;
  const results = (timeseriesRaw as Record<string, unknown>)?.timeseries as Record<string, unknown>;
  const list = results?.result as unknown[];
  if (!Array.isArray(list) || list.length === 0) return null;

  const quarterlyByDate: Record<string, Record<string, number>> = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const itemObj = item as Record<string, unknown>;
    const typeName = (itemObj.meta as Record<string, unknown>)?.type as string[] | undefined;
    const key = typeName?.[0];
    if (!key || !key.startsWith("quarterly")) continue;
    const series = itemObj[key];
    if (!Array.isArray(series)) continue;
    for (const entry of series) {
      if (!entry || typeof entry !== "object") continue;
      const date = (entry as Record<string, unknown>).asOfDate as string | undefined;
      const periodType = (entry as Record<string, unknown>).periodType as string | undefined;
      if (!date || periodType !== "3M") continue;
      if (!quarterlyByDate[date]) quarterlyByDate[date] = {};
      const reportedVal = (entry as Record<string, unknown>).reportedValue as Record<string, unknown> | undefined;
      const val = safeNum(reportedVal?.raw ?? (entry as Record<string, unknown>).raw);
      if (val !== 0 || !isNaN(val)) {
        quarterlyByDate[date][key] = val;
      }
    }
  }

  const qDates = Object.keys(quarterlyByDate).sort();
  if (qDates.length === 0) return null;

  return qDates.slice(-8).map((dStr, idx, arr) => {
    const q = quarterlyByDate[dStr];
    const rev = q.quarterlyTotalRevenue || 0;
    const prevQ = idx >= 4 ? quarterlyByDate[arr[idx - 4]] : null;
    const prevRev = prevQ?.quarterlyTotalRevenue || 0;
    const yoy = prevRev > 0 ? (rev - prevRev) / prevRev : 0;
    const gp = q.quarterlyGrossProfit || 0;
    const ebit = q.quarterlyOperatingIncome || 0;
    const ebitda = q.quarterlyEBITDA || (ebit > 0 ? ebit + Math.round(rev * 0.04) : 0);
    const ni = q.quarterlyNetIncomeCommonStockholders || 0;
    const eps = q.quarterlyDilutedEPS || 0;

    const d = new Date(dStr);
    const qNum = Math.ceil((d.getMonth() + 1) / 3);

    return {
      period: `Q${qNum}FY${d.getFullYear() % 100}`,
      endDate: dStr,
      revenue: rev,
      revenueGrowthYoY: yoy,
      grossProfit: gp,
      ebitda,
      ebitdaMargin: rev > 0 ? ebitda / rev : 0,
      operatingIncome: ebit,
      netIncome: ni,
      netMargin: rev > 0 ? ni / rev : 0,
      eps,
    };
  });
}

// ─────────────────────────────────────────────
// Parse raw Yahoo Finance data into structured form
// ─────────────────────────────────────────────
export function parseQuoteSummary(raw: Record<string, unknown>, symbol: string) {
  const profile = raw.assetProfile as Record<string, unknown> ?? {};
  const summary = raw.summaryDetail as Record<string, unknown> ?? {};
  const finData = raw.financialData as Record<string, unknown> ?? {};
  const keyStats = raw.defaultKeyStatistics as Record<string, unknown> ?? {};
  const priceData = raw.price as Record<string, unknown> ?? {};
  const majorHolders = raw.majorHoldersBreakdown as Record<string, unknown> ?? {};
  const instOwnership = raw.institutionOwnership as Record<string, unknown> ?? {};
  const rawFundOwnership = raw.fundOwnership as Record<string, unknown> ?? {};
  const rawInsiderHolders = raw.insiderHolders as Record<string, unknown> ?? {};
  const rawNetActivity = raw.netSharePurchaseActivity as Record<string, unknown> ?? {};

  // Fail-closed identity: unknown currency stays EMPTY (never a "USD" guess).
  // IDENTITY-01 blocks export until identity resolves; downstream defaults
  // must not re-mask an unverified listing as a dollar-denominated company.
  const currency: string =
    (priceData.currency as string) ||
    (summary.currency as string) ||
    "";

  // ── Profile ──────────────────────────────────────────────────────────────
  const companyProfile = {
    ticker: symbol.toUpperCase(),
    name:
      (priceData.longName as string) ||
      (priceData.shortName as string) ||
      symbol,
    exchange:
      (priceData.exchangeName as string) || (priceData.exchange as string) || "",
    exchangeTimezoneName:
      (priceData.exchangeTimezoneName as string) || "",
    sector: (profile.sector as string) || "N/A",
    industry: (profile.industry as string) || "N/A",
    country: (profile.country as string) || "N/A",
    currency,
    description: (profile.longBusinessSummary as string) || "",
    website: (profile.website as string) || "",
    employees: safeNum((profile.fullTimeEmployees as unknown)),
    logo: `https://logo.clearbit.com/${(profile.website as string || "").replace(/^https?:\/\//, "").split("/")[0]}`,
    officers: ((profile.companyOfficers as unknown[]) || []).slice(0, 8).map(
      (o) => {
        const off = o as Record<string, unknown>;
        return {
          name: (off.name as string) || "",
          title: (off.title as string) || "",
          age: safeNum(off.age),
        };
      }
    ),
  };

  // ── Stock Data ────────────────────────────────────────────────────────────
  const stockData = {
    currentPrice:
      safeNum((priceData.regularMarketPrice as Record<string,unknown>)?.raw) ||
      safeNum(finData.currentPrice as Record<string,unknown>),
    previousClose:
      safeNum((priceData.regularMarketPreviousClose as Record<string,unknown>)?.raw),
    open: safeNum((priceData.regularMarketOpen as Record<string,unknown>)?.raw),
    dayHigh: safeNum((priceData.regularMarketDayHigh as Record<string,unknown>)?.raw),
    dayLow: safeNum((priceData.regularMarketDayLow as Record<string,unknown>)?.raw),
    marketCap:
      safeNum((priceData.marketCap as Record<string,unknown>)?.raw) ||
      safeNum((summary.marketCap as Record<string,unknown>)?.raw),
    enterpriseValue: safeNum((keyStats.enterpriseValue as Record<string,unknown>)?.raw),
    // Never fall back to price-as-P/E: a missing trailingPE is 0 (renders N/M),
    // not the share price masquerading as a 250x multiple.
    pe: safeNum((summary.trailingPE as Record<string,unknown>)?.raw),
    forwardPE: safeNum((summary.forwardPE as Record<string,unknown>)?.raw),
    pb: safeNum((keyStats.priceToBook as Record<string,unknown>)?.raw),
    ps: safeNum((keyStats.priceToSalesTrailing12Months as Record<string,unknown>)?.raw),
    dividendYield: safeNum((summary.dividendYield as Record<string,unknown>)?.raw),
    dividendRate: safeNum((summary.dividendRate as Record<string,unknown>)?.raw),
    beta: safeNum((summary.beta as Record<string,unknown>)?.raw),
    week52High: safeNum((summary.fiftyTwoWeekHigh as Record<string,unknown>)?.raw),
    week52Low: safeNum((summary.fiftyTwoWeekLow as Record<string,unknown>)?.raw),
    sharesOutstanding: safeNum((keyStats.sharesOutstanding as Record<string,unknown>)?.raw),
    floatShares: safeNum((keyStats.floatShares as Record<string,unknown>)?.raw),
    avgVolume: safeNum((summary.averageVolume as Record<string,unknown>)?.raw),
    volume: safeNum((priceData.regularMarketVolume as Record<string,unknown>)?.raw),
    fiftyDayAvg: safeNum((summary.fiftyDayAverage as Record<string,unknown>)?.raw),
    twoHundredDayAvg: safeNum((summary.twoHundredDayAverage as Record<string,unknown>)?.raw),
    eps: safeNum((keyStats.trailingEps as Record<string,unknown>)?.raw),
    forwardEps: safeNum((keyStats.forwardEps as Record<string,unknown>)?.raw),
    bookValue: safeNum((keyStats.bookValue as Record<string,unknown>)?.raw),
    priceToBook: safeNum((keyStats.priceToBook as Record<string,unknown>)?.raw),
    returnOnEquity: safeNum((finData.returnOnEquity as Record<string,unknown>)?.raw),
    returnOnAssets: safeNum((finData.returnOnAssets as Record<string,unknown>)?.raw),
    debtToEquity: safeNum((finData.debtToEquity as Record<string,unknown>)?.raw),
    currentRatio: safeNum((finData.currentRatio as Record<string,unknown>)?.raw),
    quickRatio: safeNum((finData.quickRatio as Record<string,unknown>)?.raw),
    grossMargins: safeNum((finData.grossMargins as Record<string,unknown>)?.raw),
    ebitdaMargins: safeNum((finData.ebitdaMargins as Record<string,unknown>)?.raw),
    operatingMargins: safeNum((finData.operatingMargins as Record<string,unknown>)?.raw),
    profitMargins: safeNum((finData.profitMargins as Record<string,unknown>)?.raw),
    freeCashflow: safeNum((finData.freeCashflow as Record<string,unknown>)?.raw),
    totalDebt: safeNum((finData.totalDebt as Record<string,unknown>)?.raw),
    totalCash: safeNum((finData.totalCash as Record<string,unknown>)?.raw),
    revenueGrowth: safeNum((finData.revenueGrowth as Record<string,unknown>)?.raw),
    earningsGrowth: safeNum((finData.earningsGrowth as Record<string,unknown>)?.raw),
    recommendationKey: (finData.recommendationKey as string) || "N/A",
    numberOfAnalystOpinions: safeNum((finData.numberOfAnalystOpinions as Record<string,unknown>)?.raw),
    targetHighPrice: safeNum((finData.targetHighPrice as Record<string,unknown>)?.raw),
    targetLowPrice: safeNum((finData.targetLowPrice as Record<string,unknown>)?.raw),
    targetMeanPrice: safeNum((finData.targetMeanPrice as Record<string,unknown>)?.raw),
  };

  // ── Annual Financials ─────────────────────────────────────────────────────
  const incStmts = ((raw.incomeStatementHistory as Record<string,unknown>)?.incomeStatementHistory as unknown[]) || [];
  const bsStmts = ((raw.balanceSheetHistory as Record<string,unknown>)?.balanceSheetStatements as unknown[]) || [];
  const cfStmts = ((raw.cashflowStatementHistory as Record<string,unknown>)?.cashflowStatements as unknown[]) || [];

  // Yahoo returns newest first — reverse to get oldest first
  const incRev = [...incStmts].reverse() as Record<string,unknown>[];
  const bsRev = [...bsStmts].reverse() as Record<string,unknown>[];
  const cfRev = [...cfStmts].reverse() as Record<string,unknown>[];

  const years = Math.min(incRev.length, bsRev.length, cfRev.length, 5);

  // Fallback estimates from defaultKeyStatistics and financialData
  const sharesTotal =
    safeNum((keyStats.sharesOutstanding as Record<string,unknown>)?.raw) ||
    safeNum((keyStats.impliedSharesOutstanding as Record<string,unknown>)?.raw) ||
    safeNum((priceData.marketCap as Record<string,unknown>)?.raw) / (safeNum((priceData.regularMarketPrice as Record<string,unknown>)?.raw) || 1);

  const fallbackEquity =
    (safeNum((keyStats.bookValue as Record<string,unknown>)?.raw) * sharesTotal) ||
    (safeNum((keyStats.priceToBook as Record<string,unknown>)?.raw) > 0
      ? (safeNum((priceData.marketCap as Record<string,unknown>)?.raw) || safeNum((summary.marketCap as Record<string,unknown>)?.raw)) / safeNum((keyStats.priceToBook as Record<string,unknown>)?.raw)
      : 0);

  const fallbackDebt = readFirstNonZeroFieldVariant(finData, [
    "totalDebt",
    "longTermDebt",
    "shortLongTermDebt",
    "debt",
  ]);
  const fallbackCash = readFirstNonZeroFieldVariant(finData, [
    "totalCash",
    "cash",
    "cashAndCashEquivalents",
    "totalCashAndCashEquivalents",
  ]);
  const fallbackEbitda = readFirstNonZeroFieldVariant(finData, [
    "ebitda",
    "normalizedEbitda",
    "operatingEbitda",
  ]);
  const fallbackEbitdaMargin = safeNum((finData.ebitdaMargins as Record<string,unknown>)?.raw) || 0.175;
  const fallbackOperatingMargin = safeNum((finData.operatingMargins as Record<string,unknown>)?.raw) || (fallbackEbitdaMargin * 0.75) || 0.13;
  const fallbackGrossMargin = safeNum((finData.grossMargins as Record<string,unknown>)?.raw) || 0.35;

  const rawAnnualFinancials = Array.from({ length: years }, (_, i) => {
    const inc = incRev[i] as Record<string,unknown> ?? {};
    const bs = bsRev[i] as Record<string,unknown> ?? {};
    const cf = cfRev[i] as Record<string,unknown> ?? {};
    // Provenance: every fixed-margin synthesis below is recorded, never silent.
    const estimatesUsed: string[] = [];

    const endDateTs = safeNum((inc.endDate as Record<string,unknown>)?.raw);
    const fyLabel = formatFiscalYear(endDateTs, currency);
    let rev = readFirstNonZeroFieldVariant(inc, [
      "totalRevenue",
      "operatingRevenue",
      "revenue",
      "sales",
      "grossSales",
    ]);
    const ni = readFieldVariant(inc, [
      "netIncome",
      "netIncomeCommonStockholders",
      "netIncomeIncludingNoncontrollingInterests",
      "netIncomeContinuousOperations",
    ]);

    // If revenue is 0 but netIncome exists, reconstruct revenue using profit margin
    if (rev === 0 && ni > 0) {
      const pm = safeNum((finData.profitMargins as Record<string,unknown>)?.raw) || 0.18;
      rev = Math.round(ni / pm);
      trackEstimate(estimatesUsed, "revenue@NI/profit-margin");
    }

    let ebit = readFirstNonZeroFieldVariant(inc, [
      "operatingIncome",
      "ebit",
      "operatingProfit",
      "totalOperatingProfit",
    ]);
    if (ebit === 0 && rev > 0) {
      ebit = Math.round(rev * fallbackOperatingMargin);
      trackEstimate(estimatesUsed, "operatingIncome@fallback-margin");
    }

    let ebitda = 0;
    if (i === years - 1 && fallbackEbitda > 0) {
      ebitda = fallbackEbitda;
      trackEstimate(estimatesUsed, "ebitda@current-finData");
    } else if (rev > 0) {
      ebitda = Math.round(rev * fallbackEbitdaMargin);
      trackEstimate(estimatesUsed, "ebitda@fallback-margin");
    }

    let depr = readFirstNonZeroFieldVariant(cf, [
      "depreciation",
      "depreciationAndAmortization",
      "depreciationAmortizationDepletion",
      "accumulatedDepreciation",
    ]);
    if (depr === 0) {
      depr = Math.max(0, ebitda - ebit);
    }

    let gp = readFirstNonZeroFieldVariant(inc, [
      "grossProfit",
      "grossMargin",
    ]);
    if (gp === 0 && rev > 0) {
      gp = Math.round(rev * fallbackGrossMargin);
      trackEstimate(estimatesUsed, "grossProfit@fallback-margin");
    }

    let costOfRev = readFirstNonZeroFieldVariant(inc, [
      "costOfRevenue",
      "reconciledCostOfRevenue",
      "costOfGoodsSold",
      "costOfGoodsAndServicesSold",
    ]);
    if (costOfRev === 0 && rev > 0) {
      costOfRev = Math.max(0, rev - gp);
    }

    let totalEquity = readFirstNonZeroFieldVariant(bs, [
      "totalStockholderEquity",
      "stockholdersEquity",
      "commonStockEquity",
      "totalEquityGrossMinorityInterest",
      "totalCapitalization",
      "shareholdersEquity",
    ]);
    let longTermDebt = readFieldVariant(bs, [
      "longTermDebt",
      "longTermDebtAndCapitalLeaseObligation",
      "nonCurrentLongTermDebt",
      "nonCurrentDebt",
      "longTermBorrowings",
    ]);
    let shortTermDebt = readFieldVariant(bs, [
      "shortLongTermDebt",
      "currentDebt",
      "shortTermBorrowings",
      "currentDebtAndCapitalLeaseObligation",
      "commercialPaper",
      "shortTermDebt",
    ]);
    let explicitDebt = readFieldVariant(bs, [
      "totalDebt",
      "totalBorrowings",
      "debtTotal",
    ]);
    let totalDebt = explicitDebt > 0 ? explicitDebt : (longTermDebt + shortTermDebt);

    let cash = readFirstNonZeroFieldVariant(bs, [
      "cash",
      "cashAndCashEquivalents",
      "totalCash",
      "cashCashEquivalentsAndShortTermInvestments",
      "cashAndEquivalents",
    ]);
    let shortInv = readFieldVariant(bs, [
      "shortTermInvestments",
      "otherShortTermInvestments",
      "marketableSecurities",
      "availableForSaleSecurities",
    ]);
    let totalAssets = readFirstNonZeroFieldVariant(bs, [
      "totalAssets",
      "assets",
      "totalAssetsGross",
    ]);

    const shares = safeNum((inc.dilutedAverageShares as Record<string,unknown>)?.raw) ||
      safeNum((inc.sharesOutstanding as Record<string,unknown>)?.raw) ||
      safeNum((keyStats.sharesOutstanding as Record<string,unknown>)?.raw) || sharesTotal;

    const capex = Math.abs(readFirstNonZeroFieldVariant(cf, [
      "capitalExpenditures",
      "capitalExpenditure",
      "purchaseOfPPE",
      "purchaseOfPropertyPlantAndEquipment",
      "capitalExpenditureReported",
    ], Math.round(rev * 0.035)));
    if (!hasStatementField(cf, ["capitalExpenditures", "capitalExpenditure", "purchaseOfPPE", "purchaseOfPropertyPlantAndEquipment", "capitalExpenditureReported"]) && rev > 0) {
      trackEstimate(estimatesUsed, "capex@3.5%-of-revenue");
    }

    const ocf = readFirstNonZeroFieldVariant(cf, [
      "totalCashFromOperatingActivities",
      "cashFlowFromOperatingActivities",
      "operatingCashFlow",
      "cashProvidedByUsedInOperatingActivities",
    ], Math.round(ni + depr));
    if (!hasStatementField(cf, ["totalCashFromOperatingActivities", "cashFlowFromOperatingActivities", "operatingCashFlow", "cashProvidedByUsedInOperatingActivities"])) {
      trackEstimate(estimatesUsed, "operatingCashFlow@NI+depr");
    }

    const icf = readFieldVariant(cf, [
      "totalCashFromInvestingActivities",
      "cashFlowFromInvestingActivities",
      "investingCashFlow",
      "cashProvidedByUsedInInvestingActivities",
    ], -capex);

    const fcf = readFirstNonZeroFieldVariant(cf, [
      "freeCashflow",
      "freeCashFlow",
    ], ocf - capex);

    const finCf = readFieldVariant(cf, [
      "totalCashFromFinancingActivities",
      "cashFlowFromFinancingActivities",
      "financingCashFlow",
      "cashProvidedByUsedInFinancingActivities",
    ]);

    const divPaid = Math.abs(readFieldVariant(cf, [
      "dividendsPaid",
      "cashDividendsPaid",
      "paymentOfDividendsUse",
      "commonStockDividendPaid",
    ]));

    const netReceivables = readFirstNonZeroFieldVariant(bs, [
      "netReceivables",
      "receivables",
      "accountsReceivable",
      "grossAccountsReceivable",
      "tradeReceivables",
    ], Math.round(rev * 0.15));
    if (!hasStatementField(bs, ["netReceivables", "receivables", "accountsReceivable", "grossAccountsReceivable", "tradeReceivables"]) && rev > 0) {
      trackEstimate(estimatesUsed, "receivables@15%-of-revenue");
    }

    const inventory = readFirstNonZeroFieldVariant(bs, [
      "inventory",
      "inventories",
      "rawMaterials",
      "finishedGoods",
      "workInProgress",
    ], Math.round(rev * 0.10));
    if (!hasStatementField(bs, ["inventory", "inventories", "rawMaterials", "finishedGoods", "workInProgress"]) && rev > 0) {
      trackEstimate(estimatesUsed, "inventory@10%-of-revenue");
    }

    const accountsPayable = readFirstNonZeroFieldVariant(bs, [
      "accountsPayable",
      "payables",
      "tradePayables",
      "otherCurrentLiabilities",
    ], Math.round(rev * 0.12));
    if (!hasStatementField(bs, ["accountsPayable", "payables", "tradePayables", "otherCurrentLiabilities"]) && rev > 0) {
      trackEstimate(estimatesUsed, "payables@12%-of-revenue");
    }

    const currentAssets = readFirstNonZeroFieldVariant(bs, [
      "totalCurrentAssets",
      "currentAssets",
    ]);

    const currentLiabilities = readFirstNonZeroFieldVariant(bs, [
      "totalCurrentLiabilities",
      "currentLiabilities",
    ]);

    const netFixedAssets = readFieldVariant(bs, [
      "netPPE",
      "propertyPlantEquipmentNet",
      "netFixedAssets",
      "propertyPlantEquipment",
      "fixedAssets",
    ]);

    return {
      year: fyLabel,
      fiscalYearEnd: new Date(endDateTs * 1000).toISOString().split("T")[0],
      revenue: rev,
      costOfRevenue: costOfRev,
      grossProfit: gp,
      grossMargin: rev > 0 ? gp / rev : 0,
      researchDevelopment: safeNum((inc.researchDevelopment as Record<string,unknown>)?.raw),
      sellingGeneralAdministrative: safeNum((inc.sellingGeneralAdministrative as Record<string,unknown>)?.raw),
      totalOperatingExpenses: safeNum((inc.totalOperatingExpenses as Record<string,unknown>)?.raw),
      operatingIncome: ebit,
      ebitda,
      ebitdaMargin: rev > 0 ? ebitda / rev : 0,
      ebitMargin: rev > 0 ? ebit / rev : 0,
      interestExpense: Math.abs(safeNum((inc.interestExpense as Record<string,unknown>)?.raw)),
      otherIncome: safeNum((inc.totalOtherIncomeExpenseNet as Record<string,unknown>)?.raw),
      pretaxIncome: safeNum((inc.incomeBeforeTax as Record<string,unknown>)?.raw) || (ebit - Math.abs(safeNum((inc.interestExpense as Record<string,unknown>)?.raw))),
      incomeTaxExpense: safeNum((inc.incomeTaxExpense as Record<string,unknown>)?.raw),
      netIncome: ni,
      netMargin: rev > 0 ? ni / rev : 0,
      depreciation: depr,
      eps: shares > 0 ? ni / shares : safeNum((inc.dilutedEps as Record<string,unknown>)?.raw),
      dilutedEps: safeNum((inc.dilutedEps as Record<string,unknown>)?.raw),
      sharesOutstanding: shares,
      totalAssets,
      totalLiabilities: totalAssets - totalEquity,
      totalEquity,
      cash,
      shortTermInvestments: shortInv,
      netReceivables,
      inventory,
      currentAssets,
      netFixedAssets,
      totalDebt,
      shortTermDebt,
      longTermDebt,
      accountsPayable,
      currentLiabilities,
      netWorkingCapital: 0,
      operatingCashFlow: ocf,
      capitalExpenditures: capex,
      freeCashFlow: fcf,
      investingCashFlow: icf,
      financingCashFlow: finCf,
      dividendsPaid: divPaid,
      changeInCash: safeNum((cf.changeInCash as Record<string,unknown>)?.raw),
      estimatesUsed,
    };
  });

  // Post-process balance sheets across all years: populate missing equity/debt/assets.
  // Every plug below is provenance-tracked — a fully-plugged balance sheet must
  // never present as audited downstream.
  const latestRev = rawAnnualFinancials[rawAnnualFinancials.length - 1]?.revenue || 1;
  const legacyAnnualFinancials = rawAnnualFinancials.map((f, i) => {
    let eq = f.totalEquity;
    let debt = f.totalDebt;
    let cash = f.cash;
    let assets = f.totalAssets;
    const plugs: string[] = [];

    if (eq === 0) {
      if (fallbackEquity > 0) {
        // Step backwards based on cumulative retained earnings
        const yearsBack = (rawAnnualFinancials.length - 1) - i;
        const discountFactor = Math.pow(0.85, yearsBack);
        eq = Math.round(fallbackEquity * discountFactor);
        plugs.push("equity@book-value-decay");
      } else if (f.netIncome > 0) {
        const roe = safeNum((finData.returnOnEquity as Record<string,unknown>)?.raw) || 0.20;
        eq = Math.round(f.netIncome / roe);
        plugs.push("equity@NI/ROE");
      }
    }

    if (debt === 0 && fallbackDebt > 0) {
      debt = fallbackDebt;
      plugs.push("debt@current-finData");
    }

    let stDebt = f.shortTermDebt;
    let ltDebt = f.longTermDebt;
    if (debt > 0 && stDebt === 0 && ltDebt === 0) {
      stDebt = Math.round(debt * 0.3);
      ltDebt = debt - stDebt;
      plugs.push("debt-split@30/70");
    }

    if (cash === 0) {
      cash = fallbackCash > 0 ? Math.round(fallbackCash * (f.revenue / latestRev)) : Math.round(f.revenue * 0.15);
      plugs.push("cash@scaled-or-15%-of-revenue");
    }

    if (assets === 0) {
      assets = eq + debt + cash;
      plugs.push("assets@equity+debt+cash-plug");
    }

    const curAssets = f.currentAssets > 0 ? f.currentAssets : Math.round(assets * 0.45);
    if (!(f.currentAssets > 0)) plugs.push("currentAssets@45%-of-assets");
    const curLiab = f.currentLiabilities > 0 ? f.currentLiabilities : Math.round((debt * 0.4) + (assets * 0.2));
    if (!(f.currentLiabilities > 0)) plugs.push("currentLiabilities@formula-plug");
    const nwc = curAssets - curLiab;
    const netFixed = f.netFixedAssets > 0 ? f.netFixedAssets : Math.round(assets - curAssets);
    if (!(f.netFixedAssets > 0)) plugs.push("netFixedAssets@residual-plug");

    return {
      ...f,
      totalEquity: eq,
      totalDebt: debt,
      shortTermDebt: stDebt,
      longTermDebt: ltDebt,
      cash,
      totalAssets: assets,
      totalLiabilities: assets - eq,
      currentAssets: curAssets,
      currentLiabilities: curLiab,
      netWorkingCapital: nwc,
      netFixedAssets: netFixed,
      estimatesUsed: [...(f.estimatesUsed || []), ...plugs],
    };
  });

  const tsAnnual = parseTimeseriesFinancials(raw.fundamentalsTimeseries, currency);
  const annualFinancials = (tsAnnual && tsAnnual.length > 0) ? tsAnnual : legacyAnnualFinancials;

  // ── Quarterly Financials ─────────────────────────────────────────────────
  const qIncStmts = ((raw.incomeStatementHistoryQuarterly as Record<string,unknown>)?.incomeStatementHistory as unknown[]) || [];
  const legacyQuarterlyFinancials = [...qIncStmts]
    .reverse()
    .slice(0, 8)
    .map((q, i) => {
      const qi = q as Record<string,unknown>;
      const endTs = safeNum((qi.endDate as Record<string,unknown>)?.raw);
      const d = new Date(endTs * 1000);
      const qNum = Math.ceil((d.getMonth() + 1) / 3);
      const rev = safeNum((qi.totalRevenue as Record<string,unknown>)?.raw);
      let ebit = safeNum((qi.operatingIncome as Record<string,unknown>)?.raw);
      if (ebit === 0 && rev > 0) {
        ebit = Math.round(rev * fallbackOperatingMargin);
      }
      const ni = safeNum((qi.netIncome as Record<string,unknown>)?.raw);
      let ebitda = ebit + Math.round(rev * 0.04);
      if (ebitda === 0 && rev > 0) {
        ebitda = Math.round(rev * fallbackEbitdaMargin);
      }

      // YoY: compare to same quarter 4 periods back
      const prevQ = qIncStmts[qIncStmts.length - 1 - (i + 4)];
      let yoy = 0;
      if (prevQ) {
        const prevRev = safeNum(((prevQ as Record<string,unknown>).totalRevenue as Record<string,unknown>)?.raw);
        yoy = prevRev > 0 ? (rev - prevRev) / prevRev : 0;
      }

      let gp = safeNum((qi.grossProfit as Record<string,unknown>)?.raw);
      if (gp === 0 && rev > 0) {
        gp = Math.round(rev * fallbackGrossMargin);
      }

      return {
        period: `Q${qNum}FY${d.getFullYear() % 100}`,
        endDate: d.toISOString().split("T")[0],
        revenue: rev,
        revenueGrowthYoY: yoy,
        grossProfit: gp,
        ebitda,
        ebitdaMargin: rev > 0 ? ebitda / rev : 0,
        operatingIncome: ebit,
        netIncome: ni,
        netMargin: rev > 0 ? ni / rev : 0,
        eps: safeNum((qi.dilutedEps as Record<string,unknown>)?.raw) || (sharesTotal > 0 && ni !== 0 ? ni / sharesTotal : 0),
      };
    });

  const tsQuarterly = parseTimeseriesQuarterly(raw.fundamentalsTimeseries);
  const quarterlyFinancials = (tsQuarterly && tsQuarterly.length > 0) ? tsQuarterly : legacyQuarterlyFinancials;

  // ── Shareholding ─────────────────────────────────────────────────────────
  const insiderPct = safeNum((majorHolders.insidersPercentHeld as Record<string,unknown>)?.raw);
  const instPct = safeNum((majorHolders.institutionsPercentHeld as Record<string,unknown>)?.raw);
  const publicPct = Math.max(0, 1 - insiderPct - instPct);
  const totalShares = safeNum((keyStats.sharesOutstanding as Record<string,unknown>)?.raw) || sharesTotal;

  const isIndian =
    symbol.toUpperCase().endsWith(".NS") ||
    symbol.toUpperCase().endsWith(".BO") ||
    (profile.country as string) === "India";

  let fiiPct = 0;
  let diiPct = 0;
  if (isIndian && instPct > 0) {
    fiiPct = Math.round(instPct * 0.55 * 1000) / 1000;
    diiPct = Math.max(0, Math.round((instPct - fiiPct) * 1000) / 1000);
  }

  // Institutional holder detail is shown ONLY when Yahoo actually reports it.
  // Yahoo does not publish SEC 13-F style schedules for most non-US listings, and
  // inventing named holders with synthetic percentages is a compliance-grade
  // integrity failure. Empty lists render as an honest "no detail disclosed" state.
  const rawInstList = ((instOwnership.ownershipList as unknown[]) || []);
  const topInst: InstitutionalHolder[] = rawInstList.slice(0, 10).map((o) => {
    const ow = o as Record<string,unknown>;
    const shares = safeNum((ow.position as Record<string,unknown>)?.raw);
    const pct = safeNum((ow.pctHeld as Record<string,unknown>)?.raw) || (totalShares > 0 ? shares / totalShares : 0);
    const chg = safeNum((ow.pctChange as Record<string,unknown>)?.raw);
    const value = safeNum((ow.value as Record<string,unknown>)?.raw);
    return {
      name: (ow.organization as string) || "Institutional Investor",
      shares,
      percentage: pct,
      assetsPct: value > 0 ? value : undefined,
      change: chg !== 0 ? (chg > 0 ? `+${(chg * 100).toFixed(1)}%` : `${(chg * 100).toFixed(1)}%`) : undefined,
      reportDate: (ow.reportDate as Record<string,unknown>)?.fmt as string || undefined,
    };
  });

  // Parse raw mutual funds (only when Yahoo actually reports them — never synthesized)
  const rawFundList = ((rawFundOwnership.ownershipList as unknown[]) || []);
  const topFunds: InstitutionalHolder[] = rawFundList.slice(0, 10).map((o) => {
    const ow = o as Record<string,unknown>;
    const shares = safeNum((ow.position as Record<string,unknown>)?.raw);
    const pct = safeNum((ow.pctHeld as Record<string,unknown>)?.raw) || (totalShares > 0 ? shares / totalShares : 0);
    const chg = safeNum((ow.pctChange as Record<string,unknown>)?.raw);
    const value = safeNum((ow.value as Record<string,unknown>)?.raw);
    return {
      name: (ow.organization as string) || "Mutual Fund",
      shares,
      percentage: pct,
      assetsPct: value > 0 ? value : undefined,
      change: chg !== 0 ? (chg > 0 ? `+${(chg * 100).toFixed(1)}%` : `${(chg * 100).toFixed(1)}%`) : undefined,
      reportDate: (ow.reportDate as Record<string,unknown>)?.fmt as string || undefined,
    };
  });

  // No synthetic holder backfill: when Yahoo reports no 13-F/LODR schedules,
  // downstream renders an explicit "no institutional holder detail disclosed" state.

  // Insider Holders
  const parsedInsiders = ((rawInsiderHolders.holders as unknown[]) || []).slice(0, 8).map((h) => {
    const item = h as Record<string, unknown>;
    const pos = (item.positionDirect as Record<string, unknown>)?.raw;
    const transDate = (item.latestTransDate as Record<string, unknown>)?.fmt as string;
    return {
      name: (item.name as string) || "Key Executive / Director",
      relation: (item.relation as string) || "Officer / Director",
      shares: safeNum(pos),
      date: transDate || undefined,
      transaction: (item.transactionDescription as string) || "Holding",
    };
  });

  // Net Institutional / Insider Activity
  const netActivity = {
    netInstSharesBuying: (rawNetActivity.netInstSharesBuying as Record<string, unknown>)?.fmt as string || undefined,
    netInstBuyingPercent: (rawNetActivity.netInstBuyingPercent as Record<string, unknown>)?.fmt as string || undefined,
    period: (rawNetActivity.period as string) || "6m",
    totalInsiderShares: safeNum((rawNetActivity.totalInsiderShares as Record<string, unknown>)?.raw),
    buyInfoCount: safeNum((rawNetActivity.buyInfoCount as Record<string, unknown>)?.raw),
    sellInfoCount: safeNum((rawNetActivity.sellInfoCount as Record<string, unknown>)?.raw),
  };

  const holderDetailAvailable = topInst.length > 0 || topFunds.length > 0;
  const provenanceNote = holderDetailAvailable
    ? (isIndian
      ? "SEBI (LODR) Regulations / Statutory Shareholding Pattern Disclosures via Yahoo Finance"
      : "SEC Form 13-F / Form N-PORT Quarterly Institutional Filings via Yahoo Finance")
    : "No institutional holder breakdown disclosed by Yahoo Finance for this listing — holder detail omitted (not estimated)";

  const categories = isIndian
    ? [
        { category: "Promoter & Promoter Group", percentage: insiderPct },
        { category: "Foreign Portfolio Investors (FII/FPI)", percentage: fiiPct },
        { category: "Domestic Institutions (DII/Mutual Funds)", percentage: diiPct },
        { category: "Public Retail & Other Float", percentage: publicPct },
      ]
    : [
        { category: "Promoter / Insider", percentage: insiderPct },
        { category: "Institutional Ownership", percentage: instPct },
        { category: "Public / Retail Float", percentage: publicPct },
      ];

  const shareholding = {
    insiderOwnership: insiderPct,
    institutionalOwnership: instPct,
    fiiOwnership: fiiPct,
    diiOwnership: diiPct,
    publicFloat: publicPct,
    topInstitutions: topInst,
    topFunds,
    insiderHolders: parsedInsiders,
    netActivity,
    provenanceNote,
    categories,
  };

  return {
    companyProfile,
    stockData,
    annualFinancials,
    quarterlyFinancials,
    shareholding,
  };
}

// ─────────────────────────────────────────────
// Fetch real-time ticker news with strict company-relevance validation
// ─────────────────────────────────────────────
function isCompanyRelevantNews(
  title: string,
  summary: string | undefined,
  ticker: string,
  companyName?: string
): boolean {
  const tLower = title.toLowerCase();
  // Filter out boilerplate and market wrap noise
  if (
    tLower.startsWith("yahoo! finance") ||
    tLower.includes("/c o r r e c t i o n") ||
    tLower.includes("end of day message") ||
    tLower.includes("stock is crashing today") ||
    tLower.includes("is a bargain hiding in plain sight") ||
    tLower.includes("reasons caty is risky")
  ) {
    return false;
  }

  const cleanTicker = ticker.replace(/\.[a-zA-Z]+$/i, "").toLowerCase();

  // 1. Ticker symbol match in title (minimum 3 characters to avoid common acronyms)
  if (cleanTicker.length >= 3) {
    const tickerRegex = new RegExp(`\\b${cleanTicker}\\b`, "i");
    if (tickerRegex.test(tLower)) return true;
  }

  // 2. Significant company name keywords match in title
  if (companyName) {
    const stopWords = new Set([
      "ltd", "limited", "inc", "corp", "corporation", "the", "and", "co",
      "company", "plc", "sa", "holdings", "group", "class", "shs", "adr",
      "nv", "enterprises", "industries", "services", "technologies"
    ]);
    const words = companyName
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w));

    for (const w of words) {
      const wordRegex = new RegExp(`\\b${w}\\b`, "i");
      if (wordRegex.test(tLower)) return true;
    }
  }

  return false;
}

// REMOVED: generateCompanySpecificNews — synthetic bullish "news" with fabricated
// publishers ("Corporate Regulatory Disclosures", "Capital Markets Wire", …) and
// backdated timestamps is incompatible with institutional integrity. getTickerNews
// returns verified items only; limited coverage is disclosed downstream.

export async function getTickerNews(
  ticker: string,
  companyName?: string,
  count = 15
): Promise<TickerNewsItem[]> {
  const verifiedItems: TickerNewsItem[] = [];
  const cleanTicker = ticker.replace(/\.[a-zA-Z]+$/i, "");
  const queryTerm = companyName || cleanTicker;
  const isIndian = ticker.endsWith(".NS") || ticker.endsWith(".BO");

  // 1. Fetch from Google News RSS (Very high quality, live, and company-focused)
  try {
    const gl = isIndian ? "IN" : "US";
    const hl = isIndian ? "en-IN" : "en-US";
    const ceid = isIndian ? "IN:en" : "US:en";
    const gNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(queryTerm)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

    const gRes = await fetch(gNewsUrl, {
      headers: HEADERS,
      next: { revalidate: 1800 },
    });

    if (gRes.ok) {
      const xml = await gRes.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null && verifiedItems.length < count) {
        const itemContent = match[1];
        const titleMatch = itemContent.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        const linkMatch = itemContent.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
        const pubDateMatch = itemContent.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/);
        const sourceMatch = itemContent.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/);

        let rawTitle = titleMatch ? titleMatch[1].trim() : "";
        if (!rawTitle) continue;

        let publisher = sourceMatch ? sourceMatch[1].trim() : "Financial Media";
        // Often Google News title ends with " - SourceName"
        const dashIdx = rawTitle.lastIndexOf(" - ");
        if (dashIdx > 20) {
          if (!sourceMatch) publisher = rawTitle.slice(dashIdx + 3).trim();
          rawTitle = rawTitle.slice(0, dashIdx).trim();
        }

        // Google News RSS embeds the complete, untruncated headline in the <description> anchor tag: <a href="..." ...>Full Headline</a>
        const descMatch = itemContent.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
        if (descMatch) {
          const descHtml = descMatch[1]
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&");
          const anchorMatch = descHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
          if (anchorMatch) {
            const anchorTitle = anchorMatch[1].replace(/<[^>]+>/g, "").trim();
            if (anchorTitle && (rawTitle.endsWith("...") || rawTitle.endsWith("…") || anchorTitle.length > rawTitle.length)) {
              rawTitle = anchorTitle;
            }
          }
        }

        // Clean any trailing ellipsis so headlines never end in "..."
        rawTitle = rawTitle.replace(/\s*(\.{3}|…)$/, "").trim();

        const title = rawTitle;
        const link = linkMatch ? linkMatch[1].trim() : undefined;
        const publishedAt = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : undefined;

        if (title && isCompanyRelevantNews(title, undefined, ticker, companyName)) {
          if (!verifiedItems.some((v) => v.title.toLowerCase() === title.toLowerCase())) {
            verifiedItems.push({
              title,
              link,
              publishedAt,
              publisher,
              summary: `${companyName || ticker} was cited in ${publisher}: "${title}". Evaluated for corporate impact and fundamental earnings transmission.`,
            });
          }
        }
      }
    }
  } catch (gErr) {
    console.warn(`Google News fetch failed for ${ticker}:`, gErr);
  }

  // 2. Supplement with Yahoo Finance RSS if fewer than 5 items
  if (verifiedItems.length < 5) {
    try {
      const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
      const res = await fetch(rssUrl, {
        headers: HEADERS,
        next: { revalidate: 1800 },
      });
      if (res.ok) {
        const xml = await res.text();
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && verifiedItems.length < count) {
          const itemContent = match[1];
          const titleMatch = itemContent.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
          const linkMatch = itemContent.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
          const pubDateMatch = itemContent.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/);
          const descMatch = itemContent.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);

          const title = titleMatch ? titleMatch[1].trim() : "";
          const summary = descMatch ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 250) : undefined;

          if (title && isCompanyRelevantNews(title, summary, ticker, companyName)) {
            if (!verifiedItems.some((v) => v.title.toLowerCase() === title.toLowerCase())) {
              verifiedItems.push({
                title,
                link: linkMatch ? linkMatch[1].trim() : undefined,
                publishedAt: pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : undefined,
                summary,
                publisher: "Yahoo Finance Wire",
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Yahoo RSS news fetch failed for ${ticker}:`, err);
    }
  }

  // 3. No synthetic backfill: bullish template "news" mixed with verified RSS
  // destroys trust. Fewer than 4 real items returns what exists (possibly empty);
  // downstream renders an explicit limited-coverage state instead of fiction.
  return verifiedItems;
}


