import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';

async function main() {
  const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

  let companyData;
  if (fs.existsSync('scratch/reliance_data.json')) {
    console.log('Loading RELIANCE.NS from scratch/reliance_data.json...');
    companyData = JSON.parse(fs.readFileSync('scratch/reliance_data.json', 'utf8'));
  } else {
    console.log('Fetching RELIANCE.NS from http://localhost:3000/api/company?symbol=RELIANCE.NS ...');
    const res = await fetch('http://localhost:3000/api/company?symbol=RELIANCE.NS');
    companyData = await res.json();
    fs.writeFileSync('scratch/reliance_data.json', JSON.stringify(companyData, null, 2));
  }

  const dcf = companyData.dcf;
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
    recommendation: dcf.verdict,
    targetPrice: Math.round(dcf.intrinsicValue),
    cmp: companyData.stockData.currentPrice,
    analystName: "Private Equity Institutional Research",
    news: companyData.news,
    eventPriceMovements: companyData.eventPriceMovements,
    assumptionsLedger: companyData.assumptionsLedger,
  };

  let layoutPageCount = null;
  const doc = React.createElement(ReportDocument, {
    data: reportData,
    onRender: ({ _INTERNAL__LAYOUT__DATA_ }) => {
      if (_INTERNAL__LAYOUT__DATA_?.children) {
        layoutPageCount = _INTERNAL__LAYOUT__DATA_.children.length;
      }
    }
  });

  console.log('Compiling PDF...');
  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync('scratch/reliance_test.pdf', buffer);

  const pageMatches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
  console.log('Rendered reliance_test.pdf');
  console.log('Total Pages in PDF:', pageMatches ? pageMatches.length : 'unknown');
  console.log('Layout children count:', layoutPageCount);
}

main().catch(console.error);
