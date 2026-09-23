/**
 * APEX RESEARCH — Report UI (Phase 9) Tests
 * -----------------------------------------
 * Selector helpers (stable-only options, fail-closed query parsing, query
 * building) + composition honouring the selected report type / depth
 * (re-compose contract used by ReportClient) + institutional regression
 * (pdfComponent gate unchanged for the golden type) + per-report-type
 * progress step labels (buildProgressSteps) + Phase B live plan derivation
 * (derivePlanProgressTasks over per-report ResearchTask graphs).
 *
 * Run: npx tsx scratch/test-report-ui.ts (exit 1 on failure)
 */
import {
  DEFAULT_RESEARCH_DEPTH,
  DEFAULT_REPORT_TYPE,
  buildReportQuery,
  getReportBlueprint,
  listReportBlueprints,
  parseDepthParam,
  parseReportTypeParam,
  reportTypeTitle,
  selectableReportTypes,
  type ReportTypeId,
} from "../src/lib/report-types";
import { composeReportFromData } from "../src/lib/report-composer";
import {
  buildProgressSteps,
  STEP_ORDER,
  DEFAULT_PROGRESS_TITLE,
} from "../src/components/ProgressTracker/steps";
import {
  buildResearchTasks,
  derivePlanProgressTasks,
  type CommitteeDecision,
  type RedTeamResult,
} from "../src/lib/ai-orchestration";
import { resolveReportOutline } from "../src/lib/report-types";
import type { AgentCheckpoint } from "../src/types/report";
import { buildResearchCase, type BuildResearchCaseParams } from "../src/lib/research-case";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import type {
  AnnualFinancials,
  CompanyProfile,
  CorporateAnnualFinancials,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
  ReportData,
  StockData,
} from "../src/types/report";

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const AS_OF = "2026-09-01T00:00:00.000Z";

// ── Minimal fixtures (same shape as test-advanced-blueprints) ──────────

function makeProfile(): CompanyProfile {
  return {
    ticker: "TEST.NS",
    name: "Test Industries Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Test Industries manufactures industrial machinery.",
    website: "https://example.com",
    employees: 5000,
    officers: [{ name: "A. Sharma", title: "CEO" }],
  };
}

function makeStock(): StockData {
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
  } as StockData;
}

function makeYear(year: string): CorporateAnnualFinancials {
  const revenue = 50e9;
  return {
    year,
    fiscalYearEnd: `${year.replace("FY", "")}-03-31`,
    statementType: "corporate",
    isFinancialInstitution: false,
    revenue,
    costOfRevenue: revenue * 0.6,
    grossProfit: revenue * 0.4,
    operatingIncome: revenue * 0.18,
    ebitda: revenue * 0.2,
    netIncome: 5e9,
    totalAssets: 80e9,
    totalLiabilities: 50e9,
    totalEquity: 30e9,
    cash: 8e9,
    totalDebt: 10e9,
    operatingCashFlow: 7e9,
    capitalExpenditures: 3e9,
    freeCashFlow: 4e9,
    sharesOutstanding: 1e9,
    eps: 5,
  } as CorporateAnnualFinancials;
}

function makeQuarters(): QuarterlyFinancials[] {
  return ["Q1FY2026", "Q2FY2026", "Q3FY2026", "Q4FY2026"].map((period, i) => ({
    period,
    revenue: 12e9 + i * 0.5e9,
    netIncome: 1.2e9 + i * 0.1e9,
    ebitda: 2.5e9 + i * 0.1e9,
    ebit: 2e9 + i * 0.1e9,
  })) as QuarterlyFinancials[];
}

function makePeers(n: number): PeerData[] {
  return Array.from({ length: n }, (_, i) => ({
    ticker: `PEER${i}.NS`,
    name: `Peer ${i}`,
    price: 50 + i,
    marketCap: 20e9 + i * 1e9,
    pe: 15 + i,
    pb: 2 + i * 0.1,
    evEbitda: 10 + i,
    roe: 0.1 + i * 0.01,
    revenueGrowth: 0.05 + i * 0.01,
    ebitdaMargin: 0.15,
  })) as PeerData[];
}

function makeDcf(): DCFResult {
  return {
    intrinsicValue: 120,
    fairValuePerShare: 120,
    enterpriseValue: 110e9,
    netDebt: 10e9,
    equityValue: 100e9,
    verdict: "BUY",
    assumptions: { wacc: 0.11, terminalGrowthRate: 0.04 },
    projections: [],
  } as unknown as DCFResult;
}

function baseParams(): BuildResearchCaseParams {
  const profile = makeProfile();
  const stockData = makeStock();
  const annualFinancials = [
    makeYear("FY2022"),
    makeYear("FY2023"),
    makeYear("FY2024"),
    makeYear("FY2025"),
    makeYear("FY2026"),
  ] as AnnualFinancials[];
  const valuation = makeDcf();
  return {
    profile,
    stockData,
    annualFinancials,
    quarterlyFinancials: makeQuarters(),
    peers: makePeers(4),
    valuation,
    assumptionsLedger: createAssumptionsLedger({
      profile,
      stockData,
      annualFinancials,
      dcf: valuation,
    }),
    createdAt: AS_OF,
    dataCutoff: AS_OF,
  };
}

function makeReportData(): ReportData {
  const params = baseParams();
  const researchCase = buildResearchCase(params);
  return {
    generatedAt: AS_OF,
    profile: params.profile,
    stockData: params.stockData,
    annualFinancials: params.annualFinancials,
    quarterlyFinancials: params.quarterlyFinancials,
    ratiosByYear: [],
    dupontByYear: [],
    dcf: params.valuation,
    researchCase,
    peers: params.peers,
    aiAnalysis: {} as ReportData["aiAnalysis"],
    shareholding: {} as ReportData["shareholding"],
  } as unknown as ReportData;
}

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("REPORT UI PHASE 9 TESTS");
console.log("=======================================================\n");

// ── 1. Selector options (stable only) ──────────────────────────────────
console.log("--- 1. selector options ---");
{
  const opts = selectableReportTypes();
  check("selectable count is 11 (institutional + 10 advanced)", opts.length === 11, `got ${opts.length}`);
  check(
    "no planned types offered",
    opts.every((o) => getReportBlueprint(o.id)?.status === "stable")
  );
  check(
    "planned ids never selectable",
    ["tearsheet_v1", "valuation_dossier_v1", "earnings_deep_dive_v1", "forensic_v1"].every(
      (id) => !opts.some((o) => o.id === id)
    )
  );
  check("ids unique", new Set(opts.map((o) => o.id)).size === opts.length);
  check(
    "institutional first (registry order)",
    opts[0]?.id === "institutional_equity_v1"
  );
  check(
    "every option has a non-empty title + description",
    opts.every((o) => o.title.length > 0 && o.description.length > 0)
  );
  check(
    "every option defaultDepth is concise or full",
    opts.every((o) => o.defaultDepth === "concise" || o.defaultDepth === "full")
  );
  check(
    "stable count matches registry stable filter",
    opts.length === listReportBlueprints().filter((b) => b.status === "stable").length
  );
}

// ── 2. Fail-closed query parsing ───────────────────────────────────────
console.log("\n--- 2. query parsing (fail-closed) ---");
{
  check("DEFAULT_REPORT_TYPE is institutional", DEFAULT_REPORT_TYPE === "institutional_equity_v1");
  check("DEFAULT_RESEARCH_DEPTH is concise", DEFAULT_RESEARCH_DEPTH === "concise");
  check("parse type undefined → institutional", parseReportTypeParam(undefined) === DEFAULT_REPORT_TYPE);
  check("parse type null → institutional", parseReportTypeParam(null) === DEFAULT_REPORT_TYPE);
  check("parse type garbage → institutional", parseReportTypeParam("not_a_type") === DEFAULT_REPORT_TYPE);
  check("parse type number → institutional", parseReportTypeParam(42) === DEFAULT_REPORT_TYPE);
  check("parse type empty → institutional", parseReportTypeParam("") === DEFAULT_REPORT_TYPE);
  check("parse type planned id → institutional", parseReportTypeParam("tearsheet_v1") === DEFAULT_REPORT_TYPE);
  check("parse type valid advanced passes", parseReportTypeParam("bank_v1") === "bank_v1");
  check("parse type valid institutional passes", parseReportTypeParam("institutional_equity_v1") === "institutional_equity_v1");
  check("parse depth undefined → concise", parseDepthParam(undefined) === "concise");
  check("parse depth concise → concise", parseDepthParam("concise") === "concise");
  check("parse depth full → full", parseDepthParam("full") === "full");
  check("parse depth garbage → concise", parseDepthParam("FULL") === "concise");
  check("parse depth number → concise", parseDepthParam(1) === "concise");
}

// ── 3. Query building + round-trip ─────────────────────────────────────
console.log("\n--- 3. query building ---");
{
  const q = buildReportQuery();
  check("default query includes type", q.includes("type=institutional_equity_v1"));
  check("default query includes depth", q.includes("depth=concise"));
  check("default query starts with ?", q.startsWith("?"));
  const q2 = buildReportQuery("industry_v1", "full");
  check("custom query type", q2.includes("type=industry_v1"));
  check("custom query depth", q2.includes("depth=full"));
  const parsed = new URLSearchParams(q2);
  check(
    "round-trip type",
    parseReportTypeParam(parsed.get("type")) === "industry_v1"
  );
  check("round-trip depth", parseDepthParam(parsed.get("depth")) === "full");
  check(
    "round-trip garbage query falls back",
    parseReportTypeParam("bogus") === "institutional_equity_v1" &&
      parseDepthParam("bogus") === "concise"
  );
  check(
    "reportTypeTitle institutional",
    reportTypeTitle("institutional_equity_v1") === "Institutional Equity Research"
  );
  check("reportTypeTitle bank", reportTypeTitle("bank_v1") === "Banking Sector Report");
}

// ── 4. Composition honours selection (re-compose contract) ─────────────
console.log("\n--- 4. compose with selected type + depth ---");
{
  const report = makeReportData();

  const defaultComposed = composeReportFromData(report, { composedAt: AS_OF });
  check("default compose is institutional", defaultComposed?.blueprintId === "institutional_equity_v1");
  check("default compose is concise", defaultComposed?.depth === "concise");

  const industryFull = composeReportFromData(report, {
    reportTypeId: "industry_v1",
    depth: "full",
    composedAt: AS_OF,
  });
  check("industry full compose blueprintId", industryFull?.blueprintId === "industry_v1");
  check("industry full compose depth full", industryFull?.depth === "full");
  check(
    "industry full includes full-only section",
    (industryFull?.sections.some((s) => s.id === "regulatory-outlook") ?? false)
  );
  check(
    "industry full sections differ from institutional",
    JSON.stringify(industryFull?.sections.map((s) => s.id)) !==
      JSON.stringify(defaultComposed?.sections.map((s) => s.id))
  );

  const industryConcise = composeReportFromData(report, {
    reportTypeId: "industry_v1",
    depth: "concise",
    composedAt: AS_OF,
  });
  check(
    "industry concise excludes full-only section",
    !(industryConcise?.sections.some((s) => s.id === "regulatory-outlook") ?? false)
  );

  // Re-compose in place (ReportClient selector change contract).
  const recomposed = composeReportFromData(report, {
    reportTypeId: "bank_v1",
    depth: "full",
    composedAt: AS_OF,
  });
  check("re-compose to bank full works", recomposed?.blueprintId === "bank_v1" && recomposed?.depth === "full");
  check(
    "bank full has both full-only sections",
    (recomposed?.sections.some((s) => s.id === "nim-sensitivity") ?? false) &&
      (recomposed?.sections.some((s) => s.id === "regulatory-capital") ?? false)
  );
  check(
    "re-compose deterministic",
    JSON.stringify(
      composeReportFromData(report, { reportTypeId: "bank_v1", depth: "full", composedAt: AS_OF })?.sections.map(
        (s) => s.id
      )
    ) === JSON.stringify(recomposed?.sections.map((s) => s.id))
  );
  check(
    "original report object not mutated by compose",
    report.composedReport === undefined || report.composedReport === null
  );

  // Institutional regression: composed sections still carry pdfComponent
  // (PDF composed-path gate unchanged by Phase 9).
  check(
    "institutional composed sections all carry pdfComponent",
    (defaultComposed?.sections.every((s) => typeof s.pdfComponent === "string" && s.pdfComponent.length > 0) ??
      false)
  );
  check(
    "institutional TOC titles unchanged with options",
    JSON.stringify(
      composeReportFromData(report, {
        reportTypeId: "institutional_equity_v1",
        depth: "full",
        composedAt: AS_OF,
      })?.toc.map((t) => t.title)
    ) === JSON.stringify(
      composeReportFromData(report, { depth: "full", composedAt: AS_OF })?.toc.map((t) => t.title)
    )
  );
}

// ── 5. Purity: selector module stays data-only ─────────────────────────
console.log("\n--- 5. purity ---");
{
  check(
    "selectable options carry no functions",
    selectableReportTypes().every((o) => Object.values(o).every((v) => typeof v !== "function"))
  );
  check(
    "buildReportQuery has no side-effect fields",
    !buildReportQuery("industry_v1", "full").match(/maxPages|pageCount/)
  );
}

// ── 6. Progress steps vary by report type ──────────────────────────────
console.log("\n--- 6. progress step labels per report type ---");
{
  const inst = buildProgressSteps("Institutional Equity Research");
  const sotp = buildProgressSteps("Sum-of-the-Parts Valuation");
  const industry = buildProgressSteps("Industry Research");
  const fallback = buildProgressSteps();
  const blank = buildProgressSteps("   ");

  check("5 steps in canonical order", inst.length === 5 && inst.every((s, i) => s.key === STEP_ORDER[i]));
  check("indices 01..05", inst.map((s) => s.index).join(",") === "01,02,03,04,05");
  check(
    "step 03 carries report title",
    sotp[2].label === "Structuring Sum-of-the-Parts Valuation" &&
      industry[2].label === "Structuring Industry Research"
  );
  check(
    "step 03 differs across report types",
    sotp[2].label !== industry[2].label && inst[2].label !== sotp[2].label
  );
  check(
    "step 04 carries report title",
    sotp[3].label === "Assembling Sum-of-the-Parts Valuation Dossier"
  );
  check(
    "step 05 carries report title",
    industry[4].label === "Industry Research Ready"
  );
  check(
    "shared steps 01-02 unchanged",
    inst[0].label === "Querying Yahoo Finance Market Data" &&
      inst[1].label === "Computing Financial Ratios & DCF Model"
  );
  check(
    "undefined title falls back to institutional",
    fallback[2].label === `Structuring ${DEFAULT_PROGRESS_TITLE}`
  );
  check("blank title falls back", blank[2].label === `Structuring ${DEFAULT_PROGRESS_TITLE}`);
  check(
    "no report-type copy leaks into shared step 01",
    sotp[0].label === inst[0].label
  );
}

// ── 7. Live plan display (Phase B: planner wiring) ─────────────────────
console.log("\n--- 7. live research task plan derivation ---");
{
  const params = baseParams();
  const researchCase = buildResearchCase(params);

  const instOutline = resolveReportOutline(getReportBlueprint("institutional_equity_v1")!, {
    depth: "concise",
  });
  const sotpOutline = resolveReportOutline(getReportBlueprint("sotp_v1")!, { depth: "full" });
  const instPlan = buildResearchTasks({
    researchCase,
    sections: instOutline.sections,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
  });
  const sotpPlan = buildResearchTasks({
    researchCase,
    sections: sotpOutline.sections,
    reportTypeId: "sotp_v1",
    depth: "full",
  });

  check(
    "task count = 1 plan + 2×sections + red-team + committee",
    instPlan.tasks.length === 1 + instOutline.sections.length * 2 + 2 &&
      sotpPlan.tasks.length === 1 + sotpOutline.sections.length * 2 + 2,
    `inst=${instPlan.tasks.length} sotp=${sotpPlan.tasks.length}`
  );

  const agentsPending: AgentCheckpoint[] = [
    { id: "strategist", name: "s", role: "r", status: "pending" },
    { id: "news", name: "n", role: "r", status: "pending" },
    { id: "moat", name: "m", role: "r", status: "pending" },
    { id: "forensic", name: "f", role: "r", status: "pending" },
    { id: "credit", name: "c", role: "r", status: "pending" },
    { id: "governance", name: "g", role: "r", status: "pending" },
    { id: "verifier", name: "v", role: "r", status: "pending" },
  ];
  const fakeRedTeam: RedTeamResult = {
    version: "research-orchestration-v1",
    findings: [],
    probesRun: [
      "blockers-propagate",
      "peers-suppressed",
      "missing-valuation",
      "task-graph-closure",
      "author-needs-checker",
      "debates-gate",
      "unknowns-not-invented",
    ],
    passed: true,
    llmUsed: false,
  };
  const fakeCommitteePassed: CommitteeDecision = {
    version: "research-orchestration-v1",
    seats: [],
    qualityReview: null,
    adjudication: null,
    councilAudit: null,
    redTeamFindings: [],
    passed: true,
    blockers: [],
    regenerate: [],
    decidedAt: AS_OF,
  };
  const fakeCommitteeFlagged: CommitteeDecision = {
    ...fakeCommitteePassed,
    passed: false,
    blockers: ["COUNCIL_STATUS_FLAGGED: sample"],
  };

  // Per-report-type structure differs (the core Phase B property).
  const sotpRows = derivePlanProgressTasks(sotpPlan, { phase: "generating", agentCheckpoints: agentsPending });
  const instRows = derivePlanProgressTasks(instPlan, { phase: "generating", agentCheckpoints: agentsPending });
  check(
    "sotp plan carries Segment Map author",
    sotpRows.some((t) => t.kind === "author" && t.name === "Author: Segment Map")
  );
  check(
    "institutional plan does NOT carry Segment Map",
    !instRows.some((t) => t.name.includes("Segment Map"))
  );
  check(
    "institutional plan carries Fundamental & Valuation author",
    instRows.some((t) => t.kind === "author" && t.name === "Author: Fundamental & Valuation Analysis")
  );
  check(
    "task id sets differ across report types",
    JSON.stringify(sotpRows.map((t) => t.id)) !== JSON.stringify(instRows.map((t) => t.id))
  );
  check(
    "every row has non-empty name + role",
    sotpRows.every((t) => t.name.length > 0 && t.role.length > 0)
  );
  check(
    "author rows tagged with kind",
    sotpRows.filter((t) => t.kind === "author").every((t) => t.role.endsWith("· author"))
  );

  // Planning phase: everything queued except nothing (red-team runs after build).
  const planningRows = derivePlanProgressTasks(instPlan, {
    phase: "planning",
    agentCheckpoints: agentsPending,
  });
  check(
    "planning: plan task pending",
    planningRows.find((t) => t.kind === "plan")?.status === "pending"
  );
  check(
    "planning: authors queued (pending, or blocked fail-closed)",
    planningRows
      .filter((t) => t.kind === "author")
      .every((t) => t.status === "pending" || t.status === "blocked")
  );

  // Generating: plan done; authors follow personas; checkers follow verifier.
  const genRows = derivePlanProgressTasks(instPlan, {
    phase: "generating",
    agentCheckpoints: agentsPending,
  });
  check(
    "generating: plan task complete with type note",
    genRows.find((t) => t.kind === "plan")?.status === "complete" &&
      (genRows.find((t) => t.kind === "plan")?.note ?? "").includes("institutional_equity_v1")
  );
  check(
    "generating: unblocked authors pending while agents pending",
    genRows
      .filter((t) => t.kind === "author" && t.status !== "blocked")
      .every((t) => t.status === "pending") &&
      genRows.some((t) => t.kind === "author" && t.status === "pending")
  );

  const strategistDone = agentsPending.map((a) =>
    a.id === "strategist" ? { ...a, status: "complete" as const } : a
  );
  const halfRows = derivePlanProgressTasks(instPlan, {
    phase: "generating",
    agentCheckpoints: strategistDone,
  });
  const strategistAuthors = halfRows.filter(
    (t) => t.kind === "author" && instPlan.tasks.find((p) => p.id === t.id)?.roleId === "council-strategist"
  );
  check(
    "strategist agent complete → strategist-authored sections done",
    strategistAuthors.length > 0 && strategistAuthors.every((t) => t.status === "complete")
  );
  check(
    "other personas still queued after strategist alone (pending/blocked, never complete)",
    halfRows
      .filter((t) => t.kind === "author")
      .filter((t) => !strategistAuthors.some((s) => s.id === t.id))
      .every((t) => t.status === "pending" || t.status === "blocked")
  );
  check(
    "checkers queued while verifier pending (pending/blocked, never complete)",
    halfRows
      .filter((t) => t.kind === "checker")
      .every((t) => t.status === "pending" || t.status === "blocked") &&
      halfRows.some((t) => t.kind === "checker" && t.status === "pending")
  );

  const verifierDone = agentsPending.map((a) =>
    a.id === "verifier" ? { ...a, status: "complete" as const } : a
  );
  const checkedRows = derivePlanProgressTasks(instPlan, {
    phase: "generating",
    agentCheckpoints: verifierDone,
    redTeam: fakeRedTeam,
    committee: fakeCommitteePassed,
  });
  check(
    "verifier complete → unblocked checker seats complete (blocked stay blocked)",
    checkedRows
      .filter((t) => t.kind === "checker" && t.status !== "blocked")
      .every((t) => t.status === "complete") &&
      checkedRows.some((t) => t.kind === "checker" && t.status === "complete")
  );
  check(
    "red-team result → red-team row complete with probes note",
    (() => {
      const rt = checkedRows.find((t) => t.kind === "red-team");
      return rt?.status === "complete" && (rt.note ?? "").includes("7 probes") && (rt.note ?? "").includes("no blockers");
    })()
  );
  check(
    "committee PASSED → committee row complete",
    checkedRows.find((t) => t.kind === "committee")?.status === "complete" &&
      checkedRows.find((t) => t.kind === "committee")?.note === "Committee PASSED"
  );

  const flaggedRows = derivePlanProgressTasks(instPlan, {
    phase: "generating",
    agentCheckpoints: verifierDone,
    redTeam: fakeRedTeam,
    committee: fakeCommitteeFlagged,
  });
  check(
    "committee flags → note carries flag count",
    flaggedRows.find((t) => t.kind === "committee")?.note === "Committee: 1 flag"
  );

  // Blocked authors stay blocked regardless of agent completion (fail-closed).
  const noCasePlan = buildResearchTasks({
    researchCase: null,
    sections: instOutline.sections,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
  });
  const allDone = agentsPending.map((a) => ({ ...a, status: "complete" as const }));
  const blockedRows = derivePlanProgressTasks(noCasePlan, {
    phase: "generating",
    agentCheckpoints: allDone,
  });
  const valuationBlocked = blockedRows.filter(
    (t) => t.kind === "author" && (t.note ?? "").includes("NO_VALUATION")
  );
  check(
    "blocked valuation author stays blocked when agents complete",
    valuationBlocked.length > 0 && valuationBlocked.every((t) => t.status === "blocked")
  );
  check(
    "verifier running → committee row verifying (gate not yet folded)",
    derivePlanProgressTasks(instPlan, {
      phase: "generating",
      agentCheckpoints: agentsPending.map((a) =>
        a.id === "verifier" ? { ...a, status: "running" as const } : a
      ),
    }).find((t) => t.kind === "committee")?.status === "verifying"
  );
}

console.log("\n=======================================================");
console.log(`REPORT UI PHASE 9: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
