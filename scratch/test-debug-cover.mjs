import React from 'react';
import { pdf, Document, Page, View, Text } from '@react-pdf/renderer';
import fs from 'fs';

async function main() {
  const mod = await import('../src/components/PDFDocument/index.tsx');
  const companyData = JSON.parse(fs.readFileSync('scratch/reliance_data.json', 'utf8'));

  const longText = "Reliance Industries Limited continues to demonstrate exceptional strategic leadership across its core hydrocarbons, retail, and telecommunications operating divisions. The group's integrated value-chain architecture enables structural cost advantages, superior operational throughput, and defensive pricing power through volatile economic cycles. Ongoing capital reinvestment in next-generation green energy giga-complexes at Jamnagar positions the enterprise for multi-decade compounding. Management's disciplined capital stewardship ensures robust free cash flow generation, sustaining conservative leverage ratios and supporting high investment-grade credit metrics across all international and domestic debt tranches.";
  const aiAnalysis = {
    investmentThesis: longText + "\n\n" + longText,
    companyOverview: longText,
    investmentConclusion: longText,
    competitiveMoat: "Wide",
    recentNewsAnalysis: [
      { headline: "Reliance Partners with Rolls-Royce for Green Hydrogen", publisher: "Financial Times", date: "Sep 2026", strategicTakeaway: longText.slice(0, 120) },
      { headline: "Jio Adds Record 5G Subscribers in Q1", publisher: "Telecom Wire", date: "Aug 2026", strategicTakeaway: longText.slice(0, 120) },
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

  const rendered = mod.ReportDocument({ data: reportData });
  const children = React.Children.toArray(rendered.props.children).filter(Boolean);
  const coverPage = children[0]; // CoverPage element

  // Check what coverPage renders
  console.log('CoverPage type:', coverPage.type.name);
  const renderedCover = coverPage.type({ data: reportData });
  console.log('renderedCover props children count:', renderedCover.props.children.length);

  // renderedCover is <Page size="A4" ...> with its children:
  // [0] Top Masthead
  // [1] Company Header
  // [2] KPI Strip
  // [3] Headline
  // [4] 3-Column Body
  // [5] PageFooter

  const body = renderedCover.props.children[4];
  const cols = body.props.children;
  console.log('Body columns count:', cols.length);

  // Test with only Col 1
  for (let c = 0; c < 3; c++) {
    const testPage = React.cloneElement(renderedCover, {}, [
      renderedCover.props.children[0],
      renderedCover.props.children[1],
      renderedCover.props.children[2],
      renderedCover.props.children[3],
      React.cloneElement(body, {}, [cols[c]]),
      renderedCover.props.children[5],
    ]);

    const singleDoc = React.createElement(Document, null, testPage);
    const inst = pdf(singleDoc);
    const blob = await inst.toBlob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const pages = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
    console.log(`Column ${c + 1} alone produced: ${pages ? pages.length : 0} pages`);
  }

  // Test pairs and all 3
  const combos = [
    { name: 'Col 1 + Col 2', colsToKeep: [cols[0], cols[1]] },
    { name: 'Col 2 + Col 3', colsToKeep: [cols[1], cols[2]] },
    { name: 'Col 1 + Col 3', colsToKeep: [cols[0], cols[2]] },
    { name: 'All 3 columns', colsToKeep: [cols[0], cols[1], cols[2]] },
  ];

  for (const combo of combos) {
    const testPage = React.cloneElement(renderedCover, {}, [
      renderedCover.props.children[0],
      renderedCover.props.children[1],
      renderedCover.props.children[2],
      renderedCover.props.children[3],
      React.cloneElement(body, {}, combo.colsToKeep),
      renderedCover.props.children[5],
    ]);
    const singleDoc = React.createElement(Document, null, testPage);
    const inst = pdf(singleDoc);
    const blob = await inst.toBlob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const pages = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
    console.log(`${combo.name} produced: ${pages ? pages.length : 0} pages`);
  }
}

main().catch(console.error);
