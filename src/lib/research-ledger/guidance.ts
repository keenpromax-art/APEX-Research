import { deepFreeze } from "./immutable";
import { compareStableStrings, stableHash } from "./stable";

export const GUIDANCE_TRACKER_VERSION = "guidance-tracker-v1" as const;

export interface GuidanceObservation {
  id: string;
  companyId: string;
  metric: string;
  period: string;
  value?: number;
  low?: number;
  high?: number;
  unit: string;
  source: string;
  issuedAt: string;
  status: "active" | "withdrawn" | "superseded";
  evidenceIds: readonly string[];
}

export interface ModelExpectation {
  metric: string;
  period: string;
  value: number;
  unit: string;
}

export interface GuidanceComparison {
  id: string;
  observationId: string;
  metric: string;
  period: string;
  modelValue: number;
  guidanceValue: number | null;
  variance: number | null;
  variancePct: number | null;
  status: "within-range" | "above-range" | "below-range" | "unverified";
  source: string;
  evidenceIds: readonly string[];
}

function range(observation: GuidanceObservation): { low: number; high: number } | null {
  if (observation.value !== undefined) return { low: observation.value, high: observation.value };
  if (observation.low === undefined || observation.high === undefined) return null;
  return { low: Math.min(observation.low, observation.high), high: Math.max(observation.low, observation.high) };
}

function comparisonId(observation: GuidanceObservation, model: ModelExpectation): string {
  return `GCM-${stableHash({ observationId: observation.id, metric: model.metric, period: model.period }, "guidance/comparison/v1").toUpperCase()}`;
}

export function compareGuidance(
  observations: readonly GuidanceObservation[],
  expectations: readonly ModelExpectation[],
): readonly GuidanceComparison[] {
  const out: GuidanceComparison[] = [];
  for (const observation of observations) {
    if (observation.status !== "active") continue;
    const model = expectations.find((candidate) => candidate.metric === observation.metric && candidate.period === observation.period && candidate.unit === observation.unit);
    const bounds = range(observation);
    if (!model || !bounds || !Number.isFinite(model.value)) continue;
    const guidanceValue = bounds.low === bounds.high ? bounds.low : null;
    const variance = guidanceValue === null ? null : model.value - guidanceValue;
    const variancePct = guidanceValue === null || guidanceValue === 0 ? null : variance === null ? null : variance / Math.abs(guidanceValue);
    const status = model.value < bounds.low ? "below-range" : model.value > bounds.high ? "above-range" : "within-range";
    out.push({
      id: comparisonId(observation, model),
      observationId: observation.id,
      metric: observation.metric,
      period: observation.period,
      modelValue: model.value,
      guidanceValue,
      variance,
      variancePct,
      status,
      source: observation.source,
      evidenceIds: [...observation.evidenceIds],
    });
  }
  return Object.freeze(out.sort((left, right) => left.id.localeCompare(right.id)));
}

export function guidanceCoverage(comparisons: readonly GuidanceComparison[]): { compared: number; total: number; score: number } {
  const total = comparisons.length;
  const compared = comparisons.filter((comparison) => comparison.status !== "unverified").length;
  return { compared, total, score: total === 0 ? 1 : compared / total };
}

export function createGuidanceObservation(input: Omit<GuidanceObservation, "status" | "evidenceIds"> & { status?: GuidanceObservation["status"]; evidenceIds?: readonly string[] }): GuidanceObservation {
  return deepFreeze({
    ...input,
    status: input.status ?? "active",
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])]),
  }) as GuidanceObservation;
}

export const GUIDANCE_REVISION_TRACKS = Object.freeze(["historical", "management", "consensus", "apex"] as const);

export type GuidanceRevisionTrack = (typeof GUIDANCE_REVISION_TRACKS)[number];

export interface GuidanceRevision extends GuidanceObservation {
  readonly track: GuidanceRevisionTrack;
  readonly supersedesId: string | null;
  readonly revisionReason: string;
  readonly contentHash: string;
}

export interface GuidanceRevisionLink {
  readonly id: string;
  readonly track: GuidanceRevisionTrack;
  readonly metric: string;
  readonly period: string;
  readonly fromId: string | null;
  readonly toId: string;
  readonly kind: "initial" | "revision" | "withdrawal" | "supersession";
  readonly note: string;
}

export interface GuidanceActualObservation {
  readonly metric: string;
  readonly period: string;
  readonly actual: number | null;
  readonly source: string;
  readonly unit?: string;
  readonly evidenceIds?: readonly string[];
}

export interface GuidanceActualScore {
  readonly id: string;
  readonly track: GuidanceRevisionTrack;
  readonly metric: string;
  readonly period: string;
  readonly actual: number | null;
  readonly priorGuidanceId: string | null;
  readonly priorGuidanceValue: number | null;
  readonly priorGuidanceLow: number | null;
  readonly priorGuidanceHigh: number | null;
  readonly variance: number | null;
  readonly variancePct: number | null;
  readonly status: "met" | "missed" | "unverified";
  readonly note: string;
}

export interface CreateGuidanceRevisionInput extends Omit<CreateGuidanceObservationLike, "status" | "track"> {
  readonly track: GuidanceRevisionTrack;
  readonly status?: GuidanceObservation["status"];
  readonly supersedesId?: string | null;
  readonly revisionReason?: string;
}

type CreateGuidanceObservationLike = Omit<GuidanceObservation, "status" | "evidenceIds"> & {
  readonly status?: GuidanceObservation["status"];
  readonly evidenceIds?: readonly string[];
};

const REVISION_DOMAIN = "research-ledger/guidance-revision/v1";

export function createGuidanceRevision(input: CreateGuidanceRevisionInput): GuidanceRevision {
  if (!GUIDANCE_REVISION_TRACKS.includes(input.track)) throw new RangeError(`Unknown guidance track ${String(input.track)}`);
  const content = {
    id: input.id,
    companyId: input.companyId,
    track: input.track,
    metric: input.metric,
    period: input.period,
    value: input.value,
    low: input.low,
    high: input.high,
    unit: input.unit,
    source: input.source,
    issuedAt: input.issuedAt,
    status: input.status ?? "active",
    evidenceIds: [...(input.evidenceIds ?? [])].sort(compareStableStrings),
    supersedesId: input.supersedesId ?? null,
    revisionReason: String(input.revisionReason ?? "").trim(),
  };
  return deepFreeze({ ...content, contentHash: stableHash(content, REVISION_DOMAIN) }) as unknown as GuidanceRevision;
}

export function applyGuidanceRevision(
  revisions: readonly GuidanceRevision[],
  revision: GuidanceRevision,
): readonly GuidanceRevision[] {
  const next = [...revisions, revision];
  return next.map((entry) => {
    if (entry.id === revision.id) return entry;
    const sameSlot = entry.track === revision.track && entry.metric === revision.metric && entry.period === revision.period && entry.companyId === revision.companyId;
    if (!sameSlot) return entry;
    if (entry.issuedAt > revision.issuedAt) return entry;
    if (revision.status === "withdrawn") return { ...entry, status: "withdrawn" as const };
    if (revision.supersedesId === entry.id) return { ...entry, status: "superseded" as const };
    return entry;
  });
}

export function buildGuidanceRevisionHistory(revisions: readonly GuidanceRevision[]): readonly GuidanceRevisionLink[] {
  const bySlot = new Map<string, GuidanceRevision[]>();
  for (const revision of revisions) {
    const key = `${revision.track}|${revision.metric}|${revision.period}|${revision.companyId}`;
    const bucket = bySlot.get(key) ?? [];
    bucket.push(revision);
    bySlot.set(key, bucket);
  }
  const links: GuidanceRevisionLink[] = [];
  for (const key of [...bySlot.keys()].sort(compareStableStrings)) {
    const series = (bySlot.get(key) ?? []).sort((left, right) => left.issuedAt.localeCompare(right.issuedAt) || left.id.localeCompare(right.id));
    let previous: GuidanceRevision | null = null;
    for (const revision of series) {
      const kind = previous === null
        ? "initial"
        : revision.supersedesId !== null
          ? "supersession"
          : revision.status === "withdrawn"
            ? "withdrawal"
            : revision.status === "superseded"
              ? "supersession"
              : "revision";
      links.push({
        id: `GREV-${revision.id}`,
        track: revision.track,
        metric: revision.metric,
        period: revision.period,
        fromId: previous === null ? null : previous.id,
        toId: revision.id,
        kind,
        note: previous === null
          ? `first ${revision.track} statement for ${revision.metric} in ${revision.period}`
          : `${kind} of the ${previous.id} statement issued on ${previous.issuedAt}`,
      });
      previous = revision;
    }
  }
  return Object.freeze(links.sort((left, right) => left.id.localeCompare(right.id)));
}

export function scoreGuidanceAgainstActuals(
  revisions: readonly GuidanceRevision[],
  actuals: readonly GuidanceActualObservation[],
): readonly GuidanceActualScore[] {
  const scores: GuidanceActualScore[] = [];
  for (const actual of actuals) {
    for (const track of GUIDANCE_REVISION_TRACKS) {
      const prior = revisions
        .filter((revision) => revision.track === track && revision.metric === actual.metric && revision.period === actual.period && revision.status === "active")
        .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt) || right.id.localeCompare(left.id))[0];
      if (!prior) continue;
      const bounds = range(prior);
      if (!bounds || actual.actual === null) {
        scores.push({
          id: `GSCORE-${prior.id}`,
          track,
          metric: prior.metric,
          period: prior.period,
          actual: actual.actual,
          priorGuidanceId: prior.id,
          priorGuidanceValue: prior.value ?? null,
          priorGuidanceLow: bounds?.low ?? null,
          priorGuidanceHigh: bounds?.high ?? null,
          variance: null,
          variancePct: null,
          status: "unverified",
          note: actual.actual === null
            ? `${track} guidance exists for ${prior.metric} in ${prior.period} but no actual is on record`
            : `${track} guidance for ${prior.metric} in ${prior.period} carries no usable bound`,
        });
        continue;
      }
      const target = bounds.low === bounds.high ? bounds.low : (bounds.low + bounds.high) / 2;
      const variance = Number((actual.actual - target).toFixed(6));
      const variancePct = target === 0 ? null : Number((variance / Math.abs(target)).toFixed(6));
      const withinRange = actual.actual >= bounds.low && actual.actual <= bounds.high;
      scores.push({
        id: `GSCORE-${prior.id}`,
        track,
        metric: prior.metric,
        period: prior.period,
        actual: actual.actual,
        priorGuidanceId: prior.id,
        priorGuidanceValue: prior.value ?? null,
        priorGuidanceLow: bounds.low,
        priorGuidanceHigh: bounds.high,
        variance,
        variancePct,
        status: withinRange ? "met" : "missed",
        note: `${track} guidance ${bounds.low === bounds.high ? `${bounds.low}` : `${bounds.low}-${bounds.high}`} against an actual of ${actual.actual} in ${prior.period}: ${withinRange ? "met" : "missed"}`,
      });
    }
  }
  return Object.freeze(scores.sort((left, right) => left.id.localeCompare(right.id)));
}

export function guidanceTrackStatus(revisions: readonly GuidanceRevision[]): Readonly<Record<GuidanceRevisionTrack, "ready" | "unavailable">> {
  const out = {} as Record<GuidanceRevisionTrack, "ready" | "unavailable">;
  for (const track of GUIDANCE_REVISION_TRACKS) {
    out[track] = revisions.some((revision) => revision.track === track) ? "ready" : "unavailable";
  }
  return Object.freeze(out);
}

export interface AdaptGuidanceReconciliationInput {
  readonly reconciliation: {
    readonly subjectId: string;
    readonly points: readonly {
      readonly id: string;
      readonly track: GuidanceRevisionTrack;
      readonly metric: string;
      readonly period: string;
      readonly value: number | null;
      readonly low: number | null;
      readonly high: number | null;
      readonly unit: string;
      readonly issuedAt: string;
      readonly source: string;
      readonly status: "active" | "withdrawn" | "superseded";
      readonly supersedesId: string | null;
      readonly evidenceIds: readonly string[];
    }[];
  };
  readonly companyId?: string;
  readonly runId?: string;
}

export function adaptGuidanceReconciliationToRevisions(input: AdaptGuidanceReconciliationInput): readonly GuidanceRevision[] {
  const companyId = input.companyId ?? input.reconciliation.subjectId;
  return Object.freeze(input.reconciliation.points.map((point) => createGuidanceRevision({
    id: point.id,
    companyId,
    track: point.track,
    metric: point.metric,
    period: point.period,
    unit: point.unit,
    source: point.source,
    issuedAt: point.issuedAt,
    status: point.status,
    ...(point.value === null ? {} : { value: point.value }),
    ...(point.low === null ? {} : { low: point.low }),
    ...(point.high === null ? {} : { high: point.high }),
    supersedesId: point.supersedesId,
    revisionReason: `adapted from the canonical guidance reconciliation for run ${input.runId ?? "unknown"}`,
    evidenceIds: point.evidenceIds,
  })));
}

export function scoreAdaptedGuidance(reconciliation: {
  readonly scores: readonly {
    readonly track: GuidanceRevisionTrack;
    readonly metric: string;
    readonly period: string;
    readonly actual: number | null;
    readonly priorGuidanceId: string | null;
    readonly priorGuidanceValue: number | null;
    readonly priorGuidanceLow: number | null;
    readonly priorGuidanceHigh: number | null;
    readonly variance: number | null;
    readonly variancePct: number | null;
    readonly hit: "met" | "missed" | "unverified";
  }[];
}): readonly GuidanceActualScore[] {
  return Object.freeze(reconciliation.scores
    .filter((score) => score.priorGuidanceId !== null)
    .map((score) => ({
      id: `GSCORE-${score.priorGuidanceId as string}`,
      track: score.track,
      metric: score.metric,
      period: score.period,
      actual: score.actual,
      priorGuidanceId: score.priorGuidanceId,
      priorGuidanceValue: score.priorGuidanceValue,
      priorGuidanceLow: score.priorGuidanceLow,
      priorGuidanceHigh: score.priorGuidanceHigh,
      variance: score.variance,
      variancePct: score.variancePct,
      status: score.hit,
      note: `${score.track} guidance scored ${score.hit} against an actual of ${score.actual ?? "unavailable"} in ${score.period}`,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}
