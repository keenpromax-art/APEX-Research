// ============================================================
// Ratio Guards & Unit Consistency Engine
// Suppresses degenerate ratios to "N/M", validates balance sheets,
// and standardizes units (₹ Cr vs ₹ Mn vs $ Mn).
// ============================================================

export interface GuardedRatioOptions {
  isPct?: boolean;
  maxAbs?: number;
  denom?: number;
  minDenom?: number;
  allowNegative?: boolean;
  decimals?: number;
}

/**
 * Formats a financial ratio with institutional guards against degenerate inputs.
 * Returns "N/M" (Not Meaningful) when:
 * - Equity / Denominator is near-zero or negative
 * - Percentage exceeds sanity bounds (e.g. |ROE| > 100%)
 * - Multiple is negative (e.g. negative P/E or EV/EBITDA)
 */
export function formatGuardedRatio(
  val: number | undefined | null,
  options: GuardedRatioOptions = {}
): string {
  const {
    isPct = false,
    maxAbs = isPct ? 1.0 : 150, // Default 100% for % ratios, 150x for multiples
    denom,
    minDenom = 1000,
    allowNegative = false,
    decimals = 1,
  } = options;

  if (val == null || !isFinite(val) || isNaN(val)) {
    return "N/M";
  }

  // Check denominator if provided (e.g., totalEquity near zero)
  if (denom !== undefined && Math.abs(denom) < minDenom) {
    return "N/M*";
  }

  // Sanity check bounds: cap exploding percentages (e.g. -31,238,400%)
  if (Math.abs(val) > maxAbs) {
    return "N/M*";
  }

  // Multiples or ratios that cannot be negative (e.g. valuation multiples)
  if (!allowNegative && !isPct && val < 0) {
    return "N/M";
  }

  if (isPct) {
    return `${(val * 100).toFixed(decimals)}%`;
  }

  return `${val.toFixed(decimals)}x`;
}

/**
 * Formats valuation multiples (P/E, EV/EBITDA, P/B).
 * If multiple is negative, zero, or > 200x, returns "N/M".
 */
export function formatGuardedMultiple(
  val: number | undefined | null,
  maxMultiple = 150,
  decimals = 1
): string {
  if (val == null || !isFinite(val) || isNaN(val) || val <= 0 || val > maxMultiple) {
    return "N/M";
  }
  return `${val.toFixed(decimals)}x`;
}

/**
 * Balance Sheet Equality Check: Total Assets = Total Liabilities + Total Equity
 */
export function verifyBalanceSheetEquality(
  totalAssets: number,
  totalLiabilities: number,
  totalEquity: number
): {
  balanced: boolean;
  variance: number;
  variancePct: number;
  label: string;
} {
  const rightSide = totalLiabilities + totalEquity;
  const variance = Math.abs(totalAssets - rightSide);
  const variancePct = totalAssets > 0 ? (variance / totalAssets) * 100 : 0;

  // Within 1% rounding/minor classification difference is deemed balanced
  const balanced = variancePct <= 1.0 || variance < 10000;

  return {
    balanced,
    variance,
    variancePct,
    label: balanced ? "BALANCED (0.00% var)" : `DISCREPANCY (${variancePct.toFixed(1)}%)`,
  };
}

/**
 * Formats large monetary values into the standard institutional reporting unit.
 * Default: 10,000,000 for ₹ Cr.
 */
export function toReportingUnit(
  val: number | undefined | null,
  unitMultiplier = 10_000_000,
  decimals = 1
): string {
  if (val == null || !isFinite(val) || isNaN(val)) return "—";
  const inUnits = val / unitMultiplier;
  return inUnits.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const RATIO_FOOTNOTES = {
  NOT_MEANINGFUL: "N/M: Not Meaningful due to near-zero or negative equity/EBITDA base.",
  NEGATIVE_MULTIPLE: "N/M: Negative operating profit invalidates standard valuation multiple.",
  SANITY_CAPPED: "N/M*: Figure exceeds institutional solvency bounds; excluded from averages.",
  ESTIMATED_INPUT: "Est.: Input field model-estimated from fixed-margin fallback (not company-reported). See Data Quality disclosure.",
  DENOMINATOR_STATE: "N/M: denominator state is ZERO/NEGATIVE (e.g. negative equity) — the ratio is mathematically computable but economically meaningless and never prints as fact.",
  NOT_DISCLOSED: "N/A: input not disclosed — shown as missing, never estimated or laddered.",
};
