// ============================================================
// APEX RESEARCH — CanonicalReport + PDF Validation Layer (P0 #10)
// ------------------------------------------------------------
// One CanonicalReport containing every approved number and claim. All pages render from it.
// After PDF generation, extract displayed numbers and independently compare against canonical object.
// Any mismatch = publication blocked.
// ============================================================
import type { CanonicalFactGraph } from "./canonical-facts";
import type { CanonicalForecast } from "./canonical-forecast";
import type { AuditGraph } from "./financial-kernel";
import { magnitudeTolerance, MONEY_BRIDGE_TOL, PER_SHARE_TOL, RATIO_TOL } from "./financial-kernel";

export interface CanonicalReport {
  ticker: string;
  companyName: string;
  currency: string;
  asOf: string;
  modelVersion: string;
  facts: CanonicalFactGraph;
  forecast: CanonicalForecast | null;
  valuation: { enterpriseValue: number; equityValue: number; fairValuePerShare: number | null; netDebt: number; wacc: number; terminalGrowth: number };
  market: { price: number | null; sharesBasic: number | null; sharesDiluted: number | null; marketCap: number | null };
  ratios: Record<string, number | null>;
  auditGraph: AuditGraph;
  claims: Array<{ text: string; evidence: string }>;
  _hash: string;
  _sealed: boolean;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).filter((k) => k !== "_hash").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
function hashReport(o: unknown): string {
  const s = stableStringify(o);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `cr_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildCanonicalReport(input: Omit<CanonicalReport, "_hash" | "_sealed">): CanonicalReport {
  const base = { ...input, _sealed: true } as CanonicalReport;
  const h = hashReport(base);
  (base as unknown as Record<string, unknown>)._hash = h;
  // deep-freeze
  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v as object);
      Object.freeze(o);
    }
    return o;
  };
  return deepFreeze(base);
}

export interface PdfExtract {
  /** Key → displayed number as parsed from PDF text layer (already de-formatted: no commas, ₹/$, Cr/B/M). */
  values: Record<string, number | null>;
}

export function validatePdfAgainstCanonical(report: CanonicalReport, extract: PdfExtract): Array<{ key: string; severity: "FAIL" | "WARN"; expected: string; actual: string; detail: string }> {
  const issues: Array<{ key: string; severity: "FAIL" | "WARN"; expected: string; actual: string; detail: string }> = [];
  const checks: Array<{ key: string; expected: number | null; actual: number | null; tol: typeof MONEY_BRIDGE_TOL }> = [
    { key: "valuation.enterpriseValue", expected: report.valuation.enterpriseValue, actual: extract.values["valuation.enterpriseValue"] ?? null, tol: MONEY_BRIDGE_TOL },
    { key: "valuation.equityValue", expected: report.valuation.equityValue, actual: extract.values["valuation.equityValue"] ?? null, tol: MONEY_BRIDGE_TOL },
    { key: "valuation.fairValuePerShare", expected: report.valuation.fairValuePerShare, actual: extract.values["valuation.fairValuePerShare"] ?? null, tol: PER_SHARE_TOL },
    { key: "valuation.wacc", expected: report.valuation.wacc, actual: extract.values["valuation.wacc"] ?? null, tol: { absTol: 0.0005, relTol: 0.02, materiality: 0.005 } },
  ];
  // Forecast revenue per year (null forecast = missing — flagged by FCST-05, never priced)
  (report.forecast?.projections ?? []).forEach((p, i) => {
    checks.push({ key: `forecast.Y${i + 1}.revenue`, expected: p.revenue, actual: extract.values[`forecast.Y${i + 1}.revenue`] ?? null, tol: MONEY_BRIDGE_TOL });
  });
  for (const c of checks) {
    if (c.expected === null || c.actual === null) {
      if (c.expected !== null || c.actual !== null) issues.push({ key: c.key, severity: "WARN", expected: String(c.expected), actual: String(c.actual), detail: "One side missing — N/A should be explicit, not blank." });
      continue;
    }
    const v = magnitudeTolerance(c.expected, c.actual, c.tol);
    if (!v.pass && v.material) issues.push({ key: c.key, severity: "FAIL", expected: String(c.expected), actual: String(c.actual), detail: `PDF mismatch: ${v.detail}` });
    else if (!v.pass) issues.push({ key: c.key, severity: "WARN", expected: String(c.expected), actual: String(c.actual), detail: `PDF immaterial drift: ${v.detail}` });
  }
  // Hash integrity
  const actualHash = hashReport({ ...report, _hash: undefined });
  if (actualHash !== report._hash) issues.push({ key: "canonical._hash", severity: "FAIL", expected: report._hash, actual: actualHash, detail: "CanonicalReport mutated after seal — deep-freeze violation." });
  return issues;
}
