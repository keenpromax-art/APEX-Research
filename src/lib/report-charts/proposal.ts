import { getChartCatalogEntry, getTableCatalogEntry } from "./catalog";

export interface ProposalValidation {
  accepted: string[];
  rejected: Array<{ id: string; reason: string }>;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[a-z0-9][a-z0-9\-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

export function validateChartProposals(proposed: unknown): ProposalValidation {
  const list = Array.isArray(proposed) ? proposed : [];
  const accepted: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, 40)) {
    const id = cleanId(raw);
    if (!id) {
      rejected.push({ id: String(raw ?? ""), reason: "Proposal id is not a well-formed catalog id." });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = getChartCatalogEntry(id);
    if (!entry) {
      rejected.push({ id, reason: "Chart id is not in the deterministic fact-bound catalog." });
      continue;
    }
    accepted.push(id);
  }
  accepted.sort();
  return { accepted, rejected };
}

export function validateTableProposals(proposed: unknown): ProposalValidation {
  const list = Array.isArray(proposed) ? proposed : [];
  const accepted: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, 40)) {
    const id = cleanId(raw);
    if (!id) {
      rejected.push({ id: String(raw ?? ""), reason: "Proposal id is not a well-formed catalog id." });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = getTableCatalogEntry(id);
    if (!entry) {
      rejected.push({ id, reason: "Table id is not in the deterministic fact-bound catalog." });
      continue;
    }
    accepted.push(id);
  }
  accepted.sort();
  return { accepted, rejected };
}

export function filterProposalsToCatalog(chartIds: unknown, tableIds: unknown): { charts: string[]; tables: string[]; rejectedCharts: ProposalValidation["rejected"]; rejectedTables: ProposalValidation["rejected"] } {
  const charts = validateChartProposals(chartIds);
  const tables = validateTableProposals(tableIds);
  return { charts: charts.accepted, tables: tables.accepted, rejectedCharts: charts.rejected, rejectedTables: tables.rejected };
}
