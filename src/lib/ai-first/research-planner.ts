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
import type { ResearchRetrievalSourceType } from "../research-retrieval/types";
import { createStableId } from "../research-ledger/stable";
import { parseLlmJson } from "./llm";
import type { HistoricalAnalysisPack } from "./historical-analysis";
import { buildHistoricalAnalysisPack } from "./historical-analysis";

export type ResearchRetrievalTaskStatus = "pending" | "running" | "completed" | "partial" | "failed" | "blocked" | "unavailable";

export interface ResearchRetrievalTask {
  id: string;
  task: string;
  question: string;
  sourceType: ResearchRetrievalSourceType;
  query: string;
  priority: number;
  asOf: string;
  dependencies: string[];
  status: ResearchRetrievalTaskStatus;
  attempts: number;
  resultRefs: string[];
  blocker?: string;
  requiredFor?: string;
}

export type RetrievalTask = ResearchRetrievalTask;
export type RetrievalTaskQueue = ResearchRetrievalTask[];

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
  dependencies?: string[];
}

export interface ResearchPlan {
  questions: ResearchQuestion[];
  unknowns: string[];
  requiredResearch: string[];
  epistemicSummary: string;
  asOf?: string;
  retrievalTasks?: ResearchRetrievalTask[];
  retrievalTaskQueue?: ResearchRetrievalTask[];
  taskQueue?: ResearchRetrievalTask[];
  tasks?: ResearchRetrievalTask[];
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

export function inferResearchSourceType(value: string): ResearchRetrievalSourceType {
  const normalized = value.toLowerCase();
  if (/annual report|10-k|20-f|annual filing/.test(normalized)) return "annual_report";
  if (/quarter|10-q/.test(normalized)) return "quarterly_report";
  if (/presentation|investor|slide/.test(normalized)) return "investor_presentation";
  if (/earnings call|transcript|conference call/.test(normalized)) return "earnings_call";
  if (/regulator|regulatory|sec|government/.test(normalized)) return "regulatory_filing";
  if (/exchange filing|filing/.test(normalized)) return "exchange_filing";
  if (/market data|price|quote/.test(normalized)) return "market_data";
  if (/database|consensus|broker/.test(normalized)) return "secondary_database";
  if (/news/.test(normalized)) return "news";
  return "unknown";
}

function retrievalTask(input: {
  id: string;
  task: string;
  question: string;
  sourceType: ResearchRetrievalSourceType;
  query: string;
  priority: number;
  asOf: string;
  dependencies?: string[];
  requiredFor?: string;
}): ResearchRetrievalTask {
  return {
    id: input.id,
    task: input.task,
    question: input.question,
    sourceType: input.sourceType,
    query: input.query,
    priority: input.priority,
    asOf: input.asOf,
    dependencies: [...new Set(input.dependencies ?? [])].sort(),
    status: "pending",
    attempts: 0,
    resultRefs: [],
    ...(input.requiredFor ? { requiredFor: input.requiredFor } : {}),
  };
}

export function compileResearchRetrievalTasks(
  plan: Pick<ResearchPlan, "questions" | "unknowns" | "requiredResearch" | "asOf" | "retrievalTasks">,
  options: { asOf?: string } = {},
): ResearchRetrievalTask[] {
  const asOf = options.asOf ?? plan.asOf ?? "unknown";
  const existing = plan.retrievalTasks ?? [];
  const tasks: ResearchRetrievalTask[] = existing.map((task) => ({
    ...task,
    dependencies: [...new Set(task.dependencies ?? [])].sort(),
    resultRefs: [...new Set(task.resultRefs ?? [])].sort(),
    status: task.status ?? "pending",
    attempts: task.attempts ?? 0,
  }));
  const known = new Set(tasks.map((task) => `${task.question}|${task.sourceType}`));
  const add = (task: ResearchRetrievalTask): void => {
    const key = `${task.question}|${task.sourceType}`;
    if (known.has(key)) return;
    known.add(key);
    tasks.push(task);
  };
  for (const question of plan.questions ?? []) {
    const evidence = question.evidenceNeeded?.trim() ?? "";
    const sourceType = inferResearchSourceType(`${evidence} ${question.question}`);
    add(retrievalTask({
      id: createStableId("TASK", { kind: "question", question: question.question, evidence }, "research-planner/retrieval-task/v1"),
      task: "research_question",
      question: question.question,
      sourceType,
      query: [evidence, question.question].filter(Boolean).join(" — "),
      priority: 10,
      asOf,
      dependencies: question.dependencies,
      requiredFor: question.requiredFor,
    }));
  }
  for (const unknown of plan.unknowns ?? []) {
    const value = unknown.trim();
    if (!value) continue;
    add(retrievalTask({
      id: createStableId("TASK", { kind: "unknown", question: value }, "research-planner/retrieval-task/v1"),
      task: "resolve_unknown",
      question: value,
      sourceType: inferResearchSourceType(value),
      query: value,
      priority: 20,
      asOf,
    }));
  }
  for (const required of plan.requiredResearch ?? []) {
    const value = required.trim();
    if (!value) continue;
    add(retrievalTask({
      id: createStableId("TASK", { kind: "required_research", question: value }, "research-planner/retrieval-task/v1"),
      task: "required_research",
      question: value,
      sourceType: inferResearchSourceType(value),
      query: value,
      priority: 30,
      asOf,
    }));
  }
  return tasks.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

export const compileRetrievalTasks = compileResearchRetrievalTasks;
export const buildRetrievalTaskQueue = compileResearchRetrievalTasks;

export async function buildResearchPlan(
  transport: PlannerTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding,
  options: { asOf?: string } = {}
): Promise<ResearchPlan> {
  const hist = buildHistoricalAnalysisPack(pack);
  const ctx = researchPlannerContext(pack, understanding, hist);
  const user = `RESEARCH CONTEXT\n================\n${ctx}\n\nTASK\n====\nCreate the research plan for ${understanding.companyName} now.\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.25, maxTokens: 2500, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.questions)) throw new Error(`Research planner returned unparseable output for ${pack.ticker}`);
  const plan: ResearchPlan = {
    questions: parsed.questions.map((q: any) => ({
      question: String(q?.question || ""),
      why: String(q?.why || ""),
      requiredFor: String(q?.requiredFor || "model"),
      yfinanceAvailable: !!q?.yfinanceAvailable,
      evidenceNeeded: String(q?.evidenceNeeded || ""),
      ...(Array.isArray(q?.dependencies) ? { dependencies: q.dependencies.map(String) } : {}),
    })).filter((q: ResearchQuestion) => q.question),
    unknowns: Array.isArray(parsed.unknowns) ? parsed.unknowns.map(String) : [],
    requiredResearch: Array.isArray(parsed.requiredResearch) ? parsed.requiredResearch.map(String) : [],
    epistemicSummary: String(parsed.epistemicSummary || ""),
    asOf: options.asOf ?? pack.retrievalTimestamp,
  };
  const retrievalTasks = compileResearchRetrievalTasks(plan, { asOf: options.asOf ?? pack.retrievalTimestamp });
  return { ...plan, retrievalTasks, retrievalTaskQueue: retrievalTasks, taskQueue: retrievalTasks, tasks: retrievalTasks };
}

export function mechanicalResearchPlan(pack: FactPack, understanding: CompanyUnderstanding): ResearchPlan {
  const hist = buildHistoricalAnalysisPack(pack);
  const unknowns: string[] = [];
  if (!understanding.businessSegments.length) unknowns.push("Segment-level revenue contribution (requires filings, not in yfinance)");
  if (hist.revenueSeries.length < 3) unknowns.push("Multi-year segment economics — insufficient yfinance history");
  unknowns.push("Management guidance, order book, regulatory changes, competitive positioning (requires filings/calls)");
  const plan: ResearchPlan = {
    questions: [
      { question: `What are ${understanding.companyName}'s actual operating segments and their economics?`, why: "Segments determine revenue driver decomposition", requiredFor: "model", yfinanceAvailable: false, evidenceNeeded: "Latest annual report segment note" },
      { question: "What is management's current growth and margin guidance?", why: "Anchors forecast vs history", requiredFor: "forecast", yfinanceAvailable: false, evidenceNeeded: "Latest earnings call + presentation" },
      { question: "What regulatory/capital constraints apply?", why: "For banks/NBFCs/utilities regulatory determines economics", requiredFor: "valuation", yfinanceAvailable: false, evidenceNeeded: "Regulator filings" },
      { question: "Which valuation method does the market actually use for this company?", why: "Determines appropriate methodology", requiredFor: "valuation", yfinanceAvailable: false, evidenceNeeded: "Broker consensus, peer multiples" },
    ],
    unknowns,
    requiredResearch: ["Latest annual report", "Latest investor presentation", "Latest earnings call transcript", "Exchange filings"],
    epistemicSummary: `KNOWN: ${understanding.whatItDoes.slice(0, 120)} | INFERRED: ${understanding.howItMakesMoney.slice(0, 120)} | UNKNOWN: ${unknowns.slice(0, 3).join("; ")}`,
    asOf: pack.retrievalTimestamp,
  };
  const retrievalTasks = compileResearchRetrievalTasks(plan, { asOf: pack.retrievalTimestamp });
  return { ...plan, retrievalTasks, retrievalTaskQueue: retrievalTasks, taskQueue: retrievalTasks, tasks: retrievalTasks };
}

export default { buildResearchPlan, mechanicalResearchPlan, researchPlannerContext, compileResearchRetrievalTasks };
