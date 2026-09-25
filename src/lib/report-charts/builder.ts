import { stableHash } from "@/lib/research-ledger/stable";
import type { CanonicalResearchPackage } from "@/lib/research-package/types";
import type { ReportPlan } from "@/lib/report-plan/types";
import { getChartCatalogEntry, getTableCatalogEntry } from "./catalog";

export const CHART_SPEC_VERSION = "chart-spec-v1";
export const TABLE_SPEC_VERSION = "table-spec-v1";
export const CHART_BUILDER_HASH_DOMAIN = "report-charts/spec/v1";

export type SpecProvenance = "measured" | "derived" | "illustrative";
export type SpecState = "available" | "unavailable" | "not-meaningful";

export interface ChartSeriesPoint {
  period: string;
  value: number | null;
  display: string;
  state: SpecState;
  provenance: SpecProvenance;
}

export interface ChartSpec {
  version: typeof CHART_SPEC_VERSION;
  id: string;
  title: string;
  family: string;
  periods: string[];
  series: ChartSeriesPoint[];
  units: string;
  currency: string | null;
  sourceIds: string[];
  derivationIds: string[];
  provenance: SpecProvenance;
  omissionReason: string | null;
  hash: string;
}

export interface TableCell {
  display: string;
  value: number | string | null;
  state: SpecState;
}

export interface TableSpec {
  version: typeof TABLE_SPEC_VERSION;
  id: string;
  title: string;
  family: string;
  columns: string[];
  rows: Array<{ label: string; cells: TableCell[] }>;
  units: string;
  currency: string | null;
  sourceIds: string[];
  derivationIds: string[];
  provenance: SpecProvenance;
  omissionReason: string | null;
  hash: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function packageCurrency(packageValue: CanonicalResearchPackage): string | null {
  const value = (packageValue.sourceContext.profile as unknown as Record<string, unknown>).currency;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function annualRows(packageValue: CanonicalResearchPackage): Array<Record<string, unknown>> {
  return ((packageValue.sourceContext.annualFinancials ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({ ...row }));
}

function evidenceIds(packageValue: CanonicalResearchPackage): Set<string> {
  const registry = packageValue.evidenceRegistry as unknown as { items?: Array<{ id?: string }> } | undefined;
  const out = new Set<string>();
  if (registry && Array.isArray(registry.items)) {
    for (const item of registry.items) {
      if (typeof item.id === "string" && item.id) out.add(item.id);
    }
  }
  return out;
}

function forecastPeriods(packageValue: CanonicalResearchPackage): string[] {
  const rows = (packageValue.executedForecast?.incomeStatement ?? []) as Array<{ period?: string }>;
  return rows.map((row) => String(row.period ?? "Unknown"));
}

function historyPeriods(packageValue: CanonicalResearchPackage): string[] {
  return annualRows(packageValue).map((row) => String(row.year ?? row.period ?? "Unknown"));
}

function valuesForHistory(packageValue: CanonicalResearchPackage, selector: string): Array<{ period: string; value: number | null; provenance: SpecProvenance }> {
  const rows = annualRows(packageValue);
  const periods = historyPeriods(packageValue);
  const pick = (row: Record<string, unknown>): number | null => {
    if (selector === "annual-revenue") {
      const value = row.revenue ?? row.totalRevenue ?? row.totalFeeRevenue;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-profitability") {
      const value = row.netIncome;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-cash-conversion") {
      const value = row.freeCashFlow ?? row.operatingCashFlow;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-leverage") {
      const debt = row.totalDebt;
      const equity = row.totalEquity;
      if (isFiniteNumber(debt) && isFiniteNumber(equity) && (equity as number) !== 0) return (debt as number) / (equity as number);
      return null;
    }
    if (selector === "annual-returns") {
      const net = row.netIncome;
      const equity = row.totalEquity;
      if (isFiniteNumber(net) && isFiniteNumber(equity) && (equity as number) > 0) {
        const ratio = (net as number) / (equity as number);
        if (Math.abs(ratio) > 3) return null;
        return ratio;
      }
      return null;
    }
    if (selector === "annual-bank-spread") {
      const value = row.netInterestIncome ?? row.totalRevenue;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-asset-quality") {
      const value = row.provisionForCreditLosses ?? row.grossNPAPct ?? row.loans;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-capital") {
      const value = row.capitalAdequacyRatio ?? row.totalEquity;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-statements") {
      const value = row.revenue ?? row.totalRevenue;
      return isFiniteNumber(value) ? value : null;
    }
    if (selector === "annual-reit-portfolio" || selector === "annual-reit-income" || selector === "annual-research") {
      const keys = ["netOperatingIncome", "fundsFromOperations", "researchDevelopment", "occupancyPct"];
      for (const key of keys) {
        const value = row[key];
        if (isFiniteNumber(value)) return value;
      }
      return null;
    }
    return null;
  };
  return rows.map((row, index) => {
    const value = pick(row);
    return { period: periods[index] ?? "Unknown", value, provenance: value === null ? "measured" as const : "measured" as const };
  });
}

function hashChart(input: Omit<ChartSpec, "hash">): string {
  return stableHash(input, CHART_BUILDER_HASH_DOMAIN + "/chart");
}

function hashTable(input: Omit<TableSpec, "hash">): string {
  return stableHash(input, CHART_BUILDER_HASH_DOMAIN + "/table");
}

export interface BuildSpecsInput {
  packageValue: CanonicalResearchPackage;
  plan: ReportPlan;
  proposedChartIds?: string[];
  proposedTableIds?: string[];
}

function resolveChartIds(plan: ReportPlan, proposed?: string[]): string[] {
  const base = [...plan.chartRequirements];
  if (proposed) {
    for (const id of proposed) {
      const entry = getChartCatalogEntry(id);
      if (entry && !base.includes(id)) base.push(id);
    }
  }
  return [...new Set(base)].sort();
}

function resolveTableIds(plan: ReportPlan, proposed?: string[]): string[] {
  const base = [...plan.tableRequirements];
  if (proposed) {
    for (const id of proposed) {
      const entry = getTableCatalogEntry(id);
      if (entry && !base.includes(id)) base.push(id);
    }
  }
  return [...new Set(base)].sort();
}

export function buildChartSpecs(input: BuildSpecsInput): { specs: ChartSpec[]; omitted: ChartSpec[] } {
  const currency = packageCurrency(input.packageValue);
  const ids = resolveChartIds(input.plan, input.proposedChartIds);
  const specs: ChartSpec[] = [];
  const omitted: ChartSpec[] = [];
  const knownEvidence = evidenceIds(input.packageValue);
  void knownEvidence;
  for (const id of ids) {
    const catalog = getChartCatalogEntry(id);
    if (!catalog) continue;
    const result = buildSingleChart(input.packageValue, catalog.id, catalog.title, String(catalog.family), catalog.dataSelector, catalog.units, currency, catalog.sourceKind);
    if (result.omissionReason) omitted.push(result);
    else specs.push(result);
  }
  specs.sort((a, b) => a.id.localeCompare(b.id));
  omitted.sort((a, b) => a.id.localeCompare(b.id));
  return { specs, omitted };
}

function buildSingleChart(packageValue: CanonicalResearchPackage, id: string, title: string, family: string, selector: string, units: string, currency: string | null, sourceKind: string): ChartSpec {
  const fail = (reason: string, provenance: SpecProvenance = "measured"): ChartSpec => {
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods: [], series: [], units, currency: sourceKind === "canonical-history" || sourceKind === "canonical-valuation" ? currency : null, sourceIds: [], derivationIds: [], provenance, omissionReason: reason };
    return { ...provisional, hash: hashChart(provisional) };
  };
  if (selector === "valuation-scenarios") {
    const scenarios = (packageValue as unknown as { scenarios?: Array<{ targetPrice?: number }> }).scenarios ?? [];
    const labels = ["bear", "base", "bull"];
    const values = [scenarios[0], scenarios[1], scenarios[2]].map((s) => (s && isFiniteNumber(s.targetPrice) ? (s.targetPrice as number) : null));
    if (values.every((v) => v === null)) return fail("Canonical scenario targets are unavailable for this chart.");
    const periods = labels.slice(0, values.length);
    const series = periods.map((period, i) => {
      const value = values[i];
      if (!isFiniteNumber(value)) return { period, value: null, display: "Unavailable", state: "unavailable" as const, provenance: "derived" as const };
      return { period, value, display: String(value), state: "available" as const, provenance: "derived" as const };
    });
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency, sourceIds: ["SRC:VALUATION:SCENARIOS"], derivationIds: ["DER:VALUATION:SCENARIO_TARGETS"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  if (selector === "valuation-sensitivity") {
    const sensitivity = (packageValue as unknown as { sensitivityAnalysis?: unknown; sensitivity?: unknown }).sensitivityAnalysis ?? (packageValue as unknown as { sensitivity?: unknown }).sensitivity;
    if (!sensitivity || (Array.isArray(sensitivity) && sensitivity.length === 0)) return fail("Canonical sensitivity output is unavailable for this chart.");
    const periods = ["sensitivity-grid"];
    const series = [{ period: "sensitivity-grid", value: null, display: "See sensitivity table", state: "available" as const, provenance: "derived" as const }];
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency: null, sourceIds: ["SRC:VALUATION:SENSITIVITY"], derivationIds: ["DER:VALUATION:SENSITIVITY"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  if (selector === "valuation-expectations") {
    const reverse = (packageValue.valuationResult as unknown as Record<string, unknown>).reverse ?? (packageValue as unknown as Record<string, unknown>).reverseResult;
    if (!reverse) return fail("Canonical reverse valuation is unavailable for this chart.");
    const periods = ["market-implied"];
    const series = [{ period: "market-implied", value: null, display: "See expectations table", state: "available" as const, provenance: "derived" as const }];
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency: null, sourceIds: ["SRC:VALUATION:REVERSE"], derivationIds: ["DER:VALUATION:EXPECTATIONS"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  if (selector === "valuation-segments") {
    const breakdown = (packageValue.valuationResult as unknown as Record<string, unknown>).sotpBreakdown;
    if (!breakdown) return fail("Canonical segment valuation is unavailable for this chart.");
    const periods = ["segments"];
    const series = [{ period: "segments", value: null, display: "See segment table", state: "available" as const, provenance: "derived" as const }];
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency, sourceIds: ["SRC:VALUATION:SEGMENTS"], derivationIds: ["DER:VALUATION:SOTP"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  if (selector === "valuation-anchors") {
    const fairValue = packageValue.valuationResult.fairValuePerShare;
    const currentPrice = packageValue.sourceContext.stockData.currentPrice;
    if (!isFiniteNumber(fairValue) || !isFiniteNumber(currentPrice)) return fail("Valuation anchors are unavailable for this chart.");
    const periods = ["current", "fair"];
    const series = [
      { period: "current", value: currentPrice, display: String(currentPrice), state: "available" as const, provenance: "measured" as const },
      { period: "fair", value: fairValue, display: String(fairValue), state: "available" as const, provenance: "derived" as const },
    ];
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency, sourceIds: ["SRC:QUOTE:CURRENT_PRICE"], derivationIds: ["DER:VALUATION:FAIR_VALUE"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  if (selector === "peer-comparison") {
    const peers = (packageValue.peerDiscovery as unknown as { peers?: Array<{ ticker?: string; pe?: number }> } | undefined);
    const list = Array.isArray((packageValue as unknown as { peers?: unknown }).peers) ? ((packageValue as unknown as { peers?: Array<unknown> }).peers as Array<unknown>) : (peers?.peers ?? []);
    if (!Array.isArray(list) || list.length === 0) return fail("Peer comparison is suppressed or unavailable for this chart.");
    const periods = (list as Array<Record<string, unknown>>).slice(0, 12).map((peer) => String(peer.ticker ?? "Peer"));
    const series = periods.map((period, i) => {
      const peer = (list as Array<Record<string, unknown>>)[i];
      const value = peer.pe ?? peer.price ?? null;
      if (!isFiniteNumber(value)) return { period, value: null, display: "Unavailable", state: "unavailable" as const, provenance: "measured" as const };
      return { period, value: value as number, display: String(value), state: "available" as const, provenance: "measured" as const };
    });
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency: null, sourceIds: ["SRC:PEERS:COMPARISON"], derivationIds: [], provenance: "measured" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  if (selector === "event-response") {
    const events = ((packageValue as unknown as { eventPriceMovements?: Array<{ headline?: string; measured?: boolean; multiDayReturnPct?: number }> }).eventPriceMovements ?? []) as Array<{ headline?: string; measured?: boolean; multiDayReturnPct?: number }>;
    const measured = events.filter((event) => event.measured === true);
    if (measured.length === 0) return fail("Measured event price response is unavailable; synthetic trajectories are never charted.", "illustrative");
    const periods = measured.slice(0, 6).map((event) => String(event.headline ?? "Event").slice(0, 40));
    const series = measured.slice(0, 6).map((event, i) => {
      const value = event.multiDayReturnPct;
      if (!isFiniteNumber(value)) return { period: periods[i], value: null, display: "Unavailable", state: "unavailable" as const, provenance: "measured" as const };
      return { period: periods[i], value: value as number, display: `${((value as number) * 100).toFixed(1)}%`, state: "available" as const, provenance: "measured" as const };
    });
    const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units: "percent", currency: null, sourceIds: ["SRC:MARKET:EVENT_RESPONSE"], derivationIds: [], provenance: "measured" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashChart(provisional) };
  }
  const history = valuesForHistory(packageValue, selector);
  if (history.length === 0) return fail(`No canonical history periods are available for ${selector}.`);
  const available = history.filter((point) => point.value !== null);
  if (available.length === 0) return fail(`Required canonical series for ${selector} is unavailable in reported history.`);
  if (selector === "annual-revenue" || selector === "annual-profitability" || selector === "annual-cash-conversion" || selector === "annual-statements") {
    const forecast = forecastPeriods(packageValue);
    void forecast;
  }
  const periods = history.map((point) => point.period);
  const series = history.map((point) => {
    if (point.value === null) return { period: point.period, value: null, display: "Unavailable", state: "unavailable" as const, provenance: "measured" as const };
    return { period: point.period, value: point.value, display: String(point.value), state: "available" as const, provenance: "measured" as const };
  });
  const provisional = { version: CHART_SPEC_VERSION as typeof CHART_SPEC_VERSION, id, title, family, periods, series, units, currency: units === "currency" ? currency : null, sourceIds: [`SRC:HISTORY:${selector.toUpperCase()}`], derivationIds: [], provenance: "measured" as const, omissionReason: null as string | null };
  return { ...provisional, hash: hashChart(provisional) };
}

export function buildTableSpecs(input: BuildSpecsInput): { specs: TableSpec[]; omitted: TableSpec[] } {
  const currency = packageCurrency(input.packageValue);
  const ids = resolveTableIds(input.plan, input.proposedTableIds);
  const specs: TableSpec[] = [];
  const omitted: TableSpec[] = [];
  for (const id of ids) {
    const catalog = getTableCatalogEntry(id);
    if (!catalog) continue;
    const result = buildSingleTable(input.packageValue, catalog.id, catalog.title, String(catalog.family), catalog.dataSelector, catalog.units, currency);
    if (result.omissionReason) omitted.push(result);
    else specs.push(result);
  }
  specs.sort((a, b) => a.id.localeCompare(b.id));
  omitted.sort((a, b) => a.id.localeCompare(b.id));
  return { specs, omitted };
}

function tableFail(id: string, title: string, family: string, units: string, currency: string | null, reason: string): TableSpec {
  const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns: [], rows: [], units, currency, sourceIds: [], derivationIds: [], provenance: "measured" as const, omissionReason: reason };
  return { ...provisional, hash: hashTable(provisional) };
}

function buildSingleTable(packageValue: CanonicalResearchPackage, id: string, title: string, family: string, selector: string, units: string, currency: string | null): TableSpec {
  if (selector === "annual-statements" || selector === "annual-revenue" || selector === "annual-cash-conversion") {
    const rows = annualRows(packageValue);
    if (rows.length === 0) return tableFail(id, title, family, units, currency, "No annual financial history is available for this table.");
    const columns = rows.map((row) => String(row.year ?? row.period ?? "Unknown"));
    const revenueRow = { label: "Revenue", cells: rows.map((row) => {
      const value = row.revenue ?? row.totalRevenue ?? row.totalFeeRevenue;
      if (!isFiniteNumber(value)) return { display: "Unavailable", value: null, state: "unavailable" as const };
      return { display: String(value), value: value as number, state: "available" as const };
    }) };
    const netRow = { label: "Net income", cells: rows.map((row) => {
      const value = row.netIncome;
      if (!isFiniteNumber(value)) return { display: "Unavailable", value: null, state: "unavailable" as const };
      return { display: String(value), value: value as number, state: "available" as const };
    }) };
    const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns, rows: [revenueRow, netRow], units, currency, sourceIds: [`SRC:HISTORY:${selector.toUpperCase()}`], derivationIds: [], provenance: "measured" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashTable(provisional) };
  }
  if (selector === "valuation-anchors") {
    const fairValue = packageValue.valuationResult.fairValuePerShare;
    const currentPrice = packageValue.sourceContext.stockData.currentPrice;
    if (!isFiniteNumber(fairValue) || !isFiniteNumber(currentPrice)) return tableFail(id, title, family, units, currency, "Valuation anchors are unavailable for this table.");
    const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns: ["Metric", "Value"], rows: [
      { label: "Current price", cells: [{ display: String(currentPrice), value: currentPrice as number, state: "available" as const }] },
      { label: "Fair value", cells: [{ display: String(fairValue), value: fairValue as number, state: "available" as const }] },
      { label: "Rating", cells: [{ display: String(packageValue.rating), value: String(packageValue.rating), state: "available" as const }] },
    ], units, currency, sourceIds: ["SRC:QUOTE:CURRENT_PRICE"], derivationIds: ["DER:VALUATION:FAIR_VALUE"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashTable(provisional) };
  }
  if (selector === "valuation-scenarios") {
    const scenarios = (packageValue as unknown as { scenarios?: Array<{ targetPrice?: number }> }).scenarios ?? [];
    if (!Array.isArray(scenarios) || scenarios.length === 0) return tableFail(id, title, family, units, currency, "Scenario targets are unavailable for this table.");
    const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns: ["Scenario", "Target"], rows: scenarios.slice(0, 3).map((scenario, index) => {
      const value = (scenario as { targetPrice?: unknown }).targetPrice;
      const label = ["Bear", "Base", "Bull"][index] ?? `Scenario ${index + 1}`;
      if (!isFiniteNumber(value)) return { label, cells: [{ display: "Unavailable", value: null, state: "unavailable" as const }] };
      return { label, cells: [{ display: String(value), value: value as number, state: "available" as const }] };
    }), units, currency, sourceIds: ["SRC:VALUATION:SCENARIOS"], derivationIds: ["DER:VALUATION:SCENARIO_TARGETS"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashTable(provisional) };
  }
  if (selector === "valuation-sensitivity") {
    const sensitivity = (packageValue as unknown as { sensitivityAnalysis?: unknown; sensitivity?: unknown }).sensitivityAnalysis ?? (packageValue as unknown as { sensitivity?: unknown }).sensitivity;
    if (!sensitivity) return tableFail(id, title, family, units, currency, "Sensitivity output is unavailable for this table.");
    const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns: ["Input", "Effect"], rows: [{ label: "Canonical sensitivity", cells: [{ display: "Precomputed", value: "Precomputed", state: "available" as const }] }], units, currency: null, sourceIds: ["SRC:VALUATION:SENSITIVITY"], derivationIds: ["DER:VALUATION:SENSITIVITY"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashTable(provisional) };
  }
  if (selector === "peer-comparison") {
    const peers = (packageValue.peerDiscovery as unknown as { peers?: Array<Record<string, unknown>> } | undefined);
    const list = Array.isArray((packageValue as unknown as { peers?: unknown }).peers) ? ((packageValue as unknown as { peers?: Array<Record<string, unknown>> }).peers as Array<Record<string, unknown>>) : (peers?.peers ?? []);
    if (!Array.isArray(list) || list.length === 0) return tableFail(id, title, family, units, currency, "Peer comparison is suppressed or unavailable for this table.");
    const columns = ["Ticker", "P/E", "P/B"];
    const rows = (list as Array<Record<string, unknown>>).slice(0, 12).map((peer) => {
      const ticker = typeof peer.ticker === "string" ? peer.ticker : "Unknown";
      const pe = isFiniteNumber(peer.pe) ? String(peer.pe) : "Unavailable";
      const pb = isFiniteNumber(peer.pb) ? String(peer.pb) : "Unavailable";
      return { label: ticker, cells: [{ display: pe, value: pe, state: pe === "Unavailable" ? "unavailable" as const : "available" as const }, { display: pb, value: pb, state: pb === "Unavailable" ? "unavailable" as const : "available" as const }] };
    });
    const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns, rows, units, currency: null, sourceIds: ["SRC:PEERS:COMPARISON"], derivationIds: [], provenance: "measured" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashTable(provisional) };
  }
  if (selector === "valuation-segments") {
    const breakdown = (packageValue.valuationResult as unknown as Record<string, unknown>).sotpBreakdown;
    if (!breakdown) return tableFail(id, title, family, units, currency, "Canonical segment valuation is unavailable for this table.");
    const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns: ["Segment", "Value"], rows: [{ label: "Segments", cells: [{ display: "See canonical package", value: "See canonical package", state: "available" as const }] }], units, currency, sourceIds: ["SRC:VALUATION:SEGMENTS"], derivationIds: ["DER:VALUATION:SOTP"], provenance: "derived" as const, omissionReason: null as string | null };
    return { ...provisional, hash: hashTable(provisional) };
  }
  const history = valuesForHistory(packageValue, selector);
  if (history.length === 0 || history.every((point) => point.value === null)) return tableFail(id, title, family, units, currency, `Required canonical series for ${selector} is unavailable in reported history.`);
  const columns = history.map((point) => point.period);
  const row = { label: title, cells: history.map((point) => {
    if (point.value === null) return { display: "Unavailable", value: null, state: "unavailable" as const };
    return { display: String(point.value), value: point.value, state: "available" as const };
  }) };
  const provisional = { version: TABLE_SPEC_VERSION as typeof TABLE_SPEC_VERSION, id, title, family, columns, rows: [row], units, currency: units === "currency" ? currency : null, sourceIds: [`SRC:HISTORY:${selector.toUpperCase()}`], derivationIds: [], provenance: "measured" as const, omissionReason: null as string | null };
  return { ...provisional, hash: hashTable(provisional) };
}

export function verifyChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as ChartSpec;
  if (candidate.version !== CHART_SPEC_VERSION) return false;
  if (typeof candidate.id !== "string" || !candidate.id) return false;
  if (typeof candidate.hash !== "string" || candidate.hash.length !== 64) return false;
  const recomputed = hashChart({ version: candidate.version, id: candidate.id, title: candidate.title, family: candidate.family, periods: candidate.periods, series: candidate.series, units: candidate.units, currency: candidate.currency, sourceIds: candidate.sourceIds, derivationIds: candidate.derivationIds, provenance: candidate.provenance, omissionReason: candidate.omissionReason });
  return recomputed === candidate.hash;
}

export function verifyTableSpec(value: unknown): value is TableSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as TableSpec;
  if (candidate.version !== TABLE_SPEC_VERSION) return false;
  if (typeof candidate.id !== "string" || !candidate.id) return false;
  if (typeof candidate.hash !== "string" || candidate.hash.length !== 64) return false;
  const recomputed = hashTable({ version: candidate.version, id: candidate.id, title: candidate.title, family: candidate.family, columns: candidate.columns, rows: candidate.rows, units: candidate.units, currency: candidate.currency, sourceIds: candidate.sourceIds, derivationIds: candidate.derivationIds, provenance: candidate.provenance, omissionReason: candidate.omissionReason });
  return recomputed === candidate.hash;
}
