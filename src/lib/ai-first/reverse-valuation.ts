/**
 * APEX RESEARCH — AI REVERSE VALUATION
 *
 * The AI determines which variable is most useful to reverse-engineer for
 * THIS company (required revenue CAGR, required EBIT margin, required ROE,
 * required NIM, required subscriber growth, required ARPU...). Dynamic —
 * not one fixed reverse-DCF framework for every company.
 *
 * PRINCIPLE: AI decides WHAT to solve for. Code solves the arithmetic.
 */
import type {
  FactPack,
  CompanyUnderstanding,
  ValuationResult,
  ValuationSpecification,
  ForecastSpecification,
  ForecastResult,
  Fact,
} from "./types";

export interface ReverseValuationSpec {
  /** The variable the AI chose to reverse-engineer. */
  variable: string;
  /** Why this variable is the most informative for this company. */
  why: string;
  unit: string;
}

/**
 * AI chooses the reverse-valuation variable from the company understanding.
 * Deterministic heuristic over the AI's own analysis (no hardcoded framework):
 * the primary economic abstraction anchors the choice.
 */
export function chooseReverseVariable(
  understanding: CompanyUnderstanding,
  valuation: ValuationResult
): ReverseValuationSpec | null {
  const abstraction = understanding.primaryEconomicAbstraction.toLowerCase();
  const hasFV = valuation.fairValuePerShare !== undefined;

  // The AI's understanding stage determines which abstraction is primary;
  // we map the abstraction to the variable worth solving for.
  if (abstraction.includes("net interest income") || abstraction.includes("nim")) {
    return hasFV
      ? { variable: "nim", why: "Net interest margin is the primary economic lever for this bank; solving for the NIM the current price implies stress-tests the market's credit/growth expectations.", unit: "decimal" }
      : null;
  }
  if (abstraction.includes("net asset") || abstraction.includes("book value")) {
    return hasFV
      ? { variable: "roe", why: "Returns on book value drive this company's economics; solving for the implied ROE tests whether the price is consistent with achievable returns.", unit: "decimal" }
      : null;
  }
  if (abstraction.includes("subscriber") || abstraction.includes("arpu")) {
    return hasFV
      ? { variable: "arpu", why: "Subscriber monetization drives this platform's economics; solving for the implied ARPU tests the growth-monetization balance the market prices in.", unit: "currency" }
      : null;
  }
  if (abstraction.includes("volume") || abstraction.includes("vehicle")) {
    return hasFV
      ? { variable: "revenueCagr", why: "Volume-driven economics make revenue growth the pivotal assumption; solving for the required revenue CAGR tests how much growth the price demands.", unit: "decimal" }
      : null;
  }
  // Default: revenue CAGR when no specific abstraction matches.
  return hasFV
    ? { variable: "revenueCagr", why: "Revenue growth is the pivotal forecast assumption; solving for the required CAGR tests how much growth the current price demands.", unit: "decimal" }
    : null;
}

/**
 * Solve for the required value of the chosen variable such that the
 * deterministic model's fair value equals the current market price.
 * Bisection over the AI model's forecast — code does the arithmetic.
 */
export function solveRequiredValue(
  chosen: ReverseValuationSpec,
  currentPrice: number | undefined,
  solveFn: (candidateValue: number) => number | undefined
): { variable: string; requiredValue: number; interpretation: string } | null {
  if (currentPrice === undefined || currentPrice <= 0) return null;

  // Bisection bounds depend on the variable kind.
  let lo = chosen.variable === "revenueCagr" ? -0.2 : 0;
  let hi = chosen.variable === "nim" || chosen.variable === "roe" ? 0.4 : 0.6;
  const fairAt = (x: number) => solveFn(x);

  // Require monotone increasing fair value in the candidate value.
  let fLo = fairAt(lo);
  let fHi = fairAt(hi);
  if (fLo === undefined || fHi === undefined || fLo >= fHi) return null;
  if (currentPrice < fLo || currentPrice > fHi) {
    // Price outside the bracket — report the boundary interpretation.
    const boundary = currentPrice < fLo ? lo : hi;
    return {
      variable: chosen.variable,
      requiredValue: boundary,
      interpretation:
        currentPrice < fLo
          ? `The current price implies a ${chosen.variable} below ${lo} — even the bear-case ${chosen.variable} overprices the stock at these assumptions.`
          : `The current price implies a ${chosen.variable} above ${hi} — the market is pricing in extraordinary ${chosen.variable}.`,
    };
  }

  // Bisection: 40 iterations → precision ~1e-12 of the bracket.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const fMid = fairAt(mid);
    if (fMid === undefined) return null;
    if (fMid < currentPrice) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
      fHi = fMid;
    }
  }
  const required = (lo + hi) / 2;
  const pct = chosen.unit === "decimal" ? `${(required * 100).toFixed(1)}%` : String(Math.round(required * 100) / 100);
  return {
    variable: chosen.variable,
    requiredValue: required,
    interpretation: `The current price of ${currentPrice} implies a required ${chosen.variable} of ${pct} under the AI model's other assumptions.`,
  };
}

/**
 * Convenience: build the solve function for a revenue-CAGR reverse run by
 * re-executing the deterministic forecast + valuation with shifted growth.
 */
export function buildRevenueCagrSolver(
  factPack: FactPack,
  forecastSpec: import("./types").ForecastSpecification,
  valuationSpec: import("./types").ValuationSpecification,
  executeForecast: (input: { model: import("./types").ForecastSpecification; factPack: FactPack }) => { forecast: ForecastResult },
  executeValuation: (spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack) => ValuationResult
): (cagr: number) => number | undefined {
  return (cagr: number) => {
    // Shift every input variable's growth path to the candidate CAGR.
    const adjusted: import("./types").ForecastSpecification = {
      ...forecastSpec,
      driverPaths: Object.fromEntries(
        Object.entries(forecastSpec.driverPaths).map(([k, path]) => [k, path.map(() => cagr)])
      ),
    };
    const out = executeForecast({ model: adjusted, factPack });
    const valuation = executeValuation(valuationSpec, out.forecast, factPack);
    return valuation.fairValuePerShare;
  };
}

/** Price fact accessor. */
export function currentPriceOf(pack: FactPack): number | undefined {
  const f: Fact | undefined = pack.market.facts.find((x) => x.metric === "currentPrice" && x.value !== undefined);
  return f?.value;
}

export default { chooseReverseVariable, solveRequiredValue, buildRevenueCagrSolver, currentPriceOf };
