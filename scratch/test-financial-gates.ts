/**
 * APEX RESEARCH — Financial-Gate Regression (7-item remediation suite)
 * ---------------------------------------------------------------------
 * 1. FINCONS-01..05 hard financial-consistency gate (same-FY conflicts BLOCK)
 * 2. Equity-value/share-price reconciliation (XREF-05 hardened + DCF scale check)
 * 3. Company-specific semantic validation (SEM-COMP-01, NARRATIVE-01 FAIL)
 * 4. SOTP engine for conglomerates (Reliance PRIMARY valuation)
 * 5. Cash-flow narrative reconciliation (FCF-NARR-01)
 * 6. Primary-source reconciliation disclosure (SRC-01)
 * 7. Severity escalation + export lock wiring (asserted via gate outcomes)
 *
 * Run: npx tsx scratch/test-financial-gates.ts (exit 1 on any failure)
 */
import { checkCrossPageFinancials } from "../src/lib/financial-consistency";
import { computeSotpValuation } from "../src/lib/valuation/sotp";
import { getFilingSegments } from "../src/lib/filing-segments";
import {
  getCompanySemanticProfile,
  PLATFORM_SILICON_FORBIDDEN,
} from "../src/lib/company-semantics";
import { boundaryHit } from "../src/lib/research-model/model-validator";
import { computeDCF } from "../src/lib/calculations";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import { selectAndComputeValuation } from "../src/lib/valuation/selector";
import { validateReportIntegrity } from "../src/lib/report-qa";
import { reconcileAll } from "../src/lib/source-reconciliation";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const finConsBase = () => ({
  ticker: "RELIANCE.NS",
  latestYear: "FY2024",
  isFinancial: false,
  statement: {
    revenue: 9010640000000,
    operatingIncome: 1116660000000,
    pretaxIncome: 957210000000,
    incomeTaxExpense: 261000000000,
    netIncome: 696210000000,
    totalEquity: 9257880000000,
    sharesOutstanding: 6765000000,
    dilutedEps: 102.91,
    eps: 102.91,
  },
  canonical: { revenue: 9010640000000, netIncome: 696210000000, sharesDiluted: 6765000000 },
  market: { price: 1285, shares: 6765000000, marketCap: 8693025000000, trailingEps: 102.91 },
  model: { equityValue: 13680000000000, shares: 6765000000, fairValue: 2022.17 },
});

// ── 1. FINCONS gate ──────────────────────────────────────────
console.log("\n1. FINANCIAL-CONSISTENCY GATE");
{
  const ok = checkCrossPageFinancials(finConsBase());
  check("consistent bundle passes all FINCONS", ok.every((f) => f.pass), ok.filter((f) => !f.pass).map((f) => f.code).join(","));
}
{
  const conflict = { ...finConsBase(), statement: { ...finConsBase().statement, dilutedEps: 51.45, eps: 51.45 } };
  const f02 = checkCrossPageFinancials(conflict).find((f) => f.code === "FINCONS-02")!;
  check("FY EPS conflict (51.45 vs 102.91) FAILS FINCONS-02", !f02.pass && f02.severity === "blocker", f02.detail.slice(0, 120));
}
{
  const split = { ...finConsBase(), model: { ...finConsBase().model, shares: 67650000000 } };
  const f03 = checkCrossPageFinancials(split).find((f) => f.code === "FINCONS-03")!;
  check("10x share-base split FAILS FINCONS-03", !f03.pass && f03.severity === "blocker");
}
{
  const broken = { ...finConsBase(), model: { ...finConsBase().model, fairValue: 20221.7 } };
  const f04 = checkCrossPageFinancials(broken).find((f) => f.code === "FINCONS-04")!;
  check("10x fair-value break FAILS FINCONS-04", !f04.pass && f04.severity === "blocker");
}
{
  // Unit error everywhere at once (crores fed as absolute): internally
  // consistent across sources, so ONLY the absolute-scale check can see it.
  const scaled = {
    ...finConsBase(),
    statement: { ...finConsBase().statement, sharesOutstanding: 67650000000 },
    canonical: { ...finConsBase().canonical, sharesDiluted: 67650000000 },
    market: { ...finConsBase().market, shares: 67650000000 },
    model: { ...finConsBase().model, shares: 67650000000, equityValue: 136800000000000, fairValue: 2022.17 },
  };
  const all = checkCrossPageFinancials(scaled);
  const f03 = all.find((f) => f.code === "FINCONS-03")!;
  const f05 = all.find((f) => f.code === "FINCONS-05")!;
  check("uniform 10x shares pass FINCONS-03 (consistent — and that is the trap)", f03.pass);
  check("10x scale break FAILS FINCONS-05", !f05.pass && f05.severity === "blocker", f05.detail.slice(0, 120));
}
{
  const missing = { ...finConsBase(), statement: { ...finConsBase().statement, pretaxIncome: null, incomeTaxExpense: null } };
  const f01 = checkCrossPageFinancials(missing).find((f) => f.code === "FINCONS-01")!;
  check("missing pretax/tax FAILS FINCONS-01 (no modeled fallbacks)", !f01.pass && f01.severity === "blocker");
}

// ── 2. Equity/share reconciliation ───────────────────────────
console.log("\n2. EQUITY-VALUE / SHARE-PRICE RECONCILIATION");
{
  // Live 10x path (financial-provenance line 209): statement shares missing,
  // so the unchecked 10x quote count is accepted — the DCF scale self-check
  // must refuse to price.
  const stockData: any = {
    ticker: "RELIANCE.NS", currentPrice: 1285, sharesOutstanding: 67650000000,
    marketCap: 8693025000000, beta: 0.95,
  };
  const fins: any[] = [
    { year: "FY2023", revenue: 8778350000000, operatingIncome: 1050000000000, netIncome: 667020000000, totalEquity: 8500000000000, totalDebt: 3140000000000, cash: 670000000000, totalAssets: 16500000000000, totalLiabilities: 8000000000000, operatingCashFlow: 1150320000000, capitalExpenditures: 1409880000000, freeCashFlow: -259560000000, sharesOutstanding: 0 },
    { year: "FY2024", revenue: 9010640000000, operatingIncome: 1116660000000, netIncome: 696210000000, totalEquity: 9257880000000, totalDebt: 3461420000000, cash: 972250000000, totalAssets: 17559860000000, totalLiabilities: 8301980000000, operatingCashFlow: 1587880000000, capitalExpenditures: 1528830000000, freeCashFlow: 59050000000, sharesOutstanding: 0 },
  ];
  const dcf = computeDCF(fins, stockData);
  check(
    "10x share-count unit error refuses to price (invalid_inputs)",
    dcf.status === "invalid_inputs" && (dcf.diagnostics || []).some((d) => /scale error/i.test(d)),
    `status=${dcf.status}`
  );
}

// ── 3. Company-specific semantics ────────────────────────────
console.log("\n3. COMPANY-SPECIFIC SEMANTIC VALIDATION");
{
  const rel = getCompanySemanticProfile({ ticker: "RELIANCE.NS", name: "Reliance Industries Limited" });
  check("RELIANCE.NS matches company profile", rel?.companyKey === "RELIANCE");
  check("unknown ticker matches nothing", getCompanySemanticProfile({ ticker: "TCS.NS", name: "Tata Consultancy" }) === null);
  const dirty =
    "Growth is driven by advertiser bidding and search index monetization on custom silicon, a two-sided network with a hyperscale data-centre moat.".toLowerCase();
  const hits = PLATFORM_SILICON_FORBIDDEN.filter((c) => boundaryHit(dirty, c));
  check("platform contamination detected (5 terms)", hits.length >= 5, hits.join(", "));
  const clean = "Refining complexity, integrated petrochemical conversion, and subscriber-led digital growth.".toLowerCase();
  check("clean conglomerate text passes", PLATFORM_SILICON_FORBIDDEN.filter((c) => boundaryHit(clean, c)).length === 0);
}

// ── 4. SOTP engine ───────────────────────────────────────────
console.log("\n4. SOTP ENGINE (CONGLOMERATES)");
{
  const filing = getFilingSegments("RELIANCE.NS")!;
  check("filing registry holds Reliance FY25 segments", !!filing && filing.segments.length === 4, filing?.period);
  check("unknown ticker has no filing segments", getFilingSegments("TCS.NS") === null);
  const sotp = computeSotpValuation({
    ticker: "RELIANCE.NS",
    currency: "INR",
    filing,
    netDebt: 2489170000000,
    sharesOutstanding: 6765000000,
    currentPrice: 1285,
  });
  check("SOTP computes valid equity + fair value", sotp.status === "valid" && (sotp.fairValuePerShare ?? 0) > 0, `fv=${sotp.fairValuePerShare}`);
  const segSum = sotp.segments.reduce((s, x) => s + x.enterpriseValue, 0);
  check(
    "SOTP bridge closes (GAV − discount − netDebt = equity)",
    Math.abs(segSum + sotp.otherInvestments - sotp.grossAssetValue) < 1000 &&
      Math.abs(sotp.grossAssetValue - sotp.grossAssetValue * sotp.holdingDiscount - sotp.netDebt - sotp.equityValue) < 1000
  );
  check(
    "SOTP per-share closes (equity/shares = FV)",
    Math.abs((sotp.equityValue / sotp.sharesOutstanding) - (sotp.fairValuePerShare ?? 0)) < 1.0
  );
  check("segment coverage ≥80% of consolidated EBITDA", sotp.coveragePct >= 0.8, `${(sotp.coveragePct * 100).toFixed(1)}%`);
  const noMult = computeSotpValuation({
    ticker: "RELIANCE.NS", currency: "INR", filing, multiples: [],
    netDebt: 0, sharesOutstanding: 6765000000, currentPrice: 1285,
  });
  check("missing multiples refuses SOTP (insufficient_data)", noMult.status === "insufficient_data");
}
{
  const profile: any = {
    ticker: "RELIANCE.NS", name: "Reliance Industries Limited", sector: "Energy",
    industry: "Oil & Gas Refining & Marketing", currency: "INR", exchange: "NSE",
    country: "India", description: "Indian conglomerate spanning energy, petrochemicals, telecommunications, and retail.",
  };
  const stockData: any = {
    ticker: "RELIANCE.NS", currentPrice: 1285, sharesOutstanding: 6765000000,
    marketCap: 8693025000000, beta: 0.95,
  };
  const fins: any[] = [
    { year: "FY2023", revenue: 8778350000000, grossProfit: 2150000000000, ebitda: 1530000000000, operatingIncome: 1050000000000, pretaxIncome: 920000000000, incomeTaxExpense: 252980000000, netIncome: 667020000000, eps: 98.6, totalDebt: 3140000000000, cash: 670000000000, totalAssets: 16500000000000, totalLiabilities: 8000000000000, totalEquity: 8500000000000, operatingCashFlow: 1150320000000, capitalExpenditures: 1409880000000, freeCashFlow: -259560000000, sharesOutstanding: 6765000000 },
    { year: "FY2024", revenue: 9010640000000, grossProfit: 2264650000000, ebitda: 1769440000000, operatingIncome: 1116660000000, pretaxIncome: 957210000000, incomeTaxExpense: 261000000000, netIncome: 696210000000, eps: 102.91, totalDebt: 3461420000000, cash: 972250000000, totalAssets: 17559860000000, totalLiabilities: 8301980000000, totalEquity: 9257880000000, operatingCashFlow: 1587880000000, capitalExpenditures: 1528830000000, freeCashFlow: 59050000000, sharesOutstanding: 6765000000 },
  ];
  const sel = selectAndComputeValuation({ profile, stockData, annualFinancials: fins });
  check("Reliance routes to SOTP_CONGLOMERATE (not single-business DCF)", sel.selectedModel === "SOTP_CONGLOMERATE", sel.selectedModel);
  check("SOTP carries cross-check + segment detail", !!sel.dcf.sotpBreakdown?.crossCheck && sel.dcf.sotpBreakdown.segments.length >= 4);
  check("SOTP fair value positive with verdict", (sel.fairValue ?? 0) > 0 && ["BUY", "HOLD", "SELL"].includes(sel.rating), `${sel.fairValue} ${sel.rating}`);
}

// ── 5/6/7. QA integration ────────────────────────────────────
console.log("\n5-7. QA INTEGRATION (FCF-NARR, SRC, NARRATIVE, SEM-COMP, gate)");
{
  const profile: any = {
    ticker: "RELIANCE.NS", name: "Reliance Industries Limited", sector: "Energy",
    industry: "Oil & Gas Refining & Marketing", currency: "INR", exchange: "NSE",
    country: "India", description: "Indian conglomerate spanning energy, petrochemicals, telecommunications, and retail.",
  };
  const stockData: any = {
    ticker: "RELIANCE.NS", currentPrice: 1285, sharesOutstanding: 6765000000,
    marketCap: 8693025000000, beta: 0.95,
  };
  const fins: any[] = [
    { year: "FY2023", revenue: 8778350000000, grossProfit: 2150000000000, ebitda: 1530000000000, operatingIncome: 1050000000000, pretaxIncome: 920000000000, incomeTaxExpense: 252980000000, netIncome: 667020000000, eps: 98.6, dilutedEps: 98.6, totalDebt: 3140000000000, cash: 670000000000, totalAssets: 16500000000000, totalLiabilities: 8000000000000, totalEquity: 8500000000000, operatingCashFlow: 1150320000000, capitalExpenditures: 1409880000000, freeCashFlow: -259560000000, sharesOutstanding: 6765000000 },
    { year: "FY2024", revenue: 9010640000000, grossProfit: 2264650000000, ebitda: 1769440000000, operatingIncome: 1116660000000, pretaxIncome: 957210000000, incomeTaxExpense: 261000000000, netIncome: 696210000000, eps: 102.91, dilutedEps: 102.91, totalDebt: 3461420000000, cash: 972250000000, totalAssets: 17559860000000, totalLiabilities: 8301980000000, totalEquity: 9257880000000, operatingCashFlow: 1587880000000, capitalExpenditures: 1528830000000, freeCashFlow: 59050000000, sharesOutstanding: 6765000000 },
  ];
  const sel = selectAndComputeValuation({ profile, stockData, annualFinancials: fins });
  const ledger: any = createAssumptionsLedger({ profile, stockData, annualFinancials: fins, dcf: sel.dcf });
  const cleanAi: any = {
    investmentThesis: "Integrated refining complexity and downstream retail reach compound through-cycle returns.",
    companyOverview: "Oil-to-chemicals, digital services, retail and exploration segments.",
    cashFlowCommentary: "Operating cash conversion funds maintenance needs alongside growth capex.",
  };
  const buildReport = (aiAnalysis: any, reconciliation?: any): any => ({
    profile, stockData, annualFinancials: fins, quarterlyFinancials: [], ratiosByYear: [],
    dupontByYear: [], dcf: sel.dcf, shareholding: null, peers: [], aiAnalysis, news: [],
    eventPriceMovements: [], recommendation: ledger.rating, targetPrice: ledger.targetPrice,
    cmp: stockData.currentPrice, analystName: "test", assumptionsLedger: ledger,
    canonicalForecast: (sel.dcf as any)?.canonicalForecast ?? null,
    ...(reconciliation ? { reconciliation } : {}),
  });

  const clean = validateReportIntegrity(buildReport(cleanAi));
  const statusOf = (id: string) => clean.checks.find((c: any) => c.id === id)?.status;
  check("FINCONS suite passes on consistent dossier", ["FINCONS-01", "FINCONS-02", "FINCONS-03", "FINCONS-04", "FINCONS-05"].every((id) => statusOf(id) === "PASS" || (id === "FINCONS-03" && statusOf(id) === "WARN")),
    ["FINCONS-01", "FINCONS-02", "FINCONS-03", "FINCONS-04", "FINCONS-05"].map((id) => `${id}=${statusOf(id)}`).join(" "));
  check("SEM-COMP-01 passes clean Reliance dossier", statusOf("SEM-COMP-01") === "PASS", String(statusOf("SEM-COMP-01")));
  check("SOTP-01 passes (bridge verified)", statusOf("SOTP-01") === "PASS", String(statusOf("SOTP-01")));
  check("FCF-NARR-01 passes (no false funding claim)", statusOf("FCF-NARR-01") === "PASS", String(statusOf("FCF-NARR-01")));

  const dirty = validateReportIntegrity(buildReport({
    ...cleanAi,
    investmentThesis: "Advertiser bidding and search index monetization on custom silicon give a hyperscale data-centre moat.",
  }));
  check("platform contamination BLOCKS (SEM-COMP-01 FAIL)", dirty.checks.find((c: any) => c.id === "SEM-COMP-01")?.status === "FAIL");
  check("contaminated gate is BLOCKED", dirty.gateStatus === "BLOCKED", dirty.gateStatus);

  const keyword = validateReportIntegrity(buildReport({ ...cleanAi, investmentThesis: "Refining faces saas churn headwinds." }));
  check("sector keyword leakage FAILS NARRATIVE-01 (WARN->BLOCK)", keyword.checks.find((c: any) => c.id === "NARRATIVE-01")?.status === "FAIL");

  const fcfNegFins = fins.map((f, i) => (i === 1 ? { ...f, operatingCashFlow: 100000000000, capitalExpenditures: 1500000000000, freeCashFlow: -1400000000000 } : f));
  const selNeg = selectAndComputeValuation({ profile, stockData, annualFinancials: fcfNegFins });
  const ledgerNeg: any = createAssumptionsLedger({ profile, stockData, annualFinancials: fcfNegFins, dcf: selNeg.dcf });
  const fcfReport: any = {
    profile, stockData, annualFinancials: fcfNegFins, quarterlyFinancials: [], ratiosByYear: [],
    dupontByYear: [], dcf: selNeg.dcf, shareholding: null, peers: [],
    aiAnalysis: {
      ...cleanAi,
      cashFlowCommentary: "Operating cash comfortably funds growth capex with ample headroom.",
    },
    news: [], eventPriceMovements: [], recommendation: ledgerNeg.rating,
    targetPrice: ledgerNeg.targetPrice, cmp: stockData.currentPrice, analystName: "test",
    assumptionsLedger: ledgerNeg, canonicalForecast: (selNeg.dcf as any)?.canonicalForecast ?? null,
  };
  const fcfQa = validateReportIntegrity(fcfReport);
  check("negative-FCF funding claim FAILS FCF-NARR-01", fcfQa.checks.find((c: any) => c.id === "FCF-NARR-01")?.status === "FAIL");

  const rec = reconcileAll([
    { field: "revenue", primary: null, secondary: { value: 9010640000000, source: "Yahoo", tier: "SECONDARY", fact: {} as never } },
    { field: "netIncome", primary: null, secondary: { value: 696210000000, source: "Yahoo", tier: "SECONDARY", fact: {} as never } },
  ]);
  const srcQa = validateReportIntegrity(buildReport(cleanAi, rec));
  check("SECONDARY-only figures WARN on SRC-01 (disclosure, not silent)", srcQa.checks.find((c: any) => c.id === "SRC-01")?.status === "WARN");
}

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
