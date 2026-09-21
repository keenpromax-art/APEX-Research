/**
 * APEX RESEARCH — STATEMENT IDENTITY ENGINE (deterministic)
 *
 * Enforces IS → BS → CF accounting identities on forecast years with LABELED
 * balancing plugs (never silent). The AI decides the structure; code enforces
 * the arithmetic consistency of the resulting statements.
 */
import type { ForecastStatementYear } from "./types";

export interface BalancePlug {
  variable: string;
  computedValue: number;
  kind: "balancing-plug" | "cash-roll-forward";
}

export interface StatementRollforwardResult {
  years: ForecastStatementYear[];
  plugs: BalancePlug[];
  identityChecks: Array<{ check: string; pass: boolean; detail?: string }>;
}

/** Absolute tolerance (currency units) for identity checks. */
export const TOL = 1;

export function enforceStatementIdentities(
  years: ForecastStatementYear[],
  opts?: { log?: string[] }
): StatementRollforwardResult {
  const plugs: BalancePlug[] = [];
  const checks: StatementRollforwardResult["identityChecks"] = [];
  const log = opts?.log || [];

  for (const y of years) {
    const v = y.values as Record<string, number | undefined>;
    const plug = (variable: string, value: number, note: string) => {
      v[variable] = value;
      plugs.push({ variable, computedValue: value, kind: "balancing-plug" });
      log.push(`${y.period}: ${note} (labeled plug).`);
    };

    // ── IS: GP − Opex = EBIT (when lines exist) ──────────────
    if (v.revenue !== undefined && v.grossProfit !== undefined && v.ebit !== undefined && v.totalOpex !== undefined) {
      const gap = Math.abs(v.grossProfit - v.totalOpex - v.ebit);
      if (gap > TOL) {
        plug("totalOpex", v.grossProfit - v.ebit, "totalOpex balanced as grossProfit − EBIT");
        checks.push({ check: `IS ${y.period}: GP − Opex = EBIT`, pass: false, detail: "repaired with labeled plug" });
      } else {
        checks.push({ check: `IS ${y.period}: GP − Opex = EBIT`, pass: true });
      }
    }

    // ── IS: PBT = EBIT − netInterest (when lines exist) ─────
    if (v.pbt !== undefined && v.ebit !== undefined && v.netInterest !== undefined) {
      const gap = Math.abs(v.pbt - (v.ebit - v.netInterest));
      if (gap > TOL) {
        plug("netInterest", v.ebit - v.pbt, "netInterest balanced as EBIT − PBT");
        checks.push({ check: `IS ${y.period}: PBT = EBIT − netInterest`, pass: false, detail: "repaired with labeled plug" });
      } else {
        checks.push({ check: `IS ${y.period}: PBT = EBIT − netInterest`, pass: true });
      }
    }

    // ── IS: NI = PBT − tax (when lines exist) ───────────────
    if (v.pbt !== undefined && v.tax !== undefined && v.netIncome !== undefined) {
      const gap = Math.abs(v.pbt - v.tax - v.netIncome);
      if (gap > TOL) {
        plug("netIncome", v.pbt - v.tax, "netIncome balanced as PBT − tax");
        checks.push({ check: `IS ${y.period}: NI = PBT − tax`, pass: false, detail: "repaired with labeled plug" });
      } else {
        checks.push({ check: `IS ${y.period}: NI = PBT − tax`, pass: true });
      }
    }

    // ── IS: NI ≤ Revenue (sanity) ───────────────────────────
    if (v.revenue !== undefined && v.revenue > 0 && v.netIncome !== undefined) {
      checks.push({ check: `IS ${y.period}: NI ≤ Revenue`, pass: v.netIncome <= v.revenue });
    }

    // ── CF: cashClose = open + CFO + CFI + CFF ──────────────
    if (v.cfo !== undefined && v.cfi !== undefined && v.cff !== undefined && v.cashClose !== undefined) {
      const impliedClose = (v.cashOpen ?? 0) + v.cfo + v.cfi + v.cff;
      const gap = Math.abs(impliedClose - v.cashClose);
      if (gap > TOL) {
        v.cashClose = impliedClose;
        plugs.push({ variable: "cashClose", computedValue: impliedClose, kind: "cash-roll-forward" });
        log.push(`${y.period}: cashClose recomputed from cash roll-forward (labeled plug).`);
        checks.push({ check: `CF ${y.period}: cashClose = open + CFO + CFI + CFF`, pass: false, detail: "repaired via roll-forward" });
      } else {
        checks.push({ check: `CF ${y.period}: cashClose = open + CFO + CFI + CFF`, pass: true });
      }
    }
  }

  return { years, plugs, identityChecks: checks };
}
