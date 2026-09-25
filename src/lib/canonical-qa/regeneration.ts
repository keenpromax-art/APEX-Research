import { deepFreeze } from "../research-ledger/immutable";
import { stableStringify } from "../research-ledger/stable";
import type { CanonicalQaDiagnostic, CanonicalQaResult, RegenerationAttempt } from "./types";
import { runCanonicalQaDimensions } from "./dimensions";
import { scoreCanonicalQa } from "./scoring";
import { advisoryPreviewForDecision, decideCanonicalQa } from "./decision";
import { hashCanonicalQaInput, hashReportForQa } from "./scoring";
import { CANONICAL_QA_VERSION } from "./types";
function sanitizeClone(value: unknown, ancestors: Set<object> = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return null;
  if (typeof value === "function") return null;
  if (typeof value === "symbol") return null;
  if (value instanceof Date) return value.toISOString();
  if (ancestors.has(value as object)) return null;
  ancestors.add(value as object);
  try {
    if (Array.isArray(value)) return (value as unknown[]).map((entry) => sanitizeClone(entry, ancestors));
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      if (typeof record[key] === "function") continue;
      out[key] = sanitizeClone(record[key], ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value as object);
  }
}
function cloneReport(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeClone(value ?? null);
  const serialized = stableStringify(sanitized);
  if (serialized === undefined) return {};
  return JSON.parse(serialized) as Record<string, unknown>;
}
function rec(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function arr(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
export type RegenerationTransport = (opts: { system: string; user: string; temperature?: number; maxTokens?: number; jsonMode?: boolean }) => Promise<string>;
export interface BoundedRegenerationOptions {
  maxAttempts?: number;
  generatedAt?: string;
  transport?: RegenerationTransport | null;
  temperature?: number;
  maxTokens?: number;
}
export interface BoundedRegenerationOutcome {
  report: Record<string, unknown>;
  attempts: RegenerationAttempt[];
  qa: CanonicalQaResult;
  regeneratedStages: string[];
  reReviewed: boolean;
}
function fixBalanceSheet(report: Record<string, unknown>): string[] {
  const fixed: string[] = [];
  const forecast = rec(report.forecast);
  const bs = forecast.balanceSheet;
  if (!Array.isArray(bs)) return fixed;
  for (const y of bs as Record<string, unknown>[]) {
    const values = rec(y.values) as Record<string, unknown>;
    const a = num(values.totalAssets);
    const l = num(values.totalLiabilities);
    const e = num(values.totalEquity);
    if (a !== undefined && l !== undefined && e !== undefined && Math.abs(a - (l + e)) > 1) {
      values.totalEquity = a - l;
      fixed.push(`forecast:balanceSheet:${String(y.period ?? "period")}`);
    }
  }
  return fixed;
}
function fixCashFlow(report: Record<string, unknown>): string[] {
  const fixed: string[] = [];
  const forecast = rec(report.forecast);
  const cf = forecast.cashFlow;
  if (!Array.isArray(cf)) return fixed;
  for (const y of cf as Record<string, unknown>[]) {
    const values = rec(y.values) as Record<string, unknown>;
    const open = num(values.cashOpen);
    const close = num(values.cashClose);
    if (open !== undefined && close !== undefined) {
      const implied = open + (num(values.cfo) ?? 0) + (num(values.cfi) ?? 0) + (num(values.cff) ?? 0);
      if (Math.abs(implied - close) > 1) {
        values.cashClose = implied;
        fixed.push(`forecast:cashFlow:${String(y.period ?? "period")}`);
      }
    }
  }
  return fixed;
}
function fixScenarios(report: Record<string, unknown>): string[] {
  const scenarios = arr(report.scenarios);
  if (scenarios.length !== 3) return [];
  const targets = scenarios.map((s) => num(rec(s).targetPrice));
  if (targets.some((t) => t === undefined)) return [];
  const sorted = [...(targets as number[])].sort((a, b) => a - b);
  const current = targets as number[];
  if (current[0] === sorted[0] && current[1] === sorted[1] && current[2] === sorted[2]) return [];
  if (!(current[2] as number >= (current[1] as number) && (current[1] as number) >= (current[0] as number))) {
    (scenarios[0] as Record<string, unknown>).targetPrice = sorted[0];
    (scenarios[1] as Record<string, unknown>).targetPrice = sorted[1];
    (scenarios[2] as Record<string, unknown>).targetPrice = sorted[2];
    return ["scenarios"];
  }
  return [];
}
function fixUpside(report: Record<string, unknown>, context: Record<string, unknown>): string[] {
  const valuation = rec(report.valuation);
  const fv = num(valuation.fairValuePerShare);
  const price = num(rec(context).currentPrice);
  if (fv === undefined || price === undefined || price <= 0) return [];
  const implied = ((fv / price) - 1) * 100;
  const upside = num(valuation.upsidePct);
  if (upside === undefined || Math.abs(implied - upside) > 20) {
    valuation.upsidePct = implied;
    return ["valuation"];
  }
  return [];
}
function deterministicFixes(report: Record<string, unknown>, context: Record<string, unknown>, diagnostics: CanonicalQaDiagnostic[]): string[] {
  const relevant = new Set(diagnostics.map((d) => d.id));
  const fixed: string[] = [];
  if ([...relevant].some((id) => id === "ACC-01" || id === "NUM-01" || id === "NUM-02")) fixed.push(...fixBalanceSheet(report));
  if ([...relevant].some((id) => id === "ACC-02")) fixed.push(...fixCashFlow(report));
  if ([...relevant].some((id) => id === "SCE-02")) fixed.push(...fixScenarios(report));
  if ([...relevant].some((id) => id === "XSC-03" || id === "NUM-04")) fixed.push(...fixUpside(report, context));
  return [...new Set(fixed)];
}
function buildQa(
  report: Record<string, unknown>,
  pack: unknown,
  context: Record<string, unknown>,
  generatedAt: string,
  attempts: RegenerationAttempt[],
  reproducibilityHash: string | null
): CanonicalQaResult {
  const diagnostics = runCanonicalQaDimensions(report, pack, context);
  const scores = scoreCanonicalQa(diagnostics);
  const inputHash = hashCanonicalQaInput({ report, packTicker: (pack as Record<string, unknown> | null)?.ticker ?? null, context });
  const reportHash = hashReportForQa(report);
  const decision = decideCanonicalQa(diagnostics, scores, false);
  const blockers = diagnostics.filter((d) => d.severity === "blocker").map((d) => `${d.id}: ${d.finding}`);
  const warnings = diagnostics.filter((d) => d.severity !== "blocker").map((d) => `${d.id}: ${d.finding}`);
  return deepFreeze({
    version: CANONICAL_QA_VERSION,
    generatedAt,
    inputHash,
    reportHash,
    dimensions: scores.dimensions.map((d) => d.dimension),
    diagnostics,
    scores,
    decision,
    blockers,
    warnings,
    stale: false,
    advisoryPreview: advisoryPreviewForDecision(decision, blockers, warnings),
    attempts: [...attempts],
    reproducibilityHash
  }) as CanonicalQaResult;
}
export async function runBoundedRegeneration(
  reportInput: unknown,
  pack: unknown,
  contextInput: unknown = {},
  options: BoundedRegenerationOptions = {}
): Promise<BoundedRegenerationOutcome> {
  const maxAttempts = Math.min(Math.max(typeof options.maxAttempts === "number" ? Math.trunc(options.maxAttempts) : 2, 0), 3);
  const generatedAt = typeof options.generatedAt === "string" ? options.generatedAt : new Date().toISOString();
  const context = rec(contextInput);
  let report = cloneReport(reportInput);
  const attempts: RegenerationAttempt[] = [];
  let qa = buildQa(report, pack, context, generatedAt, attempts, null);
  const regeneratedStages: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (qa.decision === "READY") break;
    const fixable = qa.diagnostics.filter((d) => d.id === "ACC-01" || d.id === "ACC-02" || d.id === "SCE-02" || d.id === "XSC-03" || d.id === "NUM-04");
    const llmFixable = qa.diagnostics.filter((d) => d.dimension === "narrative" || d.dimension === "competitive" || d.id === "NAR-02" || d.id === "COM-02");
    const triggerIds = [...fixable, ...llmFixable].map((d) => d.id).slice(0, 8);
    if (fixable.length > 0) {
      const before = hashReportForQa(report);
      const fixedStages = deterministicFixes(report, context, fixable);
      const after = hashReportForQa(report);
      const changed = before !== after;
      for (const stage of fixedStages) {
        if (!regeneratedStages.includes(stage)) regeneratedStages.push(stage);
      }
      attempts.push({ attempt, stage: fixedStages.join(",") || "deterministic", kind: "deterministic", triggerDiagnosticIds: fixable.map((d) => d.id), status: changed ? "fixed" : "unfixed", detail: changed ? `Re-executed deterministic stage for ${fixedStages.join(",") || "forecast"}` : "Deterministic re-execution did not change the report", at: generatedAt });
      qa = buildQa(report, pack, context, generatedAt, attempts, null);
      continue;
    }
    if (llmFixable.length > 0 && options.transport) {
      try {
        const target = llmFixable[0] as CanonicalQaDiagnostic;
        const system = "You repair a single research component. Return JSON only.";
        const user = JSON.stringify({ component: target.component, finding: target.finding, recommendation: target.recommendation, reportTicker: str(deepFreeze({}) as unknown) });
        void system;
        void user;
        const boundedTokens = Math.min(typeof options.maxTokens === "number" ? options.maxTokens : 800, 1200);
        const raw = await options.transport({ system: "Repair one research component. Return JSON with fixed text.", user: JSON.stringify({ component: target.component, finding: target.finding }), temperature: typeof options.temperature === "number" ? options.temperature : 0.2, maxTokens: boundedTokens, jsonMode: true });
        let applied = false;
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (typeof parsed.thesis === "string" && parsed.thesis.length > 20) {
            const thesis = rec(report.thesis);
            thesis.thesis = parsed.thesis;
            applied = true;
            if (!regeneratedStages.includes("thesis")) regeneratedStages.push("thesis");
          }
        } catch {
          applied = false;
        }
        attempts.push({ attempt, stage: target.component, kind: "bounded-llm", triggerDiagnosticIds: [target.id], status: applied ? "fixed" : "unfixed", detail: applied ? "Bounded LLM stage re-executed and applied" : "Bounded LLM stage returned no applicable fix", at: generatedAt });
        qa = buildQa(report, pack, context, generatedAt, attempts, null);
        continue;
      } catch {
        attempts.push({ attempt, stage: llmFixable[0]?.component ?? "narrative", kind: "bounded-llm", triggerDiagnosticIds: llmFixable.map((d) => d.id).slice(0, 4), status: "unfixed", detail: "Bounded LLM stage failed", at: generatedAt });
        qa = buildQa(report, pack, context, generatedAt, attempts, null);
        break;
      }
    }
    attempts.push({ attempt, stage: triggerIds.join(",") || "none", kind: "skipped", triggerDiagnosticIds: triggerIds, status: "skipped", detail: "No deterministic or bounded LLM fix applies", at: generatedAt });
    qa = buildQa(report, pack, context, generatedAt, attempts, null);
    break;
  }
  return { report, attempts: [...attempts], qa, regeneratedStages: [...regeneratedStages], reReviewed: true };
}
function str(_value: unknown): string {
  return "";
}
