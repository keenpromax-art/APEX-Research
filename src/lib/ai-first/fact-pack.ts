/**
 * APEX RESEARCH — AI-FIRST FACT PACK
 *
 * Clean factual ingestion layer. YFINANCE is the ONLY authoritative source.
 * No hardcoded facts, no manufactured values, no zero-filling (Principle 24).
 * Every fact: { value, metric, period, currency, source, ticker, retrievalTimestamp }.
 */
import type { Fact, FactPack, FactSection } from "./types";

const FACT_PACK_VERSION = "1.0.0";

function nowIso(): string {
  return new Date().toISOString();
}

function fact(
  ticker: string,
  metric: string,
  label: string,
  period: string,
  value: number | undefined,
  currency?: string,
  unit?: string,
  derivedFrom?: string[]
): Fact {
  const v = typeof value === "number" && isFinite(value) ? value : undefined;
  return {
    metric,
    label,
    value: v,
    period,
    currency,
    unit,
    source: derivedFrom?.length ? "derived" : "yfinance",
    ticker,
    retrievalTimestamp: nowIso(),
    ...(derivedFrom?.length ? { derivedFrom } : {}),
  };
}

function textFact(ticker: string, metric: string, label: string, textValue: string | undefined): Fact {
  return {
    metric,
    label,
    textValue: textValue || undefined,
    period: "current",
    source: "yfinance",
    ticker,
    retrievalTimestamp: nowIso(),
  };
}

interface RawRow {
  [k: string]: unknown;
}

/** Yahoo financial rows: [{ endDate: {fmt}, field: { raw } }]. null/NaN -> undefined. */
function readYahooRows(
  rows: RawRow[] | undefined | null
): Array<{ period: string; values: Record<string, number | undefined> }> {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const end = (row as any).endDate || (row as any).reportDate || (row as any).asOfDate;
    const period = String(end?.fmt || end?.raw || "");
    const values: Record<string, number | undefined> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "endDate" || k === "reportDate" || k === "asOfDate" || k === "maxAge") continue;
      if (v && typeof v === "object" && "raw" in (v as any)) {
        const raw = (v as any).raw;
        values[k] = typeof raw === "number" && isFinite(raw) ? raw : undefined;
      }
    }
    return { period, values };
  });
}

function readFirstRaw(v: unknown): number | undefined {
  if (v && typeof v === "object" && "raw" in (v as any)) {
    const raw = (v as any).raw;
    return typeof raw === "number" && isFinite(raw) ? raw : undefined;
  }
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

function section(name: string, facts: Fact[], raw?: unknown): FactSection {
  return { name, facts, ...(raw !== undefined ? { raw } : {}) };
}

/**
 * Build the canonical fact pack from the raw Yahoo quoteSummary payload
 * (the payload `fetchQuoteSummary` returns, including fundamentalsTimeseries).
 */
export function buildFactPack(rawQuoteSummary: Record<string, unknown>, ticker: string): FactPack {
  const t = ticker.toUpperCase();
  const ts = nowIso();
  const q = rawQuoteSummary as Record<string, any>;

  const assetProfile = q.assetProfile || {};
  const price = q.price || {};
  const summaryDetail = q.summaryDetail || {};
  const financialData = q.financialData || {};
  const keyStats = q.defaultKeyStatistics || {};

  const companyFacts: Fact[] = [
    textFact(t, "companyName", "Company name", String(price.longName || price.shortName || t)),
    textFact(t, "description", "Business description", String(assetProfile.longBusinessSummary || "").trim() || undefined),
    textFact(t, "sector", "Sector (Yahoo classification)", String(assetProfile.sector || "").trim() || undefined),
    textFact(t, "industry", "Industry (Yahoo classification)", String(assetProfile.industry || "").trim() || undefined),
    textFact(t, "country", "Country", String(assetProfile.country || "").trim() || undefined),
  ];

  const currency = String(price.currency || financialData.financialCurrency || "") || undefined;
  const marketFacts: Fact[] = [
    fact(t, "currentPrice", "Current price", "current", readFirstRaw(price.regularMarketPrice), currency),
    fact(t, "marketCap", "Market cap", "current", readFirstRaw(price.marketCap), currency),
    fact(t, "sharesOutstanding", "Shares outstanding", "current", readFirstRaw(keyStats.sharesOutstanding), undefined, "shares"),
    fact(t, "floatShares", "Float shares", "current", readFirstRaw(keyStats.floatShares), undefined, "shares"),
    fact(t, "beta", "Beta (5Y monthly)", "current", readFirstRaw(summaryDetail.beta)),
    fact(t, "bookValuePerShare", "Book value per share", "current", readFirstRaw(keyStats.bookValue), currency),
    fact(t, "trailingPE", "Trailing P/E", "current", readFirstRaw(summaryDetail.trailingPE)),
    fact(t, "forwardPE", "Forward P/E", "current", readFirstRaw(summaryDetail.forwardPE)),
    fact(t, "priceToBook", "Price-to-book", "current", readFirstRaw(keyStats.priceToBook || summaryDetail.priceToBook)),
    fact(t, "enterpriseValue", "Enterprise value", "current", readFirstRaw(financialData.enterpriseValue || summaryDetail.enterpriseValue), currency),
    fact(t, "dividendYield", "Dividend yield", "current", readFirstRaw(summaryDetail.dividendYield), undefined, "%"),
    fact(t, "dividendRate", "Dividend rate", "current", readFirstRaw(summaryDetail.dividendRate), currency),
    fact(t, "targetMeanPrice", "Street target mean", "current", readFirstRaw(financialData.targetMeanPrice), currency),
    fact(t, "numberOfAnalystOpinions", "Analyst opinions", "current", readFirstRaw(financialData.numberOfAnalystOpinions)),
  ];
  const recKey = String(financialData.recommendationKey || "").trim();
  if (recKey) {
    marketFacts.push(textFact(t, "recommendationKey", "Street recommendation", recKey));
  }

  // ── Income statement history (per-year rows, sparse) ──────
  const incomeHistory = readYahooRows(q.incomeStatementHistory?.incomeStatementHistory);
  const incomeFacts: Fact[] = [];
  for (const row of incomeHistory) {
    for (const [k, v] of Object.entries(row.values)) {
      incomeFacts.push(fact(t, k, humanizeRowKey(k), row.period, v, currency));
    }
  }

  // ── Balance sheet history ────────────────────────────────
  const balanceHistory = readYahooRows(q.balanceSheetHistory?.balanceSheetHistory);
  const balanceFacts: Fact[] = [];
  for (const row of balanceHistory) {
    for (const [k, v] of Object.entries(row.values)) {
      balanceFacts.push(fact(t, k, humanizeRowKey(k), row.period, v, currency));
    }
  }

  // ── Cash flow history ────────────────────────────────────
  const cashflowHistory = readYahooRows(q.cashflowStatementHistory?.cashflowStatementHistory);
  const cashflowFacts: Fact[] = [];
  for (const row of cashflowHistory) {
    for (const [k, v] of Object.entries(row.values)) {
      cashflowFacts.push(fact(t, k, humanizeRowKey(k), row.period, v, currency));
    }
  }

  // ── Earnings / estimates (earningsTrend rows) ────────────
  const trendRows = Array.isArray(q.earningsTrend?.trend) ? q.earningsTrend.trend : [];
  const estimatesFacts: Fact[] = [];
  for (const row of trendRows) {
    const period = String(row?.period || row?.endDate?.fmt || "");
    const growth = row?.growth;
    const epsAvg = row?.earningsEstimate?.avg;
    const revAvg = row?.revenueEstimate?.avg;
    if (growth && typeof growth === "object" && isFinite(growth.raw)) {
      estimatesFacts.push(fact(t, `epsGrowthEstimate_${period}`, `EPS growth estimate (${period})`, period, growth.raw, undefined, "%"));
    }
    if (epsAvg && typeof epsAvg === "object" && isFinite(epsAvg.raw)) {
      estimatesFacts.push(fact(t, `epsEstimate_${period}`, `EPS estimate (${period})`, period, epsAvg.raw, currency));
    }
    if (revAvg && typeof revAvg === "object" && isFinite(revAvg.raw)) {
      estimatesFacts.push(fact(t, `revenueEstimate_${period}`, `Revenue estimate (${period})`, period, revAvg.raw, currency));
    }
  }

  // ── Holders ──────────────────────────────────────────────
  const holdersRaw = q.majorHoldersBreakdown || {};
  const holderFacts: Fact[] = [
    fact(t, "insidersPercentHeld", "Insider percent held", "current", readFirstRaw(holdersRaw.insidersPercentHeld), undefined, "%"),
    fact(t, "institutionsPercentHeld", "Institutions percent held", "current", readFirstRaw(holdersRaw.institutionsPercentHeld), undefined, "%"),
    fact(t, "institutionsFloatPercentHeld", "Institutions % of float held", "current", readFirstRaw(holdersRaw.institutionsFloatPercentHeld), undefined, "%"),
  ];

  return {
    ticker: t,
    company: section("company", companyFacts, assetProfile),
    market: section("market", marketFacts, { price, summaryDetail, financialData, keyStats }),
    incomeStatement: section("incomeStatement", incomeFacts, incomeHistory),
    balanceSheet: section("balanceSheet", balanceFacts, balanceHistory),
    cashFlow: section("cashFlow", cashflowFacts, cashflowHistory),
    shares: section("shares", [fact(t, "sharesOutstanding", "Shares outstanding (statement module)", "current", readFirstRaw(keyStats.sharesOutstanding), undefined, "shares")], keyStats),
    earnings: section("earnings", estimatesFacts.filter((f) => f.metric.startsWith("eps")), q.earningsTrend),
    estimates: section("estimates", estimatesFacts, q.earningsTrend),
    corporateActions: section("corporateActions", [], q.netSharePurchaseActivity),
    priceHistory: section("priceHistory", []),
    holders: section("holders", holderFacts, {
      majorHoldersBreakdown: q.majorHoldersBreakdown,
      institutionOwnership: q.institutionOwnership,
      fundOwnership: q.fundOwnership,
      insiderHolders: q.insiderHolders,
    }),
    retrievalTimestamp: ts,
    version: FACT_PACK_VERSION,
  };
}

/** camelCase Yahoo row key -> readable label. Generic (no sector vocabulary). */
function humanizeRowKey(k: string): string {
  const spaced = k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Flatten a fact pack into prompt-ready context. Compact FACT_CONTEXT
 * (Principle 33): agents receive only what they need, never the raw payload.
 */
export function renderFactContext(pack: FactPack, sectionNames?: string[]): string {
  const wanted = new Set(sectionNames || []);
  const lines: string[] = [
    `CANONICAL FACT PACK — ticker ${pack.ticker} (yfinance, retrieved ${pack.retrievalTimestamp}).`,
    "These are the ONLY historical numbers you may use. Never invent data.",
    "",
  ];
  const sections = [
    pack.company,
    pack.market,
    pack.incomeStatement,
    pack.balanceSheet,
    pack.cashFlow,
    pack.shares,
    pack.earnings,
    pack.estimates,
    pack.corporateActions,
    pack.holders,
  ];
  for (const sec of sections) {
    if (wanted.size > 0 && !wanted.has(sec.name)) continue;
    if (sec.facts.length === 0) continue;
    lines.push(`## ${sec.name}`);
    for (const f of sec.facts) {
      const val =
        f.textValue !== undefined
          ? f.textValue
          : f.value !== undefined
            ? String(f.value)
            : "Not available from yfinance";
      const unit = f.unit ? ` ${f.unit}` : "";
      lines.push(`- [F-${f.metric}] ${f.label}${unit} (${f.period}): ${val}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
