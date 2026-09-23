/**
 * APEX RESEARCH — Report Blueprints Phase 4 Tests
 * -----------------------------------------------
 * Golden contract: `institutional_equity_v1` TOC titles/order and page-section
 * render order must match the existing PDF pipeline
 * (`src/components/PDFDocument/index.tsx`).
 *
 * Run: npx tsx scratch/test-report-blueprints.ts (exit 1 on failure)
 */
import {
  REPORT_BLUEPRINTS,
  listReportBlueprints,
  getReportBlueprint,
  isReportTypeId,
  resolveReportOutline,
  institutionalConciseTocTitles,
  institutionalFullTocTitles,
  INSTITUTIONAL_EQUITY_V1,
  REPORT_BLUEPRINTS_VERSION,
  type ReportTypeId,
} from "../src/lib/report-types";
import { RESEARCH_MODULE_ORDER, listResearchModules } from "../src/lib/research-modules";

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

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ══════════════════════════════════════════════════════════════════════

console.log("=======================================================");
console.log("REPORT BLUEPRINTS PHASE 4 TESTS");
console.log("=======================================================\n");

// ── Golden TOC (from PDFDocument CoverPage) ────────────────────────────
console.log("--- 1. Institutional TOC matches PDF (golden) ---");
{
  // Copied from PDFDocument/index.tsx:1232-1249 — DO NOT paraphrase.
  const PDF_CONCISE = [
    "Executive Summary & Thesis",
    "Valuation: DCF, Scenarios & Sensitivity",
    "Moat & Price / Fair Value",
    "Bulls / Bears, Risks & Catalysts",
    "Multi-Year Statement Models",
    "Comparable Company Comps",
    "QA Checksum & Disclosures",
  ];
  const PDF_FULL = [
    "Executive Summary & Thesis",
    "Credit & Solvency Analysis",
    "Management & Governance",
    "Catalysts & Market Reaction",
    "Multi-Year Statement Models",
    "Comparable Company Comps",
    "Valuation & Credit Models",
    "Statutory Disclosures & QA",
  ];

  const concise = institutionalConciseTocTitles();
  const full = institutionalFullTocTitles();
  check("concise TOC titles + order match PDF", sameArray(concise, PDF_CONCISE),
    JSON.stringify({ got: concise, want: PDF_CONCISE }));
  check("full TOC titles + order match PDF", sameArray(full, PDF_FULL),
    JSON.stringify({ got: full, want: PDF_FULL }));

  const outlineConcise = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "concise" });
  const outlineFull = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "full" });
  check(
    "resolve concise TOC matches golden",
    sameArray(outlineConcise.toc.map((t) => t.title), PDF_CONCISE)
  );
  check(
    "resolve full TOC matches golden",
    sameArray(outlineFull.toc.map((t) => t.title), PDF_FULL)
  );
  check("TOC indexes are 1-based contiguous", outlineConcise.toc.every((t, i) => t.index === i + 1));
}

// ── Golden section render order (PDF ReportDocument) ──────────────────
console.log("\n--- 2. Section render order matches PDF ReportDocument ---");
{
  // Component order from PDFDocument/index.tsx:7844-7932 (always + full gates).
  const PDF_ALWAYS = [
    "CoverPage",
    "ResearchDebatesPage", // conditional — asserted separately
    "FundamentalAnalysisPage",
    "MoatAndPriceFairValuePage",
    "BullsSayBearsSayPage",
    "IncomeStatementDetailedPage",
    "BalanceSheetDetailedPage",
    "CashFlowDetailedPage",
    "ComparableCompanyAnalysisPage1",
    "InstitutionalDisclaimerPage",
    "QualityAssuranceChecksumPage",
  ];
  const PDF_FULL_ONLY = [
    "MoatSourcesPage",
    "CreditAnalysisPage1",
    "CreditAnalysisPage2",
    "ManagementAndOwnershipPage1",
    "ManagementAndOwnershipPage2",
    "EventBasedPriceMovementPage",
    "CorporateDisclosuresAndCatalystsPage",
    "AnalystForecastsSummaryPage",
    "ComparableCompanyAnalysisPage2",
    "ResearchMethodologyValuationPage1",
    "ResearchMethodologyValuationPage2",
    "CreditRatingApproachPage1",
    "CreditRatingApproachPage2",
    "AnalystAIDisclosurePage",
  ];

  // Full render order with debates included (research present).
  const PDF_FULL_WITH_DEBATES = [
    "CoverPage",
    "ResearchDebatesPage",
    "FundamentalAnalysisPage",
    "MoatAndPriceFairValuePage",
    "MoatSourcesPage",
    "BullsSayBearsSayPage",
    "CreditAnalysisPage1",
    "CreditAnalysisPage2",
    "ManagementAndOwnershipPage1",
    "ManagementAndOwnershipPage2",
    "EventBasedPriceMovementPage",
    "CorporateDisclosuresAndCatalystsPage",
    "AnalystForecastsSummaryPage",
    "IncomeStatementDetailedPage",
    "BalanceSheetDetailedPage",
    "CashFlowDetailedPage",
    "ComparableCompanyAnalysisPage1",
    "ComparableCompanyAnalysisPage2",
    "ResearchMethodologyValuationPage1",
    "ResearchMethodologyValuationPage2",
    "CreditRatingApproachPage1",
    "CreditRatingApproachPage2",
    "InstitutionalDisclaimerPage",
    "AnalystAIDisclosurePage",
    "QualityAssuranceChecksumPage",
  ];

  const full = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, {
    depth: "full",
    hasResearchDebates: true,
  });
  const gotFull = full.sections.map((s) => s.pdfComponent ?? s.id);
  check(
    "full render order matches PDF (with research debates)",
    sameArray(gotFull, PDF_FULL_WITH_DEBATES),
    JSON.stringify({ got: gotFull, want: PDF_FULL_WITH_DEBATES })
  );

  const concise = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, {
    depth: "concise",
    hasResearchDebates: true,
  });
  const expectedConcise = PDF_ALWAYS.filter((c) => c !== "ResearchDebatesPage").length;
  // Concise PDF: always-components minus full-only, with debates at position 2.
  const conciseExpected = [
    "CoverPage",
    "ResearchDebatesPage",
    "FundamentalAnalysisPage",
    "MoatAndPriceFairValuePage",
    "BullsSayBearsSayPage",
    "IncomeStatementDetailedPage",
    "BalanceSheetDetailedPage",
    "CashFlowDetailedPage",
    "ComparableCompanyAnalysisPage1",
    "InstitutionalDisclaimerPage",
    "QualityAssuranceChecksumPage",
  ];
  check(
    "concise render order matches PDF (with research debates)",
    sameArray(concise.sections.map((s) => s.pdfComponent ?? s.id), conciseExpected),
    JSON.stringify({
      got: concise.sections.map((s) => s.pdfComponent ?? s.id),
      want: conciseExpected,
    })
  );
  check("concise excludes all full-only components", concise.sections.every((s) => !PDF_FULL_ONLY.includes(s.pdfComponent ?? "")));
  check("full includes all full-only components", PDF_FULL_ONLY.every((c) => gotFull.includes(c)));
  check("section indexes 1-based", full.sections.every((s, i) => s.index === i + 1));
  void expectedConcise;
}

// ── Research debates gate (PDF ResearchDebatesPage) ────────────────────
console.log("\n--- 3. Research debates conditional gate ---");
{
  const without = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, {
    depth: "concise",
    researchReport: null,
    hasResearchDebates: false,
  });
  check(
    "omits research-debates when no report and no debates",
    !without.sections.some((s) => s.id === "research-debates")
  );

  const withReport = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, {
    depth: "concise",
    researchReport: { thesis: {} },
    hasResearchDebates: false,
  });
  check(
    "includes research-debates when researchReport present",
    withReport.sections.some((s) => s.id === "research-debates")
  );
  check(
    "research-debates is second section when included",
    withReport.sections[1]?.id === "research-debates"
  );

  const withDebatesOnly = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, {
    depth: "concise",
    researchReport: null,
    hasResearchDebates: true,
  });
  check("includes when debates exist without report", withDebatesOnly.sections.some((s) => s.id === "research-debates"));
}

// ── Module wiring vs Phase 3 catalog ───────────────────────────────────
console.log("\n--- 4. Module wiring valid ---");
{
  const catalog = new Set(listResearchModules().map((m) => m.id));
  const order = new Set(RESEARCH_MODULE_ORDER);

  for (const bp of REPORT_BLUEPRINTS) {
    check(`${bp.id}: requiredModules ⊆ catalog`, bp.requiredModules.every((m) => catalog.has(m)));
    check(
      `${bp.id}: every section module ⊆ catalog`,
      bp.sections.every((s) => s.modules.every((m) => catalog.has(m)))
    );
    check(`${bp.id}: unique section ids`, new Set(bp.sections.map((s) => s.id)).size === bp.sections.length);
    check(`${bp.id}: toc titles unique per template`, new Set(bp.toc.map((t) => t.title)).size === bp.toc.length);
    check(`${bp.id}: version pinned`, bp.version === REPORT_BLUEPRINTS_VERSION);
    check(`${bp.id}: defaultDepth concise`, bp.defaultDepth === "concise");
    check(
      `${bp.id}: no hardcoded maxPages / pageCount fields`,
      !("maxPages" in bp) && !("pageCount" in bp) && !("pageLimit" in bp)
    );
    void order;
  }

  const outline = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "full", hasResearchDebates: true });
  check(
    "institutional outline moduleIds match RESEARCH_MODULE_ORDER filter",
    sameArray(outline.moduleIds, RESEARCH_MODULE_ORDER.filter((m) => outline.moduleIds.includes(m)))
  );
  check("institutional outline includes all 9 modules", outline.moduleIds.length === 9);
}

// ── Registry & planned types ───────────────────────────────────────────
console.log("\n--- 5. Registry (institutional + planned + advanced types) ---");
{
  // Phase 4 originally registered 5; Phase 8 adds 10 advanced types → 15.
  check("registry has 15 blueprints", listReportBlueprints().length === 15,
    `got ${listReportBlueprints().length}`);
  const expected: ReportTypeId[] = [
    "institutional_equity_v1",
    "tearsheet_v1",
    "valuation_dossier_v1",
    "earnings_deep_dive_v1",
    "forensic_v1",
    "industry_v1",
    "competitive_v1",
    "management_v1",
    "risk_v1",
    "sotp_v1",
    "bank_v1",
    "insurance_v1",
    "reit_v1",
    "special_situation_v1",
    "portfolio_v1",
  ];
  check(
    "registry ids match plan",
    sameArray(REPORT_BLUEPRINTS.map((b) => b.id), expected),
    JSON.stringify(REPORT_BLUEPRINTS.map((b) => b.id))
  );
  check("getReportBlueprint institutional", getReportBlueprint("institutional_equity_v1")?.status === "stable");
  check(
    "planned types status=planned",
    ["tearsheet_v1", "valuation_dossier_v1", "earnings_deep_dive_v1", "forensic_v1"].every(
      (id) => getReportBlueprint(id as ReportTypeId)?.status === "planned"
    )
  );
  check(
    "advanced types status=stable",
    expected.slice(5).every((id) => getReportBlueprint(id)?.status === "stable")
  );
  check("isReportTypeId true", isReportTypeId("forensic_v1"));
  check("isReportTypeId advanced true", isReportTypeId("bank_v1"));
  check("isReportTypeId false", !isReportTypeId("nope"));
  check("getReportBlueprint null on unknown", getReportBlueprint("nope" as ReportTypeId) === null);
}

// ── Resolve determinism + errors ───────────────────────────────────────
console.log("\n--- 6. Resolve determinism & contracts ---");
{
  const a = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "full", hasResearchDebates: true });
  const b = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "full", hasResearchDebates: true });
  check("deterministic section ids", sameArray(a.sections.map((s) => s.id), b.sections.map((s) => s.id)));
  check("deterministic toc titles", sameArray(a.toc.map((t) => t.title), b.toc.map((t) => t.title)));

  const missingResearch = resolveReportOutline(INSTITUTIONAL_EQUITY_V1, { depth: "concise" });
  check("default depth is concise", missingResearch.depth === "concise");

  let threw = false;
  try {
    resolveReportOutline(null as never);
  } catch {
    threw = true;
  }
  check("null blueprint throws", threw);

  const tearsheet = resolveReportOutline(getReportBlueprint("tearsheet_v1")!);
  check("tearsheet resolves 3 sections", tearsheet.sections.length === 3);
  check("tearsheet modules subset of catalog", tearsheet.moduleIds.every((m) => RESEARCH_MODULE_ORDER.includes(m)));
}

// ── No PDF / report pipeline mutation ──────────────────────────────────
console.log("\n--- 7. Blueprint purity (structure only) ---");
{
  check("blueprint has no run/compute functions", REPORT_BLUEPRINTS.every((b) => Object.values(b).every((v) => typeof v !== "function")));
  check(
    "sections carry only structural fields",
    INSTITUTIONAL_EQUITY_V1.sections.every((s) =>
      ["id", "title", "modules", "depth", "includeWhen", "pdfComponent"].every((k) => k in s)
    )
  );
  check("blueprint does not embed financial numbers", !JSON.stringify(INSTITUTIONAL_EQUITY_V1).match(/fairValue|targetPrice|intrinsicValue/));
}

console.log("\n=======================================================");
console.log(`REPORT BLUEPRINTS PHASE 4: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
if (failures > 0) process.exit(1);
