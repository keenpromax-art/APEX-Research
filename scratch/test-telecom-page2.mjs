import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';
import { createAssumptionsLedger } from '../src/lib/assumptions-ledger';
import { buildMasterReportFacts } from '../src/lib/report-facts';

async function main() {
  const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

  const companyData = JSON.parse(fs.readFileSync('scratch/itc_data.json', 'utf8'));
  companyData.profile.sector = "Communication Services";
  companyData.profile.industry = "Telecom Services";
  companyData.profile.description = "Major telecommunications and wireless carrier service provider with extensive 4G/5G mobile network.";

  const dcf = companyData.dcf;
  const assumptionsLedger = createAssumptionsLedger({
    profile: companyData.profile,
    stockData: companyData.stockData,
    annualFinancials: companyData.annualFinancials,
    dcf,
  });

  const masterReportFacts = buildMasterReportFacts({
    stockData: companyData.stockData,
    profile: companyData.profile,
    annualFinancials: companyData.annualFinancials,
    ratiosByYear: companyData.ratiosByYear || [],
    dupontByYear: companyData.dupontByYear || [],
    dcf,
    peers: companyData.peers || [],
    ledger: assumptionsLedger,
  });

  const reportData = {
    generatedAt: new Date().toISOString(),
    profile: companyData.profile,
    stockData: companyData.stockData,
    annualFinancials: companyData.annualFinancials,
    quarterlyFinancials: companyData.quarterlyFinancials,
    ratiosByYear: companyData.ratiosByYear,
    dupontByYear: companyData.dupontByYear,
    dcf,
    shareholding: companyData.shareholding,
    peers: companyData.peers || [],
    aiAnalysis: null,
    recommendation: assumptionsLedger.rating,
    targetPrice: assumptionsLedger.targetPrice,
    cmp: assumptionsLedger.currentPrice,
    analystName: "Private Equity Institutional Research",
    news: companyData.news,
    eventPriceMovements: companyData.eventPriceMovements,
    assumptionsLedger,
    masterReportFacts,
  };

  console.log('Rendering Telecom PDF document...');
  const doc = React.createElement(ReportDocument, { data: reportData });
  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync('scratch/telecom_test.pdf', buffer);
  console.log('Saved scratch/telecom_test.pdf, size:', buffer.length);
}

main().catch(err => {
  console.error('Error rendering PDF:', err);
  process.exit(1);
});
