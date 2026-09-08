/**
 * APEX RESEARCH - Dynamic Sector Valuation Model Selector
 * 
 * Strict Financial Invariant:
 * Selects the economically appropriate valuation framework based on sector taxonomy:
 *   - Banks & NBFCs: Residual Income / Justified P/B (FCFF is forbidden due to deposit operating liabilities)
 *   - Industrials / IT / Pharma / Renewables: 5-Year FCFF DCF
 *   - Discredited or non-positive valuations produce explicit status: "insufficient_data" and "NR"
 */

import { classifySector, SectorProfile } from "../sectors";
import { computeDCF } from "../calculations";
import { computeResidualIncomeValuation, ResidualIncomeResult } from "./residual-income";
import { calibrateValuation, ValuationCalibrationResult } from "./calibration";
import type { CompanyProfile, StockData, AnnualFinancials, DCFResult } from "@/types/report";
import type { ArchetypeProfile } from "../company-archetype";

export interface ValuationSelectionResult {
  selectedModel: "FCFF_DCF" | "PB_RESIDUAL_INCOME";
  sectorProfile: SectorProfile;
  dcf: DCFResult;
  residualIncome?: ResidualIncomeResult;
  fairValue: number | null;
  upside: number | null;
  rating: "BUY" | "HOLD" | "SELL" | "NR";
  calibration?: ValuationCalibrationResult;
  diagnostics: string[];
}

export function selectAndComputeValuation(params: {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  archetypeProfile?: ArchetypeProfile;
}): ValuationSelectionResult {
  const { profile, stockData, annualFinancials, archetypeProfile } = params;

  const sectorProfile = classifySector(profile.sector, profile.industry, profile.description);
  const latest = annualFinancials[annualFinancials.length - 1];

  // 1. If company is a Bank, NBFC, Insurer, or Ratings Agency (Financial Institution)
  if (sectorProfile.isFinancialInstitution && latest) {
    const totalEquity = latest.totalEquity;
    const netIncome = latest.netIncome;
    const sharesOutstanding = stockData.sharesOutstanding || latest.sharesOutstanding || 1;
    const currentPrice = stockData.currentPrice;

    // Item 8: CAPM Cost of Equity with beta sanity range bounds [0.35, 2.50]
    let rawBeta = stockData.beta;
    if (rawBeta === undefined || rawBeta === null || !Number.isFinite(rawBeta) || rawBeta <= 0) {
      rawBeta = 0.85;
    } else if (rawBeta < 0.35) {
      rawBeta = 0.35;
    } else if (rawBeta > 2.50) {
      rawBeta = 2.50;
    }
    const blumeBeta = 0.67 * rawBeta + 0.33 * 1.0;
    const effectiveBeta = Math.max(0.65, Math.min(1.35, blumeBeta));
    const costOfEquity = Math.max(0.095, Math.min(0.145, 0.0685 + effectiveBeta * 0.060));

    // Sustainable / Normalized ROE by financial sub-sector:
    const validRoes = annualFinancials
      .filter(f => f.totalEquity > 0 && f.netIncome > 0)
      .map(f => f.netIncome / f.totalEquity);
    const histAvgRoe = validRoes.length > 0 ? validRoes.reduce((a, b) => a + b, 0) / validRoes.length : 0;
    const reportedRoe = stockData.returnOnEquity && stockData.returnOnEquity > 0 ? stockData.returnOnEquity : 0;
    const latestRoe = totalEquity > 0 ? netIncome / totalEquity : 0;

    // Sector-calibrated ROE floor: Ratings agencies (22.0%), Insurers (15.0%), Banks/NBFCs (14.5%)
    const roeFloor = sectorProfile.id === "ratings-agency"
      ? 0.220
      : sectorProfile.id === "insurance"
      ? 0.150
      : 0.145;

    const sustainableRoe = Math.max(latestRoe, histAvgRoe, reportedRoe, roeFloor);
    const terminalGrowth = 0.05;

    const riResult = computeResidualIncomeValuation({
      currentPrice,
      sharesOutstanding,
      totalEquity,
      netIncome,
      costOfEquity,
      terminalGrowth,
      sustainableRoe
    });

    const isValValid = riResult.status === "valid" && riResult.fairValuePerShare !== null;
    const fairValue = isValValid ? riResult.fairValuePerShare : null;
    const upside = riResult.upsideDownside;
    const rating = riResult.verdict;

    // Items 7 & 10: Sector-relative calibration & decile ranking
    const calibration = calibrateValuation({
      upside,
      sectorId: sectorProfile.id
    });

    // Adapt into DCFResult shape for unified presentation layer
    const adaptedDcf: DCFResult = {
      status: riResult.status,
      diagnostics: [...riResult.diagnostics, ...calibration.diagnostics],
      assumptions: {
        riskFreeRate: 0.0685,
        equityRiskPremium: 0.060,
        beta: Number(effectiveBeta.toFixed(3)),
        costOfEquity: Number(costOfEquity.toFixed(4)),
        costOfDebtPreTax: 0.08,
        marginalTaxRate: 0.25,
        costOfDebtPostTax: 0.06,
        debtWeight: 0.85,
        equityWeight: 0.15,
        wacc: Number(costOfEquity.toFixed(4)), // Cost of equity used as hurdle for financial institutions
        terminalGrowthRate: terminalGrowth,
        revenueGrowthRates: [0.15, 0.14, 0.13, 0.12, 0.10],
        ebitMargins: [0.25, 0.25, 0.25, 0.25, 0.25]
      },
      projections: [],
  assumptionBasis: {
    revenueGrowth: "Not applicable — residual-income model values financials on sustainable ROE, not revenue trajectory.",
    ebitMargin: "Not applicable — residual-income model; earnings power captured via sustainable ROE below.",
    capex: "Not applicable — bank/NBFC capex is non-material to the residual-income bridge.",
    workingCapital: "Not applicable — deposits/borrowings are operating liabilities for financials.",
    netDebt: "Not applicable — no EV bridge for financials; deposits are operating liabilities, equity valued directly.",
    wacc: `Cost of equity ${(costOfEquity * 100).toFixed(1)}% as hurdle (Rf 6.85% + beta ${effectiveBeta.toFixed(2)} × ERP 6.0%, clamped 9.5–14.5%)`,
        terminal: `Sustainable ROE ${(sustainableRoe * 100).toFixed(1)}% (max of latest, historical average, reported, and ${(roeFloor * 100).toFixed(1)}% floor) growing at ${(terminalGrowth * 100).toFixed(1)}% terminal`,
      },
      sumPvFcff: 0,
      terminalYearFcff: 0,
      terminalValue: riResult.equityValue || 0,
      pvTerminalValue: riResult.equityValue || 0,
      enterpriseValue: riResult.equityValue || 0,
      lessDebt: 0,
      plusCash: 0,
      equityValue: riResult.equityValue || 0,
      sharesOutstanding,
      intrinsicValue: fairValue || 0,
      fairValuePerShare: fairValue,
      currentMarketPrice: currentPrice,
      upsideDownside: upside || 0,
      verdict: rating
    };

    return {
      selectedModel: "PB_RESIDUAL_INCOME",
      sectorProfile,
      dcf: adaptedDcf,
      residualIncome: riResult,
      fairValue,
      upside,
      rating,
      calibration,
      diagnostics: riResult.diagnostics
    };
  }

  // 2. Non-financial institutions: Standard FCFF DCF with archetype & sector integration
  const standardDcf = computeDCF(annualFinancials, stockData, sectorProfile, archetypeProfile, profile.country);
  const fairValue = standardDcf.fairValuePerShare || (standardDcf.intrinsicValue > 0 ? standardDcf.intrinsicValue : null);
  const upside = standardDcf.upsideDownside;
  const rating = standardDcf.verdict;

  // Items 7 & 10: Sector-relative calibration & decile ranking
  const calibration = calibrateValuation({
    upside,
    sectorId: sectorProfile.id
  });

  return {
    selectedModel: "FCFF_DCF",
    sectorProfile,
    dcf: standardDcf,
    fairValue,
    upside,
    rating,
    calibration,
    diagnostics: [...(standardDcf.diagnostics || []), ...calibration.diagnostics]
  };
}
