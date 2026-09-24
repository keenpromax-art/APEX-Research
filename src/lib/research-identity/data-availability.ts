import { getStatementArchitecture } from "@/types/report";
import type { ResearchIdentitySource } from "./types";
import { indexResearchReferences } from "./evidence-profile";

type Index = ReturnType<typeof indexResearchReferences>;

export interface ResearchIdentityDataAvailability {
  available: Set<string>;
  reasons: Map<string, string>;
}

function mark(availability: ResearchIdentityDataAvailability, selector: string, ok: boolean, reason: string): void {
  if (ok) availability.available.add(selector);
  else availability.reasons.set(selector, reason);
}

function numericField(row: unknown, field: string): boolean {
  const value = (row as Record<string, unknown> | undefined)?.[field];
  return typeof value === "number" && Number.isFinite(value);
}

export function assessDataAvailability(
  source: ResearchIdentitySource,
  index: Index
): ResearchIdentityDataAvailability {
  const availability: ResearchIdentityDataAvailability = { available: new Set(), reasons: new Map() };
  const rows = source.researchCase.historicalFinancials ?? [];
  const latest = rows[rows.length - 1];
  const architecture = latest ? getStatementArchitecture(latest) : source.researchCase.architecture.statementArchitecture;
  const hasRows = rows.length > 0;
  mark(availability, "annual-revenue", hasRows, "No annual financial history.");
  mark(availability, "annual-profitability", hasRows && rows.some((r) => numericField(r, "netIncome")), "No usable profit history.");
  mark(
    availability,
    "annual-cash-conversion",
    rows.some((r) => numericField(r, "operatingCashFlow") && numericField(r, "freeCashFlow")),
    "Operating and free cash flow are not both reported."
  );
  mark(
    availability,
    "annual-leverage",
    rows.some((r) => numericField(r, "totalDebt") && numericField(r, "totalEquity")),
    "Debt and equity are not both reported."
  );
  mark(
    availability,
    "annual-returns",
    rows.some((r) => numericField(r, "netIncome") && numericField(r, "totalEquity")),
    "Net income and equity are not both reported."
  );
  mark(
    availability,
    "annual-statements",
    hasRows,
    "No annual financial history."
  );
  mark(
    availability,
    "annual-bank-spread",
    architecture === "B" && rows.some((r) => numericField(r, "netInterestIncome") || numericField(r, "totalRevenue")),
    "Bank spread lines are unavailable."
  );
  mark(
    availability,
    "annual-asset-quality",
    architecture === "B" &&
      rows.some((r) => numericField(r, "loans") || numericField(r, "provisionForCreditLosses") || numericField(r, "grossNPA")),
    "Asset-quality lines are unavailable."
  );
  mark(
    availability,
    "annual-capital",
    (architecture === "B" || architecture === "C") &&
      rows.some((r) => numericField(r, "capitalAdequacyRatio") || numericField(r, "totalEquity") || numericField(r, "solvencyRatio")),
    "Capital lines are unavailable."
  );
  mark(
    availability,
    "annual-reit-portfolio",
    architecture === "D" && rows.some((r) => numericField(r, "occupancyPct") || numericField(r, "netOperatingIncome")),
    "REIT occupancy or NOI is unavailable."
  );
  mark(
    availability,
    "annual-reit-income",
    architecture === "D" && rows.some((r) => numericField(r, "netOperatingIncome") && numericField(r, "fundsFromOperations")),
    "REIT NOI and FFO are unavailable."
  );
  mark(
    availability,
    "annual-research",
    rows.some((r) => numericField(r, "researchDevelopment")),
    "Research spending is not reported."
  );
  mark(
    availability,
    "valuation-anchors",
    Boolean(source.researchCase.assumptionsLedger || source.researchCase.valuation),
    "Valuation anchors are unavailable."
  );
  mark(
    availability,
    "valuation-scenarios",
    Boolean(source.researchCase.scenarios || source.researchCase.assumptionsLedger?.scenarios),
    "Scenario targets are unavailable."
  );
  mark(
    availability,
    "valuation-sensitivity",
    Boolean(source.researchReport?.sensitivity && source.researchReport.sensitivity.length > 0),
    "Sensitivity output is unavailable."
  );
  mark(
    availability,
    "valuation-expectations",
    Boolean(source.researchCase.valuation?.reverseDCF),
    "Canonical reverse valuation is unavailable."
  );
  mark(
    availability,
    "valuation-segments",
    Boolean(source.researchCase.valuation?.sotpBreakdown),
    "Canonical segment valuation is unavailable."
  );
  mark(
    availability,
    "peer-comparison",
    !source.researchCase.peers.gate.suppress && source.researchCase.peers.peers.length > 0,
    "Peer comparison is suppressed or unavailable."
  );
  mark(
    availability,
    "event-response",
    source.researchCase.catalysts.eventCategories.length > 0,
    "Measured event categories are unavailable."
  );
  mark(
    availability,
    "evidence-register",
    (source.researchCase.evidence?.items.length ?? 0) > 0,
    "Evidence registry is unavailable."
  );
  mark(
    availability,
    "pipeline-matrix",
    Boolean(source.researchReport && (source.researchReport.catalysts.length > 0 || source.researchReport.researchDiscovery)),
    "Pipeline evidence is unavailable."
  );
  mark(
    availability,
    "unit-economics",
    Boolean(source.researchReport?.economicEngine || source.researchCase.ontology.unitEconomics),
    "Unit-economics evidence is unavailable."
  );
  mark(
    availability,
    "risk-matrix",
    source.researchCase.risks.risks.length > 0,
    "Risk research is unavailable."
  );
  mark(
    availability,
    "catalyst-matrix",
    source.researchCase.catalysts.catalysts.length > 0,
    "Catalyst research is unavailable."
  );
  mark(
    availability,
    "management-record",
    source.researchCase.management.officers.length > 0 || source.researchCase.management.available,
    "Management evidence is unavailable."
  );
  void index;
  return availability;
}
