/**
 * APEX RESEARCH — Evidence Registry + Source Hierarchy (TRACK 3)
 * ----------------------------------------------------------------
 * Every number that prices, rates, or evidences a claim carries an evidence
 * ID. The registry is the single lookup from evidence ID → tiered source.
 *
 * Source hierarchy (highest authority first):
 *   PRIMARY       Filings / exchange / IR (10-K, annual report, earnings release)
 *   SECONDARY     Aggregator market feeds (Yahoo quoteSummary / timeseries)
 *   TERTIARY      News / analytics / unverified third-party (event feed, peers)
 *   MODEL_DERIVED Computed inside this pipeline (DCF, ledger, ratios, drivers)
 *
 * Canonical-provenance mapping (canonical-facts.ts):
 *   PRIMARY → PRIMARY, SECONDARY → SECONDARY,
 *   DERIVED → MODEL_DERIVED, UNKNOWN → TERTIARY.
 *
 * ID convention (stable, greppable, unique per field):
 *   EV:<TIER>:<SOURCE>:<FIELD>[:<QUALIFIER>]
 * e.g. EV:SECONDARY:YAHOO:revenue:FY24, EV:MODEL_DERIVED:DCF:wacc,
 *      EV:PRIMARY:FILING:revenue:FY24
 *
 * Conflict rule: when two items describe the same field, the HIGHER tier
 * (lower rank) wins; same-tier duplicates keep the first registration and
 * are counted, never silently overwritten.
 */

import { MONEY_BRIDGE_TOL, PER_SHARE_TOL, magnitudeTolerance } from "@/lib/financial-kernel";
import { sanitizeSourceContent } from "@/lib/security/source-sanitizer";

export type SourceTier = "PRIMARY" | "SECONDARY" | "TERTIARY" | "MODEL_DERIVED";

export type EvidenceSourceType =
  | "annual_report"
  | "quarterly_result"
  | "investor_presentation"
  | "exchange_filing"
  | "regulatory_filing"
  | "earnings_call"
  | "news"
  | "government"
  | "industry_data"
  | "market_data"
  | "model"
  | "other";

export type EvidencePeriodType = "ACTUAL" | "ESTIMATE" | "FORECAST" | "CURRENT" | "UNKNOWN";

export interface EvidenceTemporalValidity {
  validFrom?: string;
  validUntil?: string;
}

export interface EvidenceItem {
  id: string;
  tier: SourceTier;
  source: string;
  field: string;
  value: number | string;
  unit?: string;
  asOf?: string;
  note?: string;
  sourceType?: EvidenceSourceType;
  sourceUrl?: string;
  sourceDate?: string;
  publicationDate?: string;
  periodCovered?: string;
  fiscalPeriod?: string;
  periodType?: EvidencePeriodType;
  currency?: string;
  scale?: string;
  page?: number;
  section?: string;
  excerpt?: string;
  reliabilityScore?: number;
  supports?: boolean;
  contradicts?: boolean;
  temporalValidity?: EvidenceTemporalValidity;
}

export type EvidenceConflictReason =
  | "same_id_collision"
  | "value_mismatch"
  | "unit_mismatch"
  | "currency_mismatch"
  | "scale_mismatch"
  | "period_mismatch";

export type EvidenceConflictResolution =
  | "selected_higher_tier"
  | "kept_first_registration"
  | "selected_primary"
  | "unresolved";

export interface EvidenceConflict {
  id: string;
  field: string;
  period: string | null;
  reason: EvidenceConflictReason;
  existing: EvidenceItem;
  incoming: EvidenceItem;
  selected: EvidenceItem;
  resolution: EvidenceConflictResolution;
  material: boolean;
  varianceAbs?: number;
  variancePct?: number | null;
  detail: string;
}

export interface EvidenceRegistry {
  version: string;
  asOf: string;
  items: EvidenceItem[];
  conflicts?: EvidenceConflict[];
}

export const EVIDENCE_REGISTRY_VERSION = "evidence-registry-v1";

export const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  TERTIARY: 2,
  MODEL_DERIVED: 3,
};

export function compareTier(a: SourceTier, b: SourceTier): number {
  return SOURCE_TIER_RANK[a] - SOURCE_TIER_RANK[b];
}

export function sourceReliabilityScore(tier: SourceTier): number {
  return ({ PRIMARY: 1, SECONDARY: 0.7, TERTIARY: 0.4, MODEL_DERIVED: 0.3 } as Record<SourceTier, number>)[tier];
}

export function sourceTypeForTier(tier: SourceTier): EvidenceSourceType {
  return tier === "MODEL_DERIVED" ? "model" : tier === "PRIMARY" ? "regulatory_filing" : tier === "SECONDARY" ? "market_data" : "other";
}

function normalizeToken(value: string | undefined | null): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function periodOf(item: EvidenceItem): string {
  return item.periodCovered ?? item.fiscalPeriod ?? item.note ?? "";
}

function sameEvidence(a: EvidenceItem, b: EvidenceItem): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function varianceMetrics(a: EvidenceItem, b: EvidenceItem): { varianceAbs?: number; variancePct?: number | null } {
  if (typeof a.value !== "number" || typeof b.value !== "number" || !Number.isFinite(a.value) || !Number.isFinite(b.value)) return {};
  const varianceAbs = Math.abs(a.value - b.value);
  const denominator = Math.abs(a.value);
  return { varianceAbs, variancePct: denominator > 0 ? varianceAbs / denominator : varianceAbs > 0 ? null : 0 };
}

function conflictId(existing: EvidenceItem, incoming: EvidenceItem, reason: EvidenceConflictReason): string {
  const input = `${existing.id}|${incoming.id}|${reason}|${JSON.stringify(existing)}|${JSON.stringify(incoming)}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `EC-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function appendConflict(registry: EvidenceRegistry, conflict: EvidenceConflict): void {
  const ledger = registry.conflicts ?? (registry.conflicts = []);
  if (!ledger.some((item) => item.id === conflict.id)) ledger.push(conflict);
}

export function createEvidenceRegistry(asOf?: string): EvidenceRegistry {
  return { version: EVIDENCE_REGISTRY_VERSION, asOf: asOf ?? new Date().toISOString(), items: [], conflicts: [] };
}

export function registerEvidence(
  registry: EvidenceRegistry,
  item: EvidenceItem
): { kept: EvidenceItem; replaced: boolean; conflict?: EvidenceConflict } {
  const incoming = item.excerpt === undefined
    ? { ...item }
    : { ...item, excerpt: sanitizeSourceContent(item.excerpt, 4_000).content };
  const idx = registry.items.findIndex((e) => e.id === incoming.id);
  if (idx === -1) {
    const kept = { ...incoming };
    registry.items.push(kept);
    return { kept, replaced: false };
  }
  const existing = registry.items[idx];
  if (sameEvidence(existing, incoming)) return { kept: existing, replaced: false };
  const higherTier = compareTier(incoming.tier, existing.tier) < 0;
  const selected = higherTier ? incoming : existing;
  const conflict: EvidenceConflict = {
    id: conflictId(existing, incoming, "same_id_collision"),
    field: existing.field,
    period: periodOf(existing) || null,
    reason: "same_id_collision",
    existing: { ...existing },
    incoming,
    selected: { ...selected },
    resolution: higherTier ? "selected_higher_tier" : "kept_first_registration",
    material: higherTier || normalizeToken(existing.unit) !== normalizeToken(incoming.unit) || normalizeToken(existing.currency) !== normalizeToken(incoming.currency) || normalizeToken(existing.scale) !== normalizeToken(incoming.scale) || normalizeToken(periodOf(existing)) !== normalizeToken(periodOf(incoming)),
    ...varianceMetrics(existing, incoming),
    detail: `Evidence ID ${incoming.id} was registered more than once; ${selected.tier} value retained by source policy.`,
  };
  appendConflict(registry, conflict);
  if (higherTier) registry.items[idx] = incoming;
  return { kept: selected, replaced: higherTier, conflict };
}

export function getEvidence(registry: EvidenceRegistry, id: string): EvidenceItem | null {
  return registry.items.find((e) => e.id === id) ?? null;
}

export function listEvidenceByTier(registry: EvidenceRegistry, tier: SourceTier): EvidenceItem[] {
  return registry.items.filter((e) => e.tier === tier);
}

function evidenceTolerance(item: EvidenceItem): { absTol: number; relTol: number; materiality?: number } {
  const unit = normalizeToken(item.unit);
  if (unit === "PCT" || unit === "PERCENT") return { absTol: 0.85, relTol: 0.02, materiality: 0.85 };
  if (unit === "PRICE") return PER_SHARE_TOL;
  if (unit === "MONEY") return MONEY_BRIDGE_TOL;
  const magnitude = Math.max(1, Math.abs(Number(item.value)) || 0);
  return { absTol: Math.max(1, magnitude * 0.01), relTol: 0.05, materiality: Math.max(1, magnitude * 0.05) };
}

function periodMatches(claimPeriod: string | undefined, item: EvidenceItem): boolean {
  if (!claimPeriod) return true;
  const expected = normalizeToken(claimPeriod);
  const actual = normalizeToken(periodOf(item));
  if (!actual || actual === expected || actual.includes(expected) || expected.includes(actual)) return true;
  const expectedYear = expected.match(/20\d{2}/)?.[0];
  const actualYear = actual.match(/20\d{2}/)?.[0];
  return Boolean(expectedYear && actualYear && expectedYear === actualYear);
}

function unitMatches(claimUnit: string | undefined, item: EvidenceItem): boolean {
  if (!claimUnit || !item.unit) return true;
  const expected = normalizeToken(claimUnit);
  const actual = normalizeToken(item.unit);
  if (expected === actual) return true;
  const aliases: Record<string, string[]> = {
    PCT: ["PERCENT", "PERCENTAGE"],
    MONEY: ["CURRENCY", "PRICE"],
    COUNT: ["SCALAR", "SHARES"],
  };
  return aliases[expected]?.includes(actual) ?? aliases[actual]?.includes(expected) ?? false;
}

function dimensionMismatch(existing: EvidenceItem, incoming: EvidenceItem): EvidenceConflictReason | null {
  if (existing.unit && incoming.unit && normalizeToken(existing.unit) !== normalizeToken(incoming.unit)) return "unit_mismatch";
  if (existing.currency && incoming.currency && normalizeToken(existing.currency) !== normalizeToken(incoming.currency)) return "currency_mismatch";
  if (existing.scale && incoming.scale && normalizeToken(existing.scale) !== normalizeToken(incoming.scale)) return "scale_mismatch";
  return null;
}

export function detectEvidenceConflicts(registry: EvidenceRegistry): EvidenceConflict[] {
  const groups = new Map<string, EvidenceItem[]>();
  for (const item of registry.items) {
    const period = periodOf(item);
    const key = `${item.field}|${normalizeToken(period)}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const detected: EvidenceConflict[] = [];
  for (const group of groups.values()) {
    const numeric = group.filter((item) => typeof item.value === "number" && Number.isFinite(item.value));
    if (numeric.length < 2) continue;
    const ordered = [...numeric].sort((a, b) => compareTier(a.tier, b.tier) || (b.asOf ?? "").localeCompare(a.asOf ?? "") || a.id.localeCompare(b.id));
    const selected = ordered[0];
    for (const candidate of ordered.slice(1)) {
      const reason = dimensionMismatch(selected, candidate);
      if (reason) {
        const conflict: EvidenceConflict = {
          id: conflictId(selected, candidate, reason),
          field: selected.field,
          period: periodOf(selected) || null,
          reason,
          existing: { ...selected },
          incoming: { ...candidate },
          selected: { ...selected },
          resolution: selected.tier === "PRIMARY" ? "selected_primary" : "selected_higher_tier",
          material: true,
          ...varianceMetrics(selected, candidate),
          detail: `Evidence dimensions differ for ${selected.field}; ${selected.tier} source selected.`,
        };
        detected.push(conflict);
        continue;
      }
      const verdict = magnitudeTolerance(Number(selected.value), Number(candidate.value), evidenceTolerance(selected));
      if (verdict.pass) continue;
      const conflict: EvidenceConflict = {
        id: conflictId(selected, candidate, "value_mismatch"),
        field: selected.field,
        period: periodOf(selected) || null,
        reason: "value_mismatch",
        existing: { ...selected },
        incoming: { ...candidate },
        selected: { ...selected },
        resolution: selected.tier === "PRIMARY" ? "selected_primary" : "selected_higher_tier",
        material: verdict.material,
        ...varianceMetrics(selected, candidate),
        detail: `${selected.field} differs across sources: ${verdict.detail}.`,
      };
      detected.push(conflict);
    }
  }

  const combined = [...(registry.conflicts ?? []), ...detected];
  const byId = new Map<string, EvidenceConflict>();
  for (const conflict of combined) byId.set(conflict.id, conflict);
  return [...byId.values()];
}

export function listEvidenceConflicts(registry: EvidenceRegistry): EvidenceConflict[] {
  return detectEvidenceConflicts(registry);
}

export interface NumericEvidenceMatchOptions {
  kind: "percentage" | "currency" | "multiple" | "count";
  tolerancePct?: number;
  toleranceAbs?: number;
  field?: string;
  unit?: string;
  currency?: string;
  scale?: string;
  period?: string;
}

export function matchNumericEvidence(
  registry: EvidenceRegistry,
  value: number,
  opts: NumericEvidenceMatchOptions
): EvidenceItem | null {
  if (!Number.isFinite(value)) return null;
  const cands: Array<{ item: EvidenceItem; gap: number }> = [];
  for (const item of registry.items) {
    if (typeof item.value !== "number" || !Number.isFinite(item.value)) continue;
    if (opts.field && item.field && normalizeToken(opts.field) !== normalizeToken(item.field)) continue;
    if (!unitMatches(opts.unit, item)) continue;
    if (opts.currency && item.currency && normalizeToken(opts.currency) !== normalizeToken(item.currency)) continue;
    if (opts.scale && item.scale && normalizeToken(opts.scale) !== normalizeToken(item.scale)) continue;
    if (!periodMatches(opts.period, item)) continue;
    const gap = Math.abs(item.value - value);
    let ok = false;
    if (opts.kind === "percentage") {
      ok = gap <= (opts.toleranceAbs ?? 0.85);
    } else {
      const rel = Math.abs(item.value) > 0 ? gap / Math.abs(item.value) : (gap > 0 ? Infinity : 0);
      ok = gap <= (opts.toleranceAbs ?? 0) || rel <= (opts.tolerancePct ?? (opts.kind === "currency" ? 0.02 : 0.05));
    }
    if (ok) cands.push({ item, gap });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => compareTier(a.item.tier, b.item.tier) || a.gap - b.gap);
  return cands[0].item;
}

/** Coverage of required fields: fraction with ≥1 evidence item (any tier). */
export function coverageScore(
  registry: EvidenceRegistry,
  requiredFields: string[]
): { covered: number; total: number; score: number; missing: string[] } {
  const fields = new Set(registry.items.map((e) => e.field));
  const missing = requiredFields.filter((f) => !fields.has(f));
  const covered = requiredFields.length - missing.length;
  return {
    covered,
    total: requiredFields.length,
    score: requiredFields.length === 0 ? 1 : covered / requiredFields.length,
    missing,
  };
}

/**
 * Compute an aggregate source quality score (0-100) based on the tier
 * distribution of all evidence items. PRIMARY (tier 0) = 100 weight,
 * SECONDARY (tier 1) = 70, TERTIARY (tier 2) = 40, MODEL_DERIVED (tier 3) = 30.
 * Returns { score, tierCounts, primaryCoverage, stalenessFlags }.
 */
export function sourceQualityScore(registry: EvidenceRegistry): {
  score: number;
  tierCounts: Record<string, number>;
  primaryCoverage: number;
  primaryFieldCoverage: number;
  conflictCount: number;
  stalenessFlags: Array<{ field: string; message: string }>;
} {
  const items = Array.from(registry.items);
  const tierWeights: Record<number, number> = { 0: 100, 1: 70, 2: 40, 3: 30 };
  const tierCounts: Record<string, number> = {};
  let totalWeight = 0;
  let totalItems = 0;
  const fieldTiers = new Map<string, number>();
  const fieldDates = new Map<string, string>();

  for (const item of items) {
    const tierNum = item.tier === "PRIMARY" ? 0 : item.tier === "SECONDARY" ? 1 : item.tier === "TERTIARY" ? 2 : 3;
    const tierLabel = item.tier;
    tierCounts[tierLabel] = (tierCounts[tierLabel] || 0) + 1;
    const w = tierWeights[tierNum] ?? 30;
    totalWeight += w;
    totalItems++;

    const existing = fieldTiers.get(item.field);
    if (existing == null || tierNum < existing) {
      fieldTiers.set(item.field, tierNum);
    }
    if (item.asOf) {
      const existingDate = fieldDates.get(item.field);
      if (!existingDate || item.asOf > existingDate) {
        fieldDates.set(item.field, item.asOf);
      }
    }
  }

  const score = totalItems > 0 ? Math.round((totalWeight / totalItems) * 100) / 100 : 0;
  const primaryCount = tierCounts["PRIMARY"] ?? 0;
  const primaryCoverage = totalItems > 0 ? primaryCount / totalItems : 0;
  const primaryFieldCoverage = fieldTiers.size > 0
    ? [...fieldTiers.values()].filter((tier) => tier === 0).length / fieldTiers.size
    : 0;
  const conflictCount = detectEvidenceConflicts(registry).length;

  const stalenessFlags: Array<{ field: string; message: string }> = [];
  for (const [field, bestTier] of fieldTiers) {
    if (bestTier > 0) {
      const tierLabel = bestTier === 1 ? "SECONDARY" : bestTier === 2 ? "TERTIARY" : "MODEL_DERIVED";
      stalenessFlags.push({
        field,
        message: `No PRIMARY source for ${field} — best available is ${tierLabel}. Verify data freshness.`,
      });
    }
  }

  return { score, tierCounts, primaryCoverage, primaryFieldCoverage, conflictCount, stalenessFlags };
}

/**
 * Mint evidence IDs for a live report (additive — safe to attach to the
 * company-route payload as `evidenceRegistry`). Yahoo feeds register as
 * SECONDARY; DCF/ledger outputs as MODEL_DERIVED; caller-supplied filing
 * values (when present) register as PRIMARY and win conflicts by tier.
 */
export function buildEvidenceRegistryFromInputs(input: {
  annualFinancials: Array<{ year?: string; fiscalYearEnd?: string; revenue?: number; netIncome?: number; totalEquity?: number; estimatesUsed?: string[] }>;
  stockData: { currentPrice?: number; sharesOutstanding?: number; marketCap?: number };
  dcf?: {
    assumptions?: { wacc?: number; terminalGrowthRate?: number; revenueGrowthRates?: number[]; ebitMargins?: number[] };
    intrinsicValue?: number; fairValuePerShare?: number | null; netDebt?: number; sharesOutstanding?: number;
  };
  filings?: Array<{ year?: string; fiscalYearEnd?: string; revenue?: number; source?: string; sourceUrl?: string; page?: number }>;
  asOf?: string;
  currency?: string;
  scale?: string;
}): EvidenceRegistry {
  const reg = createEvidenceRegistry(input.asOf);
  const { annualFinancials, stockData, dcf, filings } = input;
  const asOf = reg.asOf;
  const currency = input.currency?.toUpperCase();
  const scale = input.scale;
  const secondaryMeta = { sourceType: "market_data" as const, asOf, reliabilityScore: sourceReliabilityScore("SECONDARY") };
  const modelMeta = { sourceType: "model" as const, asOf, reliabilityScore: sourceReliabilityScore("MODEL_DERIVED") };
  const primaryMeta = { sourceType: "annual_report" as const, asOf, reliabilityScore: sourceReliabilityScore("PRIMARY"), periodType: "ACTUAL" as const };

  if (Number(stockData.currentPrice) > 0) {
    registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:price:CMP", tier: "SECONDARY", source: "Yahoo quoteSummary", field: "currentPrice", value: Number(stockData.currentPrice), unit: "price", currency, scale, periodType: "CURRENT", ...secondaryMeta });
  }
  if (Number(stockData.sharesOutstanding) > 0) {
    registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:shares:OUTSTANDING", tier: "SECONDARY", source: "Yahoo quoteSummary", field: "sharesOutstanding", value: Number(stockData.sharesOutstanding), unit: "shares", ...secondaryMeta });
  }
  if (Number(stockData.marketCap) > 0) {
    registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:marketCap:CMP", tier: "SECONDARY", source: "Yahoo quoteSummary", field: "marketCap", value: Number(stockData.marketCap), unit: "money", currency, scale, ...secondaryMeta });
  }
  for (const f of annualFinancials) {
    const y = String(f.year || "n/a").replace(/\s+/g, "");
    const periodType = (f.estimatesUsed?.length ?? 0) > 0 ? "ESTIMATE" as const : "ACTUAL" as const;
    if (Number(f.revenue) > 0) {
      registerEvidence(reg, { id: `EV:SECONDARY:YAHOO:revenue:${y}`, tier: "SECONDARY", source: "Yahoo fundamentals-timeseries", field: "revenue", value: Number(f.revenue), unit: "money", note: y, periodCovered: y, fiscalPeriod: f.fiscalYearEnd, periodType, currency, scale, ...secondaryMeta });
    }
    if (Number.isFinite(Number(f.netIncome))) {
      registerEvidence(reg, { id: `EV:SECONDARY:YAHOO:netIncome:${y}`, tier: "SECONDARY", source: "Yahoo fundamentals-timeseries", field: "netIncome", value: Number(f.netIncome), unit: "money", note: y, periodCovered: y, fiscalPeriod: f.fiscalYearEnd, periodType, currency, scale, ...secondaryMeta });
    }
  }
  for (const fl of filings ?? []) {
    const y = String(fl.year || "n/a").replace(/\s+/g, "");
    if (Number(fl.revenue) > 0) {
      registerEvidence(reg, { id: `EV:PRIMARY:FILING:revenue:${y}`, tier: "PRIMARY", source: fl.source ?? "Company filing", field: "revenue", value: Number(fl.revenue), unit: "money", note: y, periodCovered: y, fiscalPeriod: fl.fiscalYearEnd, currency, scale, sourceUrl: fl.sourceUrl, page: fl.page, ...primaryMeta });
    }
  }
  const a = dcf?.assumptions;
  if (Number.isFinite(Number(a?.wacc))) {
    registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:wacc", tier: "MODEL_DERIVED", source: "DCF engine (CAPM blend)", field: "wacc", value: Number(a?.wacc) * 100, unit: "pct", ...modelMeta });
  }
  if (Number.isFinite(Number(a?.terminalGrowthRate))) {
    registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:terminalGrowth", tier: "MODEL_DERIVED", source: "DCF engine (sector anchor)", field: "terminalGrowth", value: Number(a?.terminalGrowthRate) * 100, unit: "pct", ...modelMeta });
  }
  (a?.revenueGrowthRates ?? []).forEach((g, i) => {
    if (Number.isFinite(g)) {
      registerEvidence(reg, { id: `EV:MODEL_DERIVED:DCF:revenueGrowth:Y${i + 1}`, tier: "MODEL_DERIVED", source: "Canonical forecast (driver fade)", field: "revenueGrowth", value: g * 100, unit: "pct", note: `Y${i + 1}`, periodCovered: `Y${i + 1}`, periodType: "FORECAST", ...modelMeta });
    }
  });
  (a?.ebitMargins ?? []).forEach((m, i) => {
    if (Number.isFinite(m)) {
      registerEvidence(reg, { id: `EV:MODEL_DERIVED:DCF:ebitMargin:Y${i + 1}`, tier: "MODEL_DERIVED", source: "Canonical forecast (driver ramp)", field: "ebitMargin", value: m * 100, unit: "pct", note: `Y${i + 1}`, periodCovered: `Y${i + 1}`, periodType: "FORECAST", ...modelMeta });
    }
  });
  const fv = Number(dcf?.fairValuePerShare ?? dcf?.intrinsicValue);
  if (Number.isFinite(fv) && fv > 0) {
    registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:fairValue", tier: "MODEL_DERIVED", source: "DCF engine (EV bridge)", field: "fairValue", value: fv, unit: "price", currency, scale, ...modelMeta });
  }
  reg.conflicts = detectEvidenceConflicts(reg);
  return reg;
}
