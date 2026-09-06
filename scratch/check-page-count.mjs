import React from 'react';
import { pdf } from '@react-pdf/renderer';

const { default: ReportDocument } = await import('../src/components/PDFDocument/index.tsx');

async function checkPageCount() {
  try {
    console.log('Fetching INOXWIND.NS data from http://localhost:3000/api/company?symbol=INOXWIND.NS ...');
    const res = await fetch('http://localhost:3000/api/company?symbol=INOXWIND.NS');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const companyData = await res.json();
    
    // Also fetch AI analysis
    console.log('Fetching AI analysis from http://localhost:3000/api/analyze ...');
    let aiAnalysis = null;
    try {
      const aiRes = await fetch('http://localhost:3000/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: companyData.profile,
          stockData: companyData.stockData,
          annualFinancials: companyData.annualFinancials,
          dcf: companyData.dcf,
        }),
      });
      if (aiRes.ok) {
        aiAnalysis = await aiRes.json();
      }
    } catch (e) {
      console.log('AI analyze skipped or error:', e.message);
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
      aiAnalysis: aiAnalysis,
      recommendation: dcf.verdict,
      targetPrice: Math.round(dcf.intrinsicValue),
      cmp: companyData.stockData.currentPrice,
      analystName: "Private Equity Institutional Research",
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
    
    const instance = pdf(doc);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const fs = await import('fs');
    fs.writeFileSync('scratch/inoxwind_test.pdf', buffer);
    console.log(`Saved PDF to scratch/inoxwind_test.pdf (${buffer.length} bytes)`);

    console.log(`\n========================================`);
    console.log(`LAYOUT ENGINE PAGE COUNT: ${layoutPageCount}`);
    console.log(`EXPECTED INSTITUTIONAL PAGES: 24`);
    console.log(`OVERFLOW / ORPHAN PAGES: ${layoutPageCount - 24}`);
    console.log(`========================================\n`);

  } catch (err) {
    console.error('Error rendering:', err);
  }
}

checkPageCount();

