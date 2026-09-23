/**
 * APEX RESEARCH — Deterministic Research Complexity Engine (Phase 1)
 * -------------------------------------------------------------------
 * Scores how much research a company actually needs. The score is a pure
 * function of structural inputs — segments, geography, statement architecture,
 * financial archetype, debt, M&A, regulation, history depth, peer coverage and
 * data quality. NO LLM output is accepted here (subjective complexity comes
 * later, if ever, and only as a disclosed overlay).
 *
 * Output levels:
 *   LOW < 30 ≤ MEDIUM < 50 ≤ HIGH < 70 ≤ VERY_HIGH
 *
 * Dimension weights sum to 100:
 *   segments 15 · geography 10 · statement-arch 12 · financial-archetype 10
 *   debt 12 · M&A 6 · regulatory 8 · history 8 · peers 9 · data-quality 10
 */
import type { StatementArchitecture } from "@/types/report";
import type { SectorId } from "@/lib/sectors/types";

export const RESEARCH_COMPLEXITY_VERSION = "research-complexity-v1";

export type ComplexityLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export interface ComplexityInputs {
  segmentCount: number;
  /** Distinct operating geographies (1 = domestic single-currency). */
  geographyCount: number;
  crossListed: boolean;
  statementArchitecture: StatementArchitecture;
  isFinancialInstitution: boolean;
  operatingArchetype: string;
  financialArchetype: string | null;
  totalDebt: number;
  totalEquity: number;
  hasGoodwillOrIntangibles: boolean;
  isRegulatedSector: boolean;
  historyYears: number;
  quarterCount: number;
  peerCount: number;
  peersSuppressed: boolean;
  dataGrade: "A" | "B" | "C" | "D" | "N/A";
  estimatedFieldCount: number;
  missingFactCount: number;
  hasCanonicalFacts: boolean;
}

export interface ComplexityDimension {
  id: string;
  label: string;
  score: number;
  max: number;
  detail: string;
}

export interface ResearchComplexity {
  level: ComplexityLevel;
  /** 0–100 total (sum of dimension scores). */
  score: number;
  dimensions: ComplexityDimension[];
  version: string;
}

/** Sectors where regulation materially thickens the research surface. */
export const REGULATED_SECTORS: readonly SectorId[] = [
  "bank",
  "nbfc",
  "insurance",
  "ratings-agency",
  "asset-management",
  "telecom",
  "utilities",
  "real-estate",
];

export function isRegulatedSectorId(sectorId: SectorId): boolean {
  return REGULATED_SECTORS.includes(sectorId);
}

export const COMPLEXITY_THRESHOLDS = { low: 30, medium: 50, high: 70 } as const;

export function levelFromScore(score: number): ComplexityLevel {
  if (score < COMPLEXITY_THRESHOLDS.low) return "LOW";
  if (score < COMPLEXITY_THRESHOLDS.medium) return "MEDIUM";
  if (score < COMPLEXITY_THRESHOLDS.high) return "HIGH";
  return "VERY_HIGH";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function dim(id: string, label: string, score: number, max: number, detail: string): ComplexityDimension {
  return { id, label, score: clamp(Math.round(score), 0, max), max, detail };
}

/** Segments: multi-segment conglomerates need segment-level work. Max 15. */
function scoreSegments(segmentCount: number): ComplexityDimension {
  const n = Math.max(0, Math.floor(segmentCount));
  const points = n === 0 ? 0 : n === 1 ? 3 : n === 2 ? 6 : n === 3 ? 9 : n === 4 ? 12 : 15;
  return dim("segments", "Segment complexity", points, 15, `${n} reported segment(s)`);
}

/** Geography: cross-listed FX/share-restatement adds surface. Max 10. */
function scoreGeography(geographyCount: number, crossListed: boolean): ComplexityDimension {
  const n = Math.max(1, Math.floor(geographyCount));
  const base = n <= 1 ? 0 : n === 2 ? 3 : n === 3 ? 5 : 7;
  const points = crossListed ? Math.min(10, base + 4) : base;
  return dim(
    "geography",
    "Geographic complexity",
    points,
    10,
    crossListed ? `${n} geographies, cross-listed (FX/share restatement)` : `${n} geography(ies), single currency`
  );
}

/** Statement architecture: B/C/D/E are structurally heavier than A. Max 12. */
function scoreStatementArchitecture(arch: StatementArchitecture): ComplexityDimension {
  const table: Record<StatementArchitecture, number> = { A: 3, E: 6, D: 9, B: 12, C: 12 };
  const points = table[arch] ?? 3;
  const labels: Record<StatementArchitecture, string> = {
    A: "standard corporate",
    B: "depository (bank/NBFC)",
    C: "insurance underwriting + float",
    D: "REIT (NOI/FFO/NAV)",
    E: "asset-light fee",
  };
  return dim("statement-architecture", "Statement architecture", points, 12, `Architecture ${arch} — ${labels[arch] ?? arch}`);
}

/** Financial archetype: distressed / platform-growth are thorniest. Max 10. */
function scoreFinancialArchetype(archetype: string | null): ComplexityDimension {
  const table: Record<string, number> = {
    DISTRESSED: 10,
    EARLY_PLATFORM_GROWTH: 9,
    CYCLICAL_CAPITAL_INTENSIVE: 8,
    MATURE_COMPOUNDER: 4,
  };
  const points = archetype ? (table[archetype] ?? 5) : 5;
  return dim("financial-archetype", "Financial archetype", points, 10, archetype ?? "unclassified (neutral)");
}

/** Debt: lenders are max; corporates scale with leverage. Max 12. */
function scoreDebt(
  totalDebt: number,
  totalEquity: number,
  isFinancialInstitution: boolean
): ComplexityDimension {
  if (isFinancialInstitution) {
    return dim("debt", "Balance-sheet complexity", 12, 12, "Financial institution — deposits/funding are operating inventory");
  }
  const equity = Math.max(1, Math.abs(totalEquity));
  const leverage = Math.max(0, totalDebt) / equity;
  const points = leverage <= 0 ? 0 : leverage <= 0.5 ? 3 : leverage <= 1.5 ? 6 : leverage <= 3 ? 9 : 12;
  return dim(
    "debt",
    "Balance-sheet complexity",
    points,
    12,
    totalDebt > 0 ? `Debt/Equity ${leverage.toFixed(2)}x` : "No debt on record"
  );
}

/** M&A / intangibles: goodwill & intangibles imply acquisition history. Max 6. */
function scoreMa(hasGoodwillOrIntangibles: boolean): ComplexityDimension {
  return dim(
    "ma",
    "M&A / intangibles",
    hasGoodwillOrIntangibles ? 6 : 0,
    6,
    hasGoodwillOrIntangibles ? "Goodwill or intangibles present" : "No goodwill/intangibles on record"
  );
}

/** Regulatory: supervised sectors need regime-aware analysis. Max 8. */
function scoreRegulatory(isRegulated: boolean): ComplexityDimension {
  return dim("regulatory", "Regulatory complexity", isRegulated ? 8 : 0, 8, isRegulated ? "Regulated sector" : "No sector-level regulation flag");
}

/** History depth: more years = more pattern to analyse. Max 8. */
function scoreHistory(historyYears: number, quarterCount: number): ComplexityDimension {
  const y = Math.max(0, Math.floor(historyYears));
  const points = y >= 5 ? 8 : y === 4 ? 6 : y === 3 ? 4 : y === 2 ? 2 : 1;
  return dim("history", "Historical depth", points, 8, `${y} annual period(s), ${Math.max(0, Math.floor(quarterCount))} quarterly period(s)`);
}

/** Peers: more usable peers = more comparison work; suppressed peers also costly. Max 9. */
function scorePeers(peerCount: number, suppressed: boolean): ComplexityDimension {
  const n = Math.max(0, Math.floor(peerCount));
  let points: number;
  if (suppressed && n > 0) points = 7;
  else if (n >= 6) points = 9;
  else if (n >= 4) points = 7;
  else if (n >= 2) points = 5;
  else if (n === 1) points = 3;
  else points = 1;
  const note = suppressed && n > 0 ? `${n} peer(s), similarity gate SUPPRESSED` : `${n} usable peer(s)`;
  return dim("peers", "Peer coverage", points, 9, note);
}

/** Data quality: worse grades + synthesized fields = more unknowns to mark. Max 10. */
function scoreDataQuality(i: ComplexityInputs): ComplexityDimension {
  const baseTable: Record<ComplexityInputs["dataGrade"], number> = { A: 1, B: 3, C: 6, D: 9, "N/A": 7 };
  let points = i.hasCanonicalFacts ? (baseTable[i.dataGrade] ?? 7) : 10;
  let note = `grade ${i.dataGrade}`;
  if (i.hasCanonicalFacts && i.estimatedFieldCount > 0) {
    points = Math.min(10, points + Math.min(3, Math.ceil(i.estimatedFieldCount / 3)));
    note += `, ${i.estimatedFieldCount} synthesized field(s)`;
  }
  if (i.hasCanonicalFacts && i.missingFactCount >= 10) {
    points = Math.min(10, points + 2);
    note += `, ${i.missingFactCount} missing canonical field(s)`;
  }
  if (!i.hasCanonicalFacts) note = "canonical facts unavailable";
  return dim("data-quality", "Data quality burden", points, 10, note);
}

/** Pure, deterministic complexity assessment. */
export function assessResearchComplexity(inputs: ComplexityInputs): ResearchComplexity {
  const dimensions: ComplexityDimension[] = [
    scoreSegments(inputs.segmentCount),
    scoreGeography(inputs.geographyCount, inputs.crossListed),
    scoreStatementArchitecture(inputs.statementArchitecture),
    scoreFinancialArchetype(inputs.financialArchetype),
    scoreDebt(inputs.totalDebt, inputs.totalEquity, inputs.isFinancialInstitution),
    scoreMa(inputs.hasGoodwillOrIntangibles),
    scoreRegulatory(inputs.isRegulatedSector),
    scoreHistory(inputs.historyYears, inputs.quarterCount),
    scorePeers(inputs.peerCount, inputs.peersSuppressed),
    scoreDataQuality(inputs),
  ];
  const score = dimensions.reduce((s, d) => s + d.score, 0);
  return {
    level: levelFromScore(score),
    score,
    dimensions,
    version: RESEARCH_COMPLEXITY_VERSION,
  };
}
