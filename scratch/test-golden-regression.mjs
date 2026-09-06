/**
 * APEX RESEARCH - Comprehensive Golden Regression & Invariant Test Suite
 * 
 * Verifies:
 *  1. Accounting & Financial Identities (Layer B)
 *  2. Scenario Return Math & Monotonicity
 *  3. Deterministic Recommendation Invariant (Rating vs Upside)
 *  4. Golden Company Sector Specialization (INFY, CIPLA, SUZLON, SPANDANA)
 *  5. Sector Leakage Prevention (No CASA in NBFC, no spectrum in Renewables)
 *  6. AI Text Sanitizer & Placeholder Injection
 *  7. Publication Gate Enforcement (Blocking on critical errors)
 */

import { validateFinancialIdentities } from "../src/lib/financial-validation.ts";
import { calculateRecommendation, validateRecommendationConsistency } from "../src/lib/recommendation.ts";
import { buildScenarioSet, validateScenarioSet } from "../src/lib/scenarios.ts";
import { classifySector, validateSectorConcepts } from "../src/lib/sectors/profiles.ts";
import { selectAndComputeValuation } from "../src/lib/valuation/selector.ts";
import { sanitizeAIText } from "../src/lib/ai/sanitizer.ts";
import { buildMasterReportFacts } from "../src/lib/report-facts.ts";
import { validateMasterReport } from "../src/lib/report-validator.ts";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passedCount = 0;
let failedCount = 0;

function assert(condition, testName, details = "") {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✕ FAIL: ${testName} ${details ? `(${details})` : ""}`);
    failedCount++;
  }
}

console.log("\n=======================================================");
console.log("APEX RESEARCH - GOLDEN REGRESSION TEST SUITE");
console.log("=======================================================\n");

// ============================================================================
// TEST GROUP 1: Deterministic Recommendation & Invariant Checks
// ============================================================================
console.log("--- 1. Deterministic Recommendation Engine ---");
{
  const buy = calculateRecommendation(100, 125);
  assert(buy.rating === "BUY" && buy.upside === 0.25, "Upside +25% strictly maps to BUY");

  const sell = calculateRecommendation(100, 75);
  assert(sell.rating === "SELL" && sell.upside === -0.25, "Downside -25% strictly maps to SELL");

  const hold = calculateRecommendation(100, 105);
  assert(hold.rating === "HOLD" && buy.status === "valid", "Upside +5% strictly maps to HOLD");

  const nr = calculateRecommendation(100, null);
  assert(nr.rating === "NR" && nr.upside === null, "Null fair value strictly maps to NR (Not Rated)");

  // Contradiction checks
  const validCheck = validateRecommendationConsistency(100, 125, "BUY");
  assert(validCheck.valid, "BUY with +25% upside is recognized as valid");

  const invalidCheck = validateRecommendationConsistency(100, 125, "SELL");
  assert(!invalidCheck.valid && invalidCheck.issues.length > 0, "Contradiction: Modeled upside positive, but claimed SELL is blocked");

  const nullValuationCheck = validateRecommendationConsistency(100, null, "BUY");
  assert(!nullValuationCheck.valid, "Contradiction: Null valuation claiming BUY is blocked (must be NR)");
}

// ============================================================================
// TEST GROUP 2: Scenario Mathematics & Monotonicity
// ============================================================================
console.log("\n--- 2. Scenario Mathematics & Monotonicity ---");
{
  // User spec test case: Current = 1130, Bull target = 1959.68 => implied return = 1959.68 / 1130 - 1 = +73.4%
  const scenarios = buildScenarioSet({
    currentPrice: 1130,
    baseTargetPrice: 1531,
    bullTarget: 1959.68,
    bearTarget: 1100
  });

  assert(scenarios.bull.impliedReturn >= 0.73 && scenarios.bull.impliedReturn <= 0.74,
    "Bull implied return calculated as (1959.68 / 1130 - 1) = +73.4%, not arbitrary multiplier"
  );

  assert(scenarios.bull.targetPrice >= scenarios.base.targetPrice && scenarios.base.targetPrice >= scenarios.bear.targetPrice,
    "Strict scenario monotonicity: Bull (1959.68) >= Base (1531) >= Bear (1100)"
  );

  const scenarioValidation = validateScenarioSet(scenarios);
  assert(scenarioValidation.valid, "Scenario set passes mathematical validation");

  // Inverted scenario test
  const invertedScenarios = {
    currentPrice: 100,
    bull: { name: "bull", targetPrice: 80, impliedReturn: -0.20 },
    base: { name: "base", targetPrice: 100, impliedReturn: 0 },
    bear: { name: "bear", targetPrice: 120, impliedReturn: 0.20 },
    status: "valid",
    diagnostics: []
  };
  const invertedValidation = validateScenarioSet(invertedScenarios);
  assert(!invertedValidation.valid, "Scenario validator successfully blocks inverted targets (Bull < Base)");
}

// ============================================================================
// TEST GROUP 3: Accounting & Financial Identity Engine
// ============================================================================
console.log("\n--- 3. Accounting & Financial Identity Engine ---");
{
  const mockFinancials = [
    {
      year: "FY24",
      revenue: 10000,
      grossProfit: 6000,
      ebitda: 3500,
      operatingIncome: 2500,
      netIncome: 1800,
      totalAssets: 15000,
      totalEquity: 8000,
      totalDebt: 3000,
      cash: 1000,
      shortTermInvestments: 0,
      operatingCashFlow: 2200,
      capitalExpenditures: 700,
      freeCashFlow: 1500,
      eps: 18,
      sharesOutstanding: 100,
      ebitMargin: 0.25,
      depreciation: 1000,
      netFixedAssets: 7000,
      netWorkingCapital: 2000,
      currentAssets: 5000,
      currentLiabilities: 3000,
      netReceivables: 1500,
      inventory: 1200,
      interestExpense: 200,
      dividendsPaid: 400
    }
  ];

  const mockStock = {
    currentPrice: 200,
    previousClose: 198,
    open: 199,
    dayHigh: 202,
    dayLow: 197,
    marketCap: 20000,
    enterpriseValue: 22000,
    pe: 11.1,
    forwardPE: 10.5,
    pb: 2.5,
    ps: 2.0,
    dividendYield: 0.02,
    dividendRate: 4,
    beta: 1.1,
    week52High: 220,
    week52Low: 150,
    sharesOutstanding: 100,
    floatShares: 80,
    avgVolume: 100000,
    volume: 95000,
    fiftyDayAvg: 190,
    twoHundredDayAvg: 180,
    eps: 18,
    forwardEps: 20,
    bookValue: 80,
    priceToBook: 2.5,
    returnOnEquity: 0.225,
    returnOnAssets: 0.12,
    debtToEquity: 0.375,
    currentRatio: 1.67,
    quickRatio: 1.27,
    grossMargins: 0.60,
    ebitdaMargins: 0.35,
    operatingMargins: 0.25,
    profitMargins: 0.18,
    revenueGrowth: 0.15,
    revenuePerShare: 100,
    freeCashFlow: 1500,
    operatingCashFlow: 2200,
    totalCash: 1000,
    totalDebt: 3000,
    targetMeanPrice: 240,
    targetHighPrice: 260,
    targetLowPrice: 210,
    recommendationKey: "buy",
    numberOfAnalystOpinions: 15
  };

  const identities = validateFinancialIdentities({
    annualFinancials: mockFinancials,
    stockData: mockStock
  });

  assert(identities.isValid && !identities.hasFatalErrors, "Clean accounting identities reconcile with zero fatal errors");
}

// ============================================================================
// TEST GROUP 4: Golden Company Sector Ontology & Valuation Routing
// ============================================================================
console.log("\n--- 4. Golden Company Regression (INFY, CIPLA, SUZLON, SPANDANA) ---");
{
  // 1. Infosys (IT Services)
  const infySector = classifySector("Information Technology", "IT Services & Consulting", "Infosys is a global leader in next-generation digital services");
  assert(infySector.id === "it-services", "INFY correctly classified as 'it-services'");
  assert(infySector.allowedKPIs.includes("Constant Currency Revenue Growth"), "INFY allowed KPIs include Constant Currency Revenue Growth");
  const infyBleed = validateSectorConcepts(infySector, "Infosys delivered strong constant currency growth with margin expansion.");
  assert(infyBleed.valid, "INFY clean IT narrative passes sector concept filter");

  // 2. Cipla (Pharma)
  const ciplaSector = classifySector("Healthcare", "Pharmaceuticals", "Cipla is an Indian multinational pharmaceutical company");
  assert(ciplaSector.id === "pharma", "CIPLA correctly classified as 'pharma'");
  assert(ciplaSector.allowedKPIs.includes("R&D Spend as % of Revenue"), "CIPLA allowed KPIs include R&D Spend as % of Revenue");

  // 3. Suzlon (Renewable Energy)
  const suzlonSector = classifySector("Industrials", "Wind Energy Equipment", "Suzlon Energy is a wind turbine manufacturer");
  assert(suzlonSector.id === "renewable-energy", "SUZLON correctly classified as 'renewable-energy'");
  assert(suzlonSector.allowedKPIs.includes("Order Book Execution Pipeline (MW)"), "SUZLON allowed KPIs include Order Book Execution Pipeline (MW)");

  // 4. Spandana Sphoorty (NBFC / Microfinance)
  const spandanaSector = classifySector("Financial Services", "Microfinance & NBFC", "Spandana Sphoorty is a rural microfinance institution");
  assert(spandanaSector.id === "nbfc", "SPANDANA correctly classified as 'nbfc'");
  assert(spandanaSector.isFinancialInstitution === true, "SPANDANA identified as Financial Institution (exempt from industrial FCFF)");
  assert(spandanaSector.allowedKPIs.includes("Assets Under Management (AUM)"), "SPANDANA allowed KPIs include AUM");
  assert(spandanaSector.preferredValuationModels.includes("PB_RESIDUAL_INCOME"), "SPANDANA preferred valuation is Residual Income / Justified P/B");

  // Spandana CASA Leakage Test (NBFC cannot accept CASA)
  const casaCheck = validateSectorConcepts(spandanaSector, "The company expanded its low-cost CASA deposit franchise.");
  assert(!casaCheck.valid && casaCheck.leakedConcepts.includes("casa"), "Sector Leakage Guard: Blocks CASA in Spandana NBFC narrative");

  // Spandana Telecom Leakage Test (NBFC cannot have 4G/5G/ARPU)
  const telecomCheck = validateSectorConcepts(spandanaSector, "Management prioritized 4G/5G densification to raise blended ARPU.");
  assert(!telecomCheck.valid, "Sector Leakage Guard: Blocks 4G/5G & ARPU in Spandana NBFC narrative");
}

// ============================================================================
// TEST GROUP 5: Sector-Calibrated Valuation Engine
// ============================================================================
console.log("\n--- 5. Dynamic Sector Valuation Engine ---");
{
  // For Spandana (NBFC):
  const spandanaValuation = selectAndComputeValuation({
    profile: {
      ticker: "SPANDANA.NS",
      name: "Spandana Sphoorty Financial Limited",
      sector: "Financial Services",
      industry: "Microfinance & NBFC",
      currency: "INR",
      country: "India",
      exchange: "NSE",
      description: "Rural microfinance non-banking financial company"
    },
    stockData: {
      currentPrice: 480,
      sharesOutstanding: 7.1e7,
      marketCap: 3.4e10,
      beta: 1.2
    },
    annualFinancials: [
      {
        year: "FY24",
        revenue: 25000000000,
        netIncome: 5000000000,
        totalEquity: 35000000000,
        totalDebt: 65000000000,
        cash: 5000000000,
        sharesOutstanding: 7.1e7
      }
    ]
  });

  assert(spandanaValuation.selectedModel === "PB_RESIDUAL_INCOME", "Spandana automatically routed to Residual Income / Justified P/B");
  assert(spandanaValuation.fairValue > 0, `Spandana intrinsic fair value calculated: ₹${spandanaValuation.fairValue}`);
  assert(spandanaValuation.rating !== "NR", `Spandana assigned deterministic rating: ${spandanaValuation.rating}`);

  // For HDFC Bank (Commercial Bank):
  const hdfcValuation = selectAndComputeValuation({
    profile: {
      ticker: "HDFCBANK.NS",
      name: "HDFC Bank Limited",
      sector: "Financial Services",
      industry: "Banks - Diversified",
      currency: "INR",
      country: "India",
      exchange: "NSE",
      description: "HDFC Bank Limited provides various banking and financial services."
    },
    stockData: {
      currentPrice: 712.1,
      sharesOutstanding: 15411000562,
      marketCap: 10974170000000,
      beta: 0.404,
      returnOnEquity: 0.1384
    },
    annualFinancials: [
      {
        year: "FY2026",
        revenue: 1912186000000,
        netIncome: 760259700000,
        totalEquity: 6069052364323,
        totalDebt: 3281047519232,
        cash: 250000000000,
        operatingCashFlow: 800000000000,
        sharesOutstanding: 15411000562
      }
    ]
  });

  assert(hdfcValuation.selectedModel === "PB_RESIDUAL_INCOME", "HDFC Bank automatically routed to PB_RESIDUAL_INCOME");
  assert(hdfcValuation.dcf.assumptions.costOfEquity < 0.12, "HDFC Bank Ke computed dynamically via CAPM (< 12%)");
  assert(hdfcValuation.fairValue > 550, `HDFC Bank fair value is institutional (₹${hdfcValuation.fairValue})`);
  assert(hdfcValuation.rating === "HOLD", `HDFC Bank rating is institutional ${hdfcValuation.rating}`);
}

// ============================================================================
// TEST GROUP 6: AI Narrative Sanitizer & Placeholder Injection
// ============================================================================
console.log("\n--- 6. AI Narrative Sanitizer & Placeholders ---");
{
  const mockFacts = {
    company: { ticker: "INFY.NS", name: "Infosys Limited", currency: "INR" },
    market: { currentPrice: { value: 1850, unit: "INR", status: "valid" } },
    valuation: {
      fairValue: { value: 2150, unit: "INR", status: "valid" },
      upside: { value: 0.162, unit: "%", status: "valid" },
      wacc: 0.095,
      terminalGrowth: 0.04
    },
    recommendation: { rating: "BUY", upside: 0.162, status: "valid" },
    moat: { rating: "Wide" },
    risks: { uncertainty: { rating: "Low" } }
  };

  const rawAIText = "We initiate coverage on {{COMPANY_NAME}} with {{RATING}} stance. Fair value target is {{FAIR_VALUE}} vs current trading price of {{CURRENT_PRICE}}, reflecting an upside of {{UPSIDE}}. Economic moat is rated {{MOAT}}.";
  const sanitized = sanitizeAIText(rawAIText, mockFacts);

  assert(sanitized.isClean, "Sanitizer verified narrative is clean of contradictions");
  assert(sanitized.sanitizedText.includes("BUY"), "Placeholder {{RATING}} correctly substituted with 'BUY'");
  assert(sanitized.sanitizedText.includes("Wide"), "Placeholder {{MOAT}} correctly substituted with 'Wide'");
  assert(sanitized.injectedCount >= 5, `Injected ${sanitized.injectedCount} authoritative placeholders`);

  // Contradiction detection in text
  const contradictoryText = "We initiate coverage with SELL rating despite model.";
  const contradictionResult = sanitizeAIText(contradictoryText, mockFacts);
  assert(!contradictionResult.isClean && contradictionResult.contradictions.length > 0, "Sanitizer detected and flagged rating contradiction in prose");
}

// ============================================================================
// TEST GROUP 7: Reliance Consolidated Balance Sheet Fidelity (Image 2 Ground Truth)
// ============================================================================
console.log("\n--- 7. Reliance Consolidated Balance Sheet Fidelity (Image 2 Ground Truth) ---");
{
  const relianceData = JSON.parse(fs.readFileSync(path.join(__dirname, "reliance_data.json"), "utf8"));
  const fin = relianceData.annualFinancials;
  const fy24 = fin.find(f => f.year === "FY2024" || f.fiscalYearEnd === "2024-03-31");
  const fy25 = fin.find(f => f.year === "FY2025" || f.fiscalYearEnd === "2025-03-31");
  const fy26 = fin.find(f => f.year === "FY2026" || f.fiscalYearEnd === "2026-03-31");

  assert(!!fy24 && !!fy25 && !!fy26, "Reliance annualFinancials contains FY2024, FY2025, FY2026");

  const toM = n => Math.round((n || 0) / 1e6);

  // FY2024 checks
  assert(toM(fy24.totalAssets) === 17559860, `FY24 Total Assets matches Image 2 (17,559,860M): got ${toM(fy24.totalAssets)}M`);
  assert(toM(fy24.totalLiabilities) === 8301980, `FY24 Total Liabilities matches Image 2 (8,301,980M): got ${toM(fy24.totalLiabilities)}M`);
  assert(toM(fy24.totalEquity) === 9257880, `FY24 Total Equity matches Image 2 (9,257,880M): got ${toM(fy24.totalEquity)}M`);
  assert(toM(fy24.totalDebt) === 3461420, `FY24 Total Debt matches Image 2 (3,461,420M): got ${toM(fy24.totalDebt)}M`);
  assert(toM(fy24.shortTermDebt) === 1019100, `FY24 Short-Term Debt is non-zero and matches Image 2 (1,019,100M): got ${toM(fy24.shortTermDebt)}M`);
  assert(toM(fy24.longTermDebt) === 2227120, `FY24 Long-Term Debt is non-zero and matches Image 2 (2,227,120M): got ${toM(fy24.longTermDebt)}M`);

  // FY2026 checks
  assert(toM(fy26.totalAssets) === 21781400, `FY26 Total Assets matches Image 2 (21,781,400M): got ${toM(fy26.totalAssets)}M`);
  assert(toM(fy26.totalDebt) === 3980000, `FY26 Total Debt matches Image 2 (3,980,000M): got ${toM(fy26.totalDebt)}M`);

  // Strict accounting balance
  for (const f of fin) {
    const diff = Math.abs(f.totalAssets - (f.totalLiabilities + f.totalEquity));
    assert(diff === 0, `${f.year} strict accounting balance: Total Assets === Total Liabilities + Total Equity`);
  }
}

// ============================================================================
// TEST GROUP 8: Reliance Consolidated Income Statement Fidelity (Image 2 Ground Truth)
// ============================================================================
console.log("\n--- 8. Reliance Consolidated Income Statement Fidelity (Image 2 Ground Truth) ---");
{
  const relianceData = JSON.parse(fs.readFileSync(path.join(__dirname, "reliance_data.json"), "utf8"));
  const fin = relianceData.annualFinancials;
  const toM = n => Math.round((n || 0) / 1e6);

  const fy23 = fin.find(f => f.year === "FY2023" || f.fiscalYearEnd === "2023-03-31");
  const fy24 = fin.find(f => f.year === "FY2024" || f.fiscalYearEnd === "2024-03-31");
  const fy25 = fin.find(f => f.year === "FY2025" || f.fiscalYearEnd === "2025-03-31");
  const fy26 = fin.find(f => f.year === "FY2026" || f.fiscalYearEnd === "2026-03-31");

  // Revenue
  assert(toM(fy23.revenue) === 8778350, `FY23 Revenue matches Image 2 (8,778,350M): got ${toM(fy23.revenue)}M`);
  assert(toM(fy24.revenue) === 9010640, `FY24 Revenue matches Image 2 (9,010,640M): got ${toM(fy24.revenue)}M`);
  assert(toM(fy25.revenue) === 9646930, `FY25 Revenue matches Image 2 (9,646,930M): got ${toM(fy25.revenue)}M`);
  assert(toM(fy26.revenue) === 10572190, `FY26 Revenue matches Image 2 (10,572,190M): got ${toM(fy26.revenue)}M`);

  // Cost of Revenue / Gross Profit
  assert(toM(fy24.costOfRevenue) === 6745990, `FY24 COGS matches Image 2 (6,745,990M): got ${toM(fy24.costOfRevenue)}M`);
  assert(toM(fy24.grossProfit) === 2264650, `FY24 Gross Profit matches Image 2 (2,264,650M): got ${toM(fy24.grossProfit)}M`);
  assert(toM(fy26.costOfRevenue) === 7868240, `FY26 COGS matches Image 2 (7,868,240M): got ${toM(fy26.costOfRevenue)}M`);
  assert(toM(fy26.grossProfit) === 2703950, `FY26 Gross Profit matches Image 2 (2,703,950M): got ${toM(fy26.grossProfit)}M`);

  // Operating Income / EBITDA
  assert(toM(fy24.operatingIncome) === 1116660, `FY24 Operating Income matches Image 2 (1,116,660M): got ${toM(fy24.operatingIncome)}M`);
  assert(toM(fy26.operatingIncome) === 1213770, `FY26 Operating Income matches Image 2 (1,213,770M): got ${toM(fy26.operatingIncome)}M`);
  assert(toM(fy24.ebitda) === 1769440, `FY24 EBITDA matches Image 2 (1,769,440M): got ${toM(fy24.ebitda)}M`);
  assert(toM(fy26.ebitda) === 2049060, `FY26 EBITDA matches Image 2 (2,049,060M): got ${toM(fy26.ebitda)}M`);

  // Net Income & EPS
  assert(toM(fy24.netIncome) === 696210, `FY24 Net Income matches Image 2 (696,210M): got ${toM(fy24.netIncome)}M`);
  assert(toM(fy25.netIncome) === 696480, `FY25 Net Income matches Image 2 (696,480M): got ${toM(fy25.netIncome)}M`);
  assert(toM(fy26.netIncome) === 807750, `FY26 Net Income matches Image 2 (807,750M): got ${toM(fy26.netIncome)}M`);
  assert(Math.abs((fy24.dilutedEps || fy24.eps) - 51.45) < 0.1, `FY24 Diluted EPS matches Image 2 (51.45): got ${fy24.dilutedEps || fy24.eps}`);
  assert(Math.abs((fy26.dilutedEps || fy26.eps) - 59.69) < 0.1, `FY26 Diluted EPS matches Image 2 (59.69): got ${fy26.dilutedEps || fy26.eps}`);
}

// ============================================================================
// TEST GROUP 9: Reliance Consolidated Cash Flow Fidelity (Image 3 Ground Truth)
// ============================================================================
console.log("\n--- 9. Reliance Consolidated Cash Flow Fidelity (Image 3 Ground Truth) ---");
{
  const relianceData = JSON.parse(fs.readFileSync(path.join(__dirname, "reliance_data.json"), "utf8"));
  const fin = relianceData.annualFinancials;
  const toM = n => Math.round((n || 0) / 1e6);

  const fy23 = fin.find(f => f.year === "FY2023" || f.fiscalYearEnd === "2023-03-31");
  const fy24 = fin.find(f => f.year === "FY2024" || f.fiscalYearEnd === "2024-03-31");
  const fy25 = fin.find(f => f.year === "FY2025" || f.fiscalYearEnd === "2025-03-31");
  const fy26 = fin.find(f => f.year === "FY2026" || f.fiscalYearEnd === "2026-03-31");

  // Operating Cash Flow
  assert(toM(fy23.operatingCashFlow) === 1150320, `FY23 CFO matches Image 3 (1,150,320M): got ${toM(fy23.operatingCashFlow)}M`);
  assert(toM(fy24.operatingCashFlow) === 1587880, `FY24 CFO matches Image 3 (1,587,880M): got ${toM(fy24.operatingCashFlow)}M`);
  assert(toM(fy25.operatingCashFlow) === 1787030, `FY25 CFO matches Image 3 (1,787,030M): got ${toM(fy25.operatingCashFlow)}M`);
  assert(toM(fy26.operatingCashFlow) === 1921130, `FY26 CFO matches Image 3 (1,921,130M): got ${toM(fy26.operatingCashFlow)}M`);

  // Capex & Free Cash Flow
  assert(toM(fy24.capitalExpenditures) === 1528830, `FY24 Capex matches Image 3 (1,528,830M): got ${toM(fy24.capitalExpenditures)}M`);
  assert(toM(fy24.freeCashFlow) === 59050, `FY24 FCF matches Image 3 (59,050M): got ${toM(fy24.freeCashFlow)}M`);
  assert(toM(fy26.capitalExpenditures) === 1229160, `FY26 Capex matches Image 3 (1,229,160M): got ${toM(fy26.capitalExpenditures)}M`);
  assert(toM(fy26.freeCashFlow) === 691970, `FY26 FCF matches Image 3 (691,970M): got ${toM(fy26.freeCashFlow)}M`);

  // Cash Flow from Investing & Financing
  assert(toM(fy24.investingCashFlow) === -1135810, `FY24 CFI matches Image 3 (-1,135,810M): got ${toM(fy24.investingCashFlow)}M`);
  assert(toM(fy24.financingCashFlow) === -166460, `FY24 CFF matches Image 3 (-166,460M): got ${toM(fy24.financingCashFlow)}M`);
  assert(toM(fy26.investingCashFlow) === -1010890, `FY26 CFI matches Image 3 (-1,010,890M): got ${toM(fy26.investingCashFlow)}M`);
  assert(toM(fy26.financingCashFlow) === -515490, `FY26 CFF matches Image 3 (-515,490M): got ${toM(fy26.financingCashFlow)}M`);

  // End Cash Position
  assert(toM(fy24.endCashPosition) === 972250, `FY24 End Cash matches Image 3 (972,250M): got ${toM(fy24.endCashPosition)}M`);
  assert(toM(fy26.endCashPosition) === 1459770, `FY26 End Cash matches Image 3 (1,459,770M): got ${toM(fy26.endCashPosition)}M`);

  // Strict FCF Accounting Identity: CFO - Capex === FCF across all years
  for (const f of fin) {
    const calcFcf = toM(f.operatingCashFlow) - toM(f.capitalExpenditures);
    const repFcf = toM(f.freeCashFlow);
    assert(Math.abs(calcFcf - repFcf) <= 1, `${f.year} strict FCF identity: CFO (${toM(f.operatingCashFlow)}) - Capex (${toM(f.capitalExpenditures)}) === FCF (${repFcf})`);
  }
}

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("=======================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
