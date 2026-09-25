import { stableHash } from "@/lib/research-ledger/stable";
import type { CanonicalResearchPackage } from "@/lib/research-package/types";
import type { ReportPlan } from "@/lib/report-plan/types";
import type { ChartSpec, TableSpec } from "@/lib/report-charts/builder";
import type { ResearchDNA } from "@/lib/research-identity";

export const FINGERPRINT_VERSION = "report-fingerprint-v1";
export const FINGERPRINT_DOMAIN = "report-originality/fingerprint/v1";

export interface FingerprintSet {
  version: typeof FINGERPRINT_VERSION;
  ticker: string;
  content: string;
  analytical: string;
  section: string;
  chart: string;
  table: string;
  visual: string;
  narrative: string;
  combined: string;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripPeerMentions(text: string, peerTickers: string[]): string {
  let out = ` ${text} `;
  for (const peer of peerTickers) {
    const token = peer.trim().toUpperCase();
    if (!token) continue;
    const pattern = new RegExp(`\\b${token.replace(/[^A-Z0-9]/g, "")}\\b`, "g");
    void pattern;
    out = out.split(token).join(" PEER ");
    out = out.split(token.toLowerCase()).join(" peer ");
  }
  return out;
}

export interface FingerprintInput {
  packageValue: CanonicalResearchPackage;
  plan: ReportPlan;
  charts: ChartSpec[];
  tables: TableSpec[];
  identity?: ResearchDNA | null;
  peerTickers?: string[];
}

export function computeReportFingerprints(input: FingerprintInput): FingerprintSet {
  const ticker = input.packageValue.ticker;
  const thesis = String((input.packageValue.researchReport as unknown as Record<string, unknown> | undefined)?.thesis ? JSON.stringify((input.packageValue.researchReport as unknown as Record<string, unknown>).thesis) : "");
  const conclusion = String((input.packageValue.researchReport as unknown as Record<string, unknown> | undefined)?.conclusion ?? "");
  const peerTickers = [...(input.peerTickers ?? [])].map((t) => t.toUpperCase()).sort();
  const contentBase = normalizeText(stripPeerMentions(`${thesis} ${conclusion}`, peerTickers));
  const content = stableHash({ kind: "content", text: contentBase, ticker }, FINGERPRINT_DOMAIN);
  const analytical = stableHash({
    kind: "analytical",
    valuationMethod: String((input.packageValue.valuationResult as unknown as Record<string, unknown>).methodology ?? input.packageValue.valuationResult.status ?? ""),
    rating: input.packageValue.rating,
    fairValue: input.packageValue.valuationResult.fairValuePerShare ?? null,
    scenarios: (input.packageValue as unknown as { scenarios?: unknown }).scenarios ?? null,
  }, FINGERPRINT_DOMAIN);
  const section = stableHash({ kind: "section", sections: input.plan.sections.filter((s) => s.include).map((s) => `${s.id}:${s.order}:${s.depth}:${s.priority}`) }, FINGERPRINT_DOMAIN);
  const chart = stableHash({ kind: "chart", charts: input.charts.map((c) => c.id).sort() }, FINGERPRINT_DOMAIN);
  const table = stableHash({ kind: "table", tables: input.tables.map((t) => t.id).sort() }, FINGERPRINT_DOMAIN);
  const visual = stableHash({ kind: "visual", archetype: input.identity?.visualProfile.archetype ?? "unknown", cover: input.identity?.visualProfile.coverStructure ?? "unknown", density: input.identity?.visualProfile.density ?? "unknown" }, FINGERPRINT_DOMAIN);
  const narrative = stableHash({ kind: "narrative", archetype: input.identity?.narrativeProfile.archetype ?? "unknown", question: normalizeText(input.identity?.investorQuestion.question ?? "") }, FINGERPRINT_DOMAIN);
  const combined = stableHash({ kind: "combined", content, analytical, section, chart, table, visual, narrative }, FINGERPRINT_DOMAIN);
  return { version: FINGERPRINT_VERSION, ticker, content, analytical, section, chart, table, visual, narrative, combined };
}

export function fingerprintSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  let matches = 0;
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    if (left[i] === right[i]) matches += 1;
  }
  return length === 0 ? 1 : Math.round((matches / Math.max(left.length, right.length)) * 1000) / 1000;
}

export function compareFingerprintSets(current: FingerprintSet, prior: FingerprintSet): { content: number; analytical: number; section: number; chart: number; table: number; visual: number; narrative: number; overall: number } {
  const content = fingerprintSimilarity(current.content, prior.content);
  const analytical = fingerprintSimilarity(current.analytical, prior.analytical);
  const section = fingerprintSimilarity(current.section, prior.section);
  const chart = fingerprintSimilarity(current.chart, prior.chart);
  const table = fingerprintSimilarity(current.table, prior.table);
  const visual = fingerprintSimilarity(current.visual, prior.visual);
  const narrative = fingerprintSimilarity(current.narrative, prior.narrative);
  const overall = Math.round(((content * 0.24 + analytical * 0.18 + section * 0.2 + chart * 0.1 + table * 0.08 + visual * 0.08 + narrative * 0.12)) * 1000) / 1000;
  return { content, analytical, section, chart, table, visual, narrative, overall };
}
