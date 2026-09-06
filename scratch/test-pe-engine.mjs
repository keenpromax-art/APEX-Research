import { generatePEFirmAnalysis } from "../src/lib/pe-analysis-engine.ts";

const mockSuzlon = {
  profile: {
    name: "Suzlon Energy Limited",
    ticker: "SUZLON.NS",
    exchange: "NSE",
    currency: "INR",
    sector: "Industrials",
    industry: "Specialty Industrial Machinery",
    country: "India",
    description: "Suzlon Energy Limited is an India-based renewable energy solutions provider. The Company is engaged in the business of manufacturing of wind turbine generators (WTGs) and related components, and providing operations and maintenance (O&M) services.",
    employees: 6000,
    website: "https://www.suzlon.com",
    officers: []
  },
  stockData: {
    currentPrice: 45.35,
    marketCap: 618000000000,
    pe: 45.2,
    eps: 1.01
  },
  annualFinancials: [
    {
      year: "2024",
      revenue: 65290000000,
      grossProfit: 28000000000,
      operatingIncome: 8500000000,
      netIncome: 6600000000,
      operatingCashFlow: 7200000000,
      freeCashFlow: 5800000000,
      totalAssets: 85000000000,
      totalLiabilities: 35000000000,
      totalEquity: 50000000000,
      totalDebt: 0,
      eps: 1.01
    }
  ],
  dcf: {
    intrinsicValue: 48.0,
    verdict: "HOLD",
    marginOfSafety: 0.06,
    wacc: 0.11,
    terminalGrowthRate: 0.04,
    projections: []
  }
};

const res = generatePEFirmAnalysis(mockSuzlon);
console.log("=== PE INVESTMENT THESIS ===");
console.log(res.investmentThesis);
console.log("\n=== MOAT SOURCES ===");
console.log(res.moatSources);
console.log("\n=== 5 FORCES ===");
console.log(res.fiveForces);
console.log("\n=== 8 ANALYST NOTES COUNT ===");
console.log(res.analystNotes?.length);
console.log("\nSample Note 1:", res.analystNotes?.[0]?.title);
console.log("\n=== COUNCIL VERIFICATION AGENT AUDIT ===");
console.log(JSON.stringify(res.councilVerification, null, 2));

