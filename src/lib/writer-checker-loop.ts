// ============================================================
// APEX RESEARCH — Writer-Checker Revision Loop (thesis & moat)
// ------------------------------------------------------------
// One AI writes, a second (checker) verifies, and the writer
// revises from the checker's feedback until the draft passes —
// bounded by MAX attempts, then the best draft wins and the
// deterministic PE fallback remains the safety net.
//
// The deterministic gate below is authoritative (free, no
// hallucination). The LLM checker adds semantic judgment on top.
// ============================================================

import { classifySector, validateSectorConcepts } from "./sectors/profiles";
import type { MoatRating } from "./moat";

export const WRITER_CHECKER_MAX_ATTEMPTS = 3;

export interface WriterCheckerGroundTruth {
  companyName: string;
  ticker: string;
  sector: string;
  industry: string;
  description: string;
  currency: string;
  /** Current market price per share. */
  cmp: number;
  /** DCF intrinsic fair value per share. */
  fv: number;
  /** (fv - cmp) / cmp, decimal. */
  upside: number;
  /** BUY | SELL | HOLD */
  verdict: string;
  wacc: number;
  terminalGrowthRate: number;
  canonicalMoat: MoatRating;
  /** ROIC - WACC in percentage points (for moat spread discipline). */
  roicSpreadPp?: number;
  /**
   * Shared operating-model vocabulary. When present, the checker uses THESE
   * lists (same instance every section receives) instead of re-classifying
   * the company — no section may independently classify.
   */
  operatingModel?: {
    requiredConcepts: string[];
    forbiddenConcepts: string[];
    isKnownSector: boolean;
    sector: string;
  } | null;
}

export interface DraftCheck {
  pass: boolean;
  issues: string[];
}

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

const hasToken = (s: string): boolean => /\{\{[^}]+\}\}/.test(s || "");

function extractCurrencyNumbers(sentence: string): number[] {
  const out: number[] = [];
  const re = /(?:Rs\.?|₹|\$|€|£)\s*([\d,]+(?:\.\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function extractPctNumbers(sentence: string): number[] {
  const out: number[] = [];
  const re = /([+-]?\d+(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

const splitSentences = (t: string): string[] =>
  (t || "").split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

/** Rating-stance contradiction on the combined draft text. */
function ratingIssues(text: string, verdict: string, conclusion: string): string[] {
  const issues: string[] = [];
  const v = (verdict || "HOLD").toUpperCase();
  const lower = `${text} ${conclusion}`.toLowerCase();
  if (v === "BUY" && /\b(sell rating|sell recommendation|strong sell|underperform)\b/i.test(lower)) {
    issues.push(`Verdict is BUY but the draft uses SELL-side stance language (sell/underperform) — align every recommendation sentence to BUY.`);
  }
  if (v === "BUY" && /\bunderweight\b/i.test(lower) && !/\bno underweight\b/i.test(lower)) {
    issues.push(`Verdict is BUY but the draft says UNDERWEIGHT — remove the contradiction.`);
  }
  if (v === "SELL" && /\b(buy rating|buy recommendation|strong buy|outperform)\b/i.test(lower)) {
    issues.push(`Verdict is SELL but the draft uses BUY-side stance language (buy/outperform) — align every recommendation sentence to SELL / UNDERWEIGHT.`);
  }
  if (v === "SELL" && /\boverweight\b/i.test(lower)) {
    issues.push(`Verdict is SELL but the draft says OVERWEIGHT — remove the contradiction.`);
  }
  // The conclusion must state the stance explicitly — otherwise the cover
  // verdict badge and the prose disagree by omission.
  const statesVerdict =
    v === "BUY"
      ? /\bbuy\b/i.test(conclusion || "")
      : v === "SELL"
        ? /\b(sell|underweight)\b/i.test(conclusion || "")
        : /\b(hold|neutral|fairly valued)\b/i.test(conclusion || "");
  if (!statesVerdict) {
    issues.push(`The investment conclusion never states the ${v} stance explicitly — add one sentence beginning with the ${v === "SELL" ? "SELL / UNDERWEIGHT" : v} recommendation and the fair-value target.`);
  }
  return issues;
}

/**
 * Number grounding — ONLY sentences that talk about valuation anchors
 * (target / fair value / CMP / upside) are judged, so market-cap or
 * revenue sentences can never false-fail the loop.
 */
function valuationNumberIssues(text: string, truth: WriterCheckerGroundTruth): string[] {
  const issues: string[] = [];
  const { cmp, fv, upside } = truth;
  const upsidePp = upside * 100;
  for (const sent of splitSentences(text)) {
    const low = sent.toLowerCase();
    const mentionsTarget = /(fair value|target|intrinsic|price objective|valuation)/i.test(low);
    const mentionsPrice = /(cmp|current.*price|trading at|prevailing)/i.test(low);
    const mentionsUpside = /(upside|implied|premium|discount|margin of safety)/i.test(low);
    if (!mentionsTarget && !mentionsPrice && !mentionsUpside) continue;
    for (const n of extractCurrencyNumbers(sent)) {
      const nearFv = fv > 0 && Math.abs(n - fv) / Math.max(1, Math.abs(fv)) <= 0.03;
      const nearCmp = cmp > 0 && Math.abs(n - cmp) / Math.max(1, Math.abs(cmp)) <= 0.03;
      if (!nearFv && !nearCmp) {
        issues.push(
          `Ungrounded price ${n} in "${sent.slice(0, 90)}…" — CMP is ${cmp.toFixed(2)} and fair value is ${fv.toFixed(2)}; every price in a valuation sentence must equal one of them (≤3%).`
        );
        break;
      }
    }
    if (mentionsUpside) {
      for (const p of extractPctNumbers(sent)) {
        if (Math.abs(p - upsidePp) > 2.0 && Math.abs(p + upsidePp) > 2.0) {
          issues.push(
            `Ungrounded upside ${p}% in "${sent.slice(0, 90)}…" — recomputed upside is ${upsidePp.toFixed(1)}%; restate it within ±2pp.`
          );
          break;
        }
      }
    }
  }
  return issues.slice(0, 4);
}

function sectorBleedIssues(text: string, truth: WriterCheckerGroundTruth): string[] {
  // Prefer the shared model instance (same lists every section receives).
  // Standalone classifySector fallback exists only for direct unit-test use.
  const modelLists = truth.operatingModel
    ? { forbidden: truth.operatingModel.forbiddenConcepts, required: truth.operatingModel.requiredConcepts, known: truth.operatingModel.isKnownSector }
    : null;
  if (modelLists) {
    const lower = (text || "").toLowerCase();
    const hit = (phrase: string): boolean => {
      const esc = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(lower);
    };
    const issues = modelLists.forbidden.filter(hit).slice(0, 6).map(
      (c) => `Off-sector term "${c}" — rewrite with this company's own sector KPIs (see guardrail), never another sector's vocabulary.`
    );
    // Required nudge (coaching, bounded by max attempts): a draft evidencing
    // zero required concepts for a known sector will hard-block in QA.
    if (modelLists.known && modelLists.required.length > 0 && !modelLists.required.some(hit)) {
      issues.push(`No required sector concept evidenced [${modelLists.required.slice(0, 6).join(", ")}] — rebuild the draft around the sector's own drivers and KPIs.`);
    }
    return issues;
  }
  try {
    const profile = classifySector(truth.sector, truth.industry, truth.description);
    const res = validateSectorConcepts(profile, text);
    if (!res.valid) {
      return res.leakedConcepts.slice(0, 6).map(
        (c) => `Off-sector term "${c}" — rewrite with this company's own sector KPIs (see guardrail), never another sector's vocabulary.`
      );
    }
  } catch {
    /* classifier failure must never block the loop */
  }
  return [];
}

// ─────────────────────────────────────────────
// Strategist draft (thesis + overview + conclusion)
// ─────────────────────────────────────────────

export interface StrategistDraft {
  investmentThesis?: string;
  companyOverview?: string;
  investmentConclusion?: string;
}

export function checkStrategistDraft(draft: StrategistDraft, truth: WriterCheckerGroundTruth): DraftCheck {
  const issues: string[] = [];
  const thesis = (draft.investmentThesis || "").trim();
  const overview = (draft.companyOverview || "").trim();
  const conclusion = (draft.investmentConclusion || "").trim();

  if (thesis.length < 200) issues.push(`Investment thesis is too thin (${thesis.length} chars) — write 3 flowing paragraphs: secular runway, operating leverage/unit economics, re-rating runway with numbers.`);
  if (overview.length < 100) issues.push(`Company overview is too thin — write 2 paragraphs on segment mix, proprietary edge, footprint.`);
  if (conclusion.length < 100) issues.push(`Investment conclusion is too thin — write 2 paragraphs ending in the explicit ${truth.verdict} stance with target and upside.`);
  if (hasToken(thesis + overview + conclusion)) issues.push(`Unresolved {{PLACEHOLDER}} token leaked — replace every {{…}} with the grounded value or delete it.`);

  const combined = `${thesis} ${overview} ${conclusion}`;
  issues.push(...ratingIssues(combined, truth.verdict, conclusion));
  issues.push(...valuationNumberIssues(`${thesis} ${conclusion}`, truth));
  issues.push(...sectorBleedIssues(combined, truth));

  return { pass: issues.length === 0, issues: issues.slice(0, 8) };
}

// ─────────────────────────────────────────────
// Moat draft (pillars + sources + narrative)
// ─────────────────────────────────────────────

export interface MoatDraft {
  competitiveMoat?: string;
  moatSources?: { switchingCosts?: string; intangibleAssets?: string; costAdvantage?: string; moatTrend?: string };
  moatPillars?: { pillar?: string; durability?: string; rationale?: string }[];
}

const WIDE_SUPERLATIVES = /(wide moat|formidable moat|unassailable|expanding moat|widening moat|durable moat|20\+\s*(yrs|years))/i;
const LONG_DURABILITY = /(1[5-9]\+?\s*(yrs|years)|20\+?\s*(yrs|years)|15\+?\s*(yrs|years))/i;

export function checkMoatDraft(draft: MoatDraft, truth: WriterCheckerGroundTruth): DraftCheck {
  const issues: string[] = [];
  const narrative = (draft.competitiveMoat || "").trim();
  const sources = draft.moatSources || {};
  const pillars = Array.isArray(draft.moatPillars) ? draft.moatPillars : [];
  const rating = truth.canonicalMoat;

  if (narrative.length < 150) issues.push(`Moat narrative is too thin — write 2 paragraphs on moat width, CAP duration, and ROIC-vs-WACC defensibility.`);
  if (!(sources.switchingCosts || "").trim() || (sources.switchingCosts || "").trim().length < 40)
    issues.push(`Switching-costs source is missing or vague — evidence it from this business model.`);
  if (!(sources.intangibleAssets || "").trim() || (sources.intangibleAssets || "").trim().length < 40)
    issues.push(`Intangible-assets source is missing or vague — name the certifications/IP that actually apply.`);
  if (!(sources.costAdvantage || "").trim() || (sources.costAdvantage || "").trim().length < 40)
    issues.push(`Cost-advantage source is missing or vague — evidence scale/procurement/infrastructure.`);
  if (!/^(positive|stable|negative)/i.test((sources.moatTrend || "").trim()))
    issues.push(`Moat trend must start with Positive, Stable, or Negative plus empirical rationale.`);
  if (pillars.length < 3) issues.push(`Provide at least 3 moat pillars (got ${pillars.length}).`);

  // Ceiling: pillars are subordinate to the canonical composite — never upgrades.
  if (rating === "Narrow") {
    pillars.forEach((p, i) => {
      if (/wide/i.test(p?.durability || "")) issues.push(`Pillar ${i + 1} claims "${p?.durability}" but canonical composite is Narrow — cap every durability at Narrow (7-10 Yrs) or below.`);
    });
    const blob = `${narrative} ${pillars.map((p) => `${p?.pillar} ${p?.rationale}`).join(" ")}`;
    if (WIDE_SUPERLATIVES.test(blob)) issues.push(`Canonical moat is Narrow — remove wide-moat superlatives (wide/durable/formidable/unassailable/expanding moat). Describe limited, contested advantages plainly.`);
    if (LONG_DURABILITY.test(pillars.map((p) => p?.durability || "").join(" ")))
      issues.push(`Canonical moat is Narrow — no pillar durability may exceed 10 years.`);
  } else if (rating === "None") {
    const blob = `${narrative} ${sources.switchingCosts} ${sources.intangibleAssets} ${sources.costAdvantage} ${pillars.map((p) => `${p?.pillar} ${p?.durability} ${p?.rationale}`).join(" ")}`;
    if (/(wide moat|narrow moat|wide \(|narrow \()/i.test(blob))
      issues.push(`Canonical moat is None — the draft must not claim a Wide or Narrow moat anywhere; describe absent/contested advantages plainly.`);
    pillars.forEach((p, i) => {
      if (!/none/i.test(p?.durability || "")) issues.push(`Pillar ${i + 1} durability must read None (< 3 Yrs) under a None composite (got "${p?.durability || "—"}").`);
    });
  }

  // ROIC-spread discipline: never claim excess returns when the spread is negative.
  if (typeof truth.roicSpreadPp === "number" && truth.roicSpreadPp < -0.5) {
    const blob = `${narrative} ${sources.costAdvantage}`;
    if (/(exceed.*cost of capital|above.*wacc|substantially exceed|returns.*comfortably above)/i.test(blob))
      issues.push(`ROIC trails WACC by ${Math.abs(truth.roicSpreadPp).toFixed(1)}pp — do not claim returns exceed the cost of capital; acknowledge the deficit.`);
  }

  const combined = `${narrative} ${sources.switchingCosts} ${sources.intangibleAssets} ${sources.costAdvantage} ${pillars.map((p) => `${p?.pillar} ${p?.rationale}`).join(" ")}`;
  if (hasToken(combined)) issues.push(`Unresolved {{PLACEHOLDER}} token leaked — replace or delete it.`);
  issues.push(...sectorBleedIssues(combined, truth));

  return { pass: issues.length === 0, issues: issues.slice(0, 8) };
}

// ─────────────────────────────────────────────
// Refinement prompt builders — feed the checker's
// verdict back to the writer verbatim.
// ─────────────────────────────────────────────

export function buildStrategistRefinePrompt(truth: WriterCheckerGroundTruth, draft: StrategistDraft, issues: string[]): string {
  const lines = issues.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    `REVISION REQUIRED — the checker REJECTED your thesis draft for ${truth.companyName} (${truth.ticker}).`,
    ``,
    `Ground truth (immutable — restate exactly, never invent):`,
    `- Verdict: ${truth.verdict} | Fair value target: ${truth.fv.toFixed(2)} ${truth.currency} | CMP: ${truth.cmp.toFixed(2)} | Implied upside: ${(truth.upside * 100).toFixed(1)}%`,
    `- WACC ${(truth.wacc * 100).toFixed(1)}%, terminal growth ${(truth.terminalGrowthRate * 100).toFixed(1)}%.`,
    ``,
    `Your rejected draft (revise THIS text, do not start over with boilerplate):`,
    `THESIS: ${(draft.investmentThesis || "").slice(0, 1500)}`,
    `CONCLUSION: ${(draft.investmentConclusion || "").slice(0, 800)}`,
    ``,
    `Checker findings (fix EVERY one, in order):`,
    lines,
    ``,
    `Return the SAME JSON shape (investmentThesis, companyOverview, investmentConclusion, swotStrengths, swotWeaknesses, swotOpportunities, swotThreats). Raw JSON only.`,
  ].join("\n");
}

export function buildMoatRefinePrompt(truth: WriterCheckerGroundTruth, draft: MoatDraft, issues: string[]): string {
  const lines = issues.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    `REVISION REQUIRED — the checker REJECTED your moat draft for ${truth.companyName} (${truth.ticker}).`,
    ``,
    `Ground truth (immutable): canonical composite moat is ${truth.canonicalMoat}. Pillars are subordinate breakdowns — never independent upgrades.`,
    ``,
    `Your rejected pillars (revise THESE, capped at the composite):`,
    (draft.moatPillars || []).map((p, i) => `${i + 1}. ${p?.pillar || "?"} — ${p?.durability || "?"}: ${(p?.rationale || "").slice(0, 160)}`).join("\n") || "(no pillars)",
    ``,
    `Checker findings (fix EVERY one, in order):`,
    lines,
    ``,
    `Return the SAME JSON shape (competitiveMoat, moatSources, fiveForces, moatPillars). Raw JSON only.`,
  ].join("\n");
}

/** Keep the draft with the fewest checker issues for fallback. */
export function fewerIssues(a: string[], b: string[]): boolean {
  return a.length < b.length;
}
