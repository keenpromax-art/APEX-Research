/**
 * APEX RESEARCH - Residual Income & Justified P/B Valuation Engine
 * 
 * Strict Financial Invariant:
 * Standard FCFF DCF is economically invalid for Banks, NBFCs, and Microfinance firms
 * because deposits/debt represent primary raw operating inventory, not capital structure leverage.
 * 
 * For Financial Institutions, valuation is anchored on:
 *   1. Residual Income (Excess Return over Cost of Equity)
 *   2. Justified Price-to-Book: P/B = (ROE - g) / (Ke - g)
 */

export interface ResidualIncomeResult {
  status: "valid" | "insufficient_data" | "invalid_inputs" | "calculation_error";
  bookValuePerShare: number | null;
  roe: number;
  costOfEquity: number;
  terminalGrowth: number;
  justifiedPB: number | null;
  fairValuePerShare: number | null;
  equityValue: number | null;
  upsideDownside: number | null;
  verdict: "BUY" | "HOLD" | "SELL" | "NR";
  diagnostics: string[];
}

export function computeResidualIncomeValuation(params: {
  currentPrice: number;
  sharesOutstanding: number;
  totalEquity: number;
  netIncome: number;
  costOfEquity?: number;    // e.g. 0.12 (12%)
  terminalGrowth?: number;  // e.g. 0.05 (5%)
  sustainableRoe?: number;  // Normalized cycle ROE override (e.g. 0.15 for 15%)
}): ResidualIncomeResult {
  const {
    currentPrice,
    sharesOutstanding,
    totalEquity,
    netIncome,
    costOfEquity = 0.125,
    terminalGrowth = 0.05,
    sustainableRoe
  } = params;

  const diagnostics: string[] = [];

  if (!sharesOutstanding || sharesOutstanding <= 0) {
    diagnostics.push("Invalid shares outstanding for Residual Income model.");
    return createEmptyResidualResult(diagnostics);
  }

  if (!totalEquity || totalEquity <= 0) {
    diagnostics.push("Book value of equity is non-positive or missing.");
    return createEmptyResidualResult(diagnostics);
  }

  const bvps = totalEquity / sharesOutstanding;
  const rawRoe = totalEquity > 0 ? netIncome / totalEquity : 0;
  const roe = sustainableRoe !== undefined && sustainableRoe > 0 ? sustainableRoe : rawRoe;

  if (roe <= 0) {
    diagnostics.push(`Negative or zero ROE (${(roe * 100).toFixed(1)}%); residual income model requires sustained economic returns.`);
  }

  // Justified P/B = (ROE - g) / (Ke - g)
  // Ke must be strictly greater than g
  const denominator = Math.max(0.02, costOfEquity - terminalGrowth);
  const rawJustifiedPB = (roe - terminalGrowth) / denominator;

  // Floor justified P/B at 0.4x and cap at 4.5x for financial safety
  const justifiedPB = Math.max(0.4, Math.min(4.5, Number.isFinite(rawJustifiedPB) && rawJustifiedPB > 0 ? rawJustifiedPB : 1.0));

  // Modeled Fair Value per Share
  const fairValuePerShare = Math.round(bvps * justifiedPB * 100) / 100;
  const equityValue = Math.round(fairValuePerShare * sharesOutstanding);

  const upside = currentPrice > 0 ? (fairValuePerShare / currentPrice) - 1 : null;

  let verdict: "BUY" | "HOLD" | "SELL" | "NR" = "HOLD";
  if (upside === null) {
    verdict = "NR";
  } else if (upside > 0.12) {
    verdict = "BUY";
  } else if (upside < -0.12) {
    verdict = "SELL";
  } else {
    verdict = "HOLD";
  }

  return {
    status: "valid",
    bookValuePerShare: Math.round(bvps * 100) / 100,
    roe: Number(roe.toFixed(4)),
    costOfEquity,
    terminalGrowth,
    justifiedPB: Number(justifiedPB.toFixed(2)),
    fairValuePerShare,
    equityValue,
    upsideDownside: upside !== null ? Number(upside.toFixed(4)) : null,
    verdict,
    diagnostics
  };
}

function createEmptyResidualResult(diagnostics: string[]): ResidualIncomeResult {
  return {
    status: "insufficient_data",
    bookValuePerShare: null,
    roe: 0,
    costOfEquity: 0.12,
    terminalGrowth: 0.05,
    justifiedPB: null,
    fairValuePerShare: null,
    equityValue: null,
    upsideDownside: null,
    verdict: "NR",
    diagnostics
  };
}
