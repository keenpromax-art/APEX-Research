import { compareStableStrings, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import type { ResearchReport } from "@/lib/ai-first/types";
import type { PeerDiscoveryResult } from "@/lib/peer-discovery/types";
import type { NormalizedHistoryResult } from "@/lib/history/types";
import type { EarningsQualityAssessment } from "@/lib/earnings-quality/types";
import type { CapitalAllocationLedger } from "@/lib/capital-allocation/types";
import type { ManagementCredibilityLedger } from "@/lib/management-credibility/types";
import type { GuidanceReconciliation } from "@/lib/guidance-reconciliation";

export const RESEARCH_CONFIDENCE_DECOMPOSITION_VERSION = "research-confidence-decomposition-v1" as const;

export type ConfidenceComponentKey = "data" | "model" | "assumption" | "forecast" | "valuation" | "overall";
export type ConfidenceComponentStatus = "ready" | "insufficient" | "unavailable";

export const CONFIDENCE_COMPONENT_KEYS: readonly ConfidenceComponentKey[] = Object.freeze([
  "data",
  "model",
  "assumption",
  "forecast",
  "valuation",
  "overall",
] as const);

export interface ConfidenceDriver {
  readonly label: string;
  readonly effect: number;
  readonly detail: string;
  readonly evidenceIds: readonly string[];
}

export interface ConfidenceComponentScore {
  readonly key: Exclude<ConfidenceComponentKey, "overall">;
  readonly label: string;
  readonly status: ConfidenceComponentStatus;
  readonly score: number;
  readonly confidence: number;
  readonly drivers: readonly ConfidenceDriver[];
  readonly inputs: readonly string[];
  readonly reasoning: string;
}

export interface ConfidenceOverallScore extends Omit<ConfidenceComponentScore, "key"> {
  readonly key: "overall";
}

export interface ConfidenceAggregation {
  readonly method: string;
  readonly formula: string;
  readonly rationale: string;
  readonly baseScore: number;
  readonly correlationPenalty: number;
  readonly coverageFactor: number;
  readonly finalScore: number;
  readonly correlatedGroups: readonly (readonly string[])[];
  readonly notes: readonly string[];
}

export interface ConfidenceDecomposition {
  readonly version: typeof RESEARCH_CONFIDENCE_DECOMPOSITION_VERSION;
  readonly subjectId: string;
  readonly generatedAt: string;
  readonly components: Readonly<Record<Exclude<ConfidenceComponentKey, "overall">, ConfidenceComponentScore>>;
  readonly overall: ConfidenceOverallScore;
  readonly aggregation: ConfidenceAggregation;
  readonly diagnostics: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
}

export interface DecomposeResearchConfidenceInput {
  readonly subjectId: string;
  readonly generatedAt?: string;
  readonly report?: ResearchReport | null;
  readonly assumptionCount?: number;
  readonly factPackVerified?: boolean;
  readonly currencyBlocked?: boolean;
  readonly retrievalStatus?: "ready" | "partial" | "failed" | "unavailable";
  readonly lineageTraceable?: boolean;
  readonly peerDiscovery?: PeerDiscoveryResult | null;
  readonly history?: NormalizedHistoryResult | null;
  readonly earningsQuality?: EarningsQualityAssessment | null;
  readonly capitalAllocation?: CapitalAllocationLedger | null;
  readonly managementCredibility?: ManagementCredibilityLedger | null;
  readonly guidanceReconciliation?: GuidanceReconciliation | null;
  readonly evidenceIds?: readonly string[];
}

const CONFIDENCE_DOMAIN = "research-package/confidence-decomposition/v1";
const WEIGHTS: Readonly<Record<Exclude<ConfidenceComponentKey, "overall">, number>> = Object.freeze({
  data: 0.25,
  model: 0.2,
  assumption: 0.15,
  forecast: 0.2,
  valuation: 0.2,
});
const CORRELATED_GROUPS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(["data", "model"]),
  Object.freeze(["forecast", "valuation"]),
]);
const CORRELATION_PENALTY_RATE = 0.1;
const MAXIMUM_COMPONENT_SCORE = 0.95;

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function joinDrivers(drivers: readonly ConfidenceDriver[]): string {
  return drivers
    .slice()
    .sort((left, right) => Math.abs(right.effect) - Math.abs(left.effect) || compareStableStrings(left.label, right.label))
    .slice(0, 3)
    .map((driver) => `${driver.label} (${driver.effect > 0 ? "+" : ""}${round6(driver.effect)})`)
    .join(", ");
}

function buildComponent(
  key: Exclude<ConfidenceComponentKey, "overall">,
  label: string,
  base: number,
  drivers: readonly ConfidenceDriver[],
  inputs: readonly string[],
  rationale: string,
  confidence: number,
): ConfidenceComponentScore {
  const observable = inputs.length > 0;
  const listed = drivers.length > 0
    ? drivers
    : [Object.freeze({ label: "no observable driver", effect: 0, detail: "no corroborating or contradicting evidence is on record, so the score rests on its base only", evidenceIds: Object.freeze([]) as readonly string[] })];
  const penalty = listed.filter((driver) => driver.effect < 0).reduce((total, driver) => total + driver.effect, 0);
  const score = round6(clamp(base + penalty, 0, MAXIMUM_COMPONENT_SCORE));
  const status: ConfidenceComponentStatus = !observable ? "unavailable" : score < 0.5 ? "insufficient" : "ready";
  return {
    key,
    label,
    status,
    score,
    confidence: round6(observable ? clamp(confidence, 0, 1) : 0),
    drivers: Object.freeze(listed.map((driver) => ({ ...driver, effect: round6(driver.effect), evidenceIds: Object.freeze([...driver.evidenceIds].sort(compareStableStrings)) }))),
    inputs: Object.freeze([...inputs].sort(compareStableStrings)),
    reasoning: status === "unavailable"
      ? `${label} cannot be scored: nothing in the run corroborates or contradicts it, so it stays unobserved rather than defaulting to a midpoint`
      : `${label} scores ${score} from a ${round6(base)} base. ${joinDrivers(listed)}. ${rationale}`,
  };
}

function dataComponent(input: DecomposeResearchConfidenceInput): ConfidenceComponentScore {
  const drivers: ConfidenceDriver[] = [];
  const inputs: string[] = [];
  const diagnostics: string[] = [];
  let base = 0.5;
  const factPack = input.report?.factPackVersion;
  if (factPack) {
    inputs.push("factPackVersion");
    base += 0.1;
  }
  if (input.factPackVerified === true) {
    inputs.push("factPackVerified");
    base += 0.15;
    drivers.push({ label: "fact pack integrity verified", effect: 0.15, detail: "the fact pack passed content-addressed verification", evidenceIds: Object.freeze([]) as readonly string[] });
  } else if (input.factPackVerified === false) {
    drivers.push({ label: "fact pack integrity unavailable", effect: -0.3, detail: "the fact pack could not be verified, so no data-level claim is corroborated", evidenceIds: Object.freeze([]) as readonly string[] });
  }
  if (input.currencyBlocked === false) {
    inputs.push("currencyBasis");
    base += 0.05;
  } else if (input.currencyBlocked === true) {
    drivers.push({ label: "currency basis blocked", effect: -0.2, detail: "reporting-currency normalization is blocked, so cross-period comparison is unsafe", evidenceIds: Object.freeze([]) as readonly string[] });
  }
  const retrieval = input.retrievalStatus;
  if (retrieval !== undefined) {
    inputs.push(`retrieval:${retrieval}`);
    if (retrieval === "ready") {
      base += 0.1;
      drivers.push({ label: "retrieval ready", effect: 0.1, detail: "allowlisted retrieval produced source documents", evidenceIds: Object.freeze([]) as readonly string[] });
    } else if (retrieval === "partial") {
      drivers.push({ label: "retrieval partial", effect: -0.05, detail: "only part of the retrieval plan returned documents", evidenceIds: Object.freeze([]) as readonly string[] });
    } else {
      drivers.push({ label: `retrieval ${retrieval}`, effect: -0.2, detail: "no source document backs the factual layer", evidenceIds: Object.freeze([]) as readonly string[] });
      diagnostics.push("CONFIDENCE_DATA_RETRIEVAL_UNAVAILABLE");
    }
  }
  if (input.lineageTraceable === true) {
    base += 0.05;
  } else if (input.lineageTraceable === false) {
    drivers.push({ label: "material claim lineage incomplete", effect: -0.15, detail: "at least one material claim has no source-to-claim path", evidenceIds: Object.freeze([]) as readonly string[] });
  }
  const history = input.history ?? null;
  if (history) {
    inputs.push(`history:${history.status}`);
    if (history.status === "ready") {
      base += 0.05;
      drivers.push({ label: "normalized history ready", effect: 0.05, detail: `${history.coverage.metricsReady} of ${history.coverage.metricsTracked} tracked metrics are evidenced across both windows`, evidenceIds: history.evidenceIds });
    } else if (history.status === "insufficient") {
      drivers.push({ label: "normalized history insufficient", effect: -0.1, detail: `only ${history.coverage.metricsReady} of ${history.coverage.metricsTracked} tracked metrics cleared their window coverage`, evidenceIds: history.evidenceIds });
    } else {
      drivers.push({ label: "normalized history unavailable", effect: -0.2, detail: "no statement history is on record", evidenceIds: history.evidenceIds });
    }
  }
  const quality = input.earningsQuality ?? null;
  if (quality) {
    inputs.push(`earningsQuality:${quality.status}`);
    if (quality.status === "ready") {
      base += 0.05;
    } else if (quality.summary.unknownKinds.length > 0) {
      drivers.push({
        label: "earnings normalization gaps",
        effect: -0.05,
        detail: `${quality.summary.unexplainedAdjustmentCount} one-off slot(s) across ${quality.summary.unknownKinds.length} kind(s) stay unknown and are not imputed`,
        evidenceIds: quality.evidenceIds,
      });
    }
  }
  const peers = input.peerDiscovery ?? null;
  if (peers) {
    inputs.push(`peerDiscovery:${peers.status}`);
    if (peers.status === "ready") {
      base += 0.05;
    } else {
      drivers.push({ label: `peer discovery ${peers.status}`, effect: -0.05, detail: peers.reason, evidenceIds: peers.evidenceIds });
    }
  }
  return buildComponent("data", "Data", base, drivers, inputs, "the data score reflects verified provenance, retrieval coverage and history depth, not the amount of data present", 0.7);
}

function modelComponent(input: DecomposeResearchConfidenceInput): ConfidenceComponentScore {
  const drivers: ConfidenceDriver[] = [];
  const inputs: string[] = [];
  let base = 0.45;
  const modelValid = input.report?.forecast?.status;
  if (input.report) inputs.push("modelSpecVersion");
  if (modelValid === "ready") {
    base += 0.2;
    drivers.push({ label: "model specification executed", effect: 0.2, detail: "the AI-authored model specification executed to a ready forecast", evidenceIds: Object.freeze([]) as readonly string[] });
  } else if (modelValid === "blocked") {
    drivers.push({ label: "forecast blocked", effect: -0.3, detail: "the model specification did not execute to a publishable forecast", evidenceIds: Object.freeze([]) as readonly string[] });
  }
  const formulaCount = input.report?.operatingModel?.formulas?.length ?? 0;
  if (formulaCount > 0) {
    inputs.push(`formulas:${formulaCount}`);
    base += Math.min(0.15, formulaCount * 0.02);
  }
  const peerDiscovery = input.peerDiscovery ?? null;
  if (peerDiscovery) {
    if (peerDiscovery.status === "ready") {
      base += 0.1;
      drivers.push({ label: "economic peer set evidenced", effect: 0.1, detail: peerDiscovery.reason, evidenceIds: peerDiscovery.evidenceIds });
    } else if (peerDiscovery.status === "insufficient") {
      drivers.push({ label: "economic peer set insufficient", effect: -0.1, detail: peerDiscovery.reason, evidenceIds: peerDiscovery.evidenceIds });
    } else {
      drivers.push({ label: "economic peer set unavailable", effect: -0.2, detail: peerDiscovery.reason, evidenceIds: peerDiscovery.evidenceIds });
    }
  }
  const management = input.managementCredibility ?? null;
  if (management) {
    inputs.push(`managementCredibility:${management.status}`);
    if (management.status === "VERIFIED" && management.score !== null) {
      base += 0.1;
      drivers.push({ label: "management promises resolved", effect: 0.1, detail: management.reason, evidenceIds: management.evidenceIds });
    } else {
      drivers.push({ label: "management credibility unverified", effect: -0.1, detail: management.reason, evidenceIds: management.evidenceIds });
    }
  }
  return buildComponent("model", "Model", base, drivers, inputs, "the model score measures whether the executed specification is economically anchored, not how complex it is", 0.7);
}

function assumptionComponent(input: DecomposeResearchConfidenceInput): ConfidenceComponentScore {
  const drivers: ConfidenceDriver[] = [];
  const inputs: string[] = [];
  let base = 0.4;
  const assumptions = input.assumptionCount ?? 0;
  const formulaConfidence = input.report?.operatingModel?.formulas ?? [];
  if (assumptions > 0) {
    inputs.push(`assumptions:${assumptions}`);
    base += Math.min(0.15, assumptions * 0.03);
  } else {
    drivers.push({ label: "no assumption register on record", effect: -0.1, detail: "the report carries no explicit assumption register, so assumption exposure cannot be measured", evidenceIds: Object.freeze([]) as readonly string[] });
  }
  if (formulaConfidence.length > 0) {
    const withEvidence = formulaConfidence.filter((formula) => (formula.evidenceIds?.length ?? 0) > 0 || (formula.sourceFactIds?.length ?? 0) > 0).length;
    const coverage = withEvidence / formulaConfidence.length;
    inputs.push(`formulaEvidenceCoverage:${round6(coverage)}`);
    base += Math.min(0.15, coverage * 0.15);
    if (coverage < 0.5) {
      drivers.push({ label: "formulas weakly grounded", effect: -0.1, detail: `only ${withEvidence} of ${formulaConfidence.length} formulas cite a source fact or evidence item`, evidenceIds: Object.freeze([]) as readonly string[] });
    }
  }
  const guidance = input.guidanceReconciliation ?? null;
  if (guidance) {
    inputs.push(`guidance:${guidance.status}`);
    if (guidance.status === "ready") {
      base += 0.1;
      drivers.push({ label: "forecast tracks separated", effect: 0.1, detail: guidance.reason, evidenceIds: guidance.evidenceIds });
    } else if (guidance.status === "unverified") {
      drivers.push({ label: "no external guidance anchor", effect: -0.1, detail: guidance.reason, evidenceIds: guidance.evidenceIds });
    } else {
      drivers.push({ label: "guidance tracks partially evidenced", effect: -0.05, detail: guidance.reason, evidenceIds: guidance.evidenceIds });
    }
  }
  const allocation = input.capitalAllocation ?? null;
  if (allocation) {
    inputs.push(`capitalAllocation:${allocation.status}`);
    if (allocation.status === "ready") {
      const unjudged = allocation.diagnosticsLog.length;
      base += unjudged === 0 ? 0.1 : 0.05;
      if (unjudged > 0) {
        drivers.push({ label: "capital-allocation diagnostics unjudged", effect: -0.05, detail: allocation.diagnosticsLog.join(", "), evidenceIds: allocation.evidenceIds });
      }
    } else {
      drivers.push({ label: "capital-allocation ledger unavailable", effect: -0.1, detail: allocation.reason, evidenceIds: allocation.evidenceIds });
    }
  }
  return buildComponent("assumption", "Assumption", base, drivers, inputs, "the assumption score counts disclosed, evidence-linked inputs rather than the size of the assumption set", 0.7);
}

function forecastComponent(input: DecomposeResearchConfidenceInput): ConfidenceComponentScore {
  const drivers: ConfidenceDriver[] = [];
  const inputs: string[] = [];
  let base = 0.35;
  const forecast = input.report?.forecast ?? null;
  if (forecast) {
    inputs.push(`forecastStatus:${forecast.status}`);
    if (forecast.status === "ready") {
      base += 0.25;
      drivers.push({ label: "forecast ready", effect: 0.25, detail: `the canonical forecast executed over ${forecast.incomeStatement.length} period(s)`, evidenceIds: Object.freeze([]) as readonly string[] });
    } else if (forecast.status === "incomplete") {
      drivers.push({ label: "forecast incomplete", effect: -0.1, detail: "the canonical forecast executed but is incomplete", evidenceIds: Object.freeze([]) as readonly string[] });
    } else {
      drivers.push({ label: "forecast blocked", effect: -0.3, detail: "the canonical forecast is blocked", evidenceIds: Object.freeze([]) as readonly string[] });
    }
  } else {
    drivers.push({ label: "no forecast on record", effect: -0.2, detail: "no canonical forecast is attached to this run", evidenceIds: Object.freeze([]) as readonly string[] });
  }
  const history = input.history ?? null;
  if (history) {
    inputs.push(`history:${history.status}`);
    if (history.status === "ready") {
      const breaks = history.trendBreaks.filter((entry) => entry.status === "unattributed").length;
      base += 0.1;
      if (breaks > 0) {
        drivers.push({ label: "unattributed trend breaks", effect: -0.05, detail: `${breaks} detected trend break(s) have no attributed cause, so their persistence is unjudged`, evidenceIds: history.evidenceIds });
      }
    } else {
      drivers.push({ label: "history cannot anchor the forecast", effect: -0.15, detail: history.diagnostics.length > 0 ? history.diagnostics.join(", ") : "history depth is insufficient to anchor a forward path", evidenceIds: history.evidenceIds });
    }
  }
  const scenarios = input.report?.scenarios?.length ?? 0;
  if (scenarios > 0) {
    inputs.push(`scenarios:${scenarios}`);
    base += Math.min(0.1, scenarios * 0.03);
  }
  const quality = input.earningsQuality ?? null;
  if (quality && quality.status === "ready" && quality.flags.some((flag) => flag.severity === "material")) {
    drivers.push({ label: "material earnings-quality flags", effect: -0.1, detail: quality.flags.filter((flag) => flag.severity === "material").map((flag) => flag.message).join("; "), evidenceIds: quality.evidenceIds });
  }
  return buildComponent("forecast", "Forecast", base, drivers, inputs, "the forecast score reflects whether the forward path is anchored to evidenced history rather than its headline growth", 0.7);
}

function valuationComponent(input: DecomposeResearchConfidenceInput): ConfidenceComponentScore {
  const drivers: ConfidenceDriver[] = [];
  const inputs: string[] = [];
  let base = 0.15;
  const valuation = input.report?.valuation ?? null;
  const matrix = input.report?.valuationMatrix ?? null;
  if (valuation) {
    inputs.push(`valuationStatus:${valuation.status}`);
    if (valuation.status === "ready" && typeof valuation.fairValuePerShare === "number" && Number.isFinite(valuation.fairValuePerShare)) {
      base += 0.25;
      drivers.push({ label: "valuation ready", effect: 0.25, detail: `${valuation.methodology} produced a finite fair value`, evidenceIds: (valuation.provenance?.inputs.flatMap((entry) => entry.evidenceIds ?? []) ?? []) as readonly string[] });
    } else {
      drivers.push({ label: "valuation not ready", effect: -0.25, detail: `valuation status is ${valuation.status}`, evidenceIds: Object.freeze([]) as readonly string[] });
    }
  }
  if (matrix) {
    const ready = matrix.methods.filter((method) => method.status === "ready").length;
    inputs.push(`valuationMethodsReady:${ready}`);
    if (ready >= 2) {
      base += 0.15;
      drivers.push({ label: "cross-check available", effect: 0.15, detail: `${ready} valuation methods are ready for cross-check`, evidenceIds: Object.freeze([]) as readonly string[] });
    } else if (ready === 1) {
      base += 0.05;
    } else {
      drivers.push({ label: "no valuation cross-check", effect: -0.1, detail: "fewer than two valuation methods are ready", evidenceIds: Object.freeze([]) as readonly string[] });
    }
    if (matrix.crossCheck.disagreement) {
      drivers.push({ label: "valuation disagreement", effect: -0.1, detail: `methods disagree by ${round6(matrix.crossCheck.disagreement.spreadPct * 100).toFixed(1)}%`, evidenceIds: Object.freeze([]) as readonly string[] });
    }
  }
  const peers = input.peerDiscovery ?? null;
  if (peers) {
    const valuationSet = peers.peerSets.valuation;
    inputs.push(`valuationPeers:${valuationSet.matches.length}`);
    if (valuationSet.status === "ready") {
      base += 0.1;
      drivers.push({ label: "relative valuation anchored", effect: 0.1, detail: valuationSet.note, evidenceIds: peers.evidenceIds });
    } else {
      drivers.push({ label: "relative valuation unanchored", effect: -0.1, detail: valuationSet.note, evidenceIds: peers.evidenceIds });
    }
  }
  const monteCarlo = input.report?.monteCarlo ?? null;
  if (monteCarlo?.status === "ready") {
    base += 0.05;
  }
  return buildComponent("valuation", "Valuation", base, drivers, inputs, "the valuation score reflects independent method agreement and relative anchoring, not the size of the upside", 0.7);
}

function aggregate(components: Readonly<Record<Exclude<ConfidenceComponentKey, "overall">, ConfidenceComponentScore>>): ConfidenceAggregation {
  const keys = Object.keys(WEIGHTS) as Array<Exclude<ConfidenceComponentKey, "overall">>;
  const notes: string[] = [];
  const scores = keys.map((key) => {
    const component = components[key];
    return { key, weight: WEIGHTS[key], score: component.score, status: component.status, available: component.status !== "unavailable" };
  });
  const availableWeight = scores.filter((entry) => entry.available).reduce((total, entry) => total + entry.weight, 0);
  if (availableWeight === 0) {
    return {
      method: "weighted-geometric-mean",
      formula: "overall = 0 when no component is observable",
      rationale: "no confidence component is observable, so the overall score is withheld at zero rather than defaulted to a neutral midpoint",
      baseScore: 0,
      correlationPenalty: 0,
      coverageFactor: 0,
      finalScore: 0,
      correlatedGroups: CORRELATED_GROUPS,
      notes: Object.freeze(["CONFIDENCE_NO_OBSERVABLE_COMPONENT"]),
    };
  }
  const positive = scores.filter((entry) => entry.available);
  const logarithmic = positive.reduce((total, entry) => total + entry.weight * Math.log(Math.max(entry.score, 1e-6)), 0);
  const baseScore = Math.exp(logarithmic / availableWeight);
  const ordered = new Map(positive.map((entry) => [entry.key, entry]));
  let correlationPenalty = 0;
  for (const group of CORRELATED_GROUPS) {
    const members = group
      .map((key) => ordered.get(key as Exclude<ConfidenceComponentKey, "overall">))
      .filter((entry): entry is (typeof positive)[number] => entry !== undefined);
    if (members.length < 2) {
      notes.push(`CONFIDENCE_CORRELATED_GROUP_PARTIAL:${group.join("+")}`);
      continue;
    }
    const mean = members.reduce((total, entry) => total + entry.score, 0) / members.length;
    const dispersion = Math.sqrt(members.reduce((total, entry) => total + (entry.score - mean) ** 2, 0) / members.length);
    correlationPenalty += dispersion * CORRELATION_PENALTY_RATE;
    if (dispersion < 0.05) notes.push(`CONFIDENCE_CORRELATED_GROUP_AGREES:${group.join("+")}`);
  }
  const correlationPenaltyRounded = round6(correlationPenalty);
  const coverageFactor = round6(availableWeight);
  if (coverageFactor < 1) notes.push(`CONFIDENCE_COMPONENT_COVERAGE:${round6(coverageFactor)}`);
  const finalScore = round6(clamp(baseScore * coverageFactor - correlationPenaltyRounded, 0, MAXIMUM_COMPONENT_SCORE));
  return {
    method: "weighted-geometric-mean-with-correlation-penalty",
    formula: "overall = clamp( (Π score_i^weight_i)^(1/Σweight_i) × Σweight_i(available) − dispersion penalty, 0, 0.95 )",
    rationale: "a geometric mean refuses to let one strong component mask a weak one, the coverage factor keeps unobservable components from being silently treated as neutral, and the dispersion penalty removes double counting where components share inputs",
    baseScore: round6(baseScore),
    correlationPenalty: correlationPenaltyRounded,
    coverageFactor,
    finalScore,
    correlatedGroups: CORRELATED_GROUPS,
    notes: Object.freeze(notes.sort(compareStableStrings)),
  };
}

export function decomposeResearchConfidence(input: DecomposeResearchConfidenceInput): ConfidenceDecomposition {
  const subjectId = (input.subjectId ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const generatedAt = input.generatedAt ?? input.report?.generationTimestamp ?? "unknown";
  const components: Readonly<Record<Exclude<ConfidenceComponentKey, "overall">, ConfidenceComponentScore>> = {
    data: dataComponent(input),
    model: modelComponent(input),
    assumption: assumptionComponent(input),
    forecast: forecastComponent(input),
    valuation: valuationComponent(input),
  };
  const aggregation = aggregate(components);
  const componentKeys = Object.keys(components) as Array<Exclude<ConfidenceComponentKey, "overall">>;
  const observable = componentKeys.filter((key) => components[key].status !== "unavailable");
  const diagnostics = [
    ...aggregation.notes,
    ...(observable.length === 0 ? ["CONFIDENCE_ALL_COMPONENTS_UNAVAILABLE"] : []),
    ...(observable.length < componentKeys.length ? [`CONFIDENCE_UNOBSERVABLE_COMPONENTS:${componentKeys.filter((key) => components[key].status === "unavailable").join(",")}`] : []),
  ];
  const evidenceIds = [
    ...(input.evidenceIds ?? []),
    ...(input.peerDiscovery?.evidenceIds ?? []),
    ...(input.history?.evidenceIds ?? []),
    ...(input.earningsQuality?.evidenceIds ?? []),
    ...(input.capitalAllocation?.evidenceIds ?? []),
    ...(input.managementCredibility?.evidenceIds ?? []),
    ...(input.guidanceReconciliation?.evidenceIds ?? []),
  ];
  const overallDrivers: ConfidenceDriver[] = componentKeys.map((key) => ({
    label: `${components[key].label.toLowerCase()} component`,
    effect: round6((components[key].score - 0.5) * WEIGHTS[key] * 2),
    detail: components[key].reasoning,
    evidenceIds: components[key].drivers.flatMap((driver) => driver.evidenceIds),
  }));
  const overall: ConfidenceOverallScore = {
    key: "overall",
    label: "Overall",
    status: observable.length === 0 ? "unavailable" : observable.length < componentKeys.length ? "insufficient" : "ready",
    score: aggregation.finalScore,
    confidence: round6(observable.length === 0 ? 0 : observable.length / componentKeys.length * (observable.reduce((total, key) => total + components[key].confidence, 0) / observable.length)),
    drivers: Object.freeze(overallDrivers),
    inputs: Object.freeze(componentKeys),
    reasoning: observable.length === 0
      ? "Overall confidence is withheld at zero because no component is observable; a neutral midpoint would overstate what is known."
      : `Overall confidence ${aggregation.finalScore} from a weighted geometric mean over ${observable.length} observable component(s), scaled by ${aggregation.coverageFactor} observable weight and reduced by a ${aggregation.correlationPenalty} correlation penalty. ${aggregation.rationale}.`,
  };
  const content = {
    version: RESEARCH_CONFIDENCE_DECOMPOSITION_VERSION,
    subjectId,
    generatedAt,
    components,
    overall,
    aggregation,
    diagnostics: Object.freeze([...new Set(diagnostics)].sort(compareStableStrings)),
    evidenceIds: Object.freeze([...new Set(evidenceIds)].sort(compareStableStrings)),
  } satisfies Omit<ConfidenceDecomposition, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, CONFIDENCE_DOMAIN) }) as ConfidenceDecomposition;
}
