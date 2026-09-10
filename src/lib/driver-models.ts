/**
 * APEX RESEARCH - Sector / Segment Driver Forecast Models (Priority 3)
 *
 * Replaces the single generic revenue-CAGR + margin-ramp with per-business-type
 * driver equations, then consolidates into group revenue/margin/capex/NWC.
 * No driver value is hallucinated: each model documents its equation, caps,
 * and the reported history it is anchored to. Where Yahoo carries no unit
 * economics (deliveries, occupancy, users), the model applies a sector-native
 * fade/shape overlay on top of reported revenue — explicitly labeled, never
 * presented as measured units.
 */
import type { SectorId } from "./sectors/types";
import type { GICSSector } from "./company-archetype";

export interface DriverForecast {
  revenueGrowthRates: number[];
  ebitMargins: number[];
  avgCapexPct: number;
  avgDeptPct: number;
  avgNwcChangePct: number;
  terminalGrowthRate: number;
  driverEquation: string;
  basis: Record<string, string>;
  /** D&A rate on opening net PPE when a usable PPE stock exists; null → revenue-based fallback. */
  depOnPpeRate: number | null;
}

interface DriverInputs {
  cagr: number;
  winsorizedCagr: number;
  winsorizedLive: number;
  baseGrowth: number;
  hasLive: boolean;
  liveRevGrowth: number;
  years: number;
  effectiveMargin: number;
  rawAvgCapexPct: number;
  rawAvgDeptPct: number;
  /** Mean(D&A_t / netPPE_{t-1}) over history; 0/missing → revenue-based D&A. */
  rawAvgDepOnPpe?: number;
  /** Latest net PPE stock (forecast opening balance); missing → revenue-based D&A. */
  ppeBase?: number;
  /** True when the continuity guard trimmed a live-growth spike (disclosure). */
  continuityCapped?: boolean;
}

/** Sector-native fade shapes: how fast base growth decays over 5y. */
const FADE_SHAPES: Record<string, number[]> = {
  default: [1.0, 0.9, 0.82, 0.74, 0.66],
  hospitality: [1.0, 0.88, 0.76, 0.65, 0.55], // occupancy ramp saturates
  auto: [1.0, 0.85, 0.7, 0.58, 0.48], // cycle-capped
  "technology-hardware": [1.0, 0.87, 0.74, 0.62, 0.52], // replacement-cycle capped, no SaaS compounding
  "technology-software": [1.0, 0.92, 0.84, 0.76, 0.68], // sticky NRR compounding, slow fade
  "it-services": [1.0, 0.92, 0.84, 0.76, 0.68], // sticky, slow fade
  telecom: [1.0, 0.9, 0.8, 0.7, 0.6],
  pharma: [1.0, 0.9, 0.8, 0.7, 0.6],
  bank: [1.0, 0.95, 0.9, 0.85, 0.8], // book compounding, not used in DCF path
  nbfc: [1.0, 0.95, 0.9, 0.85, 0.8], // book compounding, not used in DCF path
  insurance: [1.0, 0.94, 0.88, 0.82, 0.76], // premium compounding, not used in DCF path
  "real-estate": [1.0, 0.9, 0.8, 0.7, 0.6], // lease-escalation annuity, occupancy-capped
  "asset-management": [1.0, 0.93, 0.86, 0.79, 0.72], // AUM compounding + operating leverage
  "ratings-agency": [1.0, 0.93, 0.86, 0.79, 0.72], // issuance-cycle linked, asset-light
};

/** Sector terminal growth anchors (nominal, cyclical-aware). */
export const SECTOR_TERMINAL_GROWTH: Record<string, number> = {
  hospitality: 0.035,
  "real-estate": 0.03,
  "technology-hardware": 0.035, // cyclical device demand — never SaaS perpetuity
  "technology-software": 0.04,
  auto: 0.035,
  "it-services": 0.04,
  telecom: 0.035,
  pharma: 0.035,
  consumer: 0.04,
  industrial: 0.035,
  "renewable-energy": 0.035,
  utilities: 0.035,
  agrochemical: 0.035,
  cement: 0.035,
  "internet-platform": 0.04,
  "internet-retail": 0.04,
  bank: 0.05,
  nbfc: 0.05,
  insurance: 0.05,
  "asset-management": 0.045,
  "ratings-agency": 0.045,
  general: 0.04,
};

export function getFadeShape(sectorId: SectorId | string): number[] {
  return FADE_SHAPES[sectorId] ?? FADE_SHAPES.default;
}

export function getSectorTerminalGrowth(sectorId: SectorId | string): number {
  return SECTOR_TERMINAL_GROWTH[sectorId] ?? 0.04;
}

/**
 * Build a driver-native forecast. The revenue equation differs by business type;
 * capex/NWC/margin overlays are sector-calibrated. All outputs remain
 * revenue-linked (Yahoo has no unit economics) but shaped by driver logic.
 */
export function computeDriverForecast(params: {
  sectorId: SectorId | string;
  operatingArchetype: GICSSector | string;
  inputs: DriverInputs;
}): DriverForecast {
  const { sectorId, operatingArchetype, inputs } = params;
  const fade = getFadeShape(sectorId);
  const revenueGrowthRates = fade.map((f) => inputs.baseGrowth * f);

  // Margin ramp: hospitality EBITDAR-derived, auto cycle-capped, IT sticky, default generic.
  // Every branch cap is max(branchCap, 102% of the effective-margin seed) — caps
  // bind runaway ramps off low seeds only and can never cut the forecast below
  // demonstrated profitability (the 14%-style decapitation that printed a $165
  // SELL on a 47%-margin compounder).
  let ebitMargins: number[];
  let driverEquation: string;
  if (sectorId === "hospitality" || sectorId === "real-estate" || String(operatingArchetype).startsWith("hospitality")) {
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.03].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.3, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = Available Room Nights × Occupancy% × ADR × (1 + F&B/MICE mix) + fee annuity; GOP → EBITDAR − rent → EBIT";
  } else if (sectorId === "auto" || operatingArchetype === "auto_manufacturing") {
    ebitMargins = [0.008, 0.014, 0.018, 0.021, 0.023].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.22, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = Σ(model deliveries × ASP) + parts/services + storage; margin ex-regulatory-credits, cost-down vs price-cuts";
  } else if (sectorId === "technology-hardware" || operatingArchetype === "technology_hardware") {
    // Hardware: segment units × ASP × mix; gross margin via mix/component economics;
    // inventory + channel working capital explicit. No NRR/MSA/consulting compounding.
    ebitMargins = [0.006, 0.012, 0.017, 0.021, 0.024].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.28, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = Σ(segment units × ASP × mix) + services attach; gross margin = mix − component costs (memory/display/silicon); WC = channel + finished-goods inventory − supplier payables";
  } else if (sectorId === "technology-software" || sectorId === "it-services" || operatingArchetype === "technology_software") {
    ebitMargins = [0.008, 0.014, 0.019, 0.023, 0.026].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.32, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = billed headcount × utilization × realization + TCV conversion; margin = pricing − wage inflation − attrition drag";
  } else if (sectorId === "internet-platform") {
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.03].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.38, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = DAU/MAU × ad impressions × average price per ad; margin = ad leverage − AI infra capex − Reality Labs drag";
  } else if (sectorId === "internet-retail") {
    ebitMargins = [0.006, 0.012, 0.017, 0.021, 0.024].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.2, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = orders × AOV × take rate; margin = contribution − fulfillment − incentives";
  } else if (sectorId === "bank" || sectorId === "nbfc") {
    // Depository forecast is loan-growth/NIM-driven (residual-income corroboration;
    // banks never ride the FCFF path, so this shapes narrative + canonical forecast only).
    ebitMargins = [0.006, 0.011, 0.015, 0.018, 0.02].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.3, inputs.effectiveMargin * 1.02)));
    driverEquation = "Advances(t+1) = advances(t) × (1 + credit growth); NII = avg advances × NIM; PPOP = NII + fees − opex; PAT = PPOP − credit costs − tax; book via retained earnings + CRAR";
  } else if (sectorId === "insurance") {
    // Insurer forecast is premium/underwriting/float-driven (residual-income corroboration).
    ebitMargins = [0.006, 0.011, 0.015, 0.018, 0.02].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.28, inputs.effectiveMargin * 1.02)));
    driverEquation = "GWP × retention → NEP; claims (loss ratio) + acquisition/opex (expense ratio) → underwriting result; + float × investment yield → PAT; solvency via retained earnings";
  } else if (sectorId === "real-estate") {
    // REIT forecast is lease-annuity-driven: area × occupancy × rent × escalation → NOI → FFO → AFFO.
    ebitMargins = [0.008, 0.014, 0.019, 0.023, 0.026].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.32, inputs.effectiveMargin * 1.02)));
    driverEquation = "Rental = leasable area × occupancy × rent/sqft × (1 + escalation); NOI = rental − property opex; FFO = NI + RE depreciation − gains; AFFO = FFO − maint. capex − leasing";
  } else if (sectorId === "asset-management" || sectorId === "ratings-agency") {
    // Fee-franchise forecast is AUM/flow/fee-rate-driven with operating leverage (capex-light, WC-light).
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.031].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.4, inputs.effectiveMargin * 1.02)));
    driverEquation = "Fee revenue = avg AUM × fee realization (bps) + performance fees + platform/analytics; margin = operating leverage − compensation ratio; FCF ≈ NI (capex-light)";
  } else if (sectorId === "telecom") {
    ebitMargins = [0.008, 0.015, 0.02, 0.024, 0.027].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.35, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = subscribers × ARPU (tariff × mix); margin = operating leverage − network opex − spectrum amortization";
  } else if (sectorId === "pharma") {
    ebitMargins = [0.008, 0.015, 0.02, 0.024, 0.027].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.3, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = volumes × realization by market (domestic chronic + US generics + API); margin = mix − R&D − USFDA remediation";
  } else if (operatingArchetype === "energy_petrochem") {
    // Energy / diversified-conglomerate: segment-mix economics named explicitly
    // (O2C throughput×crack margin + Digital subs×ARPU + Retail throughput +
    // E&P volumes + New Energy buildout). Yahoo carries no segment split, so the
    // equation stays revenue-linked and labeled consolidated — segment NAMES are
    // operating-mix disclosure, never hallucinated units. Capex floor reflects
    // concurrent buildouts (network, stores, giga-factories); fade is
    // cycle-aware (commodity mid-cycle reversion), not SaaS compounding.
    ebitMargins = [0.008, 0.014, 0.019, 0.023, 0.026].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.28, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = Σ(segment mix: O2C throughput × refining/petrochem margin + Digital subscribers × ARPU + Retail throughput + E&P volumes + New Energy) — consolidated, segment split undisclosed; margin = mix shift to consumer/tech + O2C mid-cycle − New Energy drag; WC consolidated across segments (no single-CCC read-across)";
  } else {
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.03].map((r) => Math.min(inputs.effectiveMargin + r, Math.max(0.3, inputs.effectiveMargin * 1.02)));
    driverEquation = "Revenue = volume × realization × mix (consolidated; segment split undisclosed — no unit hallucination)";
  }

  // Capex / NWC overlays. General cap is 12% (the old 8% halved reported
  // intensity for capex-heavy names — Reliance runs 11–17% — and manufactured
  // negative-to-positive FCF distortion vs history).
  let avgCapexPct = Math.min(0.12, Math.max(0.025, inputs.rawAvgCapexPct || 0.04));
  let avgDeptPct = Math.min(0.06, Math.max(0.02, inputs.rawAvgDeptPct || 0.035));
  let avgNwcChangePct = 0.02;
  // PP&E-anchored depreciation: when D&A-on-opening-PPE history is available the
  // forecast depreciates the PP&E stock (roll-forward) instead of revenue. Rate
  // and base arrive via inputs; builders own the stock recursion.
  const depOnPpeRate = inputs.rawAvgDepOnPpe && inputs.rawAvgDepOnPpe > 0 && inputs.rawAvgDepOnPpe < 0.5 && (inputs.ppeBase ?? 0) > 0
    ? inputs.rawAvgDepOnPpe
    : null;
  if (sectorId === "technology-hardware") { avgCapexPct = Math.max(avgCapexPct, 0.05); avgDeptPct = Math.max(avgDeptPct, 0.035); avgNwcChangePct = 0.025; }
  else if (sectorId === "technology-software") { avgCapexPct = Math.min(avgCapexPct, 0.03); avgNwcChangePct = 0.015; }
  else if (sectorId === "hospitality") { avgCapexPct = Math.max(avgCapexPct, 0.06); avgDeptPct = Math.max(avgDeptPct, 0.04); avgNwcChangePct = 0.012; }
  else if (sectorId === "real-estate") { avgCapexPct = Math.max(avgCapexPct, 0.045); avgNwcChangePct = 0.008; }
  else if (sectorId === "auto") { avgCapexPct = Math.max(avgCapexPct, 0.06); avgNwcChangePct = 0.018; }
  else if (sectorId === "it-services") { avgCapexPct = Math.min(avgCapexPct, 0.03); avgNwcChangePct = 0.02; }
  else if (sectorId === "telecom") { avgCapexPct = Math.max(avgCapexPct, 0.07); avgNwcChangePct = 0.012; }
  else if (sectorId === "internet-platform") { avgCapexPct = Math.max(avgCapexPct, 0.05); avgNwcChangePct = 0.012; }
  else if (sectorId === "bank" || sectorId === "nbfc" || sectorId === "insurance") { avgCapexPct = Math.min(avgCapexPct, 0.025); avgDeptPct = Math.min(avgDeptPct, 0.02); avgNwcChangePct = 0.005; }
  else if (sectorId === "asset-management" || sectorId === "ratings-agency") { avgCapexPct = Math.min(avgCapexPct, 0.025); avgNwcChangePct = 0.01; }
  else if (operatingArchetype === "energy_petrochem") { avgCapexPct = Math.max(avgCapexPct, 0.08); avgNwcChangePct = 0.018; }

  const terminalGrowthRate = getSectorTerminalGrowth(sectorId);
  const basis: Record<string, string> = {
    revenueGrowth: `${driverEquation}; base ${(inputs.baseGrowth * 100).toFixed(1)}% fading ×${fade.slice(1).join("/")}${inputs.continuityCapped ? ` (continuity-capped: live spike cut to hist+10pp — see diagnostics)` : ""}`,
    ebitMargin: `Driver-shaped ramp on effective margin ${(inputs.effectiveMargin * 100).toFixed(1)}% (${sectorId})`,
    terminal: `${(terminalGrowthRate * 100).toFixed(1)}% sector anchor (${sectorId})`,
    depreciation: depOnPpeRate !== null
      ? `PP&E roll-forward: D&A ${(depOnPpeRate * 100).toFixed(2)}% of opening net PPE (hist mean ${(inputs.rawAvgDeptPct * 100).toFixed(1)}% of revenue shown for reference)`
      : `D&A ${(avgDeptPct * 100).toFixed(1)}% of revenue (no usable PPE stock — revenue-based fallback)`,
  };
  return { revenueGrowthRates, ebitMargins, avgCapexPct, avgDeptPct, avgNwcChangePct, terminalGrowthRate, driverEquation, basis, depOnPpeRate };
}

// ─────────────────────────────────────────────
// Sector-native driver sets — forecasts built from operating drivers, not the
// generic revenue-growth/EBIT-margin model. Every path is anchored to reported
// history with bounded fade toward a sustainable anchor; undisclosed unit
// economics (occupancy, AUM) are never hallucinated — paths stay revenue-linked
// and labeled as such.
// ─────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function histCagr(first: number, last: number, periods: number): number {
  if (!(first > 0) || !(last > 0) || periods < 1) return 0;
  const c = Math.pow(last / first, 1 / periods) - 1;
  return Number.isFinite(c) ? clamp(c, -0.2, 0.5) : 0;
}

/** Architecture B driver set: loan-book growth, NIM, cost-to-income, credit costs. */
export interface BankDriverSet {
  loanGrowthRates: number[];
  nimPath: number[];
  costToIncomePath: number[];
  creditCostPath: number[]; // provisions / loans
  driverEquation: string;
  basis: Record<string, string>;
}

export function buildBankDriverSet(params: {
  loans: number[];
  netInterestIncome: number[];
  totalRevenue: number[];
  nonInterestExpenses: number[];
  provisions: number[];
}): BankDriverSet {
  const { loans, netInterestIncome, totalRevenue, nonInterestExpenses, provisions } = params;
  const n = Math.max(loans.length, 2);
  const baseLoanGrowth = clamp(histCagr(loans[0] || 0, loans[loans.length - 1] || 0, n - 1) || 0.1, 0.03, 0.25);
  const fade = getFadeShape("bank");
  const loanGrowthRates = fade.map((f) => baseLoanGrowth * f);
  const lastNim = loans.length > 0 && (loans[loans.length - 1] || 0) > 0
    ? (netInterestIncome[netInterestIncome.length - 1] || 0) / (loans[loans.length - 1] || 1)
    : 0.03;
  const nimAnchor = clamp(lastNim || 0.03, 0.015, 0.06);
  const nimPath = [0, 1, 2, 3, 4].map((i) => clamp(nimAnchor * (1 - 0.02 * i), 0.015, 0.06));
  const lastCti = (totalRevenue[totalRevenue.length - 1] || 0) > 0
    ? (nonInterestExpenses[nonInterestExpenses.length - 1] || 0) / (totalRevenue[totalRevenue.length - 1] || 1)
    : 0.45;
  const ctiAnchor = clamp(lastCti || 0.45, 0.3, 0.65);
  const costToIncomePath = [0, 1, 2, 3, 4].map((i) => clamp(ctiAnchor * (1 - 0.015 * i), 0.3, 0.65));
  const lastBook = loans[loans.length - 1] || 1;
  const lastCc = (provisions[provisions.length - 1] || 0) / lastBook;
  const ccAnchor = clamp(lastCc || 0.008, 0.002, 0.03);
  const creditCostPath = [0, 1, 2, 3, 4].map((i) => clamp(ccAnchor * (1 + (i >= 2 ? 0.1 : -0.05 * i)), 0.002, 0.03));
  return {
    loanGrowthRates, nimPath, costToIncomePath, creditCostPath,
    driverEquation: "Advances(t+1) = advances(t) × (1 + credit growth); NII = avg advances × NIM; PPOP − credit costs → PAT",
    basis: {
      loanGrowth: `Reported loan-book CAGR ${(baseLoanGrowth * 100).toFixed(1)}% fading ×${fade.slice(1).join("/")} (book compounding)`,
      nim: `Last reported NIM proxy ${(nimAnchor * 100).toFixed(2)}% easing 2%/yr toward through-cycle (clamped 1.5–6.0%)`,
      costToIncome: `Last ${(ctiAnchor * 100).toFixed(0)}% improving 1.5%/yr via operating leverage (clamped 30–65%)`,
      creditCost: `Last ${(ccAnchor * 100).toFixed(2)}% of loans mean-reverting (clamped 0.2–3.0%)`,
    },
  };
}

/** Architecture C driver set: GWP growth, loss/expense (combined) ratio, float yield. */
export interface InsuranceDriverSet {
  gwpGrowthRates: number[];
  lossRatioPath: number[];
  expenseRatioPath: number[];
  combinedRatioPath: number[];
  investmentYieldPath: number[];
  driverEquation: string;
  basis: Record<string, string>;
}

export function buildInsuranceDriverSet(params: {
  gwp: number[];
  lossRatio: number[];
  expenseRatio: number[];
  investmentIncome: number[];
  float: number[];
}): InsuranceDriverSet {
  const { gwp, lossRatio, expenseRatio, investmentIncome, float } = params;
  const n = Math.max(gwp.length, 2);
  const baseGwpGrowth = clamp(histCagr(gwp[0] || 0, gwp[gwp.length - 1] || 0, n - 1) || 0.1, 0.02, 0.25);
  const fade = getFadeShape("insurance");
  const gwpGrowthRates = fade.map((f) => baseGwpGrowth * f);
  const lastLoss = lossRatio[lossRatio.length - 1] ?? 0.65;
  const lastExp = expenseRatio[expenseRatio.length - 1] ?? 0.25;
  const lossAnchor = clamp(lastLoss || 0.65, 0.4, 0.95);
  const expAnchor = clamp(lastExp || 0.25, 0.1, 0.45);
  const lossRatioPath = [0, 1, 2, 3, 4].map((i) => clamp(lossAnchor * (1 - 0.01 * i), 0.4, 0.95));
  const expenseRatioPath = [0, 1, 2, 3, 4].map((i) => clamp(expAnchor * (1 - 0.015 * i), 0.1, 0.45));
  const combinedRatioPath = lossRatioPath.map((l, i) => l + expenseRatioPath[i]);
  const lastFloat = float[float.length - 1] || 0;
  const lastYield = lastFloat > 0 ? (investmentIncome[investmentIncome.length - 1] || 0) / lastFloat : 0.07;
  const yieldAnchor = clamp(lastYield || 0.07, 0.02, 0.12);
  const investmentYieldPath = [0, 1, 2, 3, 4].map(() => yieldAnchor);
  return {
    gwpGrowthRates, lossRatioPath, expenseRatioPath, combinedRatioPath, investmentYieldPath,
    driverEquation: "GWP × retention → NEP; claims (loss ratio) + expenses → underwriting result; + float × yield → PAT",
    basis: {
      gwpGrowth: `Reported GWP CAGR ${(baseGwpGrowth * 100).toFixed(1)}% fading ×${fade.slice(1).join("/")} (premium compounding)`,
      combined: `Last loss ${(lossAnchor * 100).toFixed(0)}% + expense ${(expAnchor * 100).toFixed(0)}% improving via scale (combined <100% = UW profit)`,
      floatYield: `Last ${(yieldAnchor * 100).toFixed(1)}% held flat (rate-cycle neutral; clamped 2–12%)`,
    },
  };
}

/** Architecture D driver set: rental growth (escalation-led), NOI margin, FFO/AFFO conversion. */
export interface ReitDriverSet {
  rentalGrowthRates: number[];
  noiMarginPath: number[];
  ffoPerShareGrowth: number[];
  driverEquation: string;
  basis: Record<string, string>;
}

export function buildReitDriverSet(params: {
  rental: number[];
  noiMargin: number[];
  ffoPerShare: number[];
}): ReitDriverSet {
  const { rental, noiMargin, ffoPerShare } = params;
  const n = Math.max(rental.length, 2);
  const baseRentalGrowth = clamp(histCagr(rental[0] || 0, rental[rental.length - 1] || 0, n - 1) || 0.06, 0.01, 0.15);
  const fade = getFadeShape("real-estate");
  const rentalGrowthRates = fade.map((f) => baseRentalGrowth * f);
  const lastNoi = noiMargin[noiMargin.length - 1] ?? 0.7;
  const noiAnchor = clamp(lastNoi || 0.7, 0.4, 0.9);
  const noiMarginPath = [0, 1, 2, 3, 4].map((i) => clamp(noiAnchor + 0.003 * i, 0.4, 0.9));
  const ffoGrowthBase = clamp(histCagr(Math.abs(ffoPerShare[0]) || 0, Math.abs(ffoPerShare[ffoPerShare.length - 1]) || 0, n - 1) || baseRentalGrowth, 0.0, 0.15);
  const ffoPerShareGrowth = fade.map((f) => ffoGrowthBase * f);
  return {
    rentalGrowthRates, noiMarginPath, ffoPerShareGrowth,
    driverEquation: "Rental = area × occupancy × rent × (1 + escalation); NOI margin − interest → FFO → AFFO",
    basis: {
      rentalGrowth: `Reported rental CAGR ${(baseRentalGrowth * 100).toFixed(1)}% fading ×${fade.slice(1).join("/")} (escalation annuity, occupancy-capped)`,
      noiMargin: `Last ${(noiAnchor * 100).toFixed(0)}% edging +30bps/yr via escalation vs opex (clamped 40–90%)`,
      ffo: `FFO/share growth ${(ffoGrowthBase * 100).toFixed(1)}% base (NAREIT-style: NI + RE depreciation − gains)`,
    },
  };
}

/** Architecture E driver set: fee-revenue growth, operating margin (operating leverage), FCF conversion. */
export interface AssetLightDriverSet {
  feeGrowthRates: number[];
  operatingMarginPath: number[];
  fcfConversionPath: number[];
  driverEquation: string;
  basis: Record<string, string>;
}

export function buildAssetLightDriverSet(params: {
  feeRevenue: number[];
  operatingMargin: number[];
  fcfConversion: number[];
}): AssetLightDriverSet {
  const { feeRevenue, operatingMargin, fcfConversion } = params;
  const n = Math.max(feeRevenue.length, 2);
  const baseFeeGrowth = clamp(histCagr(feeRevenue[0] || 0, feeRevenue[feeRevenue.length - 1] || 0, n - 1) || 0.1, 0.02, 0.3);
  // Ratings agencies share the fee fade (issuance-cycle linked, asset-light).
  const fade = getFadeShape("asset-management");
  const feeGrowthRates = fade.map((f) => baseFeeGrowth * f);
  const lastOp = operatingMargin[operatingMargin.length - 1] ?? 0.3;
  const opAnchor = clamp(lastOp || 0.3, 0.05, 0.55);
  const operatingMarginPath = [0, 1, 2, 3, 4].map((i) => clamp(opAnchor + 0.008 * i, 0.05, 0.55));
  const lastConv = fcfConversion[fcfConversion.length - 1] ?? 0.9;
  const convAnchor = clamp(lastConv || 0.9, 0.3, 1.5);
  const fcfConversionPath = [0, 1, 2, 3, 4].map(() => convAnchor);
  return {
    feeGrowthRates, operatingMarginPath, fcfConversionPath,
    driverEquation: "Fee revenue = avg AUM × fee realization + performance + platform; margin = operating leverage − compensation",
    basis: {
      feeGrowth: `Reported fee CAGR ${(baseFeeGrowth * 100).toFixed(1)}% fading ×${fade.slice(1).join("/")} (AUM compounding + operating leverage)`,
      operatingMargin: `Last ${(opAnchor * 100).toFixed(0)}% expanding +80bps/yr via scale (clamped 5–55%; meaningful for fee franchises)`,
      fcfConversion: `Last ${(convAnchor * 100).toFixed(0)}% held flat (capex-light by construction)`,
    },
  };
}
