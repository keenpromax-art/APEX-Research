/**
 * APEX RESEARCH — DEBATE ENGINE + THESIS ENGINE
 *
 * Thesis is NOT "generate a thesis". Thesis is built from debates.
 * Audit §10-12: Identify 3-5 most important debates, each with FOR/AGAINST,
 * then select central debate → build thesis around it → state what would
 * prove thesis wrong + monitoring KPI + invalidation condition.
 *
 * Also produces: What don't we know? What changed? What matters?
 * What contradicts? What is unusual? Key debate? Evidence FOR/AGAINST.
 */

import type { AnalystBrief } from "./analyst-brief";
import type { FactPack } from "./types";
import { parseLlmJson } from "./llm";

export type DebateTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface DebateEvidence {
  evidence: string;
  factIds: string[]; // [F-...]
  tier: number;
}

export interface Debate {
  debate: string; // "Is revenue growth sustainable?"
  evidenceFor: DebateEvidence[];
  evidenceAgainst: DebateEvidence[];
  mechanism: string; // economic mechanism at stake
  significance: string; // why this debate decides valuation
}

export interface ThesisEngineOutput {
  debates: Debate[];
  centralDebateIndex: number;
  thesis: string;
  thesisEvidence: string[];
  thesisCounterEvidence: string[];
  keyUncertainty: string;
  invalidationCondition: string;
  monitoringKpi: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a senior institutional equity research analyst (thesis engine).

You receive the canonical Analyst Brief: company identity, business model, economic engine, derived historical trajectory (CAGR, margins, ROE, FCF, leverage), model/valuation/scenarios, contradictions, missing information, evidence table.

TASK 1 — Identify the 3-5 most important DEBATES about this company (not facts).

Each debate must be a falsifiable question:
- Debate 1: Is revenue growth sustainable?
- Evidence FOR: [...]
- Evidence AGAINST: [...]
- Mechanism / Significance: ...

TASK 2 — Select the CENTRAL debate and build the THESIS around it.
State:
- Thesis (1 paragraph, mechanism-driven)
- Evidence supporting thesis (cite [F-...])
- Evidence contradicting thesis / counter-thesis
- Key uncertainty
- What would prove thesis WRONG (invalidation condition)
- Monitoring KPI to watch

RULES:
- Every evidence item must cite [F-...] or model output; Tier6 inference alone = low confidence.
- Do NOT produce generic "bull/bear" — produce debates grounded in THIS company's drivers.
- If evidence is insufficient for a debate, say so and select another.
- Do NOT force 5 debates if only 2-3 are evidence-backed.

Respond with ONLY JSON:
{
  "debates": [
    { "debate": "string", "evidenceFor": [{ "evidence": "string", "factIds": ["[F-...]"], "tier": 4 }], "evidenceAgainst": [{ "evidence": "string", "factIds": ["[F-...]"], "tier": 4 }], "mechanism": "string", "significance": "string" }
  ],
  "centralDebateIndex": 0,
  "thesis": "string",
  "thesisEvidence": ["string citing [F-...]"],
  "thesisCounterEvidence": ["string"],
  "keyUncertainty": "string",
  "invalidationCondition": "string (observable condition that would prove thesis wrong)",
  "monitoringKpi": "string (KPI to watch)",
  "confidence": 0.65
}
`;

export function debateContext(brief: AnalystBrief): string {
  const h = brief.historical.summaryLines.slice(0, 30).join("\n");
  return [
    `COMPANY: ${brief.companyIdentity.name} (${brief.ticker})`,
    `What it does: ${brief.businessModel.whatItDoes.slice(0, 600)}`,
    `How it makes money: ${brief.businessModel.howItMakesMoney.slice(0, 400)}`,
    `Primary abstraction: ${brief.economicEngine.primaryAbstraction}`,
    `Revenue drivers: ${brief.economicEngine.revenueDrivers.map((d) => `${d.name}: ${d.mechanism}`).join(" | ")}`,
    `KPIs: ${brief.economicEngine.keyKpis.map((k) => k.name).join(", ")}`,
    `Metrics to avoid: ${brief.economicEngine.metricsToAvoid.map((m) => m.metric).join(", ") || "none"}`,
    "",
    `HISTORICAL DERIVED:`,
    h,
    "",
    brief.model ? `MODEL: ${brief.model.spec.variables.map((v) => v.name).join(", ")} | formulas ${brief.model.spec.formulas.map((f) => f.equation).join(" | ")}` : "MODEL: (pending)",
    brief.valuation ? `VALUATION: ${brief.valuation.spec.methodology} — ${brief.valuation.spec.rationale.slice(0, 250)}` : "VALUATION: (pending)",
    `CONTRADICTIONS: ${brief.contradictions.join(" | ") || "none detected"}`,
    `MISSING: ${brief.missingInformation.join(" | ")}`,
    "",
    `EVIDENCE TABLE (excerpt):`,
    brief.evidenceLines.slice(0, 30).join("\n"),
  ].join("\n");
}

export async function buildDebates(
  transport: DebateTransport,
  brief: AnalystBrief
): Promise<ThesisEngineOutput> {
  const ctx = debateContext(brief);
  const user = `RESEARCH CONTEXT\n================\n${ctx}\n\nTASK\n====\nIdentify debates and build the thesis for ${brief.ticker} now.\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.3, maxTokens: 3500, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.debates)) throw new Error(`Debate engine returned unparseable output for ${brief.ticker}`);
  const debates: Debate[] = parsed.debates.map((d: any) => ({
    debate: String(d?.debate || ""),
    evidenceFor: Array.isArray(d?.evidenceFor) ? d.evidenceFor.map((e: any) => ({ evidence: String(e?.evidence || ""), factIds: Array.isArray(e?.factIds) ? e.factIds.map(String) : [], tier: typeof e?.tier === "number" ? e.tier : 4 })) : [],
    evidenceAgainst: Array.isArray(d?.evidenceAgainst) ? d.evidenceAgainst.map((e: any) => ({ evidence: String(e?.evidence || ""), factIds: Array.isArray(e?.factIds) ? e.factIds.map(String) : [], tier: typeof e?.tier === "number" ? e.tier : 4 })) : [],
    mechanism: String(d?.mechanism || ""),
    significance: String(d?.significance || ""),
  })).filter((d: Debate) => d.debate);
  return {
    debates,
    centralDebateIndex: typeof parsed.centralDebateIndex === "number" ? parsed.centralDebateIndex : 0,
    thesis: String(parsed.thesis || ""),
    thesisEvidence: Array.isArray(parsed.thesisEvidence) ? parsed.thesisEvidence.map(String) : [],
    thesisCounterEvidence: Array.isArray(parsed.thesisCounterEvidence) ? parsed.thesisCounterEvidence.map(String) : [],
    keyUncertainty: String(parsed.keyUncertainty || ""),
    invalidationCondition: String(parsed.invalidationCondition || ""),
    monitoringKpi: String(parsed.monitoringKpi || ""),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
  };
}

export function mechanicalDebates(brief: AnalystBrief, pack: FactPack): ThesisEngineOutput {
  const revTrend = brief.historical.derived.find((d) => d.label.includes("Revenue CAGR"));
  const marginLine = brief.historical.summaryLines.find((l) => l.includes("Net margin")) || "";
  return {
    debates: [
      {
        debate: "Is revenue growth sustainable at historical CAGR?",
        evidenceFor: [{ evidence: `Historical revenue CAGR ${revTrend ? String(revTrend.value) : "N/A"}`, factIds: brief.factIds.slice(0, 2), tier: 4 }],
        evidenceAgainst: [{ evidence: `Limited yfinance history (${brief.historical.revenueSeries.length} periods); missing segment/regulatory evidence. ${marginLine.slice(0, 120)}`, factIds: [], tier: 6 }],
        mechanism: `${brief.economicEngine.primaryAbstraction} growth depends on ${brief.economicEngine.revenueDrivers[0]?.name || "revenue drivers"}`,
        significance: "Determines forecast revenue path and DCF fair value — the model's most sensitive input.",
      },
      {
        debate: `Can margins expand given ${brief.economicEngine.marginDrivers[0]?.name || "cost"} dynamics?`,
        evidenceFor: [{ evidence: marginLine.slice(0, 180) || "Margin history present", factIds: brief.factIds.slice(0, 1), tier: 4 }],
        evidenceAgainst: [{ evidence: "Wage/commodity/credit cost pressures not isolatable from yfinance alone", factIds: [], tier: 6 }],
        mechanism: brief.economicEngine.marginDrivers[0]?.mechanism || "Operating leverage vs input costs",
        significance: "20-40% of valuation sensitivity comes via margin assumptions.",
      },
      {
        debate: "Is current valuation pricing in excessive growth vs history?",
        evidenceFor: [{ evidence: brief.valuation ? `Method ${brief.valuation.spec.methodology} fair value vs price` : "Valuation pending", factIds: brief.factIds.slice(0, 1), tier: 4 }],
        evidenceAgainst: [{ evidence: `Market multiples and ROE not yet reconciled — see contradictions: ${brief.contradictions[0] || "none"}`, factIds: [], tier: 6 }],
        mechanism: "Market-implied growth vs historical CAGR and required ROE",
        significance: "Decides Buy/Hold/Sell and risk/reward skew.",
      },
    ],
    centralDebateIndex: 0,
    thesis: `Mechanical thesis fallback for ${brief.ticker}: historical revenue trajectory and margin must be stress-tested against missing segment/regulatory evidence before an institutional thesis can be held with conviction.`,
    thesisEvidence: [`Revenue history: ${brief.historical.revenueSeries.map((r) => `${r.period} ${r.value}`).join(", ") || "N/A"}`],
    thesisCounterEvidence: brief.missingInformation.slice(0, 3),
    keyUncertainty: brief.missingInformation[0] || "Segment economics and management guidance visibility",
    invalidationCondition: "If the primary revenue driver CAGR falls below historical half-rate for two consecutive periods, thesis fails.",
    monitoringKpi: brief.economicEngine.keyKpis[0]?.name || "Revenue",
    confidence: 0.35,
  };
}

export default { buildDebates, mechanicalDebates, debateContext };
