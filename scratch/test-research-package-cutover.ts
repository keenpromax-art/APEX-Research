import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { runCanonicalResearch } from "../src/lib/research-package/pipeline";
import { adaptCanonicalResearchPackage } from "../src/lib/research-package/adapter";
import { buildResearchSourceContext } from "../src/lib/research-context";
import { canPublishResearchPackage, verifyCanonicalResearchPackage } from "../src/lib/research-package";
import { canPublishReport } from "../src/lib/canonical";
import { POST as analyzePost } from "../src/app/api/analyze/route";
import { POST as aliasPost } from "../src/app/api/analyze-ai-first/route";

function rawValue(value: number): { raw: number; fmt: string } {
  return { raw: value, fmt: String(value) };
}

function row(period: string, values: Record<string, number>): Record<string, unknown> {
  return {
    endDate: { raw: period, fmt: period },
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, rawValue(value)])),
  };
}

function payload(): Record<string, unknown> {
  return {
    assetProfile: { longBusinessSummary: "Cutover test company", sector: "Technology", industry: "Software", country: "US" },
    price: { longName: "Cutover Industries", shortName: "CUTO", currency: "USD", regularMarketPrice: rawValue(100), marketCap: rawValue(10_000) },
    summaryDetail: {},
    financialData: { financialCurrency: "USD" },
    defaultKeyStatistics: { sharesOutstanding: rawValue(100) },
    incomeStatementHistory: { incomeStatementHistory: [row("2024-12-31", { totalRevenue: 1_000, netIncome: 100, operatingIncome: 150, totalAssets: 2_000, totalEquity: 1_000, totalDebt: 200, cash: 100, totalCashFromOperatingActivities: 120, capitalExpenditures: 20, totalCurrentAssets: 500, totalCurrentLiabilities: 300, accountsReceivable: 100, inventory: 50, accountsPayable: 80, totalLiabilities: 1_000, interestExpense: 10, incomeTaxExpense: 20, pretaxIncome: 120, depreciation: 20 })] },
    balanceSheetHistory: { balanceSheetStatements: [row("2024-12-31", { totalAssets: 2_000, totalLiabilities: 1_000, totalEquity: 1_000, totalDebt: 200, cash: 100, totalCurrentAssets: 500, totalCurrentLiabilities: 300, accountsReceivable: 100, inventory: 50, accountsPayable: 80 })] },
    cashflowStatementHistory: { cashflowStatements: [row("2024-12-31", { totalCashFromOperatingActivities: 120, capitalExpenditures: 20, totalCashFromInvestingActivities: -20, totalCashFromFinancingActivities: 0, dividendsPaid: 0, changeInCash: 100, depreciation: 20 })] },
    earningsTrend: { trend: [] },
    majorHoldersBreakdown: {},
  };
}

let fetches = 0;
const sourceOptions = {
  fetchSnapshot: async () => {
    fetches += 1;
    return payload();
  },
};

async function main(): Promise<void> {
  let quoteCalls = 0;
  let timeseriesCalls = 0;
  const crossPayload = payload();
  (crossPayload.financialData as Record<string, unknown>).financialCurrency = "JPY";
  const crossContext = await buildResearchSourceContext({
    ticker: "CUTO",
    retrievalTimestamp: "2026-09-25T12:00:00.000Z",
    fetchQuote: async () => { quoteCalls += 1; return crossPayload; },
    fetchTimeseries: async () => { timeseriesCalls += 1; return {}; },
    fetchFxRate: async () => ({ rate: 0.01, source: "test-fx" }),
  });
  assert.equal(quoteCalls, 1);
  assert.equal(timeseriesCalls, 1);
  assert.equal(crossContext.profile.currency, "USD");
  assert.equal(crossContext.currencyBasis.reportingCurrency, "JPY");
  assert.equal(crossContext.currencyBasis.fxReportingToTrading, 0.01);
  const crossRevenueFact = crossContext.factPack.incomeStatement.facts.find((fact) => fact.metric === "revenue");
  assert.equal(crossRevenueFact?.value, 10);
  assert.equal(crossRevenueFact?.currencyConversion?.rate, 0.01);
  assert.equal(crossRevenueFact?.currencyConversion?.applied, true);
  const events: Array<{ type: string; schemaVersion: string; package?: { packageHash: string } }> = [];
  const first = await runCanonicalResearch("CUTO", { sourceContextOptions: sourceOptions, retrievalTimestamp: "2026-09-25T12:00:00.000Z", dataCutoff: "2026-09-25", onEvent: (event) => events.push(event) });
  const second = await runCanonicalResearch("CUTO", { sourceContextOptions: sourceOptions, retrievalTimestamp: "2026-09-25T12:00:00.000Z", dataCutoff: "2026-09-25" });
  assert.equal(fetches, 2);
  assert.equal(first.sourceContext.fetchCounts.quote, 1);
  assert.equal(first.sourceContext.fetchCounts.timeseries, 1);
  assert.equal(first.package.factPack, first.sourceContext.factPack);
  assert.equal(first.package.factPack.contentHash, first.sourceContext.factPack.contentHash);
  assert.equal(verifyCanonicalResearchPackage(first.package), true);
  assert.equal(first.package.quality.canPublish, false);
  assert.equal(canPublishResearchPackage(first.package), false);
  assert.equal(first.package.researchRunId, second.package.researchRunId);
  assert.equal(first.package.sourceSnapshotHash, second.package.sourceSnapshotHash);
  assert.equal(first.package.packageHash, second.package.packageHash);
  assert.equal(events[0]?.type, "run_started");
  assert.equal(events.every((event) => event.schemaVersion === "research-run-event-v1"), true);
  for (const type of ["run_started", "stage_started", "stage_completed", "checkpoint", "quality_update", "completed"]) {
    assert.equal(events.some((event) => event.type === type), true, type);
  }
  assert.equal(events.at(-1)?.package?.packageHash, first.package.packageHash);
  assert.equal(analyzePost, aliasPost);
  const legacyResponse = await analyzePost(new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: {}, stockData: {}, annualFinancials: [], dcf: {} }),
  }));
  assert.equal(legacyResponse.status, 400);
  assert.equal((await legacyResponse.json() as { code?: string }).code, "LEGACY_PAYLOAD_REJECTED");
  const adapted = adaptCanonicalResearchPackage(JSON.parse(JSON.stringify(first.package)) as typeof first.package, { finalize: false });
  assert.equal(adapted.canonicalPackage?.packageHash, first.package.packageHash);
  assert.equal(adapted.dcf.fairValuePerShare, first.package.valuationResult.fairValuePerShare);
  assert.equal(adapted.targetPrice, first.package.valuationResult.fairValuePerShare);
  assert.equal(adapted.cmp, first.package.sourceContext.stockData.currentPrice);
  assert.equal(adapted.recommendation, first.package.rating);
  const finalized = adaptCanonicalResearchPackage(JSON.parse(JSON.stringify(first.package)) as typeof first.package);
  assert.equal(finalized.canonicalPackage?.packageHash, first.package.packageHash);
  assert.equal(canPublishReport(finalized).canPublish, false);
  assert.equal(canPublishResearchPackage(first.package), first.package.quality.canPublish);
  const client = fs.readFileSync(path.join(process.cwd(), "src", "app", "report", "[ticker]", "ReportClient.tsx"), "utf8");
  assert.equal(client.includes("/api/company"), false);
  assert.equal(client.includes("/api/analyze-ai-first"), false);
  assert.equal(client.includes("generateAIAnalysis"), false);
  console.log("research package cutover tests passed");
}

void main();
