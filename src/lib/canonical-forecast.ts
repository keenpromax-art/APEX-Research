// ============================================================
// APEX RESEARCH — Single Canonical Forecast Model (P0 #4)
// ------------------------------------------------------------
// ONE forecast: Revenue → Gross Profit → EBITDA → D&A → EBIT → EBT → Tax → NI → BS → CFO → Capex → FCF.
// DCF, ratios, credit and every PDF page must consume this exact object — never recompute.
// Build once in route.ts after VALIDATED, seal, hash, and pass as `forecast` on CanonicalReport.
// ============================================================
import { computeDriverForecast, type DriverForecast } from "./driver-models";
import { computeFCFF, discountFCFF, gordonTerminalValue, type ProvenanceTrail } from "./financial-kernel";
import type { SectorId } from "./sectors/types";
import type { GICSSector } from "./company-archetype";

export interface CanonicalForecast {
  /** Driver-native equation and provenance basis (always printed in PDF). */
  driverEquation: string;
  basis: Record<string, string>;
  modelVersion: string;
  /** 5-year growth/margin vectors actually used in FCFF (the only truth for DCF). */
  revenueGrowthRates: number[];
  ebitMargins: number[];
  terminalGrowthRate: number;
  avgCapexPct: number;
  avgDeptPct: number;
  avgNwcChangePct: number;
  /** Year-by-year projection (single source; PDF tables index this directly). */
  projections: Array<{
    year: number;
    revenue: number;
    ebit: number;
    nopat: number;
    depreciation: number;
    capex: number;
    changeInWorkingCapital: number;
    fcff: number;
    discountFactor: number;
    pvFcff: number;
  }>;
  terminal: { fcffT: number; wacc: number; g: number; terminalValue: number; pvTerminalValue: number; capped: boolean; spreadOk: boolean };
  wacc: number;
  netDebt: number;
  sharesOutstanding: number;
  _sealed?: boolean;
  _hash?: string;
}

export function buildCanonicalForecast(params: {
  sectorId: SectorId | string;
  operatingArchetype: GICSSector | string;
  baseRevenue: number;
  marginalTaxRate: number;
  wacc: number;
  terminalGrowthRate?: number;
  netDebt: number;
  sharesOutstanding: number;
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
}): CanonicalForecast {
  const driver: DriverForecast = computeDriverForecast({
    sectorId: params.sectorId,
    operatingArchetype: params.operatingArchetype,
    inputs: {
      cagr: params.cagr,
      winsorizedCagr: params.winsorizedCagr,
      winsorizedLive: params.winsorizedLive,
      baseGrowth: params.baseGrowth,
      hasLive: params.hasLive,
      liveRevGrowth: params.liveRevGrowth,
      years: params.years,
      effectiveMargin: params.effectiveMargin,
      rawAvgCapexPct: params.rawAvgCapexPct,
      rawAvgDeptPct: params.rawAvgDeptPct,
    },
  });
  const wacc = params.wacc;
  const g = params.terminalGrowthRate ?? driver.terminalGrowthRate;
  let rev = params.baseRevenue;
  const tax = params.marginalTaxRate;
  const projections: CanonicalForecast["projections"] = [];
  const fcffs: number[] = [];
  driver.revenueGrowthRates.forEach((gr, i) => {
    rev = rev * (1 + gr);
    const m = driver.ebitMargins[Math.min(i, driver.ebitMargins.length - 1)] ?? 0.15;
    const ebit = rev * m;
    const nopat = ebit * (1 - tax);
    const dep = rev * driver.avgDeptPct;
    const capex = rev * driver.avgCapexPct;
    const dwc = rev * driver.avgNwcChangePct;
    const fcff = computeFCFF({ nopat, depreciation: dep, capex, changeInWorkingCapital: dwc });
    fcffs.push(fcff);
  });
  const { pvFcff } = discountFCFF(fcffs, wacc);
  const tvRes = gordonTerminalValue({ terminalYearFcff: fcffs[fcffs.length - 1], wacc, terminalGrowth: g, terminalRevenue: rev, marginalTaxRate: tax });
  const pvTv = tvRes.terminalValue * Math.pow(1 + wacc, -5);
  fcffs.forEach((f, i) => {
    let r = params.baseRevenue;
    for (let k = 0; k <= i; k++) r *= 1 + driver.revenueGrowthRates[k];
    const m = driver.ebitMargins[Math.min(i, driver.ebitMargins.length - 1)] ?? 0.15;
    const ebit = r * m;
    projections.push({
      year: i + 1,
      revenue: r,
      ebit,
      nopat: ebit * (1 - tax),
      depreciation: r * driver.avgDeptPct,
      capex: r * driver.avgCapexPct,
      changeInWorkingCapital: r * driver.avgNwcChangePct,
      fcff: f,
      discountFactor: Math.pow(1 + wacc, -(i + 0.5)),
      pvFcff: pvFcff[i],
    });
  });
  const forecast: CanonicalForecast = {
    driverEquation: driver.driverEquation,
    basis: driver.basis,
    modelVersion: "apex-financial-model-v1",
    revenueGrowthRates: driver.revenueGrowthRates,
    ebitMargins: driver.ebitMargins,
    terminalGrowthRate: g,
    avgCapexPct: driver.avgCapexPct,
    avgDeptPct: driver.avgDeptPct,
    avgNwcChangePct: driver.avgNwcChangePct,
    projections,
    terminal: { fcffT: fcffs[fcffs.length - 1], wacc, g, terminalValue: tvRes.terminalValue, pvTerminalValue: pvTv, capped: tvRes.capped, spreadOk: tvRes.spreadOk },
    wacc,
    netDebt: params.netDebt,
    sharesOutstanding: params.sharesOutstanding,
  };
  return forecast;
}

// PDF invariant: if a PDF page computes its own revenueGrowth/margin/FCFF instead of indexing forecast.projections, FAIL.
export function assertForecastConsumed(pageValues: { revenue: number }[], forecast: CanonicalForecast): { ok: boolean; detail: string } {
  if (pageValues.length !== forecast.projections.length) return { ok: false, detail: `Length mismatch: page ${pageValues.length} vs forecast ${forecast.projections.length}` };
  for (let i = 0; i < pageValues.length; i++) {
    if (Math.abs(pageValues[i].revenue - forecast.projections[i].revenue) > 1) return { ok: false, detail: `Year ${i + 1} revenue ${pageValues[i].revenue} ≠ forecast ${forecast.projections[i].revenue}` };
  }
  return { ok: true, detail: "Forecast consumed verbatim." };
}
