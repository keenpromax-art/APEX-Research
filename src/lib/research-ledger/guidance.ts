import { deepFreeze } from "./immutable";
import { stableHash } from "./stable";

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
