// ============================================================
// APEX RESEARCH — Financial Identity Validation Engine
// Enforces mathematical reconciliation across accounting identities
// ============================================================
import type { AnnualFinancials, StockData, DCFResult } from "@/types/report";

export type IssueSeverity = "FATAL" | "FLAG" | "INFO";

export interface IdentityIssue {
  code: string;
  severity: IssueSeverity;
  identityName: string;
  message: string;
  expected?: number | string | null;
  actual?: number | string | null;
  tolerance?: number;
  period?: string;
}

export interface FinancialValidationResult {
  isValid: boolean;
  hasFatalErrors: boolean;
  issues: IdentityIssue[];
  metricsAudited: number;
}

function withinTolerance(actual: number, expected: number, tolerancePct = 0.05): boolean {
  if (!isFinite(actual) || !isFinite(expected)) return false;
  if (expected === 0) return Math.abs(actual) < 1e-4;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerancePct;
}

export function validateFinancialIdentities(params: {
  annualFinancials: AnnualFinancials[];
  stockData: StockData;
  dcf?: DCFResult;
  isFinancialInstitution?: boolean;
}): FinancialValidationResult {
  const { annualFinancials, stockData, dcf, isFinancialInstitution = false } = params;
  const issues: IdentityIssue[] = [];
  let metricsAudited = 0;

  const latest = annualFinancials[annualFinancials.length - 1];

  if (!latest) {
    return {
      isValid: false,
      hasFatalErrors: true,
      issues: [
        {
          code: "NO_FINANCIAL_DATA",
          severity: "FATAL",
          identityName: "Financial History",
          message: "No annual financial statements found for validation.",
        },
      ],
      metricsAudited: 0,
    };
  }

  // 1. Check Accounting Chain: Revenue >= EBITDA >= EBIT (For Non-Financial Corporates)
  if (!isFinancialInstitution && latest.revenue > 0) {
    metricsAudited++;
    if (latest.ebitda > latest.revenue * 1.05) {
      issues.push({
        code: "EBITDA_EXCEEDS_REVENUE",
        severity: "FLAG",
        identityName: "Revenue >= EBITDA",
        message: `Reported EBITDA (${latest.ebitda}) exceeds reported revenue (${latest.revenue}). Verify if other operating income is included.`,
        expected: latest.revenue,
        actual: latest.ebitda,
        period: latest.year,
      });
    }

    metricsAudited++;
    // In ordinary operations with positive depreciation, EBITDA >= Operating Income (EBIT)
    if (latest.ebitda < latest.operatingIncome - 1e-3) {
      issues.push({
        code: "EBITDA_LESS_THAN_EBIT",
        severity: "FLAG",
        identityName: "EBITDA >= EBIT",
        message: `Operating Income EBIT (${latest.operatingIncome}) exceeds EBITDA (${latest.ebitda}), violating standard D&A add-back convention.`,
        expected: latest.ebitda,
        actual: latest.operatingIncome,
        period: latest.year,
      });
    }

    // 2. Margin Chain: Gross Margin >= EBITDA Margin >= EBIT Margin
    metricsAudited++;
    const gm = latest.grossMargin !== undefined ? latest.grossMargin : (latest.revenue > 0 && latest.grossProfit !== undefined ? latest.grossProfit / latest.revenue : 0);
    const em = latest.ebitdaMargin !== undefined ? latest.ebitdaMargin : (latest.revenue > 0 && latest.ebitda !== undefined ? latest.ebitda / latest.revenue : 0);
    if (gm > 0 && em > gm + 0.05) {
      issues.push({
        code: "EBITDA_MARGIN_EXCEEDS_GROSS",
        severity: "FLAG",
        identityName: "Gross Margin >= EBITDA Margin",
        message: `EBITDA margin (${(em * 100).toFixed(1)}%) exceeds gross margin (${(gm * 100).toFixed(1)}%).`,
        period: latest.year,
      });
    }
  }

  // 3. Market Capitalization: Market Cap ≈ Share Price × Shares Outstanding
  if (stockData.currentPrice > 0 && stockData.sharesOutstanding > 0 && stockData.marketCap > 0) {
    metricsAudited++;
    const expectedMktCap = stockData.currentPrice * stockData.sharesOutstanding;
    if (!withinTolerance(stockData.marketCap, expectedMktCap, 0.08)) {
      issues.push({
        code: "MARKET_CAP_DISCREPANCY",
        severity: "FLAG",
        identityName: "Market Cap ≈ Price × Shares",
        message: `Reported market cap (${stockData.marketCap}) deviates from Price × Shares (${expectedMktCap.toFixed(0)}). Check for share count units or currency scaling.`,
        expected: expectedMktCap,
        actual: stockData.marketCap,
        tolerance: 0.08,
      });
    }
  }

  // 4. EPS Reconciliation: EPS ≈ Net Income / Diluted Shares Outstanding
  const shares = stockData.sharesOutstanding || latest.sharesOutstanding;
  if (shares > 0 && latest.netIncome !== 0 && latest.eps != null && latest.eps !== 0) {
    metricsAudited++;
    const calculatedEps = latest.netIncome / shares;
    // Allow wider 20% tolerance due to weighted-average diluted shares difference
    if (!withinTolerance(latest.eps, calculatedEps, 0.25)) {
      issues.push({
        code: "EPS_CALCULATION_DRIFT",
        severity: "INFO",
        identityName: "EPS ≈ Net Income / Diluted Shares",
        message: `Reported EPS (${latest.eps.toFixed(2)}) differs from Net Income / Shares (${calculatedEps.toFixed(2)}), likely reflecting weighted-average share variations.`,
        expected: calculatedEps,
        actual: latest.eps,
        period: latest.year,
        tolerance: 0.25,
      });
    }
  }

  // 5. Cash Flow Identity: FCF ≈ Operating Cash Flow - Capital Expenditures
  if (latest.operatingCashFlow !== undefined && latest.capitalExpenditures !== undefined && latest.freeCashFlow !== undefined) {
    metricsAudited++;
    const capex = Math.abs(latest.capitalExpenditures);
    const expectedFcf = latest.operatingCashFlow - capex;
    if (!withinTolerance(latest.freeCashFlow, expectedFcf, 0.05)) {
      issues.push({
        code: "FCF_CFO_CAPEX_MISMATCH",
        severity: "INFO",
        identityName: "FCF ≈ CFO - Capex",
        message: `Reported FCF (${latest.freeCashFlow}) differs from CFO - Capex (${expectedFcf.toFixed(0)}).`,
        expected: expectedFcf,
        actual: latest.freeCashFlow,
        period: latest.year,
        tolerance: 0.05,
      });
    }
  }

  // 6. Enterprise Value to Equity Value Bridge (Non-Financial Corporates Only):
  // EV = Equity Value + Net Debt  =>  Equity Value = EV - Net Debt
  // Financial institutions (Banks/NBFCs) do not have an EV bridge because deposits/borrowings are operating liabilities.
  // The expected bridge is recomputed INDEPENDENTLY from balance-sheet inputs
  // (including a recomputed captive-finance bound — the model's claimed offset
  // is verified against it, never trusted). An inflated offset fails here.
  if (!isFinancialInstitution && dcf && dcf.enterpriseValue > 0) {
    metricsAudited++;
    const cash = (latest.cash || 0) + (latest.shortTermInvestments || 0);
    const totalDebtVal = (latest.totalDebt || 0);
    const rawNetDebt = totalDebtVal - cash;
    const bsReceivables = Number((latest as any)?.netReceivables) || 0;
    const bsRevenue = Number((latest as any)?.revenue) || 0;
    const maxLegitOffset = bsRevenue > 0 && bsReceivables > 0 && totalDebtVal > 0
      ? Math.min(Math.max(0, bsReceivables - 0.20 * bsRevenue), totalDebtVal)
      : 0;
    const claimedOffset = Number((dcf as any)?.financeReceivablesOffset) || 0;
    const verifiedOffset = Math.min(Math.max(0, claimedOffset), maxLegitOffset);
    const expectedEquityValue = Math.max(0, dcf.enterpriseValue - (rawNetDebt - verifiedOffset));

    if (claimedOffset > maxLegitOffset + 1000) {
      issues.push({
        code: "DCF_EV_EQUITY_BRIDGE_FAIL",
        severity: "FATAL",
        identityName: "Captive-Finance Offset Bound",
        message: `DCF captive-finance offset (${claimedOffset}) exceeds the verifiable bound (${maxLegitOffset.toFixed(0)} = receivables − 20% trade allowance, capped at debt). Inflated adjustments prohibited.`,
        expected: maxLegitOffset,
        actual: claimedOffset,
        tolerance: 0.08,
      });
    } else if (dcf.equityValue > 0 && !withinTolerance(dcf.equityValue, expectedEquityValue, 0.08)) {
      issues.push({
        code: "DCF_EV_EQUITY_BRIDGE_FAIL",
        severity: "FATAL",
        identityName: "Equity Value = EV - Net Debt",
        message: `DCF Equity Value (${dcf.equityValue}) violates the Enterprise Value bridge: EV (${dcf.enterpriseValue}) - Net Debt (${(rawNetDebt - verifiedOffset).toFixed(0)}${verifiedOffset > 0 ? " incl. verified captive offset" : ""}) != Equity Value.`,
        expected: expectedEquityValue,
        actual: dcf.equityValue,
        tolerance: 0.08,
      });
    }

    // 7. Fair Value Per Share: Equity Value / Diluted Shares ≈ DCF Intrinsic Per Share
    if (dcf.equityValue > 0 && shares > 0 && dcf.intrinsicValue > 0) {
      metricsAudited++;
      const expectedPerShare = dcf.equityValue / shares;
      if (!withinTolerance(dcf.intrinsicValue, expectedPerShare, 0.08)) {
        issues.push({
          code: "DCF_PER_SHARE_MATH_FAIL",
          severity: "FATAL",
          identityName: "Fair Value = Equity Value / Diluted Shares",
          message: `DCF Intrinsic Per Share (${dcf.intrinsicValue}) violates Equity Value / Shares: ${dcf.equityValue} / ${shares} = ${expectedPerShare.toFixed(2)}.`,
          expected: expectedPerShare,
          actual: dcf.intrinsicValue,
          tolerance: 0.08,
        });
      }
    }
  }

  // 8. Balance Sheet Identity: Assets = Liabilities + Equity
  // Evaluates every audited period. If variance > 15%, triggers FATAL block.
  for (const fin of annualFinancials) {
    if (fin.totalAssets > 0) {
      metricsAudited++;
      const liabilities = (fin.totalLiabilities && fin.totalLiabilities > 0)
        ? fin.totalLiabilities
        : ((fin.totalDebt || 0) + (fin.currentLiabilities || 0));
      const liabAndEquity = liabilities + (fin.totalEquity || 0);
      const diff = Math.abs(fin.totalAssets - liabAndEquity);
      const varPct = (diff / fin.totalAssets) * 100;
      if (varPct > 15.0) {
        issues.push({
          code: "BALANCE_SHEET_IDENTITY_FATAL",
          severity: "FATAL",
          identityName: "Assets = Liabilities + Equity",
          message: `Balance sheet identity variance in ${fin.year} reaches ${varPct.toFixed(1)}% (Assets: ${fin.totalAssets}, Liabilities + Equity: ${liabAndEquity}). Financial model input integrity failure.`,
          expected: fin.totalAssets,
          actual: liabAndEquity,
          period: fin.year,
        });
      } else if (varPct > 5.0) {
        issues.push({
          code: "BALANCE_SHEET_IDENTITY_WARN",
          severity: "FLAG",
          identityName: "Assets = Liabilities + Equity",
          message: `Balance sheet classification variance in ${fin.year} is ${varPct.toFixed(1)}%. Note schedule adjustments.`,
          period: fin.year,
        });
      }
    }
  }

  // 9. Capital Structure Sanity: Debt / (Debt + Equity) vs Debt / Total Capital
  if (latest.totalDebt > 0 && latest.totalEquity > 0) {
    metricsAudited++;
    const debtToCapital = latest.totalDebt / (latest.totalDebt + latest.totalEquity);
    const debtToEquity = latest.totalDebt / latest.totalEquity;
    if (debtToEquity > 50.0 || debtToCapital > 0.95) {
      issues.push({
        code: "EXTREME_LEVERAGE_ANOMALY",
        severity: "FLAG",
        identityName: "Capital Structure Sanity",
        message: `Company exhibits extreme debt-to-equity (${(debtToEquity * 100).toFixed(0)}%) and debt-to-capital (${(debtToCapital * 100).toFixed(1)}%). Narrative must not characterize balance sheet as fortress or conservative.`,
        expected: "< 500%",
        actual: `${(debtToEquity * 100).toFixed(0)}%`,
        period: latest.year,
      });
    }
  }

  const hasFatalErrors = issues.some((i) => i.severity === "FATAL");

  return {
    isValid: !hasFatalErrors,
    hasFatalErrors,
    issues,
    metricsAudited,
  };
}
