/**
 * APEX RESEARCH — EVIDENCE MAPPER
 *
 * Maps every major claim (debates, thesis, drivers, catalysts) to Tier1-6
 * evidence with confidence. Unsupported claims are listed honestly rather
 * than invented. Consumed by valuation, narrative, and quality review.
 */
import type { FactPack, CompanyUnderstanding, EconomicEngine, EvidenceMap, EvidenceItem } from "./types";
import type { ThesisEngineOutput } from "./types";
import { parseLlmJson } from "./llm";
import { buildHistoricalAnalysisPack } from "./historical-analysis";

export type EvidenceTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

const SYSTEM_PROMPT = `You are an evidence mapper on an institutional equity research desk.

You receive: company understanding, economic engine, research debates (FOR/AGAINST), and the [F-...] yfinance evidence table + historical derived metrics.

TASK — Build an evidence map:
1. For each major claim (each debate's central claim, thesis claims, key driver claims), attach the strongest supporting and opposing evidence with [F-...] fact ids and Tier (1 filing > 2 presentation > 3 broker > 4 yfinance > 5 news > 6 inference).
2. direction: "for" | "against" | "mixed" relative to the bull/optimistic reading of the claim.
3. confidence: 0..1 — high only when multiple Tier≤4 facts support; low for Tier6 inference alone.
4. unsupported: claims that cannot be grounded — list them honestly (do NOT invent evidence).

RULES:
- Never invent fact ids. Only use [F-...] ids present in the evidence table or historical derived citations.
- Do not force full coverage — incomplete maps are better than fabricated ones.
- Prefer historical derived lines (CAGR, margin trends, ROE, FCF) as Tier4-derived evidence.

Respond with ONLY JSON:
{
  "items": [
    { "claim": "string", "evidence": "string", "factIds": ["[F-...]"], "tier": 4, "direction": "for", "confidence": 0.7, "period": "FY2025" }
  ],
  "unsupported": ["string"],
  "overallConfidence": 0.6
}`;

function evidenceTable(pack: FactPack, max = 60): string[] {
  const lines: string[] = [];
  for (const sec of [pack.company, pack.market, pack.incomeStatement, pack.balanceSheet, pack.cashFlow, pack.estimates]) {
    for (const f of sec.facts.slice(0, 20)) {
      if (f.value !== undefined || f.textValue) {
        const v = f.textValue ?? String(f.value);
        lines.push(`[F-${f.metric}] ${f.label} (${f.period}): ${v}`);
      }
    }
  }
  return lines.slice(0, max);
}

export interface EvidenceMapperInput {
  pack: FactPack;
  understanding: CompanyUnderstanding;
  engine?: EconomicEngine;
  debates?: ThesisEngineOutput;
}

function mapperContext(input: EvidenceMapperInput): string {
  const { pack, understanding, engine, debates } = input;
  let hist = "";
  try {
    hist = buildHistoricalAnalysisPack(pack).summaryLines.slice(0, 30).join("\n");
  } catch {}
  const debateLines = debates?.debates
    ?.map(
      (d, i) =>
        `${i}. ${d.debate}\n   FOR: ${d.evidenceFor.map((e) => e.evidence).join(" | ") || "—"}\n   AGAINST: ${d.evidenceAgainst.map((e) => e.evidence).join(" | ") || "—"}`
    )
    .join("\n");
  return [
    `COMPANY: ${understanding.companyName} (${pack.ticker})`,
    `Primary abstraction: ${engine?.primaryAbstraction || understanding.primaryEconomicAbstraction}`,
    `Value questions: ${engine?.valueQuestions?.join(" | ") || "n/a"}`,
    "",
    "DEBATES (if built):",
    debateLines || "(no debates yet)",
    "",
    "HISTORICAL DERIVED:",
    hist,
    "",
    "EVIDENCE TABLE [F-...]:",
    ...evidenceTable(pack),
  ].join("\n");
}

function normalizeItem(i: any): EvidenceItem {
  return {
    claim: String(i?.claim || ""),
    evidence: String(i?.evidence || ""),
    factIds: Array.isArray(i?.factIds) ? i.factIds.map(String) : [],
    tier: typeof i?.tier === "number" ? i.tier : 4,
    direction: i?.direction === "against" || i?.direction === "mixed" ? i.direction : "for",
    confidence: typeof i?.confidence === "number" ? i.confidence : 0.5,
    period: typeof i?.period === "string" ? i.period : undefined,
  };
}

/** Mechanical evidence map — attaches fact ids from pack without LLM. */
export function mechanicalEvidenceMap(input: EvidenceMapperInput): EvidenceMap {
  const { pack, understanding, engine, debates } = input;
  const items: EvidenceItem[] = [];
  const unsupported: string[] = [];

  for (const d of engine?.revenueDrivers || understanding.revenueDrivers) {
    if (d.sourceFacts?.length) {
      items.push({
        claim: `Revenue driver: ${d.name}`,
        evidence: d.mechanism,
        factIds: d.sourceFacts.map((f) => (f.startsWith("[") ? f : `[F-${f}]`)),
        tier: 4,
        direction: "for",
        confidence: 0.5,
      });
    } else {
      unsupported.push(`Revenue driver ${d.name} has no [F-...] grounding`);
    }
  }

  for (const b of debates?.debates || []) {
    const factIds = [
      ...b.evidenceFor.flatMap((e) => e.factIds),
      ...b.evidenceAgainst.flatMap((e) => e.factIds),
    ];
    if (factIds.length) {
      items.push({
        claim: b.debate,
        evidence: b.mechanism,
        factIds,
        tier: Math.min(...[...b.evidenceFor, ...b.evidenceAgainst].map((e) => e.tier).concat([4])),
        direction: b.evidenceFor.length >= b.evidenceAgainst.length ? "for" : "against",
        confidence: debates?.confidence ?? 0.4,
      });
    } else {
      unsupported.push(`Debate has no fact citations: ${b.debate}`);
    }
  }

  const overall =
    items.length === 0
      ? 0.2
      : items.reduce((s, i) => s + i.confidence, 0) / items.length;

  return { ticker: pack.ticker, items, unsupported, overallConfidence: overall };
}

/** AI evidence mapping. */
export async function buildEvidenceMap(
  transport: EvidenceTransport,
  input: EvidenceMapperInput
): Promise<EvidenceMap> {
  const ctx = mapperContext(input);
  const user = `EVIDENCE MAP CONTEXT\n====================\n${ctx}\n\nMap the evidence for ${input.pack.ticker} now.\n\nRespond with ONLY the JSON object.`;
  const resp = await transport({
    system: SYSTEM_PROMPT,
    user,
    temperature: 0.25,
    maxTokens: 3000,
    jsonMode: true,
  });
  const parsed = parseLlmJson<Record<string, any>>(resp);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Evidence mapper returned unparseable output for ${input.pack.ticker}`);
  }
  const items = parsed.items.map(normalizeItem).filter((i: EvidenceItem) => i.claim);
  const unsupported = Array.isArray(parsed.unsupported) ? parsed.unsupported.map(String) : [];
  const overallConfidence =
    typeof parsed.overallConfidence === "number"
      ? parsed.overallConfidence
      : items.length
        ? items.reduce((s, i) => s + i.confidence, 0) / items.length
        : 0.3;
  return { ticker: input.pack.ticker, items, unsupported, overallConfidence };
}

export function renderEvidenceMap(map: EvidenceMap): string {
  if (!map.items.length && !map.unsupported.length) return "EVIDENCE MAP: (empty)";
  return [
    `EVIDENCE MAP (confidence ${map.overallConfidence.toFixed(2)}):`,
    ...map.items.map(
      (i) =>
        `- [${i.direction}/T${i.tier}/c${i.confidence.toFixed(2)}] ${i.claim}: ${i.evidence.slice(0, 160)} ${i.factIds.join(" ")}`
    ),
    ...(map.unsupported.length
      ? ["UNSUPPORTED (honest gaps):", ...map.unsupported.map((u) => `- ${u}`)]
      : []),
  ].join("\n");
}

export default { buildEvidenceMap, mechanicalEvidenceMap, renderEvidenceMap };
