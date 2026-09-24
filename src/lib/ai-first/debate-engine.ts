/**
 * APEX RESEARCH — DEBATE ENGINE + THESIS ENGINE
 *
 * Thesis is NOT "generate a thesis". Thesis is built from debates.
 * Audit §10-12: Identify 3-5 most important debates, each with FOR/AGAINST
 * + financial consequence + valuation consequence + resolution signal,
 * then select central debate → build thesis around it → state what would
 * prove thesis wrong + monitoring KPI + invalidation condition.
 *
 * Prefer pre-forecast path (buildDebatesEarly) so debates inform the driver
 * forecast; post-brief path remains available for richer context.
 */

import type { AnalystBrief } from "./analyst-brief";
import type { FactPack, CompanyUnderstanding, EconomicEngine, Debate, ThesisEngineOutput, DebateEvidence, ResearchDiscoveryPack } from "./types";
import { parseLlmJson } from "./llm";
import { buildHistoricalAnalysisPack } from "./historical-analysis";
import { renderResearchDiscovery } from "./research-discovery";
import { DEPTH_DIRECTIVES, DEPTH_TOKEN_BUDGETS } from "./depth-guidance";

export type { Debate, ThesisEngineOutput, DebateEvidence };

export type DebateTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

const SYSTEM_PROMPT = `You are a senior institutional equity research analyst (thesis engine).

You receive company identity, economic engine (statement bindings + value questions), derived historical trajectory, and [F-...] evidence. A canonical Analyst Brief may also include model/valuation when available.

TASK 1 — Identify 3-5 DEBATES about this company (not facts). Prefer the economic engine's valueQuestions as seeds. Example MSFT debate: "Can AI-driven Azure/productivity monetization outgrow AI-infrastructure capital intensity?"

Each debate must be a falsifiable question with:
- evidenceFor / evidenceAgainst (cite [F-...]; Tier6 alone = low confidence)
- mechanism (economic mechanism at stake)
- significance (why this decides valuation)
- financialConsequence (which forecast row moves if FOR wins: revenue / EBIT / FCF / capex)
- valuationConsequence (EV / equity / per-share impact if FOR wins)
- resolutionSignal (observable KPI/event that would resolve the debate)

TASK 2 — Select the CENTRAL debate and build the THESIS around it.
State:
- Thesis (2-3 paragraphs, mechanism-driven: P1 central debate + chain, P2 bull vs bear evidence, P3 what must happen + invalidation with KPIs)
- Evidence supporting thesis (cite [F-...])
- Evidence contradicting thesis / counter-thesis
- Key uncertainty
- What would prove thesis WRONG (invalidation condition — specific, observable, falsifiable)
- Monitoring KPI to watch

${DEPTH_DIRECTIVES.debates}

RULES:
- Every evidence item must cite [F-...] or model output; Tier6 inference alone = low confidence.
- Do NOT produce generic "bull/bear" — produce debates grounded in THIS company's drivers.
- If evidence is insufficient for a debate, say so and select another.
- Do NOT force 5 debates if only 2-3 are evidence-backed.

Respond with ONLY JSON:
{
  "debates": [
    {
      "debate": "string",
      "evidenceFor": [{ "evidence": "string", "factIds": ["[F-...]"], "tier": 4 }],
      "evidenceAgainst": [{ "evidence": "string", "factIds": ["[F-...]"], "tier": 4 }],
      "mechanism": "string",
      "significance": "string",
      "financialConsequence": "string",
      "valuationConsequence": "string",
      "resolutionSignal": "string"
    }
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

/** Pre-forecast debate context: understanding + economic engine + historical + discovery seeds. */
export function earlyDebateContext(
  pack: FactPack,
  understanding: CompanyUnderstanding,
  engine: EconomicEngine,
  discovery?: ResearchDiscoveryPack
): string {
  const hist = (() => {
    try {
      return buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 30).join("\n");
    } catch {
      return "(historical derived unavailable)";
    }
  })();
  const evidence: string[] = [];
  for (const sec of [pack.company, pack.market, pack.incomeStatement, pack.balanceSheet, pack.cashFlow]) {
    for (const f of sec.facts.slice(0, 20)) {
      if (f.value !== undefined || f.textValue) {
        evidence.push(`[F-${f.metric}] ${f.label} (${f.period}): ${f.textValue ?? String(f.value)}`);
      }
    }
  }
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `What it does: ${understanding.whatItDoes.slice(0, 700)}`,
    `How it makes money: ${understanding.howItMakesMoney.slice(0, 500)}`,
    `Why this company: ${(understanding.whyThisCompany || "").slice(0, 400) || "(not stated)"}`,
    `Primary abstraction: ${engine.primaryAbstraction}`,
    `Revenue drivers: ${engine.revenueDrivers.map((d) => `${d.name}: ${d.mechanism}`).join(" | ")}`,
    `Capital drivers: ${engine.capitalDrivers.map((d) => `${d.name}: ${d.mechanism}`).join(" | ") || "none"}`,
    `KPIs: ${engine.keyKpis.map((k) => k.name).join(", ")}`,
    `Value questions (seed debates): ${engine.valueQuestions.join(" | ") || "none"}`,
    `Competitive advantages: ${(understanding.competitiveAdvantages || []).map((a) => a.advantage).join(" | ") || "none"}`,
    `Competitive threats: ${(understanding.competitiveThreats || []).map((t) => t.threat).join(" | ") || "none"}`,
    `Inflections: ${(understanding.currentInflections || []).join(" | ") || "none"}`,
    "",
    "HISTORICAL DERIVED:",
    hist,
    "",
    "EVIDENCE TABLE (excerpt):",
    evidence.slice(0, 40).join("\n"),
    "",
    discovery
      ? `RESEARCH DISCOVERY SEEDS (use gap questions/economic insights as debate seeds — explain, do not invent):\n${renderResearchDiscovery(discovery)}`
      : "RESEARCH DISCOVERY: (unavailable)",
    "",
    "MODEL/VALUATION: (pending — debates must stand on company economics + evidence alone; flag valuation debate as forward-looking)",
  ].join("\n");
}

function normalizeEvidence(e: any): DebateEvidence {
  return {
    evidence: String(e?.evidence || ""),
    factIds: Array.isArray(e?.factIds) ? e.factIds.map(String) : [],
    tier: typeof e?.tier === "number" ? e.tier : 4,
  };
}

function parseDebates(parsed: Record<string, any>): ThesisEngineOutput {
  const debates: Debate[] = (Array.isArray(parsed.debates) ? parsed.debates : [])
    .map((d: any) => ({
      debate: String(d?.debate || ""),
      evidenceFor: Array.isArray(d?.evidenceFor) ? d.evidenceFor.map(normalizeEvidence) : [],
      evidenceAgainst: Array.isArray(d?.evidenceAgainst) ? d.evidenceAgainst.map(normalizeEvidence) : [],
      mechanism: String(d?.mechanism || ""),
      significance: String(d?.significance || ""),
      financialConsequence: typeof d?.financialConsequence === "string" ? d.financialConsequence : undefined,
      valuationConsequence: typeof d?.valuationConsequence === "string" ? d.valuationConsequence : undefined,
      resolutionSignal: typeof d?.resolutionSignal === "string" ? d.resolutionSignal : undefined,
    }))
    .filter((d: Debate) => d.debate);
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

/** Post-brief debates (model/valuation context available). */
export async function buildDebates(
  transport: DebateTransport,
  brief: AnalystBrief
): Promise<ThesisEngineOutput> {
  const ctx = debateContext(brief);
  const user = `RESEARCH CONTEXT\n================\n${ctx}\n\nTASK\n====\nIdentify debates and build the thesis for ${brief.ticker} now.\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.3, maxTokens: DEPTH_TOKEN_BUDGETS.debates, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.debates)) throw new Error(`Debate engine returned unparseable output for ${brief.ticker}`);
  return parseDebates(parsed);
}

/** Pre-forecast debates from understanding + economic engine (informs driver forecast). */
export async function buildDebatesEarly(
  transport: DebateTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding,
  engine: EconomicEngine,
  discovery?: ResearchDiscoveryPack
): Promise<ThesisEngineOutput> {
  const ctx = earlyDebateContext(pack, understanding, engine, discovery);
  const user = `RESEARCH CONTEXT\n================\n${ctx}\n\nTASK\n====\nIdentify debates and build the thesis for ${pack.ticker} now (model/valuation still pending — ground debates in company economics and [F-...] evidence).\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.3, maxTokens: DEPTH_TOKEN_BUDGETS.debates, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.debates)) throw new Error(`Early debate engine returned unparseable output for ${pack.ticker}`);
  return parseDebates(parsed);
}

export function mechanicalDebates(brief: AnalystBrief, pack: FactPack): ThesisEngineOutput {
  const revTrend = brief.historical.derived.find((d) => d.label.includes("Revenue CAGR"));
  const marginLine = brief.historical.summaryLines.find((l) => l.includes("Net margin")) || "";
  const revName = brief.economicEngine.revenueDrivers[0]?.name || "revenue drivers";
  const marginName = brief.economicEngine.marginDrivers[0]?.name || "cost";
  const revMech = brief.economicEngine.revenueDrivers[0]?.mechanism || `${brief.economicEngine.primaryAbstraction} growth`;
  return {
    debates: [
      {
        debate: `Is ${revName} sustainable at historical CAGR?`,
        evidenceFor: [{ evidence: `Historical revenue CAGR ${revTrend ? String(revTrend.value) : "N/A"}`, factIds: brief.factIds.slice(0, 2), tier: 4 }],
        evidenceAgainst: [{ evidence: `Limited yfinance history (${brief.historical.revenueSeries.length} periods); missing segment/regulatory evidence. ${marginLine.slice(0, 120)}`, factIds: [], tier: 6 }],
        mechanism: revMech,
        significance: "Determines forecast revenue path and DCF fair value — the model's most sensitive input.",
        financialConsequence: "Revenue and EBIT rows move with growth sustainability.",
        valuationConsequence: "DCF fair value / per-share via discounted revenue and terminal value.",
        resolutionSignal: `Multi-period ${brief.economicEngine.keyKpis[0]?.name || "revenue"} trajectory vs historical CAGR`,
      },
      {
        debate: `Can margins expand given ${marginName} dynamics?`,
        evidenceFor: [{ evidence: marginLine.slice(0, 180) || "Margin history present", factIds: brief.factIds.slice(0, 1), tier: 4 }],
        evidenceAgainst: [{ evidence: "Wage/commodity/credit cost pressures not isolatable from yfinance alone", factIds: [], tier: 6 }],
        mechanism: brief.economicEngine.marginDrivers[0]?.mechanism || "Operating leverage vs input costs",
        significance: "20-40% of valuation sensitivity comes via margin assumptions.",
        financialConsequence: "EBIT / net margin rows in the driver forecast.",
        valuationConsequence: "Higher terminal margins raise fair value per share.",
        resolutionSignal: "Reported operating / net margin trend vs cost-driver KPIs",
      },
      {
        debate: "Is current valuation pricing in excessive growth vs history?",
        evidenceFor: [{ evidence: brief.valuation ? `Method ${brief.valuation.spec.methodology} fair value vs price` : "Valuation pending", factIds: brief.factIds.slice(0, 1), tier: 4 }],
        evidenceAgainst: [{ evidence: `Market multiples and ROE not yet reconciled — see contradictions: ${brief.contradictions[0] || "none"}`, factIds: [], tier: 6 }],
        mechanism: "Market-implied growth vs historical CAGR and required ROE",
        significance: "Decides Buy/Hold/Sell and risk/reward skew.",
        financialConsequence: "Required growth/return assumptions if market-implied path is held.",
        valuationConsequence: "Reverse-DCF gap between fair value and current price.",
        resolutionSignal: "Price vs executed fair value and reverse-DCF required growth",
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

export default { buildDebates, buildDebatesEarly, mechanicalDebates, debateContext, earlyDebateContext };
