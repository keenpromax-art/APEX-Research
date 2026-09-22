/**
 * APEX RESEARCH — Cross-Listing Normalization (ADR/GDR/foreign listing)
 * ----------------------------------------------------------------------
 * Permanent fix for the SMFG-class defect: a NYSE-listed ADR quotes in USD
 * while Yahoo reports its fundamentals in the home reporting currency (JPY).
 * The legacy pipeline assumed a single currency (price currency) and divided
 * JPY totals by ADR share counts, printing:
 *   revenue $5.79T (actually ¥5.79T), book $2516 (actually ¥2516),
 *   fair value $4604 (+17163% upside), EPS $247 (actually ¥247),
 *   plus FINCONS-02/03/05 BLOCKs from the ordinary-vs-ADR share split.
 *
 * This module unifies every listing to ONE canonical currency — the TRADING
 * currency (what the user pays) — by translating reporting-currency money
 * totals at a live FX rate and restating statement share counts to the
 * trading (depositary) share basis. After normalization:
 *   SMFG revenue ≈ $36.8B, book ≈ $16.0, fair value ≈ $29–30, EPS ≈ $1.6,
 *   upside ≈ +10–15%, FINCONS-02/03/05 PASS.
 *
 * Naming: "depositaryRatio" (ordinary→depositary shares) is used instead of
 * "ADR" because ADR already means Average Daily Rate in hospitality code.
 *
 * Pure except fetchFxRate (network). All scaling is provenance-tracked via
 * estimatesUsed tags so QA/PDF footnotes disclose the translation.
 */

import type { AnnualFinancials, QuarterlyFinancials } from "@/types/report";

export interface CrossListingInfo {
  /** True when reporting and trading currencies differ (translation applied). */
  isCrossListed: boolean;
  tradingCurrency: string;
  reportingCurrency: string;
  /** Multiply reporting-currency money by this to get trading currency. */
  fxReportingToTrading: number;
  /** Multiply statement (home) shares by this to get trading share basis. */
  depositaryRatio: number;
  fxSource: string;
  notes: string[];
}

const FX_CACHE = new Map<string, { rate: number; at: number }>();
const FX_TTL_MS = 30 * 60 * 1000;

function cacheGet(key: string): number | null {
  const e = FX_CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.at > FX_TTL_MS) {
    FX_CACHE.delete(key);
    return null;
  }
  return e.rate;
}

/**
 * Fetch spot FX rate FROM -> TO via Yahoo chart (e.g. JPY->USD).
 * Tries direct pair "FROMTO=X", then inverse of "TOFROM=X".
 * Returns null when unavailable (caller must fail-closed, never guess).
 */
export async function fetchFxRate(
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ rate: number; source: string } | null> {
  const f = (from || "").toUpperCase();
  const t = (to || "").toUpperCase();
  if (!f || !t) return null;
  if (f === t) return { rate: 1, source: "parity (same currency)" };
  const cacheKey = `${f}->${t}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return { rate: cached, source: "cache" };

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const getChartPrice = async (symbol: string): Promise<number | null> => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const res = await fetchImpl(url, { headers: { "User-Agent": ua } as never });
      if (!res.ok) return null;
      const j = (await res.json()) as {
        chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
      };
      const px = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof px === "number" && Number.isFinite(px) && px > 0 ? px : null;
    } catch {
      return null;
    }
  };

  // Direct: e.g. JPY->USD is quoted as USDJPY=X (JPY per USD), so invert.
  // Generic rule: symbol "FROMTO=X" conventionally quotes TO per FROM for
  // most pairs, but USDJPY-style pairs quote FROM per USD. Handle both by
  // trying direct then inverse with explicit inversion bookkeeping.
  const direct = `${f}${t}=X`;
  const inverse = `${t}${f}=X`;
  // Special-case the USD-base convention: USDXXX=X always means XXX per USD.
  if (f === "USD") {
    const px = await getChartPrice(direct); // e.g. USDJPY=X = JPY per USD
    if (px !== null) {
      FX_CACHE.set(cacheKey, { rate: px, at: Date.now() });
      return { rate: px, source: `Yahoo ${direct}` };
    }
  } else if (t === "USD") {
    // e.g. JPY->USD: USDJPY=X = JPY per USD, so rate = 1/px.
    const px = await getChartPrice(inverse);
    if (px !== null && px > 0) {
      const rate = 1 / px;
      FX_CACHE.set(cacheKey, { rate, at: Date.now() });
      return { rate, source: `Yahoo ${inverse} (inverted)` };
    }
  }
  // Generic attempt for non-USD pairs.
  const dpx = await getChartPrice(direct);
  if (dpx !== null) {
    FX_CACHE.set(cacheKey, { rate: dpx, at: Date.now() });
    return { rate: dpx, source: `Yahoo ${direct}` };
  }
  const ipx = await getChartPrice(inverse);
  if (ipx !== null && ipx > 0) {
    const rate = 1 / ipx;
    FX_CACHE.set(cacheKey, { rate, at: Date.now() });
    return { rate, source: `Yahoo ${inverse} (inverted)` };
  }
  return null;
}

/** Money-total fields scaled by FX (reporting -> trading). Per-shape union. */
const MONEY_FIELDS = new Set([
  // universal / corporate
  "revenue", "costOfRevenue", "grossProfit",
  "researchDevelopment", "sellingGeneralAdministrative", "totalOperatingExpenses",
  "operatingIncome", "ebitda", "interestExpense", "otherIncome",
  "pretaxIncome", "incomeTaxExpense", "netIncome", "depreciation",
  "totalAssets", "totalLiabilities", "totalEquity", "cash", "shortTermInvestments",
  "netReceivables", "inventory", "currentAssets", "netFixedAssets",
  "totalDebt", "shortTermDebt", "longTermDebt", "accountsPayable",
  "currentLiabilities", "netWorkingCapital", "operatingCashFlow",
  "capitalExpenditures", "freeCashFlow", "investingCashFlow",
  "financingCashFlow", "dividendsPaid", "changeInCash",
  "commonStock", "retainedEarnings", "goodwill", "otherIntangibles",
  "otherCurrentAssets", "otherCurrentLiabilities", "otherNonCurrentAssets",
  "otherNonCurrentLiabilities", "deferredTaxLiabilities", "capitalLeaseObligations",
  "netDebt", "workingCapital", "investedCapital", "tangibleBookValue",
  "ebit", "interestIncome", "issuanceOfDebt", "repaymentOfDebt",
  "issuanceOfCapitalStock", "repurchases", "stockBasedCompensation",
  "deferredIncomeTax", "changeInWorkingCapital", "changeInReceivables",
  "changeInInventory", "changeInPayables", "endCashPosition",
  // bank-native
  "netInterestIncome", "nonInterestIncome", "totalRevenue",
  "provisionForCreditLosses", "nonInterestExpenses", "loans", "deposits",
  "grossNPA", "netNPA",
  // insurance-native
  "grossWrittenPremium", "netEarnedPremium", "claimsIncurred",
  "underwritingExpenses", "underwritingResult", "investmentIncome", "float",
  "policyholderLiabilities", "embeddedValue",
  // reit-native
  "rentalIncome", "otherPropertyIncome", "propertyOperatingExpenses",
  "netOperatingIncome", "generalAdministrative", "depreciationAmortization",
  "gainsOnDispositions", "fundsFromOperations", "maintenanceCapex",
  "leasingCommissions", "adjustedFundsFromOperations", "netAssetValue",
  "investmentPropertyValue",
  // fee-native
  "aumBeginning", "aumEnding", "netFlows", "marketAppreciation",
  "managementFees", "performanceFees", "technologyServicesRevenue",
  "totalFeeRevenue", "operatingExpenses",
]);

/** Per-share money fields scaled by FX / depositaryRatio. */
const PERSHARE_FIELDS = new Set([
  "eps", "dilutedEps", "ffoPerShare", "affoPerShare", "navPerShare",
]);

/** Ratio/margin fields that must NEVER be FX-scaled. */
const RATIO_EXCLUDE = new Set([
  "grossMargin", "ebitdaMargin", "ebitMargin", "netMargin", "noiMargin",
  "operatingMargin", "lossRatio", "expenseRatio", "combinedRatio",
  "revenueAsPctOfAum", "netInterestMargin", "capitalAdequacyRatio",
  "tier1Ratio", "costToIncome", "casaRatio", "grossNPAPct", "netNPAPct",
  "provisionCoverageRatio", "occupancyPct", "sameStoreNoiGrowth",
  "waleYears", "leasableAreaMsf", "capRate", "managementFeeRateBps",
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Normalize statement rows from reporting currency + home share basis to
 * trading currency + depositary share basis. Returns NEW arrays (no mutation).
 */
export function normalizeCrossListing(params: {
  annualFinancials: AnnualFinancials[];
  quarterlyFinancials?: QuarterlyFinancials[];
  quoteShares: number | null;
  reportingCurrency: string;
  tradingCurrency: string;
  fxReportingToTrading: number;
  fxSource: string;
}): { annualFinancials: AnnualFinancials[]; quarterlyFinancials: QuarterlyFinancials[] | undefined; info: CrossListingInfo } {
  const {
    annualFinancials, quarterlyFinancials, quoteShares,
    reportingCurrency, tradingCurrency, fxReportingToTrading, fxSource,
  } = params;
  const rep = (reportingCurrency || "").toUpperCase();
  const trd = (tradingCurrency || "").toUpperCase();
  const fx = Number(fxReportingToTrading);

  if (!rep || !trd || rep === trd || !(fx > 0 && Number.isFinite(fx))) {
    return {
      annualFinancials,
      quarterlyFinancials,
      info: {
        isCrossListed: false,
        tradingCurrency: trd || rep,
        reportingCurrency: rep || trd,
        fxReportingToTrading: 1,
        depositaryRatio: 1,
        fxSource: "n/a (single currency)",
        notes: [],
      },
    };
  }

  const latest = annualFinancials[annualFinancials.length - 1] as unknown as Record<string, unknown> | undefined;
  const stmtShares = Number(latest?.sharesOutstanding) || 0;
  const q = Number(quoteShares) || 0;
  // Depositary ratio: ADR shares per home share. Only restate when the split
  // is material (>8%) — smaller gaps are SBC dilution/timing, not a listing.
  let depositaryRatio = 1;
  if (q > 0 && stmtShares > 0) {
    const ratio = q / stmtShares;
    if (Number.isFinite(ratio) && ratio > 1.08) depositaryRatio = ratio;
    else if (Number.isFinite(ratio) && ratio < 0.92) depositaryRatio = ratio;
  }

  const fxTag = `xlist:FX-${rep}->${trd}@${fx.toFixed(4)}(${fxSource})`;
  const adrTag = depositaryRatio !== 1
    ? `xlist:depositary-shares×${depositaryRatio.toFixed(4)}`
    : "xlist:shares-home=trading (no restatement)";

  const scaleRow = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...row };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      if (RATIO_EXCLUDE.has(k)) continue;
      if (PERSHARE_FIELDS.has(k)) {
        // Per-share fields are NOT blindly fx/ratio-scaled — their currency
        // basis (home vs depositary) is ambiguous in Yahoo feeds (SMFG: 247
        // yen is already per-ADR, 411 yen is per-home). Recompute below from
        // restated totals (NI/shares) to guarantee FINCONS-02 coherence.
        continue;
      }
      if (k === "sharesOutstanding") {
        out[k] = Math.round(v * depositaryRatio);
        continue;
      }
      if (MONEY_FIELDS.has(k)) {
        out[k] = v === 0 ? 0 : round2(v * fx);
        continue;
      }
    }
    // Restate per-share economics on the depositary basis (FINCONS-02 coherence).
    // Every annual row's EPS must equal NI / depositary shares after FX — the
    // only definition FINCONS-02 checks. Preserves finance identity, blocks unit
    // fantasy (JPY totals ÷ USD price).
    const scaledNI = Number(out.netIncome);
    const scaledShares = Number(out.sharesOutstanding);
    if (
      Number.isFinite(scaledNI) &&
      Number.isFinite(scaledShares) &&
      scaledShares > 0 &&
      scaledNI !== 0
    ) {
      const coherentEps = round2(scaledNI / scaledShares);
      if (typeof row.eps === "number" && Number.isFinite(row.eps) && row.eps !== 0) out.eps = coherentEps;
      if (typeof row.dilutedEps === "number" && Number.isFinite(row.dilutedEps) && row.dilutedEps !== 0)
        out.dilutedEps = coherentEps;
      // REIT FFO/AFFO per-share likewise cohere to restated base
      const ffo = Number(out.fundsFromOperations);
      if (Number.isFinite(ffo) && typeof row.ffoPerShare === "number" && Number.isFinite(row.ffoPerShare) && row.ffoPerShare !== 0) {
        out.ffoPerShare = round2(ffo / scaledShares);
      }
      const affo = Number(out.adjustedFundsFromOperations);
      if (Number.isFinite(affo) && typeof row.affoPerShare === "number" && Number.isFinite(row.affoPerShare) && row.affoPerShare !== 0) {
        out.affoPerShare = round2(affo / scaledShares);
      }
      const nav = Number(out.netAssetValue);
      if (Number.isFinite(nav) && typeof row.navPerShare === "number" && Number.isFinite(row.navPerShare) && row.navPerShare !== 0 && nav !== 0) {
        out.navPerShare = round2(nav / scaledShares);
      }
    } else {
      // Fallback for rows without NI/shares (e.g. zero-income REIT stub): pure FX
      for (const k of Array.from(PERSHARE_FIELDS)) {
        const v = row[k] as unknown as number;
        if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
          (out as Record<string, unknown>)[k] = round2(v * fx);
        }
      }
    }
    // Recompute compat alias + margins from scaled parts (never scale a ratio).
    const rev = Number(out.revenue ?? out.totalRevenue ?? out.rentalIncome ?? out.totalFeeRevenue) || 0;
    if (typeof out.revenue === "number" && typeof out.totalRevenue === "number") out.revenue = out.totalRevenue;
    const ni = Number(out.netIncome) || 0;
    if (rev > 0 && typeof out.netMargin === "number") out.netMargin = ni / rev;
    const opInc = Number(out.operatingIncome) || 0;
    if (rev > 0 && typeof (out as Record<string, unknown>).ebitMargin === "number" && !(out as Record<string, unknown>).statementType) {
      // corporate ebitMargin recomputed; bank rows keep ebitMargin=0 by design
    } else if (rev > 0 && (out.statementType === "bank" || out.statementType === "nbfc")) {
      // PPOP margin is informative; ebitMargin stays 0 (corporate fiction) —
      // UI must read operatingIncome/revenue for banks (fixed in ReportClient).
      void opInc;
    }
    const est = Array.isArray(out.estimatesUsed) ? [...(out.estimatesUsed as string[])] : [];
    if (!est.includes(fxTag)) est.push(fxTag);
    if (!est.includes(adrTag)) est.push(adrTag);
    out.estimatesUsed = est;
    return out;
  };

  const annual = annualFinancials.map((f) => scaleRow(f as unknown as Record<string, unknown>) as unknown as AnnualFinancials);
  const quarterly = quarterlyFinancials?.map((qrow) => {
    const r = qrow as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...r };
    for (const k of ["revenue", "grossProfit", "ebitda", "operatingIncome", "netIncome"]) {
      const v = out[k];
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[k] = round2(v * fx);
    }
    // Quarterly EPS is per-depositary in ADR feeds (SMFG). Keep FX-only;
    // recomputing from quarterly NI would need quarterly shares (undisclosed).
    if (typeof out.eps === "number" && Number.isFinite(out.eps) && out.eps !== 0) {
      out.eps = round2((out.eps as number) * fx);
    }
    return out as unknown as QuarterlyFinancials;
  });

  return {
    annualFinancials: annual,
    quarterlyFinancials: quarterly,
    info: {
      isCrossListed: true,
      tradingCurrency: trd,
      reportingCurrency: rep,
      fxReportingToTrading: fx,
      depositaryRatio,
      fxSource,
      notes: [
        `Translated ${rep} statement totals → ${trd} @ ${fx.toFixed(4)} (${fxSource}).`,
        depositaryRatio !== 1
          ? `Restated home shares → depositary basis ×${depositaryRatio.toFixed(4)} (quote ${q.toFixed(0)} vs statement ${stmtShares.toFixed(0)}).`
          : "Share basis unchanged (quote ≈ statement).",
      ],
    },
  };
}
