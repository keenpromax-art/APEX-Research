import { createSuite, check, report } from "../helpers/assert";
import { stmtNum, getStatementArchitecture, isBankStatement, isInsuranceStatement, isReitStatement, isAssetLightStatement, isCorporateStatement } from "../../src/types/report";
import { canonicalValuation, canonicalMoat, canonicalWacc, canonicalScenarios, canPublishReport } from "../../src/lib/canonical";
import { buildResearchMemorySnapshot } from "../../src/lib/research-ledger/report-adapter";
import { adaptCanonicalResearchPackage } from "../../src/lib/research-package/adapter";
import { runCanonicalResearch } from "../../src/lib/research-package/pipeline";
import type { ReportData } from "../../src/types/report";

const suite = createSuite();

const corporateRow = { year: "FY2024", revenue: 1000, grossProfit: 400, ebitda: 200, inventory: 50 } as unknown as ReportData["annualFinancials"][number];
const bankRow = { year: "FY2024", statementType: "bank", isFinancialInstitution: true, netInterestIncome: 180, deposits: 5000, loans: 4000, revenue: 300, grossProfit: 0, inventory: 0 } as unknown as ReportData["annualFinancials"][number];
const insuranceRow = { year: "FY2024", statementType: "insurance", isFinancialInstitution: true, grossWrittenPremium: 500, netEarnedPremium: 450, claimsIncurred: 300, revenue: 500 } as unknown as ReportData["annualFinancials"][number];
const reitRow = { year: "FY2024", statementType: "reit", rentalIncome: 320, netOperatingIncome: 220, revenue: 340 } as unknown as ReportData["annualFinancials"][number];
const feeRow = { year: "FY2024", statementType: "asset-light", totalFeeRevenue: 120, aumEnding: 10000, revenue: 120 } as unknown as ReportData["annualFinancials"][number];

check(suite, "corporate guard matches architecture A", isCorporateStatement(corporateRow) && getStatementArchitecture(corporateRow) === "A");
check(suite, "bank guard matches architecture B", isBankStatement(bankRow) && getStatementArchitecture(bankRow) === "B");
check(suite, "insurance guard matches architecture C", isInsuranceStatement(insuranceRow) && getStatementArchitecture(insuranceRow) === "C");
check(suite, "reit guard matches architecture D", isReitStatement(reitRow) && getStatementArchitecture(reitRow) === "D");
check(suite, "fee guard matches architecture E", isAssetLightStatement(feeRow) && getStatementArchitecture(feeRow) === "E");
check(suite, "legacy reader returns reported bank zeroed fields", stmtNum(bankRow, "grossProfit", -1) === 0 && stmtNum(bankRow, "inventory", -1) === 0);
check(suite, "legacy reader falls back when absent", stmtNum(corporateRow, "missingField", 7) === 7 && stmtNum(null, "revenue", 9) === 9);

check(suite, "canonical selectors prefer ledger", (() => {
  const data = {
    cmp: 90,
    targetPrice: 80,
    recommendation: "BUY",
    profile: { currency: "USD" },
    stockData: {},
    annualFinancials: [],
    assumptionsLedger: { fairValue: 110, targetPrice: 110, currentPrice: 100, upsideDownsidePct: 0.1, rating: "BUY", wacc: 0.09, moatRating: "Wide", moatTrend: "Stable", scenarios: { bear: { targetPrice: 90 }, base: { targetPrice: 110 }, bull: { targetPrice: 130 } } },
  } as unknown as ReportData;
  return canonicalValuation(data).source === "ledger" && canonicalValuation(data).targetPrice === 110
    && canonicalMoat(data).rating === "Wide" && canonicalWacc(data) === 0.09
    && canonicalScenarios(data)?.base?.targetPrice === 110;
})());

check(suite, "canonical selectors fall back to report", (() => {
  const data = { cmp: 100, targetPrice: 120, recommendation: "HOLD", profile: { currency: "USD" }, stockData: {}, annualFinancials: [] } as unknown as ReportData;
  return canonicalValuation(data).source === "report" && canonicalValuation(data).targetPrice === 120 && canonicalWacc(data) === null;
})());

check(suite, "memory adapter snapshots legacy report", (() => {
  const data = {
    generatedAt: "2026-09-25T12:00:00.000Z",
    profile: { ticker: "TEST", name: "Test Co", exchange: "NSE" },
    researchCase: { dataCutoff: "2026-09-25" },
    assumptionsLedger: { rating: "HOLD", targetPrice: 100, fairValue: 100, currentPrice: 95 },
    researchReport: { thesis: { thesis: "Deterministic thesis", bullCase: [], bearCase: [], keyDebate: "Debate", whatMarketMayBeMissing: "", whatCouldInvalidate: [] } },
    researchGraph: null,
    evidenceRegistry: { items: [], conflicts: [] },
  } as unknown as ReportData;
  const snapshot = buildResearchMemorySnapshot(data);
  return snapshot.version === "research-memory-v1" && snapshot.run.company.ticker === "TEST";
})());

async function packageChecks(): Promise<void> {
  const sourceOptions = {
    fetchSnapshot: async () => ({
      assetProfile: { longBusinessSummary: "Compat company", sector: "Technology", industry: "Software", country: "US" },
      price: { longName: "Compat", shortName: "COMP", currency: "USD", regularMarketPrice: { raw: 100 }, marketCap: { raw: 10000 } },
      summaryDetail: {},
      financialData: { financialCurrency: "USD" },
      defaultKeyStatistics: { sharesOutstanding: { raw: 100 } },
      incomeStatementHistory: { incomeStatementHistory: [{ endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalRevenue: { raw: 1000 }, netIncome: { raw: 100 } }] },
      balanceSheetHistory: { balanceSheetStatements: [{ endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalAssets: { raw: 2000 }, totalLiabilities: { raw: 1000 }, totalEquity: { raw: 1000 } }] },
      cashflowStatementHistory: { cashflowStatements: [{ endDate: { raw: "2024-12-31", fmt: "2024-12-31" }, totalCashFromOperatingActivities: { raw: 120 } }] },
    }),
  };
  const run = await runCanonicalResearch("COMP", { sourceContextOptions: sourceOptions, retrievalTimestamp: "2026-09-25T12:00:00.000Z", dataCutoff: "2026-09-25" });
  const adapted = adaptCanonicalResearchPackage(JSON.parse(JSON.stringify(run.package)) as typeof run.package, { finalize: false });
  check(suite, "package adapter preserves hash and pricing", adapted.canonicalPackage?.packageHash === run.package.packageHash && adapted.targetPrice === run.package.valuationResult.fairValuePerShare);
  check(suite, "unpublished package stays blocked", canPublishReport(adapted).canPublish === false);
  report(suite, "report/renderer-compat");
}

void packageChecks().catch((error) => {
  console.error(error);
  process.exit(1);
});
