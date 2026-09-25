export const PEER_DISCOVERY_VERSION = "peer-discovery-v1" as const;

export type PeerDiscoveryStatus = "ready" | "insufficient" | "unavailable";
export type PeerProviderStatus = "available" | "unavailable";
export type PeerSetRole = "operating" | "valuation" | "competitive" | "benchmark";
export type PeerProfileStatus = "complete" | "partial" | "empty";
export type PeerValidationStatus = "validated" | "unverified" | "rejected";
export type PeerSetStatus = "ready" | "insufficient";

export const PEER_SET_ROLES: readonly PeerSetRole[] = Object.freeze(["operating", "valuation", "competitive", "benchmark"] as const);

export const PEER_DIMENSION_KEYS = Object.freeze([
  "economicSegment",
  "revenueEngine",
  "operatingKpi",
  "profitability",
  "growth",
  "capitalIntensity",
  "balanceSheet",
  "geography",
  "valuation",
  "scale",
] as const);

export type PeerDimensionKey = (typeof PEER_DIMENSION_KEYS)[number];

export const PEER_DIMENSION_WEIGHTS: Readonly<Record<PeerDimensionKey, number>> = Object.freeze({
  economicSegment: 0.22,
  revenueEngine: 0.14,
  operatingKpi: 0.1,
  profitability: 0.12,
  growth: 0.1,
  capitalIntensity: 0.1,
  balanceSheet: 0.08,
  geography: 0.05,
  valuation: 0.05,
  scale: 0.04,
});

export type PeerValuationMultiples = Readonly<Record<"pe" | "evEbitda" | "evSales" | "priceToBook", number | null>>;

export interface PeerEconomicProfile {
  readonly id: string;
  readonly label: string;
  readonly status: PeerProfileStatus;
  readonly economicSegments: readonly string[];
  readonly revenueEngines: readonly string[];
  readonly operatingKpis: readonly string[];
  readonly primaryEconomicAbstraction: string | null;
  readonly sector: string | null;
  readonly industry: string | null;
  readonly geography: string | null;
  readonly currency: string | null;
  readonly grossMargin: number | null;
  readonly operatingMargin: number | null;
  readonly netMargin: number | null;
  readonly revenueGrowth: number | null;
  readonly capexIntensity: number | null;
  readonly workingCapitalIntensity: number | null;
  readonly leverage: number | null;
  readonly returnOnEquity: number | null;
  readonly returnOnAssets: number | null;
  readonly marketCap: number | null;
  readonly multiples: PeerValuationMultiples;
  readonly competitiveRelationships: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly sourceTiers: readonly string[];
  readonly sourceQuotes: readonly string[];
  readonly comparableDimensions: number;
  readonly diagnostics: readonly string[];
}

export interface PeerProfileInput {
  readonly id: string;
  readonly label?: string;
  readonly economicSegments?: readonly string[];
  readonly revenueEngines?: readonly string[];
  readonly operatingKpis?: readonly string[];
  readonly primaryEconomicAbstraction?: string | null;
  readonly sector?: string | null;
  readonly industry?: string | null;
  readonly geography?: string | null;
  readonly currency?: string | null;
  readonly grossMargin?: number | null;
  readonly operatingMargin?: number | null;
  readonly netMargin?: number | null;
  readonly revenueGrowth?: number | null;
  readonly capexIntensity?: number | null;
  readonly workingCapitalIntensity?: number | null;
  readonly leverage?: number | null;
  readonly returnOnEquity?: number | null;
  readonly returnOnAssets?: number | null;
  readonly marketCap?: number | null;
  readonly multiples?: PeerValuationMultiples;
  readonly competitiveRelationships?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly sourceTiers?: readonly string[];
  readonly sourceQuotes?: readonly string[];
}

export interface PeerSimilarityDimension {
  readonly key: PeerDimensionKey;
  readonly weight: number;
  readonly score: number | null;
  readonly comparable: boolean;
  readonly subjectValue: string | null;
  readonly peerValue: string | null;
  readonly explanation: string;
  readonly evidenceIds: readonly string[];
}

export interface PeerCandidateValidation {
  readonly status: PeerValidationStatus;
  readonly reasons: readonly string[];
  readonly sourceTiers: readonly string[];
  readonly sourceQuoteCount: number;
  readonly evidenceIdCount: number;
  readonly evidenceIds: readonly string[];
}

export interface PeerMatch {
  readonly id: string;
  readonly peerId: string;
  readonly label: string;
  readonly role: PeerSetRole;
  readonly score: number;
  readonly similarity: number;
  readonly comparableWeight: number;
  readonly totalWeight: number;
  readonly coverage: number;
  readonly dimensions: readonly PeerSimilarityDimension[];
  readonly explanations: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly validation: PeerCandidateValidation;
}

export interface PeerExclusion {
  readonly peerId: string;
  readonly label: string;
  readonly role: PeerSetRole;
  readonly reason: string;
  readonly detail: string;
}

export interface PeerSet {
  readonly role: PeerSetRole;
  readonly status: PeerSetStatus;
  readonly minimumSize: number;
  readonly matches: readonly PeerMatch[];
  readonly exclusions: readonly PeerExclusion[];
  readonly note: string;
}

export interface PeerDiscoveryResult {
  readonly version: typeof PEER_DISCOVERY_VERSION;
  readonly subjectId: string;
  readonly status: PeerDiscoveryStatus;
  readonly reason: string;
  readonly generatedAt: string;
  readonly providerId: string | null;
  readonly providerStatus: PeerProviderStatus;
  readonly candidateCount: number;
  readonly scoredCount: number;
  readonly validatedCount: number;
  readonly minimumSetSize: number;
  readonly subjectProfile: PeerEconomicProfile;
  readonly peerSets: Readonly<Record<PeerSetRole, PeerSet>>;
  readonly diagnostics: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly contentHash: string;
}

export interface PeerCandidateProvider {
  readonly id: string;
  readonly list?: () => Promise<readonly PeerProfileInput[]> | readonly PeerProfileInput[];
  readonly get?: (id: string) => Promise<PeerProfileInput | null> | PeerProfileInput | null;
}

export interface DiscoverEconomicPeersInput {
  readonly subjectId: string;
  readonly subject: PeerProfileInput;
  readonly universe?: readonly PeerProfileInput[] | null;
  readonly provider?: PeerCandidateProvider | null;
  readonly generatedAt?: string;
  readonly minimumSetSize?: number;
  readonly maximumPeersPerSet?: number;
  readonly minimumComparableWeight?: number;
  readonly minimumSimilarity?: number;
  readonly requireValidation?: boolean;
  readonly subjectEvidenceIds?: readonly string[];
}
