import { validateReportIntegrity } from "../src/lib/report-qa.ts";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";
import { classifyArchetype } from "../src/lib/company-archetype.ts";

console.log("=== TESTING BS-DETECTOR & INSTITUTIONAL QA ENGINE ===");

// 1. Distressed Profile (Vodafone Idea)
const viProfile = {
  name: "Vodafone Idea Limited",
  ticker: "IDEA.NS",
  sector: "Communication Services",
  industry: "Telecom Services",
  country: "India",
  currency: "INR",
  description: "Vodafone Idea Limited is an India-based telecommunications service provider. The Company offers 2G, 3G, and 4G mobile telecommunications services across India.",
};

const viStockData = {
  currentPrice: 7.20,
  marketCap: 450000000000,
  pe: -2.5,
  eps: -4.50,
  dividendYield: 0.0,
  beta: 1.45,
};

const viFinancials = [
  {
    year: "FY2024",
    revenue: 426520000000,
    operatingIncome: -8000000000,
    ebitda: 80000000000,
    ebitdaMargin: 0.187,
    netIncome: -64000000000,
    operatingCashFlow: 30000000000,
    freeCashFlow: -25000000000,
    totalAssets: 1500000000000,
    totalLiabilities: 2200000000000,
    totalEquity: -700000000000,
    totalDebt: 2100000000000,
    cash: 20000000000,
    eps: -4.50,
  }
];

const viDcf = {
  intrinsicValue: 6.50,
  currentMarketPrice: 7.20,
  upsideDownside: -0.097,
  verdict: "SELL",
  assumptions: {
    wacc: 0.125,
    terminalGrowthRate: 0.035,
    riskFreeRate: 0.07,
    equityRiskPremium: 0.055,
    beta: 1.45,
    costOfEquity: 0.15,
    costOfDebtPreTax: 0.11,
    marginalTaxRate: 0.25,
    costOfDebtPostTax: 0.0825,
    debtWeight: 0.60,
    equityWeight: 0.40,
    revenueGrowthRates: [0.05, 0.05, 0.05],
    ebitMargins: [-0.02, 0.01, 0.03],
  },
  projections: [],
  sumPvFcff: 50000000000,
  terminalYearFcff: 10000000000,
  terminalValue: 120000000000,
  pvTerminalValue: 70000000000,
  enterpriseValue: 120000000000,
  lessDebt: 2100000000000,
  plusCash: 20000000000,
  equityValue: -1960000000000,
  sharesOutstanding: 68000000000,
};

// Generate calibrated ledger for Vi
const viLedger = createAssumptionsLedger({
  profile: viProfile,
  stockData: viStockData,
  dcf: viDcf,
  annualFinancials: viFinancials,
});

console.log("\n[Vi Archetype & Ledger]:");
console.log("- Archetype:", viLedger.archetype);
console.log("- Calibrated Credit Rating:", viLedger.calibratedCreditRating);
console.log("- Stewardship Rating:", viLedger.stewardshipRating);
console.log("- Dividend CAGR Display:", viLedger.dividendCAGRDisplay);
console.log("- Scenario Margins:", viLedger.scenarioMargins);

// Run QA Check with calibrated ledger
const viReportData = {
  generatedAt: new Date().toISOString(),
  profile: viProfile,
  stockData: viStockData,
  annualFinancials: viFinancials,
  quarterlyFinancials: [],
  ratiosByYear: [{
    year: "FY2024",
    grossMargin: 0.45,
    ebitdaMargin: 0.187,
    ebitMargin: -0.02,
    netMargin: -0.15,
    roe: -0.35,
    roa: -0.04,
    roce: -0.01,
    assetTurnover: 0.28,
    fixedAssetTurnover: 0.35,
    workingCapitalTurnover: -1.2,
    inventoryTurnover: 25,
    receivablesTurnover: 12,
    debtToEquity: -3.0,
    equityMultiplier: -2.1,
    interestCoverage: -0.4,
    netDebtToEbitda: 26.0,
    totalDebtToAssets: 1.4,
    currentRatio: 0.42,
    quickRatio: 0.38,
    pe: -2.5,
    evToEbitda: 22.0,
    pb: -0.6,
    ps: 1.1,
    dividendYield: 0,
    dividendPayout: 0,
    eps: -4.50,
  }],
  dupontByYear: [],
  dcf: viDcf,
  shareholding: {
    insiderOwnership: 0.50,
    institutionalOwnership: 0.25,
    publicFloat: 0.25,
    topInstitutions: [],
    categories: [],
  },
  peers: [],
  aiAnalysis: {
    companyOverview: "Vodafone Idea operates in mobile telecom in India.",
    economicContext: "Telecom carrier operating under high regulatory debt and AGR dues.",
    globalIndustryAnalysis: "Global telecom dynamics favor 5G scale leaders.",
    domesticIndustryAnalysis: "Indian telecom is a 3-player oligopoly.",
    segmentAnalysis: "Prepaid 4G accounts make up the bulk of subscriptions.",
    quarterlyResultsCommentary: "Quarterly ARPU improved to Rs. 146.",
    managementCommentary: "Management pursuing equity funding and bank debt refinancing.",
    revenueCommentary: "Revenue stabilized on tariff adjustments.",
    ebitdaCommentary: "EBITDA conversion supported by network cost optimization.",
    ebitCommentary: "EBIT remains in deficit due to high spectrum depreciation.",
    patCommentary: "Net loss driven by substantial finance costs.",
    balanceSheetCommentary: "Significant negative net worth with substantial AGR obligations.",
    cashFlowCommentary: "Operating cash flow insufficient for major 5G expansion.",
    dupontCommentary: "Negative equity limits standard DuPont applicability.",
    ratioCommentary: "High financial risk metrics across interest coverage and debt-to-equity.",
    dcfCommentary: "Intrinsic value reflects heavy enterprise debt deduction.",
    swotStrengths: ["Pan-India spectrum"],
    swotWeaknesses: ["High debt"],
    swotOpportunities: ["Tariff hike"],
    swotThreats: ["Subscriber churn"],
    keyRisks: [{ risk: "AGR dues", description: "Statutory payment burden", impact: "High" }],
    investmentConclusion: "Maintain SELL given ongoing liquidity deficit.",
  },
  recommendation: "SELL",
  targetPrice: 6.50,
  cmp: 7.20,
  analystName: "Institutional Research Desk",
  assumptionsLedger: viLedger,
};

const qaResult = validateReportIntegrity(viReportData);
console.log("\n[Vi QA Audit Result]:");
console.log("- Passed:", qaResult.passed);
console.log("- Score:", qaResult.score);
const bsChecks = qaResult.checks.filter(c => c.category === "BS_DETECTOR");
console.log(`- BS Detector Checks (${bsChecks.length}):`);
for (const c of bsChecks) {
  console.log(`  [${c.status}] ${c.id}: ${c.name} -> ${c.details}`);
}

// 2. Deliberate Bad Data Injection (Fabricated AAA Credit on Distressed Firm)
console.log("\n[Testing BS Detector on Fabricated Data]:");
const badReportData = {
  ...viReportData,
  assumptionsLedger: {
    ...viLedger,
    calibratedCreditRating: "AAA", // ILLEGAL: AAA on distressed firm!
    dividendCAGRDisplay: "12.5% p.a.", // ILLEGAL: dividend on distressed firm!
    scenarioMargins: {
      bearMargin: 0.25,
      baseMargin: 0.15, // ILLEGAL: Bear margin > Base margin!
      bullMargin: 0.10,
      bearMarginDisplay: "25.0%",
      baseMarginDisplay: "15.0%",
      bullMarginDisplay: "10.0%",
    },
  },
  aiAnalysis: {
    ...viReportData.aiAnalysis,
    economicContext: "The telecom network complies with US FDA, cGMP, and ISO 13485 regulations.", // ILLEGAL: pharma jargon in telecom!
  }
};

const badQaResult = validateReportIntegrity(badReportData);
console.log("- Bad Data Passed:", badQaResult.passed);
console.log("- Bad Data Score:", badQaResult.score);
const badBsChecks = badQaResult.checks.filter(c => c.category === "BS_DETECTOR");
for (const c of badBsChecks) {
  console.log(`  [${c.status}] ${c.id}: ${c.name} -> ${c.details}`);
}

// 3. Deliberate Cloned Peer Metrics Injection
console.log("\n[Testing BS-DETECTOR-05 on Cloned Peer Rows]:");
const clonedPeerReportData = {
  ...viReportData,
  peers: [
    { ticker: "PEER1", name: "Peer One Ltd", marketCap: 100, cmp: 50, pe: 22.4, evToEbitda: 14.2, pb: 3.5, roe: 0.18, netMargin: 0.12, revenueGrowth: 0.15, currency: "INR" },
    { ticker: "PEER2", name: "Peer Two Ltd", marketCap: 200, cmp: 60, pe: 22.4, evToEbitda: 14.2, pb: 3.5, roe: 0.18, netMargin: 0.12, revenueGrowth: 0.15, currency: "INR" }, // Cloned identical ratios!
    { ticker: "PEER3", name: "Peer Three Ltd", marketCap: 300, cmp: 70, pe: 22.4, evToEbitda: 14.2, pb: 3.5, roe: 0.18, netMargin: 0.12, revenueGrowth: 0.15, currency: "INR" }, // Cloned identical ratios!
  ],
};
const peerQaResult = validateReportIntegrity(clonedPeerReportData);
const peerBsCheck = peerQaResult.checks.find(c => c.id === "BS-DETECTOR-05");
console.log(`- [${peerBsCheck?.status}] ${peerBsCheck?.id}: ${peerBsCheck?.name} -> ${peerBsCheck?.details}`);

