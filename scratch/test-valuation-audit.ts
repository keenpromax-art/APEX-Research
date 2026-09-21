/**
 * Valuation audit + economic plausibility + baseline reconciliation +
 * data-confidence tests, including QA integration ("never newly block").
 * Run: npx tsx scratch/test-valuation-audit.ts
 */
import { auditValuationBridge, auditTerminalConcentration, auditWaccInputs, auditDisagreement, auditValuation } from "../src/lib/valuation-audit";
import { buildBaselineReconciliation } from "../src/lib/guidance-reconciliation";
import { checkEconomicPlausibility } from "../src/lib/economic-plausibility";
import { assessDataConfidence } from "../src/lib/data-confidence";
import { validateReportIntegrity } from "../src/lib/report-qa";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import { buildMasterReportFacts } from "../src/lib/report-facts";
import { computeRatios, computeDuPont } from "../src/lib/calculations";
import { emptyAIAnalysis } from "../src/lib/openrouter";

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra?: string) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); }
};

// ── Shared healthy fixture (hand-built coherent DCF) ──
const mkFin = (y: string, rev: number, oi: number, ni: number, eq: number, debt: number, cash: number, ocf: number, capex: number, eps: number, pre: number, tax: number, gp: number, assets: number, ppe: number, dep: number, ebitda: number): any => ({
  year: y, revenue: rev, operatingIncome: oi, netIncome: ni, totalEquity: eq, totalDebt: debt, cash,
  operatingCashFlow: ocf, capitalExpenditures: capex, freeCashFlow: ocf - capex, sharesOutstanding: 10,
  eps, dilutedEps: eps, pretaxIncome: pre, incomeTaxExpense: tax, grossProfit: gp, totalAssets: assets,
  totalLiabilities: assets - eq, netFixedAssets: ppe, depreciation: dep, ebitda,
  currentAssets: 40, currentLiabilities: 20, netReceivables: 12, inventory: 10, netWorkingCapital: 20,
  shortTermDebt: 5, longTermDebt: 25, accountsPayable: 8, interestExpense: 2, dividendsPaid: 3,
  fiscalYearEnd: y, estimatesUsed: [],
});
const fins = [
  mkFin("FY2023", 100, 15, 10, 100, 30, 10, 12, 5, 1.0, 13, 3, 40, 200, 60, 4, 20),
  mkFin("FY2024", 120, 19, 13, 110, 30, 12, 15, 6, 1.3, 17, 4, 48, 220, 65, 4.5, 24),
  mkFin("FY2025", 144, 24, 16, 125, 30, 15, 18, 7, 1.6, 21, 5, 58, 250, 70, 5, 29),
];
const dcf: any = {
  status: "valid", sumPvFcff: 50, terminalYearFcff: 12, terminalValue: 200, pvTerminalValue: 150,
  enterpriseValue: 200, totalDebt: 30, cashAndEquiv: 15, netDebt: 15, lessDebt: 30, plusCash: 15,
  equityValue: 185, sharesOutstanding: 10, intrinsicValue: 18.5, fairValuePerShare: 18.5,
  currentMarketPrice: 16.8, upsideDownside: 0.101, verdict: "HOLD",
  assumptions: {
    riskFreeRate: 0.06, equityRiskPremium: 0.06, beta: 1.0, costOfEquity: 0.12,
    costOfDebtPreTax: 0.07, marginalTaxRate: 0.25, costOfDebtPostTax: 0.0525,
    debtWeight: 0.2, equityWeight: 0.8, wacc: 0.1, terminalGrowthRate: 0.04,
    revenueGrowthRates: [0.15, 0.13, 0.11, 0.1, 0.09], ebitMargins: [0.16, 0.16, 0.17, 0.17, 0.17],
    inputProvenance: { beta: "t", weights: "t", country: "t", spread: "t", clamp: "t" },
  },
  assumptionBasis: { revenueGrowth: "x".repeat(30), ebitMargin: "x".repeat(30), capex: "x".repeat(30), workingCapital: "x".repeat(30), netDebt: "x".repeat(30), wacc: "x".repeat(30), terminal: "x".repeat(30) },
  avgCapexPct: 0.05, avgDeptPct: 0.035, avgNwcChangePct: 0.02,
};
const stock: any = {
  currentPrice: 16.8, sharesOutstanding: 10, marketCap: 168, beta: 1.0, pe: 10.5,
  targetMeanPrice: 19, targetHighPrice: 22, targetLowPrice: 16, numberOfAnalystOpinions: 5,
};
const peers: any[] = [
  { ticker: "P1", pe: 11, evToEbitda: 9 },
  { ticker: "P2", pe: 12, evToEbitda: 10 },
];

console.log("--- 1. Bridge audit ---");
const b = auditValuationBridge(dcf);
check("bridge PASS on coherent DCF", b.status === "PASS", b.detail.slice(0, 120));
check("per-share anatomy sums", b.recomputedPerShare !== null && Math.abs(b.recomputedPerShare - 18.5) <= 1.0);
check("anatomy strings explicit+terminal-debt legs",
  (b.explicitFcffPerShare ?? 0) > 0 && (b.terminalPerShare ?? 0) > 0 && b.tvPctOfEv !== null && Math.abs((b.tvPctOfEv as number) - 0.75) < 0.01);
const broken = auditValuationBridge({ ...dcf, equityValue: 100 });
check("bridge FAILs on broken equity", broken.status === "FAIL");
const skipped = auditValuationBridge({ ...dcf, equityValue: 0, intrinsicValue: 0, fairValuePerShare: null, status: "calculation_error" });
check("bridge SKIPs without model equity", skipped.status === "SKIP");
const sotpDcf: any = {
  ...dcf,
  enterpriseValue: 500, equityValue: 400, netDebt: 60, intrinsicValue: 40, fairValuePerShare: 40,
  sotpBreakdown: { crossCheck: { enterpriseValue: 200, sumPvFcff: 50, pvTerminalValue: 150, equityValue: 185, fairValuePerShare: 18.5 } },
};
check("SOTP audits cross-check leg", auditValuationBridge(sotpDcf).status === "PASS");

console.log("--- 2. Terminal + WACC ---");
check("TV 75% boundary WARNs", auditTerminalConcentration(dcf).status === "WARN");
check("TV 50% passes", auditTerminalConcentration({ ...dcf, pvTerminalValue: 90 }).status === "PASS");
const w = auditWaccInputs(dcf);
check("sane WACC passes", w.status === "PASS" && w.checks.length >= 7);
check("absurd beta warns", auditWaccInputs({ assumptions: { ...dcf.assumptions, beta: 5 } } as any).status === "WARN");
check("incoherent CoD warns", auditWaccInputs({ assumptions: { ...dcf.assumptions, costOfDebtPreTax: 0.01 } } as any).status === "WARN");

console.log("--- 3. Disagreement ---");
const dis = auditDisagreement({ dcfFv: 18.5, eps: 1.6, ebitda: 29, netDebt: 15, shares: 10, peers, streetMean: 19, streetHigh: 22, streetLow: 16, opinions: 5 });
check("corroborated target AGREEs", dis.verdict === "AGREE" && dis.status === "PASS", dis.detail.slice(0, 100));
const outlier = auditDisagreement({ dcfFv: 60, eps: 1.6, ebitda: 29, netDebt: 15, shares: 10, peers, streetMean: 19, streetHigh: 22, streetLow: 16, opinions: 5 });
check("runaway DCF flagged outlier", outlier.verdict === "DCF_OUTLIER" && outlier.status === "WARN");
const thin = auditDisagreement({ dcfFv: 18.5, eps: 0, ebitda: 0, netDebt: 15, shares: 10, peers: [], streetMean: 0, streetHigh: 0, streetLow: 0, opinions: 0 });
check("thin legs UNVERIFIABLE without FAIL", thin.verdict === "UNVERIFIABLE" && thin.status === "PASS");

console.log("--- 4. Baseline reconciliation ---");
const base = buildBaselineReconciliation({
  annualFinancials: fins as any, modelGrowth: [0.15, 0.13, 0.11, 0.1, 0.09],
  modelMargins: [0.16, 0.16, 0.17, 0.17, 0.17], modelCapexPct: 0.05, modelTaxRate: 0.25,
  modelPayout: null, modelNetDebt: 15, modelFairValue: 18.5, stockData: stock as any,
});
check("sane model reconciles", base.rows.every((r) => r.status !== "WARN"), base.rows.map((r) => `${r.metric}=${r.status}`).join(","));
check("guidance slot present-but-empty (honest)", base.rows.every((r) => r.guidance === null));
const hot = buildBaselineReconciliation({
  annualFinancials: fins as any, modelGrowth: [0.9, 0.8, 0.7, 0.6, 0.5],
  modelMargins: [0.5, 0.5, 0.5, 0.5, 0.5], modelCapexPct: 0.005, modelTaxRate: 0.02,
  modelPayout: null, modelNetDebt: 15, modelFairValue: 99, stockData: stock as any,
});
check("fantasy model WARNs (growth/margin/capex/street)", hot.rows.filter((r) => r.status === "WARN").length >= 3);

console.log("--- 5. Economic plausibility ---");
const plaus = checkEconomicPlausibility({ annualFinancials: fins as any, dcf: dcf as any, stockData: stock as any });
check("sane model plausible", plaus.warnCount === 0, plaus.findings.map((f) => `${f.id}=${f.status}`).join(","));
const starved = checkEconomicPlausibility({
  annualFinancials: fins as any,
  dcf: { ...dcf, avgCapexPct: 0.002 } as any, stockData: stock as any,
});
check("capex collapse WARNs (ECON-01)", starved.findings.find((f) => f.id === "ECON-01")?.status === "WARN");
const termBad = checkEconomicPlausibility({
  annualFinancials: fins as any,
  dcf: { ...dcf, terminalYearFcff: 500 } as any, stockData: stock as any,
});
check("absurd terminal WARNs (ECON-04)", termBad.findings.find((f) => f.id === "ECON-04")?.status === "WARN");

console.log("--- 6. Data confidence ---");
const conf = assessDataConfidence({ stockData: stock as any, annualFinancials: fins as any, dcf: dcf as any, aiOverridesUsed: false });
check("clean inputs grade A/B", conf.grade === "A" || conf.grade === "B", conf.summary);
const confAi = assessDataConfidence({ stockData: stock as any, annualFinancials: fins as any, dcf: dcf as any, aiOverridesUsed: true });
check("AI path labeled AI_ASSUMPTION", confAi.fields.some((f) => f.tier === "AI_ASSUMPTION"));
const confMissing = assessDataConfidence({
  stockData: { currentPrice: 0, sharesOutstanding: 0, marketCap: 0 } as any,
  annualFinancials: fins as any, dcf: dcf as any, aiOverridesUsed: false,
});
check("missing price degrades grade", confMissing.grade === "C" || confMissing.grade === "D", confMissing.summary);
check("zero price tiers MISSING (never legitimate)", confMissing.fields.find((x) => x.field === "currentPrice")?.tier === "MISSING");
check("quote-missing shares resolve via statements", confMissing.fields.find((x) => x.field === "sharesOutstanding")?.tier === "VERIFIED_SECONDARY");
const confDerivedCap = assessDataConfidence({
  stockData: { ...stock, marketCap: 0 } as any,
  annualFinancials: fins as any, dcf: dcf as any, aiOverridesUsed: false,
});
check("omitted marketCap derives from price x shares", confDerivedCap.fields.find((x) => x.field === "marketCap")?.tier === "DERIVED");

console.log("--- 7. QA integration: never newly block ---");
const profile: any = {
  ticker: "TEST.NS", name: "Test Industries Limited", exchange: "NSE", exchangeTimezoneName: "IST",
  sector: "Industrials", industry: "Industrial Machinery", country: "India", currency: "USD",
  description: "Industrial machinery manufacturer with order inflow and plant capacity.", website: "", employees: 1000, officers: [],
};
const cmp = stock.currentPrice;
const ratiosByYear = fins.map((f: any) => computeRatios(f, cmp));
const dupontByYear = fins.map((f: any) => computeDuPont(f));
const ledger: any = createAssumptionsLedger({ profile, stockData: stock as any, annualFinancials: fins as any, dcf: dcf as any });
const masterFacts: any = buildMasterReportFacts({
  stockData: stock as any, profile, annualFinancials: fins as any,
  ratiosByYear: ratiosByYear as any, dupontByYear: dupontByYear as any, dcf: dcf as any, peers: [], ledger,
});
masterFacts.valuation.fairValue.value = ledger.targetPrice;
masterFacts.recommendation.rating = ledger.rating;
const report: any = {
  generatedAt: new Date().toISOString(), profile, stockData: stock, annualFinancials: fins,
  quarterlyFinancials: [], ratiosByYear, dupontByYear, dcf,
  canonicalForecast: (dcf as any).canonicalForecast ?? null,
  shareholding: { categories: [] }, peers: [], aiAnalysis: emptyAIAnalysis(), news: [],
  recommendation: ledger.rating, targetPrice: ledger.targetPrice, cmp: ledger.currentPrice,
  analystName: "test", assumptionsLedger: ledger, masterReportFacts: masterFacts,
  sanitizerReport: { rewrittenTerms: [] },
};
const qa = validateReportIntegrity(report);
const mine = qa.checks.filter((c: any) => c.id.startsWith("VAL-AUDIT") || c.id.startsWith("ECON"));
console.log(`  new-block checks: ${mine.map((c: any) => `${c.id}=${c.status}`).join(", ")}`);
check("new block emits zero FAIL", mine.every((c: any) => c.status !== "FAIL"));
check("bridge decomposition present", (mine.find((c: any) => c.id === "VAL-AUDIT-01")?.details || "").includes("anatomy"));
check("disagreement table present", (mine.find((c: any) => c.id === "VAL-AUDIT-04")?.details || "").includes("Legs:"));

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL VALUATION-AUDIT CHECKS PASSED");
