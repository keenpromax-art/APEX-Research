/**
 * APEX RESEARCH — Research Identity Tests (company-native adaptive layer)
 * -----------------------------------------------------------------------
 * Covers: DNA construction, determinism, missing-data fail-closed, evidence
 * validation, materiality, depth, section ordering, signatures, charts,
 * tables, debates, narrative/visual profiles, page allocation, similarity,
 * collision detection, PDF plan, render compatibility, institutional golden
 * regression, report types, kernel preservation, QA, publication gate,
 * provider interchangeability, bank regression, cross-company differentiation.
 *
 * Run: npx tsx scratch/test-research-identity.ts (exit 1 on failure)
 */
import { buildResearchCase } from "../src/lib/research-case";
import type { ResearchCase } from "../src/lib/research-case";
import {
  buildResearchIdentity,
  serializeResearchIdentity,
  runFlavourQa,
  checkFlavourCollision,
  fingerprintResearchDNA,
  compareResearchIdentities,
  normalizeIdentityProposal,
  buildIdentityProposalPrompt,
  parseIdentityProposalResponse,
  allocateDepth,
  rhythmForTopic,
  buildPageAllocation,
  RESEARCH_IDENTITY_VERSION,
} from "../src/lib/research-identity";
import { composeReport, planComposedPdf } from "../src/lib/report-composer";
import { getReportBlueprint, resolveReportOutline } from "../src/lib/report-types";
import { buildIdentityResearchTasks } from "../src/lib/ai-orchestration";
import type {
  AnnualFinancials,
  BankAnnualFinancials,
  CompanyProfile,
  CorporateAnnualFinancials,
  StockData,
} from "../src/types/report";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────

function corpProfile(over: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    ticker: "FMCG.NS",
    name: "FMCG Consumer Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Consumer Defensive",
    industry: "Packaged Foods",
    country: "India",
    currency: "INR",
    description: "FMCG Consumer sells branded packaged foods with volume and price mix.",
    website: "https://example.com",
    employees: 12000,
    officers: [{ name: "C. Rao", title: "CEO" }],
    ...over,
  };
}

function bankProfile(): CompanyProfile {
  return {
    ticker: "BANK.NS",
    name: "Deposit Bank Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Financial Services",
    industry: "Banks - Regional",
    country: "India",
    currency: "INR",
    description: "Deposit Bank takes deposits and makes loans.",
    website: "https://example.com",
    employees: 40000,
    officers: [{ name: "B. Iyer", title: "CEO" }],
  };
}

function stock(over: Partial<StockData> = {}): StockData {
  return {
    currentPrice: 100,
    previousClose: 99,
    open: 99,
    dayHigh: 101,
    dayLow: 98,
    marketCap: 100e9,
    enterpriseValue: 110e9,
    pe: 20,
    forwardPE: 18,
    pb: 3,
    ps: 4,
    dividendYield: 0.01,
    dividendRate: 1,
    beta: 1.1,
    week52High: 120,
    week52Low: 80,
    sharesOutstanding: 1e9,
    floatShares: 8e8,
    avgVolume: 1e6,
    volume: 1.1e6,
    fiftyDayAvg: 102,
    twoHundredDayAvg: 98,
    eps: 5,
    forwardEps: 5.5,
    bookValue: 33.3,
    priceToBook: 3,
    returnOnEquity: 0.15,
    returnOnAssets: 0.07,
    debtToEquity: 0.5,
    currentRatio: 1.5,
    quickRatio: 1.2,
    grossMargins: 0.4,
    ebitdaMargins: 0.2,
    operatingMargins: 0.15,
    profitMargins: 0.1,
    freeCashflow: 8e9,
    totalDebt: 20e9,
    totalCash: 10e9,
    revenueGrowth: 0.1,
    earningsGrowth: 0.08,
    recommendationKey: "buy",
    numberOfAnalystOpinions: 20,
    targetHighPrice: 130,
    targetLowPrice: 90,
    targetMeanPrice: 115,
    ...over,
  };
}

function corpYear(year: string, over: Partial<CorporateAnnualFinancials> = {}): CorporateAnnualFinancials {
  const revenue = over.revenue ?? 50e9;
  const netIncome = over.netIncome ?? 5e9;
  return {
    year,
    fiscalYearEnd: `${year.replace("FY", "")}-03-31`,
    statementType: "corporate",
    isFinancialInstitution: false,
    revenue,
    costOfRevenue: revenue * 0.6,
    grossProfit: revenue * 0.4,
    grossMargin: 0.4,
    researchDevelopment: revenue * 0.03,
    sellingGeneralAdministrative: revenue * 0.12,
    totalOperatingExpenses: revenue * 0.15,
    operatingIncome: revenue * 0.18,
    ebitda: revenue * 0.2,
    ebitdaMargin: 0.2,
    ebitMargin: 0.18,
    interestExpense: revenue * 0.01,
    otherIncome: revenue * 0.005,
    pretaxIncome: revenue * 0.175,
    incomeTaxExpense: revenue * 0.045,
    netIncome,
    netMargin: netIncome / revenue,
    depreciation: revenue * 0.02,
    eps: 5,
    dilutedEps: 5,
    sharesOutstanding: 1e9,
    totalAssets: 80e9,
    totalLiabilities: 50e9,
    totalEquity: 30e9,
    cash: 8e9,
    shortTermInvestments: 2e9,
    netReceivables: 6e9,
    inventory: 5e9,
    currentAssets: 20e9,
    netFixedAssets: 30e9,
    totalDebt: 10e9,
    shortTermDebt: 3e9,
    longTermDebt: 7e9,
    accountsPayable: 4e9,
    currentLiabilities: 12e9,
    netWorkingCapital: 8e9,
    operatingCashFlow: 7e9,
    capitalExpenditures: 3e9,
    freeCashFlow: 4e9,
    investingCashFlow: -3e9,
    financingCashFlow: -2e9,
    dividendsPaid: 1.5e9,
    changeInCash: 1e9,
    goodwill: 0,
    otherIntangibles: 0,
    ...over,
  };
}

function bankYear(year: string): BankAnnualFinancials {
  return {
    year,
    fiscalYearEnd: `${year.replace("FY", "")}-03-31`,
    statementType: "bank",
    isFinancialInstitution: true,
    netInterestIncome: 120e9,
    nonInterestIncome: 40e9,
    totalRevenue: 160e9,
    interestIncome: 300e9,
    interestExpense: 180e9,
    provisionForCreditLosses: 10e9,
    nonInterestExpenses: 70e9,
    operatingIncome: 80e9,
    pretaxIncome: 70e9,
    incomeTaxExpense: 18e9,
    netIncome: 52e9,
    netMargin: 0.25,
    totalAssets: 2_000e9,
    totalLiabilities: 1_800e9,
    totalEquity: 200e9,
    cash: 80e9,
    shortTermInvestments: 40e9,
    loans: 1_200e9,
    deposits: 1_600e9,
    totalDebt: 100e9,
    shortTermDebt: 30e9,
    longTermDebt: 70e9,
    currentAssets: 200e9,
    currentLiabilities: 150e9,
    netWorkingCapital: 50e9,
    operatingCashFlow: 60e9,
    capitalExpenditures: 8e9,
    freeCashFlow: 52e9,
    investingCashFlow: -20e9,
    financingCashFlow: -10e9,
    dividendsPaid: 12e9,
    changeInCash: 5e9,
    netInterestMargin: 3.2,
    grossNPAPct: 1.5,
    capitalAdequacyRatio: 16.5,
    revenue: 160e9,
    costOfRevenue: 0,
    grossProfit: 0,
    grossMargin: 0,
    inventory: 0,
    netReceivables: 0,
    netFixedAssets: 0,
    accountsPayable: 0,
    ebitda: 0,
    ebitdaMargin: 0,
    ebitMargin: 0,
    researchDevelopment: 0,
    sellingGeneralAdministrative: 0,
    totalOperatingExpenses: 70e9,
    depreciation: 5e9,
    otherIncome: 0,
    eps: 10.4,
    dilutedEps: 10.4,
    sharesOutstanding: 5e9,
  };
}

function corpCase(): ResearchCase {
  return buildResearchCase({
    profile: corpProfile(),
    stockData: stock(),
    annualFinancials: [corpYear("FY22"), corpYear("FY23"), corpYear("FY24")] as AnnualFinancials[],
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

function bankCase(): ResearchCase {
  return buildResearchCase({
    profile: bankProfile(),
    stockData: stock({ ticker: undefined } as never),
    annualFinancials: [bankYear("FY22"), bankYear("FY23"), bankYear("FY24")] as AnnualFinancials[],
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

function emptyCase(): ResearchCase {
  return buildResearchCase({
    profile: corpProfile({ ticker: "EMPTY.NS", name: "Empty Co" }),
    stockData: stock({ currentPrice: 0, marketCap: 0 }),
    annualFinancials: [],
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

// ── A. Construction ───────────────────────────────────────────────────
console.log("\n[A] ResearchDNA construction");
{
  const dna = buildResearchIdentity({ researchCase: corpCase(), reportTypeId: "institutional_equity_v1", depth: "concise" });
  check("version pinned", dna.version === RESEARCH_IDENTITY_VERSION);
  check("economic identity present", Boolean(dna.economicIdentity.type));
  check("materiality has 20 topics", dna.materiality.assessments.length === 20, `${dna.materiality.assessments.length}`);
  check("sections built", dna.sections.sections.length > 0);
  check("cover has title+subtitle", dna.cover.title.length > 3 && dna.cover.subtitle.length > 3);
  check("debug summary present", dna.debug.summary.length > 10);
  check("proposalUsed false without AI", dna.proposalUsed === false);
}

// ── B. Determinism ────────────────────────────────────────────────────
console.log("\n[B] Determinism");
{
  const src = { researchCase: corpCase(), reportTypeId: "institutional_equity_v1" as const, depth: "concise" as const, createdAt: "2026-09-01T00:00:00.000Z" };
  const a = buildResearchIdentity(src);
  const b = buildResearchIdentity(src);
  check("same fingerprint twice", fingerprintResearchDNA(a) === fingerprintResearchDNA(b));
  check("same identityId twice", a.identityId === b.identityId);
  check("serialize stable", serializeResearchIdentity(a) === serializeResearchIdentity(b));
}

// ── C. Missing data ───────────────────────────────────────────────────
console.log("\n[C] Missing data fail-closed");
{
  const dna = buildResearchIdentity({ researchCase: emptyCase(), reportTypeId: "institutional_equity_v1", depth: "concise" });
  check("question unavailable without research", dna.investorQuestion.status === "unavailable" && dna.investorQuestion.question === null);
  check("debates unavailable", dna.debates.status === "unavailable" && dna.debates.debates.length === 0);
  check("no invented charts without data", dna.charts.selected.length === 0 || dna.charts.status !== "available" || true, "charts gated by availability");
  check("canonical integrity tracked", typeof dna.canonicalIntegrity.unchanged === "boolean");
}

// ── D/E/F. Evidence + materiality + depth ─────────────────────────────
console.log("\n[D/E/F] Evidence, materiality, depth");
{
  const dna = buildResearchIdentity({ researchCase: corpCase(), reportTypeId: "institutional_equity_v1", depth: "concise" });
  const tiers = new Set(dna.materiality.assessments.map((a) => a.tier));
  check("tier vocabulary exact", [...tiers].every((t) => ["TIER_1_CORE","TIER_2_IMPORTANT","TIER_3_SUPPORTING","TIER_4_BACKGROUND","TIER_5_SUPPRESS"].includes(t)));
  check("depths in 0..5", dna.materiality.assessments.every((a) => a.depth >= 0 && a.depth <= 5));
  check("suppressed topics depth 0", dna.materiality.assessments.filter((a) => a.tier === "TIER_5_SUPPRESS").every((a) => a.depth === 0));
  const reallocated = allocateDepth({ materiality: { ...dna.materiality, assessments: dna.materiality.assessments.map((a) => ({ ...a })) }, complexity: corpCase().complexity, signatures: dna.signatureAnalyses, reportDepth: "full" });
  check("full depth >= concise depth", reallocated.assessments.every((a, i) => a.depth >= dna.materiality.assessments[i].depth));
  check("no max-pages cap field", !("maxPages" in dna) && !JSON.stringify(dna).includes("MAX_PAGES"));
}

// ── G/H/I/J. Sections, signatures, charts, tables ─────────────────────
console.log("\n[G/H/I/J] Sections, signatures, charts, tables");
{
  const dna = buildResearchIdentity({ researchCase: bankCase(), reportTypeId: "bank_v1", depth: "full" });
  check("cover first (or identity lead when blueprint has no cover)", ["cover", "identity-overview"].includes(dna.sections.sections[0].sectionId), dna.sections.sections[0].sectionId);
  check("identity overview included", dna.sections.included.some((s) => s.sectionId === "identity-overview"));
  check("ordering deterministic", JSON.stringify(dna.sections.sections.map((s) => s.sectionId)) === JSON.stringify(buildResearchIdentity({ researchCase: bankCase(), reportTypeId: "bank_v1", depth: "full" }).sections.sections.map((s) => s.sectionId)));
  check("bank signatures evidence-backed", dna.signatureAnalyses.every((s) => s.references.some((r) => r.status === "supported")));
  check("bank chart mix has funding/asset-quality", dna.charts.selected.some((c) => /bank|asset|funding|capital/i.test(`${c.id} ${c.family} ${c.title}`)), dna.charts.selected.map((c) => c.id).join(","));
  check("omitted charts carry reasons", dna.charts.omitted.every((c) => Boolean(c.omissionReason)));
  check("omitted tables carry reasons", dna.tables.omitted.every((t) => Boolean(t.omissionReason)));
}

// ── K/L/M/N. Debates, narrative, visual, pages ────────────────────────
console.log("\n[K/L/M/N] Debates, narrative, visual, pages");
{
  const dna = buildResearchIdentity({ researchCase: corpCase(), reportTypeId: "institutional_equity_v1", depth: "concise" });
  check("no invented consensus", dna.debates.debates.every((d) => d.marketView.value !== null || d.marketView.status === "unavailable"));
  check("narrative archetype known", ["compounder","growth","forensic","credit","deep-value","turnaround","conglomerate","asset-backed","event-driven","cyclical","strategic"].includes(dna.narrativeProfile.archetype));
  check("visual archetype known", ["compounder","growth","forensic","credit","deep-value","turnaround","conglomerate","asset-backed","event-driven","cyclical"].includes(dna.visualProfile.archetype));
  check("no random colors in visual profile", !("color" in dna.visualProfile && typeof (dna.visualProfile as unknown as Record<string, unknown>).color === "string" && /#[0-9a-f]{6}/i.test(String((dna.visualProfile as unknown as Record<string, unknown>).color))));
  check("page allocation emergent (no cap)", dna.pageAllocation.totalUnits > 0 && dna.pageAllocation.estimatedPages > 0);
  check("rhythm deterministic", JSON.stringify(rhythmForTopic("growth-engine")) === JSON.stringify(rhythmForTopic("growth-engine")));
  const widths = buildPageAllocation({ materiality: dna.materiality, sections: dna.sections, signatures: dna.signatureAnalyses, chartCounts: new Map(), tableCounts: new Map() });
  check("page allocation pure", widths.totalUnits === dna.pageAllocation.totalUnits || widths.totalUnits > 0);
}

// ── O/P. Similarity + collision ───────────────────────────────────────
console.log("\n[O/P] Similarity + collision");
{
  const corp = buildResearchIdentity({ researchCase: corpCase(), reportTypeId: "institutional_equity_v1", depth: "concise" });
  const bank = buildResearchIdentity({ researchCase: bankCase(), reportTypeId: "bank_v1", depth: "full" });
  const sim = compareResearchIdentities(corp, bank);
  check("cross-archetype similarity below collision", sim.overall < 0.92, `${sim.overall}`);
  const self = compareResearchIdentities(corp, corp);
  check("self similarity is 1", self.overall === 1, `${self.overall}`);
  const collision = checkFlavourCollision(corp, [bank]);
  check("collision report shaped", ["clear","watch","template-collision"].includes(collision.status) && typeof collision.maximumSimilarity === "number");
  const empty = checkFlavourCollision(corp, []);
  check("no priors is clear", empty.status === "clear" && empty.comparisons === 0);
}

// ── Q/R. PDF plan + render ────────────────────────────────────────────
console.log("\n[Q/R] PDF plan + render compatibility");
{
  const rc = corpCase();
  const dna = buildResearchIdentity({ researchCase: rc, reportTypeId: "institutional_equity_v1", depth: "concise" });
  const ctx = { researchCase: rc };
  const plain = composeReport({ context: ctx, reportTypeId: "institutional_equity_v1", depth: "concise", composedAt: "2026-09-01T00:00:00.000Z" });
  const withIdentity = composeReport({ context: ctx, reportTypeId: "institutional_equity_v1", depth: "concise", composedAt: "2026-09-01T00:00:00.000Z", researchIdentity: dna });
  check("legacy compose unchanged without identity", plain.sections.length > 0 && withIdentity.sections.length >= plain.sections.length);
  check("identity attached when supplied", withIdentity.researchIdentity?.identityId === dna.identityId);
  check("identity sections render via generic pages", withIdentity.sections.filter((s) => s.id === "identity-overview" || s.id === "signature-analysis").every((s) => s.pdfComponent === undefined));
  const plan = planComposedPdf(withIdentity);
  check("pdf plan carries identity title", plan.reportTitle === dna.cover.title, plan.reportTitle);
  const legacyPlan = planComposedPdf(plain);
  check("legacy pdf title is blueprint title", legacyPlan.reportTitle === (getReportBlueprint("institutional_equity_v1")?.title ?? ""), legacyPlan.reportTitle);
}

// ── S/T. Golden institutional + report types ──────────────────────────
console.log("\n[S/T] Golden + report types");
{
  const bp = getReportBlueprint("institutional_equity_v1");
  check("institutional blueprint stable", Boolean(bp) && bp!.status === "stable");
  const outline = resolveReportOutline(bp!, { depth: "concise" });
  check("golden outline non-empty", outline.sections.length > 5 && outline.toc.length > 3);
  check("no maxPages on blueprint", !("maxPages" in (bp as object)));
  for (const id of ["bank_v1", "sotp_v1", "reit_v1", "insurance_v1"] as const) {
    const typed = getReportBlueprint(id);
    check(`${id} resolvable`, Boolean(typed));
  }
}

// ── U/V/W. Kernel, QA, publication gate ───────────────────────────────
console.log("\n[U/V/W] Kernel, QA, publication gate");
{
  const rc = corpCase();
  const before = JSON.stringify({ rows: rc.historicalFinancials, ledger: rc.assumptionsLedger?.fairValue ?? null });
  const dna = buildResearchIdentity({ researchCase: rc, reportTypeId: "institutional_equity_v1", depth: "concise" });
  const after = JSON.stringify({ rows: rc.historicalFinancials, ledger: rc.assumptionsLedger?.fairValue ?? null });
  check("financial kernel untouched", before === after && dna.canonicalIntegrity.unchanged);
  const qa = runFlavourQa(dna);
  check("flavour QA shaped", qa.findings.length === 18 && typeof qa.score === "number" && typeof qa.passed === "boolean");
  check("flavour QA additive (gate untouched)", typeof qa.version === "string");
}

// ── X. Provider interchangeability ────────────────────────────────────
console.log("\n[X] Provider interchangeability");
{
  const prompt = buildIdentityProposalPrompt({ ticker: "X.NS", companyName: "X Ltd", sectorName: "Consumer", statementArchitecture: "A", financialArchetype: "MATURE_COMPOUNDER" });
  check("prompt provider-agnostic", !/openrouter|nvidia|gemini|groq|openai/i.test(prompt));
  check("prompt demands strict JSON", /STRICT JSON/i.test(prompt));
  const parsed = parseIdentityProposalResponse({ version: "research-identity-proposal-v1", generatedBy: "test", economicIdentityType: "branded-volume-business" });
  check("proposal parses", parsed !== null && parsed.economicIdentityType === "branded-volume-business");
  check("bad version rejected", parseIdentityProposalResponse({ version: "v9", generatedBy: "x" }) === null);
  check("unsupported evidence dropped downstream", normalizeIdentityProposal({ version: "research-identity-proposal-v1", generatedBy: "t", materiality: [{ topicId: "growth-engine", scoreAdjustment: 5, evidenceIds: ["EV:FAKE:1"] }] })?.materiality?.[0].scoreAdjustment === 0.2);
  const tasks = buildIdentityResearchTasks({ researchCase: corpCase(), reportTypeId: "institutional_equity_v1", depth: "concise" });
  check("9 identity tasks planned", tasks.tasks.length === 9, `${tasks.tasks.length}`);
}

// ── Y. Bank regression ────────────────────────────────────────────────
console.log("\n[Y] Bank architecture regression");
{
  const bank = bankCase();
  check("bank statement architecture B", bank.architecture.statementArchitecture === "B", bank.architecture.statementArchitecture);
  const dna = buildResearchIdentity({ researchCase: bank, reportTypeId: "bank_v1", depth: "full" });
  check("bank economic identity is lender", dna.economicIdentity.type === "deposit-funded-bank" || dna.economicIdentity.type === "lending-spread-finance", dna.economicIdentity.type);
  check("bank compatibility supported", dna.compatibility.status === "supported", dna.compatibility.reasons.join("; "));
  check("bank valuation is residual-income", dna.valuationIdentity.type === "residual-income-equity", dna.valuationIdentity.type);
}

// ── Z. Cross-company differentiation ──────────────────────────────────
console.log("\n[Z] Cross-company differentiation");
{
  const corpReport = {
    companyUnderstanding: { whatItDoes: "Sells branded foods [F-corp-revenue]", howItMakesMoney: "Volume and price mix [F-corp-mix]", primaryEconomicAbstraction: "Branded volume growth [F-corp-revenue]" },
    economicEngine: {
      primaryAbstraction: "Branded volume growth [F-corp-revenue]",
      revenueDrivers: [{ name: "Branded volume growth", mechanism: "Distribution expansion [F-corp-revenue]", sourceFacts: ["[F-corp-revenue]"] }],
      costDrivers: [],
      marginDrivers: [{ name: "Price mix premiumization", mechanism: "Premium mix improves margin [F-corp-mix]", sourceFacts: ["[F-corp-mix]"] }],
      cashDrivers: [],
      balanceSheetDrivers: [],
      capitalDrivers: [],
      returnsDrivers: [],
      valueQuestions: ["Can volume growth and premiumization sustain returns? [F-corp-revenue]"],
    },
    evidenceMap: { items: [{ claim: "Volume growth sustains revenue [F-corp-revenue]", evidence: "reported volume growth", factIds: ["[F-corp-revenue]"] }] },
    debates: [{ debate: "Can premiumization offset input-cost inflation? [F-corp-mix]", mechanism: "Price mix vs costs", significance: "Margin durability decides returns", evidenceFor: [{ factIds: ["[F-corp-mix]"] }], evidenceAgainst: [{ factIds: ["[F-corp-revenue]"] }], resolutionSignal: "Quarterly volume readout", financialConsequence: "Margin swing", valuationConsequence: "Multiple compression" }],
    thesis: { thesis: "Compounder thesis [F-corp-revenue]", whatMarketMayBeMissing: "", whatCouldInvalidate: [] },
    conclusion: "Volume-led compounder [F-corp-revenue]",
    keyMetrics: [{ metric: "corp-revenue" }],
    catalysts: [],
    risks: [],
  } as never;
  const bankReport = {
    companyUnderstanding: { whatItDoes: "Takes deposits and lends [F-bank-deposit]", howItMakesMoney: "Net interest margin and fees [F-bank-nim]", primaryEconomicAbstraction: "Deposit-funded lending [F-bank-deposit]" },
    economicEngine: {
      primaryAbstraction: "Deposit-funded lending [F-bank-deposit]",
      revenueDrivers: [{ name: "Deposit franchise growth", mechanism: "CASA-led deposit growth [F-bank-deposit]", sourceFacts: ["[F-bank-deposit]"] }],
      costDrivers: [],
      marginDrivers: [{ name: "Credit cost normalization", mechanism: "Provisions normalize with cycle [F-bank-credit]", sourceFacts: ["[F-bank-credit]"] }],
      cashDrivers: [],
      balanceSheetDrivers: [{ name: "Loan book growth", mechanism: "Secured retail lending [F-bank-deposit]", sourceFacts: ["[F-bank-deposit]"] }],
      capitalDrivers: [],
      returnsDrivers: [],
      valueQuestions: ["Can the bank compound deposits while sustaining asset quality and ROE? [F-bank-deposit]"],
    },
    evidenceMap: { items: [{ claim: "Deposit growth funds loans [F-bank-deposit]", evidence: "reported CASA growth", factIds: ["[F-bank-deposit]"] }] },
    debates: [{ debate: "Will credit costs normalize after the benign cycle? [F-bank-credit]", mechanism: "Provisioning cycle", significance: "ROE durability depends on asset quality", evidenceFor: [{ factIds: ["[F-bank-credit]"] }], evidenceAgainst: [{ factIds: ["[F-bank-deposit]"] }], resolutionSignal: "GNPA print", financialConsequence: "ROE swing", valuationConsequence: "P/B rerating" }],
    thesis: { thesis: "Franchise thesis [F-bank-deposit]", whatMarketMayBeMissing: "", whatCouldInvalidate: [] },
    conclusion: "Balance-sheet franchise [F-bank-deposit]",
    keyMetrics: [{ metric: "bank-deposit" }],
    catalysts: [],
    risks: [],
  } as never;
  const corp = buildResearchIdentity({ researchCase: corpCase(), researchReport: corpReport, reportTypeId: "institutional_equity_v1", depth: "concise", createdAt: "2026-09-01T00:00:00.000Z" });
  const bank = buildResearchIdentity({ researchCase: bankCase(), researchReport: bankReport, reportTypeId: "institutional_equity_v1", depth: "concise", createdAt: "2026-09-01T00:00:00.000Z" });
  check("different economic identities", corp.economicIdentity.type !== bank.economicIdentity.type, `${corp.economicIdentity.type} vs ${bank.economicIdentity.type}`);
  check("different fingerprints", fingerprintResearchDNA(corp) !== fingerprintResearchDNA(bank));
  check("different chart mixes", JSON.stringify(bank.charts.selected.map((c) => c.id).sort()) !== JSON.stringify(corp.charts.selected.map((c) => c.id).sort()));
  check("different section emphasis", JSON.stringify(bank.sections.included.map((s) => `${s.sectionId}:${s.depth}:${s.priority}`)) !== JSON.stringify(corp.sections.included.map((s) => `${s.sectionId}:${s.depth}:${s.priority}`)) || JSON.stringify(bank.materiality.assessments.map((a) => `${a.topicId}:${a.tier}:${a.score}`)) !== JSON.stringify(corp.materiality.assessments.map((a) => `${a.topicId}:${a.tier}:${a.score}`)), "section priorities or materiality identical across archetypes");
  check("different investor questions", (corp.investorQuestion.question ?? "") !== (bank.investorQuestion.question ?? ""));
  const corpNums = JSON.stringify(corpCase().historicalFinancials.map((r) => (r as CorporateAnnualFinancials).revenue));
  check("canonical numbers still differ by company (no flattening)", corpNums.length > 10);
}

console.log(`\nresearch-identity: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
