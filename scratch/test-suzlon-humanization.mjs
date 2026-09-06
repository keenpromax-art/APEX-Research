import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';

async function verifyHumanization() {
  console.log('Testing Suzlon Humanization and Anti-Glitch Overhaul...');

  const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');
  const { buildMasterReportFacts } = await import('../src/lib/report-facts.ts');
  const { classifyArchetype } = await import('../src/lib/company-archetype.ts');
  const { generatePEFirmAnalysis } = await import('../src/lib/pe-analysis-engine.ts');

  // Realistic Suzlon Energy profile (Net Cash turnaround after debt restructuring)
  const profile = {
    name: "Suzlon Energy Limited",
    ticker: "SUZLON.NS",
    currency: "INR",
    sector: "Renewable Energy",
    industry: "Wind Energy Equipment & O&M Services",
    country: "India",
    description: "Suzlon Energy Limited is a leading vertically integrated wind turbine manufacturer and renewable energy solutions provider.",
  };

  const stockData = {
    symbol: "SUZLON.NS",
    currentPrice: 65.5,
    marketCap: 890000000000,
    sharesOutstanding: 13600000000,
    pe: 45.2,
    trailingPE: 45.2,
    enterpriseValue: 880000000000, // Net cash -> EV < Market Cap
    priceToBook: 7.2,
    debtToEquity: 0.05, // Audited balance sheet has minimal debt
    profitMargins: 0.12,
    operatingMargins: 0.155,
    grossMargins: 0.35,
    returnOnEquity: 0.22,
    revenueGrowth: 0.38,
    dividendYield: 0.0, // Historical zero dividend due to past restructuring
    currentRatio: 1.45,
    quickRatio: 1.15,
  };

  const annualFinancials = [
    {
      year: 2022,
      revenue: 65200000000,
      grossProfit: 20800000000,
      ebitda: 7100000000,
      operatingIncome: 5500000000,
      netIncome: 1500000000,
      totalDebt: 32000000000,
      cash: 8000000000,
      netDebt: 24000000000,
      totalEquity: 18000000000,
      totalAssets: 68000000000,
      currentAssets: 34000000000,
      currentLiabilities: 28000000000,
      freeCashFlow: 3200000000,
      operatingCashFlow: 4500000000,
      capitalExpenditures: 1300000000,
      interestExpense: 4200000000,
      grossMargin: 0.319,
      ebitdaMargin: 0.109,
      netMargin: 0.023,
      eps: 0.15,
    },
    {
      year: 2023,
      revenue: 78500000000,
      grossProfit: 26500000000,
      ebitda: 10500000000,
      operatingIncome: 8800000000,
      netIncome: 4200000000,
      totalDebt: 12000000000,
      cash: 15000000000,
      netDebt: 0, // Turned net cash
      totalEquity: 35000000000,
      totalAssets: 75000000000,
      currentAssets: 42000000000,
      currentLiabilities: 30000000000,
      freeCashFlow: 6800000000,
      operatingCashFlow: 8200000000,
      capitalExpenditures: 1400000000,
      interestExpense: 1800000000,
      grossMargin: 0.338,
      ebitdaMargin: 0.134,
      netMargin: 0.054,
      eps: 0.42,
    },
    {
      year: 2024,
      revenue: 96500000000,
      grossProfit: 34200000000,
      ebitda: 15200000000,
      operatingIncome: 13100000000,
      netIncome: 10800000000,
      totalDebt: 1500000000, // Minimal debt
      cash: 18500000000, // Strong cash reserve
      netDebt: 0, // Solid Net Cash of ~17,000M
      totalEquity: 58000000000,
      totalAssets: 92000000000,
      currentAssets: 55000000000,
      currentLiabilities: 32000000000,
      freeCashFlow: 11500000000,
      operatingCashFlow: 13500000000,
      capitalExpenditures: 2000000000,
      interestExpense: 350000000,
      grossMargin: 0.354,
      ebitdaMargin: 0.158,
      netMargin: 0.112,
      eps: 0.85,
    }
  ];

  const dcf = {
    enterpriseValue: 880000000000,
    totalDebt: 1500000000,
    cashAndEquiv: 18500000000,
    netDebt: 0,
    equityValue: 897000000000,
    intrinsicValue: 74.5,
    currentMarketPrice: 65.5,
    verdict: "BUY",
    marginOfSafety: 0.15,
    discountRate: 0.105,
    terminalGrowthRate: 0.045,
    projections: [
      { year: 2025, fcf: 13500000000, pv: 12200000000 },
      { year: 2026, fcf: 16800000000, pv: 13700000000 },
      { year: 2027, fcf: 20500000000, pv: 15100000000 },
      { year: 2028, fcf: 24200000000, pv: 16100000000 },
      { year: 2029, fcf: 28000000000, pv: 16900000000 },
    ],
    assumptions: {
      wacc: 0.105,
      costOfEquity: 0.115,
      terminalGrowthRate: 0.045,
      effectiveTaxRate: 0.25,
    }
  };

  const news = [
    {
      title: "Suzlon Crosses 1 GW Partnership Agreement with Leading Power Producers",
      publisher: "Clean Energy Review",
      link: "https://example.com/suzlon-1gw",
      providerPublishTime: Date.now() - 86400000 * 2,
    },
    {
      title: "Suzlon Secures Major 3.15 MW S144 Wind Turbine Orders Across Gujarat & Tamil Nadu",
      publisher: "Power Infrastructure Daily",
      link: "https://example.com/suzlon-orders",
      providerPublishTime: Date.now() - 86400000 * 5,
    }
  ];

  const peers = [
    {
      ticker: "INOXWIND.NS",
      name: "Inox Wind Limited",
      marketCap: 180000000000,
      cmp: 142.5,
      pe: 34.5,
      evToEbitda: 18.2,
      pb: 4.2,
      roe: 0.14,
      netMargin: 0.085,
      grossMargin: 0.32,
      ebitdaMargin: 0.155,
      operatingMargin: 0.118,
      debtToEquity: 0.42,
      currentRatio: 1.25,
      revenueGrowth: 0.45,
      currency: "INR",
    }
  ];

  const ratiosByYear = [
    { year: 2024, pe: 45.2, pb: 7.2, evToEbitda: 28.5, currentRatio: 1.45, quickRatio: 1.15, dividendYield: 0.0, dividendPayout: 0.0 }
  ];

  const dupontByYear = [
    { year: 2024, roe: 0.22, netProfitMargin: 0.112, assetTurnover: 1.05, equityMultiplier: 1.58 }
  ];

  const facts = buildMasterReportFacts({
    stockData,
    profile,
    annualFinancials,
    ratiosByYear,
    dupontByYear,
    dcf,
    peers,
  });

  const peAnalysis = generatePEFirmAnalysis({
    profile,
    stockData,
    annualFinancials,
    dcf,
    news,
    assumptionsLedger: facts.assumptionsLedger,
  });

  console.log('\n--- 1. Checking Investment Thesis News Weaving ---');
  console.log('Thesis Snippet:', peAnalysis.investmentThesis?.slice(0, 320));
  const hasNewsWeave = peAnalysis.investmentThesis?.includes("partnership") || peAnalysis.investmentThesis?.includes("1 GW") || peAnalysis.investmentThesis?.includes("O&M");
  console.log('News & O&M Annuity Weaved into Thesis:', hasNewsWeave ? 'YES (PASS)' : 'NO (FAIL)');

  console.log('\n--- 2. Checking Moat & Supply Chain Nuance ---');
  console.log('Cost Advantage Moat:', peAnalysis.moatSources?.costAdvantage);
  const hasClusterNuance = peAnalysis.moatSources?.costAdvantage?.includes("Gujarat") || peAnalysis.moatSources?.costAdvantage?.includes("Tamil Nadu");
  console.log('Localized Manufacturing Clusters (Gujarat/Tamil Nadu) Present:', hasClusterNuance ? 'YES (PASS)' : 'NO (FAIL)');

  console.log('\n--- 3. Checking Risk Mitigations ---');
  for (const r of peAnalysis.keyRisks) {
    console.log(`- [${r.risk}]: Mitigation -> "${r.mitigation}"`);
  }
  const hasSeciPassThrough = peAnalysis.keyRisks.some(r => r.mitigation?.includes("SECI") || r.mitigation?.includes("pass-through") || r.mitigation?.includes("modular"));
  console.log('Industry Risk Mitigations (SECI pass-through, modular designs):', hasSeciPassThrough ? 'YES (PASS)' : 'NO (FAIL)');

  console.log('\n--- 4. Checking Capital Allocation & Dividend Narrative ---');
  const arch = classifyArchetype(profile, stockData, annualFinancials);
  console.log('Capital Allocation Label:', arch.capitalAllocationLabel);
  console.log('Capital Allocation Description:', arch.capitalAllocationDescription);
  console.log('Dividend CAGR Display:', arch.dividendCAGRDisplay);
  console.log('Total Shareholder Yield Display:', arch.totalShareholderYieldDisplay);

  console.log('\n--- 5. Rendering 24-Page Institutional PDF Document ---');
  const reportData = {
    generatedAt: new Date().toISOString(),
    profile,
    stockData,
    annualFinancials,
    quarterlyFinancials: [],
    ratiosByYear,
    dupontByYear,
    dcf,
    shareholding: { promoterHolding: 0.13, fiiHolding: 0.24, diiHolding: 0.18, publicHolding: 0.45 },
    peers,
    aiAnalysis: peAnalysis,
    recommendation: dcf.verdict,
    targetPrice: Math.round(dcf.intrinsicValue),
    cmp: stockData.currentPrice,
    analystName: "Senior Clean Energy Research Specialist",
    news,
    assumptionsLedger: facts.assumptionsLedger,
  };

  const doc = React.createElement(ReportDocument, { data: reportData });
  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync('scratch/suzlon_humanized_test.pdf', buffer);

  const pageMatches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
  const totalPages = pageMatches ? pageMatches.length : 0;
  console.log(`PDF successfully generated: scratch/suzlon_humanized_test.pdf (${buffer.length} bytes)`);
  console.log(`Exact Page Count: ${totalPages} Pages (Target: 24 Pages)`);

  if (totalPages === 24) {
    console.log('>>> 24-PAGE INVARIANT VERIFIED: 100% PASS <<<');
  } else {
    console.warn(`WARNING: Page count is ${totalPages}, expected 24.`);
  }
}

verifyHumanization().catch(err => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
