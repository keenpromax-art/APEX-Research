import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';

async function main() {
  const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

  console.log('Fetching BANKBARODA.NS from http://localhost:3000/api/company?symbol=BANKBARODA.NS ...');
  let companyData;
  try {
    const res = await fetch('http://localhost:3000/api/company?symbol=BANKBARODA.NS');
    companyData = await res.json();
  } catch (e) {
    console.log('API fetch failed, testing with Reliance data with 22 QA checks injected...');
    companyData = JSON.parse(fs.readFileSync('scratch/reliance_data.json', 'utf8'));
  }

  const dcf = companyData.dcf || {};
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
    recommendation: dcf.verdict || "HOLD",
    targetPrice: Math.round(dcf.intrinsicValue || 250),
    cmp: companyData.stockData.currentPrice,
    analystName: "Private Equity Institutional Research",
    news: companyData.news,
    eventPriceMovements: companyData.eventPriceMovements,
    assumptionsLedger: companyData.assumptionsLedger,
    qaReport: companyData.qaReport || {
      gateStatus: "READY",
      checks: Array.from({ length: 22 }, (_, i) => ({
        id: `CHECK-${i + 1}`,
        name: `Institutional Architecture Verification Rule ${i + 1}`,
        status: i === 3 ? "WARN" : "PASS",
        details: `Verified rule ${i + 1} against SEC/SEBI LODR regulatory standards.`,
      })),
      tierSummary: { consistency: "PASS", plausibility: "PASS", appropriateness: "PASS" },
    },
  };

  console.log('Compiling PDF for BANKBARODA with QA checks...');
  const doc = React.createElement(ReportDocument, { data: reportData });
  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync('scratch/bankbaroda_test.pdf', buffer);

  const pageMatches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 'unknown';
  console.log('Total Pages in PDF:', pageCount);
  if (pageCount === 24) {
    console.log('SUCCESS: Page 24 fits exactly on 1 page! 0 overflow pages!');
  } else {
    console.error(`FAILURE: Expected 24 pages, got ${pageCount}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
