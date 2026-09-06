/**
 * APEX RESEARCH - Scenario Mathematics & Validation Engine
 * 
 * Strict Financial Invariant:
 * Implied scenario returns must ALWAYS be calculated as:
 *   impliedReturn = (targetPrice / currentPrice) - 1
 * 
 * Never hardcode returns (e.g. reporting +28% simply because bull target was base * 1.28).
 * Scenarios must satisfy strict monotonicity:
 *   Bull Target Price >= Base Target Price >= Bear Target Price
 */

export interface Scenario {
  name: "bull" | "base" | "bear";
  targetPrice: number;
  impliedReturn: number; // Strictly: (targetPrice / currentPrice) - 1
  probability?: number;   // e.g. 0.25 (25%)
  ebitMargin?: number;
  revenueGrowth?: number;
  description?: string;
  catalysts?: string[];
}

export interface ScenarioSet {
  currentPrice: number;
  bull: Scenario;
  base: Scenario;
  bear: Scenario;
  expectedPrice?: number;
  weightedReturn?: number;
  status: "valid" | "invalid";
  diagnostics: string[];
}

/**
 * Calculates a complete, mathematically verified scenario set.
 */
export function buildScenarioSet(params: {
  currentPrice: number;
  baseTargetPrice: number;
  bullMultiplier?: number; // e.g. 1.25 (+25% over base)
  bearMultiplier?: number; // e.g. 0.75 (-25% under base)
  bullTarget?: number;     // explicit bull target override
  bearTarget?: number;     // explicit bear target override
  probabilities?: { bull: number; base: number; bear: number }; // default 0.25, 0.50, 0.25
  descriptions?: { bull?: string; base?: string; bear?: string };
}): ScenarioSet {
  const {
    currentPrice,
    bullMultiplier = 1.25,
    bearMultiplier = 0.75,
    bullTarget,
    bearTarget,
    probabilities = { bull: 0.25, base: 0.50, bear: 0.25 },
    descriptions = {}
  } = params;

  const baseTargetPrice = params.baseTargetPrice ?? (params as any).fairValue ?? currentPrice;

  const diagnostics: string[] = [];

  if (!currentPrice || currentPrice <= 0 || !Number.isFinite(currentPrice)) {
    diagnostics.push(`Invalid current price for scenarios: ${currentPrice}`);
    return createEmptyScenarioSet(currentPrice, diagnostics);
  }

  if (!baseTargetPrice || baseTargetPrice <= 0 || !Number.isFinite(baseTargetPrice)) {
    diagnostics.push(`Invalid base target price for scenarios: ${baseTargetPrice}`);
    return createEmptyScenarioSet(currentPrice, diagnostics);
  }

  // Derive target prices with strict limited liability non-negative floor ($0.01)
  const rawBullPrice = Math.max(0.01, bullTarget !== undefined ? bullTarget : baseTargetPrice * bullMultiplier);
  const rawBasePrice = Math.max(0.01, baseTargetPrice);
  const rawBearPrice = Math.max(0.01, bearTarget !== undefined ? bearTarget : baseTargetPrice * bearMultiplier);

  // Round to 2 decimal places
  const bullPrice = Math.max(0.01, Math.round(rawBullPrice * 100) / 100);
  const basePrice = Math.max(0.01, Math.round(rawBasePrice * 100) / 100);
  const bearPrice = Math.max(0.01, Math.round(rawBearPrice * 100) / 100);

  // Monotonicity Check
  if (bullPrice < basePrice) {
    diagnostics.push(`Bull price (${bullPrice}) is lower than Base price (${basePrice}). Inverted scenario.`);
  }
  if (basePrice < bearPrice) {
    diagnostics.push(`Base price (${basePrice}) is lower than Bear price (${bearPrice}). Inverted scenario.`);
  }

  // Exact mathematical implied returns: (targetPrice / currentPrice) - 1
  const bullReturn = (bullPrice / currentPrice) - 1;
  const baseReturn = (basePrice / currentPrice) - 1;
  const bearReturn = (bearPrice / currentPrice) - 1;

  // Validate probabilities sum to 100%
  const probSum = probabilities.bull + probabilities.base + probabilities.bear;
  if (Math.abs(probSum - 1.0) > 0.01) {
    diagnostics.push(`Scenario probabilities must sum to 1.0 (100%), got ${probSum.toFixed(3)}.`);
  }

  const expectedPrice = Math.round(
    (bullPrice * probabilities.bull + basePrice * probabilities.base + bearPrice * probabilities.bear) * 100
  ) / 100;

  const weightedReturn = (expectedPrice / currentPrice) - 1;

  const status: "valid" | "invalid" = diagnostics.length === 0 ? "valid" : "invalid";

  return {
    currentPrice,
    bull: {
      name: "bull",
      targetPrice: bullPrice,
      impliedReturn: Number(bullReturn.toFixed(4)),
      probability: probabilities.bull,
      description: descriptions.bull || "Accelerated market share gains, robust volume execution, and multiple expansion.",
    },
    base: {
      name: "base",
      targetPrice: basePrice,
      impliedReturn: Number(baseReturn.toFixed(4)),
      probability: probabilities.base,
      description: descriptions.base || "Fundamental discounted cash-flow baseline reflecting steady operational compounding.",
    },
    bear: {
      name: "bear",
      targetPrice: bearPrice,
      impliedReturn: Number(bearReturn.toFixed(4)),
      probability: probabilities.bear,
      description: descriptions.bear || "Downside macroeconomic contraction, margin compression from competitive pricing pressure, or execution delays.",
    },
    expectedPrice: expectedPrice,
    weightedReturn: Number(weightedReturn.toFixed(4)),
    status,
    diagnostics
  };
}

function createEmptyScenarioSet(currentPrice: number, diagnostics: string[]): ScenarioSet {
  const p = Math.max(0.01, currentPrice || 1);
  return {
    currentPrice: p,
    bull: { name: "bull", targetPrice: Math.max(0.01, Math.round(p * 1.25 * 100) / 100), impliedReturn: 0.25 },
    base: { name: "base", targetPrice: Math.max(0.01, Math.round(p * 100) / 100), impliedReturn: 0 },
    bear: { name: "bear", targetPrice: Math.max(0.01, Math.round(p * 0.75 * 100) / 100), impliedReturn: -0.25 },
    diagnostics,
    status: "invalid",
  };
}

/**
 * Validates an existing scenario set for mathematical integrity and ordering.
 */
export function validateScenarioSet(scenarios: ScenarioSet): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const { currentPrice, bull, base, bear } = scenarios;

  if (!currentPrice || currentPrice <= 0) {
    issues.push("Current price must be positive for scenario validation.");
  }

  if (bull.targetPrice <= 0 || base.targetPrice <= 0 || bear.targetPrice <= 0) {
    issues.push(`Target price positivity violation: Bull (${bull.targetPrice}), Base (${base.targetPrice}), and Bear (${bear.targetPrice}) must be strictly positive under corporate limited liability.`);
  }

  // Ordering
  if (bull.targetPrice < base.targetPrice) {
    issues.push(`Scenario order violation: Bull target (${bull.targetPrice}) < Base target (${base.targetPrice}).`);
  }
  if (base.targetPrice < bear.targetPrice) {
    issues.push(`Scenario order violation: Base target (${base.targetPrice}) < Bear target (${bear.targetPrice}).`);
  }

  // Mathematical accuracy of implied returns
  const tolerance = 0.005; // 0.5% tolerance for rounding
  if (currentPrice > 0) {
    const expectedBullReturn = (bull.targetPrice / currentPrice) - 1;
    if (Math.abs(bull.impliedReturn - expectedBullReturn) > tolerance) {
      issues.push(
        `Bull implied return (${(bull.impliedReturn * 100).toFixed(1)}%) diverges from formula (target/cmp - 1 = ${(expectedBullReturn * 100).toFixed(1)}%).`
      );
    }

    const expectedBaseReturn = (base.targetPrice / currentPrice) - 1;
    if (Math.abs(base.impliedReturn - expectedBaseReturn) > tolerance) {
      issues.push(
        `Base implied return (${(base.impliedReturn * 100).toFixed(1)}%) diverges from formula (target/cmp - 1 = ${(expectedBaseReturn * 100).toFixed(1)}%).`
      );
    }

    const expectedBearReturn = (bear.targetPrice / currentPrice) - 1;
    if (Math.abs(bear.impliedReturn - expectedBearReturn) > tolerance) {
      issues.push(
        `Bear implied return (${(bear.impliedReturn * 100).toFixed(1)}%) diverges from formula (target/cmp - 1 = ${(expectedBearReturn * 100).toFixed(1)}%).`
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
