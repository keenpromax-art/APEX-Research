/**
 * APEX RESEARCH — AI CONTENT DEPTH GUIDANCE (shared)
 * ---------------------------------------------------
 * Single source of analytical-depth directives for every AI builder stage.
 * Bland reports come from prompts that say `"thesis": "string"` with no
 * length contract — the model writes one sentence and stops. Each directive
 * below sets paragraph/sentence minimums PER FIELD so every stage returns
 * institution-grade depth.
 *
 * HARD CONSTRAINT (all stages): depth means MORE mechanism, history,
 * transmission chains and evidence — NEVER new numbers. Every quantitative
 * statement still cites a [F-...] fact or canonical output. If evidence is
 * thin, write longer about what is UNKNOWN and what research would resolve
 * it, rather than padding with adjectives.
 */

export type DepthStage =
  | "understanding"
  | "economicEngine"
  | "debates"
  | "narrative"
  | "discovery"
  | "model"
  | "scenarios"
  | "valuation";

export const DEPTH_TOKEN_BUDGETS: Record<DepthStage, number> = {
  understanding: 5000,
  economicEngine: 5000,
  debates: 5000,
  narrative: 6000,
  discovery: 6000,
  model: 4500,
  scenarios: 4000,
  valuation: 4000,
};

/** Appended to every stage directive: depth never licenses invention. */
export const DEPTH_EVIDENCE_GUARD =
  `EVIDENCE HARD CONSTRAINT: depth means MORE mechanism, history, transmission chains and evidence — NEVER new numbers. ` +
  `Every quantitative statement cites a [F-...] fact or canonical output. If evidence is thin, write longer about what is ` +
  `UNKNOWN and what research would resolve it, never adjectives. Terse output FAILS.`;

export const DEPTH_DIRECTIVES: Record<DepthStage, string> = {
  understanding: `ANALYTICAL DEPTH CONTRACT (you are graded on completeness — terse output FAILS):
- "whatItDoes": 4-6 sentences — founding/history, what it sells, to whom, where it operates (plants, branches, digital footprint), and how the business has evolved. Name real products, segments and geographies from the facts.
- "howItMakesMoney": 3-4 sentences — the revenue equation (volume × realization × mix), who pays, recurring vs transactional split, and where margin is actually earned.
- "industryContext": 4-5 sentences — market structure, demand drivers, regulatory frame, cycle position, and this company's share/position within it.
- "whyThisCompany": 3-4 sentences — the investable differentiator stated as a mechanism, not a slogan.
- EVERY driver "mechanism": 2-3 sentences — the causal chain (driver → operating lever → financial line) with the statement line it moves.
- "competitiveAdvantages": 3-4 advantages, each with a full economic chain (asset → mechanism → KPI → financial → valuation) and [F-...] citations.
- "competitiveThreats": 3-4 threats with erosion mechanisms, each 2+ sentences.
- "currentInflections": 3-5 items, each stating what changed, the evidence, and why it matters to the investment case now.`,

  economicEngine: `ANALYTICAL DEPTH CONTRACT (terse output FAILS):
- EVERY driver "mechanism": 2-3 sentences — physical/operating causality (e.g., occupancy → rent realization → NOI; subscriber adds → ARPU → recurring revenue), the statement line bound, and the sensitivity direction.
- "primaryAbstraction": one precise sentence naming the economic machine (e.g., "deposit-funded maturity-transformation lender", "branded volume compounder").
- "valueQuestions": 4-6 questions, each naming the KPI, the financial consequence and the valuation consequence of the answer.
- Cover revenue, cost, margin, cash, balance-sheet, capital AND returns drivers — no driver family left as a single fragment.`,

  debates: `ANALYTICAL DEPTH CONTRACT (terse output FAILS):
- Identify 3-5 debates (never fewer than 3 while evidence supports them). Each debate: 3-4 sentences of mechanism (what is disagreed, the transmission into revenue/margin/cash, and the valuation stake), evidence FOR (2+ cited items), evidence AGAINST (2+ cited items), financial consequence, valuation consequence, and a concrete resolution signal with monitoring KPI.
- "thesis": 2-3 full paragraphs — paragraph 1 opens with the CENTRAL debate and the chain (evidence → mechanism → KPI → financial → valuation); paragraph 2 weighs bull vs bear evidence; paragraph 3 states what must happen and what would invalidate, with KPIs.
- "invalidationCondition": specific, observable, falsifiable — never "if growth slows".`,

  narrative: `ANALYTICAL DEPTH CONTRACT (this is the report's analytical core — terse output FAILS):
- "thesis.thesis": 3-4 full paragraphs. P1: central debate + complete chain (evidence → mechanism → KPI → financial consequence → valuation consequence). P2: bull evidence weighed against bear evidence with numbers cited. P3: what must happen for the thesis to compound. P4 (when supported): key risk to the thesis and its monitorable.
- "bullCase": 4-6 items, EACH 2-3 sentences as a full chain (evidence → mechanism → KPI → financial → valuation). "bearCase": same depth on the other side.
- "keyDebate": 2-3 sentences. "keyInflectionPoints": 3-5 items with timing and KPI. "whatMarketMayBeMissing": 2-3 sentences naming the mispriced mechanism. "whatCouldInvalidate": 3-5 specific falsifiable conditions.
- "catalysts": 4-8 items, EVERY field filled (event, mechanism 2+ sentences, timeframe, observable KPI, direction, forecast impact, valuation impact, invalidation). Omit only when truly unevidenced — never pad with generic "earnings beat".
- "risks": 5-8 items, EVERY field filled (risk, mechanism 2+ sentences, affected KPI, financial consequence, valuation consequence, monitoring indicator).
- "competitiveAnalysis.competitors": 3-6 REAL rivals with segment-level overlap, economic similarity, key difference, and relative strengths/weaknesses (2+ sentences each) — never brand adjectives.
- "moat.sources": 3-5 sources, EACH a full chain (asset → mechanism → KPI → financial → valuation) with durability horizon and threats (2+ sentences each). "moat.verdict": a full paragraph, not a label.`,

  discovery: `ANALYTICAL DEPTH CONTRACT (these seeds become report prose — terse seeds starve every downstream writer):
- EVERY writer seed (coverage notes, moat seeds, catalyst seeds, risk seeds, competitive seeds): 3-5 sentences — the observation, the mechanism, the affected KPI/financial line, and what evidence would strengthen or kill it.
- "economic insights" (margin mechanism, working-capital chain, ROIC interpretation, target-price methodology): 3-4 sentences each as chains, never labels.
- Gaps: for each "missing" area, 2-3 sentences on what is unknown, why it matters to valuation, and the exact research required (filing, call, disclosure).`,

  model: `ANALYTICAL DEPTH CONTRACT:
- EVERY assumption: 2-3 sentences of rationale — historical evidence (CAGR, margin trajectory, ROE, leverage cited), sector normalization, and why THIS value (not a default) fits THIS company.
- "rationale" fields: full paragraphs. A bare number with "management guidance" and no mechanism FAILS.`,

  scenarios: `ANALYTICAL DEPTH CONTRACT:
- EVERY scenario (bull/base/bear): 3-4 sentences — the narrative trigger, which forecast variables move and by what logic, the transmission to fair value, and the observable signpost that the scenario is unfolding.
- Sensitivity discussion: 2-3 sentences naming the single assumption that moves the target most and why.`,

  valuation: `ANALYTICAL DEPTH CONTRACT:
- "interpretation": 3-4 sentences — what the market price implies (growth, margin, duration), whether evidence supports it, and the valuation consequence of being wrong.
- Method justification: 2-3 sentences on WHY this lens (DCF / residual income / SOTP / NAV) fits THIS economic machine.`,
};

// The evidence guard is part of every stage contract: builders interpolate
// DEPTH_DIRECTIVES, so appending here reaches all prompts with no per-file edit.
for (const stage of Object.keys(DEPTH_DIRECTIVES) as DepthStage[]) {
  DEPTH_DIRECTIVES[stage] = `${DEPTH_DIRECTIVES[stage]}\n\n${DEPTH_EVIDENCE_GUARD}`;
}

/** Structural input for identity-driven depth emphasis (no import cycle: plain shape). */
export interface DepthBriefInput {
  ticker: string;
  economicType: string;
  questionType: string;
  investorQuestion?: string | null;
  coreTopics?: string[];
  suppressedTopics?: string[];
  signatureTitles?: string[];
  narrativeArchetype?: string;
}

/**
 * Deterministic depth-emphasis brief from ResearchDNA summaries.
 * Appended to writer contexts so TIER_1 topics and signature analyses get
 * expanded prose while suppressed topics stay suppressed. Pure string
 * assembly — no LLM, no numbers, no invention.
 */
export function depthBriefForIdentity(input: DepthBriefInput): string {
  const lines: string[] = [
    `RESEARCH IDENTITY EMPHASIS (deterministic — obey depths, do not invent):`,
    `- Economic machine: ${input.economicType}. Investor question type: ${input.questionType}.`,
  ];
  if (input.investorQuestion) lines.push(`- Central investor question (open the thesis with it): ${input.investorQuestion.slice(0, 280)}`);
  if (input.coreTopics?.length) {
    lines.push(`- TIER_1 CORE topics (expand to full depth, 3+ paragraphs each with chains): ${input.coreTopics.join(", ")}.`);
  }
  if (input.signatureTitles?.length) {
    lines.push(`- Signature analyses (each needs its own deep section with mechanism + evidence + valuation consequence): ${input.signatureTitles.join(" | ")}.`);
  }
  if (input.suppressedTopics?.length) {
    lines.push(`- SUPPRESSED topics (do NOT pad these to fill space — one honest sentence or omit): ${input.suppressedTopics.join(", ")}.`);
  }
  if (input.narrativeArchetype) lines.push(`- Narrative emphasis: ${input.narrativeArchetype}.`);
  return lines.join("\n");
}
