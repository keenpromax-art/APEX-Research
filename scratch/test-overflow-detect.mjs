import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';

async function main() {
  const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

  const companyData = JSON.parse(fs.readFileSync('scratch/reliance_data.json', 'utf8'));

  // Create a realistic AI analysis with typical paragraph lengths
  const longText = "Reliance Industries Limited continues to demonstrate exceptional strategic leadership across its core hydrocarbons, retail, and telecommunications operating divisions. The group's integrated value-chain architecture enables structural cost advantages, superior operational throughput, and defensive pricing power through volatile economic cycles. Ongoing capital reinvestment in next-generation green energy giga-complexes at Jamnagar positions the enterprise for multi-decade compounding. Management's disciplined capital stewardship ensures robust free cash flow generation, sustaining conservative leverage ratios and supporting high investment-grade credit metrics across all international and domestic debt tranches.";

  const aiAnalysis = {
    investmentThesis: longText + "\n\n" + longText,
    companyOverview: longText + "\n\n" + longText,
    investmentConclusion: longText,
    competitiveMoat: "Wide",
    economicContext: longText,
    globalIndustryAnalysis: longText,
    domesticIndustryAnalysis: longText,
    segmentAnalysis: longText,
    quarterlyResultsCommentary: longText,
    managementCommentary: longText,
    revenueCommentary: longText,
    ebitdaCommentary: longText,
    ebitCommentary: longText,
    patCommentary: longText,
    balanceSheetCommentary: longText,
    cashFlowCommentary: longText,
    dupontCommentary: longText,
    ratioCommentary: longText,
    dcfCommentary: longText,
    swotStrengths: [longText.slice(0, 150), longText.slice(0, 150), longText.slice(0, 150), longText.slice(0, 150)],
    swotWeaknesses: [longText.slice(0, 150), longText.slice(0, 150), longText.slice(0, 150)],
    swotOpportunities: [longText.slice(0, 150), longText.slice(0, 150), longText.slice(0, 150)],
    swotThreats: [longText.slice(0, 150), longText.slice(0, 150), longText.slice(0, 150)],
    keyRisks: [
      { risk: "Commodity Margin Volatility", description: longText.slice(0, 200), impact: "High" },
      { risk: "Capex Execution Risk", description: longText.slice(0, 200), impact: "Medium" },
      { risk: "Regulatory Tariff Changes", description: longText.slice(0, 200), impact: "Medium" },
    ],
    moatSources: {
      switchingCosts: longText.slice(0, 150),
      intangibleAssets: longText.slice(0, 150),
      costAdvantage: longText.slice(0, 150),
      moatTrend: "Stable",
    },
    moatPillars: [
      { pillar: "Scale Economics", description: longText.slice(0, 150), strength: "High" },
      { pillar: "Integrated Network", description: longText.slice(0, 150), strength: "High" },
    ],
    industryDynamicsCommentary: longText,
    fiveForces: [
      { force: "Bargaining Power of Buyers", level: "Low", commentary: longText.slice(0, 120) },
      { force: "Bargaining Power of Suppliers", level: "Low", commentary: longText.slice(0, 120) },
      { force: "Threat of New Entrants", level: "Low", commentary: longText.slice(0, 120) },
      { force: "Threat of Substitutes", level: "Low", commentary: longText.slice(0, 120) },
      { force: "Competitive Rivalry", level: "Medium", commentary: longText.slice(0, 120) },
    ],
    businessStrategyCommentary: longText,
    catalysts: [
      { event: "Jio Telecommunications Public Listing", horizon: "6-12 Months", probability: "High (80%)", impact: "+15% Fair Value" },
      { event: "New Energy Giga Factory Commissioning", horizon: "12-18 Months", probability: "Medium (60%)", impact: "+12% Fair Value" },
    ],
    creditAnalysisCommentary: {
      financialHealth: longText,
      solvencyAnalysis: longText,
      liquidityCushion: longText,
      debtMaturityProfile: longText,
    },
    enterpriseRiskCommentary: longText,
    governanceCommentary: longText,
    capitalAllocationCommentary: longText,
    capitalDeploymentHistory: {
      narrative: longText,
      dividends: "Rs. 10/share",
      repurchases: "Nil",
      debtPaydown: "Substantial",
    },
    analystNotes: [
      { title: "Strategic Vision 2030", date: "Sep 2026", paragraphs: [longText.slice(0, 200), longText.slice(0, 200)] },
    ],
    recentNewsAnalysis: [
      { headline: "Reliance Partners with Rolls-Royce for Green Hydrogen", publisher: "Financial Times", date: "Sep 2026", strategicTakeaway: longText.slice(0, 150) },
      { headline: "Jio Adds Record 5G Subscribers in Q1", publisher: "Telecom Wire", date: "Aug 2026", strategicTakeaway: longText.slice(0, 150) },
    ],
  };

  const reportData = {
    generatedAt: new Date().toISOString(),
    profile: companyData.profile,
    stockData: companyData.stockData,
    annualFinancials: companyData.annualFinancials,
    quarterlyFinancials: companyData.quarterlyFinancials,
    ratiosByYear: companyData.ratiosByYear,
    dupontByYear: companyData.dupontByYear,
    dcf: companyData.dcf,
    shareholding: companyData.shareholding,
    peers: companyData.peers || [],
    aiAnalysis: aiAnalysis,
    recommendation: companyData.dcf.verdict,
    targetPrice: Math.round(companyData.dcf.intrinsicValue),
    cmp: companyData.stockData.currentPrice,
    analystName: "Private Equity Institutional Research",
    news: companyData.news,
    eventPriceMovements: companyData.eventPriceMovements,
    assumptionsLedger: companyData.assumptionsLedger,
  };

  console.log('Rendering ReportDocument with rich AI analysis...');
  const doc = React.createElement(ReportDocument, { data: reportData });
  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync('scratch/reliance_overflow_test.pdf', buffer);

  const pageMatches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
  console.log('Total Rendered Pages:', pageMatches ? pageMatches.length : 'unknown');
}

main().catch(console.error);
