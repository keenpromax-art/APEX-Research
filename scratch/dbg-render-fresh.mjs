import React from "react";
import { pdf } from "@react-pdf/renderer";
import fs from "fs";

const companyData = JSON.parse(fs.readFileSync("C:\\Users\\x1-ca\\AppData\\Local\\Temp\\opencode\\reliance-fresh.json", "utf8"));
const { default: ReportDocument } = await import("../src/components/PDFDocument/index.tsx");
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
  qaReport: companyData.qaReport,
  finalQAResult: companyData.finalQAResult,
  canonicalForecast: companyData.canonicalForecast,
  canonicalFacts: undefined,
  masterReportFacts: companyData.masterReportFacts,
  calibration: companyData.calibration,
};
const concise = process.argv[2] !== "full";
const doc = React.createElement(ReportDocument, { data: reportData, ...(concise ? {} : { concise: false }) });
const blob = await pdf(doc).toBlob();
const buffer = Buffer.from(await blob.arrayBuffer());
const out = `C:\\Users\\x1-ca\\AppData\\Local\\Temp\\opencode\\reliance-${concise ? "concise" : "full"}.pdf`;
fs.writeFileSync(out, buffer);
const pages = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g);
console.log((concise ? "CONCISE" : "FULL"), "pages:", pages ? pages.length : "unknown", "bytes:", buffer.length);
