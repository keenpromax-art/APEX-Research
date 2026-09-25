/**
 * APEX RESEARCH — Content Delivery Tests
 * --------------------------------------
 * Root causes of bland output fixed here:
 *  A. TRUNCATION LOSS — a length-cut LLM draft was discarded entirely.
 *  B. LOSSY BRIDGE  — the ai-first → AIAnalysis bridge overwrote rich council
 *     prose with short joins and clipped the thesis to 4,000 chars.
 *  C. UNRENDERED    — forensic AI commentary never reached the PDF.
 *  D. FABRICATION    — hardcoded board/solvency/self-funding claims.
 *
 * Run: npx tsx scratch/test-content-delivery.ts (exit 1 on failure)
 */
import { salvageTruncatedJsonObject, salvageTruncatedJsonArray, mergeSalvaged } from "../src/lib/ai/json-salvage";
import { enrichAIAnalysisFromResearchReport } from "../src/lib/ai-first/enrich-report";
import type { ResearchReport } from "../src/lib/ai-first/types";
import type { AIAnalysis } from "../src/types/report";
import * as fs from "node:fs";
import * as path from "node:path";

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

// ── A. Truncation salvage ─────────────────────────────────────────────
console.log("\n[A] Truncated-draft salvage");
{
  const full = '{"investmentThesis":"' + "a".repeat(900) + '","companyOverview":"' + "b".repeat(900) + '","summary":"' + "c".repeat(300) + '"}';
  const cut = full.slice(0, 1500); // lands mid-way through companyOverview
  check("test payload is genuinely truncated", cut.length < full.length && !cut.trimEnd().endsWith("}"));
  const salvaged = salvageTruncatedJsonObject(cut);
  check("first field recovered", salvaged.investmentThesis === "a".repeat(900));
  check("partial field not fabricated", salvaged.companyOverview === undefined);
  check("later fields not invented", salvaged.summary === undefined);

  const merged = mergeSalvaged(salvaged, { investmentThesis: "", companyOverview: "fallback-overview", summary: "fallback-summary" } as Record<string, unknown>);
  check("recovered field wins", merged.investmentThesis === "a".repeat(900));
  check("missing field keeps fallback", merged.companyOverview === "fallback-overview");

  const cutArray = '{"risks":[{"risk":"r1","d":"x"},{"risk":"r2","d":"y"},{"risk":"r3","d":"z';
  const arr = salvageTruncatedJsonArray(cutArray);
  check("complete array elements recovered", arr.length === 2, `${arr.length}`);
  check("incomplete element dropped", !arr.some((x: any) => x?.risk === "r3"));

  const braces = '```json\n{"a":"x \\"quoted\\" value","b":2,"c":{"d":true},"e":[1,2],"f":"y"}\n```';
  const ok = salvageTruncatedJsonObject(braces);
  check("escaped quotes handled", ok.a === 'x "quoted" value');
  check("nested object handled", (ok.c as any)?.d === true);
  check("array value handled", Array.isArray(ok.e) && ok.e.length === 2);
  check("clean json still works", ok.f === "y");

  const garbage = salvageTruncatedJsonObject("not json at all");
  check("garbage yields no fields", Object.keys(garbage).length === 0);
}

// ── B. Non-destructive enrichment ─────────────────────────────────────
console.log("\n[B] Enrichment preserves rich content");
function baseAi(): AIAnalysis {
  return {
    companyOverview: "", economicContext: "", globalIndustryAnalysis: "", domesticIndustryAnalysis: "",
    segmentAnalysis: "", quarterlyResultsCommentary: "", managementCommentary: "", revenueCommentary: "",
    ebitdaCommentary: "", ebitCommentary: "", patCommentary: "", balanceSheetCommentary: "",
    cashFlowCommentary: "", dupontCommentary: "", ratioCommentary: "", dcfCommentary: "",
    swotStrengths: [], swotWeaknesses: [], swotOpportunities: [], swotThreats: [], keyRisks: [],
    investmentConclusion: "", competitiveMoat: "", summary: "",
  } as AIAnalysis;
}
function researchReport(over: Partial<ResearchReport> = {}): ResearchReport {
  return {
    ticker: "T.NS",
    thesis: {
      thesis: "Central thesis paragraph.",
      bullCase: Array.from({ length: 8 }, (_, i) => `bull-${i}`),
      bearCase: Array.from({ length: 8 }, (_, i) => `bear-${i}`),
      keyDebate: "Can the engine compound?",
      keyInflectionPoints: ["inflection-1", "inflection-2"],
      whatMarketMayBeMissing: "market gap",
      whatCouldInvalidate: ["invalidation-1", "invalidation-2"],
    },
    debates: [{
      debate: "Can the engine compound?",
      evidenceFor: [{ evidence: "for-evidence", factIds: ["[F-1]"], tier: 4 }],
      evidenceAgainst: [{ evidence: "against-evidence", factIds: ["[F-2]"], tier: 4 }],
      mechanism: "mechanism", significance: "significance",
      financialConsequence: "financial", valuationConsequence: "valuation", resolutionSignal: "signal",
    }],
    moat: {
      hasMoat: true,
      verdict: "moat verdict",
      sources: [{ source: "Scale", evidence: "ev", economicConsequence: "ec", durability: "10 yrs", threatsToDurability: "threat", chain: "asset→mechanism→KPI→financial→valuation" }],
    },
    catalysts: [{ catalyst: "c1", mechanism: "m1", financialVariable: "fv1", quantitative: true, timeframe: "6m", observableKpi: "kpi1", direction: "positive", forecastImpact: "fi", valuationImpact: "vi", invalidation: "inv" }],
    risks: [
      { risk: "r-quant", mechanism: "m", affectedKpi: "k", financialConsequence: "margin compression of 3pp", valuationConsequence: "v", monitoringIndicator: "mi" },
      { risk: "r-qual", mechanism: "m2", affectedKpi: "k2", financialConsequence: "reputation", valuationConsequence: "brand", monitoringIndicator: "mi2" },
    ],
    economicEngine: {
      ticker: "T.NS",
      primaryAbstraction: "unit-volume compounder",
      revenueDrivers: [{ name: "Volume", mechanism: "units sold × price", sourceFacts: [], statementLine: null }],
      costDrivers: [], marginDrivers: [], cashDrivers: [], balanceSheetDrivers: [], capitalDrivers: [], returnsDrivers: [],
      keyKpis: [], metricsToAvoid: [], statementBindings: [],
      valueQuestions: ["Can volume compound?"],
      confidence: 0.7,
    },
    companyUnderstanding: {
      ticker: "T.NS", companyName: "T Ltd",
      whatItDoes: "Makes machines.", howItMakesMoney: "Sells units.",
      businessSegments: [{ name: "Core", description: "Core segment", shareOfRevenue: 0.62 }],
      economicUnits: ["unit"], primaryEconomicAbstraction: "unit",
      revenueDrivers: [], costDrivers: [], marginDrivers: [], cashGenerationDrivers: [],
      balanceSheetDrivers: [], returnsDrivers: [], capitalEngines: [], keyKpis: [], metricsToAvoid: [],
      statementsThatMatterMost: [], industryContext: "Industry context body.",
      appropriateValuationMethods: [], whyThisCompany: "why this company",
      competitiveAdvantages: [], competitiveThreats: [], currentInflections: [],
      managementPriorities: ["Prioritise capacity"],
      confidence: { overall: 0.7, dataQuality: "good", reasoning: "r" },
    },
    conclusion: "The conclusion body.",
    financialQuality: "Financial quality body.",
    historicalAnalysis: "Historical analysis body.",
    managementAnalysis: "Management analysis body.",
    capitalAllocation: "Capital allocation body.",
    competitiveAnalysis: { competitors: [{ company: "Rival", businessOverlap: "overlap", economicSimilarity: "similar", keyDifference: "diff", relativeStrengths: "s", relativeWeaknesses: "w" }], insufficient: false },
    evidenceMap: { ticker: "T.NS", items: [], overallConfidence: 0.8, unsupported: [] },
    researchDiscovery: {
      ticker: "T.NS", generatedAt: "2026-01-01", summary: "discovery summary", coverage: 0.7,
      economicInsights: ["insight"], moatSeeds: [], catalystSeeds: [], riskSeeds: [], competitiveSeeds: [],
      evidenceItems: [], gaps: [{ area: "thesis", question: "q", why: "w", status: "missing", evidenceItems: [] }],
      marginMechanism: "mm", workingCapitalChain: "wc", roicInterpretation: "roic", targetPriceMethodology: "tp",
      aiUsed: true,
    },
    ...over,
  } as unknown as ResearchReport;
}
{
  const longStrategy = "S".repeat(3000);
  const longOverview = "O".repeat(2500);
  const ai = baseAi();
  (ai as any).businessStrategyCommentary = longStrategy;
  (ai as any).companyOverview = longOverview;
  (ai as any).investmentConclusion = "C".repeat(400);

  const out = enrichAIAnalysisFromResearchReport(ai, researchReport());
  check("strategy prose not shortened", (out.businessStrategyCommentary || "").length >= longStrategy.length, `${(out.businessStrategyCommentary || "").length}`);
  check("overview not replaced by short join", (out.companyOverview || "").length >= longOverview.length);
  check("economic engine narrative mapped", /Primary economic abstraction: unit-volume compounder/.test(out.operatingProfileCommentary || ""));
  check("council conclusion remains authoritative", (out.investmentConclusion || "").includes("C".repeat(400)));
  check("research conclusion does not override council conclusion", !(out.investmentConclusion || "").includes("The conclusion body."));
  check("inflection points mapped", /inflection-1/.test(out.investmentThesis || ""));
  check("all bull cases retained", (out.investmentThesis || "").includes("bull-7"));
  check("all bear cases retained", (out.investmentThesis || "").includes("bear-7"));
  check("catalyst mechanism mapped", (out.catalysts?.[0]?.impact || "").includes("m1"));
  check("qualitative risk not force-High", out.keyRisks?.find((r) => r.risk === "r-qual")?.impact !== "High");
  check("quantified risk ranked High", out.keyRisks?.find((r) => r.risk === "r-quant")?.impact === "High");
  check("segment share rendered", (out.segmentAnalysis || "").includes("62%"));
  check("management analysis mapped", (out.managementCommentary || "").includes("Management analysis body."));
  check("financial quality mapped", (out.economicContext || "").includes("Financial quality body."));
  check("evidence confidence not nulled", out.evidenceMapConfidence === 0.8);
}

// ── C/D. Renderer: rendered commentary + no fabrication ───────────────
console.log("\n[C/D] Renderer content delivery");
{
  const pdf = fs.readFileSync(path.join(process.cwd(), "src", "components", "PDFDocument", "index.tsx"), "utf8");
  check("dupont commentary rendered", /pe\.dupontCommentary/.test(pdf));
  check("ratio commentary rendered", /pe\.ratioCommentary/.test(pdf));
  check("ebit commentary rendered", /pe\.ebitCommentary/.test(pdf));
  check("pat commentary rendered", /pe\.patCommentary/.test(pdf));
  check("quarterly commentary rendered", /pe\.quarterlyResultsCommentary/.test(pdf));
  check("no hardcoded succession claim", !/maintains active succession planning/.test(pdf));
  check("no hardcoded compensation claim", !/Executive compensation frameworks incorporate multi-year performance criteria/.test(pdf));
  check("no unconditional solvency claim", !/confirming top-tier solvency protection/.test(pdf));
  check("no unconditional self-funding claim", !/self-funding capability firmly established/.test(pdf));
  check("no template revenue boilerplate", !/Forecast revenues reflect discrete multi-stage DCF modeling incorporating baseline organic market growth/.test(pdf));
  check("no template bank loan boilerplate", !/disciplined loan compounding across prime retail and corporate books/.test(pdf));
  check("no template asset-mgmt ARR boilerplate", !/baseline AUM organic net inflows/.test(pdf));
  const client = fs.readFileSync(path.join(process.cwd(), "src", "app", "report", "[ticker]", "ReportClient.tsx"), "utf8");
  check("canonical adapter projection applied", /adaptCanonicalResearchPackage/.test(client));
  check("canonical package authority retained", /canonicalPackage/.test(client) && /isBlocked/.test(client));
  check("publication quality gates rendering", /quality\.canPublish/.test(client));
}

// ── E. Salvage wired into the live path ───────────────────────────────
console.log("\n[E] Salvage wired");
{
  const router = fs.readFileSync(path.join(process.cwd(), "src", "lib", "openrouter.ts"), "utf8");
  check("openrouter imports salvage", /json-salvage/.test(router));
  check("extract path uses salvage", /salvageTruncatedJsonObject/.test(router));
  check("governance budget raised", /8000, 0\.35/.test(router));
}

console.log(`\ncontent-delivery: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
