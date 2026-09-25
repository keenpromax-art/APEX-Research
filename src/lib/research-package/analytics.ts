import { compareStableStrings } from "@/lib/research-ledger/stable";
import type { FactPack, ForecastSpecification, ForecastResult, ResearchDiscoveryPack, ValuationResult, CompanyUnderstanding } from "@/lib/ai-first/types";
import type { CanonicalEvidenceRegistry, ResearchRetrievalResult } from "@/lib/research-retrieval/types";
import { buildHistoryMetricIndex, RAW_METRIC_ALIASES, historyPeriodLabel } from "@/lib/history/facts";
import { buildNormalizedHistory } from "@/lib/history/engine";
import { assessEarningsQuality } from "@/lib/earnings-quality/assessment";
import type { EarningsQualityOneOffEvidence } from "@/lib/earnings-quality/types";
import { buildCapitalAllocationLedger } from "@/lib/capital-allocation/ledger";
import { buildManagementCredibilityLedger, extractManagementPromises, normalizeManagementPromise } from "@/lib/management-credibility/credibility";
import type { ManagementActual, ManagementPromiseInput } from "@/lib/management-credibility/types";
import { buildGuidanceReconciliation, type GuidanceActualInput, type GuidancePointInput } from "@/lib/guidance-reconciliation";
import { buildSubjectPeerProfile, discoverEconomicPeers } from "@/lib/peer-discovery";
import type { PeerCandidateProvider, PeerDiscoveryResult, PeerProfileInput } from "@/lib/peer-discovery/types";
import type { NormalizedHistoryResult } from "@/lib/history/types";
import type { EarningsQualityAssessment } from "@/lib/earnings-quality/types";
import type { CapitalAllocationLedger } from "@/lib/capital-allocation/types";
import type { ManagementCredibilityLedger } from "@/lib/management-credibility/types";

export const RESEARCH_ANALYTICS_VERSION = "research-analytics-v1" as const;

export interface ResearchAnalytics {
  readonly version: typeof RESEARCH_ANALYTICS_VERSION;
  readonly subjectId: string;
  readonly generatedAt: string;
  readonly peerDiscovery: PeerDiscoveryResult;
  readonly normalizedHistory: NormalizedHistoryResult;
  readonly earningsQuality: EarningsQualityAssessment;
  readonly capitalAllocation: CapitalAllocationLedger;
  readonly managementCredibility: ManagementCredibilityLedger;
  readonly guidanceReconciliation: ReturnType<typeof buildGuidanceReconciliation>;
  readonly diagnostics: readonly string[];
}

export interface BuildResearchAnalyticsInput {
  readonly factPack: FactPack;
  readonly understanding: CompanyUnderstanding;
  readonly retrieval: ResearchRetrievalResult;
  readonly evidenceRegistry: CanonicalEvidenceRegistry;
  readonly researchDiscovery?: ResearchDiscoveryPack | null;
  readonly forecastSpec?: ForecastSpecification | null;
  readonly forecast?: ForecastResult | null;
  readonly valuation?: ValuationResult | null;
  readonly factPackVerified?: boolean;
  readonly retrievalStatus?: ResearchRetrievalResult["status"];
  readonly lineageTraceable?: boolean;
  readonly peerUniverse?: readonly PeerProfileInput[] | null;
  readonly peerProvider?: PeerCandidateProvider | null;
  readonly generatedAt?: string;
}

const ACTUAL_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  revenue: RAW_METRIC_ALIASES.revenue,
  sales: RAW_METRIC_ALIASES.revenue,
  ebit: RAW_METRIC_ALIASES.operatingIncome,
  "operating income": RAW_METRIC_ALIASES.operatingIncome,
  "operating profit": RAW_METRIC_ALIASES.operatingIncome,
  eps: RAW_METRIC_ALIASES.eps,
  "earnings per share": RAW_METRIC_ALIASES.eps,
  capex: RAW_METRIC_ALIASES.capex,
  "capital expenditure": RAW_METRIC_ALIASES.capex,
  dividend: RAW_METRIC_ALIASES.dividendsPaid,
  roic: Object.freeze([]) as readonly string[],
  margin: Object.freeze([]) as readonly string[],
});

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function periodYear(period: string): number | null {
  const match = period.match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function actualFor(input: {
  factPack: FactPack;
  metric: string;
  period: string;
}): { value: number | null; factIds: readonly string[]; source: string } {
  const index = buildHistoryMetricIndex(input.factPack);
  const year = periodYear(input.period);
  const key = input.metric.toLowerCase().trim();
  if (key === "margin" || key === "roic") {
    const history = buildNormalizedHistory({ factPack: input.factPack, subjectId: input.factPack.ticker, generatedAt: input.factPack.retrievalTimestamp, windows: ["5Y"] });
    const metricKey = key === "margin" ? "operatingMargin" : "roic";
    const trend = history.windows["5Y"].find((entry) => entry.metric === metricKey);
    const point = [...(trend?.points ?? [])].reverse().find((entry) => entry.value !== null);
    return { value: point?.value ?? null, factIds: point?.factIds ?? [], source: "normalized history" };
  }
  const aliases = ACTUAL_ALIASES[key];
  if (!aliases) return { value: null, factIds: [], source: "unavailable" };
  const candidates = index.periods.filter((periodEnd) => {
    if (year === null) return true;
    const periodEndYear = periodYear(periodEnd);
    return periodEndYear === null ? false : periodEndYear >= year;
  });
  for (const periodEnd of candidates) {
    const value = index.measure(aliases, periodEnd);
    if (value !== null) {
      const point = index.resolve(aliases, periodEnd);
      return { value: round6(value), factIds: point?.factIds ?? [], source: point?.source ?? "factpack" };
    }
  }
  return { value: null, factIds: [], source: "unavailable" };
}

function collectGuidancePoints(input: {
  factPack: FactPack;
  forecast: ForecastResult | null | undefined;
  promises: readonly ManagementPromiseInput[];
  generatedAt: string;
}): GuidancePointInput[] {
  const points: GuidancePointInput[] = [];
  const index = buildHistoryMetricIndex(input.factPack);
  const latestPeriod = index.periods[index.periods.length - 1] ?? null;
  if (latestPeriod) {
    for (const [metric, aliases] of [["revenue", RAW_METRIC_ALIASES.revenue], ["ebit", RAW_METRIC_ALIASES.operatingIncome], ["eps", RAW_METRIC_ALIASES.eps]] as const) {
      const point = index.resolve(aliases, latestPeriod);
      if (!point || point.reported === null) continue;
      points.push({
        track: "historical",
        metric,
        period: historyPeriodLabel(latestPeriod),
        value: round6(point.reported),
        unit: metric === "eps" ? "per-share" : "money",
        issuedAt: latestPeriod,
        source: point.source,
        status: "active",
        evidenceIds: point.factIds,
        note: "demonstrated history for the latest reported period",
      });
    }
  }
  for (const fact of input.factPack.estimates?.facts ?? []) {
    const match = fact.metric.match(/^(eps|revenue)Estimate_(.+)$/);
    if (!match) continue;
    if (fact.value === undefined || fact.periodType !== "estimate") continue;
    points.push({
      track: "consensus",
      metric: match[1] === "eps" ? "eps" : "revenue",
      period: fact.reportingPeriod ?? fact.period ?? "unknown",
      value: round6(fact.value),
      unit: match[1] === "eps" ? "per-share" : "money",
      issuedAt: fact.asOfDate ?? input.generatedAt,
      source: fact.sourceMetadata?.provider ?? "Street consensus",
      status: "active",
      evidenceIds: fact.factId ? [fact.factId] : [],
      note: "Street consensus estimate carried on the fact pack",
    });
  }
  for (const promise of input.promises) {
    points.push({
      track: "management",
      metric: promise.metric,
      period: promise.period,
      value: promise.target,
      ...(typeof promise.low === "number" ? { low: promise.low } : {}),
      ...(typeof promise.high === "number" ? { high: promise.high } : {}),
      unit: promise.unit ?? "unitless",
      issuedAt: promise.issuedAt,
      source: promise.source ?? "unavailable",
      status: promise.status === "withdrawn" ? "withdrawn" : promise.status === "superseded" ? "superseded" : "active",
      ...(promise.supersedesId ? { supersedesId: promise.supersedesId } : {}),
      evidenceIds: promise.evidenceIds ?? [],
      note: "dated management statement",
    });
  }
  for (const year of input.forecast?.incomeStatement ?? []) {
    const revenue = year.values.revenue ?? year.values.totalRevenue;
    if (typeof revenue === "number" && Number.isFinite(revenue)) {
      points.push({
        track: "apex",
        metric: "revenue",
        period: year.period,
        value: round6(revenue),
        unit: "money",
        issuedAt: input.generatedAt,
        source: "APEX canonical forecast",
        status: "active",
        evidenceIds: Object.freeze(year.factIds ? Object.values(year.factIds) : []) as readonly string[],
        note: "APEX forecast revenue path",
      });
    }
    const ebit = year.values.operatingIncome ?? year.values.ebit;
    if (typeof ebit === "number" && Number.isFinite(ebit)) {
      points.push({
        track: "apex",
        metric: "ebit",
        period: year.period,
        value: round6(ebit),
        unit: "money",
        issuedAt: input.generatedAt,
        source: "APEX canonical forecast",
        status: "active",
        evidenceIds: Object.freeze(year.factIds ? Object.values(year.factIds) : []) as readonly string[],
        note: "APEX forecast EBIT path",
      });
    }
  }
  return points;
}

export async function buildResearchAnalytics(input: BuildResearchAnalyticsInput): Promise<ResearchAnalytics> {
  const subjectId = input.factPack.ticker.toUpperCase();
  const generatedAt = input.generatedAt ?? input.factPack.retrievalTimestamp;
  const index = buildHistoryMetricIndex(input.factPack);
  const competitiveSeedNames = (input.researchDiscovery?.competitiveSeeds ?? []).map((seed) => seed.company);
  const subjectProfile = buildSubjectPeerProfile({
    factPack: input.factPack,
    understanding: input.understanding,
    evidenceIds: input.evidenceRegistry.items.filter((item) => item.authority === "primary").map((item) => item.id),
    competitiveSeedNames,
  });
  const seedCandidates: PeerProfileInput[] = (input.researchDiscovery?.competitiveSeeds ?? []).map((seed) => ({
    id: seed.company,
    label: seed.company,
    economicSegments: seed.segment ? [seed.segment] : [],
    sourceQuotes: [`research-discovery:${subjectId}`],
    evidenceIds: Object.freeze([]) as readonly string[],
  }));
  const peerDiscovery = await discoverEconomicPeers({
    subjectId,
    subject: {
      id: subjectId,
      label: subjectProfile.label,
      economicSegments: subjectProfile.economicSegments,
      revenueEngines: subjectProfile.revenueEngines,
      operatingKpis: subjectProfile.operatingKpis,
      primaryEconomicAbstraction: subjectProfile.primaryEconomicAbstraction,
      sector: subjectProfile.sector,
      industry: subjectProfile.industry,
      geography: subjectProfile.geography,
      currency: subjectProfile.currency,
      grossMargin: subjectProfile.grossMargin,
      operatingMargin: subjectProfile.operatingMargin,
      netMargin: subjectProfile.netMargin,
      revenueGrowth: subjectProfile.revenueGrowth,
      capexIntensity: subjectProfile.capexIntensity,
      workingCapitalIntensity: subjectProfile.workingCapitalIntensity,
      leverage: subjectProfile.leverage,
      returnOnEquity: subjectProfile.returnOnEquity,
      returnOnAssets: subjectProfile.returnOnAssets,
      marketCap: subjectProfile.marketCap,
      multiples: subjectProfile.multiples,
      competitiveRelationships: subjectProfile.competitiveRelationships,
      evidenceIds: subjectProfile.evidenceIds,
      sourceTiers: subjectProfile.sourceTiers,
      sourceQuotes: subjectProfile.sourceQuotes,
    },
    universe: input.peerUniverse && input.peerUniverse.length > 0 ? input.peerUniverse : seedCandidates.length > 0 ? seedCandidates : null,
    provider: input.peerProvider ?? null,
    generatedAt,
  });
  const normalizedHistory = buildNormalizedHistory({
    factPack: input.factPack,
    subjectId,
    generatedAt,
    evidenceRegistry: input.evidenceRegistry,
  });
  const earningsQuality = assessEarningsQuality({
    factPack: input.factPack,
    subjectId,
    generatedAt,
    oneOffEvidence: oneOffEvidenceFromRetrieval(input.retrieval),
    evidenceIds: primaryEvidenceIds(input.evidenceRegistry),
  });
  const capitalAllocation = buildCapitalAllocationLedger({
    factPack: input.factPack,
    subjectId,
    generatedAt,
    weightedCostOfCapital: null,
    referencePrice: input.factPack.currentPriceMetadata?.value ?? null,
    currentFairValuePerShare: input.valuation && typeof input.valuation.fairValuePerShare === "number" ? input.valuation.fairValuePerShare : null,
    evidenceIds: primaryEvidenceIds(input.evidenceRegistry),
  });
  const extracted = extractManagementPromises(input.retrieval);
  const normalizedPromises = extracted.map((entry) => normalizeManagementPromise(entry.promise, 0));
  const actuals: ManagementActual[] = [];
  for (const promise of normalizedPromises) {
    const resolved = actualFor({ factPack: input.factPack, metric: promise.metric, period: promise.period });
    if (resolved.value === null) continue;
    actuals.push({
      promiseId: promise.id,
      period: promise.period,
      actual: resolved.value,
      source: resolved.source,
      factIds: resolved.factIds,
      evidenceIds: promise.evidenceIds,
    });
  }
  const managementCredibility = buildManagementCredibilityLedger({
    subjectId,
    promises: normalizedPromises,
    actuals,
    generatedAt,
    evidenceIds: input.evidenceRegistry.items.map((item) => item.id),
  });
  const guidancePoints = collectGuidancePoints({
    factPack: input.factPack,
    forecast: input.forecast ?? null,
    promises: normalizedPromises,
    generatedAt,
  });
  const guidanceActuals: GuidanceActualInput[] = [];
  const latestPeriod = historyPeriodLabel(index.periods[index.periods.length - 1] ?? "");
  for (const metric of ["revenue", "ebit", "eps"]) {
    const resolved = actualFor({ factPack: input.factPack, metric, period: "" });
    if (resolved.value === null) continue;
    guidanceActuals.push({ metric, period: latestPeriod, actual: resolved.value, source: resolved.source });
  }
  const guidanceReconciliation = buildGuidanceReconciliation({
    subjectId,
    generatedAt,
    points: guidancePoints,
    actuals: guidanceActuals,
    evidenceIds: input.evidenceRegistry.items.map((item) => item.id),
  });
  const diagnostics = [
    ...peerDiscovery.status === "ready" ? [] : [`PEER_DISCOVERY_${peerDiscovery.status.toUpperCase()}`],
    ...normalizedHistory.status === "ready" ? [] : [`HISTORY_${normalizedHistory.status.toUpperCase()}`],
    ...earningsQuality.status === "ready" ? [] : [`EARNINGS_QUALITY_${earningsQuality.status.toUpperCase()}`],
    ...capitalAllocation.status === "ready" ? [] : [`CAPITAL_ALLOCATION_${capitalAllocation.status.toUpperCase()}`],
    ...managementCredibility.status === "VERIFIED" ? [] : ["MANAGEMENT_CREDIBILITY_UNVERIFIED"],
    ...guidanceReconciliation.status === "ready" ? [] : [`GUIDANCE_${guidanceReconciliation.status.toUpperCase()}`],
  ];
  return {
    version: RESEARCH_ANALYTICS_VERSION,
    subjectId,
    generatedAt,
    peerDiscovery,
    normalizedHistory,
    earningsQuality,
    capitalAllocation,
    managementCredibility,
    guidanceReconciliation,
    diagnostics: [...new Set(diagnostics)].sort(compareStableStrings),
  };
}

function primaryEvidenceIds(registry: CanonicalEvidenceRegistry): readonly string[] {
  return registry.items.filter((item) => item.authority === "primary").map((item) => item.id);
}

type OneOffFieldPattern = { kind: EarningsQualityOneOffEvidence["kind"]; pattern: RegExp; sign: "add-back" | "deduction" | "unknown" };

const ONE_OFF_FIELD_PATTERNS: readonly OneOffFieldPattern[] = [
  { kind: "stockBasedCompensation", pattern: /stock.?based|share.?based|\bsbc\b/i, sign: "add-back" },
  { kind: "impairment", pattern: /impairment|write.?off/i, sign: "add-back" },
  { kind: "restructuring", pattern: /restructur/i, sign: "add-back" },
  { kind: "acquisitionCost", pattern: /acquisition|acquired intangible/i, sign: "unknown" },
  { kind: "assetSale", pattern: /gain on sale|disposal|asset sale/i, sign: "deduction" },
  { kind: "tax", pattern: /\btax\b/i, sign: "unknown" },
  { kind: "workingCapital", pattern: /working capital|change in receivables|change in inventory|change in payables/i, sign: "unknown" },
] as OneOffFieldPattern[];

export function oneOffEvidenceFromRetrieval(retrieval: ResearchRetrievalResult | null | undefined): readonly EarningsQualityOneOffEvidence[] {
  const out: EarningsQualityOneOffEvidence[] = [];
  for (const evidence of retrieval?.evidence ?? []) {
    if (!("value" in evidence) || evidence.status !== "ready") continue;
    if (typeof evidence.value !== "number" || !Number.isFinite(evidence.value)) continue;
    const period = evidence.period ?? evidence.asOf;
    if (!period) continue;
    for (const entry of ONE_OFF_FIELD_PATTERNS) {
      if (!entry.pattern.test(evidence.field)) continue;
      out.push({
        kind: entry.kind,
        period: period.slice(0, 10),
        amount: evidence.value,
        sign: entry.sign,
        label: evidence.field,
        source: evidence.sourceId,
        evidenceIds: [evidence.id],
      });
      break;
    }
  }
  return out.sort((left, right) => left.period.localeCompare(right.period) || left.kind.localeCompare(right.kind) || left.source.localeCompare(right.source));
}
