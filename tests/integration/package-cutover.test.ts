import { createSuite, check, report } from "../helpers/assert";
import { runCanonicalResearch } from "../../src/lib/research-package/pipeline";
import { adaptCanonicalResearchPackage } from "../../src/lib/research-package/adapter";
import { verifyCanonicalResearchPackage, canPublishResearchPackage } from "../../src/lib/research-package";
import { POST as analyzePost } from "../../src/app/api/analyze/route";
import { POST as aliasPost } from "../../src/app/api/analyze-ai-first/route";
import { NextRequest } from "next/server";

const suite = createSuite();

function row(period: string, values: Record<string, number>): Record<string, unknown> {
  return {
    endDate: { raw: period, fmt: period },
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { raw: value, fmt: String(value) }])),
  };
}

function payload(): Record<string, unknown> {
  return {
    assetProfile: { longBusinessSummary: "Cutover test company", sector: "Technology", industry: "Software", country: "US" },
    price: { longName: "Cutover Industries", shortName: "CUTO", currency: "USD", regularMarketPrice: { raw: 100 }, marketCap: { raw: 10000 } },
    summaryDetail: {},
    financialData: { financialCurrency: "USD" },
    defaultKeyStatistics: { sharesOutstanding: { raw: 100 } },
    incomeStatementHistory: { incomeStatementHistory: [row("2024-12-31", { totalRevenue: 1000, netIncome: 100 })] },
    balanceSheetHistory: { balanceSheetStatements: [row("2024-12-31", { totalAssets: 2000, totalLiabilities: 1000, totalEquity: 1000 })] },
    cashflowStatementHistory: { cashflowStatements: [row("2024-12-31", { totalCashFromOperatingActivities: 120 })] },
  };
}

async function main(): Promise<void> {
  const sourceOptions = { fetchSnapshot: async () => payload() };
  const first = await runCanonicalResearch("CUTO", { sourceContextOptions: sourceOptions, retrievalTimestamp: "2026-09-25T12:00:00.000Z", dataCutoff: "2026-09-25" });
  const second = await runCanonicalResearch("CUTO", { sourceContextOptions: sourceOptions, retrievalTimestamp: "2026-09-25T12:00:00.000Z", dataCutoff: "2026-09-25" });
  check(suite, "package verifies", verifyCanonicalResearchPackage(first.package) === true);
  check(suite, "repeated run is idempotent", first.package.packageHash === second.package.packageHash && first.package.researchRunId === second.package.researchRunId);
  check(suite, "incomplete fixture cannot publish", first.package.quality.canPublish === false && canPublishResearchPackage(first.package) === false);
  check(suite, "legacy route alias is unified", analyzePost === aliasPost);
  const legacyResponse = await analyzePost(new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: {}, stockData: {}, annualFinancials: [], dcf: {} }),
  }));
  check(suite, "legacy payload rejected", legacyResponse.status === 400 && (await legacyResponse.json() as { code?: string }).code === "LEGACY_PAYLOAD_REJECTED");
  const adapted = adaptCanonicalResearchPackage(JSON.parse(JSON.stringify(first.package)) as typeof first.package, { finalize: false });
  check(suite, "adapter preserves canonical hash", adapted.canonicalPackage?.packageHash === first.package.packageHash);
  check(suite, "adapter carries valuation and rating", adapted.targetPrice === first.package.valuationResult.fairValuePerShare && adapted.recommendation === first.package.rating);
  report(suite, "integration/package-cutover");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
