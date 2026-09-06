/**
 * APEX RESEARCH - Deterministic Recommendation Engine
 * 
 * Strict Financial Invariant:
 * The AI must NEVER generate, alter, or override the final investment rating.
 * Ratings are 100% mathematically deterministic based on modeled fair value vs current market price.
 * 
 * Invariants:
 *  - Upside > +12.0%  => BUY
 *  - Upside < -12.0%  => SELL
 *  - Otherwise        => HOLD
 *  - Fair Value null  => NR (Not Rated)
 */

export type RecommendationRating = "BUY" | "HOLD" | "SELL" | "NR";

export interface RecommendationResult {
  rating: RecommendationRating;
  upside: number | null; // e.g. 0.204 for +20.4%
  status: "valid" | "not_rated";
  thresholds: {
    buyThreshold: number;
    sellThreshold: number;
  };
  reasoning: string;
}

export interface RecommendationConsistencyCheck {
  valid: boolean;
  issues: string[];
}

export const DEFAULT_BUY_THRESHOLD = 0.12;  // +12%
export const DEFAULT_SELL_THRESHOLD = -0.12; // -12%
export const MAX_CONFIDENCE_UPSIDE = 1.50;   // +150%
export const MIN_CONFIDENCE_UPSIDE = -0.80;  // -80%

/**
 * Deterministically compute the investment rating from current price and model fair value.
 */
export function calculateRecommendation(
  currentPrice: number | null | undefined,
  fairValue: number | null | undefined,
  buyThreshold = DEFAULT_BUY_THRESHOLD,
  sellThreshold = DEFAULT_SELL_THRESHOLD,
  maxConfidenceUpside = MAX_CONFIDENCE_UPSIDE,
  minConfidenceUpside = MIN_CONFIDENCE_UPSIDE
): RecommendationResult {
  if (
    currentPrice === null ||
    currentPrice === undefined ||
    currentPrice <= 0 ||
    fairValue === null ||
    fairValue === undefined ||
    fairValue <= 0 ||
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(fairValue)
  ) {
    return {
      rating: "NR",
      upside: null,
      status: "not_rated",
      thresholds: { buyThreshold, sellThreshold },
      reasoning: "Fair value model did not produce a valid positive intrinsic value. Formal rating suspended (NR)."
    };
  }

  const upside = (fairValue / currentPrice) - 1;

  // Sanity / Confidence Bound Check:
  // If modeled upside exceeds sane bounds (e.g. > +150% or < -80% or |upside| > 1.50),
  // mark result as low-confidence / NR to prevent speculative runaway recommendations.
  if (upside > maxConfidenceUpside || upside < minConfidenceUpside || Math.abs(upside) > maxConfidenceUpside) {
    return {
      rating: "NR",
      upside,
      status: "not_rated",
      thresholds: { buyThreshold, sellThreshold },
      reasoning: `Modeled upside (${(upside * 100).toFixed(1)}%) exceeds institutional confidence boundary (±150.0%). Rating marked as Low-Confidence / NR to prevent speculative model distortion.`
    };
  }

  if (upside > buyThreshold) {
    return {
      rating: "BUY",
      upside,
      status: "valid",
      thresholds: { buyThreshold, sellThreshold },
      reasoning: `Modeled fair value yields ${(upside * 100).toFixed(1)}% upside above market price (threshold: >${(buyThreshold * 100).toFixed(0)}%).`
    };
  }

  if (upside < sellThreshold) {
    return {
      rating: "SELL",
      upside,
      status: "valid",
      thresholds: { buyThreshold, sellThreshold },
      reasoning: `Modeled fair value yields ${(upside * 100).toFixed(1)}% downside below market price (threshold: <${(sellThreshold * 100).toFixed(0)}%).`
    };
  }

  return {
    rating: "HOLD",
    upside,
    status: "valid",
    thresholds: { buyThreshold, sellThreshold },
    reasoning: `Modeled fair value is within neutral band of market price (${(upside * 100).toFixed(1)}%).`
  };
}

/**
 * Hard invariant check ensuring no report can publish a rating that contradicts its upside.
 * E.g., BUY with negative upside or SELL with positive upside.
 */
export function validateRecommendationConsistency(
  currentPrice: number | null | undefined,
  fairValue: number | null | undefined,
  rating: string | null | undefined
): RecommendationConsistencyCheck {
  const issues: string[] = [];

  const deterministic = calculateRecommendation(currentPrice, fairValue);

  if (!rating) {
    issues.push("Report is missing a formal rating declaration.");
    return { valid: false, issues };
  }

  const normalizedRating = rating.trim().toUpperCase();

  if (deterministic.status === "not_rated") {
    if (normalizedRating !== "NR" && normalizedRating !== "NOT RATED") {
      issues.push(`Valuation is invalid or missing, yet report claims a '${normalizedRating}' rating. Must be 'NR'.`);
    }
  } else {
    // Both fair value and price exist
    const upside = deterministic.upside!;

    if (normalizedRating === "BUY" && upside < 0) {
      issues.push(`Contradiction: Rating is BUY but modeled upside is negative (${(upside * 100).toFixed(1)}%).`);
    } else if (normalizedRating === "SELL" && upside > 0) {
      issues.push(`Contradiction: Rating is SELL but modeled upside is positive (${(upside * 100).toFixed(1)}%).`);
    }

    if (normalizedRating !== deterministic.rating && normalizedRating !== "NOT RATED") {
      issues.push(
        `Rating mismatch: Declared '${normalizedRating}', but deterministic math mandates '${deterministic.rating}' (Upside: ${(upside * 100).toFixed(1)}%).`
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
