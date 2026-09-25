import assert from "node:assert/strict";
import { buildFactPack } from "../src/lib/ai-first/fact-pack";
import type { FactPack } from "../src/lib/ai-first/types";
import { buildCanonicalEvidenceRegistry } from "../src/lib/research-retrieval/evidence";
import { executeResearchRetrieval } from "../src/lib/research-retrieval/retrieval";
import { buildNormalizedHistory } from "../src/lib/history";
import { assessEarningsQuality } from "../src/lib/earnings-quality";
import { buildCapitalAllocationLedger } from "../src/lib/capital-allocation";
import { buildManagementCredibilityLedger } from "../src/lib/management-credibility";
import { buildGuidanceReconciliation } from "../src/lib/guidance-reconciliation";
import { decomposeResearchConfidence } from "../src/lib/research-package/confidence";

const retrievalTimestamp = "2026-09-25T12:00:00.000Z";

let passed = 0;
let failed = 0;

function check(name: string, assertion: () => void): void {
  try {
    assertion();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function raw(value: number): { raw: number; fmt: string } {
  return { raw: value, fmt: String(value) };
}

function statementRow(period: string, values: Record<string, number>): Record<string, unknown> {
  return {
    endDate: { raw: period, fmt: period },
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, raw(value)])),
  };
}

const INCOME = [
  ["2018-12-31", { totalRevenue: 1000, grossProfit: 380, operatingIncome: 210, netIncome: 140, pretaxIncome: 180, incomeTaxExpense: 40, interestExpense: 12, dilutedEPS: 2.8, dilutedAverageShares: 50, grossProfit_: 0 }],
  ["2019-12-31", { totalRevenue: 1120, grossProfit: 420, operatingIncome: 235, netIncome: 155, pretaxIncome: 198, incomeTaxExpense: 43, interestExpense: 13, dilutedEPS: 3.05, dilutedAverageShares: 50.5 }],
  ["2020-12-31", { totalRevenue: 1050, grossProfit: 380, operatingIncome: 205, netIncome: 130, pretaxIncome: 165, incomeTaxExpense: 35, interestExpense: 14, dilutedEPS: 2.55, dilutedAverageShares: 51 }],
  ["2021-12-31", { totalRevenue: 1240, grossProfit: 470, operatingIncome: 260, netIncome: 175, pretaxIncome: 222, incomeTaxExpense: 47, interestExpense: 15, dilutedEPS: 3.35, dilutedAverageShares: 51.5 }],
  ["2022-12-31", { totalRevenue: 1490, grossProfit: 580, operatingIncome: 330, netIncome: 230, pretaxIncome: 292, incomeTaxExpense: 62, interestExpense: 18, dilutedEPS: 4.4, dilutedAverageShares: 52 }],
  ["2023-12-31", { totalRevenue: 1780, grossProfit: 730, operatingIncome: 430, netIncome: 300, pretaxIncome: 380, incomeTaxExpense: 80, interestExpense: 22, dilutedEPS: 5.7, dilutedAverageShares: 52.4 }],
  ["2024-12-31", { totalRevenue: 1900, grossProfit: 780, operatingIncome: 470, netIncome: 330, pretaxIncome: 415, incomeTaxExpense: 85, interestExpense: 25, dilutedEPS: 6.2, dilutedAverageShares: 52.6 }],
  ["2025-12-31", { totalRevenue: 2050, grossProfit: 860, operatingIncome: 520, netIncome: 370, pretaxIncome: 465, incomeTaxExpense: 95, interestExpense: 28, dilutedEPS: 6.95, dilutedAverageShares: 52.7 }],
  ["2026-12-31", { totalRevenue: 2200, grossProfit: 940, operatingIncome: 570, netIncome: 410, pretaxIncome: 512, incomeTaxExpense: 102, interestExpense: 30, dilutedEPS: 7.7, dilutedAverageShares: 52.8 }],
  ["2027-12-31", { totalRevenue: 3600, grossProfit: 1800, operatingIncome: 1260, netIncome: 900, pretaxIncome: 1125, incomeTaxExpense: 225, interestExpense: 30, dilutedEPS: 8.2, dilutedAverageShares: 52.9 }],
] as const;

const BALANCE = INCOME.map(([period, values]) => [
  period as string,
  {
    totalAssets: 2400 + values.totalRevenue * 0.5,
    totalEquity: 1100 + values.totalRevenue * 0.4,
    totalDebt: 420 + values.totalRevenue * 0.05,
    cash: 220 + values.totalRevenue * 0.03,
    totalCurrentAssets: 700 + values.totalRevenue * 0.25,
    totalCurrentLiabilities: 520 + values.totalRevenue * 0.2,
    accountsReceivable: 180 + values.totalRevenue * 0.09,
    inventory: 140 + values.totalRevenue * 0.07,
    accountsPayable: 200 + values.totalRevenue * 0.08,
  },
] as const);

const CASHFLOW = INCOME.map(([period, values]) => [
  period as string,
  {
    totalCashFromOperatingActivities: 90 + values.operatingIncome * 0.55,
    capitalExpenditures: -(20 + values.totalRevenue * 0.05),
    depreciation: 40 + values.totalRevenue * 0.02,
    stockBasedCompensation: 6 + values.totalRevenue * 0.004,
    dividendsPaid: -(10 + values.netIncome * 0.12),
    repurchaseOfCapitalStock: period === "2025-12-31" ? -60 : 0,
    repaymentOfDebt: period === "2024-12-31" ? -80 : 0,
    issuanceOfDebt: period === "2023-12-31" ? 120 : 0,
    acquisitionOfBusiness: period === "2022-12-31" ? -150 : 0,
    changeInReceivables: 0,
  },
] as const);

function payload(): Record<string, unknown> {
  return {
    assetProfile: { longBusinessSummary: "Analytics Industries manufactures and sells industrial analytics hardware and recurring software subscriptions.", sector: "Industrials", industry: "Specialty Industrial Machinery", country: "US" },
    price: { longName: "Analytics Industries", shortName: "ANLS", currency: "USD", regularMarketPrice: raw(120), marketCap: raw(6_200) },
    summaryDetail: { beta: raw(1.1), trailingPE: raw(22), priceToBook: raw(4.1) },
    financialData: { financialCurrency: "USD", targetMeanPrice: raw(132), targetHighPrice: raw(150), targetLowPrice: raw(105), numberOfAnalystOpinions: raw(14) },
    defaultKeyStatistics: { sharesOutstanding: raw(52.8) },
    incomeStatementHistory: { incomeStatementHistory: INCOME.map(([period, values]) => statementRow(period as string, values as Record<string, number>)) },
    balanceSheetHistory: { balanceSheetHistory: BALANCE.map(([period, values]) => statementRow(period as string, values as Record<string, number>)) },
    cashflowStatementHistory: { cashflowStatementHistory: CASHFLOW.map(([period, values]) => statementRow(period as string, values as Record<string, number>)) },
    earningsTrend: { trend: [{ period: "0q", epsEstimate: { avg: raw(7.7) }, revenueEstimate: { avg: raw(2200) } }] },
    corporateActions: [{ date: "2024-06-14", type: "stock_split", splitRatio: "2:1", text: "2-for-1 stock split effective 2024-06-14" }],
    priceHistory: [{ date: "2026-09-20", close: raw(118) }, { date: "2026-09-21", close: raw(120) }],
    majorHoldersBreakdown: {},
  };
}

function buildPack(overrides: Record<string, unknown> = {}): FactPack {
  return buildFactPack({ ...payload(), ...overrides }, "ANLS", { retrievalTimestamp });
}

const pack = buildPack();

check("five-year and ten-year windows are both produced with distinct coverage", () => {
  const history = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  assert.equal(history.status, "ready");
  const five = history.windows["5Y"];
  const ten = history.windows["10Y"];
  assert.ok(five.length > 0, "5Y window must carry trends");
  assert.ok(ten.length > 0, "10Y window must carry trends");
  const revenue5 = five.find((entry) => entry.metric === "revenue" && entry.basis === "reported");
  const revenue10 = ten.find((entry) => entry.metric === "revenue" && entry.basis === "reported");
  assert.ok(revenue5 && revenue10);
  assert.equal(revenue5.coverage.expected, 5);
  assert.equal(revenue10.coverage.expected, 10);
  assert.ok(revenue5.coverage.periods < revenue10.coverage.periods, "10Y must reach further back than 5Y");
  assert.equal(revenue5.trendDirection, "improving");
});

check("trends are produced for every required metric family", () => {
  const history = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  const required = ["revenue", "ebit", "eps", "fcf", "roic", "roe", "roa", "grossMargin", "operatingMargin", "netMargin", "workingCapitalDays", "cashConversion", "capexIntensity", "leverage", "dilution", "payoutRatio", "buybackIntensity", "acquisitionIntensity"];
  for (const metric of required) {
    const trend = history.windows["10Y"].find((entry) => entry.metric === metric && entry.basis === "reported");
    assert.ok(trend, `missing ${metric}`);
    assert.equal(trend.status, "ready", `${metric} should be ready`);
  }
});

check("reported, restated and normalized bases stay separate", () => {
  const history = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  const bases = new Set(history.windows["10Y"].map((entry) => entry.basis));
  assert.equal(bases.has("reported"), true);
  assert.equal(bases.has("normalized"), true);
  const reported = history.windows["10Y"].find((entry) => entry.metric === "eps" && entry.basis === "reported");
  const normalized = history.windows["10Y"].find((entry) => entry.metric === "eps" && entry.basis === "normalized");
  assert.ok(reported && normalized);
  const adjusted = normalized.points.filter((point) => (point.note ?? "").includes("corporate-action normalized"));
  const untouched = normalized.points.filter((point) => !(point.note ?? "").includes("corporate-action normalized"));
  assert.ok(adjusted.length > 0, "normalized EPS must record the split adjustment for pre-split periods");
  assert.ok(untouched.length > 0, "post-split periods must stay unadjusted");
  assert.equal(reported.points.some((point) => point.note?.includes("corporate-action normalized")), false, "reported EPS must never be adjusted");
  for (const point of adjusted) {
    const original = reported.points.find((entry) => entry.periodEnd === point.periodEnd);
    assert.ok(original && original.value !== null);
    assert.equal(point.value, Math.round((original.value / 2) * 1e6) / 1e6);
  }
});

check("corporate actions are classified with adjustment metadata", () => {
  const history = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  const split = history.corporateActions.find((action) => action.kind === "split");
  assert.ok(split, "split action must be detected");
  assert.equal(split.effectiveDate, "2024-06-14");
  assert.equal(split.adjustmentApplied, true);
  assert.equal(split.factor, 2);
  assert.deepEqual(split.adjustedMetrics, ["eps"]);
  assert.ok(split.factIds.length > 0);
  assert.ok(split.note.includes("split factor 2"));
});

check("trend breaks carry timing, cause, reversibility and a valuation response", () => {
  const regime = [100, 110, 121, 133, 200, 240, 290, 350, 420, 500];
  const periods = regime.map((_, index) => `${2018 + index}-12-31`);
  const breakPack = buildFactPack({
    assetProfile: { longBusinessSummary: "Regime Industries", sector: "Industrials", industry: "Machinery", country: "US" },
    price: { longName: "Regime", shortName: "RGME", currency: "USD", regularMarketPrice: raw(40), marketCap: raw(2_000) },
    summaryDetail: {},
    financialData: { financialCurrency: "USD" },
    defaultKeyStatistics: { sharesOutstanding: raw(50) },
    incomeStatementHistory: { incomeStatementHistory: periods.map((period, index) => statementRow(period, { totalRevenue: regime[index] as number, netIncome: Math.round((regime[index] as number) * 0.1), operatingIncome: Math.round((regime[index] as number) * 0.15) })) },
    earningsTrend: { trend: [] },
    majorHoldersBreakdown: {},
  }, "RGME", { retrievalTimestamp });
  const history = buildNormalizedHistory({ factPack: breakPack, generatedAt: retrievalTimestamp });
  const revenueBreaks = history.trendBreaks.filter((entry) => entry.metric === "revenue" && entry.basis === "reported");
  assert.ok(revenueBreaks.length > 0, "a sustained level shift must register a revenue trend break");
  const breakOnRevenue = revenueBreaks.sort((left, right) => right.separation - left.separation)[0];
  assert.ok(breakOnRevenue);
  assert.equal(breakOnRevenue.breakPeriod, "FY2021");
  assert.equal(breakOnRevenue.severity, "major");
  assert.ok(breakOnRevenue.separation >= 3.5, `separation ${breakOnRevenue.separation} should be major`);
  assert.equal(breakOnRevenue.method, "mean-shift");
  assert.equal(breakOnRevenue.basis, "reported");
  assert.equal(breakOnRevenue.status, "unattributed", "no corporate action or restatement explains the shift");
  assert.equal(breakOnRevenue.cause, null);
  assert.equal(breakOnRevenue.reversible, null);
  assert.equal(breakOnRevenue.reversibility, "unknown");
  assert.ok(breakOnRevenue.reversibilityBasis.includes("no evidence"));
  assert.ok(breakOnRevenue.valuationResponse, "a valuation response record must always be present");
  assert.equal(breakOnRevenue.valuationResponse?.observed, false, "two price points cannot span the 12-month window");
  const attributed = history.trendBreaks.find((entry) => entry.status === "evidenced");
  if (attributed) {
    assert.ok(attributed.cause && attributed.cause.length > 0);
    assert.notEqual(attributed.reversibility, "unknown");
  }
});

check("restatement chains are built only from recorded restatement evidence", async () => {
  const clean = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  assert.equal(clean.restatementChains.length, 0, "no restatement evidence means no fabricated chain");
  const retrieval = await executeResearchRetrieval(
    [{ id: "TASK-RESTATE", task: "restatement check", question: "restated revenue?", query: "ANLS FY2024 restated revenue", sourceType: "annual_report", priority: 1, asOf: "2024-12-31", dependencies: [], ticker: "ANLS" }],
    {
      ticker: "ANLS",
      asOf: "2024-12-31",
      now: retrievalTimestamp,
      provider: {
        id: "injected",
        fetch: async () => [{
          documentId: "DOC-RESTATE",
          title: "ANLS FY2024 annual report",
          sourceType: "annual_report",
          content: "Total revenue for fiscal 2024 was 1,900 million as originally reported and 1,830 million as restated.",
          evidence: [
            { evidenceId: "NUM-1", field: "totalRevenue", value: 1900, unit: "money", period: "2024-12-31", numeric: true, asOf: "2025-02-01" },
            { evidenceId: "NUM-2", field: "totalRevenue", value: 1830, unit: "money", period: "2024-12-31", numeric: true, asOf: "2025-02-01" },
          ],
        }],
      },
      providerAllowlist: ["injected"],
    },
  );
  const registry = buildCanonicalEvidenceRegistry({ factPack: pack, retrieval, asOf: "2024-12-31" });
  assert.ok(registry.restatements.length > 0, "the registry must record the restatement");
  const withChain = buildNormalizedHistory({ factPack: pack, evidenceRegistry: registry, generatedAt: retrievalTimestamp });
  const chain = withChain.restatementChains.find((entry) => entry.metric === "revenue" && entry.periodEnd === "2024-12-31");
  assert.ok(chain, "a revenue restatement chain must be recorded for FY2024");
  assert.equal(chain.origin, "evidence-registry-restatement");
  assert.equal(chain.direction, "downward");
  assert.ok(chain.evidenceIds.length > 0);
  assert.ok(["reversible", "irreversible", "unknown"].includes(chain.reversibility));
});

check("earnings quality compares reported, cash and normalized earnings", () => {
  const quality = assessEarningsQuality({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(quality.status, "ready");
  const latest = quality.periods[quality.periods.length - 2];
  assert.ok(latest);
  assert.ok(typeof latest.reported.netIncome === "number");
  assert.ok(typeof latest.reported.operatingCashFlow === "number");
  assert.equal(latest.accruals.totalAccruals !== null, true);
  assert.ok(typeof latest.accruals.accrualRatio === "number");
  assert.ok(typeof latest.accruals.cashConversion === "number");
  assert.equal(latest.cashEarnings, latest.reported.operatingCashFlow);
});

check("missing stock-based compensation stays unknown and is never imputed", () => {
  const stripped = buildFactPack({
    ...payload(),
    cashflowStatementHistory: { cashflowStatementHistory: CASHFLOW.map(([period, values]) => statementRow(period as string, { ...(values as Record<string, number>), stockBasedCompensation: undefined } as Record<string, number>)) },
  }, "ANLS", { retrievalTimestamp });
  const withSbc = assessEarningsQuality({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  const withoutSbc = assessEarningsQuality({ factPack: stripped, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  const present = withSbc.periods[withSbc.periods.length - 1];
  const period = withoutSbc.periods[withoutSbc.periods.length - 1];
  assert.ok(present && period);
  assert.equal(present.normalization.unknownKinds.includes("stockBasedCompensation"), false);
  const sbc = period.oneOffs.find((entry) => entry.kind === "stockBasedCompensation");
  assert.ok(sbc);
  assert.equal(sbc.amount, null);
  assert.equal(sbc.basis, "absent");
  assert.equal(period.normalization.unknownKinds.includes("stockBasedCompensation"), true);
  assert.ok(withoutSbc.summary.unknownKinds.includes("stockBasedCompensation"));
  assert.ok(withoutSbc.flags.some((flag) => flag.message.includes("remain unknown")));
  const presentSbc = present.oneOffs.find((entry) => entry.kind === "stockBasedCompensation");
  assert.ok(presentSbc && presentSbc.amount !== null);
  const presentTotal = present.normalization.totalAdjustment ?? 0;
  const absentTotal = period.normalization.totalAdjustment ?? 0;
  assert.equal(presentTotal - absentTotal, presentSbc.amount, "the adjustment total must differ only by the measured amount, never by an imputed one");
});

check("only evidence-backed one-off adjustments reach normalized earnings", () => {
  const withoutSbc = buildFactPack({
    ...payload(),
    cashflowStatementHistory: { cashflowStatementHistory: CASHFLOW.map(([period, values]) => statementRow(period as string, { ...(values as Record<string, number>), stockBasedCompensation: undefined } as Record<string, number>)) },
  }, "ANLS", { retrievalTimestamp });
  const unbacked = assessEarningsQuality({ factPack: withoutSbc, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  const period = unbacked.periods[unbacked.periods.length - 1];
  assert.ok(period);
  assert.equal(period.normalizedEarnings, period.reported.netIncome, "with no measured adjustment normalized earnings equals reported earnings");
  assert.equal(period.normalization.basis, "none");
  const backed = assessEarningsQuality({
    factPack: withoutSbc,
    subjectId: "ANLS",
    generatedAt: retrievalTimestamp,
    oneOffEvidence: [{ kind: "stockBasedCompensation", period: "2027-12-31", amount: 14.8, source: "FY2027 annual report note 12", evidenceIds: ["EV-SBC-1"] }],
  });
  const backedPeriod = backed.periods[backed.periods.length - 1];
  assert.ok(backedPeriod);
  const sbc = backedPeriod.oneOffs.find((entry) => entry.kind === "stockBasedCompensation");
  assert.equal(sbc?.basis, "evidence");
  assert.deepEqual(sbc?.evidenceIds, ["EV-SBC-1"]);
  assert.equal(backedPeriod.normalization.basis, "evidence-backed");
  assert.equal(backedPeriod.normalizedEarnings, Math.round(((backedPeriod.reported.netIncome as number) + 14.8) * 1e6) / 1e6);
  assert.ok(backedPeriod.notes.some((note) => note.includes("never imputed")), "unknown kinds stay disclosed alongside the evidenced adjustment");
});

check("cash conversion flags fire deterministically for the same inputs", () => {
  const weak = buildFactPack({
    ...payload(),
    incomeStatementHistory: { incomeStatementHistory: INCOME.map(([period, values]) => statementRow(period as string, { ...(values as Record<string, number>), netIncome: (values as Record<string, number>).netIncome * 3 } as Record<string, number>)) },
  }, "ANLS", { retrievalTimestamp });  const quality = assessEarningsQuality({ factPack: weak, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.ok(quality.flags.some((flag) => flag.kind === "conversion" || flag.kind === "accrual"), "weaker cash backing must be flagged");
  const again = assessEarningsQuality({ factPack: weak, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(quality.contentHash, again.contentHash, "assessment must be deterministic");
});

check("capital-allocation ledger records cash generation, capex, M&A, buybacks and dividends", () => {
  const ledger = buildCapitalAllocationLedger({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(ledger.status, "ready");
  const period = ledger.periods[ledger.periods.length - 1];
  assert.ok(period);
  const kinds = new Set(period.entries.map((entry) => entry.kind));
  for (const kind of ["freeCashFlow", "totalCapex", "dividends", "cashRetention"]) {
    assert.equal(kinds.has(kind as never), true, `missing ${kind}`);
  }
  const acquisitionPeriod = ledger.periods.find((entry) => entry.periodEnd === "2022-12-31");
  assert.equal(acquisitionPeriod?.entries.some((entry) => entry.kind === "acquisitions"), true);
  const buybackPeriod = ledger.periods.find((entry) => entry.periodEnd === "2025-12-31");
  assert.equal(buybackPeriod?.entries.some((entry) => entry.kind === "buybacks"), true);
  const split = buildCapitalAllocationLedger({
    factPack: pack,
    subjectId: "ANLS",
    generatedAt: retrievalTimestamp,
    maintenanceCapex: { "2027-12-31": 0.6 },
    maintenanceCapexEvidenceIds: { "2027-12-31": ["EV-CAPEX"] },
    currentFairValuePerShare: 140,
  });
  const splitPeriod = split.periods[split.periods.length - 1];
  assert.equal((splitPeriod?.totals.maintenanceCapex ?? null) !== null, true);
  assert.equal((splitPeriod?.totals.growthCapex ?? null) !== null, true);
  assert.equal(split.flags.some((flag) => flag.key === "capexSplit" && flag.period === "FY2027"), false, "an evidenced split removes the warning for that period");
  const unsplit = buildCapitalAllocationLedger({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(unsplit.flags.some((flag) => flag.key === "capexSplit" && flag.period === "FY2027"), true, "without a maintenance share the split is withheld and flagged");
});

check("capital-allocation diagnostics are explicit when value creation cannot be judged", () => {
  const ledger = buildCapitalAllocationLedger({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp, referencePrice: 120 });
  assert.equal(ledger.diagnostics.acquisitionValue.status, "insufficient", "no acquired-earnings evidence means no implied multiple");
  assert.equal(ledger.diagnostics.acquisitionValue.valueCreating, null);
  assert.equal(ledger.diagnostics.buybackValuation.status, "ready", "a per-share reference is available");
  assert.equal(ledger.diagnostics.dividendConsistency.status, "ready");
  assert.equal(typeof ledger.diagnostics.leveragePolicy.direction, "string");
  assert.equal(typeof ledger.diagnostics.roicVsReinvestment.valueCreating, "boolean");
});

check("no management promise keeps credibility UNVERIFIED and never perfect", () => {
  const ledger = buildManagementCredibilityLedger({ subjectId: "ANLS", promises: [], generatedAt: retrievalTimestamp });
  assert.equal(ledger.status, "UNVERIFIED");
  assert.equal(ledger.score, null);
  assert.equal(ledger.confidence, 0);
  assert.equal(ledger.band, "unverified");
  assert.equal(ledger.hitRate, null);
  assert.ok(ledger.diagnostics.includes("MANAGEMENT_PROMISES_UNAVAILABLE"));
});

check("management scoring separates hits, misses, withdrawn promises and pending periods", () => {
  const promises = [
    { id: "MP-REV", metric: "revenue", period: "2024", target: 1850, issuedAt: "2023-11-01T00:00:00.000Z", source: "FY2024 guidance", sourceType: "earnings_call" as const, unit: "money" },
    { id: "MP-EBIT", metric: "ebit", period: "2024", target: 460, issuedAt: "2023-11-01T00:00:00.000Z", source: "FY2024 guidance", sourceType: "earnings_call" as const, unit: "money" },
    { id: "MP-EPS-FUTURE", metric: "eps", period: "2027", target: 8.4, issuedAt: "2026-02-01T00:00:00.000Z", source: "FY2027 guidance", sourceType: "earnings_call" as const, unit: "per-share" },
    { id: "MP-MARGIN-WITHDRAWN", metric: "margin", period: "2025", target: 0.3, issuedAt: "2024-11-01T00:00:00.000Z", source: "FY2025 guidance", sourceType: "earnings_call" as const, unit: "pct", status: "withdrawn" as const },
  ];
  const base = buildManagementCredibilityLedger({ subjectId: "ANLS", promises, generatedAt: retrievalTimestamp });
  const ledger = buildManagementCredibilityLedger({
    subjectId: "ANLS",
    promises,
    actuals: [
      { promiseId: "MP-REV", period: "2024", actual: 1900, source: "factpack" },
      { promiseId: "MP-EBIT", period: "2024", actual: 470, source: "factpack" },
    ],
    generatedAt: retrievalTimestamp,
  });
  assert.equal(ledger.counts.promises, 4);
  assert.equal(ledger.counts.resolved, 2);
  assert.equal(ledger.counts.met, 2);
  assert.equal(ledger.counts.withdrawn, 1);
  assert.equal(ledger.counts.unverified, 1);
  assert.equal(ledger.status, "VERIFIED");
  assert.ok(ledger.score !== null);
  assert.ok((ledger.score as number) < 1, "a perfect credibility score is never issued");
  assert.equal(ledger.streak.current, 2);
  assert.equal(ledger.diagnostics.includes("MANAGEMENT_SAMPLE_THIN"), true);
  assert.equal(base.counts.resolved, 0);
  assert.equal(base.status, "UNVERIFIED");
  const misses = buildManagementCredibilityLedger({
    subjectId: "ANLS",
    promises,
    actuals: [
      { promiseId: "MP-REV", period: "2024", actual: 1500, source: "factpack" },
      { promiseId: "MP-EBIT", period: "2024", actual: 300, source: "factpack" },
    ],
    generatedAt: retrievalTimestamp,
  });
  assert.equal(misses.counts.missed, 2);
  assert.equal(misses.bias, "over-optimistic", "guiding above delivery is an over-optimistic bias");
  assert.ok((misses.score as number) < (ledger.score as number));
});

check("no guidance leaves the reconciliation explicitly unverified with separate tracks", () => {
  const reconciliation = buildGuidanceReconciliation({ subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(reconciliation.status, "unverified");
  assert.equal(reconciliation.credibility.hitRate, null);
  assert.equal(reconciliation.scores.length, 0);
  for (const track of ["historical", "management", "consensus", "apex"] as const) {
    assert.equal(reconciliation.tracks[track].status, "unavailable");
    assert.equal(reconciliation.tracks[track].points.length, 0);
  }
  assert.ok(reconciliation.reason.includes("UNVERIFIED"));
});

check("guidance revisions, withdrawals and supersessions stay in their own track", () => {
  const reconciliation = buildGuidanceReconciliation({
    subjectId: "ANLS",
    generatedAt: retrievalTimestamp,
    points: [
      { track: "historical", metric: "revenue", period: "FY2024", value: 1900, unit: "money", issuedAt: "2024-12-31", source: "factpack" },
      { track: "management", metric: "revenue", period: "FY2025", value: 2100, unit: "money", issuedAt: "2024-11-01", source: "FY2025 guidance" },
      { track: "management", metric: "revenue", period: "FY2025", value: 2250, unit: "money", issuedAt: "2025-02-01", source: "FY2025 guidance revision", supersedesId: "GP-REV-1" },
      { track: "management", metric: "revenue", period: "FY2025", value: 2250, unit: "money", issuedAt: "2025-08-01", source: "FY2025 guidance withdrawal", status: "withdrawn" },
      { track: "consensus", metric: "revenue", period: "FY2025", low: 2150, high: 2300, unit: "money", issuedAt: "2025-06-01", source: "Street consensus" },
      { track: "apex", metric: "revenue", period: "FY2025", value: 2050, unit: "money", issuedAt: "2025-09-01", source: "APEX forecast" },
    ],
    actuals: [{ metric: "revenue", period: "FY2024", actual: 1900, source: "factpack" }],
  });
  assert.equal(reconciliation.status, "ready");
  assert.equal(reconciliation.tracks.historical.points.length, 1);
  assert.equal(reconciliation.tracks.management.points.length, 3);
  assert.equal(reconciliation.tracks.management.withdrawnCount, 1);
  assert.equal(reconciliation.tracks.consensus.points.length, 1);
  assert.equal(reconciliation.tracks.apex.points.length, 1);
  const kinds = reconciliation.revisionHistory.filter((link) => link.track === "management").map((link) => link.kind);
  assert.deepEqual(kinds, ["initial", "supersession", "withdrawal"]);
  for (const track of ["historical", "management", "consensus", "apex"] as const) {
    assert.ok(reconciliation.tracks[track].points.every((point) => point.track === track), `${track} must not absorb another track's points`);
  }
  assert.equal(reconciliation.scores.filter((score) => score.track === "historical" && score.hit === "met").length, 1);
});

check("confidence decomposition keeps components separate and aggregates non-naively", () => {
  const history = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  const quality = assessEarningsQuality({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  const allocation = buildCapitalAllocationLedger({ factPack: pack, subjectId: "ANLS", generatedAt: retrievalTimestamp, referencePrice: 120 });
  const management = buildManagementCredibilityLedger({ subjectId: "ANLS", generatedAt: retrievalTimestamp });
  const guidance = buildGuidanceReconciliation({ subjectId: "ANLS", generatedAt: retrievalTimestamp });
  const decomposition = decomposeResearchConfidence({
    subjectId: "ANLS",
    generatedAt: retrievalTimestamp,
    factPackVerified: true,
    currencyBlocked: false,
    retrievalStatus: "ready",
    lineageTraceable: true,
    history,
    earningsQuality: quality,
    capitalAllocation: allocation,
    managementCredibility: management,
    guidanceReconciliation: guidance,
  });
  const keys = Object.keys(decomposition.components);
  assert.deepEqual(keys.sort(), ["assumption", "data", "forecast", "model", "valuation"]);
  assert.equal(decomposition.overall.key, "overall");
  assert.ok(decomposition.components.data.score !== decomposition.components.valuation.score);
  assert.ok(decomposition.aggregation.method.includes("geometric"));
  assert.ok(decomposition.aggregation.formula.length > 0);
  assert.ok(decomposition.aggregation.rationale.length > 0);
  assert.ok(decomposition.overall.reasoning.includes("weighted geometric mean"));
  assert.ok(decomposition.overall.score > 0 && decomposition.overall.score <= 0.95);
  for (const component of Object.values(decomposition.components)) {
    assert.ok(component.drivers.length > 0, `${component.key} must explain itself`);
    assert.ok(component.reasoning.length > 0);
  }
  const none = decomposeResearchConfidence({ subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(none.overall.score, 0, "an unobservable run scores zero, not a neutral midpoint");
  assert.equal(none.overall.status, "unavailable");
  assert.ok(none.diagnostics.includes("CONFIDENCE_ALL_COMPONENTS_UNAVAILABLE"));
  const repeated = decomposeResearchConfidence({ subjectId: "ANLS", generatedAt: retrievalTimestamp, factPackVerified: true, history });
  assert.equal(repeated.contentHash, decomposeResearchConfidence({ subjectId: "ANLS", generatedAt: retrievalTimestamp, factPackVerified: true, history }).contentHash, "decomposition must be deterministic");
});

check("a weak component cannot be masked by a strong one", () => {
  const history = buildNormalizedHistory({ factPack: pack, generatedAt: retrievalTimestamp });
  const strong = decomposeResearchConfidence({ subjectId: "ANLS", generatedAt: retrievalTimestamp, factPackVerified: true, currencyBlocked: false, retrievalStatus: "ready", lineageTraceable: true, history });
  const weakened = decomposeResearchConfidence({ subjectId: "ANLS", generatedAt: retrievalTimestamp, factPackVerified: false, currencyBlocked: true, retrievalStatus: "unavailable", lineageTraceable: false, history });
  assert.ok(weakened.components.data.score < strong.components.data.score);
  assert.ok(weakened.overall.score < strong.overall.score, "the geometric mean must refuse to let other components mask a weak data layer");
});

check("history stays unavailable rather than fabricated on an empty fact pack", () => {
  const empty = buildFactPack({}, "ANLS", { retrievalTimestamp });
  const history = buildNormalizedHistory({ factPack: empty, generatedAt: retrievalTimestamp });
  assert.equal(history.status, "unavailable");
  assert.equal(history.trendBreaks.length, 0);
  const quality = assessEarningsQuality({ factPack: empty, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(quality.status, "unavailable");
  const allocation = buildCapitalAllocationLedger({ factPack: empty, subjectId: "ANLS", generatedAt: retrievalTimestamp });
  assert.equal(allocation.status, "unavailable");
});

console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
