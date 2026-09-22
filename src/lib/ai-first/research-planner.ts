/**
 * APEX RESEARCH — RESEARCH PLANNER (AI)
 *
 * Before modeling, AI asks: "What information do I need before I can build
 * a high-quality institutional model?"
 *
 * Output is consumed as questions for evidence layer; gaps become
 * `missingInformation` in AnalystBrief and lower confidence.
 */

import type { FactPack, CompanyUnderstanding } from "./types";
import { parseLlmJson } from "./llm";
import type { HistoricalAnalysisPack } from "./historical-analysis";
import { buildHistoricalAnalysisPack } from "./historical-analysis";

export type PlannerTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface ResearchQuestion {
  question: string;
  why: string;
  requiredFor: string; // model | valuation | thesis | risk | etc
  yfinanceAvailable: boolean;
  evidenceNeeded: string; // filing/presentation/call/consensus/regulatory etc
}

export interface ResearchPlan {
  questions: ResearchQuestion[];
  unknowns: string[];
  requiredResearch: string[];
  epistemicSummary: string; // known vs inferred vs unknown
}

const SYSTEM_PROMPT = `You are a senior equity research analyst creating a research plan BEFORE building a financial model.

You receive the company fact pack (yfinance), the AI's company understanding, and the deterministic historical analysis pack (derived CAGR, margins, ROE, FCF, leverage).

TASK:
Identify what information you NEED before you can build a high-quality institutional model.

Return ONLY JSON:
{
  "questions": [
    { "question": "What are CRISIL's actual operating segments?", "why": "Segments determine revenue driver decomposition", "requiredFor": "model", "yfinanceAvailable": false, "evidenceNeeded": "Latest annual report segment note" }
  ],
  "unknowns": ["Segment-level revenue contribution", "Management's current growth guidance"],
  "requiredResearch": ["Latest management presentation", "Latest annual report", "Latest earnings call", "Exchange filings"],
  "epistemicSummary": "KNOWN: ... INFERRED: ... UNKNOWN: ..."
}

RULES:
- Distinguish KNOWN (yfinance filing), INFERRED (you guessed from data), UNKNOWN (cannot know from yfinance).
- Every question must tie to an economic driver or valuation input.
- Never hallucinate facts — if evidence is missing, mark it as missing and lower confidence.
- Source hierarchy: Tier1 filing/government > Tier2 presentation/call > Tier3 broker/industry > Tier4 database (yfinance) > Tier5 news > Tier6 inference. Never present Tier6 as Tier1.
`;

export function researchPlannerContext(
  pack: FactPack,
  understanding: CompanyUnderstanding,
  hist: HistoricalAnalysisPack
): string {
  const revLine = hist.revenueSeries.length ? `Revenue: ${hist.revenueSeries.map((r) => `${r.period} ${r.value}`).join(" | ")}` : "Revenue: N/A";
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `What it does: ${understanding.whatItDoes.slice(0, 600)}`,
    `How it makes money: ${understanding.howItMakesMoney.slice(0, 400)}`,
    `Primary abstraction: ${understanding.primaryEconomicAbstraction}`,
    `Segments: ${understanding.businessSegments.map((s) => s.name).join(", ") || "(none — missing)"}`,
    `Revenue drivers: ${understanding.revenueDrivers.map((d) => d.name).join(", ")}`,
    `KPIs: ${understanding.keyKpis.map((k) => k.name).join(", ")}`,
    `Metrics to avoid: ${understanding.metricsToAvoid.map((m) => m.metric).join(", ") || "(none)"}`,
    `Confidence: ${understanding.confidence.overall} — ${understanding.confidence.reasoning.slice(0, 300)}`,
    "",
    `HISTORICAL DERIVED:`,
    ...hist.summaryLines.slice(0, 25),
    "",
    `YFINANCE STATEMENT LINES AVAILABLE:`,
    `income: ${[...new Set(pack.incomeStatement.facts.map((f) => f.metric))].slice(0, 30).join(", ") || "none"}`,
    `balance: ${[...new Set(pack.balanceSheet.facts.map((f) => f.metric))].slice(0, 30).join(", ") || "none"}`,
    `cash: ${[...new Set(pack.cashFlow.facts.map((f) => f.metric))].slice(0, 20).join(", ") || "none"}`,
  ].join("\n");
}

export async function buildResearchPlan(
  transport: PlannerTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding
): Promise<ResearchPlan> {
  const hist = buildHistoricalAnalysisPack(pack);
  const ctx = researchPlannerContext(pack, understanding, hist);
  const user = `RESEARCH CONTEXT\n================\n${ctx}\n\nTASK\n====\nCreate the research plan for ${understanding.companyName} now.\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.25, maxTokens: 2500, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.questions)) throw new Error(`Research planner returned unparseable output for ${pack.ticker}`);
  return {
    questions: parsed.questions.map((q: any) => ({
      question: String(q?.question || ""),
      why: String(q?.why || ""),
      requiredFor: String(q?.requiredFor || "model"),
      yfinanceAvailable: !!q?.yfinanceAvailable,
      evidenceNeeded: String(q?.evidenceNeeded || ""),
    })).filter((q: ResearchQuestion) => q.question),
    unknowns: Array.isArray(parsed.unknowns) ? parsed.unknowns.map(String) : [],
    requiredResearch: Array.isArray(parsed.requiredResearch) ? parsed.requiredResearch.map(String) : [],
    epistemicSummary: String(parsed.epistemicSummary || ""),
  };
}

export function mechanicalResearchPlan(pack: FactPack, understanding: CompanyUnderstanding): ResearchPlan {
  const hist = buildHistoricalAnalysisPack(pack);
  const unknowns: string[] = [];
  if (!understanding.businessSegments.length) unknowns.push("Segment-level revenue contribution (requires filings, not in yfinance)");
  if (hist.revenueSeries.length < 3) unknowns.push("Multi-year segment economics — insufficient yfinance history");
  unknowns.push("Management guidance, order book, regulatory changes, competitive positioning (requires filings/calls)");
  return {
    questions: [
      { question: `What are ${understanding.companyName}'s actual operating segments and their economics?`, why: "Segments determineRevenue driver decomposition", requiredFor: "model", yfinanceAvailable: false, evidenceNeeded: "Latest annual report segment note" },
      { question: "What is management's current growth and margin guidance?", why: "Anchors forecast vs history", requiredFor: "forecast", yfinanceAvailable: false, evidenceNeeded: "Latest earnings call + presentation" },
      { question: "What regulatory/capital constraints apply?", why: "For banks/NBFCs/utilities regulatory determines economics", requiredFor: "valuation", yfinanceAvailable: false, evidenceNeeded: "Regulator filings" },
      { question: "Which valuation method does the market actually use for this company?", why: "Determines appropriate methodology", requiredFor: "valuation", yfinanceAvailable: false, evidenceNeeded: "Broker consensus, peer multiples" },
    ],
    unknowns,
    requiredResearch: ["Latest annual report", "Latest investor presentation", "Latest earnings call transcript", "Exchange filings"],
    epistemicSummary: `KNOWN: ${understanding.whatItDoes.slice(0, 120)} | INFERRED: ${understanding.howItMakesMoney.slice(0, 120)} | UNKNOWN: ${unknowns.slice(0, 3).join("; ")}`,
  };
}

export default { buildResearchPlan, mechanicalResearchPlan, researchPlannerContext };
