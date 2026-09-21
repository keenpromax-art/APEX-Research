/**
 * APEX RESEARCH — Sum-of-the-Parts (SOTP) Engine for Conglomerates
 * -----------------------------------------------------------------
 * A conglomerate (Reliance: O2C + Jio + Retail + E&P + New Energy) must not
 * be priced as a single homogeneous business on one blended multiple. SOTP:
 *
 *   Σ segmentEBITDA × segmentEV/EBITDA  (PRIMARY filing EBITDA × disclosed
 *                                        assumption multiples)
 *   + Other investments (balance-sheet, book)
 *   − Net debt (DCF-bridge figure, signed debt−cash)
 *   − Holding-company discount (disclosed assumption)
 *   = Equity value  ÷  shares  =  SOTP fair value per share
 *
 * Provenance discipline:
 *  - Segment EBITDA: PRIMARY ONLY (filing-segments registry). No registry
 *    entry → status "insufficient_data" (never synthesized from the total).
 *  - Segment multiples: explicit analyst assumptions with basis strings
 *    (sector-typical ranges), sensitivity-flagged, QA-bounded (2–30×).
 *  - Residual EBITDA (consolidated − covered segments, e.g. media/others):
 *    valued at the EBITDA-weighted blended multiple, LOW confidence,
 *    disclosed — never silently dropped, never double-counted.
 *  - New Energy (pre-profit growth option): acknowledged, unvalued.
 */
import type { FilingSegmentSet } from "../filing-segments";

export interface SotpSegmentMultiple {
  /** Segment name as in the filing registry. */
  segment: string;
  /** Assumed EV/EBITDA multiple (NOT a filing fact). */
  multiple: number;
  /** Why this multiple (sector-typical range reference). */
  basis: string;
}

/** Default segment multiples — disclosed assumptions, not facts. */
export const DEFAULT_SOTP_MULTIPLES: SotpSegmentMultiple[] = [
  { segment: "Oil to Chemicals (O2C)", multiple: 6.5, basis: "Cyclical refining/petrochem complex, through-cycle 5–8× EV/EBITDA." },
  { segment: "Digital Services (Jio Platforms)", multiple: 10.0, basis: "Indian telecom infra, listed peers 9–11× EV/EBITDA." },
  { segment: "Retail (RRVL)", multiple: 20.0, basis: "Conservative vs listed Indian retail peers (30–50×); high-growth organized retail commands a scarcity premium." },
  { segment: "Oil and Gas (E&P)", multiple: 5.5, basis: "Upstream E&P, long-life gas reserves, 4–7× EV/EBITDA." },
];

/** Conglomerate holding-company discount (assumption, disclosed + sensitized). */
export const SOTP_HOLDING_DISCOUNT = 0.10;

export interface SotpParams {
  ticker: string;
  currency: string;
  filing: FilingSegmentSet;
  multiples?: SotpSegmentMultiple[];
  /** Balance-sheet other investments at book (absolute units). */
  otherInvestments?: number;
  /** Signed net debt (debt − cash) from the DCF bridge. */
  netDebt: number;
  holdingDiscount?: number;
  sharesOutstanding: number;
  currentPrice: number;
}

export interface SotpSegmentResult {
  name: string;
  ebitda: number;
  multiple: number;
  multipleBasis: string;
  enterpriseValue: number;
  provenance: "PRIMARY-EBITDA×ASSUMPTION-MULTIPLE" | "RESIDUAL-BLENDED";
}

export interface SotpResult {
  status: "valid" | "insufficient_data";
  ticker: string;
  currency: string;
  period: string;
  segments: SotpSegmentResult[];
  grossAssetValue: number;
  otherInvestments: number;
  netDebt: number;
  holdingDiscount: number;
  holdingDiscountValue: number;
  equityValue: number;
  sharesOutstanding: number;
  fairValuePerShare: number | null;
  currentPrice: number;
  upside: number | null;
  verdict: "BUY" | "HOLD" | "SELL" | "NR";
  /** Covered segment EBITDA / filing consolidated EBITDA. */
  coveragePct: number;
  diagnostics: string[];
}

export function computeSotpValuation(params: SotpParams): SotpResult {
  const {
    ticker,
    filing,
    netDebt,
    sharesOutstanding,
    currentPrice,
  } = params;
  const currency = filing.currency;
  const multiples = params.multiples ?? DEFAULT_SOTP_MULTIPLES;
  const otherInvestments = params.otherInvestments ?? 0;
  const holdingDiscount = params.holdingDiscount ?? SOTP_HOLDING_DISCOUNT;
  const diagnostics: string[] = [];

  const multipleFor = (name: string): SotpSegmentMultiple | undefined =>
    multiples.find((m) => m.segment.toLowerCase() === name.toLowerCase());

  const segments: SotpSegmentResult[] = [];
  let coveredEbitda = 0;
  for (const seg of filing.segments) {
    const m = multipleFor(seg.name);
    if (!m || !(m.multiple > 0)) {
      return {
        status: "insufficient_data",
        ticker, currency, period: filing.period, segments: [], grossAssetValue: 0,
        otherInvestments, netDebt, holdingDiscount, holdingDiscountValue: 0,
        equityValue: 0, sharesOutstanding, fairValuePerShare: null,
        currentPrice, upside: null, verdict: "NR", coveragePct: 0,
        diagnostics: [`No EV/EBITDA multiple supplied for filing segment "${seg.name}" — SOTP refused (multiples are assumptions, but every segment needs one).`],
      };
    }
    const ev = seg.ebitda * m.multiple;
    coveredEbitda += seg.ebitda;
    segments.push({
      name: seg.name, ebitda: seg.ebitda, multiple: m.multiple,
      multipleBasis: m.basis, enterpriseValue: ev,
      provenance: "PRIMARY-EBITDA×ASSUMPTION-MULTIPLE",
    });
  }

  // Residual (consolidated − covered: media/others/unallocated) at the
  // EBITDA-weighted blended multiple — disclosed, LOW confidence.
  const residual = filing.consolidatedEbitda - coveredEbitda;
  if (residual > 0) {
    const blended = coveredEbitda > 0
      ? segments.reduce((s, x) => s + x.enterpriseValue, 0) / coveredEbitda
      : 0;
    if (blended > 0) {
      segments.push({
        name: "Others & unallocated (incl. media)",
        ebitda: residual, multiple: blended,
        multipleBasis: "EBITDA-weighted blended multiple of covered segments (LOW confidence — unallocated residual).",
        enterpriseValue: residual * blended,
        provenance: "RESIDUAL-BLENDED",
      });
    }
    diagnostics.push(
      `Residual EBITDA ${(residual / 1e7).toFixed(0)} cr (${((residual / filing.consolidatedEbitda) * 100).toFixed(1)}% of consolidated) valued at blended ${blended.toFixed(1)}× — unallocated/media bucket, LOW confidence.`
    );
  }
  diagnostics.push("New Energy acknowledged as a pre-profit growth option — option value not quantified in this SOTP.");

  const coveragePct = filing.consolidatedEbitda > 0 ? coveredEbitda / filing.consolidatedEbitda : 0;
  const grossAssetValue = segments.reduce((s, x) => s + x.enterpriseValue, 0) + otherInvestments;
  const holdingDiscountValue = grossAssetValue * holdingDiscount;
  const equityValue = grossAssetValue - holdingDiscountValue - netDebt;

  if (!(sharesOutstanding > 0) || !(equityValue > 0)) {
    return {
      status: "insufficient_data",
      ticker, currency, period: filing.period, segments, grossAssetValue,
      otherInvestments, netDebt, holdingDiscount, holdingDiscountValue,
      equityValue: Math.max(0, equityValue), sharesOutstanding,
      fairValuePerShare: null, currentPrice, upside: null, verdict: "NR",
      coveragePct,
      diagnostics: [...diagnostics, "SOTP bridge non-positive or share base unresolved — no fair value asserted."],
    };
  }

  const fairValuePerShare = Math.round((equityValue / sharesOutstanding) * 100) / 100;
  const upside = currentPrice > 0 ? fairValuePerShare / currentPrice - 1 : null;
  const verdict: SotpResult["verdict"] =
    upside === null ? "NR" : upside >= 0.12 ? "BUY" : upside <= -0.12 ? "SELL" : "HOLD";

  return {
    status: "valid",
    ticker, currency, period: filing.period, segments, grossAssetValue,
    otherInvestments, netDebt, holdingDiscount, holdingDiscountValue,
    equityValue, sharesOutstanding, fairValuePerShare, currentPrice,
    upside, verdict, coveragePct, diagnostics,
  };
}
