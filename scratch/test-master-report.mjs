// ============================================================
// Automated Verification Script for Master Institutional Engine
// Tests AssumptionsLedger, RatioGuards, and ReportQA engines.
// ============================================================
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";
import {
  formatGuardedRatio,
  formatGuardedMultiple,
  verifyBalanceSheetEquality,
  toReportingUnit,
} from "../src/lib/ratio-guards.ts";
import { validateReportIntegrity } from "../src/lib/report-qa.ts";

console.log("=== RUNNING MASTER REPORT ENGINE VERIFICATION ===\n");

// 1. Test Ratio Guards & Degenerate Value Handlers
console.log("1. Testing Ratio Guards & Degenerate Ratio Handlers...");

const degenerateROE = -312.384; // -31,238.4%
const guardedROE = formatGuardedRatio(degenerateROE, { isPct: true, maxAbs: 1.0 });
console.log(`- Degenerate ROE (${degenerateROE * 100}%): Output -> "${guardedROE}" (Expected: "N/M*")`);
if (guardedROE !== "N/M*") throw new Error("Guarded ROE failed to suppress degenerate value");

const negativePE = -15.4;
const guardedPE = formatGuardedMultiple(negativePE);
console.log(`- Negative P/E (${negativePE}x): Output -> "${guardedPE}" (Expected: "N/M")`);
if (guardedPE !== "N/M") throw new Error("Guarded P/E failed to suppress negative multiple");

const normalMargin = 0.185;
const guardedMargin = formatGuardedRatio(normalMargin, { isPct: true });
console.log(`- Normal Margin (${normalMargin * 100}%): Output -> "${guardedMargin}" (Expected: "18.5%")`);
if (guardedMargin !== "18.5%") throw new Error("Guarded margin failed on valid value");

const bsCheck = verifyBalanceSheetEquality(100000, 40000, 60000);
console.log(`- Balance Sheet Check: ${bsCheck.label}`);
if (!bsCheck.balanced) throw new Error("Balance sheet check failed on balanced inputs");

console.log(">>> Ratio Guards: PASSED\n");

// 2. Test Assumptions Ledger
console.log("2. Testing Assumptions Ledger (Single Source of Truth)...");

const mockProfile = {
  ticker: "RELIANCE.NS",
  name: "Reliance Industries Limited",
  exchange: "NSE",
  exchangeTimezoneName: "Asia/Kolkata",
  sector: "Energy",
  industry: "Oil & Gas Refining & Marketing",
  country: "India",
  currency: "INR",
  description: "Reliance Industries is an integrated Indian conglomerate.",
  website: "https://www.ril.com",
  employees: 250000,
  officers: [{ name: "Mukesh D. Ambani", title: "Chairman & Managing Director" }],
};

const mockStockData = {
  currentPrice: 2950,
  previousClose: 2940,
  open: 2945,
  dayHigh: 2960,
  dayLow: 2930,
  marketCap: 19950000000000,
  enterpriseValue: 22500000000000,
  pe: 26.5,
  forwardPE: 23.0,
  pb: 2.4,
  ps: 2.1,
  dividendYield: 0.0035,
  dividendRate: 10,
  beta: 1.05,
  week52High: 3217,
  week52Low: 2220,
  sharesOutstanding: 6765000000,
  floatShares: 3400000000,
  avgVolume: 5000000,
  volume: 4500000,
  fiftyDayAvg: 2980,
  twoHundredDayAvg: 2890,
  eps: 111.3,
  forwardEps: 128.2,
  bookValue: 1229,
  priceToBook: 2.4,
  returnOnEquity: 0.095,
  returnOnAssets: 0.052,
  debtToEquity: 0.38,
  currentRatio: 1.15,
  quickRatio: 0.85,
  grossMargins: 0.32,
  ebitdaMargins: 0.171,
  operatingMargins: 0.115,
  financialCurrency: "INR",
  targetMeanPrice: 3350,
  recommendationKey: "buy",
  numberOfAnalystOpinions: 34,
  revenueGrowth: 0.095,
};

const mockAnnualFinancials = [
  {
    year: "2024",
    revenue: 9000000000000,
    grossProfit: 2880000000000,
    ebitda: 1539000000000,
    operatingIncome: 1035000000000,
    netIncome: 696000000000,
    totalEquity: 7300000000000,
    totalAssets: 12000000000000,
    totalDebt: 3200000000000,
    cash: 650000000000,
    shortTermInvestments: 350000000000,
    netFixedAssets: 7500000000000,
    netWorkingCapital: 300000000000,
    currentAssets: 2800000000000,
    currentLiabilities: 1500000000000,
    netReceivables: 250000000000,
    inventory: 1400000000000,
    capitalExpenditures: 450000000000,
    depreciation: 504000000000,
    interestExpense: 220000000000,
    dividendsPaid: 67650000000,
    freeCashFlow: 450000000000,
    operatingCashFlow: 900000000000,
    eps: 102.8,
    sharesOutstanding: 6765000000,
    grossMargin: 0.32,
    ebitdaMargin: 0.171,
    ebitMargin: 0.115,
    netMargin: 0.077,
  },
];

const mockDCF = {
  assumptions: {
    riskFreeRate: 0.0685,
    equityRiskPremium: 0.060,
    beta: 1.05,
    costOfEquity: 0.1315,
    costOfDebtPreTax: 0.075,
    marginalTaxRate: 0.25,
    costOfDebtPostTax: 0.05625,
    debtWeight: 0.15,
    equityWeight: 0.85,
    wacc: 0.095,
    terminalGrowthRate: 0.04,
    revenueGrowthRates: [0.12, 0.108, 0.098, 0.088, 0.079],
    ebitMargins: [0.125, 0.133, 0.139, 0.143, 0.145],
  },
  projections: [],
  sumPvFcff: 7200000000000,
  terminalYearFcff: 1200000000000,
  terminalValue: 22700000000000,
  pvTerminalValue: 14420000000000,
  enterpriseValue: 21620000000000, // sumPvFcff + pvTerminalValue
  lessDebt: 2200000000000, // net debt
  equityValue: 19420000000000,
  sharesOutstanding: 6765000000,
  intrinsicValue: 2870.66,
  upsideDownside: -0.0269,
  verdict: "HOLD",
};

const ledger = createAssumptionsLedger({
  profile: mockProfile,
  stockData: mockStockData,
  annualFinancials: mockAnnualFinancials,
  dcf: mockDCF,
});

console.log("- Ledger Fair Value:", ledger.fairValue);
console.log("- Ledger WACC:", `${(ledger.wacc * 100).toFixed(2)}%`);
console.log("- Ledger TGR:", `${(ledger.terminalGrowthRate * 100).toFixed(1)}%`);
console.log("- Ledger Rating:", ledger.rating, `(${ledger.ratingRationale})`);
console.log("- Ledger Moat Rating:", ledger.moatRating, `(${ledger.moatTrend})`);
console.log("- Ledger Moat Bridge:", ledger.moatBridge);

if (!ledger.fairValue || !ledger.wacc || !ledger.moatBridge) {
  throw new Error("Assumptions ledger missing core fields");
}

console.log(">>> Assumptions Ledger: PASSED\n");

// 3. Test Pre-Publish QA Validator
console.log("3. Testing Pre-Publish QA Validator...");

const mockReport = {
  generatedAt: new Date().toISOString(),
  profile: mockProfile,
  stockData: mockStockData,
  annualFinancials: mockAnnualFinancials,
  quarterlyFinancials: [],
  ratiosByYear: [],
  dupontByYear: [],
  dcf: mockDCF,
  shareholding: { insiderOwnership: 0.50, institutionalOwnership: 0.35, publicFloat: 0.15, topInstitutions: [], categories: [] },
  peers: [],
  aiAnalysis: {
    companyOverview: "Reliance is an integrated energy and retail giant.",
    economicContext: "Indian macro environment supports steady consumer demand.",
    globalIndustryAnalysis: "Global petrochemical demand and crack spreads fluctuate with crude oil.",
    domesticIndustryAnalysis: "Domestic market leadership in downstream energy products.",
    segmentAnalysis: "Oil-to-chemicals, digital telecom, and retail segments.",
    quarterlyResultsCommentary: "Quarterly performance reflected resilient operations.",
    managementCommentary: "Disciplined capital allocation across clean energy.",
    swot: { strengths: ["Scale", "Downstream integration"], weaknesses: ["High cyclical capex"], opportunities: ["New energy"], threats: ["Crude volatility"] },
    catalysts: [{ title: "Green energy commissioning", timeframe: "12-18M", impact: "High" }],
    risks: [{ category: "Commodity", description: "Crude oil volatility", severity: "Medium", mitigation: "Downstream integration" }],
    competitiveMoat: "Formidable physical refinery scale and integrated supply chain.",
    valuationCommentary: "DCF model incorporates conservative 4.0% terminal growth rate.",
    esgAnalysis: "Active decarbonization initiatives.",
    recentDevelopments: [],
  },
  news: [],
  recommendation: ledger.rating,
  targetPrice: ledger.targetPrice,
  cmp: ledger.currentPrice,
  analystName: "Apex Research Team",
  assumptionsLedger: ledger,
};

const qaResult = validateReportIntegrity(mockReport);
console.log("- QA Validation Score:", `${qaResult.score}/100`);
console.log("- QA Validation Status:", qaResult.passed ? "CERTIFIED PASS" : "FAILED");
for (const check of qaResult.checks) {
  console.log(`  [${check.status}] ${check.id}: ${check.name} -> ${check.details}`);
}

if (!qaResult.passed) {
  throw new Error("QA validation failed on valid report data");
}

console.log("\n>>> ALL 3 ENGINES VERIFIED & PASSED 100% SUCCESSFUL <<<");
