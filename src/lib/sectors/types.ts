/**
 * APEX RESEARCH - Sector Ontology Types
 */

export type SectorId =
  | "bank"
  | "nbfc"
  | "insurance"
  | "ratings-agency"
  | "asset-management"
  | "technology-hardware"
  | "technology-software"
  | "it-services"
  | "pharma"
  | "consumer"
  | "industrial"
  | "auto"
  | "renewable-energy"
  | "telecom"
  | "real-estate"
  | "hospitality"
  | "utilities"
  | "agrochemical"
  | "cement"
  | "internet-retail"
  | "internet-platform"
  | "general";

export interface SectorDriverSpec {
  revenueDrivers: string[]; // e.g. ["Available Room Nights", "Occupancy %", "ADR"]
  costDrivers: string[];    // e.g. ["Fixed cost per available room", "Variable cost per occupied room"]
  capexDrivers: string[];   // e.g. ["Maintenance capex per room", "Refurb reserve"]
  nwcDrivers: string[];     // e.g. ["Receivables % rooms revenue"]
}

export interface SectorProfile {
  id: SectorId;
  name: string;
  allowedKPIs: string[];
  preferredValuationModels: Array<"FCFF_DCF" | "PB_RESIDUAL_INCOME" | "DDM" | "MULTIPLES_PE" | "MULTIPLES_PB" | "EV_EBITDA" | "EV_EBITDAR" | "NAV_CAP_RATE">;
  financialMetrics: string[];
  riskCategories: string[];
  moatDrivers: string[];
  forbiddenConcepts: string[];
  /** Positive control: concepts that MUST be evidenced for this sector (Priority 1). Optional for backward compat — ontology supplies defaults. */
  requiredConcepts?: string[];
  isFinancialInstitution: boolean;
  standardMarginMetric: "EBITDA Margin" | "EBITDAR Margin" | "Operating Margin" | "NIM" | "Net Spread" | "Underwriting Margin";
  driverSpec?: SectorDriverSpec;
  operatingArchetypes?: string[]; // e.g. hospitality: ["owner-operator","asset-light","reit"]
}
