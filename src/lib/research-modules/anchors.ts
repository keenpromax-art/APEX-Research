/**
 * Anchor resolution for research modules.
 *
 * Single-source hierarchy used by the live pipeline (ReportClient overwrites
 * masterReportFacts recommendation fields from the early ledger; canonical.ts
 * prefers ledger then facts). Modules follow the SAME order — never a second
 * formula for fair value, rating, or current price.
 *
 *   1. case.assumptionsLedger   (createAssumptionsLedger — canonical SSoT)
 *   2. masterReportFacts        (buildMasterReportFacts)
 *   3. case.valuation / dcf     (selectAndComputeValuation output)
 */
import type { MasterReportFacts } from "@/lib/report-facts";
import type { ResearchCase } from "@/lib/research-case";
import type { ValuationAnchorSource } from "./types";

export interface ValuationAnchors {
  rating: "BUY" | "HOLD" | "SELL" | "NR" | null;
  targetPrice: number | null;
  currentPrice: number | null;
  fairValue: number | null;
  upsideDownsidePct: number | null;
  anchorsFrom: ValuationAnchorSource;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function metricValue(m: { value?: unknown } | null | undefined): number | null {
  if (!m || m.value == null) return null;
  return num(m.value);
}

export function resolveValuationAnchors(
  researchCase: Pick<ResearchCase, "assumptionsLedger" | "valuation" | "stock">,
  masterReportFacts?: MasterReportFacts | null
): ValuationAnchors {
  const ledger = researchCase.assumptionsLedger;
  if (ledger) {
    return {
      rating: ledger.rating ?? null,
      targetPrice: num(ledger.targetPrice),
      currentPrice: num(ledger.currentPrice) ?? num(researchCase.stock?.currentPrice),
      fairValue: num(ledger.fairValue),
      upsideDownsidePct: num(ledger.upsideDownsidePct),
      anchorsFrom: "ledger",
    };
  }

  if (masterReportFacts) {
    const rec = masterReportFacts.recommendation;
    const val = masterReportFacts.valuation;
    const fv = metricValue(val?.fairValue);
    const upside = metricValue(val?.upside);
    const current = metricValue(masterReportFacts.market?.currentPrice)
      ?? num(researchCase.stock?.currentPrice);
    return {
      rating: (rec?.rating as ValuationAnchors["rating"]) ?? null,
      targetPrice: fv,
      currentPrice: current,
      fairValue: fv,
      upsideDownsidePct: upside != null && Math.abs(upside) > 1 ? upside / 100 : upside,
      anchorsFrom: "masterReportFacts",
    };
  }

  const dcf = researchCase.valuation;
  if (dcf) {
    const fv = num((dcf as { intrinsicValue?: unknown }).intrinsicValue)
      ?? num((dcf as { fairValuePerShare?: unknown }).fairValuePerShare);
    const current = num(researchCase.stock?.currentPrice);
    const upside =
      fv != null && current != null && current !== 0 ? (fv - current) / current : null;
    return {
      rating: null,
      targetPrice: fv,
      currentPrice: current,
      fairValue: fv,
      upsideDownsidePct: upside,
      anchorsFrom: "dcf",
    };
  }

  return {
    rating: null,
    targetPrice: null,
    currentPrice: num(researchCase.stock?.currentPrice),
    fairValue: null,
    upsideDownsidePct: null,
    anchorsFrom: "none",
  };
}

export interface MoatAnchors {
  rating: "Wide" | "Narrow" | "None" | null;
  trend: "Positive" | "Stable" | "Negative" | "Improving" | "Declining" | null;
  bridge: string | null;
  sourcesFrom: "ledger" | "masterReportFacts" | "none";
}

export function resolveMoatAnchors(
  researchCase: Pick<ResearchCase, "assumptionsLedger">,
  masterReportFacts?: MasterReportFacts | null
): MoatAnchors {
  const ledger = researchCase.assumptionsLedger;
  if (ledger?.moatRating) {
    return {
      rating: ledger.moatRating,
      trend: ledger.moatTrend ?? null,
      bridge: ledger.moatBridge ?? null,
      sourcesFrom: "ledger",
    };
  }
  const factsMoat = masterReportFacts?.moat;
  if (factsMoat?.rating) {
    return {
      rating: factsMoat.rating,
      trend: factsMoat.trend ?? null,
      // MoatFacts carries rationale prose; ledger carries moatBridge — same role.
      bridge: factsMoat.rationale ?? null,
      sourcesFrom: "masterReportFacts",
    };
  }
  return { rating: null, trend: null, bridge: null, sourcesFrom: "none" };
}
