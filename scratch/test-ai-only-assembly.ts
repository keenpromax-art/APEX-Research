import { generateAIAnalysis } from "../src/lib/openrouter";

console.log("=======================================================");
console.log("TESTING AI-ONLY ASSEMBLY (no template prose in dossier)");
console.log("=======================================================\n");

let allPassed = true;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ FAILED: ${name}${extra ? " — " + extra : ""}`);
    allPassed = false;
  }
}

const profile: any = {
  ticker: "RELIANCE.NS",
  name: "Reliance Industries",
  sector: "Energy",
  industry: "Oil & Gas Refining & Marketing",
  country: "India",
  currency: "INR",
  exchange: "NSE",
  description: "Energy conglomerate with refining, petrochemicals, retail and digital services.",
};
const stockData: any = {
  ticker: "RELIANCE.NS",
  currentPrice: 1226.4,
  sharesOutstanding: 13500000000,
  marketCap: 16500000000000,
  beta: 0.9,
  pe: 24,
  dividendYield: 0.007,
};
const fin = (year: string, revenue: number, netIncome: number): any => ({
  year,
  revenue,
  grossProfit: revenue * 0.3,
  ebitda: revenue * 0.18,
  operatingIncome: revenue * 0.14,
  netIncome,
  eps: 50,
  totalDebt: 3000000000000,
  cash: 500000000000,
  totalAssets: 15000000000000,
  totalLiabilities: 7000000000000,
  totalEquity: 8000000000000,
  operatingCashFlow: revenue * 0.12,
  capitalExpenditures: revenue * 0.08,
  freeCashFlow: revenue * 0.04,
  sharesOutstanding: 13500000000,
});
const dcf: any = {
  currentMarketPrice: 1226.4,
  intrinsicValue: 1450.0,
  upsideDownside: 0.1824,
  verdict: "BUY",
  enterpriseValue: 20000000000000,
  equityValue: 19500000000000,
  sharesOutstanding: 13500000000,
  assumptions: { wacc: 0.095, terminalGrowthRate: 0.04, marginalTaxRate: 0.25 },
};

// Old-style checkpoint slices (pre-extension: no orphan fields) with markers.
const resumeFrom: Record<string, unknown> = {
  strategist: {
    investmentThesis: "AI-THESIS-MARKER buying momentum on refining margins.",
    companyOverview: "AI-OVERVIEW-MARKER energy conglomerate overview text here.",
  },
  news: { catalysts: [{ event: "AI-CATALYST-MARKER", horizon: "3-6 Months", probability: "High", impact: "+5%" }] },
  moat: { moatSources: { switchingCosts: "AI-SWITCH-MARKER costs are sticky here.", intangibleAssets: "x", costAdvantage: "y", moatTrend: "Stable" } },
  forensic: { revenueCommentary: "AI-REVENUE-MARKER revenue grew well across segments this year.", dupontCommentary: "AI-DUPONT-MARKER roe decomposed here." },
  credit: { creditAnalysisCommentary: { financialHealth: "AI-CREDIT-MARKER balance sheet is strong." } },
  governance: { managementCommentary: "AI-MGMT-MARKER leadership executes its stated strategy well.", governanceCommentary: "AI-GOV-MARKER board is independent." },
  news_summary: { newsSummary: { executiveNewsSummary: "AI-NEWS-MARKER steady disclosure cadence continues." } },
};

const events: string[] = [];
async function main() {
const out = await generateAIAnalysis(
  profile,
  stockData,
  [fin("FY2023", 8000000000000, 600000000000), fin("FY2024", 9000000000000, 700000000000)],
  dcf,
  [],
  (e) => events.push(`${e.type}:${e.agentId}:${e.durationMs ?? "-"}`),
  null,
  null,
  resumeFrom
);

// 1. Identity: checkpoint prose flows through byte-identical (no template merge).
check("thesis identity (no merge)", (out as any).investmentThesis === (resumeFrom.strategist as any).investmentThesis);
check("overview identity", (out as any).companyOverview === (resumeFrom.strategist as any).companyOverview);
check("catalyst identity", JSON.stringify((out as any).catalysts) === JSON.stringify((resumeFrom.news as any).catalysts));
check("moat source identity", (out as any).moatSources.switchingCosts === "AI-SWITCH-MARKER costs are sticky here.");

// 2. Orphan fields stay empty when the checkpoint predates them (no fill).
const orphans: Record<string, unknown> = {
  summary: (out as any).summary,
  dcfCommentary: (out as any).dcfCommentary,
  economicContext: (out as any).economicContext,
  industryDynamicsCommentary: (out as any).industryDynamicsCommentary,
  globalIndustryAnalysis: (out as any).globalIndustryAnalysis,
  domesticIndustryAnalysis: (out as any).domesticIndustryAnalysis,
  businessStrategyCommentary: (out as any).businessStrategyCommentary,
  operatingProfileCommentary: (out as any).operatingProfileCommentary,
  segmentAnalysis: (out as any).segmentAnalysis,
  quarterlyResultsCommentary: (out as any).quarterlyResultsCommentary,
};
for (const [k, v] of Object.entries(orphans)) {
  check(`orphan ${k} empty (no template)`, v === "", `got ${JSON.stringify(v)?.slice(0, 80)}`);
}
check("enterpriseRisk empty", Array.isArray((out as any).enterpriseRiskCommentary) && (out as any).enterpriseRiskCommentary.length === 0);
check("analystNotes empty", Array.isArray((out as any).analystNotes) && (out as any).analystNotes.length === 0);

// 3. No deterministic template markers anywhere in the dossier.
const blob = JSON.stringify(out);
for (const marker of ["structured duopoly", "three pillars", "blended realization", "consistent operational cadence", "dark store", "O&M", "migrating customer mix"]) {
  check(`no template marker "${marker}"`, !blob.toLowerCase().includes(marker.toLowerCase()));
}

// 4. All 7 council agents resumed from checkpoint with zero LLM calls
// (durationMs 0). The 8th completion is the verifier's honest offline audit.
const resumed = events.filter((e) => e.startsWith("agent_complete:") && e.endsWith(":0"));
check("7 agents checkpoint-resumed (0 LLM calls)", resumed.length === 7, `got ${resumed.length}: ${resumed.join(",")}`);

// 5. Verifier without key → honest FLAGGED audit (no invented verification).
check("verifier FLAGGED offline", (out as any).councilVerification?.status === "FLAGGED");

if (allPassed) {
  console.log("\n=======================================================");
  console.log("SUCCESS: DOSSIER IS AI-ONLY — ZERO TEMPLATE PROSE");
  console.log("=======================================================");
  process.exit(0);
} else {
  console.error("\nFAILURE: template prose leaked into the dossier.");
  process.exit(1);
}
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
