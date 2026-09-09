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
