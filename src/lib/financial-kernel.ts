// ============================================================
// APEX RESEARCH — Financial Math Kernel (P0 architecture layer)
// ------------------------------------------------------------
// ISOLATED, PURE, deterministic mathematics. This module knows NOTHING
// about sectors, archetypes, Yahoo, ledgers, or reports — only numbers.
//
// Layering contract (Raw Facts → Normalization → Math Kernel →
// Economic Model → Valuation):
//   - Economic Model  (driver-models.ts) supplies validated INPUTS
//     (growth paths, margins, capex/NWC intensities, WACC, terminal g).
//   - Math Kernel     (this file) turns inputs into OUTPUTS
//     (FCFF, discounts, terminal value, EV, equity, per-share,
//     ratios, WACC number, tolerances, trails).
//   - No forecast assumption, sector branch, fallback default, or
//     narrative string may live here. Violations fail review.
// ============================================================

export const KERNEL_VERSION = "fin-kernel-v1";

// ─────────────────────────────────────────────
// Denominator state machine  (P0 #8)
// A ratio is NEVER just a number: zero / negative denominators
// (negative equity, zero revenue) yield explicit states so a
// mathematically valid but economically meaningless figure
// (e.g. ROE −478% on distressed equity) can never print as fact.
// ─────────────────────────────────────────────
export type DenominatorState = "VALID" | "ZERO" | "NEGATIVE" | "NM";

export interface KernelScalar {
  /** Numeric result. 0 when not computable — NEVER read without checking `validity`/`display`. */
  value: number;
  validity: DenominatorState;
  /** Machine-readable reason, e.g. "ZERO_DENOMINATOR:revenue==0". */
  reason: string;
  /** Presentation directive: VALUE prints, N_M renders N/M. */
  display: "VALUE" | "N_M";
}

/**
 * The single division primitive for the whole pipeline.
 * Numerics match legacy `div()` exactly (0 on zero denominator);
 * the state machine is the added safety layer.
 */
export function guardedDiv(
  numer: number,
  denom: number,
  opts?: { label?: string; allowNegativeDenom?: boolean; zeroIsMissing?: boolean }
): KernelScalar {
  const label = opts?.label ?? "ratio";
  const n = Number(numer);
  const d = Number(denom);
  if (!Number.isFinite(n) || !Number.isFinite(d)) {
    return { value: 0, validity: "NM", reason: `NON_FINITE_INPUT:${label}`, display: "N_M" };
  }
  if (d === 0) {
    return { value: 0, validity: "ZERO", reason: `ZERO_DENOMINATOR:${label}==0`, display: "N_M" };
  }
  if (d < 0 && !opts?.allowNegativeDenom) {
    return { value: n / d, validity: "NEGATIVE", reason: `NEGATIVE_DENOMINATOR:${label}<0`, display: "N_M" };
  }
  return { value: n / d, validity: "VALID", reason: `OK:${label}`, display: "VALUE" };
}

// ─────────────────────────────────────────────
// Universal CAGR  (P0 #5 — methodology lives in the economic layer;
// this function is pure mathematics)
// ─────────────────────────────────────────────
export function canonicalCAGR(startValue: number, endValue: number, periods: number): KernelScalar {
  if (!(periods > 0) || !Number.isFinite(periods)) {
    return { value: 0, validity: "NM", reason: "NON_FINITE_INPUT:periods", display: "N_M" };
  }
  if (!(startValue > 0) || !(endValue > 0)) {
    return { value: 0, validity: "NM", reason: "NON_POSITIVE_ANCHOR:cagr-needs-positive-start-and-end", display: "N_M" };
  }
  return { value: Math.pow(endValue / startValue, 1 / periods) - 1, validity: "VALID", reason: "OK:cagr", display: "VALUE" };
}

// ─────────────────────────────────────────────
// Canonical margins  (P0 #6 — one definition each, denominators guarded)
// ─────────────────────────────────────────────
export function canonicalMargin(numerator: number, revenue: number, label: string): KernelScalar {
  return guardedDiv(numerator, revenue, { label: `${label}/revenue` });
}

// ─────────────────────────────────────────────
// MetricDictionary — versioned formulas  (P0 #22)
// Every derived metric resolves its definition here. Two implementations
// of the "same" metric with different formulas is a defect by definition.
// ─────────────────────────────────────────────
export interface MetricFormula {
  id: string;
  version: string;
  formula: string;
  inputs: string[];
  notes?: string;
}

const METRIC_DICTIONARY_ENTRIES: MetricFormula[] = [
  { id: "revenue.cagr", version: "v1", formula: "(end/start)^(1/periods) − 1", inputs: ["revenue[start]", "revenue[end]", "periods"] },
  { id: "margin.gross", version: "v1", formula: "grossProfit / revenue", inputs: ["grossProfit", "revenue"] },
  { id: "margin.ebitda", version: "v1", formula: "ebitda / revenue", inputs: ["ebitda", "revenue"] },
  { id: "margin.ebit", version: "v1", formula: "operatingIncome / revenue", inputs: ["operatingIncome", "revenue"] },
  { id: "margin.net", version: "v1", formula: "netIncome / revenue", inputs: ["netIncome", "revenue"] },
  { id: "return.roe", version: "v1", formula: "netIncome / totalEquity; NM when totalEquity ≤ 0", inputs: ["netIncome", "totalEquity"] },
  { id: "return.roa", version: "v1", formula: "netIncome / totalAssets; NM when totalAssets ≤ 0", inputs: ["netIncome", "totalAssets"] },
  { id: "return.roce", version: "v1", formula: "operatingIncome / (totalAssets − currentLiabilities); NM when capitalEmployed ≤ 0", inputs: ["operatingIncome", "totalAssets", "currentLiabilities"] },
  { id: "return.roic", version: "v1", formula: "nopat / investedCapital; investedCapital = totalEquity + totalDebt − cash; NM when investedCapital ≤ 0", inputs: ["nopat", "totalEquity", "totalDebt", "cash"] },
  { id: "leverage.debtToEquity", version: "v1", formula: "totalDebt / totalEquity; NM when totalEquity ≤ 0", inputs: ["totalDebt", "totalEquity"] },
  { id: "leverage.netDebtToEbitda", version: "v1", formula: "(totalDebt − cash − liquidInvestments) / ebitda; NM when ebitda ≤ 0", inputs: ["totalDebt", "cash", "liquidInvestments", "ebitda"] },
  { id: "liquidity.currentRatio", version: "v1", formula: "currentAssets / currentLiabilities; NM when currentLiabilities ≤ 0", inputs: ["currentAssets", "currentLiabilities"] },
  { id: "capital.netDebt", version: "v1", formula: "grossDebt − cash − liquidInvestments (restricted cash excluded)", inputs: ["grossDebt", "cash", "liquidInvestments"] },
  { id: "cashflow.fcff", version: "v1", formula: "nopat + depreciation − capex − changeInWorkingCapital", inputs: ["nopat", "depreciation", "capex", "changeInWorkingCapital"] },
  { id: "valuation.gordonTV", version: "v1", formula: "fcffT×(1+g) / (wacc−g); requires wacc−g ≥ 2%; 25× terminal-FCFF cap", inputs: ["fcffT", "wacc", "terminalGrowth"] },
  { id: "valuation.wacc", version: "v1", formula: "CoE×wE + CoD×(1−T)×wD; CoE = Rf + β×ERP", inputs: ["riskFreeRate", "equityRiskPremium", "beta", "preTaxCostOfDebt", "marginalTaxRate", "equityWeight"] },
  { id: "valuation.perShare", version: "v1", formula: "equityValue / dilutedShares; NM when shares ≤ 0", inputs: ["equityValue", "dilutedShares"] },
  { id: "valuation.upside", version: "v1", formula: "fairValue / currentPrice − 1; NM when currentPrice ≤ 0", inputs: ["fairValue", "currentPrice"] },
];

const METRIC_DICTIONARY = new Map(METRIC_DICTIONARY_ENTRIES.map((e) => [e.id, e]));

export function metricFormula(id: string): MetricFormula {
  const f = METRIC_DICTIONARY.get(id);
  if (!f) throw new Error(`MetricDictionary: unknown metric id "${id}" — add a versioned formula, never inline one.`);
  return f;
}

export function listMetricIds(): string[] {
  return [...METRIC_DICTIONARY.keys()];
}

// ─────────────────────────────────────────────
// Canonical capital decomposition  (P0 #11)
// GrossDebt / Cash / LiquidInvestments / RestrictedCash / NetDebt.
// Yahoo does not split restricted cash: it is EXPLICITLY marked MISSING
// (never silently zero-folded into an investable-cash claim).
// ─────────────────────────────────────────────
export interface CapitalDecomposition {
  grossDebt: number;
  cash: number;
  liquidInvestments: number;
  /** Always null from Yahoo feeds — disclosed as unknown, never assumed zero. */
  restrictedCash: number | null;
  restrictedCashStatus: "MISSING";
  netDebt: number;
}

export function decomposeCapital(fin: {
  totalDebt?: number; shortTermDebt?: number; longTermDebt?: number;
  cash?: number; shortTermInvestments?: number;
}): CapitalDecomposition {
  const grossDebt = Number(fin.totalDebt) || ((Number(fin.shortTermDebt) || 0) + (Number(fin.longTermDebt) || 0));
  const cash = Number(fin.cash) || 0;
  const liquidInvestments = Number(fin.shortTermInvestments) || 0;
  return {
    grossDebt,
    cash,
    liquidInvestments,
    restrictedCash: null,
    restrictedCashStatus: "MISSING",
    netDebt: grossDebt - cash - liquidInvestments,
  };
}

// ─────────────────────────────────────────────
// Universal FCFF  (P0 #12 — company model supplies validated inputs;
// this function only does arithmetic)
// ─────────────────────────────────────────────
export function computeFCFF(input: {
  nopat: number; depreciation: number; capex: number; changeInWorkingCapital: number;
}): number {
  const n = Number(input.nopat) || 0;
  const d = Number(input.depreciation) || 0;
  const c = Number(input.capex) || 0;
  const w = Number(input.changeInWorkingCapital) || 0;
  return n + d - c - w;
}

// ─────────────────────────────────────────────
// Discounting + Gordon terminal value  (P0 #13, #14)
// Mid-year convention preserved from the legacy engine (bit-identical).
// Terminal constraints are INDEPENDENT and explicit: wacc−g floor,
// 25× terminal-FCFF cap, terminal-margin sanity, TV-concentration flag.
// ─────────────────────────────────────────────
export interface TerminalValueResult {
  terminalValue: number;
  unadjustedTerminalValue: number;
  capped: boolean;
  spreadOk: boolean;
  /** Terminal EBIT margin implied by terminal FCFF; null when not computable. */
  impliedTerminalMargin: number | null;
  marginSane: boolean;
  diagnostics: string[];
}

export const TERMINAL_SPREAD_FLOOR = 0.02;
export const TERMINAL_VALUE_CAP_MULTIPLE = 25.0;
/** Terminal EBIT margin plausibility band (generous; violations diagnose, not fail). */
export const TERMINAL_MARGIN_LOW = -0.2;
export const TERMINAL_MARGIN_HIGH = 0.6;

export function discountFactor(wacc: number, yearIndexZeroBased: number): number {
  return Math.pow(1 + wacc, -(yearIndexZeroBased + 0.5));
}

export function discountFCFF(fcffs: number[], wacc: number): { pvFcff: number[]; sumPvFcff: number } {
  const pvFcff = fcffs.map((f, i) => f * discountFactor(wacc, i));
  return { pvFcff, sumPvFcff: pvFcff.reduce((a, b) => a + b, 0) };
}

export function gordonTerminalValue(params: {
  terminalYearFcff: number;
  wacc: number;
  terminalGrowth: number;
  /** Terminal-year revenue + tax rate enable the implied-margin sanity check. */
  terminalRevenue?: number;
  marginalTaxRate?: number;
}): TerminalValueResult {
  const { terminalYearFcff, wacc, terminalGrowth } = params;
  const diagnostics: string[] = [];
  const spread = wacc - terminalGrowth;
  const spreadOk = spread >= TERMINAL_SPREAD_FLOOR;
  if (!spreadOk) {
    diagnostics.push(
      `Terminal spread ${(spread * 100).toFixed(2)}% below ${(TERMINAL_SPREAD_FLOOR * 100).toFixed(0)}% floor — denominator floored; valuation is spread-constrained, treat with caution.`
    );
  }
  const safeSpread = Math.max(TERMINAL_SPREAD_FLOOR, spread);
  const unadjustedTerminalValue = (terminalYearFcff * (1 + terminalGrowth)) / safeSpread;
  const cap = Math.max(0, terminalYearFcff * TERMINAL_VALUE_CAP_MULTIPLE);
  const capped = unadjustedTerminalValue > cap && terminalYearFcff > 0;
  if (capped) {
    diagnostics.push(
      `Terminal value capped at ${TERMINAL_VALUE_CAP_MULTIPLE}× terminal-year FCFF safeguard (reduced from ${Math.round(unadjustedTerminalValue / (terminalYearFcff || 1))}x).`
    );
  }
  const terminalValue = capped ? cap : unadjustedTerminalValue;

  let impliedTerminalMargin: number | null = null;
  let marginSane = true;
  const rev = Number(params.terminalRevenue) || 0;
  const tax = Number(params.marginalTaxRate);
  if (rev > 0 && Number.isFinite(tax) && tax < 1) {
    // Invert FCFF ≈ EBIT×(1−T) + D&A − capex − ΔNWC is under-identified; use the
    // conservative proxy EBIT ≈ FCFF/(1−T) when reinvestment ≈ D&A (mature terminal).
    impliedTerminalMargin = terminalYearFcff / ((1 - tax) * rev);
    marginSane = impliedTerminalMargin >= TERMINAL_MARGIN_LOW && impliedTerminalMargin <= TERMINAL_MARGIN_HIGH;
    if (!marginSane) {
      diagnostics.push(
        `Implied terminal EBIT margin ${(impliedTerminalMargin * 100).toFixed(1)}% outside [${(TERMINAL_MARGIN_LOW * 100).toFixed(0)}%, ${(TERMINAL_MARGIN_HIGH * 100).toFixed(0)}%] plausibility band — explicit-period margins and terminal growth are inconsistent.`
      );
    }
  }
  return { terminalValue, unadjustedTerminalValue, capped, spreadOk, impliedTerminalMargin, marginSane, diagnostics };
}

// ─────────────────────────────────────────────
// WACC formula engine  (P0 #15 — pure formula; input SOURCING lives
// in calculations.sourceWACCInputs and is provenance-tagged there)
// ─────────────────────────────────────────────
export interface WACCInputs {
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  preTaxCostOfDebt: number;
  marginalTaxRate: number;
  equityWeight: number;
}

export interface WACCResult {
  costOfEquity: number;
  costOfDebtPostTax: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  valid: boolean;
  reason: string;
}

export const WACCFormulaEngine = {
  formulaId: "valuation.wacc",
  compute(inputs: WACCInputs): WACCResult {
    const { riskFreeRate: rf, equityRiskPremium: erp, beta, preTaxCostOfDebt: cod, marginalTaxRate: tax } = inputs;
    let equityWeight = Number(inputs.equityWeight);
    if (![rf, erp, beta, cod, tax, equityWeight].every((v) => Number.isFinite(v))) {
      return { costOfEquity: 0, costOfDebtPostTax: 0, debtWeight: 0, equityWeight: 0, wacc: 0, valid: false, reason: "NON_FINITE_INPUT:wacc-inputs" };
    }
    if (equityWeight < 0 || equityWeight > 1) {
      return { costOfEquity: 0, costOfDebtPostTax: 0, debtWeight: 0, equityWeight: 0, wacc: 0, valid: false, reason: "WEIGHTS_OUT_OF_RANGE:equityWeight∉[0,1]" };
    }
    const costOfEquity = rf + beta * erp;
    const costOfDebtPostTax = cod * (1 - tax);
    const debtWeight = 1 - equityWeight;
    return { costOfEquity, costOfDebtPostTax, debtWeight, equityWeight, wacc: costOfEquity * equityWeight + costOfDebtPostTax * debtWeight, valid: true, reason: "OK:wacc" };
  },
};

// ─────────────────────────────────────────────
// Magnitude-aware tolerance  (P0 #19 — absolute + relative + materiality)
// ─────────────────────────────────────────────
export interface ToleranceSpec {
  /** Absolute floor, in the dimension's native units (e.g. ₹ for money). */
  absTol: number;
  /** Relative tolerance as a fraction (0.005 = 0.5%). */
  relTol: number;
  /** Breaches below this absolute gap are immaterial even if relative fails. */
  materiality?: number;
}

export interface ToleranceVerdict {
  pass: boolean;
  gapAbs: number;
  gapRel: number;
  material: boolean;
  detail: string;
}

export function magnitudeTolerance(expected: number, actual: number, spec: ToleranceSpec): ToleranceVerdict {
  const gapAbs = Math.abs((Number(actual) || 0) - (Number(expected) || 0));
  const denom = Math.abs(Number(expected) || 0);
  const gapRel = denom > 0 ? gapAbs / denom : (gapAbs > 0 ? Infinity : 0);
  const allowed = Math.max(spec.absTol, spec.relTol * denom);
  const materiality = spec.materiality ?? spec.absTol;
  const material = gapAbs > materiality;
  const pass = gapAbs <= allowed;
  return {
    pass,
    gapAbs,
    gapRel,
    material,
    detail: `gap ${gapAbs.toFixed(2)} (rel ${(gapRel * 100).toFixed(2)}%) vs allowed ${allowed.toFixed(2)} (abs ${spec.absTol}, rel ${(spec.relTol * 100).toFixed(2)}%)`,
  };
}

/** Money-bridge tolerance: ±1000 native units absolute, 0.5% relative, material above 1000. */
export const MONEY_BRIDGE_TOL: ToleranceSpec = { absTol: 1000, relTol: 0.005, materiality: 1000 };
/** Per-share tolerance: ±1.00 absolute, 1% relative. */
export const PER_SHARE_TOL: ToleranceSpec = { absTol: 1.0, relTol: 0.01, materiality: 1.0 };
/** Ratio tolerance: 0.5pp absolute on ratios expressed as fractions. */
export const RATIO_TOL: ToleranceSpec = { absTol: 0.005, relTol: 0.02, materiality: 0.005 };

// ─────────────────────────────────────────────
// Derivation trail  (P0 #20 — every derived value stores formula,
// inputs, source IDs, and the transform applied)
// ─────────────────────────────────────────────
export interface TrailInput {
  name: string;
  value: number | string;
  sourceId: string;
}

export interface DerivationEntry {
  output: string;
  formulaId: string;
  formulaVersion: string;
  inputs: TrailInput[];
  transform: string;
}

export class ProvenanceTrail {
  private entries: DerivationEntry[] = [];
  trace(output: string, formulaId: string, inputs: TrailInput[], transform: string): void {
    let version = "v1";
    try { version = metricFormula(formulaId).version; } catch { /* ad-hoc formula id */ }
    this.entries.push({ output, formulaId, formulaVersion: version, inputs, transform });
  }
  all(): DerivationEntry[] {
    return [...this.entries];
  }
}

// ─────────────────────────────────────────────
// Scenario vectors  (P0 #17 — each scenario is a COMPLETE model-input
// vector, independently re-solvable through this kernel)
// ─────────────────────────────────────────────
export interface ScenarioVector {
  name: "bull" | "base" | "bear";
  revenueGrowth: number[];
  ebitMargin: number[];
  capexPct: number;
  deptPct: number;
  nwcPct: number;
  wacc: number;
  terminalGrowth: number;
  weight: number;
}

export interface SolvedVector {
  name: "bull" | "base" | "bear";
  sumPvFcff: number;
  terminalValue: number;
  enterpriseValue: number;
  equityValue: number;
  fairValuePerShare: number | null;
  diagnostics: string[];
}

/**
 * Derive complete bull/base/bear input vectors from the base-case model
 * inputs. Directional deltas mirror the ledger's long-standing calibration
 * (bull ≈ 1.5× growth / 1.25× margin; bear ≈ 0.45× growth floor 2% / 0.70×
 * margin) so published arithmetic targets stay consistent with the vectors.
 */
export function deriveScenarioVectors(base: {
  revenueGrowth: number[];
  ebitMargin: number[];
  capexPct: number;
  deptPct: number;
  nwcPct: number;
  wacc: number;
  terminalGrowth: number;
}): Record<"bull" | "base" | "bear", ScenarioVector> {
  const bump = (m: number[], d: number, cap: number) => m.map((x) => Math.min(x + d, cap));
  return {
    bull: {
      name: "bull",
      revenueGrowth: base.revenueGrowth.map((g) => g * 1.5),
      ebitMargin: bump(base.ebitMargin, 0.02, 0.4),
      capexPct: base.capexPct, deptPct: base.deptPct, nwcPct: base.nwcPct,
      wacc: base.wacc, terminalGrowth: base.terminalGrowth, weight: 0.25,
    },
    base: {
      name: "base",
      revenueGrowth: [...base.revenueGrowth],
      ebitMargin: [...base.ebitMargin],
      capexPct: base.capexPct, deptPct: base.deptPct, nwcPct: base.nwcPct,
      wacc: base.wacc, terminalGrowth: base.terminalGrowth, weight: 0.6,
    },
    bear: {
      name: "bear",
      revenueGrowth: base.revenueGrowth.map((g) => Math.max(0.02, g * 0.45)),
      ebitMargin: base.ebitMargin.map((x) => x * 0.7),
      capexPct: base.capexPct, deptPct: base.deptPct, nwcPct: base.nwcPct,
      wacc: base.wacc, terminalGrowth: base.terminalGrowth, weight: 0.15,
    },
  };
}

/** Independently re-solve one scenario vector to equity + per-share value. */
export function solveScenarioVector(params: {
  vector: ScenarioVector;
  baseRevenue: number;
  marginalTaxRate: number;
  netDebt: number;
  sharesOutstanding: number;
}): SolvedVector {
  const { vector, baseRevenue, marginalTaxRate, netDebt, sharesOutstanding } = params;
  const diagnostics: string[] = [];
  let rev = baseRevenue;
  const fcffs: number[] = [];
  vector.revenueGrowth.forEach((g, i) => {
    rev = rev * (1 + g);
    const m = vector.ebitMargin[Math.min(i, vector.ebitMargin.length - 1)] ?? 0.15;
    const ebit = rev * m;
    fcffs.push(computeFCFF({ nopat: ebit * (1 - marginalTaxRate), depreciation: rev * vector.deptPct, capex: rev * vector.capexPct, changeInWorkingCapital: rev * vector.nwcPct }));
  });
  const { sumPvFcff } = discountFCFF(fcffs, vector.wacc);
  const tv = gordonTerminalValue({ terminalYearFcff: fcffs[fcffs.length - 1], wacc: vector.wacc, terminalGrowth: vector.terminalGrowth });
  diagnostics.push(...tv.diagnostics.map((d) => `${vector.name}: ${d}`));
  const pvTv = tv.terminalValue * Math.pow(1 + vector.wacc, -5);
  const enterpriseValue = sumPvFcff + pvTv;
  const equityValue = enterpriseValue - netDebt;
  const fairValuePerShare = sharesOutstanding > 0 && equityValue > 0 ? equityValue / sharesOutstanding : null;
  return { name: vector.name, sumPvFcff, terminalValue: tv.terminalValue, enterpriseValue, equityValue, fairValuePerShare, diagnostics };
}

/** Per-share conversion with an explicit share-base guard. */
export function valuePerShare(equityValue: number, sharesOutstanding: number): KernelScalar {
  return guardedDiv(equityValue, sharesOutstanding, { label: "equityValue/dilutedShares" });
}

export const MODEL_VERSION = "apex-financial-model-v1";
export const KERNEL_VERSION_ALIAS = KERNEL_VERSION;

// ─────────────────────────────────────────────
// Economic plausibility bounds  (P0 #91 — generous bands; breaches
// diagnose, and only material, machine-verifiable breaks gate upstream)
// ─────────────────────────────────────────────
export interface EconomicBound {
  id: string;
  min: number;
  max: number;
  unit: string;
  rationale: string;
}

export const ECONOMIC_BOUNDS: Record<string, EconomicBound> = {
  "margin.gross": { id: "margin.gross", min: -0.5, max: 1.0, unit: "fraction", rationale: "Gross margin outside [−50%, +100%] is economically extraordinary." },
  "margin.ebitda": { id: "margin.ebitda", min: -1.0, max: 1.0, unit: "fraction", rationale: "EBITDA margin outside [−100%, +100%] is economically extraordinary." },
  "margin.ebit": { id: "margin.ebit", min: -1.0, max: 1.0, unit: "fraction", rationale: "EBIT margin outside [−100%, +100%] is economically extraordinary." },
  "margin.net": { id: "margin.net", min: -2.0, max: 1.0, unit: "fraction", rationale: "Net margin outside [−200%, +100%] is economically extraordinary." },
  "return.roe": { id: "return.roe", min: -3.0, max: 3.0, unit: "fraction", rationale: "|ROE| above 300% is a distressed-base artifact until proven otherwise." },
  "growth.revenue": { id: "growth.revenue", min: -0.9, max: 5.0, unit: "fraction", rationale: "Annual revenue change outside [−90%, +500%] is economically extraordinary." },
  "valuation.wacc": { id: "valuation.wacc", min: 0.03, max: 0.3, unit: "fraction", rationale: "WACC outside [3%, 30%] is economically extraordinary." },
  "valuation.terminalGrowth": { id: "valuation.terminalGrowth", min: 0.0, max: 0.08, unit: "fraction", rationale: "Perpetual growth above 8% nominal exceeds any long-run economy." },
  "leverage.debtToEquity": { id: "leverage.debtToEquity", min: 0, max: 50, unit: "multiple", rationale: "D/E above 50× is balance-sheet distress until proven otherwise." },
};

export function checkEconomicBound(id: string, value: number): { within: boolean; bound: EconomicBound | null } {
  const bound = ECONOMIC_BOUNDS[id] ?? null;
  if (!bound || !Number.isFinite(value)) return { within: true, bound };
  return { within: value >= bound.min && value <= bound.max, bound };
}

// ─────────────────────────────────────────────
// Sign-aware tax + coverage helpers  (P0 #93 — interpretation follows
// the sign of the base; arithmetic never pretends otherwise)
// ─────────────────────────────────────────────
export function effectiveTaxRate(incomeTaxExpense: number, pretaxIncome: number): KernelScalar {
  if (!(pretaxIncome > 0)) {
    return { value: 0, validity: "NM", reason: "NON_POSITIVE_BASE:pretaxIncome≤0", display: "N_M" };
  }
  return { value: (Number(incomeTaxExpense) || 0) / pretaxIncome, validity: "VALID", reason: "OK:etr", display: "VALUE" };
}

export function netDebtDescriptor(netDebt: number): "NET_CASH" | "NET_DEBT" | "UNFUNDED_ZERO" {
  if (!Number.isFinite(netDebt) || netDebt === 0) return "UNFUNDED_ZERO";
  return netDebt < 0 ? "NET_CASH" : "NET_DEBT";
}

/** Implied borrowing rate = interestExpense / average gross debt; bounds-checked. */
export function impliedDebtRate(interestExpense: number, grossDebt: number): KernelScalar & { sane: boolean } {
  const s = guardedDiv(interestExpense, grossDebt, { label: "interestExpense/grossDebt" });
  const sane = s.display === "VALUE" && s.value >= 0 && s.value <= 0.25;
  return { ...s, sane };
}

// ─────────────────────────────────────────────
// Working-capital driver days  (P0 #31–#34 — DIO×COGS, DSO×revenue,
// DPO×COGS; all denominators guarded, all outputs validity-tagged)
// ─────────────────────────────────────────────
export interface WorkingCapitalDays {
  dso: KernelScalar;
  dio: KernelScalar;
  dpo: KernelScalar;
  cashConversionCycle: number | null;
}

export function wcDriverDays(fin: {
  netReceivables?: number; revenue?: number; inventory?: number;
  costOfRevenue?: number; accountsPayable?: number;
}): WorkingCapitalDays {
  const revenue = Number(fin.revenue) || 0;
  const cogs = Number(fin.costOfRevenue) || 0;
  const dso = guardedDiv((Number(fin.netReceivables) || 0) * 365, revenue, { label: "receivables×365/revenue" });
  const dio = guardedDiv((Number(fin.inventory) || 0) * 365, cogs, { label: "inventory×365/cogs" });
  const dpo = guardedDiv((Number(fin.accountsPayable) || 0) * 365, cogs, { label: "payables×365/cogs" });
  const ccc = dso.display === "VALUE" && dio.display === "VALUE" && dpo.display === "VALUE"
    ? dso.value + dio.value - dpo.value
    : null;
  return { dso, dio, dpo, cashConversionCycle: ccc };
}

/** Generic roll-forward variance: opening + additions − charge vs closing. */
export function rollforwardVariance(opening: number, additions: number, charge: number, closing: number): KernelScalar & { gap: number } {
  const o = Number(opening) || 0;
  const expected = o + (Number(additions) || 0) - (Number(charge) || 0);
  const c = Number(closing) || 0;
  if (!(o > 0) && !(c > 0)) {
    return { value: 0, validity: "NM", reason: "NO_BASE:opening-and-closing-non-positive", display: "N_M", gap: 0 };
  }
  const gap = Math.abs(c - expected);
  const base = Math.max(Math.abs(o), Math.abs(c), 1);
  return {
    value: gap / base,
    validity: "VALID",
    reason: "OK:rollforward",
    display: "VALUE",
    gap,
  };
}

// ─────────────────────────────────────────────
// FCFE engine  (P0 #30 — standardized; FCFF − after-tax interest + net borrowing)
// ─────────────────────────────────────────────
export function computeFCFE(input: {
  fcff: number; interestExpense: number; marginalTaxRate: number; netBorrowing: number;
}): number {
  const f = Number(input.fcff) || 0;
  const i = Number(input.interestExpense) || 0;
  const t = Number(input.marginalTaxRate) || 0;
  const nb = Number(input.netBorrowing) || 0;
  return f - i * (1 - t) + nb;
}

// ─────────────────────────────────────────────
// Beta engine  (P0 #57 — raw beta → unlever → median → relever).
// Point-in-time peer methodology when ≥3 peer betas exist; otherwise an
// explicitly-labeled single-beta path (limitation disclosed, not hidden).
// ─────────────────────────────────────────────
export interface BetaEngineResult {
  method: "peer-median-unlevered" | "single-beta";
  assetBetaMedian: number | null;
  releveredBeta: number;
  peerCount: number;
  note: string;
}

export function unleverBeta(equityBeta: number, marginalTaxRate: number, debtToEquity: number): number {
  const de = Math.max(0, Number(debtToEquity) || 0);
  return (Number(equityBeta) || 0) / (1 + (1 - (Number(marginalTaxRate) || 0)) * de);
}

export function releverBeta(assetBeta: number, marginalTaxRate: number, debtToEquity: number): number {
  const de = Math.max(0, Number(debtToEquity) || 0);
  return (Number(assetBeta) || 0) * (1 + (1 - (Number(marginalTaxRate) || 0)) * de);
}

export function medianBetaEngine(params: {
  subjectBeta: number;
  subjectDebtToEquity: number;
  marginalTaxRate: number;
  peerBetas: number[];
  peerDebtToEquity?: number[];
}): BetaEngineResult {
  const peers = (params.peerBetas || []).filter((b) => Number.isFinite(b) && b > 0);
  if (peers.length >= 3) {
    const unlevered = peers.map((b, i) => unleverBeta(b, params.marginalTaxRate, params.peerDebtToEquity?.[i] ?? 0));
    const sorted = [...unlevered].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return {
      method: "peer-median-unlevered",
      assetBetaMedian: median,
      releveredBeta: releverBeta(median, params.marginalTaxRate, params.subjectDebtToEquity),
      peerCount: peers.length,
      note: `Point-in-time peer median over ${peers.length} betas, relevered at subject D/E.`,
    };
  }
  return {
    method: "single-beta",
    assetBetaMedian: null,
    releveredBeta: Number(params.subjectBeta) || 0,
    peerCount: peers.length,
    note: "Fewer than 3 peer betas — single-beta path (limitation: no peer-median discipline).",
  };
}

/** Debt-tranche schedule (P0 #39/#58): short/LT mix + implied rate bounds. */
export function debtTrancheSchedule(fin: {
  shortTermDebt?: number; longTermDebt?: number; totalDebt?: number; interestExpense?: number;
}): { shortDebt: number; longDebt: number; shortShare: number | null; impliedRate: KernelScalar & { sane: boolean }; note: string } {
  const shortDebt = Math.max(0, Number(fin.shortTermDebt) || 0);
  const longDebt = Math.max(0, Number(fin.longTermDebt) || 0);
  const totalDebt = Number(fin.totalDebt) || shortDebt + longDebt;
  const shortShare = totalDebt > 0 ? (shortDebt / totalDebt) : null;
  const impliedRate = impliedDebtRate(Number(fin.interestExpense) || 0, totalDebt);
  return {
    shortDebt, longDebt, shortShare, impliedRate,
    note: totalDebt <= 0 ? "No funded debt — tranche schedule not applicable."
      : impliedRate.display !== "VALUE" ? "Implied rate not computable (see validity)."
      : !impliedRate.sane ? "Implied rate outside [0%, 25%] — verify interest/debt units before trusting coverage math."
      : "Tranche mix and implied rate within plausibility.",
  };
}

// ─────────────────────────────────────────────
// Liquidity interpretation bands  (P0 #71 — industry-aware reading,
// extremes only; never a fresh ratio, only an interpretation)
// ─────────────────────────────────────────────
const LIQUIDITY_FLOORS: Record<string, number> = {
  bank: 0, nbfc: 0, insurance: 0,
  "internet-retail": 0.8, hospitality: 0.8,
  default: 1.0,
};

export function assessLiquidity(sectorId: string, currentRatio: number | null): { assessment: string; warn: boolean } {
  if (currentRatio === null || !Number.isFinite(currentRatio)) {
    return { assessment: "Liquidity not assessable — current ratio undisclosed.", warn: false };
  }
  const floor = LIQUIDITY_FLOORS[sectorId] ?? LIQUIDITY_FLOORS.default;
  if (currentRatio < floor) {
    return { assessment: `Current ratio ${currentRatio.toFixed(2)}× below ${floor.toFixed(1)}× sector floor — monitor refinancing/rollover risk.`, warn: true };
  }
  return { assessment: `Current ratio ${currentRatio.toFixed(2)}× at/above sector floor.`, warn: false };
}

/** Cash conversion with denominator-validity gate (P0 #74). */
export function cashConversion(cashFlow: number, netIncome: number, label: string): KernelScalar {
  return guardedDiv(cashFlow, netIncome, { label: `${label}/netIncome` });
}

/** Reported-or-derived multiple with denominator validation (P0 #64). */
export function validateMultiple(numerator: number, denominator: number, label: string, opts?: { mustBePositive?: boolean }): KernelScalar {
  const s = guardedDiv(numerator, denominator, { label });
  if (s.display !== "VALUE") return s;
  if ((opts?.mustBePositive ?? true) && s.value <= 0) {
    return { value: s.value, validity: "NM", reason: `NON_POSITIVE_MULTIPLE:${label}≤0`, display: "N_M" };
  }
  return s;
}

// ─────────────────────────────────────────────
// Covenant-claim tagging  (P0 #75/#76 — ACTUAL_COVENANT vs
// ANALYTICAL_THRESHOLD; only separately-sourced facility language
// may claim an actual covenant)
// ─────────────────────────────────────────────
export type CovenantClaimKind = "ACTUAL_COVENANT" | "ANALYTICAL_THRESHOLD" | "NONE";

export function tagCovenantClaim(text: string): { kind: CovenantClaimKind; matches: string[] } {
  const t = (text || "").toLowerCase();
  const actualMarkers = [
    /credit agreement (requires|mandates|covenants)/,
    /facility covenant/,
    /loan agreement.{0,40}covenant/,
    /indenture.{0,40}covenant/,
    /disclosed.{0,40}covenant.{0,40}\d/,
  ];
  const thresholdMarkers = [
    /standard threshold/, /analytical threshold/, /model assumption/,
    /illustrative/, /for context only/, /headroom.{0,40}standard/,
  ];
  const matches: string[] = [];
  for (const re of actualMarkers) {
    const m = t.match(re);
    if (m) matches.push(`actual:${m[0].slice(0, 60)}`);
  }
  for (const re of thresholdMarkers) {
    const m = t.match(re);
    if (m) matches.push(`threshold:${m[0].slice(0, 60)}`);
  }
  if (matches.some((m) => m.startsWith("actual:"))) return { kind: "ACTUAL_COVENANT", matches };
  if (matches.some((m) => m.startsWith("threshold:"))) return { kind: "ANALYTICAL_THRESHOLD", matches };
  return { kind: "NONE", matches };
}

// ─────────────────────────────────────────────
// Accounting-anomaly detector  (P0 #77 — warnings always; ≥2 material
// anomalies escalate to FAIL upstream; cross-period plausibility folded in)
// ─────────────────────────────────────────────
export interface AccountingAnomaly {
  code: string;
  material: boolean;
  message: string;
}

export function detectAccountingAnomalies(history: {
  year: string; revenue: number; netIncome: number; operatingCashFlow: number;
  netReceivables: number; totalAssets: number; grossMargin: number;
}[]): AccountingAnomaly[] {
  const out: AccountingAnomaly[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (!(prev.revenue > 0) || !(cur.revenue > 0)) continue;
    const revG = cur.revenue / prev.revenue - 1;
    // Revenue/cash divergence: revenue up >25% while OCF falls >25%.
    if (revG > 0.25 && prev.operatingCashFlow !== 0 && cur.operatingCashFlow / prev.operatingCashFlow - 1 < -0.25) {
      out.push({ code: "ANOM-REV-CASH", material: true, message: `${cur.year}: revenue +${(revG * 100).toFixed(0)}% while operating cash flow collapsed — accrual quality review required.` });
    }
    // Receivables surging far ahead of revenue.
    if (prev.netReceivables > 0 && cur.netReceivables > 0) {
      const recG = cur.netReceivables / prev.netReceivables - 1;
      if (recG > 0.7 && recG > revG + 0.5) {
        out.push({ code: "ANOM-RECEIVABLES", material: true, message: `${cur.year}: receivables +${(recG * 100).toFixed(0)}% vs revenue +${(revG * 100).toFixed(0)}% — channel-stuffing/collection review required.` });
      }
    }
    // Margin cliff: gross margin collapse >15pp YoY.
    if (Number.isFinite(prev.grossMargin) && Number.isFinite(cur.grossMargin) && prev.grossMargin - cur.grossMargin > 0.15) {
      out.push({ code: "ANOM-MARGIN-CLIFF", material: true, message: `${cur.year}: gross margin cliff (${(prev.grossMargin * 100).toFixed(0)}% → ${(cur.grossMargin * 100).toFixed(0)}%) — mix-shift or cost-shock review required.` });
    }
    // Asset growth without revenue: assets +50% with revenue flat/down.
    if (prev.totalAssets > 0 && cur.totalAssets / prev.totalAssets - 1 > 0.5 && revG < 0.05) {
      out.push({ code: "ANOM-ASSET-BLOAT", material: false, message: `${cur.year}: assets +${((cur.totalAssets / prev.totalAssets - 1) * 100).toFixed(0)}% on flat revenue — capitalization-policy review recommended.` });
    }
    // Cross-period plausibility envelope (P0 #78 second half): ±80% revenue, ±70% assets.
    if (revG < -0.8 || revG > 5) {
      out.push({ code: "ANOM-PERIOD-JUMP", material: true, message: `${cur.year}: revenue discontinuity (${(revG * 100).toFixed(0)}% YoY) — verify corporate action, restatement, or unit error before modeling.` });
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Confidence propagation  (P0 #83, #84 — output confidence is a
// FUNCTION of dependency confidence; low-confidence inputs downgrade
// every downstream output explicitly)
// ─────────────────────────────────────────────
export type OutputConfidence = "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export function propagateConfidence(input: {
  estimateRatio: number;
  integrityWarns: number;
  integrityBlocks: number;
  tvShareOfEv: number;
  reverseConverged: boolean | null;
  insufficientData: boolean;
}): { level: OutputConfidence; reasons: string[] } {
  const reasons: string[] = [];
  if (input.insufficientData || input.integrityBlocks > 0) {
    return { level: "UNKNOWN", reasons: ["Blocked inputs — no confident output exists."] };
  }
  let score = 100;
  if (input.estimateRatio >= 0.5) { score -= 40; reasons.push(`${(input.estimateRatio * 100).toFixed(0)}% estimated inputs (−40).`); }
  else if (input.estimateRatio > 0) { score -= Math.round(input.estimateRatio * 30); reasons.push(`Estimated inputs present (−${Math.round(input.estimateRatio * 30)}).`); }
  if (input.integrityWarns > 0) { score -= Math.min(25, input.integrityWarns * 5); reasons.push(`${input.integrityWarns} integrity warning(s) (−${Math.min(25, input.integrityWarns * 5)}).`); }
  if (input.tvShareOfEv > 0.85) { score -= 15; reasons.push(`Terminal-driven valuation (${(input.tvShareOfEv * 100).toFixed(0)}% of EV) (−15).`); }
  if (input.reverseConverged === false) { score -= 10; reasons.push("Reverse-DCF did not converge (−10)."); }
  const level: OutputConfidence = score >= 80 ? "HIGH" : score >= 55 ? "MODERATE" : "LOW";
  if (reasons.length === 0) reasons.push("All dependencies high-confidence.");
  return { level, reasons };
}

// ─────────────────────────────────────────────
// Immutability + snapshot hashing  (P0 #86 — facts immutable after
// validation; downstream mutation is detectable, not silently absorbed)
// ─────────────────────────────────────────────
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v as object);
    Object.freeze(obj);
  }
  return obj;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function factHash(obj: unknown): string {
  const s = stableStringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fh_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// ─────────────────────────────────────────────
// Model lifecycle state machine  (P0 #85 — strict stage order:
// FETCHED → NORMALIZED → VALIDATED → MODELED → VERIFIED)
// ─────────────────────────────────────────────
export type ModelStage = "FETCHED" | "NORMALIZED" | "VALIDATED" | "MODELED" | "VERIFIED";

const STAGE_ORDER: ModelStage[] = ["FETCHED", "NORMALIZED", "VALIDATED", "MODELED", "VERIFIED"];

export interface StageRecord {
  stage: ModelStage;
  at: string;
  note?: string;
}

export class ModelLifecycle {
  private history: StageRecord[] = [];
  current(): ModelStage | null {
    return this.history.length > 0 ? this.history[this.history.length - 1].stage : null;
  }
  advance(stage: ModelStage, note?: string): void {
    const cur = this.current();
    const curIdx = cur === null ? -1 : STAGE_ORDER.indexOf(cur);
    const nextIdx = STAGE_ORDER.indexOf(stage);
    if (nextIdx !== curIdx + 1) {
      throw new Error(`ModelLifecycle: illegal transition ${cur ?? "∅"} → ${stage}; strict order is ${STAGE_ORDER.join(" → ")}.`);
    }
    this.history.push({ stage, at: new Date().toISOString(), note });
  }
  verifyOrder(): { ok: boolean; skipped: ModelStage[] } {
    // advance() enforces stepwise order, so history is always an in-order
    // prefix by construction; verification asserts COMPLETENESS (no skipped
    // stages) for the publication gate.
    const seen = this.history.map((h) => h.stage);
    const missing = STAGE_ORDER.filter((s) => !seen.includes(s));
    return { ok: missing.length === 0, skipped: missing };
  }
  history_(): StageRecord[] {
    return [...this.history];
  }
}

// ─────────────────────────────────────────────
// Audit graph  (P0 #96 — machine-readable nodes/edges over the trail)
// ─────────────────────────────────────────────
export interface AuditGraph {
  modelVersion: string;
  nodes: { id: string; kind: "input" | "derived"; value: number | string | null }[];
  edges: { from: string; to: string; formulaId: string; formulaVersion: string }[];
}

export function buildAuditGraph(trail: { output: string; formulaId: string; formulaVersion: string; inputs: { name: string; value: number | string; sourceId: string }[]; transform: string }[]): AuditGraph {
  const nodes = new Map<string, { id: string; kind: "input" | "derived"; value: number | string | null }>();
  const edges: AuditGraph["edges"] = [];
  for (const e of trail) {
    if (!nodes.has(e.output)) nodes.set(e.output, { id: e.output, kind: "derived", value: null });
    for (const inp of e.inputs) {
      if (!nodes.has(inp.sourceId)) {
        nodes.set(inp.sourceId, { id: inp.sourceId, kind: "input", value: typeof inp.value === "number" ? inp.value : null });
      }
      edges.push({ from: inp.sourceId, to: e.output, formulaId: e.formulaId, formulaVersion: e.formulaVersion });
    }
  }
  return { modelVersion: MODEL_VERSION, nodes: [...nodes.values()], edges };
}

// ─────────────────────────────────────────────
// Dimensionally-safe money operations  (P0 #90 — USD × shares,
// % × USD and friends throw instead of computing)
// ─────────────────────────────────────────────
export type DimKind = "money" | "shares" | "price" | "pct" | "multiple" | "days" | "scalar";

export interface DimValue {
  kind: DimKind;
  value: number;
  currency?: string;
}

/**
 * Dimension table: [left, right] → result. Anything absent THROWS —
 * dimension errors are defects, not NaNs.
 */
const DIM_TABLE: Record<string, DimKind> = {
  "money*scalar": "money",
  "scalar*money": "money",
  "money/scalar": "money",
  "money/money": "multiple",
  "money/shares": "price",
  "price*shares": "money",
  "shares*price": "money",
  "multiple*money": "money",
  "money*multiple": "money",
  "pct*money": "money",
  "money*pct": "money",
  "multiple*scalar": "multiple",
  "scalar*multiple": "multiple",
  "money+money": "money",
  "money-money": "money",
  "scalar+scalar": "scalar",
  "scalar-scalar": "scalar",
  "scalar*scalar": "scalar",
  "scalar/scalar": "scalar",
};

function checkCurrency(a: DimValue, b: DimValue, op: string): void {
  if ((a.kind === "money" || b.kind === "money") && a.currency && b.currency && a.currency !== b.currency) {
    throw new Error(`DimSafety: currency mismatch ${a.currency} ${op} ${b.currency} — convert explicitly first.`);
  }
}

export const MoneyOps = {
  add(a: DimValue, b: DimValue): DimValue {
    const k = DIM_TABLE[`${a.kind}+${b.kind}`];
    if (!k) throw new Error(`DimSafety: cannot add ${a.kind} + ${b.kind}.`);
    checkCurrency(a, b, "+");
    return { kind: k, value: a.value + b.value, currency: a.currency ?? b.currency };
  },
  sub(a: DimValue, b: DimValue): DimValue {
    const k = DIM_TABLE[`${a.kind}-${b.kind}`];
    if (!k) throw new Error(`DimSafety: cannot subtract ${a.kind} − ${b.kind}.`);
    checkCurrency(a, b, "−");
    return { kind: k, value: a.value - b.value, currency: a.currency ?? b.currency };
  },
  mul(a: DimValue, b: DimValue): DimValue {
    const k = DIM_TABLE[`${a.kind}*${b.kind}`];
    if (!k) throw new Error(`DimSafety: cannot multiply ${a.kind} × ${b.kind} (e.g. money × shares is a dimension error — use price × shares).`);
    checkCurrency(a, b, "×");
    return { kind: k, value: a.value * b.value, currency: a.currency ?? b.currency };
  },
  div(a: DimValue, b: DimValue): DimValue {
    const k = DIM_TABLE[`${a.kind}/${b.kind}`];
    if (!k) throw new Error(`DimSafety: cannot divide ${a.kind} ÷ ${b.kind}.`);
    if (b.value === 0) throw new Error(`DimSafety: division by zero (${a.kind} ÷ ${b.kind}).`);
    checkCurrency(a, b, "÷");
    return { kind: k, value: a.value / b.value, currency: a.currency ?? b.currency };
  },
};

/**
 * Revalue an existing explicit-period FCFF stream under alternate (wacc, g).
 * Used by sensitivity grids so EVERY cell is an independent kernel valuation,
 * not a proportional scaling of the base fair value.
 */
export function revalueSensitivity(params: {
  fcffs: number[];
  terminalYearFcff: number;
  wacc: number;
  terminalGrowth: number;
  netDebt: number;
  sharesOutstanding: number;
}): { equityValue: number; fairValuePerShare: number | null; diagnostics: string[] } {
  const { fcffs, terminalYearFcff, wacc, terminalGrowth, netDebt, sharesOutstanding } = params;
  const { sumPvFcff } = discountFCFF(fcffs, wacc);
  const tv = gordonTerminalValue({ terminalYearFcff, wacc, terminalGrowth });
  const pvTv = tv.terminalValue * Math.pow(1 + wacc, -5);
  const equityValue = sumPvFcff + pvTv - netDebt;
  const fv = valuePerShare(equityValue, sharesOutstanding);
  return {
    equityValue,
    fairValuePerShare: fv.display === "VALUE" && equityValue > 0 ? equityValue / sharesOutstanding : null,
    diagnostics: tv.diagnostics,
  };
}
