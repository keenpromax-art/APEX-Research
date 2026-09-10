/**
 * APEX RESEARCH - Canonical Moat Engine
 * 
 * Strict Financial Invariant:
 * The economic moat rating and trend must be canonical across the entire report dossier.
 * Cover page, Investment Thesis, Moat Matrix, and Council audit MUST consume this exact object.
 * AI analysts are strictly forbidden from altering or contradictory relabeling of the canonical moat.
 */

import type { AnnualFinancials } from "@/types/report";
import { stmtNum } from "@/types/report";

export type MoatRating = "None" | "Narrow" | "Wide";
export type MoatTrend = "Improving" | "Stable" | "Declining";

export interface MoatFacts {
  rating: MoatRating;
  trend: MoatTrend;
  score: number; // 0 to 100
  confidence: number; // 0.0 to 1.0
  primarySources: string[];
  drivers: string[];
  rationale: string;
}

export function evaluateCanonicalMoat(params: {
  roceHistory: number[];      // Historical ROCEs
  wacc: number;               // Cost of capital
  grossMarginHistory: number[];
  debtToEquity: number;
  marketShareLeader?: boolean;
  pricingPower?: boolean;
  networkEffects?: boolean;
  switchingCosts?: boolean;
  costAdvantage?: boolean;
  intangibleAssets?: boolean;
}): MoatFacts {
  const {
    roceHistory,
    wacc,
    grossMarginHistory,
    debtToEquity,
    pricingPower = false,
    networkEffects = false,
    switchingCosts = false,
    costAdvantage = false,
    intangibleAssets = false,
  } = params;

  let score = 50;
  const drivers: string[] = [];
  const primarySources: string[] = [];

  // 1. Economic Spread Consistency (ROCE > WACC)
  const validRoce = roceHistory.filter(r => Number.isFinite(r));
  const avgRoce = validRoce.length > 0
    ? validRoce.reduce((a, b) => a + b, 0) / validRoce.length
    : 0;

  const spread = avgRoce - wacc;

  if (spread >= 0.10) { // Spread > 10%
    score += 25;
    drivers.push(`Consistent economic value addition with historical ROCE (${(avgRoce * 100).toFixed(1)}%) exceeding WACC (${(wacc * 100).toFixed(1)}%) by over 1,000 bps.`);
    primarySources.push("Sustained High Return on Capital");
  } else if (spread >= 0.03) {
    score += 10;
    drivers.push(`Positive economic spread over cost of capital (ROCE ${(avgRoce * 100).toFixed(1)}% vs WACC ${(wacc * 100).toFixed(1)}%).`);
    primarySources.push("Positive Return Spread");
  } else {
    score -= 15;
    drivers.push(`Narrow or negative spread over cost of capital indicates competitive vulnerability.`);
  }

  // 2. Gross Margin Stability / Pricing Power
  const validGm = grossMarginHistory.filter(g => Number.isFinite(g));
  if (validGm.length >= 2) {
    const minGm = Math.min(...validGm);
    const maxGm = Math.max(...validGm);
    const gmVariance = maxGm - minGm;

    if (gmVariance < 0.04 && minGm > 0.30) {
      score += 15;
      drivers.push(`Resilient gross margins (${(minGm * 100).toFixed(0)}%–${(maxGm * 100).toFixed(0)}%) signify strong underlying pricing power and input cost pass-through capability.`);
      primarySources.push("Pricing Power");
    }
  }

  // 3. Structural Moat Pillars
  if (networkEffects) {
    score += 15;
    drivers.push("Two-sided network effects create compounding entry barriers.");
    primarySources.push("Network Effects");
  }
  if (switchingCosts) {
    score += 12;
    drivers.push("High mission-critical customer switching costs drive recurring retention.");
    primarySources.push("Switching Costs");
  }
  if (costAdvantage) {
    score += 10;
    drivers.push("Scale economies and structural procurement cost advantages.");
    primarySources.push("Cost Advantage");
  }
  if (intangibleAssets) {
    score += 8;
    drivers.push("Defensible proprietary IP, patents, or recognized institutional brand equity.");
    primarySources.push("Intangible Assets");
  }

  // Deduct for excessive debt
  if (debtToEquity > 2.0) {
    score -= 10;
    drivers.push(`Elevated leverage (D/E ${(debtToEquity).toFixed(1)}x) constrains strategic moat reinvestment.`);
  }

  // Determine Rating
  let rating: MoatRating;
  if (score >= 75) {
    rating = "Wide";
  } else if (score >= 50) {
    rating = "Narrow";
  } else {
    rating = "None";
  }

  // Trend determination based on recent ROCE vs historical
  let trend: MoatTrend = "Stable";
  if (validRoce.length >= 2) {
    const recentRoce = validRoce[validRoce.length - 1];
    const pastRoce = validRoce[0];
    if (recentRoce - pastRoce > 0.025) {
      trend = "Improving";
    } else if (pastRoce - recentRoce > 0.03) {
      trend = "Declining";
    }
  }

  if (primarySources.length === 0) {
    primarySources.push("Standard Industry Dynamics");
  }

  const rationale = `${rating} economic moat (${trend.toLowerCase()} trend). ${drivers.slice(0, 2).join(" ")}`;

  return {
    rating,
    trend,
    score: Math.max(0, Math.min(100, score)),
    confidence: validRoce.length >= 3 ? 0.90 : 0.70,
    primarySources,
    drivers,
    rationale
  };
}

/**
 * Statement-driven canonical rating resolver — the single authority used by
 * pillar generation (pe-analysis), LLM prompt injection, and assembly caps.
 * Mirrors report-facts' moat inputs exactly (ROCE = operatingIncome /
 * capitalEmployed per calculations.ts; NaN-safe gross margins; latest D/E),
 * so every surface derives the SAME rating from the SAME statements instead of
 * each guessing (which is what produced Wide pillars under a None composite).
 */
export function resolveMoatRating(
  annualFinancials: AnnualFinancials[],
  wacc: number
): MoatRating {
  const roceHistory = (annualFinancials || []).map((f) => {
    const opInc = stmtNum(f, "operatingIncome");
    const ce = f.totalAssets - f.currentLiabilities;
    // Mirror computeRatios exactly (incl. negative-denominator quotients and
    // zero-denominator 0s) so this resolver agrees with report-facts' rating.
    const r = ce === 0 ? 0 : opInc / ce;
    return Number.isFinite(r) ? r : 0;
  });
  const grossMarginHistory = (annualFinancials || []).map((f) =>
    f.revenue > 0 ? stmtNum(f, "grossProfit", Number.NaN) / f.revenue : 0
  );
  const latest = annualFinancials[annualFinancials.length - 1];
  const debtToEquity =
    latest && latest.totalEquity > 0 ? latest.totalDebt / latest.totalEquity : 0;
  return evaluateCanonicalMoat({
    roceHistory,
    wacc,
    grossMarginHistory,
    debtToEquity,
  }).rating;
}

/**
 * Cap pillar durabilities at the composite rating (shared by pe-analysis
 * self-harmonization and the LLM-assembly backstop — one mapping, two callers).
 * Wide pillars survive only under a Wide composite; anything else is a
 * generation error, never a discovery (pillars are subordinate breakdowns).
 */
export function capPillarsToRating<
  P extends { pillar: string; durability: string; rationale: string }
>(pillars: P[], rating: MoatRating): P[] {
  if (rating === "Wide") return pillars;
  if (rating === "Narrow") {
    return pillars.map((p) =>
      p.durability.startsWith("Wide")
        ? {
            ...p,
            durability: "Narrow (7-10 Yrs)",
            rationale: `${p.rationale.replace(/multi-decade|unassailable|permanent|unassailable legal barriers/gi, "defensible")} (Durability capped to composite Narrow moat.)`,
          }
        : p
    );
  }
  return pillars.map((p) => ({
    ...p,
    durability: "None (< 3 Yrs)",
    rationale: "Vulnerable to competitive encroachment and margin erosion without structural barriers.",
  }));
}
