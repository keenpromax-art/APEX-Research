/**
 * APEX RESEARCH — VALUATION HELPERS (deterministic)
 *
 * Fact-pack accessors for the valuation engine. No placeholders: when a fact
 * is missing from yfinance, the accessor returns undefined and the valuation
 * output stays unavailable (marked, never manufactured).
 */
import type { FactPack, Fact } from "./types";

/**
 * Pull the latest numeric value for a metric from the fact pack.
 * Searches market first (current-period facts), then statements.
 */
export function latestValueFromPack(pack: FactPack, metric: string): number | undefined {
  const sections = [pack.market, pack.shares, pack.incomeStatement, pack.balanceSheet, pack.cashFlow];
  for (const sec of sections) {
    const f: Fact | undefined = sec.facts.find(
      (x) => x.metric === metric && x.value !== undefined
    );
    if (f?.value !== undefined) return f.value;
  }
  return undefined;
}
