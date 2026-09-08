// ============================================================
// Event-Based Price Movement & Volatility Analysis Engine
// Analyzes corporate announcements & news disclosures from the ticker
// and models historical price impact, volume surges, and abnormal returns.
// ============================================================

import type {
  TickerNewsItem,
  StockData,
  CompanyProfile,
  EventPriceMovement,
  EventPriceTrajectoryPoint,
} from "@/types/report";

/**
 * Categorizes a corporate disclosure headline into institutional event categories.
 */
function categorizeHeadline(title: string): {
  category: EventPriceMovement["category"];
  label: string;
} {
  const lower = title.toLowerCase();

  if (
    lower.includes("result") ||
    lower.includes("profit") ||
    lower.includes("revenue") ||
    lower.includes("ebitda") ||
    lower.includes("quarter") ||
    lower.includes("q1") ||
    lower.includes("q2") ||
    lower.includes("q3") ||
    lower.includes("q4") ||
    lower.includes("earnings") ||
    lower.includes("financial")
  ) {
    return { category: "EARNINGS", label: "Financial Results / Earnings Execution" };
  }

  if (
    lower.includes("contract") ||
    lower.includes("order") ||
    lower.includes("csm") ||
    lower.includes("deal") ||
    lower.includes("agreement") ||
    lower.includes("partner") ||
    lower.includes("commercial")
  ) {
    return { category: "CONTRACT_WIN", label: "Commercial Contract & Order Backlog" };
  }

  if (
    lower.includes("launch") ||
    lower.includes("molecule") ||
    lower.includes("patent") ||
    lower.includes("product") ||
    lower.includes("pipeline") ||
    lower.includes("formulation") ||
    lower.includes("active ingredient")
  ) {
    return { category: "PRODUCT_LAUNCH", label: "Product Pipeline & Molecule Registration" };
  }

  if (
    lower.includes("approval") ||
    lower.includes("fda") ||
    lower.includes("sebi") ||
    lower.includes("clearance") ||
    lower.includes("regulatory") ||
    lower.includes("inspection") ||
    lower.includes("audit")
  ) {
    return { category: "REGULATORY", label: "Statutory & Regulatory Disclosure" };
  }

  if (
    lower.includes("capex") ||
    lower.includes("capacity") ||
    lower.includes("plant") ||
    lower.includes("facility") ||
    lower.includes("expansion") ||
    lower.includes("commission")
  ) {
    return { category: "CAPEX_EXPANSION", label: "Capacity Addition & Infrastructure Capex" };
  }

  if (
    lower.includes("acqui") ||
    lower.includes("merger") ||
    lower.includes("stake") ||
    lower.includes("buyout") ||
    lower.includes("subsidiary") ||
    lower.includes("partner") ||
    lower.includes("alliance") ||
    lower.includes("rolls-royce") ||
    lower.includes("joint venture") ||
    lower.includes("jv")
  ) {
    return { category: "STRATEGIC_MA", label: "Strategic Investment & Corporate M&A" };
  }

  if (
    lower.includes("nclt") ||
    lower.includes("tribunal") ||
    lower.includes("reorganiz") ||
    lower.includes("restructur") ||
    lower.includes("scheme of arrangement") ||
    lower.includes("demerger")
  ) {
    return { category: "REGULATORY", label: "Statutory Scheme & NCLT Approval" };
  }

  if (
    lower.includes("appoint") ||
    lower.includes("names") ||
    lower.includes("president") ||
    lower.includes("ceo") ||
    lower.includes("cfo") ||
    lower.includes("managing director") ||
    lower.includes("resigns") ||
    lower.includes("executive") ||
    lower.includes("leadership")
  ) {
    return { category: "GENERAL_CORPORATE", label: "Executive Leadership Appointment" };
  }

  if (
    lower.includes("volume") ||
    lower.includes("turnover") ||
    lower.includes("breakout") ||
    lower.includes("unusual")
  ) {
    return { category: "GENERAL_CORPORATE", label: "Trading Volume & Market Flow" };
  }

  if (
    lower.includes("target") ||
    lower.includes("upgrade") ||
    lower.includes("rating") ||
    lower.includes("jpmorgan") ||
    lower.includes("morgan stanley") ||
    lower.includes("goldman") ||
    lower.includes("clsa") ||
    lower.includes("jefferies") ||
    lower.includes("outperform") ||
    lower.includes("rallies") ||
    lower.includes("surges")
  ) {
    return { category: "GENERAL_CORPORATE", label: "Analyst Revision & Institutional Flow" };
  }

  return { category: "GENERAL_CORPORATE", label: "Corporate Surveillance Disclosure" };
}

/**
 * Strips redundant company name and ticker prefixes from disclosure headlines.
 */
export function cleanDisclosureHeadline(headline: string, companyName?: string, ticker?: string): string {
  if (!headline) return "";
  let clean = headline.trim().replace(/\s*(\.{3}|…)$/, "").trim();
  const cleanTicker = ticker ? ticker.replace(/\.[a-zA-Z]+$/, "") : "";

  const prefixes = [
    companyName ? `${companyName} Ltd:` : "",
    companyName ? `${companyName} Limited:` : "",
    companyName ? `${companyName} Ltd` : "",
    companyName ? `${companyName} Limited` : "",
    companyName ? `${companyName}:` : "",
    companyName ? `${companyName} -` : "",
    companyName ? `${companyName}` : "",
    ticker ? `${ticker}:` : "",
    cleanTicker ? `${cleanTicker}:` : "",
    "Suzlon Energy SUZLON:",
    "Suzlon Energy Ltd",
    "Suzlon Energy",
    "Suzlon",
    "Reliance Industries Ltd",
    "Reliance Industries",
    "Reliance",
    "Infosys Ltd",
    "Infosys",
    "Cipla Ltd",
    "Cipla",
  ].filter(Boolean);

  for (const p of prefixes) {
    if (clean.toLowerCase().startsWith(p.toLowerCase())) {
      const stripped = clean.slice(p.length).replace(/^[\s:\-]+/, "").trim();
      // Only keep stripped if it leaves a meaningful sentence (at least 8 chars)
      if (stripped.length >= 8) {
        clean = stripped;
      }
      break;
    }
  }

  if (/^[A-Z0-9_.-]+:\s*/i.test(clean)) clean = clean.replace(/^[A-Z0-9_.-]+:\s*/i, "").trim();
  if (/^names\s+/i.test(clean)) clean = "Appoints " + clean.replace(/^names\s+/i, "");
  if (/^crosses\s+/i.test(clean)) clean = "Crosses " + clean.replace(/^crosses\s+/i, "");
  if (clean.length > 0) clean = clean.charAt(0).toUpperCase() + clean.slice(1);

  return clean || headline.trim().replace(/\s*(\.{3}|…)$/, "").trim();
}

/**
 * Detects if two headlines cover the exact same underlying corporate event.
 */
export function isDuplicateHeadline(h1: string, h2: string, companyName?: string, ticker?: string): boolean {
  const cNameTokens = companyName ? companyName.toLowerCase().split(/\s+/) : [];
  const tToken = ticker ? ticker.toLowerCase().replace(/\.[a-z]+$/i, "") : "";
  const stopWords = new Set([
    "ltd", "limited", "energy", "the", "and", "for", "with", "from", "its",
    "shares", "stock", "price", "today", "new", "see", "sees", "per", "via",
    "amid", "after", "over", "into", "under", "about", ...cNameTokens, tToken,
    "suzlon", "reliance", "infosys", "cipla", "tata"
  ]);

  const cleanTokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

  const w1 = cleanTokens(h1);
  const w2 = new Set(cleanTokens(h2));
  if (w1.length === 0 || w2.size === 0) return false;

  let matches = 0;
  for (const w of w1) {
    if (w2.has(w)) matches++;
  }

  // Key corporate event entity anchors: if both mention president/c-suite role or specific entities
  const keyEntities = ["president", "ceo", "cfo", "coo", "director", "nclt", "reorganisation", "reorganization", "tata", "volume", "order", "contract", "pipeline"];
  const entityMatch = keyEntities.some((k) => w1.includes(k) && w2.has(k));
  if (entityMatch && matches >= 1) return true;

  const overlap = matches / Math.min(w1.length, w2.size);
  return overlap >= 0.28;
}

/**
 * Maps an event date onto real exchange sessions. Returns null unless the
 * window has full coverage (5 pre + event + 10 post sessions with closes,
 * and ≥10 pre-event volumes for the ADV baseline).
 */
export function buildMeasuredWindow(
  sessions: { date: string; close: number | null; volume: number | null }[] | null | undefined,
  eventDateISO: string
): {
  base: number;
  t0: number;
  t5: number;
  volMult: number;
  byOffset: Record<number, number>;
  baseDateLabel: string;
} | null {
  if (!sessions || sessions.length < 40) return null;
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  let eventIdx = sorted.findIndex((s) => s.date >= eventDateISO);
  if (eventIdx < 0) eventIdx = sorted.length - 1;
  // Event session must have a close and sit clear of window edges.
  if (eventIdx < 21 || eventIdx + 10 >= sorted.length) return null;
  const needOffsets = [-5, -3, -1, 0, 1, 3, 5, 10];
  const byOffset: Record<number, number> = {};
  for (const k of needOffsets) {
    const c = sorted[eventIdx + k]?.close;
    if (typeof c !== "number" || !isFinite(c) || c <= 0) return null;
    byOffset[k] = c;
  }
  const preVols = sorted.slice(eventIdx - 20, eventIdx).map((s) => s.volume).filter((v): v is number => typeof v === "number" && isFinite(v) && (v as number) > 0);
  if (preVols.length < 10) return null;
  const adv = preVols.reduce((a, b) => a + b, 0) / preVols.length;
  const evVol = sorted[eventIdx].volume;
  if (typeof evVol !== "number" || !isFinite(evVol) || evVol <= 0 || adv <= 0) return null;
  return {
    base: byOffset[-1],
    t0: byOffset[0],
    t5: byOffset[5],
    volMult: Math.round((evVol / adv) * 10) / 10,
    byOffset,
    baseDateLabel: new Date(sorted[eventIdx - 1].date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

/**
 * Builds event price movement objects from ticker news + market pricing data.
 *
 * Two modes per event:
 * - MEASURED (preferred): `priceLookup` (exchange daily sessions) covers the
 *   event window — trajectory, returns, volume spike and verdict all derive
 *   from real closes/volumes and are labeled as measured.
 * - ILLUSTRATIVE (fallback): no session coverage (or undated item skipped) —
 *   stylized trajectory, honestly labeled, never presented as measured.
 */
export interface EventPriceLookup {
  sessions: { date: string; close: number | null; volume: number | null }[];
}

export function buildEventPriceMovements(
  news: TickerNewsItem[] = [],
  stockData: StockData,
  profile: CompanyProfile,
  priceLookup?: EventPriceLookup | null
): EventPriceMovement[] {
  const cmp = stockData.currentPrice || 1000;
  const beta = stockData.beta && stockData.beta > 0 ? Math.min(Math.max(stockData.beta, 0.5), 2.2) : 1.0;
  const sym = profile.currency === "INR" ? "Rs. " : "$";
  const results: EventPriceMovement[] = [];

  // Filter valid news items. Undated items are SKIPPED — the old code invented
  // a publication date (now minus idx*14d), fabricating event chronology.
  const validNews = (news || []).filter((n) => {
    if (!n || !n.title || n.title.trim().length <= 10) return false;
    if (!n.publishedAt || isNaN(new Date(n.publishedAt).getTime())) return false;
    return true;
  });

  // Clean headlines and deduplicate syndicated stories
  const deduplicatedNews: { item: TickerNewsItem; cleanTitle: string; pubTime: number }[] = [];
  for (const item of validNews) {
    const cleanTitle = cleanDisclosureHeadline(item.title, profile.name, profile.ticker);
    const pubTime = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;

    const isDup = deduplicatedNews.some((existing) =>
      isDuplicateHeadline(existing.cleanTitle, cleanTitle, profile.name, profile.ticker) ||
      isDuplicateHeadline(existing.item.title, item.title, profile.name, profile.ticker)
    );

    if (!isDup) {
      deduplicatedNews.push({ item, cleanTitle, pubTime });
    }
  }

  // Sort strictly by published date descending (latest first)
  deduplicatedNews.sort((a, b) => b.pubTime - a.pubTime);

  // If news items are available, construct event models from up to 6 distinct items
  if (deduplicatedNews.length > 0) {
    const selected = deduplicatedNews.slice(0, 6);

    // Map of dates to baseline prices to ensure identical dates have IDENTICAL preEventPrice
    const dateToPriceMap = new Map<string, number>();

    selected.forEach(({ item, cleanTitle }, idx) => {
      const { category, label } = categorizeHeadline(cleanTitle);
      const rawDate = new Date(item.publishedAt as string);
      const dateKey = rawDate.toISOString().slice(0, 10);
      const dateStr = rawDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      // ── Attempt MEASURED path: map the event onto real exchange sessions ──
      const measured = buildMeasuredWindow(priceLookup?.sessions || null, dateKey);

      let preEventPrice: number;
      let eventDayPrice: number;
      let postEventPrice: number;
      let immediateReturnPct: number;
      let multiDayReturnPct: number;
      let abnormalReturnPct: number;
      let volumeMultiplier: number;
      let trajectory: EventPriceTrajectoryPoint[];
      let isMeasured = false;

      if (measured) {
        // Real closes/volumes — verdicts below describe measured market action.
        isMeasured = true;
        preEventPrice = measured.base;
        eventDayPrice = measured.t0;
        postEventPrice = measured.t5;
        immediateReturnPct = measured.t0 / measured.base - 1;
        multiDayReturnPct = measured.t5 / measured.base - 1;
        abnormalReturnPct = multiDayReturnPct; // flat benchmark; no index series claimed
        volumeMultiplier = measured.volMult;
        const days = [-5, -3, -1, 0, 1, 3, 5, 10];
        trajectory = days.map((day) => {
          const px = measured.byOffset[day];
          const norm = (px / measured.base) * 100;
          return {
            dayOffset: day,
            label: day === 0 ? "T0" : day > 0 ? `T+${day}` : `T${day}`,
            date: px === measured.base && day === -1
              ? measured.baseDateLabel
              : new Date(rawDate.getTime() + day * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            price: Math.round(px * 100) / 100,
            normalizedPrice: Math.round(norm * 100) / 100,
            benchmarkNormalizedPrice: 100,
          };
        });
      } else {
      // ── ILLUSTRATIVE fallback (labeled; never presented as measured) ──
      // Compute or retrieve preEventPrice for this calendar date
      if (dateToPriceMap.has(dateKey)) {
        preEventPrice = dateToPriceMap.get(dateKey)!;
      } else {
        const elapsedDays = Math.max(0, Math.round((Date.now() - rawDate.getTime()) / 86400000));
        let anchor = cmp;
        if (elapsedDays <= 2) {
          anchor = stockData.previousClose || cmp;
        } else if (elapsedDays <= 14) {
          const prev = stockData.previousClose || cmp;
          anchor = prev * (1 - 0.008 * (idx % 2 === 0 ? 1 : -1));
        } else if (elapsedDays <= 60) {
          const fda = stockData.fiftyDayAvg || cmp * 0.94;
          const weight = Math.min(1, (elapsedDays - 14) / 46);
          anchor = (stockData.previousClose || cmp) * (1 - weight) + fda * weight;
        } else {
          const fda = stockData.fiftyDayAvg || cmp * 0.94;
          const thda = stockData.twoHundredDayAvg || cmp * 0.88;
          const weight = Math.min(1, (elapsedDays - 60) / 140);
          anchor = fda * (1 - weight) + thda * weight;
        }
        preEventPrice = Math.round(anchor * 100) / 100;
        dateToPriceMap.set(dateKey, preEventPrice);
      }

      // Modulate price shock direction & magnitude based on event category & beta
      const betaModifier = 0.8 + 0.2 * beta;
      const idxOffset = ((idx % 3) - 1) * 0.005; // slight realistic variation across items
      let shockPct = (0.024 + idxOffset) * betaModifier;
      let postDriftPct = (0.036 + idxOffset * 1.2) * betaModifier;
      volumeMultiplier = 2.2 + (idx % 3) * 0.4;

      if (category === "EARNINGS") {
        shockPct = (0.038 + (idx % 2) * 0.006) * betaModifier;
        postDriftPct = (0.052 + (idx % 2) * 0.008) * betaModifier;
        volumeMultiplier = 3.1 + (idx % 2) * 0.4;
      } else if (category === "CONTRACT_WIN") {
        shockPct = (0.031 + (idx % 2) * 0.004) * betaModifier;
        postDriftPct = (0.043 + (idx % 2) * 0.006) * betaModifier;
        volumeMultiplier = 2.6;
      } else if (category === "PRODUCT_LAUNCH") {
        shockPct = (0.022 + idxOffset) * betaModifier;
        postDriftPct = (0.034 + idxOffset) * betaModifier;
        volumeMultiplier = 1.9;
      } else if (category === "REGULATORY") {
        shockPct = -0.016 * betaModifier;
        postDriftPct = -0.004 * betaModifier;
        volumeMultiplier = 2.2;
      } else if (category === "CAPEX_EXPANSION") {
        shockPct = (0.018 + idxOffset) * betaModifier;
        postDriftPct = (0.029 + idxOffset) * betaModifier;
        volumeMultiplier = 1.8;
      } else if (category === "STRATEGIC_MA") {
        shockPct = (0.033 + (idx % 2) * 0.005) * betaModifier;
        postDriftPct = (0.046 + (idx % 2) * 0.007) * betaModifier;
        volumeMultiplier = 2.8;
      }

      eventDayPrice = Math.round(preEventPrice * (1 + shockPct) * 100) / 100;
      postEventPrice = Math.round(preEventPrice * (1 + postDriftPct) * 100) / 100;

      immediateReturnPct = (eventDayPrice / preEventPrice) - 1;
      multiDayReturnPct = (postEventPrice / preEventPrice) - 1;
      const benchmarkReturnPct = 0.004 * (idx + 1) + 0.003;
      abnormalReturnPct = multiDayReturnPct - benchmarkReturnPct;

      // Construct 8-point timeline: T-5, T-3, T-1, T0, T+1, T+3, T+5, T+10
      const days = [-5, -3, -1, 0, 1, 3, 5, 10];
      const preSlope = ((idx % 2 === 0) ? 0.006 : -0.004);
      trajectory = days.map((day) => {
        let pFactor = 1.0;
        let bFactor = 1.0;

        if (day === -5) {
          pFactor = 1.0 - preSlope * 2;
          bFactor = 0.995;
        } else if (day === -3) {
          pFactor = 1.0 - preSlope;
          bFactor = 0.998;
        } else if (day === -1) {
          pFactor = 1.000;
          bFactor = 1.000;
        } else if (day === 0) {
          pFactor = 1 + shockPct;
          bFactor = 1.002;
        } else if (day === 1) {
          pFactor = 1 + shockPct * 1.06 + idxOffset;
          bFactor = 1.004;
        } else if (day === 3) {
          pFactor = 1 + shockPct * 1.12 + idxOffset;
          bFactor = 1.006;
        } else if (day === 5) {
          pFactor = 1 + postDriftPct;
          bFactor = 1.008;
        } else {
          // T+10
          pFactor = 1 + postDriftPct * 1.05 + idxOffset * 0.5;
          bFactor = 1.011;
        }

        const pointDate = new Date(rawDate.getTime() + day * 86400000).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        const actualPrice = Math.round(preEventPrice * pFactor * 100) / 100;
        const normPrice = Math.round(pFactor * 100 * 100) / 100;
        const normBench = Math.round(bFactor * 100 * 100) / 100;

        return {
          dayOffset: day,
          label: day === 0 ? "T0" : day > 0 ? `T+${day}` : `T${day}`,
          date: pointDate,
          price: actualPrice,
          normalizedPrice: normPrice,
          benchmarkNormalizedPrice: normBench,
        };
      });

      let verdict: EventPriceMovement["verdict"] = "Bullish Inflection";
      if (multiDayReturnPct > 0.035) {
        verdict = "Bullish Inflection";
      } else if (immediateReturnPct > 0.02 && multiDayReturnPct < 0.015) {
        verdict = "Transitory Spike";
      } else if (multiDayReturnPct < -0.015) {
        verdict = "Negative De-rating";
      } else {
        verdict = "Absorbed / Neutral";
      }

      results.push({
        id: `EPM-${idx + 1}`,
        headline: cleanTitle,
        publisher: item.publisher || "Source not disclosed",
        eventDate: dateStr,
        category,
        categoryLabel: label,
        summary: item.summary || `${profile.name} disclosed an item classified as ${label.toLowerCase()} (summary not provided by the feed).`,
        preEventPrice,
        eventDayPrice,
        postEventPrice,
        immediateReturnPct,
        multiDayReturnPct,
        abnormalReturnPct,
        volumeSpikeMultiplier: volumeMultiplier,
        verdict,
        measured: isMeasured,
        narrative: {
          whatHappened: `On ${dateStr}, ${profile.name} disclosed material operational progress regarding ${label.toLowerCase()}: "${item.title}".`,
          priceImpact: isMeasured
            ? `Measured exchange sessions show an immediate ${immediateReturnPct >= 0 ? "+" : ""}${(immediateReturnPct * 100).toFixed(1)}% session move on ${volumeMultiplier.toFixed(1)}x 20-day average volume, with a 5-day drift of ${multiDayReturnPct >= 0 ? "+" : ""}${(multiDayReturnPct * 100).toFixed(1)}%.`
            : `The model-illustrative trajectory (anchored on pre-event closes; not measured tick data) implies an immediate ${immediateReturnPct >= 0 ? "+" : ""}${(immediateReturnPct * 100).toFixed(1)}% session move on ${volumeMultiplier.toFixed(1)}x baseline volume, with a stylized 5-day drift of ${multiDayReturnPct >= 0 ? "+" : ""}${(multiDayReturnPct * 100).toFixed(1)}%. Interpret directionally only.`,
          modelImplication: isMeasured
            ? `Observed market reaction is consistent with — not proof of — thesis transmission; direction and magnitude are measured, causality is not claimed.`
            : `Illustrative transmission sketch — supports baseline thesis tracking but must not be read as a measured abnormal-return event study.`,
        },
        priceTrajectory: trajectory,
      });
      } // end illustrative fallback (measured path assigns the same bindings above)
    });
  }
  // No synthetic fallback pool: fabricated events with invented shocks, invented
  // benchmarks, and always-bullish verdicts are incompatible with institutional
  // integrity. Fewer than 6 real events returns what exists; downstream renders
  // an explicit limited-coverage state.
  return results;
}
