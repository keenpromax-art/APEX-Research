/**
 * APEX RESEARCH — ECONOMIC ENGINE AI
 *
 * Dedicated stage after company understanding: asks what variables
 * PHYSICALLY determine revenue, margins, cash flow, and capital requirements
 * for THIS company. Produces statement bindings + value questions that seed
 * the research debate engine and constrain the driver forecast.
 *
 * AI decides the model. Code executes the model.
 */
import type {
  FactPack,
  CompanyUnderstanding,
  BusinessDriver,
  KpiDefinition,
  EconomicEngine,
} from "./types";
import { parseLlmJson } from "./llm";
import { buildHistoricalAnalysisPack } from "./historical-analysis";

export type EconomicEngineTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

const SYSTEM_PROMPT = `You are an institutional equity research analyst building the ECONOMIC ENGINE for ONE company.

You receive: company understanding (drivers/KPIs from a prior AI stage) + yfinance facts + deterministic historical derived metrics.

TASK — What variables PHYSICALLY determine this company's revenue, margins, cash flow and capital requirements?

Output:
1. Refine the six driver families (revenue, cost, margin, cash, balance-sheet, capital, returns) into company-specific mechanisms — not generic "scale/mix" language.
2. statementBindings: for each major driver, which financial statement line it drives and the mechanism (e.g., "azure_consumption → revenue → cloud workload growth × price").
3. valueQuestions: 2-4 falsifiable questions that determine intrinsic value for THIS company (e.g., "Can AI infrastructure capex earn acceptable returns?"). These seed research debates.
4. keyKpis: the observable KPIs that track the engine (company-native names only).
5. metricsToAvoid: metrics that mislead for this company.

RULES:
- Company-specific only. No sector templates. No "operational throughput / high-margin mix / disciplined capital allocation" boilerplate.
- Cite [F-...] fact ids where drivers are grounded in yfinance history.
- If a driver cannot be grounded, mark low confidence and put the gap in valueQuestions or omit.
- Prefer mechanisms that map to executable forecast variables (volume, price, seats, consumption, NIM, units, AUM…).

Respond with ONLY JSON:
{
  "primaryAbstraction": "string",
  "revenueDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "costDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "marginDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "cashDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "balanceSheetDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "capitalDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "returnsDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "keyKpis": [{ "name": "string", "rationale": "string", "availability": "yfinance", "unit": null }],
  "metricsToAvoid": [{ "metric": "string", "reason": "string" }],
  "statementBindings": [{ "statementLine": "string", "drivenBy": "string", "mechanism": "string", "sourceFacts": ["string"] }],
  "valueQuestions": ["string"],
  "confidence": 0.7
}`;

function engineContext(pack: FactPack, u: CompanyUnderstanding, histSummary: string): string {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  const fmtD = (label: string, ds: BusinessDriver[]) =>
    ds.length ? `${label}:\n${ds.map((d) => `- ${d.name}: ${d.mechanism} [${(d.sourceFacts || []).join(",")}]`).join("\n")}` : `${label}: (none)`;
  return [
    `COMPANY: ${u.companyName} (${pack.ticker})`,
    `What it does: ${clip(u.whatItDoes, 700)}`,
    `How it makes money: ${clip(u.howItMakesMoney, 500)}`,
    `Primary abstraction: ${u.primaryEconomicAbstraction}`,
    `Why this company (if known): ${clip(u.whyThisCompany || "", 400) || "(not yet stated)"}`,
    `Segments: ${u.businessSegments.map((s) => s.name).join(", ") || "(none)"}`,
    "",
    fmtD("REVENUE DRIVERS (prior stage)", u.revenueDrivers),
    fmtD("COST DRIVERS", u.costDrivers),
    fmtD("MARGIN DRIVERS", u.marginDrivers),
    fmtD("CASH DRIVERS", u.cashGenerationDrivers),
    fmtD("BALANCE-SHEET DRIVERS", u.balanceSheetDrivers),
    fmtD("RETURNS DRIVERS", u.returnsDrivers),
    "",
    "KPIs:",
    ...u.keyKpis.map((k) => `- ${k.name} (${k.availability}): ${k.rationale}`),
    "METRICS TO AVOID:",
    ...u.metricsToAvoid.map((m) => `- ${m.metric}: ${m.reason}`),
    "",
    "HISTORICAL DERIVED:",
    histSummary,
    "",
    "COMPETITIVE ADVANTAGES (prior stage):",
    ...(u.competitiveAdvantages || []).map((a) => `- ${a.advantage}: ${a.mechanism}`),
    "COMPETITIVE THREATS:",
    ...(u.competitiveThreats || []).map((t) => `- ${t.threat}: ${t.mechanism}`),
    "CURRENT INFLECTIONS:",
    ...(u.currentInflections || []).map((i) => `- ${i}`),
  ].join("\n");
}

function normalizeDriver(d: any): BusinessDriver {
  return {
    name: String(d?.name || "Driver"),
    mechanism: String(d?.mechanism || ""),
    sourceFacts: Array.isArray(d?.sourceFacts) ? d.sourceFacts.map(String) : [],
    statementLine:
      typeof d?.statementLine === "string" && d.statementLine !== "null"
        ? d.statementLine
        : undefined,
  };
}

function normalizeKpi(k: any): KpiDefinition {
  return {
    name: String(k?.name || "KPI"),
    rationale: String(k?.rationale || ""),
    availability: ["yfinance", "modeled", "unavailable"].includes(k?.availability)
      ? k.availability
      : "unavailable",
    unit: typeof k?.unit === "string" && k.unit !== "null" ? k.unit : undefined,
  };
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Mechanical economic engine when no AI transport — honest low-confidence preview. */
export function mechanicalEconomicEngine(
  pack: FactPack,
  u: CompanyUnderstanding
): EconomicEngine {
  const hist = (() => {
    try {
      return buildHistoricalAnalysisPack(pack);
    } catch {
      return null;
    }
  })();
  const revCagr = hist?.derived.find((d) => /revenue cagr/i.test(d.label));
  return {
    ticker: pack.ticker,
    primaryAbstraction: u.primaryEconomicAbstraction || "revenue",
    revenueDrivers: u.revenueDrivers,
    costDrivers: u.costDrivers,
    marginDrivers: u.marginDrivers,
    cashDrivers: u.cashGenerationDrivers,
    balanceSheetDrivers: u.balanceSheetDrivers,
    capitalDrivers: u.capitalEngines || [],
    returnsDrivers: u.returnsDrivers,
    keyKpis: u.keyKpis,
    metricsToAvoid: u.metricsToAvoid,
    statementBindings: u.revenueDrivers
      .filter((d) => d.statementLine)
      .map((d) => ({
        statementLine: d.statementLine!,
        drivenBy: d.name,
        mechanism: d.mechanism,
        sourceFacts: d.sourceFacts,
      })),
    valueQuestions: [
      `Is revenue growth sustainable at historical CAGR${revCagr ? ` (${revCagr.value})` : ""}?`,
      `Do margin drivers support durable operating leverage for ${u.companyName}?`,
      `Is current valuation pricing growth beyond what the economic engine can deliver?`,
    ],
    confidence: 0.3,
  };
}

/** AI economic engine refinement. */
export async function buildEconomicEngine(
  transport: EconomicEngineTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding
): Promise<EconomicEngine> {
  let histSummary = "(historical derived unavailable)";
  try {
    histSummary = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 40).join("\n");
  } catch {}
  const ctx = engineContext(pack, understanding, histSummary);
  const user = `ECONOMIC ENGINE CONTEXT\n=======================\n${ctx}\n\nBuild the economic engine for ${understanding.companyName} now.\n\nRespond with ONLY the JSON object.`;
  const resp = await transport({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.3,
    maxTokens: 3500,
    jsonMode: true,
  });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed) {
    throw new Error(`Economic engine returned unparseable output for ${pack.ticker}`);
  }

  return {
    ticker: pack.ticker,
    primaryAbstraction: String(parsed.primaryAbstraction || understanding.primaryEconomicAbstraction || "revenue"),
    revenueDrivers: arr(parsed.revenueDrivers).map(normalizeDriver),
    costDrivers: arr(parsed.costDrivers).map(normalizeDriver),
    marginDrivers: arr(parsed.marginDrivers).map(normalizeDriver),
    cashDrivers: arr(parsed.cashDrivers).map(normalizeDriver),
    balanceSheetDrivers: arr(parsed.balanceSheetDrivers).map(normalizeDriver),
    capitalDrivers: arr(parsed.capitalDrivers).map(normalizeDriver),
    returnsDrivers: arr(parsed.returnsDrivers).map(normalizeDriver),
    keyKpis: arr(parsed.keyKpis).map(normalizeKpi),
    metricsToAvoid: arr(parsed.metricsToAvoid).map((m: any) => ({
      metric: String(m?.metric || ""),
      reason: String(m?.reason || ""),
    })),
    statementBindings: arr(parsed.statementBindings).map((b: any) => ({
      statementLine: String(b?.statementLine || ""),
      drivenBy: String(b?.drivenBy || ""),
      mechanism: String(b?.mechanism || ""),
      sourceFacts: Array.isArray(b?.sourceFacts) ? b.sourceFacts.map(String) : [],
    })),
    valueQuestions: arr(parsed.valueQuestions).map(String).filter(Boolean),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.55,
  };
}

export default { buildEconomicEngine, mechanicalEconomicEngine };
