import { compareStableStrings, stableHash } from "@/lib/research-ledger/stable";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import { buildPeerEconomicProfile } from "./profile";
import { scorePeerMatch } from "./scoring";
import {
  PEER_DISCOVERY_VERSION,
  PEER_SET_ROLES,
  type DiscoverEconomicPeersInput,
  type PeerCandidateProvider,
  type PeerDiscoveryResult,
  type PeerDiscoveryStatus,
  type PeerEconomicProfile,
  type PeerExclusion,
  type PeerMatch,
  type PeerProfileInput,
  type PeerSet,
  type PeerSetRole,
} from "./types";

const DISCOVERY_DOMAIN = "peer-discovery/discovery/v1";
const BENCHMARK_SCALE_RATIO_LIMIT = 3;
const DEFAULT_MINIMUM_SET_SIZE = 2;
const DEFAULT_MAXIMUM_PEERS_PER_SET = 6;
const DEFAULT_MINIMUM_COMPARABLE_WEIGHT = 0.45;
const DEFAULT_MINIMUM_SIMILARITY = 0.4;

const OPERATING_DIMENSIONS: readonly string[] = ["economicSegment", "revenueEngine", "operatingKpi", "profitability", "growth", "capitalIntensity", "balanceSheet"];
const VALUATION_DIMENSIONS: readonly string[] = ["valuation", "profitability", "growth", "scale"];
const BENCHMARK_DIMENSIONS: readonly string[] = ["geography", "scale", "growth", "profitability"];

function emptySet(role: PeerSetRole, minimumSize: number, note: string): PeerSet {
  return {
    role,
    status: "insufficient",
    minimumSize,
    matches: Object.freeze([]) as readonly PeerMatch[],
    exclusions: Object.freeze([]) as readonly PeerExclusion[],
    note,
  };
}

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}
void emptySet;

function dimensionScore(match: PeerMatch, keys: readonly string[]): number {
  const entries = match.dimensions.filter((entry) => keys.includes(entry.key) && entry.score !== null);
  if (entries.length === 0) return 0;
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return 0;
  return Number((entries.reduce((sum, entry) => sum + (entry.score as number) * entry.weight, 0) / total).toFixed(6));
}

function isSubjectRelated(subject: PeerEconomicProfile, profile: PeerEconomicProfile): boolean {
  if (subject.competitiveRelationships.includes(profile.id)) return true;
  return profile.competitiveRelationships.includes(subject.id);
}

async function resolveUniverse(input: DiscoverEconomicPeersInput): Promise<{
  candidates: PeerProfileInput[];
  providerId: string | null;
  providerStatus: PeerDiscoveryResult["providerStatus"];
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  if (Array.isArray(input.universe) && input.universe.length > 0) {
    return { candidates: [...input.universe], providerId: "injected-universe", providerStatus: "available", diagnostics };
  }
  const provider: PeerCandidateProvider | null = input.provider ?? null;
  if (!provider) {
    diagnostics.push("PEER_PROVIDER_UNAVAILABLE");
    return { candidates: [], providerId: null, providerStatus: "unavailable", diagnostics };
  }
  if (typeof provider.list !== "function") {
    diagnostics.push("PEER_PROVIDER_HAS_NO_CATALOGUE");
    return { candidates: [], providerId: provider.id, providerStatus: "unavailable", diagnostics };
  }
  try {
    const listed = await provider.list();
    const candidates = Array.isArray(listed) ? [...listed] : [];
    if (candidates.length === 0) diagnostics.push("PEER_PROVIDER_RETURNED_EMPTY_CATALOGUE");
    return { candidates, providerId: provider.id, providerStatus: "available", diagnostics };
  } catch (error) {
    diagnostics.push(`PEER_PROVIDER_FAILED:${error instanceof Error ? error.message : "unknown"}`);
    return { candidates: [], providerId: provider.id, providerStatus: "unavailable", diagnostics };
  }
}

export async function discoverEconomicPeers(input: DiscoverEconomicPeersInput): Promise<PeerDiscoveryResult> {
  const subjectId = String(input.subjectId ?? input.subject?.id ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const subject = buildPeerEconomicProfile({
    ...input.subject,
    id: input.subject?.id ? subjectId : subjectId,
    evidenceIds: [...new Set([...(input.subject?.evidenceIds ?? []), ...(input.subjectEvidenceIds ?? [])])].sort(compareStableStrings),
  });
  const minimumSetSize = Math.max(1, Math.trunc(input.minimumSetSize ?? DEFAULT_MINIMUM_SET_SIZE));
  const maximumPeers = Math.max(1, Math.trunc(input.maximumPeersPerSet ?? DEFAULT_MAXIMUM_PEERS_PER_SET));
  const minimumComparableWeight = input.minimumComparableWeight ?? DEFAULT_MINIMUM_COMPARABLE_WEIGHT;
  const minimumSimilarity = input.minimumSimilarity ?? DEFAULT_MINIMUM_SIMILARITY;
  const requireValidation = input.requireValidation === true;
  const generatedAt = input.generatedAt ?? "unknown";
  const resolved = await resolveUniverse({ ...input, subjectId });
  const diagnostics: string[] = [...resolved.diagnostics, ...subject.diagnostics];
  const candidates = resolved.candidates
    .filter((candidate) => String(candidate?.id ?? "").trim().toUpperCase() !== subjectId)
    .map((candidate) => buildPeerEconomicProfile(candidate));
  diagnostics.push(...candidates.flatMap((candidate) => candidate.diagnostics.map((entry) => `${candidate.id}:${entry}`)));
  const matchesByRole = new Map<PeerSetRole, PeerMatch[]>();
  for (const role of PEER_SET_ROLES) matchesByRole.set(role, []);
  const exclusionsByRole = new Map<PeerSetRole, PeerExclusion[]>();
  for (const role of PEER_SET_ROLES) exclusionsByRole.set(role, []);
  let scoredCount = 0;
  let validatedCount = 0;
  for (const candidate of candidates) {
    const operating = scorePeerMatch({ subject, peer: candidate, role: "operating", requireValidation });
    const valuation = scorePeerMatch({ subject, peer: candidate, role: "valuation", requireValidation });
    const competitive = scorePeerMatch({ subject, peer: candidate, role: "competitive", requireValidation });
    const benchmark = scorePeerMatch({ subject, peer: candidate, role: "benchmark", requireValidation });
    const roleMatches: Array<[PeerSetRole, PeerMatch, readonly string[]]> = [
      ["operating", operating, OPERATING_DIMENSIONS],
      ["valuation", valuation, VALUATION_DIMENSIONS],
      ["competitive", competitive, OPERATING_DIMENSIONS],
      ["benchmark", benchmark, BENCHMARK_DIMENSIONS],
    ];
    for (const [role, match, dimensionKeys] of roleMatches) {
      const relevant = dimensionScore(match, dimensionKeys);
      const exclusion = exclusionFor(role, candidate, match, relevant, subject, minimumComparableWeight, minimumSimilarity, requireValidation, diagnostics);
      if (exclusion) {
        (exclusionsByRole.get(role) as PeerExclusion[]).push(exclusion);
        continue;
      }
      (matchesByRole.get(role) as PeerMatch[]).push(match);
      if (match.validation.status === "validated") validatedCount += 1;
    }
    if (operating.comparableWeight > 0) scoredCount += 1;
  }
  const peerSets = Object.fromEntries(PEER_SET_ROLES.map((role) => {    const competitive = role === "competitive";
    const all = matchesByRole.get(role) ?? [];
    const filtered = all
      .filter((match) => (competitive ? isSubjectRelated(subject, candidateFor(candidates, match.peerId)) || match.score >= minimumSimilarity : true))
      .sort((left, right) => right.score - left.score || left.peerId.localeCompare(right.peerId))
      .slice(0, maximumPeers);
    const matchedIds = new Set(filtered.map((match) => match.peerId));
    const dropped = (exclusionsByRole.get(role) ?? []).filter((entry) => !matchedIds.has(entry.peerId));
    const status = filtered.length >= minimumSetSize ? "ready" : "insufficient";
    const note = status === "ready"
      ? `${filtered.length} ${role} peer(s) cleared the economic similarity gate`
      : filtered.length === 0
        ? `no ${role} peer cleared the economic similarity gate; ${role} comparisons stay unavailable`
        : `only ${filtered.length} ${role} peer(s) cleared the gate against a minimum of ${minimumSetSize}; the set is disclosed as insufficient`;
    return [role, { role, status, minimumSize: minimumSetSize, matches: filtered, exclusions: dropped.sort((left, right) => left.peerId.localeCompare(right.peerId)), note } satisfies PeerSet];
  })) as unknown as Record<PeerSetRole, PeerSet>;
  const readySets = PEER_SET_ROLES.filter((role) => peerSets[role].status === "ready");
  let status: PeerDiscoveryStatus = "ready";
  let reason = `${readySets.length} peer set(s) are economically evidenced`;
  if (resolved.providerStatus === "unavailable") {
    status = "unavailable";
    reason = "no candidate universe provider is configured, so no peer is asserted; relative comparison stays unavailable";
  } else if (candidates.length === 0) {
    status = "unavailable";
    reason = "the candidate universe is empty, so no peer is asserted; relative comparison stays unavailable";
  } else if (subject.comparableDimensions < 3) {
    status = "insufficient";
    reason = `the subject profile exposes only ${subject.comparableDimensions} comparable attribute(s); economic peer discovery is insufficient rather than fabricated`;
  } else if (readySets.length === 0) {
    status = "insufficient";
    reason = `${candidates.length} candidate(s) were evaluated and none cleared the economic similarity gate for any set role`;
  } else if (readySets.length < 2) {
    status = "insufficient";
    reason = `only the ${readySets.join(", ")} peer set(s) are evidenced; the remaining set roles stay explicitly unavailable`;
  }
  if (status !== "ready") diagnostics.push(`PEER_DISCOVERY_${status.toUpperCase()}`);
  const content = {
    version: PEER_DISCOVERY_VERSION,
    subjectId,
    status,
    reason,
    generatedAt,
    providerId: resolved.providerId,
    providerStatus: resolved.providerStatus,
    candidateCount: candidates.length,
    scoredCount,
    validatedCount,
    minimumSetSize,
    subjectProfile: subject,
    peerSets,
    diagnostics: [...new Set(diagnostics)].sort(compareStableStrings),
    evidenceIds: [...new Set([...subject.evidenceIds, ...candidates.flatMap((candidate) => candidate.evidenceIds)])].sort(compareStableStrings),
  } satisfies Omit<PeerDiscoveryResult, "contentHash">;
  return deepFreeze({ ...content, contentHash: stableHash(content, DISCOVERY_DOMAIN) }) as PeerDiscoveryResult;
}

function candidateFor(candidates: readonly PeerEconomicProfile[], peerId: string): PeerEconomicProfile {
  return candidates.find((candidate) => candidate.id === peerId) ?? {
    id: peerId,
    label: peerId,
    status: "empty",
    economicSegments: Object.freeze([]) as readonly string[],
    revenueEngines: Object.freeze([]) as readonly string[],
    operatingKpis: Object.freeze([]) as readonly string[],
    primaryEconomicAbstraction: null,
    sector: null,
    industry: null,
    geography: null,
    currency: null,
    grossMargin: null,
    operatingMargin: null,
    netMargin: null,
    revenueGrowth: null,
    capexIntensity: null,
    workingCapitalIntensity: null,
    leverage: null,
    returnOnEquity: null,
    returnOnAssets: null,
    marketCap: null,
    multiples: { pe: null, evEbitda: null, evSales: null, priceToBook: null },
    competitiveRelationships: Object.freeze([]) as readonly string[],
    evidenceIds: Object.freeze([]) as readonly string[],
    sourceTiers: Object.freeze([]) as readonly string[],
    sourceQuotes: Object.freeze([]) as readonly string[],
    comparableDimensions: 0,
    diagnostics: Object.freeze([]) as readonly string[],
  };
}

function exclusionFor(
  role: PeerSetRole,
  candidate: PeerEconomicProfile,
  match: PeerMatch,
  relevantScore: number,
  subject: PeerEconomicProfile,
  minimumComparableWeight: number,
  minimumSimilarity: number,
  requireValidation: boolean,
  diagnostics: string[],
): PeerExclusion | null {
  if (match.comparableWeight < minimumComparableWeight) {
    diagnostics.push(`PEER_INSUFFICIENT_COMPARABLE_WEIGHT:${candidate.id}:${role}`);
    return {
      peerId: candidate.id,
      label: candidate.label,
      role,
      reason: "insufficient-comparable-dimensions",
      detail: `only ${Math.round(match.coverage * 100)}% of the weighted economic dimensions are measurable against the subject (${match.comparableWeight} of ${match.totalWeight})`,
    };
  }
  if (match.validation.status === "rejected" || (requireValidation && match.validation.status !== "validated")) {
    diagnostics.push(`PEER_REJECTED:${candidate.id}:${role}`);
    return {
      peerId: candidate.id,
      label: candidate.label,
      role,
      reason: "failed-candidate-validation",
      detail: match.validation.reasons.join("; ") || "candidate could not be validated through source metadata or quotes",
    };
  }
  if (relevantScore < minimumSimilarity) {
    diagnostics.push(`PEER_BELOW_SIMILARITY:${candidate.id}:${role}`);
    return {
      peerId: candidate.id,
      label: candidate.label,
      role,
      reason: "below-similarity-threshold",
      detail: `${role} similarity ${Math.round(relevantScore * 100)}% is below the ${Math.round(minimumSimilarity * 100)}% gate; the candidate is economically distinct from the subject on the dimensions that matter for this set`,
    };
  }
  if (role === "benchmark" && candidate.status !== "empty") {
    const sameGeography = subject.geography !== null && candidate.geography !== null && subject.geography.toLowerCase() === candidate.geography.toLowerCase();
    const sameSector = subject.sector !== null && candidate.sector !== null && subject.sector.toLowerCase() === candidate.sector.toLowerCase();
    const scaleRatio = subject.marketCap !== null && candidate.marketCap !== null && subject.marketCap > 0 && candidate.marketCap > 0
      ? Math.max(subject.marketCap, candidate.marketCap) / Math.min(subject.marketCap, candidate.marketCap)
      : null;
    const crossSector = subject.sector !== null && candidate.sector !== null && !sameSector;
    const crossMarketOutOfScale = !sameGeography && !sameSector && scaleRatio !== null && scaleRatio > BENCHMARK_SCALE_RATIO_LIMIT;
    if (crossSector || crossMarketOutOfScale) {
      diagnostics.push(`PEER_NOT_A_BROAD_REFERENCE:${candidate.id}`);
      return {
        peerId: candidate.id,
        label: candidate.label,
        role,
        reason: "not-a-broad-reference",
        detail: `a benchmark must be a same-sector reference or a same-market reference of comparable scale; "${candidate.sector ?? "undisclosed sector"}" against "${subject.sector ?? "undisclosed sector"}"${scaleRatio === null ? "" : ` at a ${round6(scaleRatio)}x scale gap`} fails that anchor`,
      };
    }
  }
  if (role !== "benchmark" && candidate.economicSegments.length > 0 && subject.economicSegments.length > 0) {
    const subjectTokens = new Set(subject.economicSegments.flatMap((segment) => segment.toLowerCase().split(/[^a-z0-9]+/)).filter((token) => token.length > 2));
    const peerTokens = candidate.economicSegments.flatMap((segment) => segment.toLowerCase().split(/[^a-z0-9]+/)).filter((token) => token.length > 2);
    const overlap = peerTokens.filter((token) => subjectTokens.has(token)).length;
    if (overlap === 0) {
      diagnostics.push(`PEER_CONTAMINATION_GUARD:${candidate.id}:${role}`);
      return {
        peerId: candidate.id,
        label: candidate.label,
        role,
        reason: "no-economic-segment-overlap",
        detail: `disclosed segments "${candidate.economicSegments.join(", ")}" share no economic unit with the subject's "${subject.economicSegments.join(", ")}"; a shared ticker list must not promote this into a ${role} peer set`,
      };
    }
  }
  return null;
}

export const discoverPeers = discoverEconomicPeers;
export const buildPeerDiscovery = discoverEconomicPeers;
