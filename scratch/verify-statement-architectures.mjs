/**
 * Step-7 verification: multi-archetype financial statement architecture.
 * Exercises extraction → ratios → validity → drivers → canonical facts →
 * independent validator → report QA for architectures B (bank/nbfc), C
 * (insurance), D (REIT), E (asset-light fee), plus the UNSUPPORTED_SECTOR gate
 * and an Architecture A regression pin. No network required (synthetic Yahoo-
 * shaped fixtures); real-ticker fetch attempted last on a best-effort basis.
 */
import { toBankFinancials, toInsuranceFinancials, toReitFinancials, toAssetLightFinancials, isEquityReitCompany, isAssetLightFeeProfile } from "../src/lib/yahoo-finance.ts";
import { computeRatios, computeRatioValidity, computeDuPont, computeBankRatios, computeInsuranceRatios, computeReitRatios, computeAssetLightRatios } from "../src/lib/calculations.ts";
import { buildBankDriverSet, buildInsuranceDriverSet, buildReitDriverSet, buildAssetLightDriverSet } from "../src/lib/driver-models.ts";
import { buildCanonicalFacts, sealCanonicalFacts } from "../src/lib/canonical-facts.ts";
import { validateIndependently } from "../src/lib/independent-validator.ts";
import { enforceAccountingIdentities } from "../src/lib/accounting-identity-engine.ts";
import { validateReportIntegrity } from "../src/lib/report-qa.ts";
import { getStatementArchitecture } from "../src/types/report.ts";
import { classifySector } from "../src/lib/sectors/profiles.ts";
import { getArchitectureForSector, isSectorSupported, unsupportedSectorPayload, SECTOR_ARCHITECTURES } from "../src/lib/sectors/architectures.ts";

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.error(`  FAIL: ${name}${extra ? ` — ${extra}` : ""}`); }
};

// ── Synthetic corporate-shaped history (balanced, chained, growing) ──
function corpRow(i, rev) {
  const ni = Math.round(rev * 0.14);
  const ocf = Math.round(ni * 1.6);
  const capex = Math.round(rev * 0.05);
  const sap = Math.round(rev * 0.20);
  const assets = Math.round(rev * 2.2);
  const equity = Math.round(rev * 1.1);
  const debt = Math.round(rev * 0.4);
  const cash = Math.round(rev * 0.12);
  const ca = Math.round(rev * 0.5);
  const cl = Math.round(rev * 0.3);
  const shares = 1000;
  return {
    year: `FY202${1 + i}`, fiscalYearEnd: `202${1 + i}-03-31`,
    revenue: rev, costOfRevenue: Math.round(rev * 0.58), grossProfit: Math.round(rev * 0.42), grossMargin: 0.42,
    researchDevelopment: Math.round(rev * 0.03), sellingGeneralAdministrative: sap,
    totalOperatingExpenses: sap, operatingIncome: Math.round(rev * 0.19),
    ebitda: Math.round(rev * 0.23), ebitdaMargin: 0.23, ebitMargin: 0.19,
    interestExpense: Math.round(rev * 0.02), interestIncome: Math.round(rev * 0.005), otherIncome: 0,
    pretaxIncome: Math.round(rev * 0.175), incomeTaxExpense: Math.round(rev * 0.035),
    netIncome: ni, netMargin: 0.14, depreciation: Math.round(rev * 0.04),
    eps: ni / shares, dilutedEps: ni / shares, sharesOutstanding: shares,
    totalAssets: assets, totalLiabilities: assets - equity, totalEquity: equity,
    cash, shortTermInvestments: 0, netReceivables: Math.round(rev * 0.15), inventory: Math.round(rev * 0.1),
    currentAssets: ca, netFixedAssets: Math.round(rev * 1.2),
    totalDebt: debt, shortTermDebt: Math.round(debt * 0.3), longTermDebt: Math.round(debt * 0.7),
    accountsPayable: Math.round(rev * 0.12), currentLiabilities: cl, netWorkingCapital: ca - cl,
    operatingCashFlow: ocf, capitalExpenditures: capex, freeCashFlow: ocf - capex,
    investingCashFlow: -capex, financingCashFlow: Math.round(-ni * 0.2), dividendsPaid: Math.round(ni * 0.2),
    changeInCash: 0, estimatesUsed: [],
  };
}
const corpHist = [100000, 112000, 125000, 140000, 158000].map((r, i) => corpRow(i, r));

console.log("\n== 1. Extraction: genuinely separate shapes ==");
// Bank-plausible interest split (banks earn a spread: interest income > expense).
// Corporate fixtures carry the reverse, which is meaningless for a bank P&L.
const bankCorpHist = corpHist.map((c) => ({ ...c, interestIncome: Math.round(c.revenue * 0.09), interestExpense: Math.round(c.revenue * 0.05) }));
const bankRows = bankCorpHist.map((c) => toBankFinancials(c, "bank"));
const nbfcRows = corpHist.map((c) => toBankFinancials(c, "nbfc"));
const insRows = corpHist.map((c) => toInsuranceFinancials(c));
const reitRows = corpHist.map((c) => toReitFinancials(c));
const feeRows = corpHist.map((c) => toAssetLightFinancials(c, "asset-management"));
const ratingRows = corpHist.map((c) => toAssetLightFinancials(c, "ratings-agency"));

ok(getStatementArchitecture(bankRows[4]) === "B", "bank rows route to architecture B");
ok(getStatementArchitecture(insRows[4]) === "C", "insurance rows route to architecture C");
ok(getStatementArchitecture(reitRows[4]) === "D", "REIT rows route to architecture D");
ok(getStatementArchitecture(feeRows[4]) === "E", "fee rows route to architecture E");
ok(getStatementArchitecture(corpHist[4]) === "A", "corporate rows stay on architecture A");

for (const [nm, r] of [["insurance", insRows[4]], ["reit", reitRows[4]], ["fee", feeRows[4]]]) {
  for (const k of ["grossProfit", "costOfRevenue", "inventory", "ebitda", "netReceivables"]) {
    ok(!(k in r), `${nm} shape has no '${k}' field (compile-error by design, not silent zero)`);
  }
}
for (const k of ["deposits", "loans", "netInterestIncome"]) ok(!(k in insRows[4]), `insurance shape has no bank field '${k}'`);
ok(!("combinedRatio" in reitRows[4]) && !("combinedRatio" in feeRows[4]), "no combined-ratio math outside insurance");
ok(nbfcRows[4].deposits === 0 && nbfcRows[4].statementType === "nbfc", "NBFC shares bank shape with legitimately empty deposits");
ok(insRows[4].revenue === insRows[4].netEarnedPremium + insRows[4].investmentIncome, "insurance revenue alias = NEP + investment income");
ok(reitRows[4].revenue === reitRows[4].rentalIncome, "REIT revenue alias = rental income");
ok(feeRows[4].revenue === feeRows[4].totalFeeRevenue, "fee revenue alias = totalFeeRevenue");

// REIT-vs-developer split + fee detector
ok(isEquityReitCompany("Real Estate", "REIT - Office", "", "Embassy Office Parks REIT") === true, "office REIT detected as REIT");
ok(isEquityReitCompany("Real Estate", "Real Estate - Development", "", "DLF Limited") === false, "developer stays corporate (Arch A)");
ok(isAssetLightFeeProfile("Financial Services", "Asset Management", "", "HDFC AMC").isFee === true, "AMC detected as fee-native");
ok(isAssetLightFeeProfile("Financial Services", "Banks", "serves asset management clients with credit rating", "HDFC Bank").isFee === false, "bank mentioning ratings/AM clients is NOT fee-native");
ok(isAssetLightFeeProfile("Industrials", "Credit Ratings", "", "CRISIL").kind === "ratings-agency", "ratings agency detected as fee-native");

console.log("\n== 2. Ratio engines: only valid ratios per arch ==");
const CMP = 100;
const br = computeBankRatios(bankRows[4], CMP);
ok(br.nim > 0 && br.costToIncome > 0 && br.roe > 0, "bank engine: NIM/cost-to-income/ROE computed");
const ir = computeInsuranceRatios(insRows[4], CMP);
ok(Math.abs(ir.combinedRatio - (ir.lossRatio + ir.expenseRatio)) < 1e-9, "insurance engine: combined = loss + expense");
ok(ir.underwritingMargin > 0 && ir.investmentYieldOnFloat > 0, "insurance engine: UW margin + float yield computed");
const rr = computeReitRatios(reitRows[4], CMP);
ok(rr.noiMargin > 0.3 && rr.priceToFfo > 0 && rr.priceToAffo > 0, "REIT engine: NOI margin + P/FFO + P/AFFO computed");
ok(rr.affoPayout > 0, "REIT engine: AFFO payout computed");
const fr = computeAssetLightRatios(feeRows[4], CMP);
ok(fr.operatingMargin > 0.2 && fr.fcfConversion > 0.5, "fee engine: operating margin (meaningful) + FCF conversion computed");
ok(fr.revenueAsPctOfAum === 0, "fee engine: revenue/AUM is 0 while AUM undisclosed (N/M, never invented)");

// computeRatios bridge never crashes + zeroes inapplicable corporate ratios
for (const [nm, rows] of [["bank", bankRows], ["insurance", insRows], ["reit", reitRows], ["fee", feeRows], ["corp", corpHist]]) {
  const ratios = rows.map((f) => computeRatios(f, CMP));
  const v = rows.map((f) => computeRatioValidity(f, CMP));
  const d = rows.map((f) => computeDuPont(f));
  ok(ratios.length === 5 && v.length === 5 && d.length === 5, `${nm}: bridge ratios/validity/DuPont run all years`);
  if (nm !== "corp") {
    ok(ratios.every((r) => r.grossMargin === 0 && r.ebitdaMargin === 0 && r.inventoryTurnover === 0 && r.receivablesTurnover === 0),
      `${nm}: bridge zeroes inapplicable corporate ratios (gross/EBITDA/DSO/DIO)`);
  }
}
// Validity sidecars: native KPIs VALUE, corporate fictions N/M
const iv = computeRatioValidity(insRows[4], CMP);
ok(iv.combinedRatio.display === "VALUE" && iv.grossMargin.display === "N_M" && iv.evToEbitda.display === "N_M", "insurance validity: combined VALUE, gross/EV-EBITDA N/M");
const rv = computeRatioValidity(reitRows[4], CMP);
ok(rv.priceToFfo.display === "VALUE" && rv.pe.display === "N_M" && rv.grossMargin.display === "N_M", "REIT validity: P/FFO VALUE, P/E + gross N/M");
const fv2 = computeRatioValidity(feeRows[4], CMP);
ok(fv2.ebitMargin.display === "VALUE" && fv2.revenueAsPctOfAum.display === "N_M", "fee validity: operating margin VALUE, fee/AUM N/M (undisclosed)");

console.log("\n== 3. Sector-native driver sets ==");
const bd = buildBankDriverSet({ loans: bankRows.map((f) => f.loans || 500000), netInterestIncome: bankRows.map((f) => f.netInterestIncome), totalRevenue: bankRows.map((f) => f.totalRevenue), nonInterestExpenses: bankRows.map((f) => f.nonInterestExpenses), provisions: bankRows.map((f) => f.provisionForCreditLosses) });
ok(bd.loanGrowthRates.length === 5 && bd.nimPath.every((x) => x >= 0.015 && x <= 0.06), "bank drivers: loan growth + bounded NIM path");
const idr = buildInsuranceDriverSet({ gwp: insRows.map((f) => f.grossWrittenPremium), lossRatio: insRows.map((f) => f.lossRatio), expenseRatio: insRows.map((f) => f.expenseRatio), investmentIncome: insRows.map((f) => f.investmentIncome), float: insRows.map((f) => f.float) });
ok(idr.gwpGrowthRates.length === 5 && idr.combinedRatioPath.every((x) => x > 0.5 && x < 1.5), "insurance drivers: GWP growth + sane combined path");
const rd = buildReitDriverSet({ rental: reitRows.map((f) => f.rentalIncome), noiMargin: reitRows.map((f) => f.noiMargin), ffoPerShare: reitRows.map((f) => f.ffoPerShare) });
ok(rd.rentalGrowthRates.length === 5 && rd.noiMarginPath.every((x) => x >= 0.4 && x <= 0.9), "REIT drivers: rental growth + bounded NOI margin");
const fd = buildAssetLightDriverSet({ feeRevenue: feeRows.map((f) => f.totalFeeRevenue), operatingMargin: feeRows.map((f) => f.operatingMargin), fcfConversion: feeRows.map((f) => 0.9) });
ok(fd.feeGrowthRates.length === 5 && fd.operatingMarginPath.every((x) => x >= 0.05 && x <= 0.55), "fee drivers: fee growth + operating-leverage margin");

console.log("\n== 4. Canonical facts + independent validator (own identities) ==");
function checkFacts(label, rows, isFin) {
  const profile = { ticker: "TEST", name: "Test Co", sector: "Financial Services", industry: label, country: "India", currency: "INR", exchange: "NSE", exchangeTimezoneName: "", description: "test", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: CMP, sharesOutstanding: 1000, marketCap: 100000 };
  const facts = sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: rows }));
  const ind = validateIndependently({
    facts, isFinancialInstitution: isFin, country: "India", beta: 1,
    dcf: { enterpriseValue: 150000, sumPvFcff: 50000, pvTerminalValue: 100000, equityValue: 120000, netDebt: 30000, intrinsicValue: 120, sharesOutstanding: 1000, currentMarketPrice: CMP, assumptions: { wacc: 0.1 } },
    ledger: { fairValue: 120, targetPrice: 120, currentPrice: CMP, enterpriseValue: 150000, equityValue: 120000, netDebt: 30000, sharesOutstanding: 1000, wacc: 0.1, rating: "BUY" },
  });
  const stmtFails = ind.issues.filter((i) => i.code === "STMT-02" && i.severity === "FAIL");
  ok(stmtFails.length === 0, `${label}: STMT-02 native identities reconcile (${ind.passes.find((p) => p.startsWith("STMT-02")) || "no checks"})`);
  return { facts, ind };
}
checkFacts("Banks", bankRows, true);
checkFacts("Insurance", insRows, true);
checkFacts("REIT", reitRows, false);
checkFacts("Asset Management", feeRows, false);

console.log("\n== 5. Report QA: ARCH identities PASS, no inapplicable FAILs ==");
function qaStub(label, rows, sector, industry, desc, tgr = 0.04, opts = {}) {
  const latest = rows[rows.length - 1];
  const netDebt = latest.totalDebt - latest.cash;
  const shares = 1000, fv = 120, cmp = 100;
  const equity = fv * shares;
  const ev = equity + netDebt;
  // Financial-institution path is hurdled on cost-of-equity (India-fixed Rf 6.85%
  // + ERP 6.0%, beta 1 → Blume 1.0 → 12.85%) — stub must carry the re-solvable value.
  // Corporate stubs default to 0.1; debt-heavy fixtures clamp to the 8.5% floor.
  const isFinStub = label === "bank" || label === "insurance";
  const stubWacc = opts.wacc !== undefined ? opts.wacc : (isFinStub ? 0.1285 : 0.1);
  const trailMargin = label === "insurance" || label === "reit" ? latest.netMargin : (latest.revenue > 0 ? (latest.operatingIncome ?? latest.netIncome / latest.revenue) / latest.revenue : 0.1);
  const ratiosByYear = rows.map((f) => computeRatios(f, cmp));
  const dupontByYear = rows.map((f) => computeDuPont(f));
  const ebitM = [0, 1, 2, 3, 4].map(() => Math.min(0.3, Math.max(0.05, trailMargin)));
  const basis = {};
  for (const k of ["revenueGrowth", "ebitMargin", "capex", "workingCapital", "netDebt", "wacc", "terminal"]) basis[k] = `evidenced basis for ${k} with sufficient length here`;
  const proj = (rev, g, m) => ({ year: "FY26E", revenue: rev, revenueGrowth: g, ebitMargin: m, ebit: rev * m, taxPayment: rev * m * 0.25, nopat: rev * m * 0.75, depreciation: rev * 0.03, capex: rev * 0.04, changeInWorkingCapital: rev * 0.01, fcff: 1000, discountFactor: 0.9, pvFcff: 900 });
  const nProj = opts.dcfProjectionsCount !== undefined ? opts.dcfProjectionsCount : (isFinStub ? 0 : 5);
  const dcf = {
    status: "valid", diagnostics: [], assumptions: { wacc: stubWacc, terminalGrowthRate: tgr, revenueGrowthRates: [0.1, 0.09, 0.08, 0.07, 0.06], ebitMargins: ebitM, riskFreeRate: 0.06, equityRiskPremium: 0.05, beta: 1, costOfEquity: 0.11, costOfDebtPreTax: 0.07, marginalTaxRate: 0.25, costOfDebtPostTax: 0.05, debtWeight: 0.2, equityWeight: 0.8 },
    assumptionBasis: basis, projections: Array.from({ length: nProj }, (_, i) => proj(latest.revenue * (1 + i * 0.05), 0.08, 0.15)), sumPvFcff: ev * 0.4, terminalYearFcff: 1000, terminalValue: ev * 0.6 * 1.1, pvTerminalValue: ev * 0.6, enterpriseValue: ev,
    totalDebt: latest.totalDebt, cashAndEquiv: latest.cash, netDebt, lessDebt: Math.max(0, netDebt), plusCash: Math.max(0, -netDebt),
    equityValue: equity, sharesOutstanding: shares, intrinsicValue: fv, fairValuePerShare: fv, currentMarketPrice: cmp, upsideDownside: fv / cmp - 1, verdict: "BUY",
  };
  const hospNarrative = label === "reit"
    ? "Test Company leases office space with occupancy and rent escalation; RevPAR ADR occupancy NOI AFFO WALE cap rate NAV drive returns"
    : "Test Company operates diversified businesses across India with steady growth";
  const data = {
    generatedAt: new Date().toISOString(),
    profile: { ticker: "TEST", name: "Test Company", sector, industry, country: "India", currency: "INR", exchange: "NSE", exchangeTimezoneName: "", description: desc, website: "", employees: 10, officers: [] },
    stockData: { currentPrice: cmp, sharesOutstanding: shares, marketCap: cmp * shares, dividendYield: 0.01, beta: 1, pe: 15, pb: 2, returnOnEquity: 0.15 },
    annualFinancials: rows, quarterlyFinancials: [], ratiosByYear, dupontByYear, dcf,
    shareholding: { insiderOwnership: 0.5, institutionalOwnership: 0.2, publicFloat: 0.3, topInstitutions: [], categories: [] },
    peers: [], aiAnalysis: { companyOverview: hospNarrative, investmentThesis: `Test Company grows 12% with 3 segments and Rs. 500 Cr capex in FY26. ${hospNarrative}` },
    recommendation: "BUY", targetPrice: fv, cmp, analystName: "QA",
    assumptionsLedger: { fairValue: fv, targetPrice: fv, currentPrice: cmp, upsideDownsidePct: fv / cmp - 1, rating: "BUY", riskFreeRate: 0.06, equityRiskPremium: 0.05, beta: 1, costOfEquity: 0.11, costOfDebtPreTax: 0.07, marginalTaxRate: 0.25, costOfDebtPostTax: 0.05, debtWeight: 0.2, equityWeight: 0.8, wacc: stubWacc, terminalGrowthRate: tgr, sumPvFcff: ev * 0.4, pvTerminalValue: ev * 0.6, enterpriseValue: ev, netDebt, equityValue: equity, sharesOutstanding: shares, currency: "INR", reportingUnit: "Cr", unitMultiplier: 1 },
    ...(opts.attachForecast ? { canonicalForecast: { projections: [{}, {}, {}, {}, {}], driverEquation: "test driver equation for forecast checks" } } : {}),
  };
  const qa = validateReportIntegrity(data);
  const arch = qa.checks.filter((c) => c.id.startsWith("ARCH-"));
  if (!opts.skipArch) {
    ok(arch.length === 1 && arch[0].status === "PASS", `${label}: QA ${arch[0]?.id} PASS on own identities (${arch[0]?.details?.slice(0, 80)}...)`);
  }
  const fails = qa.checks.filter((c) => c.status === "FAIL");
  if (!opts.allowFails) {
    ok(fails.length === 0, `${label}: zero QA FAILs (${qa.checks.filter((c) => c.status === "WARN").length} WARNs tolerated)${fails.length ? ` — ${fails.map((f) => f.id).join(",")}` : ""}`);
  }
  return qa;
}
qaStub("bank", bankRows, "Financial Services", "Banks", "A commercial bank mobilizing CASA deposits and growing advances with stable asset quality");
qaStub("insurance", insRows, "Financial Services", "Insurance", "A general insurer underwriting policies and investing policyholder float conservatively");
qaStub("reit", reitRows, "Real Estate", "REIT - Office", "An office REIT leasing space with occupancy and contractual rent escalation", 0.03);
qaStub("fee", feeRows, "Financial Services", "Asset Management", "An asset manager compounding AUM through net inflows and market appreciation");

console.log("\n== 6. STMT-01 display names: distinct + accurate (display-name bug regression) ==");
// Deliberately broken corporate history: balance + chains intact, but one
// STMT-01 FAIL-grade breach per year (closure, ETR, borrowing rate).
function brokenRow(year, { opInc, int, other, pretax, tax, debt, stDebt, ni, re }) {
  const assets = 1000000, equity = 600000, cash = 5000, ca = 100000, cl = 60000;
  return {
    year, fiscalYearEnd: `${year.slice(2)}-03-31`,
    revenue: 800000, costOfRevenue: 500000, grossProfit: 300000, grossMargin: 0.375,
    researchDevelopment: 0, sellingGeneralAdministrative: 100000, totalOperatingExpenses: 100000,
    operatingIncome: opInc, ebitda: opInc + 20000, ebitdaMargin: 0.15, ebitMargin: opInc / 800000,
    interestExpense: int, interestIncome: 0, otherIncome: other,
    pretaxIncome: pretax, incomeTaxExpense: tax, netIncome: ni, netMargin: ni / 800000,
    depreciation: 20000, eps: ni / 1000, dilutedEps: ni / 1000, sharesOutstanding: 1000,
    totalAssets: assets, totalLiabilities: assets - equity, totalEquity: equity,
    cash, shortTermInvestments: 0, netReceivables: 50000, inventory: 40000,
    currentAssets: ca, netFixedAssets: 700000,
    totalDebt: debt, shortTermDebt: stDebt, longTermDebt: debt - stDebt,
    accountsPayable: 30000, currentLiabilities: cl, netWorkingCapital: ca - cl,
    operatingCashFlow: 50000, capitalExpenditures: 10000, freeCashFlow: 40000,
    investingCashFlow: -10000, financingCashFlow: -30000, dividendsPaid: 1000,
    changeInCash: 0, retainedEarnings: re, repurchases: 0, estimatesUsed: [],
  };
}
const brokenRows = [
  brokenRow("FY2023", { opInc: 100000, int: 10000, other: 0, pretax: 500000, tax: 18000, debt: 20000, stDebt: 5000, ni: 400000, re: 300000 },
  ),
  brokenRow("FY2024", { opInc: 120000, int: 10000, other: -10000, pretax: 100000, tax: 200000, debt: 20000, stDebt: 5000, ni: -100000, re: 199000 }),
  brokenRow("FY2025", { opInc: 60000, int: 50000, other: 0, pretax: 10000, tax: 2000, debt: 100000, stDebt: 20000, ni: 8000, re: 206000 }),
];
const brokenQa = qaStub("broken-industrial", brokenRows, "Industrials", "Industrial Machinery", "An industrial manufacturer of pumps and valves", 0.04, { allowFails: true, skipArch: true });
const stmtFails = brokenQa.checks.filter((c) => c.id === "STMT-01" && c.status === "FAIL");
ok(stmtFails.length >= 3, `three distinct STMT-01 breaches fire (got ${stmtFails.length})`);
ok(stmtFails.every((c) => c.name.startsWith("Statement Integrity Battery — ")), "every STMT-01 badge carries the battery name, not a fallback");
ok(stmtFails.every((c) => !c.name.includes("Upside/Rating")), "no STMT-01 badge mislabeled as Upside/Rating Map");
ok(new Set(stmtFails.map((c) => c.name)).size === stmtFails.length, `badges visually distinct: ${stmtFails.map((c) => JSON.stringify(c.name)).join(" | ")}`);
// Sub-check vocabulary across ALL STMT-01 badges (FAIL + WARN): the broken fixture's
// older closure/ETR FAILs correctly downgrade to stale WARNs under the new doctrine
// (latest year is clean for those families), while borrowing-rate FAILs still block.
const stmtAll = brokenQa.checks.filter((c) => c.id === "STMT-01");
const allNames = stmtAll.map((c) => c.name).join(" ");
ok(allNames.includes("closure") && allNames.includes("effective tax rate") && allNames.includes("implied borrowing rate"), "subtitles reflect the actual sub-checks (closure, ETR, borrowing rate)");
ok(stmtAll.some((c) => c.status === "WARN" && /stale/i.test(c.name)), "stale downgrades surface at QA level with explicit labels");

console.log("\n== 7. Pretax closure: interestIncome term (STMT-01 false-positive fix) ==");
// MSFT-pattern: material interestIncome; OLD formula FAILs every year (the blocked
// signature), NEW formula downgrades to WARN with the residual explained.
function msftRow(year, re) {
  const opInc = 155237000, intExp = 3051000, intInc = 3301000, pretax = 165934000, tax = 32185000;
  const ni = pretax - tax, rev = 331839000, debt = 200000000;
  return {
    year, fiscalYearEnd: `${year.slice(2)}-06-30`,
    revenue: rev, costOfRevenue: 100000000, grossProfit: rev - 100000000, grossMargin: (rev - 100000000) / rev,
    researchDevelopment: 0, sellingGeneralAdministrative: 50000000, totalOperatingExpenses: 50000000,
    operatingIncome: opInc, ebitda: opInc + 15000000, ebitdaMargin: 0.47, ebitMargin: opInc / rev,
    interestExpense: intExp, interestIncome: intInc, otherIncome: 0,
    pretaxIncome: pretax, incomeTaxExpense: tax, netIncome: ni, netMargin: ni / rev,
    depreciation: 15000000, eps: ni / 1000, dilutedEps: ni / 1000, sharesOutstanding: 1000,
    totalAssets: 3000000000, totalLiabilities: 1200000000, totalEquity: 1800000000,
    cash: 50000000, shortTermInvestments: 0, netReceivables: 50000000, inventory: 10000000,
    currentAssets: 200000000, netFixedAssets: 500000000,
    totalDebt: debt, shortTermDebt: 50000000, longTermDebt: debt - 50000000,
    accountsPayable: 20000000, currentLiabilities: 100000000, netWorkingCapital: 100000000,
    operatingCashFlow: 150000000, capitalExpenditures: 20000000, freeCashFlow: 130000000,
    investingCashFlow: -20000000, financingCashFlow: -100000000, dividendsPaid: 20000000,
    changeInCash: 0, retainedEarnings: re, repurchases: 0, estimatesUsed: [],
  };
}
const msftRows = [msftRow("FY2024", 613749000), msftRow("FY2025", 727498000), msftRow("FY2026", 841247000)];
{
  const profile = { ticker: "MSFT", name: "Microsoft", sector: "Technology", industry: "Software", country: "United States", currency: "USD", exchange: "NASDAQ", exchangeTimezoneName: "", description: "software", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: 100, sharesOutstanding: 1000, marketCap: 100000 };
  const facts = sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: msftRows }));
  ok(facts.years.every((y) => y.interestIncome.value === 3301000), "interestIncome fact sourced (not dropped)");
  const ind = validateIndependently({
    facts, isFinancialInstitution: false, country: "United States", beta: 1,
    dcf: { enterpriseValue: 1, sumPvFcff: 1, pvTerminalValue: 0, equityValue: 1, netDebt: 0, intrinsicValue: 1, sharesOutstanding: 1000, currentMarketPrice: 100, assumptions: {} },
    ledger: { fairValue: 1, targetPrice: 1, currentPrice: 100, sharesOutstanding: 1000, rating: "HOLD" },
  });
  const closureFails = ind.issues.filter((i) => i.code === "STMT-01" && i.severity === "FAIL" && /closure/i.test(i.message));
  const closureWarns = ind.issues.filter((i) => i.code === "STMT-01" && i.severity === "WARN" && /closure/i.test(i.message));
  ok(closureFails.length === 0, `MSFT-pattern: zero closure FAILs (was FAIL every year before fix)`);
  ok(closureWarns.length === 3 && closureWarns.every((w) => w.message.includes("+intInc")), `MSFT-pattern: 3 closure WARNs on +intInc basis with explained residual`);
}
// Ford-pattern: interestIncome material but non-additive (bundled) → WARN, never FAIL.
{
  const profile = { ticker: "F", name: "Ford", sector: "Auto", industry: "Auto", country: "United States", currency: "USD", exchange: "NYSE", exchangeTimezoneName: "", description: "auto", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: 10, sharesOutstanding: 1000, marketCap: 10000 };
  const ford = [{ ...msftRows[0], year: "FY2025", operatingIncome: 100000, interestExpense: 5000, otherIncome: 2000, interestIncome: 8000, pretaxIncome: 97000, incomeTaxExpense: 20000, netIncome: 77000 }];
  const facts = sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: ford }));
  const ind = validateIndependently({
    facts, isFinancialInstitution: false, country: "United States", beta: 1,
    dcf: { enterpriseValue: 1, sumPvFcff: 1, pvTerminalValue: 0, equityValue: 1, netDebt: 0, intrinsicValue: 1, sharesOutstanding: 1000, currentMarketPrice: 10, assumptions: {} },
    ledger: { fairValue: 1, targetPrice: 1, currentPrice: 10, sharesOutstanding: 1000, rating: "HOLD" },
  });
  const fw = ind.issues.filter((i) => i.code === "STMT-01" && /closure|vintage/i.test(i.message));
  ok(fw.length === 1 && fw[0].severity === "WARN" && fw[0].message.includes("vintage-ambiguity"), "Ford-pattern: single vintage-ambiguity WARN (no double-count FAIL)");
}
// Corrupted books: pretax irreconcilable on BOTH bases AND far beyond any plausible
// missing-interest-income range → still FAILs (catch-power preserved). interestIncome
// structurally absent (QS-vintage shape) so the data-gap rule is eligible but must NOT fire.
{
  const profile = { ticker: "BAD", name: "Bad Co", sector: "X", industry: "Y", country: "US", currency: "USD", exchange: "N", exchangeTimezoneName: "", description: "x", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: 10, sharesOutstanding: 1000, marketCap: 10000 };
  const bad = [{
    year: "FY2025", fiscalYearEnd: "2025-03-31",
    revenue: 100000, costOfRevenue: 60000, grossProfit: 40000, grossMargin: 0.4,
    researchDevelopment: 0, sellingGeneralAdministrative: 18000, totalOperatingExpenses: 18000,
    operatingIncome: 20000, ebitda: 22000, ebitdaMargin: 0.22, ebitMargin: 0.2,
    interestExpense: 1000, otherIncome: 0,
    pretaxIncome: 500000, incomeTaxExpense: 20000, netIncome: 480000, netMargin: 4.8,
    depreciation: 2000, eps: 480, dilutedEps: 480, sharesOutstanding: 1000,
    totalAssets: 200000, totalLiabilities: 80000, totalEquity: 120000,
    cash: 10000, shortTermInvestments: 0, netReceivables: 15000, inventory: 10000,
    currentAssets: 40000, netFixedAssets: 120000,
    totalDebt: 80000, shortTermDebt: 20000, longTermDebt: 60000,
    accountsPayable: 12000, currentLiabilities: 20000, netWorkingCapital: 20000,
    operatingCashFlow: 30000, capitalExpenditures: 5000, freeCashFlow: 25000,
    investingCashFlow: -5000, financingCashFlow: -20000, dividendsPaid: 1000,
    changeInCash: 0, retainedEarnings: 90000, repurchases: 0, estimatesUsed: [],
  }];
  const facts = sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: bad }));
  const ind = validateIndependently({
    facts, isFinancialInstitution: false, country: "US", beta: 1,
    dcf: { enterpriseValue: 1, sumPvFcff: 1, pvTerminalValue: 0, equityValue: 1, netDebt: 0, intrinsicValue: 1, sharesOutstanding: 1000, currentMarketPrice: 10, assumptions: {} },
    ledger: { fairValue: 1, targetPrice: 1, currentPrice: 10, sharesOutstanding: 1000, rating: "HOLD" },
  });
  const bf = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(bf.some((i) => i.severity === "FAIL"), "corrupted books: STMT-01 closure still FAILs (no weakening)");
  ok(bf.every((i) => !i.message.includes("data-gap")), "corrupted books: data-gap downgrade does NOT fire beyond the 2.5%-of-revenue ceiling");
}
// Full QA on the MSFT pattern: publishable with an accurately-named WARN badge.
{
  const qa = qaStub("msft-pattern", msftRows, "Technology", "Software", "A software company selling subscriptions with large cash balances", 0.04, { allowFails: true, skipArch: true, wacc: 0.085 });
  const badges = qa.checks.filter((c) => c.id === "STMT-01" && /closure/i.test(c.name));
  ok(badges.length > 0 && badges.every((c) => c.status === "WARN" && c.name.includes("intInc")), `QA badge names carry +intInc basis: ${badges.map((b) => JSON.stringify(b.name)).join(" | ")}`);
  ok(qa.gateStatus !== "BLOCKED", `MSFT-pattern report publishable (gate ${qa.gateStatus})`);
}

console.log("\n== 8. Data-gap rule: absent interestIncome, gap within/outside plausible range ==");
// QS-vintage rows: NO interestIncome property at all (structurally absent, not zero).
function gapRow(year, { opInc, int, other, pretax, tax, ni, intInc }) {
  const row = {
    year, fiscalYearEnd: `${year.slice(2)}-03-31`,
    revenue: 100000, costOfRevenue: 60000, grossProfit: 40000, grossMargin: 0.4,
    researchDevelopment: 0, sellingGeneralAdministrative: 18000, totalOperatingExpenses: 18000,
    operatingIncome: opInc, ebitda: opInc + 2000, ebitdaMargin: 0.22, ebitMargin: opInc / 100000,
    interestExpense: int, otherIncome: other,
    pretaxIncome: pretax, incomeTaxExpense: tax, netIncome: ni, netMargin: ni / 100000,
    depreciation: 2000, eps: ni / 1000, dilutedEps: ni / 1000, sharesOutstanding: 1000,
    totalAssets: 200000, totalLiabilities: 80000, totalEquity: 120000,
    cash: 10000, shortTermInvestments: 0, netReceivables: 15000, inventory: 10000,
    currentAssets: 40000, netFixedAssets: 120000,
    totalDebt: 80000, shortTermDebt: 20000, longTermDebt: 60000,
    accountsPayable: 12000, currentLiabilities: 20000, netWorkingCapital: 20000,
    operatingCashFlow: 30000, capitalExpenditures: 5000, freeCashFlow: 25000,
    investingCashFlow: -5000, financingCashFlow: -20000, dividendsPaid: 1000,
    changeInCash: 0, retainedEarnings: 90000, repurchases: 0, estimatesUsed: [],
  };
  if (intInc !== undefined) row.interestIncome = intInc;
  return row;
}
function runGapCase(rows) {
  const profile = { ticker: "G", name: "Gap Co", sector: "X", industry: "Y", country: "US", currency: "USD", exchange: "N", exchangeTimezoneName: "", description: "x", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: 10, sharesOutstanding: 1000, marketCap: 10000 };
  const facts = sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: rows }));
  // Coherent bridges (ev 80000 = equity 10000 + netDebt 70000 = debt 80000 − cash 10000;
  // per-share 10; wacc 8.5% = independently re-solved clamped floor for these weights).
  return validateIndependently({
    facts, isFinancialInstitution: false, country: "US", beta: 1,
    dcf: { enterpriseValue: 80000, sumPvFcff: 80000, pvTerminalValue: 0, equityValue: 10000, netDebt: 70000, intrinsicValue: 10, fairValuePerShare: 10, sharesOutstanding: 1000, currentMarketPrice: 10, assumptions: { wacc: 0.085 } },
    ledger: { fairValue: 10, targetPrice: 10, currentPrice: 10, enterpriseValue: 80000, equityValue: 10000, netDebt: 70000, sharesOutstanding: 1000, wacc: 0.085, rating: "HOLD" },
  });
}
{
  // (a1) gap 2000 (10.5% → FAIL-grade) but ≤ 2.5%-of-revenue ceiling (2500) with
  // interestIncome absent → data-gap WARN, not FAIL.
  const ind = runGapCase([gapRow("FY2025", { opInc: 20000, int: 1000, other: 0, pretax: 21000, tax: 4000, ni: 17000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure|data-gap/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("data-gap"), "absent intInc + gap within plausible range → data-gap WARN (not FAIL)");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "absent-intInc in-range case: zero FAILs anywhere");
}
{
  // (a2) gap 6000 > ceiling 2500 with interestIncome absent → FAIL stands.
  const ind = runGapCase([gapRow("FY2025", { opInc: 20000, int: 1000, other: 0, pretax: 25000, tax: 4000, ni: 21000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.some((i) => i.severity === "FAIL"), "absent intInc + gap beyond ceiling → FAIL stands");
  ok(cl.every((i) => !i.message.includes("data-gap")), "above-ceiling case never labeled data-gap");
}
{
  // (a3) interestIncome PRESENT but small (500, below old absTol): +intInc basis wins
  // (7.7% vs 10.5%) → WARN on +intInc basis; data-gap rule must not fire (term exists).
  const ind = runGapCase([gapRow("FY2025", { opInc: 20000, int: 1000, other: 0, pretax: 21000, tax: 4000, ni: 17000, intInc: 500 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("+intInc"), "present small intInc engages rescue → +intInc WARN");
  ok(cl.every((i) => !i.message.includes("data-gap") && !i.message.includes("vintage-ambiguity")), "present-term case: neither data-gap nor vintage note fires");
}

console.log("\n== 9. Calibration levers: revenue floor + EBIT corroboration ==");
// Helper: minimal coherent corporate row (single-year graphs; balance + chains exact).
function calRow(year, { rev, opInc, int, other, pretax, tax, ni, ebit, intInc, debt, re, div, est }) {
  const eq = 400000, assets = 600000, cash = 30000;
  // EBITDA follows the corrected taxonomy (EBIT + D&A, dep fixed 5000 below) —
  // real feeds reconcile exactly there (Reliance FY23–26 to the rupee), so
  // fixtures must too; the old opInc+5000 hardcode predates the EBIT anchor.
  const row = {
    year, fiscalYearEnd: `${year.slice(2)}-03-31`,
    revenue: rev, costOfRevenue: Math.round(rev * 0.6), grossProfit: Math.round(rev * 0.4), grossMargin: 0.4,
    researchDevelopment: 0, sellingGeneralAdministrative: Math.round(rev * 0.2), totalOperatingExpenses: Math.round(rev * 0.2),
    operatingIncome: opInc, ebitda: (ebit !== undefined ? ebit : opInc) + 5000, ebitdaMargin: 0.2, ebitMargin: opInc / rev,
    interestExpense: int, otherIncome: other,
    pretaxIncome: pretax, incomeTaxExpense: tax, netIncome: ni, netMargin: ni / rev,
    depreciation: 5000, eps: ni / 1000, dilutedEps: ni / 1000, sharesOutstanding: 1000,
    totalAssets: assets, totalLiabilities: assets - eq, totalEquity: eq,
    cash, shortTermInvestments: 0, netReceivables: 20000, inventory: 15000,
    currentAssets: 80000, netFixedAssets: 300000,
    totalDebt: debt, shortTermDebt: Math.round(debt * 0.25), longTermDebt: debt - Math.round(debt * 0.25),
    accountsPayable: 15000, currentLiabilities: 40000, netWorkingCapital: 40000,
    operatingCashFlow: 40000, capitalExpenditures: 5000, freeCashFlow: 35000,
    investingCashFlow: -5000, financingCashFlow: -25000, dividendsPaid: div !== undefined ? div : 2000,
    changeInCash: 0, retainedEarnings: re !== undefined ? re : 200000, repurchases: 0, estimatesUsed: est || [],
  };
  if (ebit !== undefined) row.ebit = ebit;
  if (intInc !== undefined) row.interestIncome = intInc;
  return row;
}
function runCalCase(rows) {
  const profile = { ticker: "C", name: "Cal Co", sector: "X", industry: "Y", country: "US", currency: "USD", exchange: "N", exchangeTimezoneName: "", description: "x", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: 10, sharesOutstanding: 1000, marketCap: 10000 };
  const facts = sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: rows }));
  // Coherent bridges derived from the row (netDebt = debt − cash; equity 10000).
  const nd = (rows[0].totalDebt || 0) - (rows[0].cash || 0);
  const evv = nd + 10000;
  return validateIndependently({
    facts, isFinancialInstitution: false, country: "US", beta: 1,
    dcf: { enterpriseValue: evv, sumPvFcff: evv, pvTerminalValue: 0, equityValue: 10000, netDebt: nd, intrinsicValue: 10, fairValuePerShare: 10, sharesOutstanding: 1000, currentMarketPrice: 10, assumptions: { wacc: 0.085 } },
    ledger: { fairValue: 10, targetPrice: 10, currentPrice: 10, enterpriseValue: evv, equityValue: 10000, netDebt: nd, sharesOutstanding: 1000, wacc: 0.085, rating: "HOLD" },
  });
}
{
  // Break-even year at a large company: 60% relative gap but 0.24% of revenue.
  // interestIncome present-but-useless (100) so the data-gap rule can't fire;
  // no ebit fact so corroboration is unavailable → floor alone must rescue.
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 3000, int: 1000, other: 0, pretax: 3200, tax: 600, ni: 2600, debt: 50000, intInc: 100 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("rev-floor"), "revenue floor: 60%-relative but 0.24%-of-revenue gap → WARN (not FAIL)");
}
{
  // HCLTech pattern in miniature: inflated opInc, pretax doubly corroborated.
  const ind = runCalCase([calRow("FY2025", { rev: 1000000, opInc: 330000, int: 3000, other: 0, pretax: 195000, tax: 45000, ni: 150000, ebit: 198000, debt: 80000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("ebit-corroborated"), "EBIT corroboration: doubly-verified pretax + outlier opInc → WARN (not FAIL)");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "corroborated case: zero FAILs anywhere");
}
{
  // Same shape but corroborations dirty (ebit disagrees too) → FAIL stands.
  const ind = runCalCase([calRow("FY2025", { rev: 1000000, opInc: 330000, int: 3000, other: 0, pretax: 195000, tax: 45000, ni: 150000, ebit: 250000, debt: 80000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.some((i) => i.severity === "FAIL"), "dirty corroboration (ebit also disagrees) → FAIL stands");
}
{
  // corr12 relaxed band: witnesses dirty-at-5% (7.7%/8.7%) but ≤12%, bridge 26% → WARN.
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 100000, int: 5000, other: 0, pretax: 120000, tax: 20000, ni: 90400, ebit: 135000, debt: 100000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("ebit-corroborated"), "corr12 relaxed band (witnesses ≤12%, bridge ≤50%) → WARN");
}
{
  // corr12 cap: 100% bridge gap with witnesses dirty-at-5%-but-clean-at-12% → FAIL stands.
  const ind = runCalCase([calRow("FY2025", { rev: 1000000, opInc: 100000, int: 5000, other: 0, pretax: 190000, tax: 30000, ni: 146000, ebit: 181000, debt: 200000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.some((i) => i.severity === "FAIL") && cl.every((i) => !i.message.includes("ebit-corroborated")), "corr12 cap: 100% bridge gap stays FAIL even corroborated");
}
{
  // opEst: synthesized operatingIncome + huge gap → WARN synth-input, never FAIL.
  const ind = runCalCase([calRow("FY2025", { rev: 100000, opInc: 13000, int: 1000, other: 0, pretax: 50000, tax: 8000, ni: 42000, debt: 80000, est: ["operatingIncome@13%-of-revenue"] })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("synth-input"), "synthesized opInc → WARN synth-input (never convict on fiction)");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "synth-input case: zero FAILs anywhere");
}
{
  // tiered floor: healthy margin (20.8%), gap 1.8% of revenue → WARN tiered-floor.
  const ind = runCalCase([calRow("FY2025", { rev: 1000000, opInc: 200000, int: 10000, other: 0, pretax: 208000, tax: 40000, ni: 168000, debt: 200000, intInc: 50000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("tiered-floor"), "tiered floor (healthy margin, 1–2% gap) → WARN");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "tiered case: zero FAILs anywhere");
}
{
  // intExp coverage gap: zero interest with 500k debt, gap within 8% coupon → WARN.
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 100000, int: 0, other: 0, pretax: 115000, tax: 20000, ni: 95000, debt: 500000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("intExp-coverage-gap"), "zero interest + debt + bounded gap → WARN coverage-gap");
}
{
  // intExp bound: same but gap exceeds 8%-of-debt → FAIL stands.
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 100000, int: 0, other: 0, pretax: 200000, tax: 20000, ni: 180000, debt: 500000 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.some((i) => i.severity === "FAIL") && cl.every((i) => !i.message.includes("coverage-gap")), "gap beyond 8%-of-debt → FAIL stands");
}
{
  // debt-free + zero interest + big gap → FAIL (nothing missing).
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 100000, int: 0, other: 0, pretax: 200000, tax: 20000, ni: 180000, debt: 0 })]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.some((i) => i.severity === "FAIL"), "debt-free zero-interest + big gap → FAIL stands");
}
{
  // NOL benefit after losses → WARN nol-benefit.
  const ind = runCalCase([
    calRow("FY2024", { rev: 200000, opInc: -50000, int: 5000, other: 0, pretax: -55000, tax: 0, ni: -55000, debt: 40000, re: 100000 }),
    calRow("FY2025", { rev: 200000, opInc: 60000, int: 5000, other: 0, pretax: 56000, tax: -70000, ni: 126000, debt: 40000, re: 174000 }),
  ]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate|nol-benefit/i.test(i.message));
  ok(etr.length === 1 && etr[0].severity === "WARN" && etr[0].message.includes("nol-benefit"), "tax benefit after loss history → WARN nol-benefit");
}
{
  // NOL control: benefit WITHOUT loss history → FAIL.
  const ind = runCalCase([
    calRow("FY2024", { rev: 200000, opInc: 40000, int: 5000, other: 0, pretax: 35000, tax: 7000, ni: 28000, debt: 40000, re: 100000 }),
    calRow("FY2025", { rev: 200000, opInc: 60000, int: 5000, other: 0, pretax: 56000, tax: -70000, ni: 126000, debt: 40000, re: 224000 }),
  ]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate|nol-benefit/i.test(i.message));
  ok(etr.some((i) => i.severity === "FAIL"), "benefit without loss history → FAIL stands");
  ok(!ind.issues.some((i) => i.message.includes("nol-benefit")), "control: no nol-benefit label without losses");
}
{
  // Positive-tax absurdity (ETR +160%) → FAIL (NOL rule is benefit-side only).
  const ind = runCalCase([
    calRow("FY2024", { rev: 200000, opInc: 40000, int: 5000, other: 0, pretax: 35000, tax: 7000, ni: 28000, debt: 40000, re: 100000 }),
    calRow("FY2025", { rev: 200000, opInc: 60000, int: 5000, other: 0, pretax: 56000, tax: 90000, ni: -34000, debt: 40000, re: 64000 }),
  ]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate/i.test(i.message));
  ok(etr.some((i) => i.severity === "FAIL"), "positive-tax absurdity → FAIL stands");
}
{
  // ETR floor: 200% ETR but $2k tax on $500k revenue → WARN etr-floor.
  // Closure quiet by construction (base 1000 = pretax 1000).
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 2000, int: 1000, other: 0, pretax: 1000, tax: 2000, ni: -1000, debt: 20000 })]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate/i.test(i.message));
  ok(etr.length === 1 && etr[0].severity === "WARN" && etr[0].message.includes("etr-floor"), "immaterial tax bill (200% ETR, 0.4% of revenue) → WARN etr-floor");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "etr-floor case: zero FAILs anywhere");
}
{
  // ETR floor bound: same 2000% ETR but $20k tax (4% of revenue) → FAIL stands.
  const ind = runCalCase([calRow("FY2025", { rev: 500000, opInc: 2000, int: 1000, other: 0, pretax: 1000, tax: 20000, ni: -19000, debt: 20000 })]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate/i.test(i.message));
  ok(etr.some((i) => i.severity === "FAIL") && etr.every((i) => !i.message.includes("etr-floor")), "material tax bill → ETR FAIL stands");
}
{
  // Stale closure: broken FY2024 + clean FY2025 → WARN stale-year (locked new doctrine).
  const ind = runCalCase([
    calRow("FY2024", { rev: 100000, opInc: 20000, int: 1000, other: 0, pretax: 50000, tax: 20000, ni: 30000, debt: 80000, re: 90000 }),
    calRow("FY2025", { rev: 100000, opInc: 25000, int: 1000, other: 0, pretax: 24000, tax: 5000, ni: 19000, debt: 80000, re: 107000 }),
  ]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure|stale/i.test(i.message));
  ok(cl.length === 1 && cl[0].severity === "WARN" && cl[0].message.includes("stale-year"), "stale closure FAIL downgrades when latest is clean (locked doctrine)");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "stale-closure case: zero FAILs anywhere");
}
{
  // Stale does NOT apply when latest fails: clean FY2024 + broken FY2025 → FAIL stands.
  const ind = runCalCase([
    calRow("FY2024", { rev: 100000, opInc: 25000, int: 1000, other: 0, pretax: 24000, tax: 5000, ni: 19000, debt: 80000, re: 90000 }),
    calRow("FY2025", { rev: 100000, opInc: 20000, int: 1000, other: 0, pretax: 50000, tax: 20000, ni: 30000, debt: 80000, re: 118000 }),
  ]);
  const cl = ind.issues.filter((i) => i.code === "STMT-01" && /closure/i.test(i.message));
  ok(cl.some((i) => i.severity === "FAIL") && cl.every((i) => !i.message.includes("stale-year")), "latest-year FAIL still blocks (no stale downgrade)");
}
{
  // Stale ETR: absurd FY2024 tax (+180%, positive → non-NOL) + sane FY2025 → WARN stale.
  // FY2024 closure: base 55000 vs 50000 → gap 9.09% FAIL-grade; intInc absent but gap
  // 5000 > data-gap ceiling (5000 ≤ 5000? boundary inclusive → data-gap FIRES, not closure FAIL).
  // NOTE: FY2024 pretax lowered to 49000 below so closure passes cleanly and only ETR fires:
  const ind = runCalCase([
    calRow("FY2024", { rev: 200000, opInc: 54000, int: 5000, other: 0, pretax: 49000, tax: 90000, ni: -41000, debt: 40000, re: 90000 }),
    calRow("FY2025", { rev: 200000, opInc: 55000, int: 5000, other: 0, pretax: 50000, tax: 10000, ni: 40000, debt: 40000, re: 128000 }),
  ]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate|Stale ETR/i.test(i.message));
  ok(etr.length === 1 && etr[0].severity === "WARN" && etr[0].message.includes("stale-year"), "stale ETR downgrades when latest is sane");
  ok(!ind.issues.some((i) => i.severity === "FAIL"), "stale-ETR case: zero FAILs anywhere");
}
{
  // Stale ETR does NOT apply when latest fails.
  const ind = runCalCase([
    calRow("FY2024", { rev: 200000, opInc: 55000, int: 5000, other: 0, pretax: 50000, tax: 10000, ni: 40000, debt: 40000, re: 90000 }),
    calRow("FY2025", { rev: 200000, opInc: 60000, int: 5000, other: 0, pretax: 50000, tax: 90000, ni: -34000, debt: 40000, re: 54000 }),
  ]);
  const etr = ind.issues.filter((i) => i.code === "STMT-01" && /effective tax rate|Stale ETR/i.test(i.message));
  ok(etr.some((i) => i.severity === "FAIL") && etr.every((i) => !i.message.includes("stale-year")), "latest ETR FAIL still blocks");
}

console.log("\n== 10. Engine parity (ACCT-01 EBT) + FCST-01 empty-projections ==");
function engineFacts(rows) {
  const profile = { ticker: "E", name: "Eng Co", sector: "X", industry: "Y", country: "US", currency: "USD", exchange: "N", exchangeTimezoneName: "", description: "x", website: "", employees: 1, officers: [] };
  const stockData = { currentPrice: 10, sharesOutstanding: 1000, marketCap: 10000 };
  return sealCanonicalFacts(buildCanonicalFacts({ profile, stockData, annualFinancials: rows }));
}
function engineEbt(rows) {
  return enforceAccountingIdentities(engineFacts(rows)).filter((i) => i.code === "EBT-CLOSURE");
}
{
  // MSFT pattern: engine agrees with validator (no EBT FAILs; FY26-type WARN ok).
  const out = engineEbt(msftRows);
  ok(!out.some((i) => i.severity === "FAIL"), "engine parity: MSFT pattern produces zero EBT FAILs");
}
{
  // Corrupted books: engine still FAILs (independence preserved).
  const out = engineEbt([calRow("FY2025", { rev: 100000, opInc: 20000, int: 1000, other: 0, pretax: 500000, tax: 20000, ni: 480000, debt: 80000 })]);
  ok(out.some((i) => i.severity === "FAIL"), "engine parity: corrupted books still FAIL EBT");
}
{
  // HCLTech miniature: doubly corroborated pretax → engine WARNs, no FAIL.
  const out = engineEbt([calRow("FY2025", { rev: 1000000, opInc: 330000, int: 3000, other: 0, pretax: 195000, tax: 45000, ni: 150000, ebit: 198000, debt: 80000 })]);
  ok(!out.some((i) => i.severity === "FAIL"), "engine parity: corroborated pretax produces zero EBT FAILs");
}
{
  // Stale: broken FY2024 + clean FY2025 → engine demotes old FAIL to WARN.
  const out = engineEbt([
    calRow("FY2024", { rev: 100000, opInc: 20000, int: 1000, other: 0, pretax: 50000, tax: 20000, ni: 30000, debt: 80000, re: 90000 }),
    calRow("FY2025", { rev: 100000, opInc: 25000, int: 1000, other: 0, pretax: 24000, tax: 5000, ni: 19000, debt: 80000, re: 107000 }),
  ]);
  ok(!out.some((i) => i.severity === "FAIL") && out.some((i) => i.severity === "WARN" && /stale-year/.test(i.detail)), "engine parity: stale EBT FAIL demotes to WARN");
}
{
  // Taint guard: opEst-tagged opInc with equal ebit value, tuned so the tainted ebit
  // WOULD falsely corroborate without the guard (expB exact, triple exact) while the
  // bridge genuinely fails → must land on synth-input, never "corroborated".
  const out = engineEbt([calRow("FY2025", { rev: 100000, opInc: 13000, int: 1000, other: -40000, pretax: 12000, tax: 2400, ni: 9600, ebit: 13000, debt: 80000, est: ["operatingIncome@13%-of-revenue"] })]);
  ok(out.length === 1 && out[0].severity === "WARN" && /synth-input/.test(out[0].detail) && !/corroborat/.test(out[0].detail), "engine parity: tainted ebit falls through to synth-input, not corroboration");
}
{
  // FCST-01: RI path (empty dcf projections) + attached canonical forecast → PASS (was FAIL).
  const qa = qaStub("bank", bankRows, "Financial Services", "Banks", "A commercial bank", "general", { allowFails: true, skipArch: true, attachForecast: true });
  const fcst = qa.checks.filter((c) => c.id === "FCST-01");
  ok(fcst.length === 1 && fcst[0].status === "PASS", "FCST-01: empty RI projections + canonical forecast → PASS (not a second forecast)");
}
{
  // FCST-01 control: genuine length mismatch (3 vs 5) still FAILs.
  const qa = qaStub("bank", bankRows, "Financial Services", "Banks", "A commercial bank", "general", { allowFails: true, skipArch: true, attachForecast: true, dcfProjectionsCount: 3 });
  const fcst = qa.checks.filter((c) => c.id === "FCST-01");
  ok(fcst.length === 1 && fcst[0].status === "FAIL", "FCST-01: genuine 3-vs-5 mismatch still FAILs");
}

console.log("\n== 11. Sector gate (Step 1) ==");
ok(Object.keys(SECTOR_ARCHITECTURES).length === 22, "registry covers all 22 sector profiles");
for (const [id, info] of Object.entries(SECTOR_ARCHITECTURES)) {
  ok(isSectorSupported(id) === info.implemented, `gate flag readable for '${id}' (${info.arch})`);
}
const blocked = unsupportedSectorPayload("insurance");
ok(blocked.status === "UNSUPPORTED_SECTOR" && blocked.architecture === "C" && blocked.message.includes("not yet supported"), "UNSUPPORTED_SECTOR payload shape correct (gate trips when a flag is off)");
ok(getArchitectureForSector("real-estate").arch === "D" && getArchitectureForSector("ratings-agency").arch === "E", "D/E routing correct");
ok(classifySector("Financial Services", "Banks - State-Run", "bank with CASA").id === "bank", "classifier still routes banks (Arch A untouched)");

console.log(`\n========================================\nRESULT: ${pass} passed, ${fail} failed\n========================================`);
process.exit(fail > 0 ? 1 : 0);
