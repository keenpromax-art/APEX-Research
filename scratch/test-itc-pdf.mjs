import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';
import { createAssumptionsLedger } from '../src/lib/assumptions-ledger';
import { buildMasterReportFacts } from '../src/lib/report-facts';

async function main() {
  const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

  let companyData;
  if (fs.existsSync('scratch/itc_data.json')) {
    console.log('Loading ITC.NS from scratch/itc_data.json...');
    companyData = JSON.parse(fs.readFileSync('scratch/itc_data.json', 'utf8'));
  } else {
    console.log('Fetching ITC.NS from http://localhost:3000/api/company?symbol=ITC.NS ...');
    const res = await fetch('http://localhost:3000/api/company?symbol=ITC.NS');
    companyData = await res.json();
    fs.writeFileSync('scratch/itc_data.json', JSON.stringify(companyData, null, 2));
  }

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

  console.log('Rendering ITC.NS PDF document...');
  const doc = React.createElement(ReportDocument, { data: reportData });
  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const buffer = Buffer.from(await blob.arrayBuffer());

  fs.writeFileSync('scratch/itc_test.pdf', buffer);
  console.log('Saved scratch/itc_test.pdf, size:', buffer.length);
}

main().catch(console.error);
