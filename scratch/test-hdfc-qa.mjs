import { fetchQuoteSummary, parseQuoteSummary } from "../src/lib/yahoo-finance.ts";
import { computeRatios, computeDuPont } from "../src/lib/calculations.ts";
import { selectAndComputeValuation } from "../src/lib/valuation/selector.ts";
import { buildMasterReportFacts } from "../src/lib/report-facts.ts";
import { validateMasterReport } from "../src/lib/report-validator.ts";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger.ts";

async function run() {
  try {
    const raw = await fetchQuoteSummary("HDFCBANK.NS");
    const { companyProfile, stockData, annualFinancials, quarterlyFinancials, shareholding } =
      parseQuoteSummary(raw, "HDFCBANK.NS");

    const cmp = stockData.currentPrice;
    const ratiosByYear = annualFinancials.map(f => computeRatios(f, cmp));
    const dupontByYear = annualFinancials.map(f => computeDuPont(f));

    const valuationResult = selectAndComputeValuation({
      profile: companyProfile,
      stockData,
      annualFinancials
    });
    const dcf = valuationResult.dcf;

    console.log("CMP:", cmp);
    console.log("Valuation Result:", JSON.stringify(valuationResult, null, 2));
    console.log("StockData shares:", stockData.sharesOutstanding, "PriceToBook:", stockData.priceToBook);
    const latestFin = annualFinancials[annualFinancials.length - 1];
    console.log("Latest Fin: Equity:", latestFin.totalEquity, "Shares:", latestFin.sharesOutstanding, "NetIncome:", latestFin.netIncome);

    const masterReportFacts = buildMasterReportFacts({
      stockData,
      profile: companyProfile,
      annualFinancials,
      ratiosByYear,
      dupontByYear,
      dcf,
      peers: []
    });

    const assumptionsLedger = createAssumptionsLedger({
      profile: companyProfile,
      stockData,
      annualFinancials,
      dcf,
    });

    const report = {
      generatedAt: new Date().toISOString(),
      profile: companyProfile,
      stockData,
      annualFinancials,
      quarterlyFinancials,
      ratiosByYear,
      dupontByYear,
      dcf,
      shareholding,
      peers: [],
      aiAnalysis: { investmentThesis: "HDFC Bank analysis." },
      recommendation: masterReportFacts.recommendation.rating,
      targetPrice: masterReportFacts.valuation.fairValue.value ?? assumptionsLedger.targetPrice,
      cmp: masterReportFacts.market.currentPrice.value ?? assumptionsLedger.currentPrice,
      analystName: "Apex Research Team",
      assumptionsLedger,
      masterReportFacts
    };

    const finalQA = validateMasterReport(masterReportFacts, report);
    console.log("Status:", finalQA.status, "CanPublish:", finalQA.canPublish);
    console.log("Errors:", JSON.stringify(finalQA.errors, null, 2));
    console.log("Warnings:", JSON.stringify(finalQA.warnings, null, 2));
  } catch (err) {
    console.error(err);
  }
}

run();
