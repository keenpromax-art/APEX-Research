/**
 * APEX RESEARCH — AI Draft Quality Layer (shift quality left)
 *
 * Every council agent gets the SAME three guarantees, whether it has a
 * bespoke writer-checker loop (strategist, moat) or is single-shot
 * (news, forensic, credit, governance, news-summary):
 *
 *   1. RESPONSE CONTRACT (prompt hardening) — required concepts are stated
 *      WITH their natural-language aliases (GMV = gross merchandise value,
 *      take-rate, fulfilment…), so the writer's first draft already speaks
 *      QA-matchable vocabulary. Numeric discipline is stated once, plainly.
 *   2. DETERMINISTIC DRAFT AUDIT (free self-check) — thin sections,
 *      {{placeholder}} leaks, forbidden-concept hits, zero required-concept
 *      coverage, rating-stance contradictions, and ungrounded valuation
 *      numbers are caught WITHOUT spending a second LLM call.
 *   3. TARGETED REPAIR (one bounded retry) — only drafts with detectable
 *      defects pay for a second LLM call, and the repair prompt quotes the
 *      exact violations instead of "try again".
 *
 * The deterministic audit mirrors the QA gates (ONT-01/OM-01 vocabulary,
 * RATING-02 stance, SANITIZE-01 bleed) using the SAME shared operating-model
 * instance and alias map — a draft that passes here is structurally
 * pre-aligned with what QA will check downstream.
 */

import type { ResearchOperatingModel } from "../research-model/operating-model";
import { REQUIRED_CONCEPT_ALIASES } from "../company-ontology";

// ─────────────────────────────────────────────
// 1. Response contract (prompt block)
// ─────────────────────────────────────────────

/**
 * "GMV (gross merchandise value)" style display for prompt injection, so
 * writers emit QA-matchable vocabulary in natural full forms instead of
 * bare abbreviations the audit cannot see.
 */
export function displayConceptWithAliases(concept: string): string {
  const aliases = REQUIRED_CONCEPT_ALIASES[concept.toLowerCase()] || [];
  return aliases.length > 0 ? `${concept} (${aliases.slice(0, 3).join(" / ")})` : concept;
}

/**
 * Compact quality contract appended after the sector guardrail. States WHAT
 * vocabulary to evidence (with usable full forms, not bare abbreviations),
 * WHAT to never write, and the numeric-grounding law — in ~15 lines so it
 * fits every agent prompt without crowding out company facts.
 */
export function buildResponseContract(model: ResearchOperatingModel | null | undefined): string {
  if (!model) return "";
  const required = model.requiredConcepts.slice(0, 6).map(displayConceptWithAliases).join("; ");
  return [
    `RESPONSE CONTRACT (violations are machine-checked before your draft is accepted):`,
    `- Evidence ≥2 of these sector concepts, using the terms VERBATIM as listed (each parenthesized full form counts equally): ${required || "none"}. On first use give both forms, e.g. total contract value (TCV). Do not paraphrase them away into generic filler (growth was good, strong execution) — the sector nouns must appear in the text.`,
    `- NEVER write the STRICTLY FORBIDDEN terms from the guardrail above (any form, including inside compound phrases). When tempted, use the sector KPIs instead.`,
    `- NUMERIC LAW: every price, %, or multiple you state must come from the inputs in THIS prompt (CMP, fair value, margins, growth). Never invent targets, growth rates, or valuation impacts. Restate given numbers exactly; do not round fair value or upside.`,
    `- No {{PLACEHOLDER}} tokens, no markdown, no boilerplate openers ("In today's dynamic…"). Every section must carry substance, not filler.`,
  ].join("\n");
}

// ─────────────────────────────────────────────
// 2. Deterministic draft audit
// ─────────────────────────────────────────────

export interface DraftAuditOptions {
  /** Shared operating-model instance (same one every section received). */
  model?: ResearchOperatingModel | null;
  /** Per-section minimum character counts. Defaults apply when omitted. */
  minChars?: Record<string, number>;
  /** Canonical verdict for stance checks (BUY/HOLD/SELL/NR). Omit to skip. */
  verdict?: string;
  /** Conclusion/stance text for the verdict-presence check. Omit to skip. */
  stanceText?: string;
  /** Valuation anchors for number grounding. Omit to skip. */
  valuation?: { cmp: number; fv: number; upsidePct: number };
  /** Max issues returned (default 8). */
  maxIssues?: number;
}

const DEFAULT_MIN_CHARS = 120;

function boundaryHit(lower: string, phrase: string): boolean {
  const esc = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(lower);
}

/**
 * Abbreviation-safe sentence splitter. A naive split on ". " fragments
 * currency abbreviations ("Rs. 335.90" → ["…Rs.", "335.90…"]), detaching
 * prices from their valuation sentences so number grounding silently skips
 * them. Normalizing known abbreviations first keeps price and context in
 * one sentence (audit-only transform; drafts are never rewritten).
 */
export function splitAuditSentences(text: string): string[] {
  const normalized = (text || "")
    .replace(/\bRs\.\s*/g, "Rs ")
    .replace(/\bvs\.\s*/gi, "vs ")
    .replace(/\be\.g\.\s*/gi, "e.g. ")
    .replace(/\bi\.e\.\s*/gi, "i.e. ");
  return normalized.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

function flattenSection(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(flattenSection).join("\n");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(flattenSection).join("\n");
  return "";
}

function requiredHit(lower: string, concept: string): boolean {
  if (boundaryHit(lower, concept)) return true;
  const aliases = REQUIRED_CONCEPT_ALIASES[concept.toLowerCase()] || [];
  return aliases.some((a) => boundaryHit(lower, a));
}

/**
 * Audit a draft (flat section-name → value record) without any LLM call.
 * Returns human-readable issues suitable for verbatim injection into a
 * repair prompt. Empty array = structurally clean draft.
 */
export function auditDraftSections(
  sections: Record<string, unknown>,
  opts: DraftAuditOptions = {}
): string[] {
  const issues: string[] = [];
  const max = opts.maxIssues ?? 8;
  const push = (s: string) => { if (issues.length < max) issues.push(s); };

  // Thin / empty sections.
  for (const [name, value] of Object.entries(sections)) {
    const text = flattenSection(value).trim();
    const min = opts.minChars?.[name] ?? DEFAULT_MIN_CHARS;
    if (text.length === 0) push(`Section "${name}" is EMPTY — write substantive, company-specific analysis (no placeholders, no "N/A" filler).`);
    else if (text.length < min) push(`Section "${name}" is too thin (${text.length} chars, need ≥${min}) — expand with evidenced drivers, numbers, and mechanisms.`);
  }

  const combined = Object.values(sections).map(flattenSection).join("\n");

  // Placeholder leaks.
  if (/\{\{[^}]+\}\}/.test(combined)) push(`Unresolved {{PLACEHOLDER}} token leaked — replace every {{…}} with the grounded value or delete it.`);

  const model = opts.model;
  if (model) {
    const lower = combined.toLowerCase();
    // Forbidden concepts (exact — never aliased).
    const forbidden = model.forbiddenConcepts.filter((c) => boundaryHit(lower, c)).slice(0, 6);
    for (const c of forbidden) push(`Off-sector term "${c}" — rewrite with this company's own sector KPIs, never another sector's vocabulary.`);
    // Required coverage nudge with USABLE vocabulary (aliases included so the
    // writer knows which full forms count — this is what prevents ONT-01/OM-01
    // zero-evidence blocks downstream).
    if (model.isKnownSector && model.requiredConcepts.length > 0) {
      const evidenced = model.requiredConcepts.filter((c) => requiredHit(lower, c));
      if (evidenced.length === 0) {
        push(`No required sector concept evidenced [${model.requiredConcepts.slice(0, 6).map(displayConceptWithAliases).join("; ")}] — rebuild the draft around the sector's own drivers and KPIs (a zero-evidence draft hard-blocks QA).`);
      }
    }
  }

  // Rating stance (mirrors RATING-02, cheap subset).
  if (opts.verdict && opts.stanceText !== undefined) {
    const v = opts.verdict.toUpperCase();
    const stance = (opts.stanceText || "").toLowerCase();
    if (v === "BUY" && /\b(sell rating|sell recommendation|strong sell|underperform|underweight)\b/.test(stance)) {
      push(`Verdict is BUY but the draft uses SELL-side stance language — align every recommendation sentence to BUY.`);
    } else if (v === "SELL" && /\b(buy rating|buy recommendation|strong buy|outperform|overweight)\b/.test(stance)) {
      push(`Verdict is SELL but the draft uses BUY-side stance language — align every recommendation sentence to SELL.`);
    }
  }

  // Valuation-number grounding on valuation-flavored sentences only.
  if (opts.valuation) {
    const { cmp, fv, upsidePct } = opts.valuation;
    for (const sent of splitAuditSentences(combined)) {
      const low = sent.toLowerCase();
      const priceAnchored = /(fair value|target|intrinsic|price objective|valuation|cmp|current.*price|trading at|prevailing)/i.test(low);
      const mentionsUpside = /(upside|implied|premium|discount|margin of safety)/i.test(low);
      if (!priceAnchored && !mentionsUpside) continue;
      // Currency grounding on price-anchored sentences only — market-cap / EV
      // sentences with premium/discount phrasing carry different bases.
      if (priceAnchored) {
        let bad = false;
        for (const m of sent.matchAll(/(?:Rs\.?|₹|\$|€|£)\s*([\d,]+(?:\.\d+)?)/gi)) {
          const n = parseFloat(m[1].replace(/,/g, ""));
          if (!Number.isFinite(n)) continue;
          const nearFv = fv > 0 && Math.abs(n - fv) / Math.max(1, Math.abs(fv)) <= 0.03;
          const nearCmp = cmp > 0 && Math.abs(n - cmp) / Math.max(1, Math.abs(cmp)) <= 0.03;
          if (!nearFv && !nearCmp) { bad = true; break; }
        }
        if (bad) {
          push(`Ungrounded price in "${sent.slice(0, 90)}…" — CMP is ${cmp.toFixed(2)} and fair value is ${fv.toFixed(2)}; every price in a valuation sentence must equal one of them (≤3%).`);
          break;
        }
      }
      if (/(upside|implied|premium|discount)/i.test(low)) {
        for (const m of sent.matchAll(/([+-]?\d+(?:\.\d+)?)\s*%/g)) {
          // WACC / terminal-growth rates routinely share upside sentences
          // ("upside +0.0% on WACC 11.7%") — they are inputs, not claims.
          const before = sent.slice(Math.max(0, (m.index ?? 0) - 18), m.index ?? 0);
          if (/wacc|terminal growth|discount rate/i.test(before)) continue;
          const p = parseFloat(m[1]);
          if (Math.abs(p - upsidePct) > 2.0 && Math.abs(p + upsidePct) > 2.0) {
            push(`Ungrounded upside ${p}% in "${sent.slice(0, 90)}…" — recomputed upside is ${upsidePct.toFixed(1)}%; restate it within ±2pp.`);
            break;
          }
        }
        if (issues.length >= max) break;
      }
    }
  }

  return issues;
}

// ─────────────────────────────────────────────
// 3. Targeted repair + bounded loop
// ─────────────────────────────────────────────

/** Build a repair user-prompt: rejected excerpts + numbered violations. */
export function buildRepairPrompt(args: {
  companyLabel: string;
  shapeName: string;
  excerpts: Array<{ name: string; text: string }>;
  issues: string[];
  groundTruth?: string[];
}): string {
  const lines = args.issues.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    `REVISION REQUIRED — your ${args.shapeName} draft for ${args.companyLabel} FAILED the deterministic quality gate (no new LLM audit needed; these are mechanical violations).`,
    ...(args.groundTruth && args.groundTruth.length > 0
      ? [`Ground truth (immutable — restate exactly, never invent):`, ...args.groundTruth.map((g) => `- ${g}`)]
      : []),
    ``,
    `Your rejected draft excerpts (revise THIS text, do not restart with boilerplate):`,
    ...args.excerpts.map((e) => `${e.name.toUpperCase()}: ${(e.text || "").slice(0, 900)}`),
    ``,
    `Violations (fix EVERY one, in order):`,
    lines,
    ``,
    `Return the SAME JSON shape as originally requested. Raw JSON only, no markdown.`,
  ].join("\n");
}

export interface GuardedDraftResult<T> {
  draft: T;
  /** Issues on the RETURNED draft (empty = clean first pass or clean repair). */
  issues: string[];
  /** True when a repair retry was consumed. */
  repaired: boolean;
  /** Attempts consumed (1 = first pass accepted). */
  attempts: number;
}

/**
 * Bounded writer→audit→repair loop for single-shot agents. The writer runs
 * once; only drafts with detectable defects pay for a second call, and the
 * repair prompt quotes exact violations. Best draft wins (never empty when
 * a non-empty draft exists). Max 2 attempts — same budget as the bespoke
 * strategist/moat loops.
 */
export async function runGuardedDraft<T>(args: {
  writer: (repairPrompt: string | null, prior: T | null) => Promise<T>;
  sectionsOf: (draft: T) => Record<string, unknown>;
  auditOpts: DraftAuditOptions;
  shapeName: string;
  companyLabel: string;
  excerptsOf?: (draft: T) => Array<{ name: string; text: string }>;
  groundTruth?: string[];
  maxAttempts?: number;
}): Promise<GuardedDraftResult<T>> {
  const max = args.maxAttempts ?? 2;
  let best: T | null = null;
  let last: T | null = null;
  let bestIssues: string[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  let consumed = 0;

  for (let attempt = 1; attempt <= max; attempt++) {
    consumed = attempt;
    let draft: T;
    if (attempt === 1) {
      draft = await args.writer(null, null);
    } else {
      // Excerpts come from the LATEST writer output (last), never best:
      // the best draft may be null when every attempt so far came back empty.
      const excerptDraft = (last ?? best) as T;
      const excerpts = args.excerptsOf
        ? args.excerptsOf(excerptDraft)
        : Object.entries(args.sectionsOf(excerptDraft)).slice(0, 3).map(([name, v]) => ({ name, text: flattenSection(v) }));
      draft = await args.writer(
        buildRepairPrompt({
          companyLabel: args.companyLabel,
          shapeName: args.shapeName,
          excerpts,
          issues: bestIssues,
          groundTruth: args.groundTruth,
        }),
        best
      );
    }
    last = draft;
    const issues = auditDraftSections(args.sectionsOf(draft), args.auditOpts);
    const hasContent = Object.values(args.sectionsOf(draft)).some((v) => flattenSection(v).trim().length > 0);
    if (hasContent && issues.length < bestScore) {
      best = draft;
      bestIssues = issues;
      bestScore = issues.length;
    }
    if (issues.length === 0) {
      return { draft, issues, repaired: attempt > 1, attempts: attempt };
    }
    if (attempt >= max) break;
  }
  // Best-content draft wins; when every attempt came back empty, return the
  // most recent draft (the writer's own empty-fallback object) so callers see
  // identical behavior to the pre-loop single-shot path. Writers that throw
  // propagate (caller's rate-limit handling owns retries).
  const final = (best ?? last) as T;
  return { draft: final, issues: best !== null ? bestIssues : auditDraftSections(args.sectionsOf(final), args.auditOpts), repaired: consumed > 1, attempts: consumed };
}

export default { buildResponseContract, auditDraftSections, buildRepairPrompt, runGuardedDraft };

