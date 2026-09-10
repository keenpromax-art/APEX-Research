import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import { buildMasterReportFacts } from "../src/lib/report-facts";
import { validateReportIntegrity } from "../src/lib/report-qa";
import { validateMasterReport } from "../src/lib/report-validator";
import { sanitizeSectorBleed, sanitizeAIText } from "../src/lib/ai/sanitizer";
import { generatePEFirmAnalysis } from "../src/lib/pe-analysis-engine";
import { selectAndComputeValuation } from "../src/lib/valuation/selector";
import { classifyArchetype } from "../src/lib/company-archetype";
import type { CompanyProfile, StockData, AnnualFinancials, ReportData } from "../src/types/report";

console.log("=======================================================");
console.log("TESTING PUBLICATION GATE INTEGRITY & UNBLOCKING");
console.log("=======================================================\n");

const testCompanies = [
  {
    name: "Bank of Baroda",
    ticker: "BANKBARODA.NS",
    profile: {
      ticker: "BANKBARODA.NS",
      name: "Bank of Baroda",
      sector: "Financial Services",
      industry: "Banks - State-Run",
      currency: "INR",
      exchange: "NSE",
      country: "India",
      description: "Premier public sector bank in India with strong CASA and advances growth.",
    },
    stockData: {
      ticker: "BANKBARODA.NS",
      currentPrice: 245.5,
      sharesOutstanding: 5171000000,
      marketCap: 1269480500000,
      beta: 1.25,
      pe: 7.2,
      pb: 0.95,
      dividendYield: 0.035,
      week52High: 298.0,
      week52Low: 190.0,
      operatingMargins: 0.28,
      profitMargins: 0.16,
      revenueGrowth: 0.14,
    },
    annualFinancials: [
      {
        year: "FY2023",
        revenue: 1107770000000,
        grossProfit: 600000000000,
        ebitda: 280000000000,
        operatingIncome: 250000000000,
        netIncome: 141090000000,
        eps: 27.28,
        totalDebt: 0,
        cash: 120000000000,
        totalAssets: 14585620000000,
        totalLiabilities: 13504460000000,
        totalEquity: 1081160000000,
        operatingCashFlow: 150000000000,
        capitalExpenditures: 20000000000,
        freeCashFlow: 130000000000,
        sharesOutstanding: 5171000000,
      },
      {
        year: "FY2024",
        revenue: 1275000000000,
        grossProfit: 700000000000,
        ebitda: 320000000000,
        operatingIncome: 290000000000,
        netIncome: 177880000000,
        eps: 34.40,
        totalDebt: 0,
        cash: 140000000000,
        totalAssets: 16250000000000,
        totalLiabilities: 15000000000000,
        totalEquity: 1250000000000,
        operatingCashFlow: 180000000000,
        capitalExpenditures: 22000000000,
        freeCashFlow: 158000000000,
        sharesOutstanding: 5171000000,
      }
    ],
  },
  {
    name: "Reliance Industries",
    ticker: "RELIANCE.NS",
    profile: {
      ticker: "RELIANCE.NS",
      name: "Reliance Industries Limited",
      sector: "Energy",
      industry: "Oil & Gas Refining & Marketing",
      currency: "INR",
      exchange: "NSE",
      country: "India",
      description: "Indian conglomerate spanning energy, petrochemicals, telecommunications, and retail.",
    },
    stockData: {
      ticker: "RELIANCE.NS",
      currentPrice: 1285.0,
      sharesOutstanding: 6765000000,
      marketCap: 8693025000000,
      beta: 0.95,
      pe: 24.5,
      pb: 2.1,
      dividendYield: 0.008,
      week52High: 1600.0,
      week52Low: 1100.0,
      operatingMargins: 0.15,
      profitMargins: 0.08,
      revenueGrowth: 0.09,
    },
    annualFinancials: [
      {
        year: "FY2023",
        revenue: 8778350000000,
        grossProfit: 2150000000000,
        ebitda: 1530000000000,
        operatingIncome: 1050000000000,
        netIncome: 667020000000,
        eps: 98.6,
        totalDebt: 3140000000000,
        shortTermDebt: 900000000000,
        longTermDebt: 2240000000000,
        cash: 670000000000,
        totalAssets: 16500000000000,
        totalLiabilities: 8000000000000,
        totalEquity: 8500000000000,
        operatingCashFlow: 1150320000000,
        capitalExpenditures: 1409880000000,
        freeCashFlow: -259560000000,
        sharesOutstanding: 6765000000,
      },
      {
        year: "FY2024",
        revenue: 9010640000000,
        grossProfit: 2264650000000,
        ebitda: 1769440000000,
        operatingIncome: 1116660000000,
        netIncome: 696210000000,
        eps: 51.45,
        totalDebt: 3461420000000,
        shortTermDebt: 1019100000000,
        longTermDebt: 2227120000000,
        cash: 972250000000,
        totalAssets: 17559860000000,
        totalLiabilities: 8301980000000,
        totalEquity: 9257880000000,
        operatingCashFlow: 1587880000000,
        capitalExpenditures: 1528830000000,
        freeCashFlow: 59050000000,
        sharesOutstanding: 6765000000,
      }
    ],
  }
];

let allPassed = true;

for (const company of testCompanies) {
  console.log(`--- Testing ${company.name} (${company.ticker}) ---`);

  // Production valuation path (selector routes financials to residual-income,
  // operating companies to driver-native FCFF) — never raw computeDCF for banks.
  const archetypeProfile = classifyArchetype(company.profile as any, company.stockData as any, company.annualFinancials as any);
  const valuation = selectAndComputeValuation({
    profile: company.profile as any,
    stockData: company.stockData as any,
    annualFinancials: company.annualFinancials as any,
    archetypeProfile,
  });
  const dcf = valuation.dcf;
  const assumptionsLedger = createAssumptionsLedger({
    profile: company.profile as any,
    stockData: company.stockData as any,
    annualFinancials: company.annualFinancials as any,
    dcf,
  });

  const masterReportFacts = buildMasterReportFacts({
    stockData: company.stockData as any,
    profile: company.profile as any,
    annualFinancials: company.annualFinancials as any,
    ratiosByYear: [],
    dupontByYear: [],
    dcf,
    peers: [],
    ledger: assumptionsLedger,
  });

  // Raw AI analysis (simulating fallback with potential out-of-sector terms).
  // The canonical ledger is threaded in (as in production) so moat pillars
  // harmonize to the authoritative moat rating before QA runs.
  const rawAi = generatePEFirmAnalysis({
    profile: company.profile as any,
    stockData: company.stockData as any,
    annualFinancials: company.annualFinancials as any,
    dcf,
    assumptionsLedger,
  });

  // Company-specific contamination: terms foreign to EACH company's sector,
  // so the sanitizer is forced to rewrite (3 distinct terms → SANITIZE-01 FAIL).
  const bleedText = company.ticker.includes("BANKBARODA")
    ? "This report discusses dark stores, refinery throughput, and spectrum auction."
    : "This report discusses saas churn, arr expansion and app store commission issues.";

  const buildReport = (contaminated: boolean) => {
    const raw = JSON.parse(JSON.stringify(rawAi));
    if (contaminated) (raw as any).testBleed = bleedText;
    const rewriteLog: string[] = [];
    const bleedCleanedAi = sanitizeSectorBleed(raw, company.profile.sector, company.profile.industry, (company.profile as any).description, rewriteLog);
    const sanitizedAi = {
      ...bleedCleanedAi,
      investmentThesis: sanitizeAIText(bleedCleanedAi.investmentThesis || "", masterReportFacts).sanitizedText,
      companyOverview: sanitizeAIText(bleedCleanedAi.companyOverview || "", masterReportFacts).sanitizedText,
      competitiveMoat: masterReportFacts.moat.rating,
    };

    const report: ReportData = {
      generatedAt: new Date().toISOString(),
      profile: company.profile as any,
      stockData: company.stockData as any,
      annualFinancials: company.annualFinancials as any,
      quarterlyFinancials: [],
      ratiosByYear: [],
      dupontByYear: [],
      dcf,
      shareholding: null as any,
      peers: [],
      aiAnalysis: sanitizedAi,
      news: [],
      eventPriceMovements: [],
      recommendation: assumptionsLedger.rating,
      targetPrice: assumptionsLedger.targetPrice,
      cmp: assumptionsLedger.currentPrice,
      analystName: "Apex Research Team",
      assumptionsLedger,
      masterReportFacts,
      sanitizerReport: { rewrittenTerms: rewriteLog },
    };

    const qaReport = validateReportIntegrity(report);
    report.qaReport = qaReport;
    const finalQAResult = validateMasterReport(masterReportFacts, report);
    report.finalQAResult = finalQAResult;
    return { report, qaReport, finalQAResult, rewriteLog };
  };

  // ── Phase A: contaminated narrative must BLOCK (true-positive test) ──
  {
    const { qaReport, finalQAResult, rewriteLog } = buildReport(true);
    const san01 = qaReport.checks.find(c => c.id === "SANITIZE-01");
    const bsDet04 = qaReport.checks.find(c => c.id === "BS-DETECTOR-04");
    console.log(`  [A] rewrites=[${rewriteLog.join(", ")}] SANITIZE-01=${san01?.status} BS-DETECTOR-04=${bsDet04?.status} gate=${qaReport.gateStatus} publish=${finalQAResult.canPublish}`);
    if (rewriteLog.length < 2) {
      console.error(`  ❌ Phase A: sanitizer should have rewritten ≥2 terms on ${company.ticker}`);
      allPassed = false;
    }
    if (san01?.status !== "FAIL") {
      console.error(`  ❌ Phase A: SANITIZE-01 must FAIL contaminated narrative on ${company.ticker}`);
      allPassed = false;
    }
    if (bsDet04?.status !== "PASS") {
      console.error(`  ❌ Phase A: scrubber should leave zero residual terms (BS-DETECTOR-04) on ${company.ticker}`);
      allPassed = false;
    }
    if (qaReport.gateStatus !== "BLOCKED") {
      console.error(`  ❌ Phase A: gate must BLOCK contaminated report for ${company.ticker}`);
      allPassed = false;
    }
    if (finalQAResult.canPublish) {
      console.error(`  ❌ Phase A: finalQAResult must refuse contaminated report for ${company.ticker}`);
      allPassed = false;
    }
  }

  // ── Phase B: clean narrative must PUBLISH (false-positive test) ──
  {
    const { qaReport, finalQAResult } = buildReport(false);
    const xref02 = qaReport.checks.find(c => c.id === "XREF-02");
    const xref04 = qaReport.checks.find(c => c.id === "XREF-04");
    const bsDet04 = qaReport.checks.find(c => c.id === "BS-DETECTOR-04");
    const san01 = qaReport.checks.find(c => c.id === "SANITIZE-01");

    const failChecks = qaReport.checks.filter(c => c.status === "FAIL");

    console.log(`  [B] XREF-02 Status: ${xref02?.status} (${xref02?.details || ""})`);
    console.log(`  [B] XREF-04 Status: ${xref04?.status} (${xref04?.details || ""})`);
    console.log(`  [B] BS-DETECTOR-04 Status: ${bsDet04?.status} (${bsDet04?.details || ""})`);
    console.log(`  [B] SANITIZE-01 Status: ${san01?.status}`);
    console.log(`  [B] Overall Gate Status: ${qaReport.gateStatus} (Score: ${qaReport.score}/100)`);
    console.log(`  [B] Final QA Can Publish: ${finalQAResult.canPublish} (Status: ${finalQAResult.status})\n`);

    if (xref02?.status !== "PASS") {
      console.error(`  ❌ FAILED XREF-02 on ${company.ticker}`);
      allPassed = false;
    }
    if (xref04?.status !== "PASS") {
      console.error(`  ❌ FAILED XREF-04 on ${company.ticker}`);
      allPassed = false;
    }
    if (bsDet04?.status !== "PASS") {
      console.error(`  ❌ FAILED BS-DETECTOR-04 on ${company.ticker}`);
      allPassed = false;
    }
    if (san01?.status !== "PASS") {
      console.error(`  ❌ FAILED SANITIZE-01 on clean report for ${company.ticker} (false positive)`);
      allPassed = false;
    }
    if (qaReport.gateStatus === "BLOCKED") {
      console.error(`  ❌ Publication gate is BLOCKED for clean ${company.ticker}! Failures:`, failChecks.map(f => `${f.id}: ${f.name}`));
      allPassed = false;
    }
    if (!finalQAResult.canPublish) {
      console.error(`  ❌ finalQAResult canPublish is false for clean ${company.ticker}! Errors:`, finalQAResult.errors.map(e => `${e.code}: ${e.message}`));
      allPassed = false;
    }
  }
}

if (allPassed) {
  console.log("=======================================================");
  console.log("SUCCESS: ALL QA CHECKS PASSED, PUBLICATION GATE UNLOCKED!");
  console.log("=======================================================");
  process.exit(0);
} else {
  console.error("FAILURE: Some QA checks failed.");
  process.exit(1);
}
