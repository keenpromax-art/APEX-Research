import { CHART_CANDIDATES, TABLE_CANDIDATES } from "@/lib/research-identity/registry";
import type { ChartFamily, TableFamily } from "@/lib/research-identity/types";

export const CHART_CATALOG_VERSION = "report-chart-catalog-v1";
export const TABLE_CATALOG_VERSION = "report-table-catalog-v1";

export type ChartProvenancePolicy = "measured" | "derived" | "illustrative";

export interface ChartCatalogEntry {
  id: string;
  title: string;
  family: ChartFamily;
  dataSelector: string;
  requiredSeries: string;
  units: string;
  currencyPolicy: "package-currency" | "unitless" | "percent";
  sourceKind: "canonical-history" | "canonical-forecast" | "canonical-valuation" | "canonical-peer" | "canonical-event" | "canonical-evidence";
  allowedProvenance: ChartProvenancePolicy[];
}

export interface TableCatalogEntry {
  id: string;
  title: string;
  family: TableFamily;
  dataSelector: string;
  requiredColumns: string;
  units: string;
  currencyPolicy: "package-currency" | "unitless" | "percent";
  sourceKind: "canonical-history" | "canonical-forecast" | "canonical-valuation" | "canonical-peer" | "canonical-event" | "canonical-evidence";
  allowedProvenance: ChartProvenancePolicy[];
}

function sourceKindFor(selector: string): ChartCatalogEntry["sourceKind"] {
  if (selector.startsWith("annual-")) return "canonical-history";
  if (selector.startsWith("valuation-")) return "canonical-valuation";
  if (selector === "peer-comparison") return "canonical-peer";
  if (selector === "event-response") return "canonical-event";
  if (selector === "evidence-register" || selector === "unit-economics") return "canonical-evidence";
  return "canonical-history";
}

function unitsFor(selector: string, id: string): { units: string; currencyPolicy: ChartCatalogEntry["currencyPolicy"] } {
  if (/sensitivity|scenarios|expectations/i.test(id)) return { units: "currency", currencyPolicy: "package-currency" };
  if (/margin|returns|growth|yield|payout|occupancy|cap-rate/i.test(selector + id)) return { units: "percent", currencyPolicy: "percent" };
  if (/multiple|turnover|conversion|multiplier|cover/i.test(id)) return { units: "multiple", currencyPolicy: "unitless" };
  if (/peer/i.test(id)) return { units: "mixed", currencyPolicy: "unitless" };
  if (/event/i.test(id)) return { units: "percent", currencyPolicy: "percent" };
  return { units: "currency", currencyPolicy: "package-currency" };
}

export function listChartCatalog(): ChartCatalogEntry[] {
  return CHART_CANDIDATES.map((candidate) => {
    const mapped = unitsFor(candidate.dataSelector, candidate.id);
    return {
      id: candidate.id,
      title: candidate.title,
      family: candidate.family,
      dataSelector: candidate.dataSelector,
      requiredSeries: candidate.dataSelector,
      units: mapped.units,
      currencyPolicy: mapped.currencyPolicy,
      sourceKind: sourceKindFor(candidate.dataSelector),
      allowedProvenance: (candidate.dataSelector === "event-response" ? ["measured", "illustrative"] : ["measured", "derived"]) as ChartProvenancePolicy[],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function listTableCatalog(): TableCatalogEntry[] {
  return TABLE_CANDIDATES.map((candidate) => {
    const mapped = unitsFor(candidate.dataSelector, candidate.id);
    return {
      id: candidate.id,
      title: candidate.title,
      family: candidate.family,
      dataSelector: candidate.dataSelector,
      requiredColumns: candidate.dataSelector,
      units: mapped.units,
      currencyPolicy: mapped.currencyPolicy,
      sourceKind: sourceKindFor(candidate.dataSelector),
      allowedProvenance: ["measured", "derived"] as ChartProvenancePolicy[],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

const chartById = new Map<string, ChartCatalogEntry>(listChartCatalog().map((entry) => [entry.id, entry]));
const tableById = new Map<string, TableCatalogEntry>(listTableCatalog().map((entry) => [entry.id, entry]));

export function isKnownChartId(id: string): boolean {
  return chartById.has(id);
}

export function isKnownTableId(id: string): boolean {
  return tableById.has(id);
}

export function getChartCatalogEntry(id: string): ChartCatalogEntry | null {
  return chartById.get(id) ?? null;
}

export function getTableCatalogEntry(id: string): TableCatalogEntry | null {
  return tableById.get(id) ?? null;
}
