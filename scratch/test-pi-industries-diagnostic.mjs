import assert from "node:assert";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";
import { validateReportIntegrity } from "../src/lib/report-qa.ts";
import { AGROCHEMICAL_PROFILE, getSectorProfile } from "../src/lib/sectors/profiles.ts";

console.log("===============================================================");
console.log("PI INDUSTRIES SYSTEM DIAGNOSTIC VERIFICATION SUITE");
console.log("===============================================================\n");

let passedCount = 0;
function it(description, fn) {
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

// ── Mock PI Industries Profile & Financial Data ──
const mockProfile = {
  ticker: "PIIND.NS",
  name: "PI Industries Ltd",
  sector: "Materials",
  industry: "Agrochemicals",
  country: "India",
  currency: "INR",
  exchange: "NSE",
  exchangeTimezoneName: "Asia/Kolkata",
  description: "PI Industries Ltd is an Indian agrochemicals and custom synthesis manufacturing (CSM) company.",
  website: "https://www.piindustries.com",
  employees: 3500,
  officers: [],
};

const mockStockData = {
  currentPrice: 3800,
  previousClose: 3780,
  open: 3790,
  dayHigh: 3850,
  dayLow: 3760,
  marketCap: 576000000000, // 57,600 Cr
  enterpriseValue: 565000000000,
  pe: 34.5,
  forwardPE: 29.8,
  pb: 6.8,
  ps: 7.2,
  dividendYield: 0.0035,
  dividendRate: 15,
  beta: 0.85,
  week52High: 4200,
  week52Low: 3100,
  sharesOutstanding: 151700000,
  floatShares: 85000000,
  avgVolume: 250000,
  volume: 220000,
  fiftyDayAvg: 3750,
  twoHundredDayAvg: 3600,
  eps: 110,
  forwardEps: 128,
  bookValue: 560,
  priceToBook: 6.8,
  returnOnEquity: 0.205,
  returnOnAssets: 0.162,
  debtToEquity: 0.04,
  currentRatio: 2.8,
  quickRatio: 2.1,
  grossMargins: 0.46,
  ebitdaMargins: 0.265,
  operatingMargins: 0.237,
  profitMargins: 0.198,
  freeCashflow: 12500000000,
  totalDebt: 3420000000, // 342 Cr
  totalCash: 15000000000, // 1,500 Cr (Net Cash Company!)
  revenueGrowth: 0.14,
  earningsGrowth: 0.18,
  recommendationKey: "buy",
  numberOfAnalystOpinions: 24,
  targetHighPrice: 4600,
  targetLowPrice: 3500,
  targetMeanPrice: 4200,
};

const mockFinancials = [
  {
    year: "FY22",
    fiscalYearEnd: "2022-03-31",
    revenue: 53000000000,
    costOfRevenue: 29000000000,
    grossProfit: 24000000000,
    grossMargin: 0.453,
    researchDevelopment: 1500000000,
    sellingGeneralAdministrative: 10500000000,
    totalOperatingExpenses: 12000000000,
    operatingIncome: 12000000000,
    ebitda: 14000000000,
    ebitdaMargin: 0.264,
    ebitMargin: 0.226,
    interestExpense: 150000000,
    otherIncome: 1000000000,
    pretaxIncome: 12850000000,
    incomeTaxExpense: 2350000000,
    netIncome: 10500000000,
    netMargin: 0.198,
    depreciation: 2000000000,
    eps: 69.2,
    dilutedEps: 69.2,
    sharesOutstanding: 151700000,
    totalAssets: 72000000000,
    totalLiabilities: 15000000000,
    totalEquity: 57000000000,
    cash: 12000000000,
    shortTermInvestments: 0,
    netReceivables: 9000000000,
    inventory: 11000000000,
    currentAssets: 34000000000,
    netFixedAssets: 28000000000,
    totalDebt: 3000000000,
    shortTermDebt: 1000000000,
    longTermDebt: 2000000000,
    accountsPayable: 7000000000,
    currentLiabilities: 11000000000,
    netWorkingCapital: 23000000000,
    operatingCashFlow: 12000000000,
    capitalExpenditures: 3500000000,
    freeCashFlow: 8500000000,
    investingCashFlow: -4000000000,
    financingCashFlow: -1500000000,
    dividendsPaid: 1200000000,
    changeInCash: 6500000000,
  },
  {
    year: "FY23",
    fiscalYearEnd: "2023-03-31",
    revenue: 65000000000,
    costOfRevenue: 35000000000,
    grossProfit: 30000000000,
    grossMargin: 0.461,
    researchDevelopment: 1800000000,
    sellingGeneralAdministrative: 13000000000,
    totalOperatingExpenses: 14800000000,
    operatingIncome: 15200000000,
    ebitda: 17800000000,
    ebitdaMargin: 0.274,
    ebitMargin: 0.234,
    interestExpense: 180000000,
    otherIncome: 1200000000,
    pretaxIncome: 16220000000,
    incomeTaxExpense: 3020000000,
    netIncome: 13200000000,
    netMargin: 0.203,
    depreciation: 2600000000,
    eps: 87.0,
    dilutedEps: 87.0,
    sharesOutstanding: 151700000,
    totalAssets: 84000000000,
    totalLiabilities: 18000000000,
    totalEquity: 66000000000,
    cash: 14000000000,
    shortTermInvestments: 0,
    netReceivables: 11000000000,
    inventory: 13000000000,
    currentAssets: 40000000000,
    netFixedAssets: 34000000000,
    totalDebt: 3200000000,
    shortTermDebt: 1200000000,
    longTermDebt: 2000000000,
    accountsPayable: 8500000000,
    currentLiabilities: 13000000000,
    netWorkingCapital: 27000000000,
    operatingCashFlow: 15000000000,
    capitalExpenditures: 4200000000,
    freeCashFlow: 10800000000,
    investingCashFlow: -5000000000,
    financingCashFlow: -2000000000,
    dividendsPaid: 1500000000,
    changeInCash: 8000000000,
  },
  {
    year: "FY24",
    fiscalYearEnd: "2024-03-31",
    revenue: 76000000000,
    costOfRevenue: 41000000000,
    grossProfit: 35000000000,
    grossMargin: 0.460,
    researchDevelopment: 2200000000,
    sellingGeneralAdministrative: 14800000000,
    totalOperatingExpenses: 17000000000,
    operatingIncome: 18000000000,
    ebitda: 21000000000,
    ebitdaMargin: 0.276,
    ebitMargin: 0.237,
    interestExpense: 200000000,
    otherIncome: 1500000000,
    pretaxIncome: 19300000000,
    incomeTaxExpense: 4300000000,
    netIncome: 15000000000,
    netMargin: 0.197,
    depreciation: 3000000000,
    eps: 98.9,
    dilutedEps: 98.9,
    sharesOutstanding: 151700000,
    totalAssets: 95000000000,
    totalLiabilities: 20000000000,
    totalEquity: 75000000000,
    cash: 15000000000,
    shortTermInvestments: 0,
    netReceivables: 13000000000,
    inventory: 15000000000,
    currentAssets: 46000000000,
    netFixedAssets: 39000000000,
    totalDebt: 3420000000,
    shortTermDebt: 1420000000,
    longTermDebt: 2000000000,
    accountsPayable: 9500000000,
    currentLiabilities: 15000000000,
    netWorkingCapital: 31000000000,
    operatingCashFlow: 18000000000,
    capitalExpenditures: 5500000000,
    freeCashFlow: 12500000000,
    investingCashFlow: -6000000000,
    financingCashFlow: -2500000000,
    dividendsPaid: 1800000000,
    changeInCash: 9500000000,
  },
];

const mockDcf = {
  currentMarketPrice: 3800,
  intrinsicValue: 4250,
  verdict: "BUY",
  enterpriseValue: 630000000000,
  netDebt: -11580000000, // Net Cash: Debt (3.42B) - Cash (15B)
  equityValue: 641580000000,
  sharesOutstanding: 151700000,
  sumPvFcff: 280000000000,
  pvTerminalValue: 350000000000,
  assumptions: {
    wacc: 0.102,
    terminalGrowthRate: 0.04,
    revenueGrowthRates: [0.14, 0.13, 0.12, 0.10, 0.09],
    ebitMargins: [0.24, 0.24, 0.24, 0.24, 0.24],
    taxRate: 0.22,
  },
};

// ── 1. Create Assumptions Ledger ──
console.log("--- 1. Canonical Financial Identity & ROIC Calculation ---");

const ledger = createAssumptionsLedger({
  profile: mockProfile,
  stockData: mockStockData,
  annualFinancials: mockFinancials,
  dcf: mockDcf,
});

it("Calculates Invested Capital accurately for Net-Cash Company", () => {
  // Invested Capital = Total Equity (75B) + Total Debt (3.42B) - Cash (15B) = 63.42B
  assert.ok(ledger.investedCapital > 60000000000, `Expected invested capital > 60B, got ${ledger.investedCapital}`);
  assert.ok(ledger.investedCapital < 70000000000, `Expected invested capital < 70B, got ${ledger.investedCapital}`);
});

it("Calculates Positive ROIC and Positive ROIC-WACC Spread for PI Industries", () => {
  // Operating income = 18B, Tax = ~22%, NOPAT = ~14B. ROIC = 14B / 63.42B = ~22%
  assert.ok(ledger.roic > 0.18, `Expected ROIC > 18%, got ${(ledger.roic * 100).toFixed(1)}%`);
  assert.ok(ledger.roicSpread > 0.08, `Expected ROIC Spread > +8%, got ${(ledger.roicSpread * 100).toFixed(1)}%`);
  assert.ok(!Number.isNaN(ledger.roicSpread), "ROIC spread must not be NaN");
});

it("Assigns Stable moat outlook with domain-specific AgChem CSM rationale", () => {
  assert.strictEqual(ledger.moat.rating, "Narrow");
  assert.strictEqual(ledger.moat.trend, "Stable");
  assert.ok(ledger.moat.bridge.includes("custom synthesis (CSM)"), "Bridge should mention CSM process chemistry");
  assert.ok(ledger.moat.bridge.includes("ROIC"), "Bridge should mention ROIC");
});

// ── 2. Scenario Target Price Uniformity ──
console.log("\n--- 2. Scenario Valuation Uniformity Across Canonical Objects ---");

it("Publishes single canonical scenario targets without competing values", () => {
  const expectedBase = ledger.publishedTargetPrice;
  assert.strictEqual(ledger.scenarios.base.targetPrice, expectedBase);
  assert.strictEqual(ledger.scenarios.bull.targetPrice, Math.round(expectedBase * 1.25 * 100) / 100);
  assert.strictEqual(ledger.scenarios.bear.targetPrice, Math.round(expectedBase * 0.75 * 100) / 100);
  
  const expectedProbWeighted = Math.round((ledger.scenarios.bull.targetPrice * 0.25 + expectedBase * 0.60 + ledger.scenarios.bear.targetPrice * 0.15) * 100) / 100;
  assert.strictEqual(ledger.probabilityWeightedValue, expectedProbWeighted);
});

// ── 3. Sector Profile Ontology & Forbidden Concepts ──
console.log("\n--- 3. Sector Ontology & AgChemical Forbidden Concepts ---");

const agProf = getSectorProfile("Materials", "Agrochemicals");

it("Retrieves AGROCHEMICAL_PROFILE with correct sector ID and allowed KPIs", () => {
  assert.strictEqual(agProf.id, "agrochemical");
  assert.ok(agProf.allowedKPIs.includes("Active Ingredients (AI) Volume Growth"));
  assert.ok(agProf.allowedKPIs.includes("Molecules Registration Pipeline"));
});

it("Contains all leaked IT/platform phrases in forbiddenConcepts", () => {
  const leakedPhrases = [
    "enterprise contract",
    "enterprise contracts",
    "localized talent delivery networks",
    "customer maintenance contracts",
    "software automation",
    "product architecture",
    "assembly-line automation",
    "automated delivery expansion",
    "proprietary frameworks",
  ];
  for (const phrase of leakedPhrases) {
    assert.ok(
      agProf.forbiddenConcepts.includes(phrase),
      `Expected forbiddenConcepts to include '${phrase}'`
    );
  }
});

// ── 4. Pre-Publish QA Validator & Publication Gate ──
console.log("\n--- 4. Pre-Publish QA Validator & Semantic Checksum ---");

const mockReportData = {
  profile: mockProfile,
  stockData: mockStockData,
  annualFinancials: mockFinancials,
  dcf: mockDcf,
  cmp: 3800,
  targetPrice: ledger.publishedTargetPrice,
  recommendation: "BUY",
  assumptionsLedger: ledger,
  aiAnalysis: {
    investmentThesis: "PI Industries is a high-quality agrochemical and custom synthesis manufacturer with sustainable returns on invested capital and disciplined capital deployment.",
    businessStrategyCommentary: "The company focuses on expanding its CSM molecule synthesis contracts and patented formulation registrations across domestic and export markets.",
  },
  peers: [
    { name: "UPL Ltd", ticker: "UPL.NS", pe: 18.5, evToEbitda: 7.5, pb: 1.8, revenueGrowth: 0.05, operatingMargin: 0.14, debtToEquity: 1.2 },
    { name: "Coromandel Int", ticker: "COROMANDEL.NS", pe: 21.0, evToEbitda: 12.0, pb: 3.5, revenueGrowth: 0.08, operatingMargin: 0.12, debtToEquity: 0.1 },
    { name: "Sumitomo Chemical", ticker: "SUMICHEM.NS", pe: 42.0, evToEbitda: 25.0, pb: 8.0, revenueGrowth: 0.10, operatingMargin: 0.18, debtToEquity: 0.02 },
  ],
  generatedAt: new Date().toISOString(),
};

const qaResult = validateReportIntegrity(mockReportData);

it("Passes pre-publish QA validation with READY status and 0 failures", () => {
  const fails = qaResult.checks.filter(c => c.status === "FAIL");
  assert.strictEqual(fails.length, 0, `Expected 0 failures, got: ${fails.map(f => `${f.id}: ${f.details}`).join("; ")}`);
  assert.strictEqual(qaResult.gateStatus, "READY");
  assert.strictEqual(qaResult.passed, true);
});

it("Verifies SEMANTIC-01 check passes cleanly", () => {
  const semanticCheck = qaResult.checks.find(c => c.id === "SEMANTIC-01");
  assert.ok(semanticCheck, "SEMANTIC-01 check must exist");
  assert.strictEqual(semanticCheck.status, "PASS");
});

it("Verifies CREDIT-01 check passes for net cash position", () => {
  const creditCheck = qaResult.checks.find(c => c.id === "CREDIT-01");
  assert.ok(creditCheck, "CREDIT-01 check must exist");
  assert.strictEqual(creditCheck.status, "PASS");
});

it("Blocks publication if out-of-sector forbidden concepts are detected in narrative", () => {
  const poisonedData = {
    ...mockReportData,
    aiAnalysis: {
      ...mockReportData.aiAnalysis,
      investmentThesis: "PI Industries expands rapidly through localized talent delivery networks and enterprise contracts.",
    },
  };
  const poisonedQa = validateReportIntegrity(poisonedData);
  assert.strictEqual(poisonedQa.gateStatus, "BLOCKED");
  const bleedCheck = poisonedQa.checks.find(c => c.id === "BS-DETECTOR-04");
  assert.ok(bleedCheck, "BS-DETECTOR-04 must flag the violation");
  assert.strictEqual(bleedCheck.status, "FAIL");
  assert.ok(bleedCheck.details.includes("enterprise contracts") || bleedCheck.details.includes("localized talent delivery networks"));
});

it("Blocks publication if negative ROIC spread conflicts with superior spread claim", () => {
  const conflictingData = {
    ...mockReportData,
    assumptionsLedger: {
      ...mockReportData.assumptionsLedger,
      roicSpread: -0.025, // -2.5% negative spread
    },
    aiAnalysis: {
      ...mockReportData.aiAnalysis,
      investmentThesis: "The company generates returns substantially exceeding the cost of capital with a positive economic spread.",
    },
  };
  const conflictingQa = validateReportIntegrity(conflictingData);
  assert.strictEqual(conflictingQa.gateStatus, "BLOCKED");
  const semCheck = conflictingQa.checks.find(c => c.id === "SEMANTIC-01");
  assert.ok(semCheck, "SEMANTIC-01 must flag analytical contradiction");
  assert.strictEqual(semCheck.status, "FAIL");
});

console.log(`\n===============================================================`);
console.log(`TOTAL TESTS PASSED: ${passedCount} / 11`);
console.log(`===============================================================`);
