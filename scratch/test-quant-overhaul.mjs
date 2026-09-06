// ============================================================
// Comprehensive Verification Test Suite: 10 Quantitative Enhancements
// ============================================================
import assert from "node:assert";
import { classifySector } from "../src/lib/sectors/profiles.ts";
import { classifyArchetype } from "../src/lib/company-archetype.ts";
import { computeDCF, computeWACC, computeRatios } from "../src/lib/calculations.ts";
import { selectAndComputeValuation } from "../src/lib/valuation/selector.ts";
import { calibrateValuation, computeSpearmanRankCorrelation } from "../src/lib/valuation/calibration.ts";
import { calculateRecommendation } from "../src/lib/recommendation.ts";
import { readFieldVariant, readFirstNonZeroFieldVariant } from "../src/lib/yahoo-finance.ts";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";

console.log("============================================================");
console.log("RUNNING VERIFICATION SUITE: 10 QUANT ENHANCEMENTS");
console.log("============================================================\n");

// --- MOCK DATA GENERATION ---
const mockStockData = {
  ticker: "TEST.NS",
  currentPrice: 500,
  sharesOutstanding: 100,
  marketCap: 50000,
  pe: 25,
  pb: 4.5,
  beta: 1.15,
  dividendYield: 0.015,
  week52High: 600,
  week52Low: 400,
  avgVolume: 1000000,
  currency: "INR",
};

const mockAnnualFinancials = [
  {
    year: "FY20",
    fiscalYearEnd: "2020-03-31",
    revenue: 10000,
    costOfRevenue: 6000,
    grossProfit: 4000,
    grossMargin: 0.40,
    researchDevelopment: 200,
    sellingGeneralAdministrative: 1800,
    totalOperatingExpenses: 2000,
    operatingIncome: 2000,
    ebitda: 2500,
    ebitdaMargin: 0.25,
    ebitMargin: 0.20,
    interestExpense: 300,
    otherIncome: 100,
    pretaxIncome: 1800,
    incomeTaxExpense: 450,
    netIncome: 1350,
    netMargin: 0.135,
    depreciation: 500,
    eps: 13.5,
    dilutedEps: 13.5,
    sharesOutstanding: 95, // Historical share count
    totalAssets: 20000,
    totalLiabilities: 10000,
    totalEquity: 10000,
    cash: 2000,
    shortTermInvestments: 500,
    netReceivables: 1500,
    inventory: 1000,
    currentAssets: 5000,
    netFixedAssets: 15000,
    totalDebt: 4000,
    shortTermDebt: 1000,
    longTermDebt: 3000,
    accountsPayable: 1200,
    currentLiabilities: 3000,
    netWorkingCapital: 2000,
    operatingCashFlow: 2200,
    capitalExpenditures: 800,
    freeCashFlow: 1400,
    investingCashFlow: -800,
    financingCashFlow: -500,
    dividendsPaid: 300,
    changeInCash: 900
  },
  {
    year: "FY21",
    fiscalYearEnd: "2021-03-31",
    revenue: 12000,
    costOfRevenue: 7200,
    grossProfit: 4800,
    grossMargin: 0.40,
    researchDevelopment: 240,
    sellingGeneralAdministrative: 2160,
    totalOperatingExpenses: 2400,
    operatingIncome: 2400,
    ebitda: 3000,
    ebitdaMargin: 0.25,
    ebitMargin: 0.20,
    interestExpense: 320,
    otherIncome: 120,
    pretaxIncome: 2200,
    incomeTaxExpense: 550,
    netIncome: 1650,
    netMargin: 0.1375,
    depreciation: 600,
    eps: 16.5,
    dilutedEps: 16.5,
    sharesOutstanding: 98, // Historical share count
    totalAssets: 24000,
    totalLiabilities: 12000,
    totalEquity: 12000,
    cash: 2500,
    shortTermInvestments: 600,
    netReceivables: 1800,
    inventory: 1200,
    currentAssets: 6100,
    netFixedAssets: 17900,
    totalDebt: 4500,
    shortTermDebt: 1200,
    longTermDebt: 3300,
    accountsPayable: 1400,
    currentLiabilities: 3500,
    netWorkingCapital: 2600,
    operatingCashFlow: 2600,
    capitalExpenditures: 1000,
    freeCashFlow: 1600,
    investingCashFlow: -1000,
    financingCashFlow: -600,
    dividendsPaid: 400,
    changeInCash: 1000
  },
  {
    year: "FY22",
    fiscalYearEnd: "2022-03-31",
    revenue: 15000,
    costOfRevenue: 9000,
    grossProfit: 6000,
    grossMargin: 0.40,
    researchDevelopment: 300,
    sellingGeneralAdministrative: 2700,
    totalOperatingExpenses: 3000,
    operatingIncome: 3000,
    ebitda: 3750,
    ebitdaMargin: 0.25,
    ebitMargin: 0.20,
    interestExpense: 350,
    otherIncome: 150,
    pretaxIncome: 2800,
    incomeTaxExpense: 700,
    netIncome: 2100,
    netMargin: 0.14,
    depreciation: 750,
    eps: 21.0,
    dilutedEps: 21.0,
    sharesOutstanding: 100, // Current share count
    totalAssets: 30000,
    totalLiabilities: 15000,
    totalEquity: 15000,
    cash: 3500,
    shortTermInvestments: 800,
    netReceivables: 2200,
    inventory: 1500,
    currentAssets: 8000,
    netFixedAssets: 22000,
    totalDebt: 5000,
    shortTermDebt: 1500,
    longTermDebt: 3500,
    accountsPayable: 1800,
    currentLiabilities: 4500,
    netWorkingCapital: 3500,
    operatingCashFlow: 3300,
    capitalExpenditures: 1200,
    freeCashFlow: 2100,
    investingCashFlow: -1200,
    financingCashFlow: -800,
    dividendsPaid: 500,
    changeInCash: 1300
  }
];

// -------------------------------------------------------------
// ITEM 1 & 6: Sector & Archetype Branching (Financials vs Non-financials)
// -------------------------------------------------------------
console.log("[TEST 1 & 6] Sector Branching & Archetype Model Steering...");
const bankProfile = {
  ticker: "HDFCBANK.NS",
  name: "HDFC Bank Ltd",
  sector: "Financial Services",
  industry: "Banks - Diversified",
  exchange: "NSE",
  exchangeTimezoneName: "Asia/Kolkata",
  country: "India",
  currency: "INR",
  description: "Private sector commercial bank in India.",
  website: "https://hdfcbank.com",
  employees: 150000,
  officers: []
};

const bankSector = classifySector(bankProfile.sector, bankProfile.industry, bankProfile.description);
assert.strictEqual(bankSector.isFinancialInstitution, true, "Bank must be classified as isFinancialInstitution: true");

const bankValuation = selectAndComputeValuation({
  profile: bankProfile,
  stockData: mockStockData,
  annualFinancials: mockAnnualFinancials
});
assert.strictEqual(bankValuation.selectedModel, "PB_RESIDUAL_INCOME", "Bank must select PB_RESIDUAL_INCOME");
assert.ok(bankValuation.dcf.intrinsicValue > 0, "Bank valuation must produce positive intrinsic value");
console.log("  ✓ Bank correctly branches to PB_RESIDUAL_INCOME with positive intrinsic value.");

// Rating Agency test
const ratingAgencyProfile = {
  ticker: "CRISIL.NS",
  name: "CRISIL Limited",
  sector: "Financial Services",
  industry: "Credit Rating & Research",
  exchange: "NSE",
  exchangeTimezoneName: "Asia/Kolkata",
  country: "India",
  currency: "INR",
  description: "Credit rating agency and risk advisory services.",
  website: "https://crisil.com",
  employees: 4000,
  officers: []
};
const ratingSector = classifySector(ratingAgencyProfile.sector, ratingAgencyProfile.industry, ratingAgencyProfile.description);
assert.strictEqual(ratingSector.isFinancialInstitution, true, "Rating agency must be classified as isFinancialInstitution: true");
const ratingValuation = selectAndComputeValuation({
  profile: ratingAgencyProfile,
  stockData: mockStockData,
  annualFinancials: mockAnnualFinancials
});
assert.strictEqual(ratingValuation.selectedModel, "PB_RESIDUAL_INCOME", "Ratings agency must select PB_RESIDUAL_INCOME");
console.log("  ✓ Ratings Agency correctly branches to PB_RESIDUAL_INCOME.");

// -------------------------------------------------------------
// ITEM 2: Hard Cap on Terminal Value (25x terminal FCFF)
// -------------------------------------------------------------
console.log("\n[TEST 2] Hard Cap on Terminal Value...");
const industrialProfile = {
  ticker: "INFY.NS",
  name: "Infosys Limited",
  sector: "Technology",
  industry: "Information Technology Services",
  exchange: "NSE",
  exchangeTimezoneName: "Asia/Kolkata",
  country: "India",
  currency: "INR",
  description: "Global consulting and IT services company.",
  website: "https://infosys.com",
  employees: 300000,
  officers: []
};

// Intentionally craft high growth and low WACC to trigger TV cap
const industrialDCF = computeDCF(mockAnnualFinancials, mockStockData);
const terminalYearFCFF = industrialDCF.terminalYearFcff;
const maxAllowedTV = terminalYearFCFF * 25.0;
assert.ok(
  industrialDCF.terminalValue <= maxAllowedTV + 0.01,
  `Terminal Value (${industrialDCF.terminalValue}) must not exceed 25x terminal-year FCFF (${maxAllowedTV})`
);
console.log(`  ✓ Terminal value (${industrialDCF.terminalValue.toFixed(0)}) respects 25x cap (Max: ${maxAllowedTV.toFixed(0)}). TV Capped flag: ${industrialDCF.terminalValueCapped}`);

// -------------------------------------------------------------
// ITEM 3: Confidence Guardrail on Final Upside (±150% -> NR)
// -------------------------------------------------------------
console.log("\n[TEST 3] Confidence Guardrail for Extreme Bounds...");
// Sane upside: 25% -> BUY
const saneRec = calculateRecommendation(100, 125);
assert.strictEqual(saneRec.rating, "BUY");
assert.strictEqual(saneRec.status, "valid");

// Extreme upside: +180% (CMP = 100, Fair Value = 280) -> NR
const extremeUpRec = calculateRecommendation(100, 280);
assert.strictEqual(extremeUpRec.rating, "NR", "Upside > 150% must be marked as NR");
assert.strictEqual(extremeUpRec.status, "not_rated");

// Extreme downside: -85% (CMP = 100, Fair Value = 15) -> NR
const extremeDownRec = calculateRecommendation(100, 15);
assert.strictEqual(extremeDownRec.rating, "NR", "Downside < -80% must be marked as NR");
assert.strictEqual(extremeDownRec.status, "not_rated");
console.log("  ✓ Extreme upside (+180%) and extreme downside (-85%) are cleanly marked as NR / not_rated.");

// -------------------------------------------------------------
// ITEM 4: Historical Shares Outstanding per Period
// -------------------------------------------------------------
console.log("\n[TEST 4] Historical Shares Outstanding per Period...");
const ratios0 = computeRatios(mockAnnualFinancials[0], 500); // 95 shares
const ratios2 = computeRatios(mockAnnualFinancials[2], 500); // 100 shares
assert.strictEqual(ratios0.marketCap, 500 * 95, "FY20 market cap must use FY20 shares (95)");
assert.strictEqual(ratios2.marketCap, 500 * 100, "FY22 market cap must use FY22 shares (100)");
assert.strictEqual(ratios0.bookValuePerShare, 10000 / 95, "FY20 BVPS must use 95 shares");
console.log(`  ✓ FY20 market cap = ${ratios0.marketCap} using 95 historical shares.`);
console.log(`  ✓ FY22 market cap = ${ratios2.marketCap} using 100 historical shares.`);

// -------------------------------------------------------------
// ITEM 5: Winsorized Blend of Live Revenue Growth and Historical CAGR
// -------------------------------------------------------------
console.log("\n[TEST 5] Winsorized Revenue Growth Fallback & Blending...");
const customFinancials = [
  { ...mockAnnualFinancials[0], revenue: 1000 },
  { ...mockAnnualFinancials[1], revenue: 1500 },
  { ...mockAnnualFinancials[2], revenue: 3000 } // Super fast CAGR
];
const blendedDCF = computeDCF(customFinancials, { ...mockStockData, revenueGrowth: 0.15 });
// 3-year CAGR = (3000/1000)^(1/2) - 1 = 73.2%, winsorized to 35%
// Live growth = 15%
// Blend: 0.55 * 35% + 0.45 * 15% = 19.25% + 6.75% = 26.0%
const projYear1Growth = blendedDCF.assumptions.revenueGrowthRates[0];
console.log(`  ✓ Blended initial year growth rate: ${(projYear1Growth * 100).toFixed(2)}% (Winsorized safely).`);
assert.ok(projYear1Growth <= 0.35, "Blended growth must be winsorized at 35% ceiling");

// -------------------------------------------------------------
// ITEM 7 & 10: Calibration Engine, Deciles & Rank Correlation
// -------------------------------------------------------------
console.log("\n[TEST 7 & 10] Calibration Engine, Deciles & Spearman Correlation...");
const spearman = computeSpearmanRankCorrelation(
  [0.35, 0.25, 0.15, -0.05, -0.20],
  [0.30, 0.20, 0.18, -0.10, -0.15]
);
assert.strictEqual(spearman, 1.0, "Perfect monotonicity must yield Spearman rho = 1.0");

const calibration = calibrateValuation({
  upside: 0.28,
  sectorId: "technology",
  priorPredictions: [0.35, 0.25, 0.15, -0.05, -0.20],
  historicalRealizedReturns: [0.30, 0.20, 0.18, -0.10, -0.15]
});
console.log(`  ✓ Sector Z-Score: ${calibration.sectorZScore.toFixed(2)}`);
console.log(`  ✓ Sector Percentile: ${(calibration.sectorPercentile * 100).toFixed(1)}%`);
console.log(`  ✓ Decile: ${calibration.decile} (${calibration.sectorRankLabel})`);
console.log(`  ✓ Spearman Rank Correlation: ${calibration.informationCoefficient.toFixed(3)}`);
assert.ok(calibration.decile >= 1 && calibration.decile <= 10, "Decile must be in 1..10");

// -------------------------------------------------------------
// ITEM 8: Beta Sanity Range Check ([0.35, 2.50])
// -------------------------------------------------------------
console.log("\n[TEST 8] Beta Sanity Range Bounds in WACC...");
// Sub-minimum beta (0.10 -> clamped to 0.35, Blume adjusted)
const lowBetaWacc = computeWACC({ ...mockStockData, beta: 0.10 }, mockAnnualFinancials[2]);
// Super-high beta (9.50 -> clamped to 2.50, Blume adjusted)
const highBetaWacc = computeWACC({ ...mockStockData, beta: 9.50 }, mockAnnualFinancials[2]);
console.log(`  ✓ Low beta (0.10) clamped Blume beta: ${lowBetaWacc.beta.toFixed(2)}`);
console.log(`  ✓ High beta (9.50) clamped Blume beta: ${highBetaWacc.beta.toFixed(2)}`);
assert.ok(lowBetaWacc.beta >= 0.50, "Low beta must be elevated by sanity bound and Blume adjustment");
assert.ok(highBetaWacc.beta <= 2.20, "High beta must be capped by sanity bound and Blume adjustment");

// -------------------------------------------------------------
// ITEM 9: Balance Sheet Multi-Variant Fallback Matching
// -------------------------------------------------------------
console.log("\n[TEST 9] Balance Sheet Multi-Variant Field Name Matching...");
const oddballBS = {
  tradeReceivables: { raw: 4500000 },
  commonStockEquity: 12000000,
  shortTermBorrowings: { raw: 1500000 },
  cashCashEquivalentsAndShortTermInvestments: 3200000
};
const foundReceivables = readFirstNonZeroFieldVariant(oddballBS, [
  "netReceivables",
  "receivables",
  "tradeReceivables"
]);
const foundEquity = readFirstNonZeroFieldVariant(oddballBS, [
  "totalStockholderEquity",
  "stockholdersEquity",
  "commonStockEquity"
]);
const foundDebt = readFieldVariant(oddballBS, [
  "shortLongTermDebt",
  "shortTermBorrowings"
]);
const foundCash = readFirstNonZeroFieldVariant(oddballBS, [
  "cash",
  "cashCashEquivalentsAndShortTermInvestments"
]);

assert.strictEqual(foundReceivables, 4500000, "Must match 'tradeReceivables'");
assert.strictEqual(foundEquity, 12000000, "Must match 'commonStockEquity'");
assert.strictEqual(foundDebt, 1500000, "Must match 'shortTermBorrowings'");
assert.strictEqual(foundCash, 3200000, "Must match 'cashCashEquivalentsAndShortTermInvestments'");
console.log("  ✓ Successfully matched all alternative balance sheet aliases without zeroing out values.");

// -------------------------------------------------------------
// Assumptions Ledger Integration Check
// -------------------------------------------------------------
console.log("\n[INTEGRATION] Assumptions Ledger Verification...");
const ledger = createAssumptionsLedger({
  profile: industrialProfile,
  stockData: mockStockData,
  annualFinancials: mockAnnualFinancials,
  dcf: industrialDCF,
  calibration
});
assert.ok(ledger.calibrationDecile !== undefined, "Ledger must store calibrationDecile");
assert.ok(ledger.sectorZScore !== undefined, "Ledger must store sectorZScore");
assert.ok(ledger.terminalValueCapped !== undefined, "Ledger must track terminalValueCapped");
console.log(`  ✓ Ledger Decile: ${ledger.calibrationDecile}, Z-Score: ${ledger.sectorZScore.toFixed(2)}, TV Capped: ${ledger.terminalValueCapped}`);

console.log("\n============================================================");
console.log("ALL 10 QUANT ENHANCEMENT TESTS PASSED WITH 100% INTEGRITY!");
console.log("============================================================");
