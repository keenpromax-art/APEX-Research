/**
 * APEX RESEARCH — AI COMPANY UNDERSTANDING
 *
 * The AI independently determines what the company does, how it makes money,
 * its economic units, drivers, KPIs, and which metrics should NOT be used.
 * Inferred from the company fact pack — NO predefined bank/tech/auto template.
 */
import type { FactPack, CompanyUnderstanding, BusinessDriver, KpiDefinition, Fact } from "./types";
import { parseLlmJson } from "./llm";

export type UnderstandingTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

/** Extract compact business context from the fact pack (Principle 33). */
function businessContext(pack: FactPack): string {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  const fmtFact = (f: Fact) => {
    const val = f.textValue ?? (f.value !== undefined ? String(f.value) : "N/A");
    return `- ${f.label}: ${clip(val, 500)}`;
  };
  const company = pack.company.facts.map(fmtFact).join("\n");
  const market = pack.market.facts.map(fmtFact).join("\n");
  const revSeries = pack.incomeStatement.facts
    .filter((f) => /revenue/i.test(f.metric) && f.value !== undefined)
    .slice(0, 8)
    .map((f) => `${f.period}: ${f.value}`)
    .join("; ");
  const incomeLines = [...new Set(pack.incomeStatement.facts.map((f) => f.metric))].slice(0, 30).join(", ");
  const balanceLines = [...new Set(pack.balanceSheet.facts.map((f) => f.metric))].slice(0, 30).join(", ");
  const cashLines = [...new Set(pack.cashFlow.facts.map((f) => f.metric))].slice(0, 20).join(", ");
  return [
    "COMPANY (yfinance):",
    company,
    "",
    "MARKET DATA (yfinance):",
    market,
    revSeries ? `\nREVENUE HISTORY (yfinance): ${revSeries}` : "",
    incomeLines ? `\nAVAILABLE INCOME-STATEMENT LINES: ${incomeLines}` : "",
    balanceLines ? `\nAVAILABLE BALANCE-SHEET LINES: ${balanceLines}` : "",
    cashLines ? `\nAVAILABLE CASH-FLOW LINES: ${cashLines}` : "",
  ].join("\n");
}

const SYSTEM_PROMPT = `You are an institutional equity research analyst. You receive raw factual data for ONE company (from yfinance) — the ONLY authoritative numerical source for historical statements/market data.

Determine:
- What does this company actually do? How does it make money?
- Business segments and the economic units of the business.
- What drives revenue, costs, margins, cash generation, balance-sheet requirements, capex/capital intensity (capitalEngines), and returns on capital?
- The important KPIs (with availability: yfinance / modeled / unavailable).
- Metrics that should NOT be used for this company (e.g. a commercial bank should not be analyzed with EBITDA or EV/EBITDA — deposits, advances, NIM, credit cost, ROA/ROE and book value are relevant; an ad platform's economics are query/monetization-driven, not inventory-driven).
- Appropriate valuation methods with WHY.
- Which financial statements matter most.
- whyThisCompany: why THIS company is investable vs any peer — the core differentiator (NOT generic "leader with strong brand").
- competitiveAdvantages: 2-4 structural advantages, each as an ECONOMIC ARCHITECTURE CHAIN (e.g., "Microsoft 365 → workflow integration → high switching costs → seat pricing power → recurring revenue durability"). Cite [F-...] evidence where possible.
- competitiveThreats: real rivals/mechanisms that erode those advantages (e.g., AWS/GCP share shifts, open-source substitution, regulation).
- currentInflections: what is CHANGING right now that matters to the investment case (AI capex cycle, mix shift, regulation, product cycle) — not generic "ongoing digital transformation".
- managementPriorities: capital-allocation / strategic priorities ONLY if grounded in facts; otherwise "UNKNOWN — requires filings/calls".

There is NO template. Determine everything from the actual company data. NO boilerplate ("operational scale", "high-margin mix", "disciplined capital deployment").

EPISTEMIC RULES — CRITICAL:
- Distinguish KNOWN (present in yfinance facts or Tier1 filing) vs INFERRED (you guessed from sector/description) vs UNKNOWN (not in yfinance; requires filings/calls/research).
- yfinance description/sector/industry/financials/market data are factual (Tier4). It CANNOT give you: segment economics, current strategy, management guidance, order book, regulatory changes, project pipeline, detailed competitive set, or capital allocation plans. Do NOT hallucinate those — mark them as UNKNOWN and lower confidence.
- Use source hierarchy: Tier1 filing/government/exchange > Tier2 presentation/call > Tier3 broker/industry > Tier4 yfinance/database > Tier5 news/web > Tier6 inference. Never present Tier6 inference as Tier1 fact.
- If data is missing, say what is missing and what research is required (latest annual report, presentation, earnings call, filings) rather than inventing.
- Express confidence honestly: high only when multiple [F-...] facts support the claim; lower when inferring.

Respond with ONLY JSON in this exact shape:
{
  "whatItDoes": "string",
  "howItMakesMoney": "string",
  "businessSegments": [{ "name": "string", "description": "string", "shareOfRevenue": null }],
  "economicUnits": ["string"],
  "primaryEconomicAbstraction": "string",
  "revenueDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "costDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "marginDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "cashGenerationDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "balanceSheetDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "returnsDrivers": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "capitalEngines": [{ "name": "string", "mechanism": "string", "sourceFacts": ["string"], "statementLine": null }],
  "keyKpis": [{ "name": "string", "rationale": "string", "availability": "yfinance", "unit": null }],
  "metricsToAvoid": [{ "metric": "string", "reason": "string" }],
  "statementsThatMatterMost": ["string"],
  "industryContext": "string",
  "appropriateValuationMethods": [{ "method": "string", "why": "string" }],
  "whyThisCompany": "string (company-specific investment differentiator)",
  "competitiveAdvantages": [{ "advantage": "string", "mechanism": "string (economic chain)", "evidence": ["string citing [F-...] when possible"] }],
  "competitiveThreats": [{ "threat": "string", "mechanism": "string", "evidence": ["string"] }],
  "currentInflections": ["string (what changed and why it matters now)"],
  "managementPriorities": ["string or UNKNOWN — requires filings/calls"],
  "confidence": { "overall": 0.5, "dataQuality": "string", "reasoning": "string" },
  "epistemic": { "knownFacts": ["string"], "inferences": ["string"], "unknowns": ["string"], "requiredResearch": ["string"] }
}
Note: The "epistemic" object is OPTIONAL but preferred — if included, downstream stages surface unknowns honestly. If omitted, confidence must reflect the gap. `;

/** AI company understanding from the fact pack. */
export async function understandCompany(
  transport: UnderstandingTransport,
  pack: FactPack
): Promise<CompanyUnderstanding> {
  const ctx = businessContext(pack);
  const user = `Company ticker: ${pack.ticker}\n\n${ctx}\n\nUnderstand this company now. Respond with ONLY the JSON object.`;

  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.3, maxTokens: 3000, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed) {
    throw new Error(`AI company understanding returned unparseable output for ${pack.ticker}`);
  }

  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

  const understanding: CompanyUnderstanding = {
    ticker: pack.ticker,
    companyName: pack.company.facts.find((f) => f.metric === "companyName")?.textValue || pack.ticker,
    whatItDoes: String(parsed.whatItDoes || ""),
    howItMakesMoney: String(parsed.howItMakesMoney || ""),
    businessSegments: arr(parsed.businessSegments).map((s) => ({
      name: String(s?.name || "Segment"),
      description: String(s?.description || ""),
      shareOfRevenue: typeof s?.shareOfRevenue === "number" ? s.shareOfRevenue : undefined,
    })),
    economicUnits: arr(parsed.economicUnits).map(String),
    primaryEconomicAbstraction: String(parsed.primaryEconomicAbstraction || "revenue"),
    revenueDrivers: arr(parsed.revenueDrivers).map(normalizeDriver),
    costDrivers: arr(parsed.costDrivers).map(normalizeDriver),
    marginDrivers: arr(parsed.marginDrivers).map(normalizeDriver),
    cashGenerationDrivers: arr(parsed.cashGenerationDrivers).map(normalizeDriver),
    balanceSheetDrivers: arr(parsed.balanceSheetDrivers).map(normalizeDriver),
    returnsDrivers: arr(parsed.returnsDrivers).map(normalizeDriver),
    capitalEngines: arr(parsed.capitalEngines).map(normalizeDriver),
    keyKpis: arr(parsed.keyKpis).map(normalizeKpi),
    metricsToAvoid: arr(parsed.metricsToAvoid).map(normalizeMetricToAvoid),
    statementsThatMatterMost: arr(parsed.statementsThatMatterMost).map(String),
    industryContext: String(parsed.industryContext || ""),
    appropriateValuationMethods: arr(parsed.appropriateValuationMethods).map((m) => ({
      method: String(m?.method || ""),
      why: String(m?.why || ""),
    })),
    whyThisCompany: parsed.whyThisCompany ? String(parsed.whyThisCompany) : undefined,
    competitiveAdvantages: arr(parsed.competitiveAdvantages)
      .map((a: any) => ({
        advantage: String(a?.advantage || ""),
        mechanism: String(a?.mechanism || ""),
        evidence: Array.isArray(a?.evidence) ? a.evidence.map(String) : [],
      }))
      .filter((a: { advantage: string }) => a.advantage),
    competitiveThreats: arr(parsed.competitiveThreats)
      .map((t: any) => ({
        threat: String(t?.threat || ""),
        mechanism: String(t?.mechanism || ""),
        evidence: Array.isArray(t?.evidence) ? t.evidence.map(String) : [],
      }))
      .filter((t: { threat: string }) => t.threat),
    currentInflections: arr(parsed.currentInflections).map(String).filter(Boolean),
    managementPriorities: arr(parsed.managementPriorities).map(String).filter(Boolean),
    epistemic: parsed.epistemic
      ? {
          knownFacts: arr(parsed.epistemic.knownFacts).map(String),
          inferences: arr(parsed.epistemic.inferences).map(String),
          unknowns: arr(parsed.epistemic.unknowns).map(String),
          requiredResearch: arr(parsed.epistemic.requiredResearch).map(String),
        }
      : undefined,
    confidence: {
      overall: typeof parsed.confidence?.overall === "number" ? parsed.confidence.overall : 0.5,
      dataQuality: String(parsed.confidence?.dataQuality || ""),
      reasoning: String(parsed.confidence?.reasoning || ""),
    },
  };
  return understanding;
}

function normalizeDriver(d: any): BusinessDriver {
  return {
    name: String(d?.name || "Driver"),
    mechanism: String(d?.mechanism || ""),
    sourceFacts: Array.isArray(d?.sourceFacts) ? d.sourceFacts.map(String) : [],
    statementLine: typeof d?.statementLine === "string" && d.statementLine !== "null" ? d.statementLine : undefined,
  };
}

function normalizeKpi(k: any): KpiDefinition {
  return {
    name: String(k?.name || "KPI"),
    rationale: String(k?.rationale || ""),
    availability: ["yfinance", "modeled", "unavailable"].includes(k?.availability) ? k.availability : "unavailable",
    unit: typeof k?.unit === "string" && k.unit !== "null" ? k.unit : undefined,
  };
}

function normalizeMetricToAvoid(m: any): { metric: string; reason: string } {
  return { metric: String(m?.metric || ""), reason: String(m?.reason || "") };
}