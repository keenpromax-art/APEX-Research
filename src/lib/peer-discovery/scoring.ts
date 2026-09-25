import { compareStableStrings, stableHash } from "@/lib/research-ledger/stable";
import {
  PEER_DIMENSION_KEYS,
  PEER_DIMENSION_WEIGHTS,
  type PeerCandidateValidation,
  type PeerDimensionKey,
  type PeerEconomicProfile,
  type PeerMatch,
  type PeerSetRole,
  type PeerSimilarityDimension,
} from "./types";

const SCORING_DOMAIN = "peer-discovery/scoring/v1";

const NUMERIC_TOLERANCE: Readonly<Partial<Record<PeerDimensionKey, number>>> = Object.freeze({
  growth: 0.05,
  profitability: 0.05,
  capitalIntensity: 0.04,
  balanceSheet: 0.35,
  scale: 0.6,
});

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function tokens(values: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const value of values) {
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 2) out.add(token);
    }
  }
  return out;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number | null {
  if (left.size === 0 || right.size === 0) return null;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? null : intersection / union;
}

function proximity(left: number, right: number, tolerance: number): number {
  const distance = Math.abs(left - right);
  const scale = Math.max(Math.abs(left), Math.abs(right), tolerance);
  return clamp01(1 - distance / (tolerance * 2 + scale * 0.5));
}

function ratioProximity(left: number, right: number): number {
  if (left === 0 || right === 0) return left === right ? 1 : 0;
  const ratio = Math.max(left, right) / Math.min(Math.abs(left), Math.abs(right));
  return clamp01(1 / ratio);
}

function numericPair(profile: PeerEconomicProfile, key: PeerDimensionKey): [number, number] | null {
  switch (key) {
    case "growth":
      return profile.revenueGrowth === null ? null : [profile.revenueGrowth, 0];
    case "profitability":
      return profile.operatingMargin === null && profile.netMargin === null ? null : [profile.operatingMargin ?? profile.netMargin ?? 0, 0];
    case "capitalIntensity":
      return profile.capexIntensity === null && profile.workingCapitalIntensity === null ? null : [profile.capexIntensity ?? profile.workingCapitalIntensity ?? 0, 0];
    case "balanceSheet":
      return profile.leverage === null ? null : [profile.leverage, 0];
    case "scale":
      return profile.marketCap === null ? null : [profile.marketCap, 0];
    default:
      return null;
  }
}

function textOf(profile: PeerEconomicProfile, key: PeerDimensionKey): string | null {
  switch (key) {
    case "economicSegment":
      return profile.economicSegments.join(" | ") || null;
    case "revenueEngine":
      return profile.revenueEngines.join(" | ") || null;
    case "operatingKpi":
      return profile.operatingKpis.join(" | ") || null;
    case "geography":
      return profile.geography;
    case "valuation": {
      const entries = (Object.keys(profile.multiples) as Array<keyof typeof profile.multiples>)
        .filter((multiple) => profile.multiples[multiple] !== null)
        .map((multiple) => `${multiple}=${profile.multiples[multiple]}`);
      return entries.length > 0 ? entries.join(" ") : null;
    }
    default:
      return null;
  }
}

function listOf(profile: PeerEconomicProfile, key: PeerDimensionKey): readonly string[] {
  switch (key) {
    case "economicSegment":
      return profile.economicSegments;
    case "revenueEngine":
      return profile.revenueEngines;
    case "operatingKpi":
      return profile.operatingKpis;
    default:
      return Object.freeze([]) as readonly string[];
  }
}

function numericField(profile: PeerEconomicProfile, key: PeerDimensionKey): number | null {
  const pair = numericPair(profile, key);
  return pair ? pair[0] : null;
}

function compareDimension(subject: PeerEconomicProfile, peer: PeerEconomicProfile, key: PeerDimensionKey): PeerSimilarityDimension {
  const weight = PEER_DIMENSION_WEIGHTS[key];
  const evidenceIds = [...new Set([...subject.evidenceIds, ...peer.evidenceIds])].sort(compareStableStrings);
  const listDimensions: PeerDimensionKey[] = ["economicSegment", "revenueEngine", "operatingKpi"];
  if (listDimensions.includes(key)) {
    const subjectList = listOf(subject, key);
    const peerList = listOf(peer, key);
    if (subjectList.length === 0 || peerList.length === 0) {
      return {
        key,
        weight,
        score: null,
        comparable: false,
        subjectValue: subjectList.join(" | ") || null,
        peerValue: peerList.join(" | ") || null,
        explanation: `${key} is not disclosed on both sides, so it is excluded from the weighted score rather than scored as a mismatch`,
        evidenceIds,
      };
    }
    const score = round6(jaccard(tokens(subjectList), tokens(peerList)) ?? 0);
    return {
      key,
      weight,
      score,
      comparable: true,
      subjectValue: subjectList.join(" | "),
      peerValue: peerList.join(" | "),
      explanation: `${score === 1 ? "identical" : `${Math.round(score * 100)}% token overlap`} on ${key} (${subjectList.length} vs ${peerList.length} entries)`,
      evidenceIds,
    };
  }
  if (key === "geography") {
    if (!subject.geography || !peer.geography) {
      return {
        key,
        weight,
        score: null,
        comparable: false,
        subjectValue: subject.geography,
        peerValue: peer.geography,
        explanation: "geography is undisclosed on at least one side, so it is excluded from the weighted score",
        evidenceIds,
      };
    }
    const equal = subject.geography.toLowerCase() === peer.geography.toLowerCase();
    return {
      key,
      weight,
      score: equal ? 1 : 0.35,
      comparable: true,
      subjectValue: subject.geography,
      peerValue: peer.geography,
      explanation: equal ? `same reporting geography (${subject.geography})` : `different geography (${subject.geography} vs ${peer.geography}); comparability discounted`,
      evidenceIds,
    };
  }
  if (key === "valuation") {
    const subjectMultiples = (Object.keys(subject.multiples) as Array<keyof typeof subject.multiples>).filter((key2) => subject.multiples[key2] !== null);
    const peerMultiples = (Object.keys(peer.multiples) as Array<keyof typeof peer.multiples>).filter((key2) => peer.multiples[key2] !== null);
    const shared = subjectMultiples.filter((key2) => peerMultiples.includes(key2));
    if (shared.length === 0) {
      return {
        key,
        weight,
        score: null,
        comparable: false,
        subjectValue: textOf(subject, key),
        peerValue: textOf(peer, key),
        explanation: "no shared valuation multiple is on record, so the valuation dimension is excluded",
        evidenceIds,
      };
    }
    const ratios = shared.map((key2) => ratioProximity(subject.multiples[key2] as number, peer.multiples[key2] as number));
    const score = round6(ratios.reduce((sum, value) => sum + value, 0) / ratios.length);
    return {
      key,
      weight,
      score,
      comparable: true,
      subjectValue: textOf(subject, key),
      peerValue: textOf(peer, key),
      explanation: `valuation multiple proximity across ${shared.join(", ")} (${Math.round(score * 100)}% similarity)`,
      evidenceIds,
    };
  }
  const subjectValue = numericField(subject, key);
  const peerValue = numericField(peer, key);
  if (subjectValue === null || peerValue === null) {
    return {
      key,
      weight,
      score: null,
      comparable: false,
      subjectValue: subjectValue === null ? null : String(round6(subjectValue)),
      peerValue: peerValue === null ? null : String(round6(peerValue)),
      explanation: `${key} is not measurable on both sides, so it is excluded from the weighted score rather than scored as a mismatch`,
      evidenceIds,
    };
  }
  if (key === "scale") {
    const score = round6(ratioProximity(subjectValue, peerValue));
    return {
      key,
      weight,
      score,
      comparable: true,
      subjectValue: String(round6(subjectValue)),
      peerValue: String(round6(peerValue)),
      explanation: `scale ratio ${round6(Math.max(subjectValue, peerValue) / Math.max(1e-9, Math.min(Math.abs(subjectValue), Math.abs(peerValue))))}x (${Math.round(score * 100)}% similarity)`,
      evidenceIds,
    };
  }
  const tolerance = NUMERIC_TOLERANCE[key] ?? 0.05;
  const score = round6(proximity(subjectValue, peerValue, tolerance));
  return {
    key,
    weight,
    score,
    comparable: true,
    subjectValue: String(round6(subjectValue)),
    peerValue: String(round6(peerValue)),
    explanation: `${key} gap ${round6(Math.abs(subjectValue - peerValue))} against a ${tolerance} tolerance band (${Math.round(score * 100)}% similarity)`,
    evidenceIds,
  };
}

export function validatePeerCandidate(profile: PeerEconomicProfile, requireValidation: boolean): PeerCandidateValidation {
  const reasons: string[] = [];
  let status: PeerCandidateValidation["status"] = "validated";
  if (profile.status === "empty") {
    status = "rejected";
    reasons.push("candidate exposes no economically comparable attribute");
  } else if (profile.status === "partial") {
    status = "unverified";
    reasons.push(`only ${profile.comparableDimensions} comparable attributes are on record`);
  }
  if (profile.sourceQuotes.length === 0) {
    if (status === "validated") status = "unverified";
    reasons.push("no source metadata or quote backs the candidate profile");
  }
  if (profile.evidenceIds.length === 0) {
    if (status === "validated") status = "unverified";
    reasons.push("no evidence identifier is attached to the candidate profile");
  }
  if (profile.diagnostics.includes("PEER_SEGMENTS_UNKNOWN")) {
    if (status === "validated") status = "unverified";
    reasons.push("economic segments are undisclosed for the candidate");
  }
  if (requireValidation && status !== "validated") {
    status = "rejected";
    reasons.push("validation is mandatory for this run and the candidate could not be validated");
  }
  return {
    status,
    reasons,
    sourceTiers: profile.sourceTiers,
    sourceQuoteCount: profile.sourceQuotes.length,
    evidenceIdCount: profile.evidenceIds.length,
    evidenceIds: profile.evidenceIds,
  };
}

export function scorePeerMatch(input: {
  readonly subject: PeerEconomicProfile;
  readonly peer: PeerEconomicProfile;
  readonly role: PeerSetRole;
  readonly requireValidation?: boolean;
}): PeerMatch {
  const dimensions = PEER_DIMENSION_KEYS.map((key) => compareDimension(input.subject, input.peer, key));
  const comparable = dimensions.filter((entry) => entry.comparable && entry.score !== null);
  const comparableWeight = round6(comparable.reduce((sum, entry) => sum + entry.weight, 0));
  const totalWeight = round6(dimensions.reduce((sum, entry) => sum + entry.weight, 0));
  const weighted = comparable.reduce((sum, entry) => sum + (entry.score as number) * entry.weight, 0);
  const score = comparableWeight > 0 ? round6(clamp01(weighted / comparableWeight)) : 0;
  const coverage = totalWeight > 0 ? round6(comparableWeight / totalWeight) : 0;
  const validation = validatePeerCandidate(input.peer, input.requireValidation === true);
  const explanations = dimensions
    .filter((entry) => entry.comparable)
    .sort((left, right) => right.weight - left.weight || compareStableStrings(left.key, right.key))
    .slice(0, 4)
    .map((entry) => `${entry.key}: ${entry.explanation}`);
  if (comparable.length === 0) explanations.unshift("no economic dimension is measurable on both sides; this candidate cannot be scored as a peer");
  if (validation.reasons.length > 0) explanations.push(...validation.reasons.map((reason) => `validation: ${reason}`));
  const idInput = { subject: input.subject.id, peer: input.peer.id, role: input.role, score, comparableWeight };
  return {
    id: `PEERMATCH-${stableHash(idInput, SCORING_DOMAIN).slice(0, 16).toUpperCase()}`,
    peerId: input.peer.id,
    label: input.peer.label,
    role: input.role,
    score,
    similarity: Math.round(score * 100),
    comparableWeight,
    totalWeight,
    coverage,
    dimensions,
    explanations,
    evidenceIds: [...new Set([...input.peer.evidenceIds, ...input.subject.evidenceIds])].sort(compareStableStrings),
    validation,
  };
}
