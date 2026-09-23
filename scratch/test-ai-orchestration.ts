/**
 * APEX RESEARCH — AI Orchestration Phase 6 Tests
 * -----------------------------------------------
 *  1. Role catalog (council/team/quality/writer-checker references).
 *  2. Transport adapters (four shapes round-trip; no provider branching).
 *  3. Deterministic ResearchTask planner (graph, blockers, no page caps).
 *  4. Committee gate (reuses quality-review; council + red-team fold-in).
 *  5. Red-team probes (deterministic; optional mock LLM adversary).
 *
 * Run: npx tsx scratch/test-ai-orchestration.ts (exit 1 on failure)
 */
import {
  RESEARCH_ORCHESTRATION_VERSION,
  COUNCIL_PASS_THRESHOLD,
  WRITER_CHECKER_MAX_ATTEMPTS,
  RESEARCH_ROLES,
  listResearchRoles,
  getResearchRole,
  rolesBySource,
  isResearchRoleId,
  fromTeamTransport,
  toTeamTransport,
  fromFunctionTransport,
  toFunctionTransport,
  fromAiFirstTransport,
  toAiFirstTransport,
  type OrchestrationTransport,
  buildResearchTasks,
  runCommitteeReview,
  runRedTeam,
} from "../src/lib/ai-orchestration";
import { AGENT_TEAM_ROSTER, llmRoles } from "../src/lib/agent-team";
import { AI_AGENT_PERSONAS } from "../src/lib/openrouter";
import { QUALITY_REVIEWER_NAMES, runQualityReview } from "../src/lib/ai-first/quality-review";
import { buildResearchCase, type BuildResearchCaseParams } from "../src/lib/research-case";
import {
  getReportBlueprint,
  resolveReportOutline,
} from "../src/lib/report-types";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import { buildMasterReportFacts } from "../src/lib/report-facts";
import { computeRatios, computeDuPont } from "../src/lib/calculations";
import { verifyCanonicalSeal } from "../src/lib/canonical-facts";
import type {
  AnnualFinancials,
  BankAnnualFinancials,
  CorporateAnnualFinancials,
  CompanyProfile,
  CouncilVerificationAudit,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
  Ratios,
  DuPontAnalysis,
  StockData,
} from "../src/types/report";
import type { FactPack, ResearchReport } from "../src/lib/ai-first/types";

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
const PINNED = "2026-09-02T00:00:00.000Z";

// ── Fixtures (same shape as Phase 5 tests) ─────────────────────────────

function makeProfile(over: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    ticker: "TEST.NS",
    name: "Test Industries Ltd",
    exchange: "NSE",
    exchangeTimezoneName: "Asia/Kolkata",
    sector: "Industrials",
    industry: "Industrial Machinery",
    country: "India",
    currency: "INR",
    description: "Test Industries manufactures industrial machinery and equipment.",
    website: "https://example.com",
    employees: 5000,
    officers: [{ name: "A. Sharma", title: "CEO" }],
    ...over,
  };
}

function makeStock(over: Partial<StockData> = {}): StockData {
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
    ...over,
  } as StockData;
}

function makeCorporateYear(year: string): CorporateAnnualFinancials {
  return {
    year,
    revenue: 1000,
    costOfRevenue: 600,
    grossProfit: 400,
    operatingExpenses: 200,
    operatingIncome: 200,
    ebit: 200,
    ebitda: 280,
    netIncome: 120,
    totalAssets: 800,
    totalLiabilities: 400,
    totalEquity: 400,
    cash: 50,
    totalDebt: 150,
    freeCashFlow: 90,
    operatingCashFlow: 150,
    capitalExpenditures: 60,
    researchAndDevelopment: 20,
    depreciationAndAmortization: 80,
    interestExpense: 10,
    incomeTaxExpense: 30,
    sharesOutstanding: 1e9,
    eps: 0.12,
  } as CorporateAnnualFinancials;
}

function makeBankYear(year: string): BankAnnualFinancials {
  return {
    year,
    totalDeposits: 5000,
    grossAdvances: 4000,
    netAdvances: 3800,
    cashAndBankBalances: 400,
    investments: 800,
    totalAssets: 6000,
    totalLiabilities: 5400,
    totalEquity: 600,
    netInterestIncome: 300,
    netInterestMargin: 3.2,
    otherIncome: 80,
    operatingProfit: 220,
    provisions: 40,
    netIncome: 140,
    capitalAdequacyRatio: 16,
    grossNpa: 2.1,
    netNpa: 0.8,
    eps: 18,
    sharesOutstanding: 1e9,
    bookValuePerShare: 60,
    interestExpense: 120,
    depreciationAndAmortization: 20,
    freeCashFlow: null,
    operatingCashFlow: null,
    capitalExpenditures: null,
    totalDebt: 0,
    totalCash: 400,
    ...({
      year,
      revenue: 380,
      netIncome: 140,
      totalEquity: 600,
      totalAssets: 6000,
      cash: 400,
    } as Partial<BankAnnualFinancials>),
  } as BankAnnualFinancials;
}

function makeQuarters(): QuarterlyFinancials[] {
  return ["Q1FY2026", "Q2FY2026", "Q3FY2026", "Q4FY2026"].map((period, i) => ({
    period,
    revenue: 250 + i * 10,
    netIncome: 30 + i * 2,
    ebitda: 70 + i * 3,
    ebit: 50 + i * 2,
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

function makeRatios(): Ratios {
  return {
    grossMargin: 0.4,
    operatingMargin: 0.2,
    netMargin: 0.12,
    roe: 0.15,
    roa: 0.07,
    debtToEquity: 0.4,
    currentRatio: 1.5,
    quickRatio: 1.2,
    assetTurnover: 1.1,
    inventoryTurnover: 6,
    receivablesTurnover: 8,
    payablesTurnover: 7,
    interestCoverage: 12,
    evEbitda: 12,
    peRatio: 20,
    pbRatio: 3,
    priceToSales: 4,
    pegRatio: 1.2,
    freeCashFlowYield: 0.03,
    dividendYield: 0.01,
    payoutRatio: 0.3,
    operatingCashFlowToNetIncome: 1.2,
    capexToOperatingCashFlow: 0.4,
    roic: 0.14,
    roce: 0.16,
    workingCapitalDays: 45,
    cashConversionCycle: 52,
  } as unknown as Ratios;
}

function makeDuPont(): DuPontAnalysis {
  return {
    netProfitMargin: 0.12,
    assetTurnover: 1.1,
    equityMultiplier: 1.8,
    roe: 0.24,
    taxBurden: 0.75,
    interestBurden: 0.9,
    operatingMargin: 0.2,
  } as unknown as DuPontAnalysis;
}

function baseParams(over: Partial<BuildResearchCaseParams> = {}): BuildResearchCaseParams {
  const profile = over.profile ?? makeProfile();
  const stockData = over.stockData ?? makeStock();
  const annualFinancials =
    over.annualFinancials !== undefined
      ? over.annualFinancials
      : ([
          makeCorporateYear("FY2022"),
          makeCorporateYear("FY2023"),
          makeCorporateYear("FY2024"),
          makeCorporateYear("FY2025"),
          makeCorporateYear("FY2026"),
        ] as AnnualFinancials[]);
  const valuation = over.valuation !== undefined ? over.valuation : makeDcf();
  const base: BuildResearchCaseParams = {
    profile,
    stockData,
    annualFinancials,
    quarterlyFinancials: makeQuarters(),
    peers: makePeers(4),
    valuation,
    createdAt: AS_OF,
    dataCutoff: AS_OF,
  };
  // Derive ledger only when valuation is present (mirrors builder rules).
  if (over.assumptionsLedger !== undefined) {
    base.assumptionsLedger = over.assumptionsLedger;
  } else if (valuation) {
    base.assumptionsLedger = createAssumptionsLedger({
      profile,
      stockData,
      annualFinancials: annualFinancials as AnnualFinancials[],
      dcf: valuation,
    });
  }
  return { ...base, ...over, assumptionsLedger: base.assumptionsLedger };
}

function minimalReport(): ResearchReport {
  return {
    researchRunId: "run-1",
    companyTicker: "TEST.NS",
    modelVersion: "m1",
    promptVersion: "p1",
    factPackVersion: "f1",
    generationTimestamp: AS_OF,
    forecastVersion: "fv1",
    valuationVersion: "vv1",
    reviewVersion: "rv1",
    companyUnderstanding: {
      ticker: "TEST.NS",
      companyName: "Test Industries Ltd",
      whatItDoes: "Makes industrial machinery.",
      howItMakesMoney: "Equipment sales and spares.",
      businessSegments: [],
      economicUnits: ["equipment"],
      primaryEconomicAbstraction: "revenue growth",
      revenueDrivers: [],
      costDrivers: [],
      marginDrivers: [],
      cashGenerationDrivers: [],
      balanceSheetDrivers: [],
      returnsDrivers: [],
      keyKpis: [],
      metricsToAvoid: [],
      statementsThatMatterMost: ["income", "balance"],
      industryContext: "Fragmented market.",
      appropriateValuationMethods: [],
      confidence: { overall: 0.7, dataQuality: "B", reasoning: "Fixture." },
    } as ResearchReport["companyUnderstanding"],
    businessModel: "Equipment + spares",
    industryContext: "Fragmented market.",
    historicalAnalysis: "Steady growth.",
    keyMetrics: [],
    operatingModel: { formulas: [], variables: [] },
    forecast: {} as ResearchReport["forecast"],
    valuation: {} as ResearchReport["valuation"],
    scenarios: [],
    thesis: {
      thesis: "Fixture thesis for Phase 6 committee tests.",
      bullCase: ["Growth"],
      bearCase: ["Slowdown"],
      keyDebate: "",
      keyInflectionPoints: [],
      whatMarketMayBeMissing: "",
      whatCouldInvalidate: [],
    },
    catalysts: [],
    risks: [],
    competitiveAnalysis: { competitors: [] },
    moat: { hasMoat: false, sources: [], verdict: "None evidenced." },
    managementAnalysis: "Fixture.",
    capitalAllocation: "Fixture.",
    financialQuality: "Fixture.",
    sensitivity: [],
    reverseValuation: null,
    conclusion: "Fixture.",
    reviews: [],
    reviewPassed: false,
    regenerationLog: [],
  };
}

function section(name: string): FactPack["company"] {
  return { name, facts: [] };
}

function minimalFactPack(): FactPack {
  return {
    ticker: "TEST.NS",
    company: section("company"),
    market: section("market"),
    incomeStatement: section("incomeStatement"),
    balanceSheet: section("balanceSheet"),
    cashFlow: section("cashFlow"),
    shares: section("shares"),
    earnings: section("earnings"),
    estimates: section("estimates"),
    corporateActions: section("corporateActions"),
    priceHistory: section("priceHistory"),
    holders: section("holders"),
    retrievalTimestamp: AS_OF,
    version: "test-fact-pack-v1",
  };
}

function institutionalSections(depth: "concise" | "full" = "concise") {
  const bp = getReportBlueprint("institutional_equity_v1");
  if (!bp) throw new Error("missing blueprint");
  return resolveReportOutline(bp, { depth }).sections;
}

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("AI ORCHESTRATION PHASE 6 TESTS");
async function main() {
console.log("=======================================================\n");

// ── 1. Role catalog ────────────────────────────────────────────────────
console.log("--- 1. Role catalog (references existing rosters) ---");
{
  check("version constant", RESEARCH_ORCHESTRATION_VERSION === "research-orchestration-v1");
  check("council pass threshold mirror", COUNCIL_PASS_THRESHOLD === 70);
  check("writer-checker attempts re-export", WRITER_CHECKER_MAX_ATTEMPTS === 2);

  const council = rolesBySource("council");
  const team = rolesBySource("agent-team");
  const quality = rolesBySource("quality-review");
  const wc = rolesBySource("writer-checker");
  const orch = rolesBySource("orchestration");

  check("council seats = AI_AGENT_PERSONAS.length", council.length === AI_AGENT_PERSONAS.length,
    `${council.length} vs ${AI_AGENT_PERSONAS.length}`);
  check("team seats = AGENT_TEAM_ROSTER.length", team.length === AGENT_TEAM_ROSTER.length,
    `${team.length} vs ${AGENT_TEAM_ROSTER.length}`);
  check("quality seats = QUALITY_REVIEWER_NAMES.length", quality.length === QUALITY_REVIEWER_NAMES.length,
    `${quality.length} vs ${QUALITY_REVIEWER_NAMES.length}`);
  check("quality names include Research Judge", QUALITY_REVIEWER_NAMES.includes("Research Judge"));
  check("writer-checker has 4 seats", wc.length === 4);
  check("orchestration has red-team seat", orch.length === 1 && orch[0].id === "orch-red-team");

  const expectedTotal =
    AI_AGENT_PERSONAS.length + AGENT_TEAM_ROSTER.length + QUALITY_REVIEWER_NAMES.length + 4 + 1;
  check("catalog total matches composition", RESEARCH_ROLES.length === expectedTotal,
    `${RESEARCH_ROLES.length} vs ${expectedTotal}`);

  const ids = RESEARCH_ROLES.map((r) => r.id);
  check("role ids unique", new Set(ids).size === ids.length);

  // Every agent-team id resolves; LLM team roles preserved.
  check(
    "all agent-team ids resolve",
    AGENT_TEAM_ROSTER.every((r) => isResearchRoleId(r.id))
  );
  check(
    "llmRoles count preserved in catalog",
    llmRoles().every((r) => getResearchRole(r.id)?.needsLlm === true)
  );

  // Council persona names/roles match source by reference content.
  check(
    "council name+role match AI_AGENT_PERSONAS",
    AI_AGENT_PERSONAS.every((p, i) => {
      const role = council[i];
      return role?.id === `council-${p.id}` && role.name === p.name && role.role === p.role;
    })
  );

  // Quality seat ids are slugs of exported names.
  check(
    "quality seat ids slugify names",
    QUALITY_REVIEWER_NAMES.every((n) => {
      const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return isResearchRoleId(`qr-${slug}`);
    })
  );

  // list is a defensive copy (mutating it cannot corrupt the catalog).
  const copy = listResearchRoles();
  copy.pop();
  check("listResearchRoles returns a copy", listResearchRoles().length === RESEARCH_ROLES.length);

  check("getResearchRole missing → null", getResearchRole("nope") === null);
  check("isResearchRoleId false for unknown", !isResearchRoleId("nope"));
}

// ── 2. Transport adapters ──────────────────────────────────────────────
console.log("\n--- 2. Transport adapters (four shapes) ---");
{
  // Mock TeamTransport (object-arg).
  const teamCalls: Array<{ system: string; roleId?: string }> = [];
  const team = {
    async complete(prompt: { system: string; user: string }, opts?: { tier?: string; roleId?: string }) {
      teamCalls.push({ system: prompt.system, roleId: opts?.roleId });
      return `team:${opts?.roleId ?? "?"}`;
    },
  };

  // Mock Planner/Pipeline function transport.
  let fnMode: "planner" | "ai-first" = "planner";
  const fnTransport = async (opts: { system: string; user: string; jsonMode?: boolean }) =>
    fnMode === "planner"
      ? `planner:${opts.jsonMode ? "json" : "text"}`
      : `pipeline:${opts.system.length}`;

  // Mock AiFirstTransport (two-string).
  const aiFirst = {
    async complete(system: string, user: string) {
      return `ai-first:${system.slice(0, 4)}`;
    },
  };

  const viaTeam = fromTeamTransport(team);
  const r1 = await viaTeam.complete({ system: "S", user: "U", roleId: "a-thesis", tier: "standard" });
  check("fromTeamTransport maps roleId", r1 === "team:a-thesis" && teamCalls[0]?.roleId === "a-thesis");

  const backToTeam = toTeamTransport(viaTeam);
  const r2 = await backToTeam.complete({ system: "S2", user: "U2" }, { tier: "lite", roleId: "c-numbers" });
  check("toTeamTransport round-trips opts", r2 === "team:c-numbers");

  const viaFn = fromFunctionTransport(fnTransport);
  const r3 = await viaFn.complete({ system: "S", user: "U", jsonMode: true });
  check("fromFunctionTransport (planner shape)", r3 === "planner:json");

  const asPlanner = toFunctionTransport(viaFn);
  const r4 = await asPlanner({ system: "Sys", user: "Usr" });
  check("toFunctionTransport (planner shape)", r4 === "planner:text");

  const viaAi = fromAiFirstTransport(aiFirst);
  const r5 = await viaAi.complete({ system: "Hello world system", user: "U" });
  check("fromAiFirstTransport maps two-string", r5 === "ai-first:Hell");

  const asAi = toAiFirstTransport({
    async complete(call) {
      return `orch:${call.roleId ?? "none"}`;
    },
  });
  const r6 = await asAi.complete("Sys", "Usr");
  check("toAiFirstTransport maps method shape", r6 === "orch:none");

  // Same orchestration call through every adapter shape returns the mock payload
  // (proves interchangeability without provider branching).
  const payload = "unified-payload";
  const shapes: OrchestrationTransport[] = [
    fromTeamTransport({ async complete() { return payload; } }),
    fromFunctionTransport(async () => payload),
    fromAiFirstTransport({ async complete() { return payload; } }),
  ];
  const results = await Promise.all(
    shapes.map((t) => t.complete({ system: "a", user: "b", roleId: "x", tier: "lite" }))
  );
  check("all three adapter shapes return identical payload", results.every((r) => r === payload));

  // Red-team transport integration uses complete(call) only.
  const llmTransport: OrchestrationTransport = {
    async complete(call) {
      if (call.roleId !== "orch-red-team") throw new Error("unexpected roleId");
      return JSON.stringify({
        findings: [
          {
            severity: "major",
            component: "thesis",
            finding: "Uncited forward claim in excerpt.",
            recommendation: "Cite a fact id or drop the claim.",
          },
        ],
      });
    },
  };
  const rtLlm = await runRedTeam({ transport: llmTransport, thesisExcerpt: "Will grow 20% forever." });
  check("LLM adversary merges findings", rtLlm.llmUsed && rtLlm.findings.some((f) => f.probe === "llm-adversary"));
  check("LLM adversary major does not fail passed (no blocker)", rtLlm.passed === true);

  const rtFail = await runRedTeam({
    transport: {
      async complete() {
        throw new Error("provider down");
      },
    },
  });
  check("LLM transport failure → deterministic probes still stand", !rtFail.llmUsed && rtFail.probesRun.includes("task-graph-closure"));
}

// ── 3. Deterministic planner ───────────────────────────────────────────
console.log("\n--- 3. ResearchTask planner ---");
const caseFull = buildResearchCase(baseParams());
const sectionsConcise = institutionalSections("concise");
const plan = buildResearchTasks({
  researchCase: caseFull,
  sections: sectionsConcise,
  reportTypeId: "institutional_equity_v1",
  depth: "concise",
  plannedAt: PINNED,
});
{
  check("plan version", plan.version === RESEARCH_ORCHESTRATION_VERSION);
  check("plan caseId from research case", plan.caseId === caseFull.caseId);
  check("plan plannedAt injectable", plan.plannedAt === PINNED);
  check("plan depth concise", plan.depth === "concise");

  const ids = plan.tasks.map((t) => t.id);
  check("task ids unique", new Set(ids).size === ids.length);

  const idSet = new Set(ids);
  check(
    "dependsOn closed over task ids",
    plan.tasks.every((t) => t.dependsOn.every((d) => idSet.has(d)))
  );

  // Acyclic: every edge points from higher topological layer — authors after plan,
  // checkers after authors, red-team after leaves, committee after red-team.
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  check("plan task has no deps", byId.get("T-plan")?.dependsOn.length === 0);
  check("red-team depends on author/check leaves", (byId.get("T-red-team")?.dependsOn.length ?? 0) > 0);
  check("committee depends on red-team only", 
    byId.get("T-committee")?.dependsOn.length === 1 && byId.get("T-committee")?.dependsOn[0] === "T-red-team");

  // Topological validation via DFS cycle detect.
  const visiting = new Set<string>();
  const seen = new Set<string>();
  let cyclic = false;
  function dfs(id: string): void {
    if (visiting.has(id)) { cyclic = true; return; }
    if (seen.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) dfs(dep);
    visiting.delete(id);
    seen.add(id);
  }
  for (const t of plan.tasks) dfs(t.id);
  check("task graph acyclic", !cyclic);

  const authors = plan.tasks.filter((t) => t.kind === "author");
  const checkers = plan.tasks.filter((t) => t.kind === "checker");
  check("one author per concise section", authors.length === sectionsConcise.length,
    `${authors.length} vs ${sectionsConcise.length}`);
  check("one checker per author", checkers.length === authors.length);
  check("every author has downstream checker",
    authors.every((a) => checkers.some((c) => c.dependsOn.includes(a.id))));

  check("authors use WRITER_CHECKER_MAX_ATTEMPTS",
    authors.every((a) => a.maxAttempts === WRITER_CHECKER_MAX_ATTEMPTS));
  check("authors need LLM, planners/checkers/red-team/committee do not (structural)",
    authors.every((a) => a.needsLlm) &&
      byId.get("T-plan")?.needsLlm === false &&
      byId.get("T-red-team")?.needsLlm === false &&
      byId.get("T-committee")?.needsLlm === false);

  // Role ids resolve in catalog.
  check("all plan roleIds resolve",
    plan.roleIds.every((id) => isResearchRoleId(id)));

  // Primary council routing: valuation sections → strategist; moat → moat.
  const valuationAuthor = authors.find((a) => a.moduleId === "valuation" || (a.sectionId ?? "").includes("fundamental"));
  check("valuation-adjacent author routes to strategist or credit/forensic at worst",
    valuationAuthor != null && valuationAuthor.roleId.startsWith("council-"),
    valuationAuthor?.roleId);
  const moatAuthor = authors.find((a) => a.sectionId === "moat-price-fair-value");
  check("moat section routes to council-moat", moatAuthor?.roleId === "council-moat", moatAuthor?.roleId);

  // No page caps / no company conclusions in plan metadata.
  const blob = JSON.stringify(plan);
  check("plan has no maxPages/page cap field", !/"maxPages"|"pageCap"|"targetPages"/i.test(blob));
  check("plan does not hardcode a rating conclusion", !/\b(SELL|BUY|HOLD)\b/.test(blob));

  // Determinism: same inputs → identical plan (minus wall-clock if not pinned).
  const plan2 = buildResearchTasks({
    researchCase: caseFull,
    sections: sectionsConcise,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
    plannedAt: PINNED,
  });
  check("planner deterministic (pinned)", JSON.stringify(plan) === JSON.stringify(plan2));

  // Full depth has more authors than concise.
  const planFull = buildResearchTasks({
    researchCase: caseFull,
    sections: institutionalSections("full"),
    reportTypeId: "institutional_equity_v1",
    depth: "full",
    plannedAt: PINNED,
  });
  check("full depth produces more author tasks than concise",
    planFull.tasks.filter((t) => t.kind === "author").length > authors.length);

  // Missing case → explicit blocker, still a closed graph.
  const planNoCase = buildResearchTasks({
    researchCase: null,
    sections: sectionsConcise,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
    plannedAt: PINNED,
  });
  check("missing case → NO_RESEARCH_CASE blocker",
    planNoCase.blockers.includes("NO_RESEARCH_CASE") && planNoCase.caseId === null);

  // Missing valuation availability blocks valuation authors.
  const caseNoVal = buildResearchCase(
    baseParams({ valuation: null, assumptionsLedger: null })
  );
  const planNoVal = buildResearchTasks({
    researchCase: caseNoVal,
    sections: sectionsConcise,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
    plannedAt: PINNED,
  });
  const valAuthors = planNoVal.tasks.filter(
    (t) => t.kind === "author" && t.moduleId === "valuation"
  );
  // valuation module may not be primary on first module of a section — check via section modules
  const valSectionIds = sectionsConcise
    .filter((s) => s.modules.includes("valuation"))
    .map((s) => s.id);
  const blockedValAuthors = planNoVal.tasks.filter(
    (t) => t.kind === "author" && t.sectionId && valSectionIds.includes(t.sectionId)
  );
  check(
    "NO_VALUATION case → valuation-linked authors blocked",
    blockedValAuthors.length > 0 &&
      blockedValAuthors.every(
        (t) => t.status === "blocked" && t.blockers.includes("NO_VALUATION")
      ),
    JSON.stringify({ valAuthors: valAuthors.length, blocked: blockedValAuthors.map((t) => t.id) })
  );

  // Bank case: still plans (sector architecture preserved upstream).
  const bankCase = buildResearchCase(
    baseParams({
      profile: makeProfile({
        sector: "Financial Services",
        industry: "Banks - Regional",
        description: "Regional bank accepting deposits and making loans.",
      }),
      annualFinancials: [
        makeBankYear("FY2022"),
        makeBankYear("FY2023"),
        makeBankYear("FY2024"),
        makeBankYear("FY2025"),
        makeBankYear("FY2026"),
      ],
    })
  );
  const bankPlan = buildResearchTasks({
    researchCase: bankCase,
    sections: sectionsConcise,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
    plannedAt: PINNED,
  });
  check("bank case plans with committee terminal node",
    bankPlan.tasks.some((t) => t.id === "T-committee"));
}

// ── 4. Committee gate ──────────────────────────────────────────────────
console.log("\n--- 4. Committee gate ---");
{
  // Injected clean quality review (no report needed for adjudication-null path).
  const cleanReview = {
    allFindings: [],
    perReviewer: {},
    passed: true,
    overallScore: 100,
    regenerationCandidates: [],
  } as unknown as ReturnType<typeof runQualityReview>;

  const clean = runCommitteeReview({
    qualityReview: cleanReview,
    decidedAt: PINNED,
  });
  check("clean review → passed", clean.passed && clean.blockers.length === 0);
  check("default seats = quality reviewer count",
    clean.seats.length === QUALITY_REVIEWER_NAMES.length);
  check("seat roles resolve in catalog",
    clean.seats.every((s) => isResearchRoleId(s.roleId)));
  check("decidedAt injectable", clean.decidedAt === PINNED);
  check("version on decision", clean.version === RESEARCH_ORCHESTRATION_VERSION);

  // QA blocker folds in.
  const blockedReview = {
    allFindings: [
      {
        reviewer: "Financial Analyst",
        severity: "blocker",
        component: "forecast",
        finding: "Net margin > 100%.",
        recommendation: "Regenerate forecast.",
      },
    ],
    perReviewer: { "Financial Analyst": [] },
    passed: false,
    overallScore: 40,
    regenerationCandidates: ["forecast"],
  } as unknown as ReturnType<typeof runQualityReview>;
  const blocked = runCommitteeReview({ qualityReview: blockedReview, decidedAt: PINNED });
  check("QA blocker → not passed", !blocked.passed);
  check("blocker text includes QA_BLOCKER",
    blocked.blockers.some((b) => b.startsWith("QA_BLOCKER:")));

  // Runs real quality review when report+pack supplied (references existing engine).
  const report = minimalReport();
  const pack = minimalFactPack();
  const withRun = runCommitteeReview({ report, pack, decidedAt: PINNED });
  check("committee runs runQualityReview when report+pack given",
    withRun.qualityReview != null && typeof withRun.qualityReview.overallScore === "number");
  check("adjudication attached when report present", withRun.adjudication != null);

  // Council audit fold-in.
  const goodAudit: CouncilVerificationAudit = {
    status: "VERIFIED",
    integrityScore: 92,
    summary: "All checks pass.",
    checks: [
      { name: "Valuation vs DCF", category: "VALUATION", status: "PASS", observation: "ok" },
    ],
    correctionsApplied: [],
    verificationTimestamp: AS_OF,
    auditorSignature: "fixture",
  };
  const badAudit: CouncilVerificationAudit = {
    ...goodAudit,
    status: "FLAGGED",
    integrityScore: 55,
    checks: [
      { name: "Upside vs DCF", category: "VALUATION", status: "FLAG", observation: "mismatch" },
    ],
  };
  const withGoodAudit = runCommitteeReview({
    qualityReview: cleanReview,
    councilAudit: goodAudit,
    decidedAt: PINNED,
  });
  check("healthy council audit keeps passed", withGoodAudit.passed);

  const withBadAudit = runCommitteeReview({
    qualityReview: cleanReview,
    councilAudit: badAudit,
    decidedAt: PINNED,
  });
  check("flagged/low council audit blocks", !withBadAudit.passed);
  check("council blockers include score threshold",
    withBadAudit.blockers.some((b) => b.startsWith("COUNCIL_SCORE_BELOW_THRESHOLD")));
  check("council blockers include FLAG checks",
    withBadAudit.blockers.some((b) => b.startsWith("COUNCIL_CHECKS_FLAGGED")));

  // Red-team blockers fold in by reference.
  const rt = await runRedTeam({
    plan,
    researchCase: caseFull,
  });
  // Deterministic probes on a healthy case should pass.
  check("healthy plan+case red-team passes", rt.passed, JSON.stringify(rt.findings));
  check("all deterministic probes ran", rt.probesRun.includes("blockers-propagate") && rt.probesRun.includes("task-graph-closure"));

  const hostileRtFindings = [
    {
      id: "x",
      severity: "blocker" as const,
      component: "valuation",
      finding: "Invented fair value.",
      recommendation: "Drop the number.",
      probe: "llm-adversary" as const,
    },
  ];
  const withRt = runCommitteeReview({
    qualityReview: cleanReview,
    redTeamFindings: hostileRtFindings,
    decidedAt: PINNED,
  });
  check("red-team blocker fails committee", !withRt.passed);
  check("red-team findings kept by reference", withRt.redTeamFindings === hostileRtFindings);
  check("regenerate empty without report+blocked review path (clean)", withRt.regenerate.length === 0);
}

// ── 5. Red-team probes ─────────────────────────────────────────────────
console.log("\n--- 5. Red-team probes ---");
{
  // Missing inputs → major findings, not silent pass.
  const empty = await runRedTeam({});
  check("empty input → task-graph major finding",
    empty.findings.some((f) => f.probe === "task-graph-closure" && f.severity === "major"));
  check("empty input → blockers-propagate major",
    empty.findings.some((f) => f.probe === "blockers-propagate" && f.severity === "major"));

  // Corrupt plan: missing terminal nodes.
  const brokenPlan = {
    ...plan,
    tasks: plan.tasks.filter((t) => t.kind !== "committee"),
  };
  const broken = await runRedTeam({ plan: brokenPlan, researchCase: caseFull });
  check("missing committee node → blocker",
    broken.findings.some((f) => f.probe === "task-graph-closure" && f.severity === "blocker"));
  check("broken plan fails passed", !broken.passed);

  // Dangling dependsOn.
  const danglingPlan = {
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.id === "T-committee" ? { ...t, dependsOn: ["T-missing"] } : t
    ),
  };
  const dangling = await runRedTeam({ plan: danglingPlan, researchCase: caseFull });
  check("dangling dependsOn → blocker",
    dangling.findings.some((f) => f.finding.includes("T-missing")));

  // Author without checker.
  const uncheckedPlan = {
    ...plan,
    tasks: plan.tasks.filter((t) => !(t.kind === "checker" && t.sectionId === "cover")),
  };
  const unchecked = await runRedTeam({ plan: uncheckedPlan, researchCase: caseFull });
  check("author without checker → blocker",
    unchecked.findings.some((f) => f.probe === "author-needs-checker" && f.severity === "blocker"));

  // Peers suppressed but author not blocked.
  const peerCase = buildResearchCase(
    baseParams({
      peers: [],
    })
  );
  const peerPlan = buildResearchTasks({
    researchCase: peerCase,
    sections: sectionsConcise,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
    plannedAt: PINNED,
  });
  // Builder may suppress peers when empty — check whether any peer author exists unblocked.
  const peerAuthors = peerPlan.tasks.filter((t) => t.kind === "author" && t.moduleId === "peers");
  const peerSections = sectionsConcise.filter((s) => s.modules.includes("peers"));
  const peerSectionAuthors = peerPlan.tasks.filter(
    (t) => t.kind === "author" && t.sectionId && peerSections.some((s) => s.id === t.sectionId)
  );
  if (peerSectionAuthors.length > 0) {
    // Either suppressed (must be blocked) or available (fine).
    const suppressed = peerCase.peers.suppress || !peerCase.peers.available;
    if (suppressed) {
      const unblocked = peerSectionAuthors.filter(
        (t) => t.status !== "blocked" || !t.blockers.includes("PEERS_SUPPRESSED")
      );
      check(
        "suppressed peers → peer authors blocked",
        unblocked.length === 0,
        unblocked.map((t) => `${t.id}:${t.status}`).join(",")
      );
    } else {
      check("peer authors exist for available peers", peerSectionAuthors.length > 0);
    }
  } else {
    check("peer sections absent or not primary-routed (no unblocked peer author)", peerAuthors.length === 0 || peerCase.peers.available);
  }

  // Missing valuation availability consistency: anchors must be null.
  const noValCase = buildResearchCase(baseParams({ valuation: null, assumptionsLedger: null }));
  const noValPlan = buildResearchTasks({
    researchCase: noValCase,
    sections: sectionsConcise,
    reportTypeId: "institutional_equity_v1",
    depth: "concise",
    plannedAt: PINNED,
  });
  const noValRt = await runRedTeam({ plan: noValPlan, researchCase: noValCase });
  check(
    "NO_VALUATION case does not false-flag when anchors null and authors blocked",
    !noValRt.findings.some((f) => f.probe === "missing-valuation" && f.severity === "blocker"),
    JSON.stringify(noValRt.findings.filter((f) => f.probe === "missing-valuation"))
  );

  // Healthy end-to-end: plan + case → red-team → committee.
  const rtHealthy = await runRedTeam({ plan, researchCase: caseFull });
  const committee = runCommitteeReview({
    qualityReview: {
      allFindings: [],
      perReviewer: {},
      passed: true,
      overallScore: 100,
      regenerationCandidates: [],
    } as unknown as ReturnType<typeof runQualityReview>,
    redTeamFindings: rtHealthy.findings,
    decidedAt: PINNED,
  });
  check("healthy red-team findings keep committee passed", committee.passed,
    JSON.stringify(committee.blockers));
}

// ── 6. Provider interchangeability smoke (no network) ──────────────────
console.log("\n--- 6. Provider interchangeability ---");
{
  // Orchestration module never imports SUPPORTED_PROVIDERS — adapters only.
  // Simulate three different provider-backed function transports producing
  // the same planner-shaped responses and prove identical red-team behavior.
  const caseInput = { plan, researchCase: caseFull };
  const respond = (label: string): OrchestrationTransport => ({
    async complete() {
      return JSON.stringify({
        findings: [
          {
            severity: "minor",
            component: `provider-${label}`,
            finding: `Note from ${label}.`,
            recommendation: "None.",
          },
        ],
      });
    },
  });

  const outs = await Promise.all(
    ["openrouter", "groq", "gemini"].map((label) =>
      runRedTeam({ ...caseInput, transport: respond(label) })
    )
  );
  check(
    "three provider-labelled transports → same finding count + all llmUsed",
    outs.every((o) => o.llmUsed && o.findings.filter((f) => f.probe === "llm-adversary").length === 1)
  );
  check(
    "provider labels only affect component text, not gate severity structure",
    outs.every((o) => o.findings.find((f) => f.probe === "llm-adversary")?.severity === "minor")
  );

  // COUNCIL_PASS_THRESHOLD is the documented mirror value only.
  check("threshold is the openrouter mirror (70)", COUNCIL_PASS_THRESHOLD === 70);
}

console.log("\n=======================================================");
console.log(`AI ORCHESTRATION PHASE 6: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
