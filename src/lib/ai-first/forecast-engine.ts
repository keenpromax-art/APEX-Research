/**
 * APEX RESEARCH — DETERMINISTIC FORECAST ENGINE
 *
 * "AI decides the model. Code executes the model."
 *
 * Takes the AI-generated ForecastSpecification (variables, formulas,
 * assumptions, driverPaths) and the yfinance fact pack, and produces
 * deterministic forecasted financial statements.
 *
 * The LLM NEVER performs arithmetic. It produces Formula specifications and
 * Assumption specifications; this engine evaluates them with safe arithmetic
 * and enforces statement identities with labeled balancing plugs.
 *
 * Provenance per number: "fact" (yfinance) / "derived" (computed from facts) /
 * "assumption" (AI input) / "forecast" (computed from assumptions).
 */
import type {
  FactPack,
  Fact,
  ForecastSpecification,
  ForecastStatementYear,
  ForecastResult,
} from "./types";
import type { ProvenanceTier } from "./types";
import { evalExpression } from "./model-runtime";
import { enforceStatementIdentities } from "./statement-identities";

export interface ForecastEngineInput {
  /** AI-generated model specification. */
  model: ForecastSpecification;
  /** Canonical yfinance fact pack. */
  factPack: FactPack;
}

export interface ForecastEngineOutput {
  forecast: ForecastResult;
  /** Formulas evaluated, per formula id (null when skipped/failed). */
  formulasEvaluated: Record<string, number | null>;
  identityChecks: Array<{ check: string; pass: boolean; detail?: string }>;
  /** Provenance of every computed variable. */
  provenance: Record<string, ProvenanceTier>;
  /** Labeled balancing plugs applied. */
  plugs: string[];
}

/** Pull the latest numeric value for a metric from a fact section. */
function latestValue(sec: { facts: Fact[] }, metric: string): number | undefined {
  const fact = sec.facts.find((f) => f.metric === metric && f.value !== undefined);
  return fact?.value;
}

/**
 * Execute the deterministic forecast engine.
 */
export function executeForecast(input: ForecastEngineInput): ForecastEngineOutput {
  const { model, factPack } = input;
  const years: ForecastStatementYear[] = [];
  const provenance: Record<string, ProvenanceTier> = {};
  const formulasEvaluated: Record<string, number | null> = {};
  const log: string[] = [];

  // ── Step 1: base-year environment from yfinance facts ────
  const baseEnv: Record<string, number> = {};
  const markFact = (m: string, v: number) => {
    baseEnv[m] = v;
    provenance[m] = "fact";
  };
  for (const f of factPack.incomeStatement.facts) {
    if (f.value !== undefined && baseEnv[f.metric] === undefined) markFact(f.metric, f.value);
  }
  for (const f of factPack.balanceSheet.facts) {
    if (f.value !== undefined && baseEnv[f.metric] === undefined) markFact(f.metric, f.value);
  }
  for (const f of factPack.cashFlow.facts) {
    if (f.value !== undefined && baseEnv[f.metric] === undefined) markFact(f.metric, f.value);
  }
  const priceFact = factPack.market.facts.find((f: Fact) => f.metric === "currentPrice");
  if (priceFact?.value !== undefined) markFact("currentPrice", priceFact.value);
  const sharesFact =
    factPack.shares.facts.find((f: Fact) => f.metric === "sharesOutstanding" && f.value !== undefined) ||
    factPack.market.facts.find((f: Fact) => f.metric === "sharesOutstanding" && f.value !== undefined);
  if (sharesFact?.value !== undefined) markFact("sharesOutstanding", sharesFact.value);

  // ── Step 2: AI assumptions lookup ────────────────────────
  const assumptionByVar = new Map<string, (typeof model.assumptions)[number]>();
  for (const a of model.assumptions) assumptionByVar.set(a.variable, a);

  // ── Step 3: base fiscal year ─────────────────────────────
  const firstPeriod = factPack.incomeStatement.facts.find((f) => f.period)?.period || `FY${new Date().getFullYear()}`;
  const baseFiscalYear = extractFiscalYear(firstPeriod);

  // ── Step 4: forecast years ───────────────────────────────
  for (let yr = 1; yr <= model.horizonYears; yr++) {
    const periodStr = `FY${baseFiscalYear + yr}`;
    const env: Record<string, number> = { ...baseEnv };

    // 4a. Apply AI driverPaths (decimal growth rates per input variable).
    //     Code performs the compounding — the AI only chose the rates.
    for (const varDef of model.variables) {
      if (varDef.kind !== "input") continue;
      const path = model.driverPaths[varDef.name];
      const baseVal = varDef.baseValue ?? baseEnv[varDef.name];
      if (path && path.length > 0 && baseVal !== undefined) {
        const g = path[Math.min(yr - 1, path.length - 1)];
        env[varDef.name] = baseVal * (1 + (isFinite(g) ? g : 0));
        env[`${varDef.name}_growth`] = isFinite(g) ? g : 0;
        provenance[varDef.name] = "forecast";
        provenance[`${varDef.name}_growth`] = "assumption";
      } else if (assumptionByVar.has(varDef.name) && baseVal !== undefined) {
        // Assumption value acts as a growth rate when unit is %, else a level.
        const a = assumptionByVar.get(varDef.name)!;
        if (a.unit === "%" || a.unit === "percent") {
          env[varDef.name] = baseVal * (1 + a.value);
          env[`${varDef.name}_growth`] = a.value;
        } else {
          env[varDef.name] = a.value;
        }
        provenance[varDef.name] = "forecast";
      }
    }

    // 4b. Evaluate AI formulas each year (deterministic arithmetic).
    //     Repeat twice so formulas can consume other formulas' outputs.
    const yearFormulaResults: Record<string, number> = {};
    for (let pass = 0; pass < 2; pass++) {
      for (const f of model.formulas) {
        const envWithFormulaOuts = { ...env, ...yearFormulaResults };
        const hasAllVars = f.variables.every((v) => envWithFormulaOuts[v.toLowerCase()] !== undefined || envWithFormulaOuts[v] !== undefined);
        if (!hasAllVars) {
          if (pass === 1) formulasEvaluated[f.id] = null;
          continue;
        }
        const ok = evalExpression(f.expression, envWithFormulaOuts);
        if (ok.ok) {
          formulasEvaluated[f.id] = ok.value;
          yearFormulaResults[f.output] = ok.value;
          env[f.output] = ok.value;
          if (provenance[f.output] !== "fact") provenance[f.output] = "forecast";
        } else {
          if (pass === 1) {
            formulasEvaluated[f.id] = null;
            log.push(`${periodStr}: formula ${f.id} failed: ${ok.error}`);
          }
        }
      }
    }

    // 4c. Build the statement year from evaluated values (never zero-fill).
    const v: Record<string, number | undefined> = {
      revenue: yearFormulaResults["revenue"] ?? env["revenue"],
      grossProfit: yearFormulaResults["grossProfit"] ?? env["grossProfit"],
      ebit: yearFormulaResults["ebit"] ?? env["ebit"] ?? env["operatingIncome"],
      pbt: yearFormulaResults["pbt"] ?? env["pbt"] ?? env["pretaxIncome"],
      netIncome: yearFormulaResults["netIncome"] ?? env["netIncome"],
      totalAssets: env["totalAssets"],
      totalLiabilities: env["totalLiabilities"],
      totalEquity: env["totalEquity"] ?? env["stockholdersEquity"],
      cash: env["cash"],
      cfo: yearFormulaResults["cfo"] ?? env["operatingCashFlow"] ?? env["totalCashFromOperatingActivities"],
      cfi: env["capitalExpenditures"] !== undefined ? -env["capitalExpenditures"] : env["totalCashflowsFromInvestingActivities"],
      cff: env["financingCashFlow"] ?? env["totalCashFromFinancingActivities"],
      cashOpen: env["cash"],
      cashClose: yearFormulaResults["cashClose"],
    };
    // Effective tax from history when the AI did not model it explicitly.
    if (v.pbt !== undefined && v.netIncome !== undefined && v.pbt !== 0) {
      v.tax = v.pbt - v.netIncome;
      provenance["tax"] = "derived";
    }

    years.push({
      period: periodStr,
      values: v,
      provenance: { ...provenance },
    });
  }

  // ── Step 5: enforce statement identities with labeled plugs ──
  const identityResult = enforceStatementIdentities(years, { log });

  return {
    forecast: {
      incomeStatement: identityResult.years,
      balanceSheet: identityResult.years,
      cashFlow: identityResult.years,
      identityChecks: identityResult.identityChecks,
    },
    formulasEvaluated,
    identityChecks: identityResult.identityChecks,
    provenance,
    plugs: identityResult.plugs.map((p) => `${p.variable}=${p.computedValue} (${p.kind})`),
  };
}

/** Extract fiscal year number from a period string like "FY2024" or "2024-03-31". */
function extractFiscalYear(period: string): number {
  const fy = period.match(/FY\s*(\d{4})/i);
  if (fy) return parseInt(fy[1], 10);
  const date = period.match(/(\d{4})/);
  if (date) return parseInt(date[1], 10);
  return new Date().getFullYear();
}

/**
 * Render a compact forecast context package for a downstream agent
 * (Principle 33 — each agent receives only what it needs).
 */
export function renderForecastContext(
  forecast: ForecastResult,
  agentKind: "valuation" | "scenarios" | "risks" | "thesis"
): string {
  const lines: string[] = [
    `FORECAST CONTEXT — ${agentKind.toUpperCase()}`,
    `Horizon: ${forecast.incomeStatement.length} years`,
    "",
  ];
  for (const y of forecast.incomeStatement) {
    const v = y.values;
    const num = (x: number | undefined) => (x !== undefined ? String(Math.round(x * 100) / 100) : "N/A");
    lines.push(
      `  ${y.period}: Revenue ${num(v.revenue)} | EBIT ${num(v.ebit)} | NI ${num(v.netIncome)} | Equity ${num(v.totalEquity)} | CFO ${num(v.cfo)}`
    );
  }
  const failed = forecast.identityChecks.filter((c) => !c.pass);
  if (failed.length > 0) {
    lines.push("", "IDENTITY REPAIRS (labeled plugs applied):");
    for (const c of failed) lines.push(`  - ${c.check}: ${c.detail || "repaired"}`);
  }
  return lines.join("\n");
}

export default { executeForecast, renderForecastContext };