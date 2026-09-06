/**
 * APEX RESEARCH - Deterministic Uncertainty Engine
 * 
 * Strict Financial Invariant:
 * Uncertainty cannot be casually guessed or hallucinated by AI.
 * If valuation is invalid or missing, uncertainty must be "N/A", never "Low".
 * Quantitatively computed from leverage, earnings volatility, data completeness, and cyclicality.
 */

export type UncertaintyRating = "Low" | "Moderate" | "High" | "Very High" | "N/A";

export interface UncertaintyFacts {
  rating: UncertaintyRating;
  score: number; // 0 (lowest risk/uncertainty) to 100 (highest uncertainty)
  isValuationValid: boolean;
  drivers: string[];
  rationale: string;
}

export function calculateUncertainty(params: {
  isValuationValid: boolean;
  debtToEquity?: number | null;
  netDebtToEbitda?: number | null;
  earningsVolatility?: number | null; // e.g. standard deviation of Net Income / avg Net Income
  beta?: number | null;
  dataCompletenessScore?: number | null; // 0 to 100 (e.g. 5 yrs vs 1 yr of data)
  isCyclical?: boolean;
  terminalValuePctOfEv?: number | null; // e.g. 0.82 (82% of EV in terminal value)
}): UncertaintyFacts {
  const {
    isValuationValid,
    debtToEquity = 0.5,
    netDebtToEbitda = 1.0,
    beta = 1.0,
    dataCompletenessScore = 80,
    isCyclical = false,
    terminalValuePctOfEv = 0.70
  } = params;

  if (!isValuationValid) {
    return {
      rating: "N/A",
      score: 0,
      isValuationValid: false,
      drivers: ["Valuation model was invalidated or lacked sufficient input integrity; uncertainty rating suspended."],
      rationale: "Uncertainty rating is not applicable (N/A) because valuation models did not yield a valid intrinsic value."
    };
  }

  let uncertaintyScore = 35; // base level: moderate
  const drivers: string[] = [];

  // 1. Leverage Risk
  const de = debtToEquity ?? 0;
  const ndEbitda = netDebtToEbitda ?? 0;
  if (de > 2.5 || ndEbitda > 4.0) {
    uncertaintyScore += 25;
    drivers.push(`Elevated solvency strain: D/E ${de.toFixed(1)}x and Net Debt/EBITDA ${ndEbitda.toFixed(1)}x elevate downside vulnerability.`);
  } else if (de > 1.2 || ndEbitda > 2.5) {
    uncertaintyScore += 12;
    drivers.push(`Moderate leverage burden (Net Debt/EBITDA ${ndEbitda.toFixed(1)}x) requires steady operational cash generation.`);
  } else if (de < 0.2 && ndEbitda <= 0) {
    uncertaintyScore -= 10;
    drivers.push("Net cash / debt-free balance sheet provides strong downside insulation.");
  }

  // 2. Cyclicality & Systematic Risk (Beta)
  const b = beta ?? 1.0;
  if (b > 1.4 || isCyclical) {
    uncertaintyScore += 15;
    drivers.push(`High macroeconomic cyclical sensitivity (Beta: ${b.toFixed(2)}) introduces cash flow variability.`);
  } else if (b < 0.8) {
    uncertaintyScore -= 8;
    drivers.push(`Defensive risk profile (Beta: ${b.toFixed(2)}) indicates resilient business demand.`);
  }

  // 3. Data Completeness
  const dc = dataCompletenessScore ?? 80;
  if (dc < 50) {
    uncertaintyScore += 20;
    drivers.push("Limited reporting history or fragmented peer disclosure restricts statistical confidence.");
  }

  // 4. Terminal Value Sensitivity
  const tvPct = terminalValuePctOfEv ?? 0.70;
  if (tvPct > 0.85) {
    uncertaintyScore += 10;
    drivers.push(`High terminal value concentration (${(tvPct * 100).toFixed(0)}% of Enterprise Value) increases sensitivity to long-term discount rates.`);
  }

  // Clamp score
  const clampedScore = Math.max(0, Math.min(100, uncertaintyScore));

  let rating: UncertaintyRating;
  if (clampedScore < 30) {
    rating = "Low";
  } else if (clampedScore < 55) {
    rating = "Moderate";
  } else if (clampedScore < 75) {
    rating = "High";
  } else {
    rating = "Very High";
  }

  const rationale = `${rating} operational and valuation uncertainty (Score: ${clampedScore}/100). ${drivers.slice(0, 2).join(" ")}`;

  return {
    rating,
    score: clampedScore,
    isValuationValid: true,
    drivers,
    rationale
  };
}
