import type { FingerprintSet } from "./fingerprints";
import type { OriginalityReport } from "./collision";

export const ORIGINALITY_STORE_BOUND = 100;

export interface OriginalitySummary {
  ticker: string;
  combined: string;
  content: string;
  analytical: string;
  section: string;
  chart: string;
  table: string;
  visual: string;
  narrative: string;
  status: OriginalityReport["status"];
  maximumSimilarity: number;
  comparisons: number;
  generatedAt: string;
}

const summaries: OriginalitySummary[] = [];

export function persistOriginalitySummary(input: { ticker: string; fingerprints: FingerprintSet; report: OriginalityReport }): OriginalitySummary {
  const summary: OriginalitySummary = {
    ticker: input.ticker.trim().toUpperCase(),
    combined: input.fingerprints.combined,
    content: input.fingerprints.content,
    analytical: input.fingerprints.analytical,
    section: input.fingerprints.section,
    chart: input.fingerprints.chart,
    table: input.fingerprints.table,
    visual: input.fingerprints.visual,
    narrative: input.fingerprints.narrative,
    status: input.report.status,
    maximumSimilarity: input.report.maximumSimilarity,
    comparisons: input.report.comparisons,
    generatedAt: input.report.generatedAt,
  };
  const existingIndex = summaries.findIndex((entry) => entry.ticker === summary.ticker && entry.combined === summary.combined);
  if (existingIndex >= 0) summaries.splice(existingIndex, 1);
  summaries.push(summary);
  while (summaries.length > ORIGINALITY_STORE_BOUND) summaries.shift();
  return summary;
}

export function loadOriginalitySummaries(ticker?: string): OriginalitySummary[] {
  if (!ticker) return [...summaries];
  const key = ticker.trim().toUpperCase();
  return summaries.filter((entry) => entry.ticker === key);
}

export function loadPriorFingerprints(excludeTicker?: string): Array<{ ticker: string; fingerprints: FingerprintSet }> {
  const key = excludeTicker ? excludeTicker.trim().toUpperCase() : null;
  return summaries
    .filter((entry) => !key || entry.ticker !== key)
    .map((entry) => ({
      ticker: entry.ticker,
      fingerprints: {
        version: "report-fingerprint-v1" as const,
        ticker: entry.ticker,
        content: entry.content,
        analytical: entry.analytical,
        section: entry.section,
        chart: entry.chart,
        table: entry.table,
        visual: entry.visual,
        narrative: entry.narrative,
        combined: entry.combined,
      },
    }));
}

export function clearOriginalitySummaries(ticker?: string): void {
  if (!ticker) {
    summaries.length = 0;
    return;
  }
  const key = ticker.trim().toUpperCase();
  for (let i = summaries.length - 1; i >= 0; i -= 1) {
    if (summaries[i].ticker === key) summaries.splice(i, 1);
  }
}

export function originalityStoreSize(): number {
  return summaries.length;
}
