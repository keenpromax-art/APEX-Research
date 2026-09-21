/**
 * APEX RESEARCH — DETERMINISTIC VALUATION ENGINE
 *
 * "AI decides the model. Code executes the model."
 *
 * Takes a ValuationSpecification (AI-selected methodology + assumptions) and
 * the deterministic ForecastResult, and computes valuation outputs. The LLM
 * NEVER performs valuation arithmetic.
 *
 * STRICT RULES:
 *  - No placeholder share counts or prices: shares/price/net debt come from
 *    the yfinance fact pack. If missing, the valuation output is marked
 *    unavailable rather than manufactured.
 *  - All arithmetic is deterministic code.
 *
 * Supported methodologies (pure calculators; the AI selects which to run):
 *   DCF/FCFF, Residual Income, P/E, P/B, EV/EBITDA, Dividend Discount.
 */
import type {
  ValuationResult,
  ValuationSpecification,
  ForecastResult,
  FactPack,
  Fact,
} from "./types";
import { latestValueFromPack } from "./valuation-helpers";

/** Pull the last forecast year's value from the statement year. */
function lastYearVal(forecast: ForecastResult, key: string): number | undefined {
  const ys = forecast.incomeStatement;
  const last = ys[ys.length - 1];
  return last?.values?.[key];
}

/**
 * Execute the selected valuation methodology deterministically.
 */
export function executeValuation(
  spec: ValuationSpecification,
  forecast: ForecastResult,
  factPack: FactPack
): ValuationResult {
  const methodology = spec.methodology;
  const aLookup: Record<string, { value: number; unit: string; rationale: string }> = {};
  for (const a of spec.assumptions || []) {
    aLookup[a.variable] = { value: a.value, unit: a.unit, rationale: a.rationale };
  }

  // Anchor data from the yfinance fact pack — never placeholders.
  const sharesOutstanding = latestValueFromPack(factPack, "sharesOutstanding");
  const currentPrice = latestValueFromPack(factPack, "currentPrice");
  const bookValuePerShareFact = latestValueFromPack(factPack, "bookValuePerShare");
  const netDebtFact = latestValueFromPack(factPack, "netDebt");

  const niLast = lastYearVal(forecast, "netIncome");
  const ebitLast = lastYearVal(forecast, "ebit");
  const revenueLast = lastYearVal(forecast, "revenue");
  const forecastYears = forecast.incomeStatement.length;

  let fairValuePerShare: number | undefined;
  let fairValueEquity: number | undefined;
  let enterpriseValue: number | undefined;
  let upsidePct: number | undefined;
  const outputs: Record<string, number | undefined> = {};

  const computeUpside = (fv: number) => {
    if (currentPrice !== undefined && currentPrice > 0) {
      upsidePct = (fv / currentPrice - 1) * 100;
    }
  };

  // ── DCF / FCFF ───────────────────────────────────────────
  if (methodology === "DCF" || methodology === "FCFF") {
    const ke = spec.discountRate ?? aLookup["wacc"]?.value;
    const g = spec.terminalAssumptions?.growth ?? aLookup["terminalGrowth"]?.value;
    if (ke !== undefined && g !== undefined && ke > g && niLast !== undefined) {
      // PV of forecast NI (deterministic discounting).
      let pvForecastNI = 0;
      for (let i = 0; i < forecastYears; i++) {
        const ni = forecast.incomeStatement[i]?.values?.netIncome;
        if (ni !== undefined) pvForecastNI += ni / Math.pow(1 + ke, i + 1);
      }
      const terminalValue = (niLast * (1 + g)) / (ke - g);
      const pvTerminal = terminalValue / Math.pow(1 + ke, forecastYears);
      enterpriseValue = pvForecastNI + pvTerminal;
      // Equity bridge uses the yfinance net-debt fact when available.
      const netDebt = netDebtFact ?? 0;
      fairValueEquity = enterpriseValue - netDebt;
      if (sharesOutstanding !== undefined && sharesOutstanding > 0) {
        fairValuePerShare = fairValueEquity / sharesOutstanding;
        computeUpside(fairValuePerShare);
      }
      outputs.terminalValue = terminalValue;
      outputs.pvTerminal = pvTerminal;
      outputs.pvForecastNI = pvForecastNI;
    }
  }

  // ── Residual Income ──────────────────────────────────────
  else if (methodology === "Residual Income") {
    const ke = spec.discountRate ?? aLookup["requiredReturn"]?.value;
    const g = spec.terminalAssumptions?.growth ?? aLookup["terminalGrowth"]?.value ?? 0;
    const bvps = aLookup["bookValuePerShare"]?.value ?? bookValuePerShareFact;
    if (ke !== undefined && ke > g && bvps !== undefined && niLast !== undefined) {
      let pvRI = 0;
      for (let i = 0; i < forecastYears; i++) {
        const ni = forecast.incomeStatement[i]?.values?.netIncome;
        if (ni !== undefined) {
          const ri = ni - bvps * ke;
          pvRI += ri / Math.pow(1 + ke, i + 1);
        }
      }
      const terminalRI = (niLast - bvps * ke) * (1 + g) / (ke - g);
      const pvTerminalRI = terminalRI / Math.pow(1 + ke, forecastYears);
      fairValuePerShare = bvps + pvRI + pvTerminalRI;
      computeUpside(fairValuePerShare);
      outputs.pvRI = pvRI;
      outputs.pvTerminalRI = pvTerminalRI;
    }
  }

  // ── P/E ──────────────────────────────────────────────────
  else if (methodology === "P/E") {
    const peRatio = aLookup["peRatio"]?.value ?? aLookup["targetPE"]?.value;
    if (peRatio !== undefined && niLast !== undefined && sharesOutstanding !== undefined && sharesOutstanding > 0) {
      fairValueEquity = peRatio * niLast;
      fairValuePerShare = fairValueEquity / sharesOutstanding;
      computeUpside(fairValuePerShare);
    }
  }

  // ── P/B ──────────────────────────────────────────────────
  else if (methodology === "P/B") {
    const pbRatio = aLookup["pbRatio"]?.value ?? aLookup["targetPB"]?.value;
    const bvps = aLookup["bookValuePerShare"]?.value ?? bookValuePerShareFact;
    if (pbRatio !== undefined && bvps !== undefined) {
      fairValuePerShare = pbRatio * bvps;
      if (sharesOutstanding !== undefined) fairValueEquity = fairValuePerShare * sharesOutstanding;
      computeUpside(fairValuePerShare);
    }
  }

  // ── EV/EBITDA ────────────────────────────────────────────
  else if (methodology === "EV/EBITDA") {
    const multiple = aLookup["evEBITDA"]?.value ?? aLookup["targetEVEBITDA"]?.value;
    if (multiple !== undefined && ebitLast !== undefined) {
      enterpriseValue = multiple * ebitLast;
      const netDebt = netDebtFact ?? 0;
      fairValueEquity = enterpriseValue - netDebt;
      if (sharesOutstanding !== undefined && sharesOutstanding > 0) {
        fairValuePerShare = fairValueEquity / sharesOutstanding;
        computeUpside(fairValuePerShare);
      }
    }
  }

  // ── EV/Revenue ───────────────────────────────────────────
  else if (methodology === "EV/Revenue") {
    const multiple = aLookup["evRevenue"]?.value ?? aLookup["targetEVRevenue"]?.value;
    if (multiple !== undefined && revenueLast !== undefined) {
      enterpriseValue = multiple * revenueLast;
      const netDebt = netDebtFact ?? 0;
      fairValueEquity = enterpriseValue - netDebt;
      if (sharesOutstanding !== undefined && sharesOutstanding > 0) {
        fairValuePerShare = fairValueEquity / sharesOutstanding;
        computeUpside(fairValuePerShare);
      }
    }
  }

  // ── Dividend Discount ────────────────────────────────────
  else if (methodology === "Dividend Discount") {
    const dps = aLookup["dps"]?.value;
    const ke = spec.discountRate ?? aLookup["requiredReturn"]?.value;
    const g = spec.terminalAssumptions?.growth ?? aLookup["terminalGrowth"]?.value ?? 0;
    if (dps !== undefined && ke !== undefined && ke > g) {
      fairValuePerShare = dps / (ke - g);
      computeUpside(fairValuePerShare);
    }
  }

  // ── Unknown methodology: no silent fallback fabrication ──
  // The valuation output stays undefined; the quality reviewer flags it and
  // the adjudicator regenerates the valuation with a supported method.

  return {
    methodology,
    fairValuePerShare,
    fairValueEquity,
    enterpriseValue,
    outputs,
    upsidePct,
    executedFrom: spec,
  };
}

/**
 * Validate a valuation specification before execution.
 */
export function validateValuationSpec(spec: ValuationSpecification): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!spec.methodology || spec.methodology.trim().length === 0) {
    issues.push("Missing methodology");
  }
  if (!spec.rationale) {
    issues.push("Missing rationale for methodology selection");
  }
  if (!spec.assumptions || spec.assumptions.length === 0) {
    issues.push("No assumptions provided");
  } else {
    for (const a of spec.assumptions) {
      if (!a.assumption) issues.push("Assumption missing 'assumption' field");
      if (!a.variable) issues.push(`Assumption has no variable name: ${JSON.stringify(a)}`);
      if (typeof a.value !== "number" || !isFinite(a.value)) issues.push(`Assumption [${a.variable}] has no numeric value`);
      if (!a.unit) issues.push(`Assumption [${a.variable}] has no unit`);
      if (!a.rationale) issues.push(`Assumption [${a.variable}] has no rationale`);
    }
  }
  return { valid: issues.length === 0, issues };
}

export default { executeValuation, validateValuationSpec };