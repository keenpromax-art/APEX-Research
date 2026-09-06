import { fetchQuoteSummary, parseQuoteSummary } from "../src/lib/yahoo-finance.ts";
import { selectAndComputeValuation } from "../src/lib/valuation/selector.ts";
import { computeRatios, computeDuPont } from "../src/lib/calculations.ts";
import { buildMasterReportFacts } from "../src/lib/report-facts.ts";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";
import { validateMasterReport } from "../src/lib/report-validator.ts";
import { validateReportIntegrity } from "../src/lib/report-qa.ts";

async function test() {
  const raw = await fetchQuoteSummary("SBIN.NS");
  const { companyProfile, stockData, annualFinancials, quarterlyFinancials, shareholding } = parseQuoteSummary(raw, "SBIN.NS");
  console.log("Profile:", companyProfile.name, companyProfile.sector, companyProfile.industry);
  console.log("CMP:", stockData.currentPrice, "Shares:", stockData.sharesOutstanding);
  const val = selectAndComputeValuation({ profile: companyProfile, stockData, annualFinancials });
  console.log("Valuation model:", val.selectedModel, "Fair Value:", val.fairValue, "Rating:", val.rating, "Upside:", val.upside);
  console.log("Residual income:", val.residualIncome);

  const cmp = stockData.currentPrice;
  const ratiosByYear = annualFinancials.map(f => computeRatios(f, cmp));
  const dupontByYear = annualFinancials.map(f => computeDuPont(f));

  const masterReportFacts = buildMasterReportFacts({
    stockData,
    profile: companyProfile,
    annualFinancials,
    ratiosByYear,
    dupontByYear,
    dcf: val.dcf,
    peers: []
  });

  const assumptionsLedger = createAssumptionsLedger({
    profile: companyProfile,
    stockData,
    annualFinancials,
    dcf: val.dcf,
  });

  console.log("Master facts fair value:", masterReportFacts.valuation.fairValue.value);
  console.log("Master facts rating:", masterReportFacts.recommendation.rating);
  console.log("Master facts moat:", masterReportFacts.moat.rating);

  const report = {
    generatedAt: new Date().toISOString(),
    profile: companyProfile,
    stockData,
    annualFinancials,
    quarterlyFinancials,
    ratiosByYear,
    dupontByYear,
    dcf: val.dcf,
    shareholding,
    peers: [],
    aiAnalysis: {
      investmentThesis: "State Bank of India is a leading public sector bank.",
    },
    recommendation: masterReportFacts.recommendation.rating,
    targetPrice: masterReportFacts.valuation.fairValue.value ?? assumptionsLedger.targetPrice,
    cmp: masterReportFacts.market.currentPrice.value ?? assumptionsLedger.currentPrice,
    analystName: "Apex Research Team",
    assumptionsLedger,
    masterReportFacts
  };

  const oldQA = validateReportIntegrity(report);
  console.log("Old QA passed:", oldQA.passed, "Score:", oldQA.score);
  console.log("Failed checks:", oldQA.checks.filter(c => c.status === "FAIL").map(c => ({ id: c.id, name: c.name, details: c.details })));

  const newQA = validateMasterReport(masterReportFacts, report);
  console.log("New QA status:", newQA.status, "CanPublish:", newQA.canPublish, "Errors:", newQA.errors.length, "Warnings:", newQA.warnings.length);
}

test();
