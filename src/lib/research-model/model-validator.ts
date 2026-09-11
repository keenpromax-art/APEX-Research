/**
 * APEX RESEARCH — Operating-Model Validator (research-model layer)
 * ----------------------------------------------------------------
 * Hard narrative validation against ONE ResearchOperatingModel instance.
 *
 * Policy (no WARN escape hatch for leakage):
 *  - ANY forbidden concept in ANY section  → BLOCKER (fail-closed).
 *  - Known sector with ZERO required concepts evidenced report-wide
 *    → BLOCKER (generic/wrong template applied).
 *  - Known sector with exactly ONE required concept → WARN (thin coverage).
 *  - `general` sector → required absence never blocks (no narrow vocab).
 *
 * All matching is boundary-safe (no substring false positives: "nim" never
 * fires inside "animal", "arpu" never inside "sharpened").
 */
import type { ResearchOperatingModel } from "./operating-model";

/** Canonical narrative sections. Every section receives the same model instance. */
export const NARRATIVE_SECTIONS = [
  "thesis",
  "overview",
  "conclusion",
  "moat",
  "strategy",
  "swot",
  "risks",
  "catalysts",
  "financials",
  "credit",
  "governance",
  "news",
] as const;

export type NarrativeSectionName = (typeof NARRATIVE_SECTIONS)[number];

export interface SectionScan {
  section: string;
  /** Forbidden concepts of THIS model found in this section. */
  forbiddenHits: string[];
  /** Required concepts of THIS model evidenced in this section. */
  requiredHits: string[];
  pass: boolean;
}

export interface ReportModelValidation {
  pass: boolean;
  /** Hard blockers: each is a publication-blocking finding. */
  blockers: Array<{ section: string; kind: "forbidden" | "required"; terms: string[]; message: string }>;
  /** Advisory findings (thin required coverage). */
  warnings: Array<{ section: string; message: string }>;
  perSection: SectionScan[];
  requiredEvidenced: string[];
  requiredMissing: string[];
}

export function boundaryHit(haystackLower: string, phrase: string): boolean {
  const esc = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(haystackLower);
}

/** Scan one text blob against the model's vocabulary controls. */
export function scanTextForModel(
  model: ResearchOperatingModel,
  text: string
): { forbiddenHits: string[]; requiredHits: string[] } {
  const lower = (text || "").toLowerCase();
  const forbiddenHits = model.forbiddenConcepts.filter((c) => boundaryHit(lower, c));
  const requiredHits = model.requiredConcepts.filter((c) => boundaryHit(lower, c));
  return { forbiddenHits, requiredHits };
}

/** Validate a single narrative section. Any forbidden hit fails the section. */
export function validateSection(
  model: ResearchOperatingModel,
  section: string,
  text: string
): SectionScan {
  const { forbiddenHits, requiredHits } = scanTextForModel(model, text || "");
  return { section, forbiddenHits, requiredHits, pass: forbiddenHits.length === 0 };
}

/**
 * Validate a full report's narrative sections against ONE model instance.
 * `sections` maps section name → narrative text for that section.
 */
export function validateReport(
  model: ResearchOperatingModel,
  sections: Record<string, string | undefined | null>
): ReportModelValidation {
  const perSection: SectionScan[] = [];
  const blockers: ReportModelValidation["blockers"] = [];
  const warnings: ReportModelValidation["warnings"] = [];
  const evidenced = new Set<string>();

  for (const name of Object.keys(sections)) {
    const scan = validateSection(model, name, sections[name] || "");
    perSection.push(scan);
    for (const r of scan.requiredHits) evidenced.add(r.toLowerCase());
    if (!scan.pass) {
      blockers.push({
        section: name,
        kind: "forbidden",
        terms: scan.forbiddenHits,
        message: `Cross-sector leakage in "${name}": ${scan.forbiddenHits.length} forbidden concept(s) for ${model.sector} [${scan.forbiddenHits.join(", ")}].`,
      });
    }
  }

  const requiredEvidenced = model.requiredConcepts.filter((c) => evidenced.has(c.toLowerCase()));
  const requiredMissing = model.requiredConcepts.filter((c) => !evidenced.has(c.toLowerCase()));

  // Required coverage: hard at zero for known sectors, advisory at one.
  if (model.isKnownSector && model.requiredConcepts.length > 0) {
    if (requiredEvidenced.length === 0) {
      blockers.push({
        section: "*",
        kind: "required",
        terms: [...model.requiredConcepts],
        message: `No required ${model.sector} concept evidenced report-wide [${model.requiredConcepts.join(", ")}] — generic or foreign template applied.`,
      });
    } else if (requiredEvidenced.length === 1) {
      warnings.push({
        section: "*",
        message: `Thin ${model.sector} coverage: only 1 required concept evidenced (${requiredEvidenced[0]}); missing [${requiredMissing.join(", ")}].`,
      });
    }
  }

  return { pass: blockers.length === 0, blockers, warnings, perSection, requiredEvidenced, requiredMissing };
}
