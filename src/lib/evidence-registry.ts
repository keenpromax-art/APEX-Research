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

export type SourceTier = "PRIMARY" | "SECONDARY" | "TERTIARY" | "MODEL_DERIVED";

export const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  TERTIARY: 2,
  MODEL_DERIVED: 3,
};

export function compareTier(a: SourceTier, b: SourceTier): number {
  return SOURCE_TIER_RANK[a] - SOURCE_TIER_RANK[b];
}

export interface EvidenceItem {
  /** Stable ID, e.g. EV:SECONDARY:YAHOO:revenue:FY24 */
  id: string;
  tier: SourceTier;
  /** Human source, e.g. "Yahoo quoteSummary", "DCF engine", "10-K filing". */
  source: string;
  /** Field key, e.g. "revenue", "wacc", "fairValue". */
  field: string;
  value: number | string;
  unit?: string;
  asOf?: string;
  note?: string;
}

export interface EvidenceRegistry {
  version: string;
  asOf: string;
  items: EvidenceItem[];
}

export const EVIDENCE_REGISTRY_VERSION = "evidence-registry-v1";

export function createEvidenceRegistry(asOf?: string): EvidenceRegistry {
  return { version: EVIDENCE_REGISTRY_VERSION, asOf: asOf ?? new Date().toISOString(), items: [] };
}

/** Register an item. Same-ID re-registration keeps the HIGHER tier; same-tier keeps the first. */
export function registerEvidence(
  registry: EvidenceRegistry,
  item: EvidenceItem
): { kept: EvidenceItem; replaced: boolean } {
  const idx = registry.items.findIndex((e) => e.id === item.id);
  if (idx === -1) {
    registry.items.push({ ...item });
    return { kept: item, replaced: false };
  }
  const existing = registry.items[idx];
  if (compareTier(item.tier, existing.tier) < 0) {
    registry.items[idx] = { ...item };
    return { kept: item, replaced: true };
  }
  return { kept: existing, replaced: false };
}

export function getEvidence(registry: EvidenceRegistry, id: string): EvidenceItem | null {
  return registry.items.find((e) => e.id === id) ?? null;
}

export function listEvidenceByTier(registry: EvidenceRegistry, tier: SourceTier): EvidenceItem[] {
  return registry.items.filter((e) => e.tier === tier);
}

/** Best (highest-authority) numeric match within tolerance. */
export function matchNumericEvidence(
  registry: EvidenceRegistry,
  value: number,
  opts: { kind: "percentage" | "currency" | "multiple" | "count"; tolerancePct?: number; toleranceAbs?: number }
): EvidenceItem | null {
  if (!Number.isFinite(value)) return null;
  const cands: Array<{ item: EvidenceItem; gap: number }> = [];
  for (const item of registry.items) {
    if (typeof item.value !== "number" || !Number.isFinite(item.value)) continue;
    const gap = Math.abs(item.value - value);
    let ok = false;
    if (opts.kind === "percentage") {
      // Percentage points compare on a 0–100 scale (matches claims.ts 0.85pp rule).
      ok = gap <= (opts.toleranceAbs ?? 0.85);
    } else {
      const rel = Math.abs(item.value) > 0 ? gap / Math.abs(item.value) : (gap > 0 ? Infinity : 0);
      ok = gap <= (opts.toleranceAbs ?? 0) || rel <= ((opts.tolerancePct ?? (opts.kind === "currency" ? 0.02 : 0.05)) as number);
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
 * Mint evidence IDs for a live report (additive — safe to attach to the
 * company-route payload as `evidenceRegistry`). Yahoo feeds register as
 * SECONDARY; DCF/ledger outputs as MODEL_DERIVED; caller-supplied filing
 * values (when present) register as PRIMARY and win conflicts by tier.
 */
export function buildEvidenceRegistryFromInputs(input: {
  annualFinancials: Array<{ year?: string; revenue?: number; netIncome?: number; totalEquity?: number }>;
  stockData: { currentPrice?: number; sharesOutstanding?: number; marketCap?: number };
  dcf?: {
    assumptions?: { wacc?: number; terminalGrowthRate?: number; revenueGrowthRates?: number[]; ebitMargins?: number[] };
    intrinsicValue?: number; fairValuePerShare?: number | null; netDebt?: number; sharesOutstanding?: number;
  };
  filings?: Array<{ year?: string; revenue?: number; source?: string }>;
  asOf?: string;
}): EvidenceRegistry {
  const reg = createEvidenceRegistry(input.asOf);
  const { annualFinancials, stockData, dcf, filings } = input;
  // SECONDARY — market + feed history.
  if (Number(stockData.currentPrice) > 0) {
    registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:price:CMP", tier: "SECONDARY", source: "Yahoo quoteSummary", field: "currentPrice", value: Number(stockData.currentPrice), unit: "price" });
  }
  if (Number(stockData.sharesOutstanding) > 0) {
    registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:shares:OUTSTANDING", tier: "SECONDARY", source: "Yahoo quoteSummary", field: "sharesOutstanding", value: Number(stockData.sharesOutstanding), unit: "shares" });
  }
  if (Number(stockData.marketCap) > 0) {
    registerEvidence(reg, { id: "EV:SECONDARY:YAHOO:marketCap:CMP", tier: "SECONDARY", source: "Yahoo quoteSummary", field: "marketCap", value: Number(stockData.marketCap), unit: "money" });
  }
  for (const f of annualFinancials) {
    const y = String(f.year || "n/a").replace(/\s+/g, "");
    if (Number(f.revenue) > 0) {
      registerEvidence(reg, { id: `EV:SECONDARY:YAHOO:revenue:${y}`, tier: "SECONDARY", source: "Yahoo fundamentals-timeseries", field: "revenue", value: Number(f.revenue), unit: "money", note: y });
    }
    if (Number.isFinite(Number(f.netIncome))) {
      registerEvidence(reg, { id: `EV:SECONDARY:YAHOO:netIncome:${y}`, tier: "SECONDARY", source: "Yahoo fundamentals-timeseries", field: "netIncome", value: Number(f.netIncome), unit: "money", note: y });
    }
  }
  // PRIMARY — caller-supplied filing values win by tier on ID collision.
  for (const fl of filings ?? []) {
    const y = String(fl.year || "n/a").replace(/\s+/g, "");
    if (Number(fl.revenue) > 0) {
      registerEvidence(reg, { id: `EV:PRIMARY:FILING:revenue:${y}`, tier: "PRIMARY", source: fl.source ?? "Company filing", field: "revenue", value: Number(fl.revenue), unit: "money", note: y });
    }
  }
  // MODEL_DERIVED — pipeline outputs (traceable, lowest authority).
  const a = dcf?.assumptions;
  if (Number.isFinite(Number(a?.wacc))) {
    registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:wacc", tier: "MODEL_DERIVED", source: "DCF engine (CAPM blend)", field: "wacc", value: Number(a?.wacc) * 100, unit: "pct" });
  }
  if (Number.isFinite(Number(a?.terminalGrowthRate))) {
    registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:terminalGrowth", tier: "MODEL_DERIVED", source: "DCF engine (sector anchor)", field: "terminalGrowth", value: Number(a?.terminalGrowthRate) * 100, unit: "pct" });
  }
  (a?.revenueGrowthRates ?? []).forEach((g, i) => {
    if (Number.isFinite(g)) {
      registerEvidence(reg, { id: `EV:MODEL_DERIVED:DCF:revenueGrowth:Y${i + 1}`, tier: "MODEL_DERIVED", source: "Canonical forecast (driver fade)", field: "revenueGrowth", value: g * 100, unit: "pct", note: `Y${i + 1}` });
    }
  });
  (a?.ebitMargins ?? []).forEach((m, i) => {
    if (Number.isFinite(m)) {
      registerEvidence(reg, { id: `EV:MODEL_DERIVED:DCF:ebitMargin:Y${i + 1}`, tier: "MODEL_DERIVED", source: "Canonical forecast (driver ramp)", field: "ebitMargin", value: m * 100, unit: "pct", note: `Y${i + 1}` });
    }
  });
  const fv = Number(dcf?.fairValuePerShare ?? dcf?.intrinsicValue);
  if (Number.isFinite(fv) && fv > 0) {
    registerEvidence(reg, { id: "EV:MODEL_DERIVED:DCF:fairValue", tier: "MODEL_DERIVED", source: "DCF engine (EV bridge)", field: "fairValue", value: fv, unit: "price" });
  }
  return reg;
}
