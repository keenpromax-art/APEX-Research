/**
 * APEX RESEARCH — RESEARCH DISCOVERY AGENT
 *
 * Before the narrative writers run, this stage answers:
 *   "What research do we still need, and what evidence can we collect NOW?"
 *
 * Architecture (COLPAL audit — research discovery, not just refusal):
 *   Company + Financials + Understanding + Economic Engine
 *        ↓
 *   Research Discovery Agent (identify gaps by area)
 *        ↓
 *   Evidence Collection (deterministic from yfinance/history/sector/description)
 *        ↓   [optional AI enrichment for qualitative domains]
 *   Analyst Evidence Pack (moat seeds, catalyst seeds, risk seeds, chains)
 *        ↓
 *   Debate / Thesis / Narrative writers (always have material to explain)
 *
 * Axioms preserved:
 *   - Numeric facts come from yfinance only; code does arithmetic.
 *   - Qualitative evidence is tiered (Tier4 db / Tier5 news / Tier6 inference).
 *   - Discovery NEVER invents numbers — it collects and structures what exists,
 *     then tells the writer which gaps remain (status: missing).
 */

import type {
  FactPack,
  CompanyUnderstanding,
  EconomicEngine,
  EvidenceItem,
  DiscoveryGap,
  DiscoveryArea,
  ResearchDiscoveryPack,
  MoatSeed,
  CatalystSeed,
  RiskSeed,
  CompetitiveSeed,
  ThesisSpecification,
  Catalyst,
  Risk,
  CompetitorAnalysis,
  MoatAnalysis,
} from "./types";
import { parseLlmJson } from "./llm";
import { buildHistoricalAnalysisPack, type HistoricalAnalysisPack } from "./historical-analysis";

export type DiscoveryTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

const SYSTEM_PROMPT = `You are a senior institutional equity research DISCOVERY analyst.

You receive: company identity, economic engine, derived historical metrics, research-plan gaps, sector moat/risk taxonomies, and [F-...] evidence. Your job is NOT to write the final thesis — it is to COLLECT and STRUCTURE evidence so the thesis/moat/catalyst/risk writers never face a blank section.

TASK:
1. For each research area below, classify status: filled (enough evidence to write), partial (some evidence — write with explicit confidence), missing (truly absent — writer must say so honestly).
2. For filled/partial areas, produce concrete evidence items with [F-...] citations or clearly tiered qualitative evidence (tier 4=database, 5=news, 6=inference — never present 6 as 1).
3. Produce SEEDS the writers will explain (not final prose):
   - moatSeeds: asset → mechanism → KPI → financial → valuation chains
   - catalystSeeds: event / KPI / direction / timeframe / invalidation
   - riskSeeds: mechanism → affected KPI → financial → valuation → monitor
   - competitiveSeeds: operating rivals vs valuation peers (tag relationship)
4. Economic insights: margin mechanism (why margin should recover/deteriorate), working-capital chain (if CCC is unusual), ROIC interpretation if ROIC is extreme, target-price methodology (5yr intrinsic vs 12M framing).

AREAS (must cover all):
revenueDrivers, marketShare, competitiveLandscape, brandStrength, pricing, volume,
managementCommentary, industryGrowth, risks, catalysts, moat, thesis,
workingCapital, marginMechanism, valuationExpectations

RULES:
- Prefer evidence derived from history/facts over speculation.
- If sector taxonomy provides moat/risk seeds, adapt them to THIS company's drivers — do not copy boilerplate.
- Every seed must be writable: a researcher should be able to turn it into a chain without inventing numbers.
- Status "missing" is allowed and must be listed in coverage — but maximize filled/partial from available material.
- Do NOT invent market share %, brand valuation, or industry TAM numbers.

Respond with ONLY JSON:
{
  "gaps": [{ "area": "moat", "question": "string", "why": "string", "status": "partial", "evidenceItems": [{ "claim": "string", "evidence": "string", "factIds": ["[F-...]"], "tier": 4, "direction": "for", "confidence": 0.7 }], "sourceTier": 4 }],
  "evidenceItems": [{ "claim": "string", "evidence": "string", "factIds": [], "tier": 4, "direction": "mixed", "confidence": 0.7 }],
  "economicInsights": ["string"],
  "moatSeeds": [{ "source": "string", "chain": "asset→mechanism→KPI→financial→valuation", "evidence": "string", "durability": "string", "threatsToDurability": "string", "factIds": ["[F-...]"], "confidence": 0.7 }],
  "catalystSeeds": [{ "catalyst": "string", "mechanism": "string", "timeframe": "string", "observableKpi": "string", "direction": "positive", "forecastImpact": "string", "valuationImpact": "string", "invalidation": "string", "quantitative": true, "factIds": [] }],
  "riskSeeds": [{ "risk": "string", "mechanism": "string", "affectedKpi": "string", "financialConsequence": "string", "valuationConsequence": "string", "monitoringIndicator": "string", "factIds": [] }],
  "competitiveSeeds": [{ "company": "string", "businessOverlap": "string", "economicSimilarity": "string", "keyDifference": "string", "relativeStrengths": "string", "relativeWeaknesses": "string", "segment": "string", "relationship": "operating" }],
  "marginMechanism": "string",
  "workingCapitalChain": "string",
  "roicInterpretation": "string",
  "targetPriceMethodology": "string",
  "summary": "string"
}`;

const AREAS: DiscoveryArea[] = [
  "revenueDrivers", "marketShare", "competitiveLandscape", "brandStrength", "pricing",
  "volume", "managementCommentary", "industryGrowth", "risks", "catalysts",
  "moat", "thesis", "workingCapital", "marginMechanism", "valuationExpectations",
];

function evidence(
  claim: string,
  evidenceText: string,
  factIds: string[],
  tier: number,
  direction: EvidenceItem["direction"],
  confidence: number
): EvidenceItem {
  return { claim, evidence: evidenceText, factIds, tier, direction, confidence };
}

function factIdList(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.map(String) : [];
}

function normalizeGap(g: any): DiscoveryGap {
  const area = String(g?.area || "") as DiscoveryArea;
  return {
    area: AREAS.includes(area) ? area : "thesis",
    question: String(g?.question || ""),
    why: String(g?.why || ""),
    status: g?.status === "filled" || g?.status === "partial" || g?.status === "missing" ? g.status : "missing",
    evidenceItems: (Array.isArray(g?.evidenceItems) ? g.evidenceItems : []).map((e: any) =>
      evidence(String(e?.claim || ""), String(e?.evidence || ""), factIdList(e?.factIds),
        typeof e?.tier === "number" ? e.tier : 4,
        e?.direction === "for" || e?.direction === "against" ? e.direction : "mixed",
        typeof e?.confidence === "number" ? e.confidence : 0.5)
    ),
    sourceTier: typeof g?.sourceTier === "number" ? g.sourceTier : 6,
  };
}

function normalizeMoatSeed(m: any): MoatSeed {
  return {
    source: String(m?.source || ""),
    chain: String(m?.chain || ""),
    evidence: String(m?.evidence || ""),
    durability: String(m?.durability || ""),
    threatsToDurability: String(m?.threatsToDurability || ""),
    factIds: factIdList(m?.factIds),
    confidence: typeof m?.confidence === "number" ? m.confidence : 0.5,
  };
}

function normalizeCatalyst(c: any): CatalystSeed {
  return {
    catalyst: String(c?.catalyst || ""),
    mechanism: String(c?.mechanism || ""),
    timeframe: typeof c?.timeframe === "string" ? c.timeframe : undefined,
    observableKpi: typeof c?.observableKpi === "string" ? c.observableKpi : undefined,
    direction: c?.direction === "positive" || c?.direction === "negative" || c?.direction === "mixed" ? c.direction : undefined,
    forecastImpact: typeof c?.forecastImpact === "string" ? c.forecastImpact : undefined,
    valuationImpact: typeof c?.valuationImpact === "string" ? c.valuationImpact : undefined,
    invalidation: typeof c?.invalidation === "string" ? c.invalidation : undefined,
    quantitative: c?.quantitative === true,
    factIds: factIdList(c?.factIds),
  };
}

function normalizeRisk(r: any): RiskSeed {
  return {
    risk: String(r?.risk || ""),
    mechanism: String(r?.mechanism || ""),
    affectedKpi: String(r?.affectedKpi || ""),
    financialConsequence: String(r?.financialConsequence || ""),
    valuationConsequence: String(r?.valuationConsequence || ""),
    monitoringIndicator: String(r?.monitoringIndicator || ""),
    factIds: factIdList(r?.factIds),
  };
}

function normalizeComp(c: any): CompetitiveSeed {
  const rel = c?.relationship;
  return {
    company: String(c?.company || ""),
    businessOverlap: String(c?.businessOverlap || ""),
    economicSimilarity: String(c?.economicSimilarity || ""),
    keyDifference: String(c?.keyDifference || ""),
    relativeStrengths: String(c?.relativeStrengths || ""),
    relativeWeaknesses: String(c?.relativeWeaknesses || ""),
    segment: typeof c?.segment === "string" && c.segment ? c.segment : undefined,
    relationship: rel === "operating" || rel === "valuation" || rel === "both" ? rel : "valuation",
  };
}

function coverageOf(gaps: DiscoveryGap[]): ResearchDiscoveryPack["coverage"] {
  const filled = gaps.filter((g) => g.status === "filled").length;
  const partial = gaps.filter((g) => g.status === "partial").length;
  const missing = gaps.filter((g) => g.status === "missing").length;
  return { filled, partial, missing, total: gaps.length };
}

function summarizeCoverage(c: ResearchDiscoveryPack["coverage"], evidenceCount: number): string {
  return `Discovery coverage: ${c.filled} filled, ${c.partial} partial, ${c.missing} missing of ${c.total} areas; ${evidenceCount} evidence items collected.`;
}

// ─────────────────────────────────────────────
// Deterministic evidence collection (no LLM)
// ─────────────────────────────────────────────

function pickFact(pack: FactPack, section: FactPack[keyof FactPack] | undefined, metric: string): { value?: number; textValue?: string; period?: string; factId: string } | null {
  const sec = section as { facts?: Array<{ metric: string; value?: number; textValue?: string; period: string }> } | undefined;
  const f = sec?.facts?.find((x) => x.metric === metric && (x.value !== undefined || x.textValue));
  if (!f) return null;
  return { value: f.value, textValue: f.textValue, period: f.period, factId: `F-${f.metric}` };
}

function latestNumeric(pack: FactPack, metric: string): { value: number; factId: string; period: string } | null {
  for (const sec of [pack.market, pack.incomeStatement, pack.balanceSheet, pack.cashFlow]) {
    const facts = sec.facts.filter((f) => f.metric === metric && typeof f.value === "number" && isFinite(f.value));
    if (facts.length) {
      const f = facts[facts.length - 1];
      return { value: f.value as number, factId: `F-${f.metric}`, period: f.period };
    }
  }
  return null;
}

function workingCapitalDays(pack: FactPack): { dso?: number; dio?: number; dpo?: number; ccc?: number; evidence: string[] } {
  const rev = latestNumeric(pack, "totalRevenue") || latestNumeric(pack, "revenue");
  const cogs = latestNumeric(pack, "costOfRevenue");
  const ar = latestNumeric(pack, "netReceivables") || latestNumeric(pack, "receivables");
  const inv = latestNumeric(pack, "inventory") || latestNumeric(pack, "totalInventory");
  const ap = latestNumeric(pack, "accountsPayable") || latestNumeric(pack, "payables");
  const evidence: string[] = [];
  const out: { dso?: number; dio?: number; dpo?: number; ccc?: number; evidence: string[] } = { evidence };
  if (rev?.value) {
    evidence.push(`[F-${rev.factId.replace("F-", "")}] revenue ${rev.value} (${rev.period})`);
    if (ar?.value) {
      out.dso = (ar.value / rev.value) * 365;
      evidence.push(`[F-netReceivables] DSO ≈ ${out.dso.toFixed(0)}d`);
    }
  }
  if (cogs?.value) {
    if (inv?.value) {
      out.dio = (inv.value / cogs.value) * 365;
      evidence.push(`[F-inventory] DIO ≈ ${out.dio.toFixed(0)}d`);
    }
    if (ap?.value) {
      out.dpo = (ap.value / cogs.value) * 365;
      evidence.push(`[F-accountsPayable] DPO ≈ ${out.dpo.toFixed(0)}d`);
    }
  }
  if (out.dso !== undefined && out.dio !== undefined && out.dpo !== undefined) {
    out.ccc = out.dso + out.dio - out.dpo;
    evidence.push(`CCC ≈ ${out.ccc.toFixed(0)}d`);
  }
  return out;
}

function roicInterpretationFromFacts(pack: FactPack, hist: HistoricalAnalysisPack): string | null {
  const ni = latestNumeric(pack, "netIncome") || latestNumeric(pack, "netIncomeCommonStockholders");
  const equity = latestNumeric(pack, "totalEquity") || latestNumeric(pack, "stockholdersEquity");
  const debt = latestNumeric(pack, "totalDebt");
  const cash = latestNumeric(pack, "cash") || latestNumeric(pack, "cashAndCashEquivalents");
  if (!ni?.value || !equity?.value) return null;
  const invested = equity.value + (debt?.value || 0) - (cash?.value || 0);
  if (invested <= 0) {
    return `ROIC appears extreme because invested capital (equity + debt − cash) is near-zero or negative — classic negative-working-capital / cash-heavy economics. Interpret ROIC as a low-capital-intensity signal, not as infinite operating returns. [F-${ni.factId.replace("F-", "")} F-equity]`;
  }
  const roic = ni.value / invested;
  if (roic > 1) {
    return `ROIC ≈ ${(roic * 100).toFixed(0)}% is driven by very small invested capital base (equity ${equity.value} + debt ${debt?.value || 0} − cash ${cash?.value || 0} = ${invested}) relative to net income. This is asset-light / negative-WC economics, not a data error — but it should be read alongside FCF conversion, not in isolation. [F-${ni.factId.replace("F-", "")}]`;
  }
  const roeLine = hist.summaryLines.find((l) => /ROE:/.test(l));
  return roeLine ? `Returns framed via ROE/ROIC from history: ${roeLine}` : null;
}

function marginMechanismFromHistory(hist: HistoricalAnalysisPack, forecastHints?: string[]): string {
  const marginLine = hist.summaryLines.find((l) => l.includes("Net margin")) || "";
  const revLine = hist.summaryLines.find((l) => l.startsWith("Revenue:")) || "";
  const margins = hist.derived.find((d) => d.label === "Net margin trajectory");
  const last = typeof margins?.value === "number" ? margins.value : undefined;
  const first = hist.netIncomeSeries.length && hist.revenueSeries.length
    ? hist.netIncomeSeries[0].value / (hist.revenueSeries[0].value || 1)
    : undefined;
  const direction = first !== undefined && last !== undefined
    ? last < first - 0.01
      ? "compressed over history"
      : last > first + 0.01
        ? "expanded over history"
        : "broadly stable"
    : "partially observed";
  return (
    `Margin path ${direction}. Mechanism to explain (writer must ground each link): ` +
    `gross margin recovery via pricing/mix + operating leverage on fixed brand/distribution spend − any brand-investment step-up = EBIT margin trajectory. ` +
    `Historical: ${marginLine || "net margin series limited"}. Revenue: ${revLine || "n/a"}. ` +
    (forecastHints?.length ? `Forecast hints: ${forecastHints.slice(0, 2).join(" | ")}` : "")
  );
}

function workingCapitalChainFromDays(wc: ReturnType<typeof workingCapitalDays>): string | undefined {
  if (wc.ccc === undefined) return undefined;
  const parts: string[] = [];
  if (wc.dso !== undefined) parts.push(`DSO ${wc.dso.toFixed(0)}d`);
  if (wc.dio !== undefined) parts.push(`DIO ${wc.dio.toFixed(0)}d`);
  if (wc.dpo !== undefined) parts.push(`DPO ${wc.dpo.toFixed(0)}d`);
  const chain =
    wc.ccc < 0
      ? `Supplier financing (DPO ${wc.dpo?.toFixed(0)}d) exceeds customer/inventory float → negative CCC ${wc.ccc.toFixed(0)}d → low external funding requirement → high FCF conversion → capacity for capital returns → supports higher sustainable intrinsic value.`
      : `Positive CCC ${wc.ccc.toFixed(0)}d (${parts.join(" + − ")}) → working capital absorbs cash → funding gap vs FCF → monitor inventory/receivables discipline.`;
  return `${chain} Evidence: ${wc.evidence.join("; ")}`;
}

function targetPriceMethodologyNote(valuation?: { methodology?: string; fairValuePerShare?: number }): string {
  const method = valuation?.methodology || "multi-year DCF/intrinsic";
  return (
    `Target-price convention: the printed target is the ${method} fair value (multi-year explicit forecast + terminal value). ` +
    `It is an intrinsic-value anchor, not a broker-style 12-month trading target. ` +
    `When labeled "12M Target" on the cover, read it as "current intrinsic value to be realized over a full cycle," ` +
    `bridged by: 5-year intrinsic → path of earnings/FCF delivery → 12-month mark-to-market. ` +
    `Do not compare it directly to street 12M targets without adjusting for horizon.`
  );
}

function sectorSeeds(pack: FactPack): { moat: MoatSeed[]; risks: RiskSeed[]; catalysts: CatalystSeed[] } {
  const moat: MoatSeed[] = [];
  const risks: RiskSeed[] = [];
  const catalysts: CatalystSeed[] = [];
  try {
    // Lazy require to avoid circular import issues in tests
    const { getSectorProfile } = require("../sectors") as typeof import("../sectors");
    const sector = pack.company.facts.find((f) => f.metric === "sector")?.textValue || "";
    const industry = pack.company.facts.find((f) => f.metric === "industry")?.textValue || "";
    const desc = pack.company.facts.find((f) => f.metric === "description")?.textValue || "";
    const profile = getSectorProfile(sector, industry, desc);
    for (const d of (profile.moatDrivers || []).slice(0, 4)) {
      moat.push({
        source: d,
        chain: `${d} → company-specific mechanism → KPI → margin/ROIC → fair value (writer must complete with [F-...] evidence)`,
        evidence: `Sector taxonomy seed (${profile.id}) — adapt to THIS company's drivers; do not copy as fact.`,
        durability: "To be assessed from margin stability + ROIC vs WACC history",
        threatsToDurability: "Competitive intensity / substitution — see risk seeds",
        factIds: [],
        confidence: 0.4,
      });
    }
    for (const r of (profile.riskCategories || []).slice(0, 4)) {
      risks.push({
        risk: r,
        mechanism: `${r} → company-native KPI → financial line → valuation (writer completes mechanism from history)`,
        affectedKpi: profile.allowedKPIs?.[0] || "operating KPI",
        financialConsequence: "Revenue/margin/cash impact to be linked to forecast variables",
        valuationConsequence: "DCF fair value sensitivity",
        monitoringIndicator: `Track ${r.toLowerCase()} in quarterly disclosures`,
        factIds: [],
      });
    }
    catalysts.push({
      catalyst: "Next earnings print vs modeled revenue/margin path",
      mechanism: "Reported results validate or refute driver-path assumptions",
      timeframe: "Quarterly",
      observableKpi: "Revenue growth + operating margin vs forecast",
      direction: "mixed",
      forecastImpact: "Driver paths (revenue, margin)",
      valuationImpact: "Fair value path dependency",
      invalidation: "Two consecutive misses vs model",
      quantitative: false,
      factIds: [],
    });
  } catch {}
  return { moat, risks, catalysts };
}

/** Deterministic discovery — always produces a pack (never empty). */
export function mechanicalResearchDiscovery(
  pack: FactPack,
  understanding: CompanyUnderstanding,
  engine: EconomicEngine,
  opts?: {
    researchPlanUnknowns?: string[];
    reverseGapPct?: number;
    forecastMarginPath?: number[];
    valuation?: { methodology?: string; fairValuePerShare?: number };
  }
): ResearchDiscoveryPack {
  const hist = buildHistoricalAnalysisPack(pack);
  const wc = workingCapitalDays(pack);
  const roicNote = roicInterpretationFromFacts(pack, hist);
  const marginMech = marginMechanismFromHistory(hist, opts?.forecastMarginPath?.map((m) => `${(m * 100).toFixed(1)}%`));
  const wcChain = workingCapitalChainFromDays(wc);
  const tpMethod = targetPriceMethodologyNote(opts?.valuation);
  const sector = sectorSeeds(pack);

  const evidenceItems: EvidenceItem[] = [];
  const push = (claim: string, ev: string, factIds: string[], tier: number, dir: EvidenceItem["direction"], conf: number) =>
    evidenceItems.push(evidence(claim, ev, factIds, tier, dir, conf));

  // Revenue / margin / cash evidence from history
  const revCagr = hist.derived.find((d) => /revenue cagr/i.test(d.label));
  if (revCagr) push("Revenue trajectory", String(revCagr.evidence || revCagr.value), [], 4, "mixed", 0.75);
  const marginTrend = hist.summaryLines.find((l) => l.includes("Net margin"));
  if (marginTrend) push("Margin trajectory", marginTrend, [], 4, "mixed", 0.7);
  if (wc.ccc !== undefined) push("Working-capital structure", wcChain || `CCC ${wc.ccc}`, wc.evidence.map((e) => e.match(/\[F-[^\]]+\]/)?.[0] || "").filter(Boolean), 4, wc.ccc < 0 ? "for" : "mixed", 0.8);
  if (roicNote) push("Returns on capital interpretation", roicNote, [], 4, "mixed", 0.7);
  if (understanding.whyThisCompany) push("Why this company", understanding.whyThisCompany, [], 6, "for", 0.55);

  const description = pack.company.facts.find((f) => f.metric === "description")?.textValue || "";
  if (description) {
    push("Business model description", description.slice(0, 300), ["F-description"], 4, "mixed", 0.65);
  }

  // Market expectations
  const street = pack.market.facts.find((f) => f.metric === "targetMeanPrice")?.value;
  const pe = pack.market.facts.find((f) => f.metric === "trailingPE")?.value;
  if (street !== undefined) push("Street target", `Street mean target ${street}`, ["F-targetMeanPrice"], 4, "mixed", 0.7);
  if (pe !== undefined) push("Market multiple", `Trailing P/E ${pe}`, ["F-trailingPE"], 4, "mixed", 0.75);
  if (opts?.reverseGapPct !== undefined && isFinite(opts.reverseGapPct)) {
    push(
      "Market-implied vs modeled growth gap",
      `Reverse valuation implies market expects materially different growth/margin than model (${opts.reverseGapPct.toFixed(1)}pp gap on solved variable).`,
      [],
      4,
      "against",
      0.75
    );
  }

  // Seed moat/catalyst/risk from engine + understanding + sector
  const moatSeeds: MoatSeed[] = [...sector.moat];
  for (const a of understanding.competitiveAdvantages || []) {
    moatSeeds.push({
      source: a.advantage,
      chain: `${a.advantage} → ${a.mechanism} → KPI → margin/ROIC → fair value`,
      evidence: [a.evidence?.join("; "), ...(a.evidence?.length ? [] : ["advantage stated at understanding stage — needs [F-...] grounding"])].filter(Boolean).join(" "),
      durability: "Assess from multi-year margin stability + ROIC spread",
      threatsToDurability: (understanding.competitiveThreats || []).map((t) => t.threat).join("; ") || "Substitution / private label / price competition",
      factIds: [],
      confidence: 0.5,
    });
  }
  // Engine-derived cash moat seed (asset-light / negative WC)
  if (wc.ccc !== undefined && wc.ccc < 0) {
    moatSeeds.push({
      source: "Negative working capital / supplier financing",
      chain: `Supplier terms (DPO ${wc.dpo?.toFixed(0)}d) → negative CCC → self-funding growth → FCF conversion → capital returns → valuation support`,
      evidence: wcChain || "CCC computed from balance-sheet facts",
      durability: "Persist while suppliers accept net-30+ terms and brand keeps shelf power",
      threatsToDurability: "Retailer/ supplier renegotiation; inventory build",
      factIds: wc.evidence.map((e) => e.match(/\[F-[^\]]+\]/)?.[0] || "").filter(Boolean),
      confidence: 0.8,
    });
  }
  // High margin stability seed
  const marginVals = hist.netIncomeSeries.map((n, i) => {
    const r = hist.revenueSeries.find((x) => x.period === n.period);
    return r && r.value ? n.value / r.value : null;
  }).filter((x): x is number => x !== null);
  if (marginVals.length >= 3) {
    const min = Math.min(...marginVals);
    const max = Math.max(...marginVals);
    if (max - min < 0.08) {
      moatSeeds.push({
        source: "Margin stability through cycle",
        chain: `Stable net margins ${min.toFixed(1)}–${max.toFixed(1)}% over ${marginVals.length} periods → pricing power / cost pass-through → durable cash earnings → fair-value resilience`,
        evidence: `Net margin range from history (${marginVals.map((m) => (m * 100).toFixed(1) + "%").join(", ")})`,
        durability: "While competitive structure and input pass-through hold",
        threatsToDurability: "Promotional intensity; raw-material spikes",
        factIds: [],
        confidence: 0.7,
      });
    }
  }

  const catalystSeeds: CatalystSeed[] = [...sector.catalysts];
  // Margin recovery catalyst if forecast path recovers
  if (opts?.forecastMarginPath && opts.forecastMarginPath.length >= 2) {
    const a = opts.forecastMarginPath[0];
    const b = opts.forecastMarginPath[opts.forecastMarginPath.length - 1];
    if (b > a + 0.005) {
      catalystSeeds.push({
        catalyst: "Operating-margin recovery vs historical trough",
        mechanism: marginMech,
        timeframe: "12–24 months",
        observableKpi: "Operating / net margin quarterly",
        direction: "positive",
        forecastImpact: `EBIT margin path ${(a * 100).toFixed(1)}% → ${(b * 100).toFixed(1)}%`,
        valuationImpact: "Higher sustainable earnings raise DCF fair value",
        invalidation: "Input-cost spike or pricing reversal prevents recovery",
        quantitative: true,
        factIds: [],
      });
    }
  }
  catalystSeeds.push({
    catalyst: "Volume / price-mix inflection vs decelerating revenue trend",
    mechanism: "Top-line re-acceleration validates driver-path assumptions",
    timeframe: "Next 2–4 quarters",
    observableKpi: "Revenue growth YoY",
    direction: "positive",
    forecastImpact: "Revenue driver path",
    valuationImpact: "DCF via near-year cash flows",
    invalidation: "Two consecutive periods of flat/declining revenue",
    quantitative: false,
    factIds: revCagr ? [`F-revenue`] : [],
  });
  if (opts?.reverseGapPct !== undefined && opts.reverseGapPct > 5) {
    catalystSeeds.push({
      catalyst: "De-rating / expectations reset toward modeled fundamentals",
      mechanism: `Market currently prices growth/returns ahead of model (reverse gap ${opts.reverseGapPct.toFixed(1)}pp) — catalyst is either fundamentals catching up or multiple normalizing`,
      timeframe: "6–18 months",
      observableKpi: "Price vs intrinsic fair value; P/E vs peer median",
      direction: "mixed",
      forecastImpact: "None — price discovery, not model input",
      valuationImpact: "Convergence of market price to fair value",
      invalidation: "Sustained re-rating without fundamental improvement",
      quantitative: false,
      factIds: [],
    });
  }

  const riskSeeds: RiskSeed[] = [...sector.risks];
  if (marginVals.length >= 2 && marginVals[marginVals.length - 1] < marginVals[0] - 0.01) {
    riskSeeds.push({
      risk: "Continued margin compression",
      mechanism: "Cost inflation or weak pricing → net/EBIT margin decline vs forecast recovery",
      affectedKpi: "Operating margin",
      financialConsequence: "EBIT and FCF below model path",
      valuationConsequence: "DCF fair value downside",
      monitoringIndicator: "Quarterly gross & operating margin",
      factIds: [],
    });
  }
  if (hist.revenueSeries.length >= 2) {
    const yoys: number[] = [];
    for (let i = 1; i < hist.revenueSeries.length; i++) {
      const p = hist.revenueSeries[i - 1].value;
      if (p) yoys.push((hist.revenueSeries[i].value - p) / Math.abs(p));
    }
    if (yoys.length && yoys[yoys.length - 1] < 0.01) {
      riskSeeds.push({
        risk: "Revenue stagnation / volume weakness",
        mechanism: `Latest revenue YoY ${(yoys[yoys.length - 1] * 100).toFixed(1)}% — insufficient growth to support multiple if trend persists`,
        affectedKpi: "Revenue growth",
        financialConsequence: "Top-line miss vs forecast compounding",
        valuationConsequence: "Terminal value and near-year FCF cut",
        monitoringIndicator: "Revenue growth next 2 quarters",
        factIds: ["F-revenue"],
      });
    }
  }
  for (const t of understanding.competitiveThreats || []) {
    riskSeeds.push({
      risk: t.threat,
      mechanism: t.mechanism,
      affectedKpi: understanding.keyKpis[0]?.name || "market share / pricing",
      financialConsequence: "Margin or volume pressure",
      valuationConsequence: "Lower fair value via margin/growth",
      monitoringIndicator: t.evidence?.[0] || "Competitive disclosures",
      factIds: [],
    });
  }

  // Competitive seeds: peers if present in description; otherwise valuation peers from industry
  const competitiveSeeds: CompetitiveSeed[] = [];
  // Operating rivals inferred from industry text when ontology unavailable
  const industry = pack.company.facts.find((f) => f.metric === "industry")?.textValue || "";
  if (/oral|personal care|consumer|household|food|beverage|staples/i.test(industry + " " + description)) {
    // Writer-friendly operating-vs-valuation distinction for consumer names
    competitiveSeeds.push(
      {
        company: "Category peers (oral/personal care or food staples)",
        businessOverlap: "Same end-category consumer spend",
        economicSimilarity: "Brand + distribution + pricing power economics",
        keyDifference: "Operating rivals compete on shelf/voice share; valuation peers may be diversified FMCG",
        relativeStrengths: "Category leadership / brand recall — assess from margins & description",
        relativeWeaknesses: "Private label / regional brands / e-commerce disruption",
        segment: "Core category",
        relationship: "operating",
      },
      {
        company: "Diversified FMCG valuation peers",
        businessOverlap: "Similar consumer-staples multiples and FCF profile",
        economicSimilarity: "Margin structure + capital returns",
        keyDifference: "Valuation comp only — not direct shelf competitors",
        relativeStrengths: "Scale across categories",
        relativeWeaknesses: "Less category concentration",
        segment: "Valuation comp set",
        relationship: "valuation",
      }
    );
  }

  const economicInsights: string[] = [marginMech];
  if (wcChain) economicInsights.push(wcChain);
  if (roicNote) economicInsights.push(roicNote);
  economicInsights.push(tpMethod);
  for (const adv of understanding.competitiveAdvantages || []) {
    economicInsights.push(`Advantage: ${adv.advantage} — ${adv.mechanism}`);
  }

  // Build gaps for all areas
  const statusFor = (area: DiscoveryArea): DiscoveryGap["status"] => {
    switch (area) {
      case "revenueDrivers":
        return understanding.revenueDrivers.length ? "filled" : "partial";
      case "marketShare":
        return "missing"; // no market-share feed
      case "competitiveLandscape":
        return competitiveSeeds.length ? "partial" : "missing";
      case "brandStrength":
        return /brand|colgate|consumer|staple|oral|personal/i.test(description) || understanding.competitiveAdvantages?.length ? "partial" : "missing";
      case "pricing":
        return marginVals.length >= 2 ? "partial" : "missing";
      case "volume":
        return "missing"; // no unit volume feed
      case "managementCommentary":
        return understanding.managementPriorities?.length ? "partial" : "missing";
      case "industryGrowth":
        return "partial"; // sector taxonomy + description only
      case "risks":
        return riskSeeds.length ? "filled" : "partial";
      case "catalysts":
        return catalystSeeds.length ? "filled" : "partial";
      case "moat":
        return moatSeeds.length ? "filled" : "partial";
      case "thesis":
        return revCagr || marginTrend ? "partial" : "missing";
      case "workingCapital":
        return wc.ccc !== undefined ? "filled" : "missing";
      case "marginMechanism":
        return marginVals.length ? "filled" : "partial";
      case "valuationExpectations":
        return street !== undefined || opts?.reverseGapPct !== undefined ? "filled" : "partial";
      default:
        return "missing";
    }
  };

  const gapEvidenceFor = (area: DiscoveryArea): EvidenceItem[] => {
    switch (area) {
      case "workingCapital":
        return wcChain ? [evidence("Working capital chain", wcChain, [], 4, "for", 0.8)] : [];
      case "marginMechanism":
        return [evidence("Margin mechanism", marginMech, [], 4, "mixed", 0.7)];
      case "valuationExpectations":
        return evidenceItems.filter((e) => /Street|P\/E|reverse|implied/i.test(e.claim));
      case "moat":
        return evidenceItems.filter((e) => /margin|advantage|Why this|Returns|Working/i.test(e.claim)).slice(0, 4);
      case "risks":
        return evidenceItems.filter((e) => /trajectory|Margin|Revenue|Working/i.test(e.claim)).slice(0, 3);
      case "catalysts":
        return evidenceItems.filter((e) => /Revenue|Street|implied/i.test(e.claim)).slice(0, 3);
      case "revenueDrivers":
        return evidenceItems.filter((e) => /Revenue|Business model/i.test(e.claim)).slice(0, 3);
      case "thesis":
        return evidenceItems.slice(0, 5);
      case "brandStrength":
        return description ? [evidence("Brand/business description", description.slice(0, 200), ["F-description"], 4, "for", 0.5)] : [];
      case "competitiveLandscape":
        return [evidence("Competitive framing", `${industry || "Industry"} — operating vs valuation peers distinguished in seeds`, [], 6, "mixed", 0.45)];
      default:
        return evidenceItems.slice(0, 2);
    }
  };

  const gaps: DiscoveryGap[] = AREAS.map((area) => {
    const qMap: Record<DiscoveryArea, string> = {
      revenueDrivers: `What physically drives revenue for ${understanding.companyName}?`,
      marketShare: `What is the company's market share and trajectory?`,
      competitiveLandscape: `Who are the true operating rivals vs valuation peers?`,
      brandStrength: `How durable is brand/pricing power in this category?`,
      pricing: `Can the company take price without losing volume?`,
      volume: `What are unit volumes / penetration trends?`,
      managementCommentary: `What is management prioritizing this cycle?`,
      industryGrowth: `What is the industry growth runway?`,
      risks: `What company-specific risks decide the downside?`,
      catalysts: `What observable events move the forecast?`,
      moat: `Which economic architecture chains produce durable excess returns?`,
      thesis: `What is the central falsifiable investment debate?`,
      workingCapital: `How does working capital fund or absorb cash?`,
      marginMechanism: `Why should margins recover or compress — the full mechanism?`,
      valuationExpectations: `What does the market price vs the model?`,
    };
    const whyMap: Partial<Record<DiscoveryArea, string>> = {
      marketShare: "No yfinance market-share feed — requires industry association / company filings",
      volume: "No unit-volume feed — requires filings or sell-through data",
      brandStrength: "Brand durability needs qualitative evidence beyond statements",
      managementCommentary: "Requires earnings-call / annual-report ingestion (slot currently unfilled)",
      industryGrowth: "Requires industry research — only sector taxonomy + description available",
    };
    const status = statusFor(area);
    const items = gapEvidenceFor(area);
    return {
      area,
      question: qMap[area],
      why: whyMap[area] || `Needed for ${area === "thesis" || area === "moat" ? "institutional research quality" : "evidence-constrained writing"}`,
      status,
      evidenceItems: items,
      sourceTier: status === "missing" ? 6 : items.some((i) => i.tier <= 4) ? 4 : 6,
    };
  });

  const coverage = coverageOf(gaps);
  return {
    ticker: pack.ticker,
    generatedAt: new Date().toISOString(),
    gaps,
    evidenceItems,
    economicInsights,
    moatSeeds,
    catalystSeeds,
    riskSeeds,
    competitiveSeeds,
    marginMechanism: marginMech,
    workingCapitalChain: wcChain,
    roicInterpretation: roicNote || undefined,
    targetPriceMethodology: tpMethod,
    coverage,
    summary: summarizeCoverage(coverage, evidenceItems.length),
    aiUsed: false,
  };
}

function discoveryContext(
  pack: FactPack,
  understanding: CompanyUnderstanding,
  engine: EconomicEngine,
  base: ResearchDiscoveryPack,
  opts?: {
    researchPlanUnknowns?: string[];
    reverseGapPct?: number;
    forecastMarginPath?: number[];
    valuation?: { methodology?: string; fairValuePerShare?: number };
  }
): string {
  const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
  let histLines: string[] = [];
  try {
    histLines = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 35);
  } catch {}
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `What it does: ${clip(understanding.whatItDoes, 700)}`,
    `How it makes money: ${clip(understanding.howItMakesMoney, 500)}`,
    `Why this company: ${clip(understanding.whyThisCompany || "", 400) || "(n/a)"}`,
    `Industry: ${pack.company.facts.find((f) => f.metric === "industry")?.textValue || "n/a"}`,
    `Sector: ${pack.company.facts.find((f) => f.metric === "sector")?.textValue || "n/a"}`,
    `Description: ${clip(pack.company.facts.find((f) => f.metric === "description")?.textValue || "", 800)}`,
    "",
    `PRIMARY ABSTRACTION: ${engine.primaryAbstraction}`,
    `REVENUE DRIVERS: ${engine.revenueDrivers.map((d) => `${d.name}: ${d.mechanism}`).join(" | ")}`,
    `MARGIN DRIVERS: ${engine.marginDrivers.map((d) => `${d.name}: ${d.mechanism}`).join(" | ")}`,
    `CASH DRIVERS: ${engine.cashDrivers.map((d) => `${d.name}: ${d.mechanism}`).join(" | ")}`,
    `VALUE QUESTIONS: ${engine.valueQuestions.join(" | ") || "none"}`,
    `KPIS: ${engine.keyKpis.map((k) => k.name).join(", ")}`,
    "",
    "HISTORICAL DERIVED:",
    ...histLines,
    "",
    "ADVANTAGES:",
    ...(understanding.competitiveAdvantages || []).map((a) => `- ${a.advantage}: ${a.mechanism}`),
    "THREATS:",
    ...(understanding.competitiveThreats || []).map((t) => `- ${t.threat}: ${t.mechanism}`),
    "",
    "MECHANICAL DISCOVERY PRE-SEED (extend, do not discard):",
    base.summary,
    ...base.economicInsights.map((i) => `- ${i}`),
    `Moat seeds (${base.moatSeeds.length}): ${base.moatSeeds.map((m) => m.source).join(", ") || "none"}`,
    `Catalyst seeds (${base.catalystSeeds.length}): ${base.catalystSeeds.map((c) => c.catalyst).slice(0, 4).join(" | ")}`,
    `Risk seeds (${base.riskSeeds.length}): ${base.riskSeeds.map((r) => r.risk).slice(0, 4).join(" | ")}`,
    "",
    opts?.researchPlanUnknowns?.length ? `RESEARCH PLAN UNKNOWNS:\n${opts.researchPlanUnknowns.map((u) => `- ${u}`).join("\n")}` : "",
    opts?.reverseGapPct !== undefined ? `REVERSE VALUATION GAP: ${opts.reverseGapPct.toFixed(1)}pp` : "",
    opts?.forecastMarginPath?.length ? `FORECAST MARGIN PATH: ${opts.forecastMarginPath.map((m) => (m * 100).toFixed(1) + "%").join(" → ")}` : "",
    opts?.valuation ? `VALUATION: ${opts.valuation.methodology} FV ${opts.valuation.fairValuePerShare ?? "N/A"}` : "",
    "",
    "YFINANCE MARKET ANCHORS:",
    ...pack.market.facts.filter((f) => f.value !== undefined).slice(0, 15).map((f) => `[F-${f.metric}] ${f.label}: ${f.value}`),
  ].filter((l) => l !== "").join("\n");
}

/** AI research discovery — enriches mechanical seeds with qualitative structure. */
export async function buildResearchDiscovery(
  transport: DiscoveryTransport,
  pack: FactPack,
  understanding: CompanyUnderstanding,
  engine: EconomicEngine,
  opts?: {
    researchPlanUnknowns?: string[];
    reverseGapPct?: number;
    forecastMarginPath?: number[];
    valuation?: { methodology?: string; fairValuePerShare?: number };
  }
): Promise<ResearchDiscoveryPack> {
  const base = mechanicalResearchDiscovery(pack, understanding, engine, opts);
  const ctx = discoveryContext(pack, understanding, engine, base, opts);
  const user = `DISCOVERY CONTEXT\n=================\n${ctx}\n\nTASK\n====\nComplete the research discovery pack for ${understanding.companyName} now. Maximize filled/partial areas from available evidence; keep truly missing areas as missing. Produce writer seeds (not final prose).\n\nOUTPUT\n======\nRespond with ONLY the JSON object.`;
  const resp = await transport({ system: SYSTEM_PROMPT, user, temperature: 0.3, maxTokens: 4000, jsonMode: true });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed) {
    // Fall back to mechanical — never fail the pipeline
    return base;
  }

  const aiGaps = Array.isArray(parsed.gaps) && parsed.gaps.length
    ? parsed.gaps.map(normalizeGap)
    : base.gaps;
  // Ensure all areas present
  const byArea = new Map(base.gaps.map((g) => [g.area, g]));
  for (const g of aiGaps) byArea.set(g.area, g);
  const gaps = AREAS.map((a) => byArea.get(a)!).filter(Boolean);

  const aiEvidence = (Array.isArray(parsed.evidenceItems) ? parsed.evidenceItems : []).map((e: any) =>
    evidence(String(e?.claim || ""), String(e?.evidence || ""), factIdList(e?.factIds),
      typeof e?.tier === "number" ? e.tier : 4,
      e?.direction === "for" || e?.direction === "against" ? e.direction : "mixed",
      typeof e?.confidence === "number" ? e.confidence : 0.5)
  );
  const evidenceItems = [...base.evidenceItems, ...aiEvidence];
  const moatSeeds = [...base.moatSeeds, ...(Array.isArray(parsed.moatSeeds) ? parsed.moatSeeds : []).map(normalizeMoatSeed)]
    .filter((m, i, arr) => arr.findIndex((x) => x.source === m.source) === i);
  const catalystSeeds = [...base.catalystSeeds, ...(Array.isArray(parsed.catalystSeeds) ? parsed.catalystSeeds : []).map(normalizeCatalyst)]
    .filter((c, i, arr) => arr.findIndex((x) => x.catalyst === c.catalyst) === i);
  const riskSeeds = [...base.riskSeeds, ...(Array.isArray(parsed.riskSeeds) ? parsed.riskSeeds : []).map(normalizeRisk)]
    .filter((r, i, arr) => arr.findIndex((x) => x.risk === r.risk) === i);
  const competitiveSeeds = [...base.competitiveSeeds, ...(Array.isArray(parsed.competitiveSeeds) ? parsed.competitiveSeeds : []).map(normalizeComp)]
    .filter((c, i, arr) => arr.findIndex((x) => x.company === c.company) === i);

  const coverage = coverageOf(gaps);
  return {
    ticker: pack.ticker,
    generatedAt: new Date().toISOString(),
    gaps,
    evidenceItems,
    economicInsights: [
      ...new Set([
        ...base.economicInsights,
        ...(Array.isArray(parsed.economicInsights) ? parsed.economicInsights.map(String) : []),
      ]),
    ],
    moatSeeds,
    catalystSeeds,
    riskSeeds,
    competitiveSeeds,
    marginMechanism: typeof parsed.marginMechanism === "string" && parsed.marginMechanism ? parsed.marginMechanism : base.marginMechanism,
    workingCapitalChain: typeof parsed.workingCapitalChain === "string" && parsed.workingCapitalChain ? parsed.workingCapitalChain : base.workingCapitalChain,
    roicInterpretation: typeof parsed.roicInterpretation === "string" && parsed.roicInterpretation ? parsed.roicInterpretation : base.roicInterpretation,
    targetPriceMethodology: typeof parsed.targetPriceMethodology === "string" && parsed.targetPriceMethodology ? parsed.targetPriceMethodology : base.targetPriceMethodology,
    coverage,
    summary: summarizeCoverage(coverage, evidenceItems.length),
    aiUsed: true,
  };
}

const STATUS_RANK: Record<DiscoveryGap["status"], number> = { missing: 0, partial: 1, filled: 2 };

function dedupeBy<T>(arr: T[], key: (t: T) => string): T[] {
  const m = new Map<string, T>();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, x);
  }
  return [...m.values()];
}

/**
 * Post-valuation enhancement: merge model outputs (forecast margin path,
 * executed valuation, reverse-valuation gap) into an already-built discovery
 * pack WITHOUT discarding AI enrichment. Deterministic — no LLM call.
 */
export function enhanceResearchDiscovery(
  discovery: ResearchDiscoveryPack,
  pack: FactPack,
  understanding: CompanyUnderstanding,
  engine: EconomicEngine,
  opts?: {
    researchPlanUnknowns?: string[];
    reverseGapPct?: number;
    forecastMarginPath?: number[];
    valuation?: { methodology?: string; fairValuePerShare?: number };
  }
): ResearchDiscoveryPack {
  const fresh = mechanicalResearchDiscovery(pack, understanding, engine, opts);

  const byArea = new Map<DiscoveryArea, DiscoveryGap>();
  for (const g of discovery.gaps) byArea.set(g.area, { ...g, evidenceItems: [...g.evidenceItems] });
  for (const g of fresh.gaps) {
    const cur = byArea.get(g.area);
    if (!cur) {
      byArea.set(g.area, g);
      continue;
    }
    const better = STATUS_RANK[g.status] > STATUS_RANK[cur.status] ? g : cur;
    const evMap = new Map<string, EvidenceItem>();
    for (const e of [...cur.evidenceItems, ...g.evidenceItems]) {
      evMap.set(`${e.claim}|${e.evidence.slice(0, 40)}`, e);
    }
    byArea.set(g.area, { ...better, evidenceItems: [...evMap.values()] });
  }
  const gaps = AREAS.map((a) => byArea.get(a)!).filter(Boolean);

  const evidenceItems = dedupeBy(
    [...discovery.evidenceItems, ...fresh.evidenceItems],
    (e) => `${e.claim}|${e.evidence.slice(0, 60)}`
  );
  const economicInsights = dedupeBy(
    [...discovery.economicInsights, ...fresh.economicInsights],
    (s) => s.slice(0, 80)
  );
  const moatSeeds = dedupeBy([...discovery.moatSeeds, ...fresh.moatSeeds], (m) => m.source);
  const catalystSeeds = dedupeBy([...discovery.catalystSeeds, ...fresh.catalystSeeds], (c) => c.catalyst);
  const riskSeeds = dedupeBy([...discovery.riskSeeds, ...fresh.riskSeeds], (r) => r.risk);
  const competitiveSeeds = dedupeBy([...discovery.competitiveSeeds, ...fresh.competitiveSeeds], (c) => c.company);

  const coverage = coverageOf(gaps);
  return {
    ...discovery,
    gaps,
    evidenceItems,
    economicInsights,
    moatSeeds,
    catalystSeeds,
    riskSeeds,
    competitiveSeeds,
    marginMechanism: discovery.marginMechanism || fresh.marginMechanism,
    workingCapitalChain:
      discovery.aiUsed && discovery.workingCapitalChain
        ? discovery.workingCapitalChain
        : fresh.workingCapitalChain || discovery.workingCapitalChain,
    roicInterpretation:
      discovery.aiUsed && discovery.roicInterpretation
        ? discovery.roicInterpretation
        : fresh.roicInterpretation || discovery.roicInterpretation,
    targetPriceMethodology: opts?.valuation
      ? fresh.targetPriceMethodology
      : discovery.targetPriceMethodology || fresh.targetPriceMethodology,
    coverage,
    summary: summarizeCoverage(coverage, evidenceItems.length),
  };
}

/**
 * Guarantee non-empty writer sections: if thesis/catalysts/risks/moat/
 * competitive came back blank (or mechanical-generic), backfill from discovery
 * seeds with honest confidence — NEVER leave a section empty when seeds exist,
 * NEVER invent beyond the seeds.
 */
export function applyDiscoverySeeds<
  T extends {
    thesis: ThesisSpecification;
    catalysts: Catalyst[];
    risks: Risk[];
    competitiveAnalysis: CompetitorAnalysis;
    moat: MoatAnalysis;
  }
>(narrative: T, discovery?: ResearchDiscoveryPack): T {
  if (!discovery) return narrative;
  const out: T = { ...narrative, thesis: { ...narrative.thesis } };

  if (!out.catalysts?.length && discovery.catalystSeeds.length) {
    out.catalysts = discovery.catalystSeeds.slice(0, 5).map((c) => ({
      catalyst: c.catalyst,
      mechanism: c.mechanism,
      financialVariable: c.forecastImpact || "forecast driver path",
      forecastImpact: c.forecastImpact,
      valuationImpact: c.valuationImpact,
      quantitative: c.quantitative,
      timeframe: c.timeframe,
      observableKpi: c.observableKpi,
      direction: c.direction,
      invalidation: c.invalidation,
    }));
  }

  if (!out.risks?.length && discovery.riskSeeds.length) {
    out.risks = discovery.riskSeeds.slice(0, 5).map((r) => ({
      risk: r.risk,
      mechanism: r.mechanism,
      affectedKpi: r.affectedKpi,
      financialConsequence: r.financialConsequence,
      valuationConsequence: r.valuationConsequence,
      monitoringIndicator: r.monitoringIndicator,
    }));
  }

  if (!out.moat?.sources?.length && discovery.moatSeeds.length) {
    out.moat = {
      hasMoat: discovery.moatSeeds.some((m) => m.confidence >= 0.6),
      sources: discovery.moatSeeds.slice(0, 5).map((m) => ({
        source: m.source,
        evidence: m.evidence,
        economicConsequence: m.chain,
        durability: m.durability,
        threatsToDurability: m.threatsToDurability,
        chain: m.chain,
      })),
      verdict:
        out.moat?.verdict ||
        `Discovery-seeded moat assessment (${discovery.coverage.filled} filled / ${discovery.coverage.partial} partial areas): ${discovery.marginMechanism?.slice(0, 180) || discovery.summary}`,
    };
  }

  if (!out.competitiveAnalysis?.competitors?.length && discovery.competitiveSeeds.length) {
    out.competitiveAnalysis = {
      competitors: discovery.competitiveSeeds.map((c) => ({
        company: c.company,
        businessOverlap: c.businessOverlap,
        economicSimilarity: c.economicSimilarity,
        keyDifference: c.keyDifference,
        relativeStrengths: c.relativeStrengths,
        relativeWeaknesses: c.relativeWeaknesses,
        segment: c.segment,
      })),
      insufficient: false,
      note: "Seeded from research discovery — operating rivals vs valuation peers distinguished by relationship tag.",
    };
  }

  const t = out.thesis;
  if (!t.thesis || t.thesis.length < 60 || /mechanical preview|pending ai analysis/i.test(t.thesis)) {
    const thesisGap = discovery.gaps.find((g) => g.area === "thesis" && g.evidenceItems.length);
    const ev = thesisGap?.evidenceItems[0];
    if (ev) {
      t.thesis =
        `${ev.claim}: ${ev.evidence} ` +
        `(discovery-grounded thesis seed; confidence ${ev.confidence.toFixed(2)}, tier ${ev.tier}${ev.tier >= 6 ? " inference — not filing fact" : ""}).`;
    }
  }
  if (!t.keyDebate) {
    const tg = discovery.gaps.find((g) => g.area === "thesis");
    if (tg) t.keyDebate = tg.question;
  }
  if (!t.whatMarketMayBeMissing && discovery.workingCapitalChain) {
    t.whatMarketMayBeMissing = `Working-capital structure the market may under-appreciate: ${discovery.workingCapitalChain}`;
  }
  if (!t.whatCouldInvalidate?.length && discovery.riskSeeds.length) {
    t.whatCouldInvalidate = discovery.riskSeeds
      .slice(0, 3)
      .map((r) => `${r.risk} — monitor: ${r.monitoringIndicator}`);
  }
  if (!t.bullCase?.length && discovery.moatSeeds.length) {
    t.bullCase = discovery.moatSeeds.slice(0, 3).map((m) => m.chain);
  }
  if (!t.bearCase?.length && discovery.riskSeeds.length) {
    t.bearCase = discovery.riskSeeds
      .slice(0, 3)
      .map((r) => `${r.mechanism} → ${r.financialConsequence} → ${r.valuationConsequence}`);
  }

  return out;
}

/** Render discovery pack for AnalystBrief / narrative context injection. */
export function renderResearchDiscovery(pack: ResearchDiscoveryPack): string {
  const lines: string[] = [
    `RESEARCH DISCOVERY PACK — ${pack.ticker} (${pack.generatedAt}${pack.aiUsed ? ", AI-enriched" : ", mechanical"})`,
    pack.summary,
    "",
    "GAPS:",
    ...pack.gaps.map((g) => `- [${g.status.toUpperCase()}/T${g.sourceTier}] ${g.area}: ${g.question}`),
    "",
    "ECONOMIC INSIGHTS (explain these — do not invent new mechanics):",
    ...pack.economicInsights.map((i) => `- ${i}`),
    "",
    `MOAT SEEDS (${pack.moatSeeds.length}):`,
    ...pack.moatSeeds.map((m) => `- ${m.source} | chain: ${m.chain} | ev: ${m.evidence.slice(0, 160)} | conf ${m.confidence}`),
    "",
    `CATALYST SEEDS (${pack.catalystSeeds.length}):`,
    ...pack.catalystSeeds.map((c) => `- ${c.catalyst}${c.timeframe ? ` (${c.timeframe})` : ""} | kpi: ${c.observableKpi || "?"} | dir: ${c.direction || "?"}${c.invalidation ? ` | invalidation: ${c.invalidation}` : ""}`),
    "",
    `RISK SEEDS (${pack.riskSeeds.length}):`,
    ...pack.riskSeeds.map((r) => `- ${r.risk} | mechanism: ${r.mechanism.slice(0, 140)} | monitor: ${r.monitoringIndicator}`),
    "",
    `COMPETITIVE SEEDS (${pack.competitiveSeeds.length}):`,
    ...pack.competitiveSeeds.map((c) => `- [${c.relationship}] ${c.company}: overlap=${c.businessOverlap.slice(0, 80)} | diff=${c.keyDifference.slice(0, 80)}`),
    "",
    pack.marginMechanism ? `MARGIN MECHANISM: ${pack.marginMechanism}` : "",
    pack.workingCapitalChain ? `WORKING CAPITAL CHAIN: ${pack.workingCapitalChain}` : "",
    pack.roicInterpretation ? `ROIC INTERPRETATION: ${pack.roicInterpretation}` : "",
    pack.targetPriceMethodology ? `TARGET PRICE METHODOLOGY: ${pack.targetPriceMethodology}` : "",
    "",
    "EVIDENCE ITEMS:",
    ...pack.evidenceItems.slice(0, 20).map((e) => `[${e.direction}/T${e.tier}/c${e.confidence.toFixed(2)}] ${e.claim}: ${e.evidence.slice(0, 160)} ${e.factIds.join(" ")}`),
  ].filter(Boolean);
  return lines.join("\n");
}

export default {
  buildResearchDiscovery,
  mechanicalResearchDiscovery,
  enhanceResearchDiscovery,
  applyDiscoverySeeds,
  renderResearchDiscovery,
};
