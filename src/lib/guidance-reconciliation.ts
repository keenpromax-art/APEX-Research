/**
 * APEX RESEARCH — Guidance Reconciliation (model-vs-baseline table)
 *
 * The institutional "Guidance vs Model" engine, built for the data that
 * exists TODAY: trailing history bands + Street consensus (Yahoo targets).
 * Each row compares what the MODEL assumes against what has been
 * DEMONSTRATED (history) and what the STREET expects (consensus).
 *
 * Management guidance has a FIRST-CLASS typed slot
 * ({ value, source, date } | null) that is currently unfilled — there is no
 * filings/earnings-call ingestion source in this runtime, and inventing
 * guidance would be fabrication. When a filings source lands, populate the
 * slot; every consumer below already handles it (UNVERIFIED → reconciled).
 * Until then the table is explicit about what it cannot check.
 */

import type { AnnualFinancials, StockData } from "@/types/report";
import { stmtNum } from "@/types/report";
import { deepFreeze } from "./research-ledger/immutable";
import { stableHash } from "./research-ledger/stable";

export type BaselineStatus = "PASS" | "WARN" | "UNVERIFIED";

export interface ManagementGuidance {
  value: number | string;
  source: string;
  date?: string;
}

export interface BaselineRow {
  metric: string;
  unit: string;
  historyBand: { min: number; median: number; max: number; periods: number } | null;
  modelValue: number | null;
  streetValue: number | null;
  /** Management guidance — null until a filings/call ingestion source exists. */
  guidance: ManagementGuidance | null;
  status: BaselineStatus;
  note: string;
}

export interface BaselineReconciliation {
  rows: BaselineRow[];
  /** True when every row reconciles or is explicitly unverified (never blocked). */
  allClear: boolean;
  generatedAt: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function bandOf(vs: number[]): BaselineRow["historyBand"] {
  const clean = vs.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const s = [...clean].sort((a, b) => a - b);
  const m = s.length >> 1;
  return {
    min: s[0],
    median: s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2,
    max: s[s.length - 1],
    periods: clean.length,
  };
}

const pct = (v: number | null, digits = 1): string =>
  v === null ? "n/a" : `${(v * 100).toFixed(digits)}%`;

export interface BaselineInputs {
  annualFinancials: AnnualFinancials[];
  /** Model vectors actually priced (canonical forecast preferred, DCF assumptions fallback). */
  modelGrowth: number[];
  modelMargins: number[];
  modelCapexPct: number | null;
  modelTaxRate: number | null;
  modelPayout: number | null;
  modelNetDebt: number | null;
  modelFairValue: number | null;
  stockData: StockData;
}

/** Build the model-vs-baseline reconciliation table (pure). */
export function buildBaselineReconciliation(inp: BaselineInputs): BaselineReconciliation {
  const fins = inp.annualFinancials;
  const rows: BaselineRow[] = [];

  // Revenue CAGR band (first→last positive revenues).
  const revs = fins.map((f: any) => Number(f.revenue ?? f.totalRevenue) || 0);
  let histCagr: number | null = null;
  if (revs.length >= 2 && revs[0] > 0 && revs[revs.length - 1] > 0) {
    histCagr = Math.pow(revs[revs.length - 1] / revs[0], 1 / (revs.length - 1)) - 1;
  }
  const modelCagr = inp.modelGrowth.length > 0
    ? inp.modelGrowth.reduce((s, g) => s * (1 + g), 1) ** (1 / inp.modelGrowth.length) - 1
    : null;
  const yoyGrowths: number[] = [];
  for (let i = 1; i < revs.length; i++) {
    if (revs[i - 1] > 0 && revs[i] > 0) yoyGrowths.push(revs[i] / revs[i - 1] - 1);
  }
  const growthBand = bandOf(yoyGrowths);
  rows.push({
    metric: "Revenue growth",
    unit: "CAGR vs YoY band",
    historyBand: growthBand,
    modelValue: modelCagr,
    streetValue: null,
    guidance: null,
    status: !growthBand || modelCagr === null ? "UNVERIFIED" : modelCagr > growthBand.max + 0.15 ? "WARN" : "PASS",
    note: !growthBand || modelCagr === null
      ? "Insufficient history or model vector to reconcile growth."
      : modelCagr > growthBand.max + 0.15
        ? `Model CAGR ${pct(modelCagr)} exceeds the best demonstrated YoY year ${pct(growthBand.max)} by >15pp — demand pipeline/guidance evidence (management-guidance slot empty: no filings source).`
        : `Model CAGR ${pct(modelCagr)} inside demonstrated range [${pct(growthBand.min)} … ${pct(growthBand.max)}]${histCagr !== null ? ` (multi-year CAGR ${pct(histCagr)})` : ""}.`,
  });

  // EBIT margin band.
  const histMargins = fins
    .map((f: any) => {
      const r = Number(f.revenue ?? f.totalRevenue) || 0;
      const oi = stmtNum(f, "operatingIncome");
      return r > 0 ? oi / r : null;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const marginBand = bandOf(histMargins);
  const modelMarginAvg = inp.modelMargins.length > 0
    ? inp.modelMargins.reduce((s, m) => s + m, 0) / inp.modelMargins.length
    : null;
  rows.push({
    metric: "EBIT margin",
    unit: "average",
    historyBand: marginBand,
    modelValue: modelMarginAvg,
    streetValue: null,
    guidance: null,
    status: !marginBand || modelMarginAvg === null ? "UNVERIFIED" : modelMarginAvg > marginBand.max + 0.05 ? "WARN" : "PASS",
    note: !marginBand || modelMarginAvg === null
      ? "Insufficient history or model vector to reconcile margins."
      : modelMarginAvg > marginBand.max + 0.05
        ? `Model average margin ${pct(modelMarginAvg)} sits >5pp above the demonstrated ceiling ${pct(marginBand.max)} — requires mix-shift or operating-leverage evidence.`
        : `Model average margin ${pct(modelMarginAvg)} within demonstrated band [${pct(marginBand.min)} … ${pct(marginBand.max)}].`,
  });

  // Capex intensity band.
  const histCapex = fins
    .map((f: any) => {
      const r = Number(f.revenue ?? f.totalRevenue) || 0;
      const c = Math.abs(Number(f.capitalExpenditures) || 0);
      return r > 0 ? c / r : null;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const capexBand = bandOf(histCapex);
  rows.push({
    metric: "Capex intensity",
    unit: "% of revenue",
    historyBand: capexBand,
    modelValue: inp.modelCapexPct,
    streetValue: null,
    guidance: null,
    status: !capexBand || inp.modelCapexPct === null ? "UNVERIFIED" : inp.modelCapexPct < capexBand.median * 0.5 ? "WARN" : "PASS",
    note: !capexBand || inp.modelCapexPct === null
      ? "Insufficient history or model intensity to reconcile capex."
      : inp.modelCapexPct < capexBand.median * 0.5
        ? `Model capex ${pct(inp.modelCapexPct)} is <50% of demonstrated median ${pct(capexBand.median)} — under-investment vs history; reconcile against management capex guidance (slot empty: no filings source).`
        : `Model capex ${pct(inp.modelCapexPct)} vs demonstrated median ${pct(capexBand.median)} — investment continuity holds.`,
  });

  // Effective tax rate band.
  const histEtr = fins
    .map((f: any) => {
      const pre = Number(f.pretaxIncome) || 0;
      const tax = Number(f.incomeTaxExpense) || 0;
      return pre > 0 ? tax / pre : null;
    })
    .filter((v): v is number => v !== null && v >= 0 && v <= 0.6);
  const etrBand = bandOf(histEtr);
  rows.push({
    metric: "Effective tax rate",
    unit: "rate",
    historyBand: etrBand,
    modelValue: inp.modelTaxRate,
    streetValue: null,
    guidance: null,
    status: !etrBand || inp.modelTaxRate === null ? "UNVERIFIED" : inp.modelTaxRate < etrBand.min - 0.05 ? "WARN" : "PASS",
    note: !etrBand || inp.modelTaxRate === null
      ? "Insufficient history or model rate to reconcile tax."
      : inp.modelTaxRate < etrBand.min - 0.05
        ? `Model tax ${(inp.modelTaxRate * 100).toFixed(1)}% is >5pp below demonstrated floor ${pct(etrBand.min)} — verify NOLs/holidays before trusting NOPAT.`
        : `Model tax ${(inp.modelTaxRate * 100).toFixed(1)}% within demonstrated band [${pct(etrBand.min)} … ${pct(etrBand.max)}].`,
  });

  // Net debt stock.
  const latest: any = fins[fins.length - 1] || {};
  const bsNetDebt = (Number(latest.totalDebt) || 0) - (Number(latest.cash) || 0);
  rows.push({
    metric: "Net debt trajectory",
    unit: "money",
    historyBand: null,
    modelValue: inp.modelNetDebt,
    streetValue: null,
    guidance: null,
    status: inp.modelNetDebt === null ? "UNVERIFIED" : Math.abs(inp.modelNetDebt - bsNetDebt) > Math.max(1000, Math.abs(bsNetDebt) * 0.5) && bsNetDebt > 0 ? "WARN" : "PASS",
    note: inp.modelNetDebt === null
      ? "No model net-debt figure to reconcile."
      : Math.abs(inp.modelNetDebt - bsNetDebt) > Math.max(1000, Math.abs(bsNetDebt) * 0.5) && bsNetDebt > 0
        ? `Model net debt ${Math.round(inp.modelNetDebt).toLocaleString("en")} departs >50% from reported ${Math.round(bsNetDebt).toLocaleString("en")} — reconcile against maturity/borrowing plans (guidance slot empty).`
        : `Model net debt ties to the reported stock (${Math.round(bsNetDebt).toLocaleString("en")}).`,
  });

  // Fair value vs Street.
  const mean = num(inp.stockData.targetMeanPrice);
  const high = num(inp.stockData.targetHighPrice);
  const low = num(inp.stockData.targetLowPrice);
  const opinions = num(inp.stockData.numberOfAnalystOpinions) ?? 0;
  const streetOk = mean !== null && mean > 0 && opinions > 0;
  const bandOk = high !== null && low !== null && high > 0 && low > 0;
  const fv = inp.modelFairValue;
  const outsideBand = streetOk && bandOk && fv !== null && ((fv as number) < (low as number) || (fv as number) > (high as number));
  rows.push({
    metric: "Fair value vs Street",
    unit: "per share",
    historyBand: null,
    modelValue: fv,
    streetValue: streetOk ? mean : null,
    guidance: null,
    status: !streetOk || fv === null ? "UNVERIFIED" : outsideBand ? "WARN" : "PASS",
    note: !streetOk || fv === null
      ? "No Street consensus on record — model stands alone (disclosed, not corroborated)."
      : outsideBand
        ? `Model FV ${(fv as number).toFixed(2)} sits OUTSIDE the Street range ${(low as number).toFixed(2)}–${(high as number).toFixed(2)} (${opinions} opinions, mean ${(mean as number).toFixed(2)}) — explain the disagreement explicitly.`
        : `Model FV ${(fv as number).toFixed(2)} inside Street range ${(low as number).toFixed(2)}–${(high as number).toFixed(2)} (${opinions} opinions).`,
  });

  // allClear counts WARNs only — UNVERIFIED rows (missing history, absent
  // Street, empty guidance slot) are disclosed gaps, not failures.
  return { rows, allClear: rows.every((r) => r.status !== "WARN"), generatedAt: new Date().toISOString() };
}

export default { buildBaselineReconciliation, buildGuidanceReconciliation };

// ─────────────────────────────────────────────
// Guidance reconciliation — separate, revision-aware tracks
// ─────────────────────────────────────────────

export const GUIDANCE_RECONCILIATION_VERSION = "guidance-reconciliation-v2" as const;
const GUIDANCE_RECONCILIATION_DOMAIN = "guidance-reconciliation/canonical/v2";

export type GuidanceTrackKey = "historical" | "management" | "consensus" | "apex";
export type GuidanceTrackStatus = "ready" | "unavailable";
export type GuidanceRevisionStatus = "active" | "withdrawn" | "superseded";
export type GuidanceScoreStatus = "met" | "missed" | "unverified";
export type GuidanceReconciliationStatus = "ready" | "unverified" | "insufficient";

export const GUIDANCE_TRACK_KEYS: readonly GuidanceTrackKey[] = Object.freeze(["historical", "management", "consensus", "apex"] as const);

export const GUIDANCE_TRACK_LABELS: Readonly<Record<GuidanceTrackKey, string>> = Object.freeze({
  historical: "Demonstrated history (what the company actually delivered)",
  management: "Management guidance (what the company says it will deliver)",
  consensus: "Street consensus (what the market expects)",
  apex: "APEX forecast (what this model assumes)",
});

export interface GuidancePointInput {
  readonly id?: string;
  readonly track: GuidanceTrackKey;
  readonly metric: string;
  readonly period: string;
  readonly value?: number | null;
  readonly low?: number | null;
  readonly high?: number | null;
  readonly unit: string;
  readonly issuedAt: string;
  readonly source: string;
  readonly status?: GuidanceRevisionStatus;
  readonly supersedesId?: string | null;
  readonly evidenceIds?: readonly string[];
  readonly note?: string;
}

export interface GuidancePoint {
  readonly id: string;
  readonly track: GuidanceTrackKey;
  readonly metric: string;
  readonly period: string;
  readonly value: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly unit: string;
  readonly issuedAt: string;
  readonly source: string;
  readonly status: GuidanceRevisionStatus;
  readonly supersedesId: string | null;
  readonly evidenceIds: readonly string[];
  readonly note: string;
}

export interface GuidanceTrackSeries {
  readonly track: GuidanceTrackKey;
  readonly label: string;
  readonly status: GuidanceTrackStatus;
  readonly points: readonly GuidancePoint[];
  readonly withdrawnCount: number;
  readonly supersededCount: number;
  readonly note: string;
}

export interface GuidanceRevisionLink {
  readonly id: string;
  readonly track: GuidanceTrackKey;
  readonly metric: string;
  readonly period: string;
  readonly fromId: string;
  readonly toId: string;
  readonly kind: "initial" | "revision" | "withdrawal" | "supersession";
  readonly note: string;
}

export interface GuidanceActualScore {
  readonly id: string;
  readonly track: GuidanceTrackKey;
  readonly metric: string;
  readonly period: string;
  readonly actual: number | null;
  readonly priorGuidanceId: string | null;
  readonly priorGuidanceValue: number | null;
  readonly priorGuidanceLow: number | null;
  readonly priorGuidanceHigh: number | null;
  readonly variance: number | null;
  readonly variancePct: number | null;
  readonly hit: GuidanceScoreStatus;
  readonly source: string;
  readonly note: string;
}

export interface GuidanceActualInput {
  readonly metric: string;
  readonly period: string;
  readonly actual: number | null;
  readonly source: string;
  readonly unit?: string;
  readonly evidenceIds?: readonly string[];
}

export interface GuidanceReconciliation {
  readonly version: typeof GUIDANCE_RECONCILIATION_VERSION;
  readonly subjectId: string;
  readonly status: GuidanceReconciliationStatus;
  readonly reason: string;
  readonly generatedAt: string;
  readonly tracks: Readonly<Record<GuidanceTrackKey, GuidanceTrackSeries>>;
  readonly points: readonly GuidancePoint[];
  readonly revisionHistory: readonly GuidanceRevisionLink[];
  readonly scores: readonly GuidanceActualScore[];
  readonly credibility: {
    readonly track: GuidanceTrackKey;
    readonly scored: number;
    readonly met: number;
    readonly missed: number;
    readonly unverified: number;
    readonly hitRate: number | null;
  };
  readonly diagnostics: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
}

export interface BuildGuidanceReconciliationInput {
  readonly subjectId: string;
  readonly generatedAt?: string;
  readonly points?: readonly GuidancePointInput[] | null;
  readonly actuals?: readonly GuidanceActualInput[] | null;
  readonly evidenceIds?: readonly string[];
}

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? round6(value) : null;
}

function normalizeGuidancePoint(input: GuidancePointInput, index: number): GuidancePoint {
  const track = GUIDANCE_TRACK_KEYS.includes(input.track) ? input.track : "apex";
  const metric = String(input.metric ?? "").trim() || "unnamed-metric";
  const period = String(input.period ?? "").trim() || "unknown";
  const issuedAt = String(input.issuedAt ?? "").trim() || "unknown";
  const source = String(input.source ?? "").trim() || "unavailable";
  const value = finiteOrNull(input.value);
  const low = finiteOrNull(input.low);
  const high = finiteOrNull(input.high);
  const id = String(input.id ?? "").trim() || `GP-${stableHash({ track, metric, period, issuedAt, source, value, low, high, index }, GUIDANCE_RECONCILIATION_DOMAIN).slice(0, 16).toUpperCase()}`;
  return {
    id,
    track,
    metric,
    period,
    value,
    low,
    high,
    unit: String(input.unit ?? "").trim() || "unitless",
    issuedAt,
    source,
    status: input.status ?? "active",
    supersedesId: input.supersedesId ?? null,
    evidenceIds: Object.freeze([...new Set((input.evidenceIds ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))),
    note: String(input.note ?? "").trim(),
  };
}

function boundsOf(point: GuidancePoint): { low: number; high: number } | null {
  if (point.value !== null) return { low: point.value, high: point.value };
  if (point.low === null || point.high === null) return null;
  return { low: Math.min(point.low, point.high), high: Math.max(point.low, point.high) };
}

function buildRevisionHistory(points: readonly GuidancePoint[]): GuidanceRevisionLink[] {
  const byKey = new Map<string, GuidancePoint[]>();
  for (const point of points) {
    const key = `${point.track}|${point.metric}|${point.period}`;
    const bucket = byKey.get(key) ?? [];
    bucket.push(point);
    byKey.set(key, bucket);
  }
  const links: GuidanceRevisionLink[] = [];
  for (const key of [...byKey.keys()].sort((left, right) => left.localeCompare(right))) {
    const series = (byKey.get(key) ?? []).sort((left, right) => left.issuedAt.localeCompare(right.issuedAt) || left.id.localeCompare(right.id));
    let previous: GuidancePoint | null = null;
    for (const point of series) {
      const kind = previous === null
        ? "initial"
        : point.supersedesId !== null
          ? "supersession"
          : point.status === "withdrawn"
            ? "withdrawal"
            : point.status === "superseded"
              ? "supersession"
              : "revision";
      links.push({
        id: `GREV-${point.id}`,
        track: point.track,
        metric: point.metric,
        period: point.period,
        fromId: previous === null ? "" : previous.id,
        toId: point.id,
        kind,
        note: previous === null
          ? `first ${point.track} statement for ${point.metric} in ${point.period}`
          : `${kind} of the prior ${point.track} statement for ${point.metric} in ${point.period} issued on ${previous.issuedAt}`,
      });
      previous = point;
    }
  }
  return links;
}

function priorGuidanceFor(points: readonly GuidancePoint[], track: GuidanceTrackKey, metric: string, period: string): GuidancePoint | null {
  const candidates = points
    .filter((point) => point.track === track && point.metric === metric && point.period === period && point.status === "active")
    .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt) || right.id.localeCompare(left.id));
  return candidates[0] ?? null;
}

function scoreAgainstActuals(input: {
  points: readonly GuidancePoint[];
  actuals: readonly GuidanceActualInput[];
  subjectId: string;
  evidenceIds: readonly string[];
}): { scores: GuidanceActualScore[]; diagnostics: string[] } {
  const scores: GuidanceActualScore[] = [];
  const diagnostics: string[] = [];
  for (const actual of input.actuals) {
    for (const track of GUIDANCE_TRACK_KEYS) {
      const prior = priorGuidanceFor(input.points, track, actual.metric, actual.period);
      if (!prior) {
        if (track === "management" || track === "consensus") {
          diagnostics.push(`GUIDANCE_${track.toUpperCase()}_ABSENT:${actual.metric}|${actual.period}`);
        }
        continue;
      }
      const bounds = boundsOf(prior);
      if (!bounds || actual.actual === null) {
        scores.push({
          id: `GSCORE-${prior.id}`,
          track,
          metric: actual.metric,
          period: actual.period,
          actual: actual.actual,
          priorGuidanceId: prior.id,
          priorGuidanceValue: prior.value,
          priorGuidanceLow: bounds?.low ?? null,
          priorGuidanceHigh: bounds?.high ?? null,
          variance: null,
          variancePct: null,
          hit: "unverified",
          source: actual.source,
          note: actual.actual === null
            ? `${track} guidance exists for ${actual.metric} in ${actual.period} but no actual is on record, so the score stays unverified`
            : `${track} guidance for ${actual.metric} in ${actual.period} carries no usable bound, so the score stays unverified`,
        });
        continue;
      }
      const target = bounds.low === bounds.high ? bounds.low : (bounds.low + bounds.high) / 2;
      const variance = round6(actual.actual - target);
      const variancePct = target === 0 ? null : round6(variance / Math.abs(target));
      const hit = actual.actual >= bounds.low && actual.actual <= bounds.high ? "met" : "missed";
      scores.push({
        id: `GSCORE-${prior.id}`,
        track,
        metric: actual.metric,
        period: actual.period,
        actual: round6(actual.actual),
        priorGuidanceId: prior.id,
        priorGuidanceValue: prior.value,
        priorGuidanceLow: bounds.low,
        priorGuidanceHigh: bounds.high,
        variance,
        variancePct,
        hit,
        source: actual.source,
        note: `${track} guidance ${bounds.low === bounds.high ? `${bounds.low}` : `${bounds.low}-${bounds.high}`} against an actual of ${round6(actual.actual)} in ${actual.period}: ${hit}`,
      });
    }
  }
  void input.subjectId;
  void input.evidenceIds;
  return { scores: scores.sort((left, right) => left.id.localeCompare(right.id)), diagnostics };
}

export function buildGuidanceReconciliation(input: BuildGuidanceReconciliationInput): GuidanceReconciliation {
  const subjectId = String(input.subjectId ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const generatedAt = input.generatedAt ?? "unknown";
  const points = (input.points ?? []).map((point, index) => normalizeGuidancePoint(point, index));
  const byId = new Map<string, GuidancePoint>();
  for (const point of points) byId.set(point.id, point);
  const ordered = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  const tracks = Object.fromEntries(GUIDANCE_TRACK_KEYS.map((track) => {
    const series = ordered.filter((point) => point.track === track).sort((left, right) => left.issuedAt.localeCompare(right.issuedAt) || left.id.localeCompare(right.id));
    const withdrawnCount = series.filter((point) => point.status === "withdrawn").length;
    const supersededCount = series.filter((point) => point.status === "superseded").length;
    const status: GuidanceTrackStatus = series.length === 0 ? "unavailable" : "ready";
    return [track, {
      track,
      label: GUIDANCE_TRACK_LABELS[track],
      status,
      points: series,
      withdrawnCount,
      supersededCount,
      note: series.length === 0
        ? `no ${track} statement is on record; this track stays explicitly ${track === "management" || track === "consensus" ? "UNVERIFIED" : "empty"} rather than being back-filled from another track`
        : `${series.length} ${track} statement(s) on record, of which ${withdrawnCount} withdrawn and ${supersededCount} superseded`,
    } satisfies GuidanceTrackSeries];
  })) as unknown as Record<GuidanceTrackKey, GuidanceTrackSeries>;
  const revisionHistory = buildRevisionHistory(ordered);
  const scored = scoreAgainstActuals({ points: ordered, actuals: input.actuals ?? [], subjectId, evidenceIds: input.evidenceIds ?? [] });
  const managementScores = scored.scores.filter((entry) => entry.track === "management");
  const met = managementScores.filter((entry) => entry.hit === "met").length;
  const missed = managementScores.filter((entry) => entry.hit === "missed").length;
  const unverified = managementScores.filter((entry) => entry.hit === "unverified").length;
  const hitRate = met + missed > 0 ? round6(met / (met + missed)) : null;
  const guidanceTracksPresent = GUIDANCE_TRACK_KEYS.filter((track) => tracks[track].status === "ready");
  const status: GuidanceReconciliationStatus = tracks.management.status === "unavailable" && tracks.consensus.status === "unavailable"
    ? "unverified"
    : guidanceTracksPresent.length < GUIDANCE_TRACK_KEYS.length
      ? "insufficient"
      : "ready";
  const reason = status === "unverified"
    ? "neither management guidance nor Street consensus is on record, so forecast-versus-prior-guidance scoring is UNVERIFIED and no guidance score is asserted"
    : status === "insufficient"
      ? `only ${guidanceTracksPresent.join(", ") || "no track"} carries statements, so the four forecast tracks cannot be separated into a full reconciliation`
      : `all ${GUIDANCE_TRACK_KEYS.length} tracks carry statements, with ${revisionHistory.length} revision link(s) recorded`;
  const diagnostics = [
    ...scored.diagnostics,
    ...(ordered.length === 0 ? ["GUIDANCE_NO_STATEMENTS"] : []),
    ...(status !== "ready" ? [`GUIDANCE_RECONCILIATION_${status.toUpperCase()}`] : []),
  ];
  const content = {
    version: GUIDANCE_RECONCILIATION_VERSION,
    subjectId,
    status,
    reason,
    generatedAt,
    tracks,
    points: ordered,
    revisionHistory,
    scores: scored.scores,
    credibility: {
      track: "management" as const,
      scored: managementScores.length,
      met,
      missed,
      unverified,
      hitRate,
    },
    diagnostics: Object.freeze([...new Set(diagnostics)].sort((left, right) => left.localeCompare(right))),
    evidenceIds: Object.freeze([...new Set([...(input.evidenceIds ?? []), ...ordered.flatMap((point) => point.evidenceIds)])].sort((left, right) => left.localeCompare(right))),
  } satisfies Omit<GuidanceReconciliation, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, GUIDANCE_RECONCILIATION_DOMAIN) }) as unknown as GuidanceReconciliation;
}
