import type { FingerprintSet } from "./fingerprints";
import { compareFingerprintSets } from "./fingerprints";

export const ORIGINALITY_VERSION = "report-originality-v1";
export const ORIGINALITY_COLLISION_THRESHOLD = 0.92;
export const ORIGINALITY_WATCH_THRESHOLD = 0.78;

export type OriginalityStatus = "clear" | "watch" | "collision";

export interface OriginalityComparison {
  ticker: string;
  combined: string;
  overall: number;
  content: number;
  analytical: number;
  section: number;
  approved: boolean;
}

export interface OriginalityReport {
  version: typeof ORIGINALITY_VERSION;
  ticker: string;
  generatedAt: string;
  fingerprints: FingerprintSet;
  comparisons: number;
  maximumSimilarity: number;
  averageSimilarity: number;
  status: OriginalityStatus;
  reasons: string[];
  peerMentionsAllowed: string[];
}

export interface CollisionInput {
  ticker: string;
  fingerprints: FingerprintSet;
  priors: Array<{ ticker: string; fingerprints: FingerprintSet }>;
  generatedAt: string;
  peerTickers?: string[];
  approvedFingerprints?: string[];
}

export function detectOriginalityCollision(input: CollisionInput): OriginalityReport {
  const peers = [...(input.peerTickers ?? [])].map((t) => t.trim().toUpperCase()).filter(Boolean).sort();
  const approved = new Set(input.approvedFingerprints ?? []);
  const others = input.priors.filter((prior) => prior.ticker.toUpperCase() !== input.ticker.toUpperCase());
  if (others.length === 0) {
    return {
      version: ORIGINALITY_VERSION,
      ticker: input.ticker,
      generatedAt: input.generatedAt,
      fingerprints: input.fingerprints,
      comparisons: 0,
      maximumSimilarity: 0,
      averageSimilarity: 0,
      status: "clear",
      reasons: ["No comparable prior company reports were supplied."],
      peerMentionsAllowed: peers,
    };
  }
  const scored = others.map((prior) => {
    const detail = compareFingerprintSets(input.fingerprints, prior.fingerprints);
    return { prior, detail };
  });
  const overalls = scored.map((entry) => entry.detail.overall);
  const maximumSimilarity = Math.max(...overalls);
  const averageSimilarity = Math.round((overalls.reduce((sum, value) => sum + value, 0) / overalls.length) * 1000) / 1000;
  const worst = scored.find((entry) => entry.detail.overall === maximumSimilarity);
  const worstApproved = worst ? approved.has(worst.prior.fingerprints.combined) : false;
  let status: OriginalityStatus = "clear";
  if (maximumSimilarity >= ORIGINALITY_COLLISION_THRESHOLD && !worstApproved) status = "collision";
  else if (maximumSimilarity >= ORIGINALITY_WATCH_THRESHOLD && !worstApproved) status = "watch";
  const reasons: string[] = [];
  if (status === "collision") reasons.push(`Cross-company similarity ${maximumSimilarity} exceeds the ${ORIGINALITY_COLLISION_THRESHOLD} collision threshold.`);
  else if (status === "watch") reasons.push(`Cross-company similarity ${maximumSimilarity} is elevated; verify shared structure is research-driven.`);
  else reasons.push(`Maximum cross-company similarity ${maximumSimilarity} is below the watch threshold.`);
  if (worst) reasons.push(`Closest prior report: ${worst.prior.ticker} (${worst.prior.fingerprints.combined.slice(0, 12)}).`);
  if (peers.length > 0) reasons.push(`Legitimate peer mentions allowed for: ${peers.join(", ")}.`);
  if (worstApproved) reasons.push("Closest similarity is explicitly approved and does not block publication.");
  return {
    version: ORIGINALITY_VERSION,
    ticker: input.ticker,
    generatedAt: input.generatedAt,
    fingerprints: input.fingerprints,
    comparisons: others.length,
    maximumSimilarity: Math.round(maximumSimilarity * 1000) / 1000,
    averageSimilarity,
    status,
    reasons,
    peerMentionsAllowed: peers,
  };
}

export function isOriginalityBlocking(report: OriginalityReport): boolean {
  return report.status === "collision";
}
