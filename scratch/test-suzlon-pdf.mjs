import React from 'react';
import { pdf } from '@react-pdf/renderer';

async function main() {
  try {
    console.log('Fetching SUZLON.NS data from local API...');
    const res = await fetch('http://localhost:3000/api/company?symbol=SUZLON.NS');
    if (!res.ok) {
      throw new Error(`API returned ${res.status}: ${await res.text()}`);
    }
    const companyData = await res.json();
    console.log('Fetched company:', companyData.profile?.name, 'Ticker:', companyData.profile?.ticker);

    const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

    const dcf = companyData.dcf || {
      intrinsicValue: companyData.stockData?.currentPrice || 50,
      verdict: "HOLD",
      marginOfSafety: 0.1,
      wacc: 0.11,
      terminalGrowthRate: 0.04,
      projections: []
    };

    const reportData = {
      generatedAt: new Date().toISOString(),
      profile: companyData.profile,
      stockData: companyData.stockData,
      annualFinancials: companyData.annualFinancials || [],
      quarterlyFinancials: companyData.quarterlyFinancials || [],
      ratiosByYear: companyData.ratiosByYear || [],
      dupontByYear: companyData.dupontByYear || [],
      dcf,
      shareholding: companyData.shareholding || { promoterHolding: 0.13, fiiHolding: 0.22, diiHolding: 0.15, publicHolding: 0.50 },
      peers: companyData.peers || [],
      aiAnalysis: companyData.aiAnalysis || null,
      recommendation: dcf.verdict,
      targetPrice: Math.round(dcf.intrinsicValue),
      cmp: companyData.stockData?.currentPrice || 50,
      analystName: "Institutional Research Team",
    };

    console.log('Rendering PDF with react-pdf...');
    const doc = React.createElement(ReportDocument, { data: reportData });
    const instance = pdf(doc);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fs = await import('fs');
    fs.writeFileSync('scratch/suzlon_test.pdf', buffer);
    const matches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
    console.log(`SUCCESS! Saved Suzlon PDF to scratch/suzlon_test.pdf (${buffer.length} bytes). Exact Page Count: ${matches ? matches.length : 'unknown'}`);
  } catch (err) {
    console.error('Error testing Suzlon PDF:', err);
  }
}

main();
