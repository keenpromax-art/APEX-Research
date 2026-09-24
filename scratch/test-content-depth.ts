/**
 * APEX RESEARCH — Content Depth Tests
 * ------------------------------------
 * Bland reports come from (a) AI prompts with no length contract and small
 * token budgets, and (b) a deterministic fallback with filler sentences and
 * hardcoded Big-Tech moat pillars. This suite pins the fix:
 *
 *  1. Shared depth-guidance module: 8 stages, budgets, paragraph minimums.
 *  2. All 8 ai-first builders wired to it (prompt + tokens).
 *  3. ResearchDNA depth emphasis (depthBriefForIdentity) deterministic.
 *  4. Fallback richness: multi-year trajectories, no filler, no hardcoded
 *     pillars, no prompt-leak clauses, loss-making honesty, determinism.
 *  5. Guards intact: sector guardrail, sanitizer bleed rules, JSON shapes.
 *
 * Run: npx tsx scratch/test-content-depth.ts (exit 1 on failure)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEPTH_DIRECTIVES,
  DEPTH_EVIDENCE_GUARD,
  DEPTH_TOKEN_BUDGETS,
  depthBriefForIdentity,
  type DepthStage,
} from "../src/lib/ai-first/depth-guidance";
import { generateDataDrivenFallback } from "../src/lib/pe-analysis-engine";
import { mechanicalUnderstanding } from "../src/lib/ai-first/pipeline";
import type { FactPack } from "../src/lib/ai-first/types";
import { buildSectorGuardrail } from "../src/lib/openrouter";
import { sanitizeSectorBleed } from "../src/lib/ai/sanitizer";
import { buildResearchOperatingModel } from "../src/lib/research-model";

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

const STAGES: DepthStage[] = [
  "understanding",
  "economicEngine",
  "debates",
  "narrative",
  "discovery",
  "model",
  "scenarios",
  "valuation",
];

// ── 1. Depth guidance module ──────────────────────────────────────────
console.log("\n[1] Depth guidance module");
{
  check("8 stages present", STAGES.every((s) => typeof DEPTH_DIRECTIVES[s] === "string" && DEPTH_DIRECTIVES[s].length > 200));
  check("understanding budget 5000", DEPTH_TOKEN_BUDGETS.understanding >= 5000, `${DEPTH_TOKEN_BUDGETS.understanding}`);
  check("economicEngine budget 5000", DEPTH_TOKEN_BUDGETS.economicEngine >= 5000);
  check("debates budget 5000", DEPTH_TOKEN_BUDGETS.debates >= 5000);
  check("narrative budget 6000", DEPTH_TOKEN_BUDGETS.narrative >= 6000, `${DEPTH_TOKEN_BUDGETS.narrative}`);
  check("discovery budget 6000", DEPTH_TOKEN_BUDGETS.discovery >= 6000);
  check("model budget 4500", DEPTH_TOKEN_BUDGETS.model >= 4500);
  check("scenarios budget 4000", DEPTH_TOKEN_BUDGETS.scenarios >= 4000);
  check("valuation budget 4000", DEPTH_TOKEN_BUDGETS.valuation >= 4000);
  check("narrative demands 3-4 thesis paragraphs", /3-4 full paragraphs/i.test(DEPTH_DIRECTIVES.narrative));
  check("narrative demands 5-8 risks", /5-8 items/i.test(DEPTH_DIRECTIVES.narrative));
  check("narrative demands 4-8 catalysts", /4-8 items/i.test(DEPTH_DIRECTIVES.narrative));
  check("understanding demands 4-6 sentence whatItDoes", /4-6 sentences/i.test(DEPTH_DIRECTIVES.understanding));
  check("debates demand 3-5 debates", /3-5 debates/i.test(DEPTH_DIRECTIVES.debates));
  check("every directive carries evidence guard", STAGES.every((s) => DEPTH_DIRECTIVES[s].includes(DEPTH_EVIDENCE_GUARD)));
  check("guard forbids new numbers", /NEVER new numbers/i.test(DEPTH_EVIDENCE_GUARD));
  check("guard demands evidence citation", /\[F-\.\.\.\] fact or canonical output/i.test(DEPTH_EVIDENCE_GUARD));
}

// ── 2. Builder wiring ─────────────────────────────────────────────────
console.log("\n[2] Builder wiring");
{
  const lib = path.join(process.cwd(), "src", "lib", "ai-first");
  const files: Record<string, string> = {
    understanding: "company-understanding.ts",
    economicEngine: "economic-engine.ts",
    debates: "debate-engine.ts",
    narrative: "narrative-builders.ts",
    discovery: "research-discovery.ts",
    model: "model-builder.ts",
    scenarios: "scenarios-builder.ts",
    valuation: "valuation-builder.ts",
  };
  for (const [stage, file] of Object.entries(files)) {
    const text = fs.readFileSync(path.join(lib, file), "utf8");
    check(`${stage} imports depth-guidance`, text.includes("depth-guidance"), file);
    check(`${stage} uses directive`, text.includes("DEPTH_DIRECTIVES."), file);
    check(`${stage} uses token budget`, text.includes("DEPTH_TOKEN_BUDGETS."), file);
  }
  const debateText = fs.readFileSync(path.join(lib, files.debates), "utf8");
  check("debate budget used in both paths", (debateText.match(/DEPTH_TOKEN_BUDGETS\.debates/g) || []).length >= 2);
}

// ── 3. Identity depth brief ───────────────────────────────────────────
console.log("\n[3] Identity depth brief");
{
  const brief = depthBriefForIdentity({
    ticker: "BANK.NS",
    economicType: "deposit-funded-bank",
    questionType: "balance-sheet-franchise",
    investorQuestion: "Can the bank compound deposits while sustaining asset quality?",
    coreTopics: ["funding-liquidity", "asset-quality"],
    suppressedTopics: ["sum-of-parts"],
    signatureTitles: ["ROE decomposition"],
    narrativeArchetype: "credit",
  });
  check("brief names economic machine", brief.includes("deposit-funded-bank"));
  check("brief carries investor question", brief.includes("compound deposits"));
  check("brief expands core topics", brief.includes("funding-liquidity"));
  check("brief suppresses immaterial", brief.includes("SUPPRESSED") && brief.includes("sum-of-parts"));
  check("brief names signatures", brief.includes("ROE decomposition"));
  check("brief deterministic", brief === depthBriefForIdentity({
    ticker: "BANK.NS",
    economicType: "deposit-funded-bank",
    questionType: "balance-sheet-franchise",
    investorQuestion: "Can the bank compound deposits while sustaining asset quality?",
    coreTopics: ["funding-liquidity", "asset-quality"],
    suppressedTopics: ["sum-of-parts"],
    signatureTitles: ["ROE decomposition"],
    narrativeArchetype: "credit",
  }));
  check("brief invents no numbers", !/\d{2,}%|\$\d|Rs\.\s*\d/.test(brief));
}

// ── 4. Fallback richness ──────────────────────────────────────────────
console.log("\n[4] Fallback richness");
function fixture(over: { netIncome?: number; fcf?: number; dividends?: number } = {}) {
  const profile = {
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
    officers: [],
  };
  const stock = {
    currentPrice: 100, previousClose: 99, open: 99, dayHigh: 101, dayLow: 98,
    marketCap: 100e9, enterpriseValue: 110e9, pe: 20, forwardPE: 18, pb: 3, ps: 4,
    dividendYield: 0.01, dividendRate: 1, beta: 1.1, week52High: 120, week52Low: 80,
    sharesOutstanding: 1e9, floatShares: 8e8, avgVolume: 1e6, volume: 1.1e6,
    fiftyDayAvg: 102, twoHundredDayAvg: 98, eps: 5, forwardEps: 5.5, bookValue: 33,
    priceToBook: 3, returnOnEquity: 0.15, returnOnAssets: 0.07, debtToEquity: 0.5,
    currentRatio: 1.5, quickRatio: 1.2, grossMargins: 0.4, ebitdaMargins: 0.2,
    operatingMargins: 0.15, profitMargins: 0.1, freeCashflow: 8e9, totalDebt: 20e9,
    totalCash: 10e9, revenueGrowth: 0.1, earningsGrowth: 0.08, recommendationKey: "buy",
    numberOfAnalystOpinions: 20, targetHighPrice: 130, targetLowPrice: 90, targetMeanPrice: 115,
  };
  const yr = (year: string, rev: number, ni: number, extra: Record<string, number> = {}) => ({
    year, fiscalYearEnd: `${year}-03-31`, statementType: "corporate", isFinancialInstitution: false,
    revenue: rev, costOfRevenue: rev * 0.6, grossProfit: rev * 0.4, grossMargin: 0.4,
    researchDevelopment: rev * 0.03, sellingGeneralAdministrative: rev * 0.12,
    totalOperatingExpenses: rev * 0.15, operatingIncome: rev * 0.18, ebitda: rev * 0.2,
    ebitdaMargin: 0.2, ebitMargin: 0.18, interestExpense: rev * 0.01, otherIncome: rev * 0.005,
    pretaxIncome: rev * 0.175, incomeTaxExpense: rev * 0.045, netIncome: ni,
    netMargin: ni / rev, depreciation: rev * 0.02, eps: 5, dilutedEps: 5, sharesOutstanding: 1e9,
    totalAssets: 80e9, totalLiabilities: 50e9, totalEquity: 30e9, cash: 8e9,
    shortTermInvestments: 2e9, netReceivables: 6e9, inventory: 5e9, currentAssets: 20e9,
    netFixedAssets: 30e9, totalDebt: 10e9, shortTermDebt: 3e9, longTermDebt: 7e9,
    accountsPayable: 4e9, currentLiabilities: 12e9, netWorkingCapital: 8e9,
    operatingCashFlow: 7e9, capitalExpenditures: 3e9,
    freeCashFlow: over.fcf ?? 4e9, investingCashFlow: -3e9, financingCashFlow: -2e9,
    dividendsPaid: over.dividends ?? 1.5e9, changeInCash: 1e9, goodwill: 0, otherIntangibles: 0,
    ...extra,
  });
  const annuals = [yr("FY22", 40e9, 4e9), yr("FY23", 45e9, 4.5e9), yr("FY24", 50e9, over.netIncome ?? 5e9)];
  const dcf = {
    intrinsicValue: 120, currentMarketPrice: 100, verdict: "BUY",
    assumptions: { wacc: 0.1, terminalGrowthRate: 0.04 },
  };
  return { profile, stock, annuals, dcf };
}
{
  const { profile, stock, annuals, dcf } = fixture();
  const out = generateDataDrivenFallback(profile as never, stock as never, annuals as never, dcf as never);
  const all = JSON.stringify(out);
  check("strategy is multi-paragraph depth", (out.businessStrategyCommentary || "").length > 1200, `${(out.businessStrategyCommentary || "").length}`);
  check("revenue carries YoY trajectory", /FY2[234].*%.*FY2[234]/s.test(out.revenueCommentary || "") || (out.revenueCommentary || "").includes("trajectory"));
  check("ebitda carries margin series", (out.ebitdaCommentary || "").length > 350 && /margins printed|margin.*→|margin series/i.test(out.ebitdaCommentary || ""));
  check("cashflow addresses conversion quality", /conversion|accrual/i.test(out.cashFlowCommentary || ""));
  check("dupont is forensic (2-paragraph)", (out.dupontCommentary || "").length > 450 && /forensic read|Decomposition/i.test(out.dupontCommentary || ""));
  check("quarterly has watchlist", /watch/i.test(out.quarterlyResultsCommentary || ""));
  check("risks carry transmission", /Transmission/i.test(JSON.stringify(out.keyRisks)));
  check("no supplier filler", !all.includes("assessed from input cost trends"));
  check("no substitute filler", !all.includes("evaluated from product differentiation"));
  check("no repurchase filler", !all.includes("assessed from treasury stock"));
  check("no governance filler", !all.includes("evaluated from available regulatory disclosures"));
  check("no prompt-leak page language", !all.includes("without constraint on page length") && !all.includes("depth is prioritized over brevity") && !all.includes("No page limit is imposed"));
  check("no hardcoded Big-Tech pillars", !all.includes("search index scale") && !all.includes("advertiser bidding") && !all.includes("custom silicon") && !all.includes("YouTube monetization"));
  check("pillars company-native", (out.moatPillars || []).every((p) => /trailing revenue|ROIC|margin|market capitalization/i.test(p.rationale)), JSON.stringify((out.moatPillars || []).map((p) => p.pillar)));
  check("operating profile present", (out.operatingProfileCommentary || "").length > 500);
  check("enterprise risks structured", (out.enterpriseRiskCommentary || []).length >= 3 && (out.enterpriseRiskCommentary || []).every((r) => r.severity && r.description && r.mitigation));
  check("summary is executive-grade", (out.summary || "").length > 250 && /Key risk|Watch/i.test(out.summary || ""));
  check("conclusion has corridor", /corridor|downside to|upside toward/i.test(out.investmentConclusion || ""));
  check("global differs from domestic", (out.globalIndustryAnalysis || "") !== (out.domesticIndustryAnalysis || ""));
  check("capital allocation deep", (out.capitalAllocationCommentary || "").length > 500);
  check("moat verdict paragraph", (out.competitiveMoat || "").length > 400 && /Verdict/i.test(out.competitiveMoat || ""));
  const again = generateDataDrivenFallback(profile as never, stock as never, annuals as never, dcf as never);
  check("fallback deterministic", JSON.stringify(out) === JSON.stringify(again));
}
{
  // Loss-making + cash-consuming fixture: fail-closed honesty.
  const { profile, stock, annuals, dcf } = fixture({ netIncome: -2e9, fcf: -3e9, dividends: 1e9 });
  const out = generateDataDrivenFallback(profile as never, stock as never, annuals as never, dcf as never);
  const cash = out.cashFlowCommentary || "";
  check("no self-funding claim on negative FCF", !/self-funding growth is evidenced|comfortably covers the dividend/i.test(cash), cash.slice(0, 200));
  check("dividends on losses flagged honestly", /reserves, not current earnings|requires an earnings recovery/i.test(out.managementCommentary || ""), (out.managementCommentary || "").slice(0, 200));
}

// ── 5. Mechanical path (no AI key) carries computed depth ─────────────
console.log("\n[5] Mechanical understanding depth");
{
  const f = (metric: string, value: number | undefined, text?: string): FactPack["company"]["facts"][number] => ({
    metric, label: metric, value, textValue: text, period: "FY24", source: "yfinance", ticker: "T.NS", retrievalTimestamp: "2026-01-01",
  });
  const sec = (name: string, facts: FactPack["company"]["facts"]): FactPack["company"] => ({ name, facts });
  const pack: FactPack = {
    ticker: "T.NS",
    company: sec("company", [f("companyName", undefined, "T Ltd"), f("description", undefined, "T Ltd makes industrial machinery."), f("sector", undefined, "Industrials"), f("industry", undefined, "Machinery")]),
    market: sec("market", []),
    incomeStatement: sec("incomeStatement", [f("totalRevenue", 40e9), f("totalRevenue", 45e9), f("totalRevenue", 50e9), f("netIncome", 5e9)]),
    balanceSheet: sec("balanceSheet", [f("totalDebt", 10e9), f("totalEquity", 30e9)]),
    cashFlow: sec("cashFlow", [f("operatingCashFlow", 7e9)]),
    shares: sec("shares", []), earnings: sec("earnings", []), estimates: sec("estimates", []),
    corporateActions: sec("corporateActions", []), priceHistory: sec("priceHistory", []), holders: sec("holders", []),
    retrievalTimestamp: "2026-01-01", version: "1",
  };
  // Note: duplicate-metric histories collapse to latest-only in latestMetric,
  // but revenueSeries reads all revenue facts — periods need distinct facts.
  const u = mechanicalUnderstanding(pack);
  check("mechanical whatItDoes computed", u.whatItDoes.length > 150 && /trailing revenue|CAGR|period/i.test(u.whatItDoes), u.whatItDoes.slice(0, 160));
  check("mechanical howItMakesMoney computed", /margin|CAGR|conversion/i.test(u.howItMakesMoney));
  check("mechanical has margin + cash + leverage drivers", u.marginDrivers.length > 0 && u.cashGenerationDrivers.length > 0 && u.balanceSheetDrivers.length > 0);
  check("mechanical stays honest", /Mechanical preview|no AI|requires/i.test(u.whatItDoes) && u.confidence.overall <= 0.3);
  check("mechanical invents no segments", u.businessSegments.length === 0);
}

// ── 6. Guards intact ──────────────────────────────────────────────────
console.log("\n[6] Guards intact");{
  const profile = {
    ticker: "BANK.NS", name: "Deposit Bank Ltd", exchange: "NSE", sector: "Financial Services",
    industry: "Banks - Regional", country: "India", currency: "INR", description: "Takes deposits and lends.",
    website: "", employees: 1, officers: [],
  };
  const guardrail = buildSectorGuardrail(profile as never);
  check("guardrail binds forbidden terms", /FORBIDDEN/i.test(guardrail) && guardrail.length > 500);
  const model = buildResearchOperatingModel({ profile: profile as never });
  const dirty = { competitiveMoat: "Strong spectrum auction wins and tower tenancy drive the moat." };
  const cleaned = sanitizeSectorBleed(dirty, model as never);
  check("sanitizer still strips bleed", !JSON.stringify(cleaned).includes("spectrum auction"));
  const { profile: p2, stock: s2, annuals: a2, dcf: d2 } = fixture();
  const out = generateDataDrivenFallback(p2 as never, s2 as never, a2 as never, d2 as never);
  check("fallback JSON shape intact", typeof out.summary === "string" && Array.isArray(out.swotStrengths) && Array.isArray(out.fiveForces) && typeof out.dcfCommentary === "string");
}

console.log(`\ncontent-depth: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
