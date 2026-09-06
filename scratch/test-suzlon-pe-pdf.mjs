import React from 'react';
import { pdf } from '@react-pdf/renderer';

const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

async function testSuzlonPDF() {
  try {
    console.log('Fetching SUZLON.NS data from http://localhost:3000/api/company?symbol=SUZLON.NS ...');
    const res = await fetch('http://localhost:3000/api/company?symbol=SUZLON.NS');
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const companyData = await res.json();
    console.log('Company fetched successfully:', companyData.profile?.name, 'Sector:', companyData.profile?.sector);

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
      aiAnalysis: null, // Test fallback to PE engine
      recommendation: dcf.verdict,
      targetPrice: Math.round(dcf.intrinsicValue),
      cmp: companyData.stockData.currentPrice,
      analystName: "Private Equity Institutional Research",
    };

    console.log('Rendering 23-page PDF with ReportDocument...');
    const start = Date.now();
    const doc = React.createElement(ReportDocument, { data: reportData });
    const instance = pdf(doc);
    const buffer = await instance.toBuffer();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`SUCCESS! 23-Page PDF generated in ${elapsed}s. Size: ${buffer.length} bytes (~${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error('FAILED TO RENDER SUZLON PDF:', err);
    process.exit(1);
  }
}

testSuzlonPDF();
