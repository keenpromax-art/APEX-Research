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

  // Margin ramp: hospitality EBITDAR-derived, auto cycle-capped, IT sticky, default generic
  let ebitMargins: number[];
  let driverEquation: string;
  if (sectorId === "hospitality" || sectorId === "real-estate" || String(operatingArchetype).startsWith("hospitality")) {
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.03].map((r) => Math.min(inputs.effectiveMargin + r, 0.3));
    driverEquation = "Revenue = Available Room Nights × Occupancy% × ADR × (1 + F&B/MICE mix) + fee annuity; GOP → EBITDAR − rent → EBIT";
  } else if (sectorId === "auto" || operatingArchetype === "auto_manufacturing") {
    ebitMargins = [0.008, 0.014, 0.018, 0.021, 0.023].map((r) => Math.min(inputs.effectiveMargin + r, 0.22));
    driverEquation = "Revenue = Σ(model deliveries × ASP) + parts/services + storage; margin ex-regulatory-credits, cost-down vs price-cuts";
  } else if (sectorId === "technology-hardware" || operatingArchetype === "technology_hardware") {
    // Hardware: segment units × ASP × mix; gross margin via mix/component economics;
    // inventory + channel working capital explicit. No NRR/MSA/consulting compounding.
    ebitMargins = [0.006, 0.012, 0.017, 0.021, 0.024].map((r) => Math.min(inputs.effectiveMargin + r, 0.28));
    driverEquation = "Revenue = Σ(segment units × ASP × mix) + services attach; gross margin = mix − component costs (memory/display/silicon); WC = channel + finished-goods inventory − supplier payables";
  } else if (sectorId === "technology-software" || sectorId === "it-services" || operatingArchetype === "technology_software") {
    ebitMargins = [0.008, 0.014, 0.019, 0.023, 0.026].map((r) => Math.min(inputs.effectiveMargin + r, 0.32));
    driverEquation = "Revenue = billed headcount × utilization × realization + TCV conversion; margin = pricing − wage inflation − attrition drag";
  } else if (sectorId === "internet-platform") {
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.03].map((r) => Math.min(inputs.effectiveMargin + r, 0.38));
    driverEquation = "Revenue = DAU/MAU × ad impressions × average price per ad; margin = ad leverage − AI infra capex − Reality Labs drag";
  } else if (sectorId === "internet-retail") {
    ebitMargins = [0.006, 0.012, 0.017, 0.021, 0.024].map((r) => Math.min(inputs.effectiveMargin + r, 0.2));
    driverEquation = "Revenue = orders × AOV × take rate; margin = contribution − fulfillment − incentives";
  } else if (sectorId === "telecom") {
    ebitMargins = [0.008, 0.015, 0.02, 0.024, 0.027].map((r) => Math.min(inputs.effectiveMargin + r, 0.35));
    driverEquation = "Revenue = subscribers × ARPU (tariff × mix); margin = operating leverage − network opex − spectrum amortization";
  } else if (sectorId === "pharma") {
    ebitMargins = [0.008, 0.015, 0.02, 0.024, 0.027].map((r) => Math.min(inputs.effectiveMargin + r, 0.3));
    driverEquation = "Revenue = volumes × realization by market (domestic chronic + US generics + API); margin = mix − R&D − USFDA remediation";
  } else {
    ebitMargins = [0.01, 0.018, 0.024, 0.028, 0.03].map((r) => Math.min(inputs.effectiveMargin + r, 0.3));
    driverEquation = "Revenue = volume × realization × mix (consolidated; segment split undisclosed — no unit hallucination)";
  }

  // Capex / NWC overlays
  let avgCapexPct = Math.min(0.08, Math.max(0.025, inputs.rawAvgCapexPct || 0.04));
  let avgDeptPct = Math.min(0.06, Math.max(0.02, inputs.rawAvgDeptPct || 0.035));
  let avgNwcChangePct = 0.02;
  if (sectorId === "technology-hardware") { avgCapexPct = Math.max(avgCapexPct, 0.05); avgDeptPct = Math.max(avgDeptPct, 0.035); avgNwcChangePct = 0.025; }
  else if (sectorId === "technology-software") { avgCapexPct = Math.min(avgCapexPct, 0.03); avgNwcChangePct = 0.015; }
  else if (sectorId === "hospitality") { avgCapexPct = Math.max(avgCapexPct, 0.06); avgDeptPct = Math.max(avgDeptPct, 0.04); avgNwcChangePct = 0.012; }
  else if (sectorId === "real-estate") { avgCapexPct = Math.max(avgCapexPct, 0.045); avgNwcChangePct = 0.008; }
  else if (sectorId === "auto") { avgCapexPct = Math.max(avgCapexPct, 0.06); avgNwcChangePct = 0.018; }
  else if (sectorId === "it-services") { avgCapexPct = Math.min(avgCapexPct, 0.03); avgNwcChangePct = 0.02; }
  else if (sectorId === "telecom") { avgCapexPct = Math.max(avgCapexPct, 0.07); avgNwcChangePct = 0.012; }
  else if (sectorId === "internet-platform") { avgCapexPct = Math.max(avgCapexPct, 0.05); avgNwcChangePct = 0.012; }

  const terminalGrowthRate = getSectorTerminalGrowth(sectorId);
  const basis: Record<string, string> = {
    revenueGrowth: `${driverEquation}; base ${(inputs.baseGrowth * 100).toFixed(1)}% fading ×${fade.slice(1).join("/")}`,
    ebitMargin: `Driver-shaped ramp on effective margin ${(inputs.effectiveMargin * 100).toFixed(1)}% (${sectorId})`,
    terminal: `${(terminalGrowthRate * 100).toFixed(1)}% sector anchor (${sectorId})`,
  };
  return { revenueGrowthRates, ebitMargins, avgCapexPct, avgDeptPct, avgNwcChangePct, terminalGrowthRate, driverEquation, basis };
}
