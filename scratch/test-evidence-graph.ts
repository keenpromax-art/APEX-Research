/**
 * APEX RESEARCH — Evidence Graph Phase 7 Tests
 * --------------------------------------------
 *  1. Graph contract (version, caseId, stage node kinds, edge uniqueness).
 *  2. Source → Evidence chain from EvidenceRegistry (reference, not recompute).
 *  3. Claim extraction + claim-validator reuse (supported / untraceable).
 *  4. Analysis / Conclusion / Section wiring from Phase 3/4 objects.
 *  5. Material-claims exit criterion (traceable vs blockers).
 *  6. Fail-closed missing data (no registry, no case, no narratives).
 *  7. Determinism (pinned builtAt) + no page caps / no financial recompute.
 *
 * Run: npx tsx scratch/test-evidence-graph.ts (exit 1 on failure)
 */
import {
  EVIDENCE_GRAPH_VERSION,
  buildEvidenceGraph,
  traceClaimPath,
  type BuildEvidenceGraphInput,
  type EvidenceGraph,
} from "../src/lib/evidence-graph";
import { buildResearchCase, type BuildResearchCaseParams } from "../src/lib/research-case";
import {
  createEvidenceRegistry,
  registerEvidence,
  type EvidenceRegistry,
} from "../src/lib/evidence-registry";
import {
  resolveReportOutline,
  getReportBlueprint,
  INSTITUTIONAL_EQUITY_V1,
} from "../src/lib/report-types";
import { runResearchModules, type ModuleContext } from "../src/lib/research-modules";
import { composeReport, type ComposedReport } from "../src/lib/report-composer";
import { createAssumptionsLedger } from "../src/lib/assumptions-ledger";
import { buildMasterReportFacts } from "../src/lib/report-facts";
import { computeRatios, computeDuPont } from "../src/lib/calculations";
import type {
  AnnualFinancials,
  CompanyProfile,
  CorporateAnnualFinancials,
  DCFResult,
  PeerData,
  QuarterlyFinancials,
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
const PINNED = "2026-09-02T00:00:00.000Z";

// ── Fixtures (same shape as Phases 1/3/5/6) ────────────────────────────

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
  } as StockData;
}

function makeCorporateYear(year: string): CorporateAnnualFinancials {
  const revenue = 50e9;
  const netIncome = 5e9;
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
    netIncome,
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

function makeRegistry(): EvidenceRegistry {
  const reg = createEvidenceRegistry(AS_OF);
  registerEvidence(reg, {
    id: "EV:MODEL_DERIVED:DCF:wacc",
    tier: "MODEL_DERIVED",
    source: "DCF engine (CAPM blend)",
    field: "wacc",
    value: 9.5,
    unit: "pct",
  });
  registerEvidence(reg, {
    id: "EV:SECONDARY:YAHOO:revenue:FY2024",
    tier: "SECONDARY",
    source: "Yahoo fundamentals-timeseries",
    field: "revenue",
    value: 500_000_000_000,
    unit: "money",
    note: "FY2024",
  });
  registerEvidence(reg, {
    id: "EV:MODEL_DERIVED:DCF:fairValue",
    tier: "MODEL_DERIVED",
    source: "DCF engine (EV bridge)",
    field: "fairValue",
    value: 120,
    unit: "price",
  });
  return reg;
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
    evidence: over.evidence !== undefined ? over.evidence : makeRegistry(),
    createdAt: AS_OF,
    dataCutoff: AS_OF,
  };
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

function buildFull(over: Partial<BuildResearchCaseParams> = {}) {
  const params = baseParams(over);
  const annual = params.annualFinancials as AnnualFinancials[];
  const stock = params.stockData;
  const ratios = annual.map((f) => computeRatios(f, stock.currentPrice));
  const dupont = annual.map((f) => computeDuPont(f));
  const ledger =
    params.assumptionsLedger ??
    createAssumptionsLedger({
      profile: params.profile,
      stockData: stock,
      annualFinancials: annual,
      dcf: params.valuation!,
    });
  const facts = buildMasterReportFacts({
    stockData: stock,
    profile: params.profile,
    annualFinancials: annual,
    ratiosByYear: ratios,
    dupontByYear: dupont,
    dcf: params.valuation!,
    peers: params.peers,
    ledger,
  });
  const researchCase = buildResearchCase({
    ...params,
    assumptionsLedger: ledger,
    valuation: params.valuation,
    peers: params.peers,
    evidence: params.evidence ?? makeRegistry(),
  });
  const ctx: ModuleContext = {
    researchCase,
    masterReportFacts: facts,
    ratiosByYear: ratios,
    dupontByYear: dupont,
  };
  return { researchCase, ctx, params, facts, ledger };
}

function conciseSections() {
  return resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "concise" }).sections;
}

function makeInput(over: Partial<BuildEvidenceGraphInput> = {}): BuildEvidenceGraphInput {
  const full = buildFull();
  return {
    researchCase: full.researchCase,
    sections: conciseSections(),
    modules: runResearchModules(full.ctx),
    builtAt: PINNED,
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("EVIDENCE GRAPH PHASE 7 TESTS");
console.log("=======================================================\n");

// ── 1. Graph contract ──────────────────────────────────────────────────
console.log("--- 1. graph contract ---");
{
  const g = buildEvidenceGraph(makeInput());
  const expectedCaseId = buildFull().researchCase.caseId;
  check("version pinned", g.version === EVIDENCE_GRAPH_VERSION);
  check("caseId from research case", g.caseId === expectedCaseId, JSON.stringify(g.caseId));
  check("builtAt injectable", g.builtAt === PINNED);
  const kinds = new Set(g.nodes.map((n) => n.kind));
  check("has source nodes", kinds.has("source"));
  check("has evidence nodes", kinds.has("evidence"));
  check("has analysis nodes", kinds.has("analysis"));
  check("has section nodes", kinds.has("section"));
  check("has conclusion node", kinds.has("conclusion"));
  const nodeIds = g.nodes.map((n) => n.id);
  check("node ids unique", new Set(nodeIds).size === nodeIds.length);
  const edgeKeys = g.edges.map((e) => `${e.from}|${e.kind}|${e.to}`);
  check("edge keys unique", new Set(edgeKeys).size === edgeKeys.length);
  const idSet = new Set(nodeIds);
  check(
    "every edge endpoint is a node",
    g.edges.every((e) => idSet.has(e.from) && idSet.has(e.to)),
    JSON.stringify(g.edges.filter((e) => !idSet.has(e.from) || !idSet.has(e.to)).slice(0, 3))
  );
  check("no maxPages/page cap field", !("maxPages" in g) && !("pageCap" in g));
}

// ── 2. Source → Evidence ───────────────────────────────────────────────
console.log("--- 2. source → evidence chain ---");
{
  const full = buildFull();
  const g = buildEvidenceGraph({
    researchCase: full.researchCase,
    sections: conciseSections(),
    builtAt: PINNED,
  });
  const sources = g.nodes.filter((n) => n.kind === "source");
  const evidence = g.nodes.filter((n) => n.kind === "evidence");
  check("source count > 0", sources.length > 0, `got ${sources.length}`);
  check("evidence count > 0", evidence.length > 0, `got ${evidence.length}`);
  const srcEdges = g.edges.filter((e) => e.kind === "source-produces-evidence");
  check("source-produces-evidence edges present", srcEdges.length === evidence.length,
    `edges=${srcEdges.length} evidence=${evidence.length}`);
  check(
    "registry item ids preserved as evidence.ref",
    evidence.some((n) => n.ref === "EV:MODEL_DERIVED:DCF:wacc")
  );
  // Reference identity: registry is the case's registry (not a rebuild).
  check("graph does not mutate case registry", full.researchCase.evidence?.items.length === 3);
}

// ── 3. Claims via claim-validator ──────────────────────────────────────
console.log("--- 3. claim extraction + validation reuse ---");
{
  const full = buildFull();
  const goodText =
    "Base-case WACC is 9.5% under the DCF engine blend. Model fair value is Rs 120 per share.";
  const badText = "Hotel occupancy reached 67.3% last quarter.";
  const g = buildEvidenceGraph({
    researchCase: full.researchCase,
    sections: conciseSections(),
    builtAt: PINNED,
    narratives: [
      {
        originId: "section:fundamental-analysis",
        text: goodText,
        sectionId: "fundamental-analysis",
        moduleId: "valuation",
        role: "analysis",
      },
      {
        originId: "section:moat-price-fair-value",
        text: badText,
        sectionId: "moat-price-fair-value",
        moduleId: "moat",
      },
    ],
  });
  check("claims extracted", g.claims.length >= 3, `got ${g.claims.length}`);
  const waccClaim = g.claims.find((c) => c.numericValue === 9.5);
  check("wacc claim supported", Boolean(waccClaim?.supported && waccClaim.evidenceId),
    JSON.stringify(waccClaim));
  check(
    "wacc path starts at source",
    Boolean(waccClaim && waccClaim.path[0]?.startsWith("source:")),
    waccClaim?.path.join(" → ")
  );
  const occupancy = g.claims.find((c) => c.numericValue === 67.3);
  check("occupancy unsupported + material", Boolean(occupancy && !occupancy.supported && occupancy.material));
  check(
    "occupancy has UNTRACEABLE blocker",
    g.blockers.some((b) => b.startsWith("UNTRACEABLE_CLAIM:")),
    g.blockers.join("; ")
  );
  const fvClaim = g.claims.find((c) => c.numericValue === 120);
  check("fair value claim supported", Boolean(fvClaim?.supported && fvClaim.evidenceId),
    JSON.stringify(g.claims.map((c) => ({ v: c.numericValue, k: c.kind, s: c.supported }))));
  const path = traceClaimPath(g, waccClaim!.claimId);
  check("traceClaimPath returns ≥3 nodes", Array.isArray(path) && path!.length >= 3,
    path?.join(" → "));
  check("traceClaimPath null for unsupported", traceClaimPath(g, occupancy!.claimId) === null);
}

// ── 4. Analysis / Conclusion / Section wiring ──────────────────────────
console.log("--- 4. analysis · conclusion · section wiring ---");
{
  const full = buildFull();
  const outline = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "concise" });
  const modules = runResearchModules(full.ctx, outline.moduleIds);
  const composed: ComposedReport = composeReport({
    context: full.ctx,
    depth: "concise",
    composedAt: PINNED,
  });
  const g = buildEvidenceGraph({
    researchCase: full.researchCase,
    sections: composed.sections,
    modules,
    builtAt: PINNED,
    narratives: [
      {
        originId: "conclusion",
        text: "WACC stands at 9.5% with terminal growth of 4.0%.",
        role: "conclusion",
        sectionId: "fundamental-analysis",
      },
    ],
  });
  const analysisNodes = g.nodes.filter((n) => n.kind === "analysis");
  check(
    "analysis nodes from module bundle",
    analysisNodes.some((n) => n.ref === "valuation") && analysisNodes.some((n) => n.ref === "statements"),
    analysisNodes.map((n) => n.ref).join(",")
  );
  const conclusion = g.nodes.find((n) => n.kind === "conclusion");
  check("conclusion node present (ledger anchors)", Boolean(conclusion));
  check(
    "conclusion meta carries rating from ledger",
    conclusion?.meta?.rating === "BUY" || conclusion?.meta?.fairValue === 120,
    JSON.stringify(conclusion?.meta)
  );
  check(
    "valuation analysis supports conclusion",
    g.edges.some(
      (e) => e.kind === "analysis-supports-conclusion" && e.from === "analysis:valuation"
    )
  );
  check(
    "conclusion feeds a section",
    g.edges.some((e) => e.kind === "conclusion-feeds-section")
  );
  check(
    "analysis feeds section (valuation → fundamental-analysis)",
    g.edges.some(
      (e) =>
        e.kind === "analysis-feeds-section" &&
        e.from === "analysis:valuation" &&
        e.to === "section:fundamental-analysis"
    ),
    JSON.stringify(
      g.edges.filter((e) => e.kind === "analysis-feeds-section" && e.from === "analysis:valuation")
    )
  );
  const conclusionClaim = g.claims.find((c) => c.role === "conclusion");
  check(
    "conclusion-role claim links to conclusion node",
    Boolean(conclusionClaim && conclusionClaim.path.includes("conclusion:valuation")),
    conclusionClaim?.path.join(" → ")
  );
  const sectionCount = g.nodes.filter((n) => n.kind === "section").length;
  check("section nodes from composed outline", sectionCount === composed.sections.length,
    `nodes=${sectionCount} composed=${composed.sections.length}`);
  check(
    "claim-in-section edge for narrative section",
    g.edges.some(
      (e) => e.kind === "claim-in-section" && e.to === "section:fundamental-analysis"
    )
  );
  check(
    "module bundle referenced (caseId matches)",
    g.caseId === modules.caseId
  );
}

// ── 5. Material-claims exit criterion ──────────────────────────────────
console.log("--- 5. material claims traceable (exit) ---");
{
  const full = buildFull();
  const allGood = buildEvidenceGraph({
    researchCase: full.researchCase,
    sections: conciseSections(),
    builtAt: PINNED,
    narratives: [
      {
        originId: "thesis",
        text: "Base-case WACC is 9.5% under the DCF engine blend.",
        role: "conclusion",
        sectionId: "fundamental-analysis",
      },
    ],
  });
  check("all material claims traceable → true", allGood.materialClaimsTraceable === true,
    JSON.stringify({ blockers: allGood.blockers, claims: allGood.claims }));
  check(
    "traceable count equals material count",
    allGood.materialClaimCount > 0 &&
      allGood.traceableMaterialCount === allGood.materialClaimCount,
    JSON.stringify({
      m: allGood.materialClaimCount,
      t: allGood.traceableMaterialCount,
    })
  );

  const withFabrication = buildEvidenceGraph({
    researchCase: full.researchCase,
    sections: conciseSections(),
    builtAt: PINNED,
    narratives: [
      {
        originId: "thesis",
        text:
          "RevPAR hit Rs 8,400 last quarter. Occupancy was 67.3% in the same period. ADR grew 41.7% year over year.",
        role: "conclusion",
      },
    ],
  });
  check(
    "fabricated material claims → materialClaimsTraceable false",
    withFabrication.materialClaimsTraceable === false
  );
  check(
    "three UNTRACEABLE blockers for three fabrications",
    withFabrication.blockers.filter((b) => b.startsWith("UNTRACEABLE_CLAIM:")).length >= 3,
    withFabrication.blockers.join("; ")
  );
}

// ── 6. Fail-closed missing data ────────────────────────────────────────
console.log("--- 6. fail-closed (no invention) ---");
{
  const full = buildFull();
  const noRegistry = buildEvidenceGraph({
    researchCase: { ...full.researchCase, evidence: null },
    sections: conciseSections(),
    builtAt: PINNED,
    narratives: [
      { originId: "thesis", text: "WACC is 9.5%.", role: "conclusion" },
    ],
  });
  check("missing registry → EVIDENCE_REGISTRY_MISSING blocker",
    noRegistry.blockers.includes("EVIDENCE_REGISTRY_MISSING"));
  check("missing registry → material claims not traceable",
    noRegistry.materialClaimsTraceable === false);
  check("claims still recorded (not invented as supported)",
    noRegistry.claims.every((c) => !c.supported && c.evidenceId === null));

  const noNarratives = buildEvidenceGraph(makeInput({ narratives: null }));
  check("no narratives → unknown recorded",
    noNarratives.unknowns.some((u) => u.includes("No narratives")));
  check("no narratives → zero claims", noNarratives.claims.length === 0);
  check("no narratives → vacuously traceable", noNarratives.materialClaimsTraceable === true);

  const emptyCase = buildEvidenceGraph({
    researchCase: { caseId: "" } as never,
    builtAt: PINNED,
  });
  check("missing case → NO_RESEARCH_CASE blocker", emptyCase.blockers.includes("NO_RESEARCH_CASE"));
  check("missing case → not traceable", emptyCase.materialClaimsTraceable === false);

  const noValuation = buildEvidenceGraph(
    makeInput({
      researchCase: buildResearchCase(
        baseParams({ valuation: null, assumptionsLedger: null, evidence: makeRegistry() })
      ),
      narratives: null,
    })
  );
  check(
    "no valuation anchors → conclusion omitted + unknown",
    !noValuation.nodes.some((n) => n.kind === "conclusion") &&
      noValuation.unknowns.some((u) => u.includes("conclusion node omitted"))
  );
}

// ── 7. Determinism + purity ────────────────────────────────────────────
console.log("--- 7. determinism + purity ---");
{
  const input = makeInput({
    narratives: [
      {
        originId: "thesis",
        text: "WACC is 9.5% with fair value of 120.",
        role: "conclusion",
        sectionId: "fundamental-analysis",
        moduleId: "valuation",
      },
    ],
  });
  const a = buildEvidenceGraph(input);
  const b = buildEvidenceGraph(input);
  check("pinned builtAt identical", a.builtAt === b.builtAt);
  check(
    "node ids deterministic",
    JSON.stringify(a.nodes.map((n) => n.id)) === JSON.stringify(b.nodes.map((n) => n.id))
  );
  check(
    "edges deterministic",
    JSON.stringify(a.edges) === JSON.stringify(b.edges)
  );
  check(
    "claims deterministic",
    JSON.stringify(a.claims.map((c) => ({ id: c.claimId, s: c.supported, p: c.path }))) ===
      JSON.stringify(b.claims.map((c) => ({ id: c.claimId, s: c.supported, p: c.path })))
  );
  check(
    "materialClaimsTraceable deterministic",
    a.materialClaimsTraceable === b.materialClaimsTraceable
  );
  // Purity: building the graph does not mutate the case.
  const full = buildFull();
  const before = JSON.stringify(full.researchCase.evidence);
  buildEvidenceGraph({
    researchCase: full.researchCase,
    sections: conciseSections(),
    builtAt: PINNED,
    narratives: [{ originId: "t", text: "WACC is 9.5%.", role: "conclusion" }],
  });
  check("case evidence registry not mutated", JSON.stringify(full.researchCase.evidence) === before);
  check(
    "blueprint registry untouched (getReportBlueprint still resolves)",
    getReportBlueprint("institutional_equity_v1")?.id === "institutional_equity_v1"
  );
}

console.log("\n=======================================================");
console.log(`EVIDENCE GRAPH PHASE 7: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
