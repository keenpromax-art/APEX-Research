import React from 'react';
import { pdf } from '@react-pdf/renderer';
import fs from 'fs';
import path from 'path';

const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

async function main() {
  try {
    console.log('Fetching MSFT data from localhost:3000/api/company?symbol=MSFT...');
    const res = await fetch('http://localhost:3000/api/company?symbol=MSFT');
    const companyData = await res.json();
    console.log('Company fetched:', companyData.profile?.name, 'Sector:', companyData.profile?.sector);

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
      analystName: "Apex Research Team",
    };

    console.log('Rendering PDF with ReportDocument...');
    const doc = React.createElement(ReportDocument, { data: reportData });
    const instance = pdf(doc);
    const blob = await instance.toBuffer();
    const outPath = path.resolve('./msft_report_test.pdf');
    fs.writeFileSync(outPath, blob);
    console.log(`SUCCESS! Rendered MSFT PDF to ${outPath}. File size: ${blob.length} bytes`);
  } catch (err) {
    console.error('FAILED TO RENDER MSFT PDF:', err);
  }
}

main();
