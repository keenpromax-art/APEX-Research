/**
 * APEX RESEARCH - Sector Ontology Types
 */

export type SectorId =
  | "bank"
  | "nbfc"
  | "insurance"
  | "ratings-agency"
  | "asset-management"
  | "it-services"
  | "pharma"
  | "consumer"
  | "industrial"
  | "auto"
  | "renewable-energy"
  | "telecom"
  | "real-estate"
  | "utilities"
  | "agrochemical"
  | "cement"
  | "general";

export interface SectorProfile {
  id: SectorId;
  name: string;
  allowedKPIs: string[];
  preferredValuationModels: Array<"FCFF_DCF" | "PB_RESIDUAL_INCOME" | "DDM" | "MULTIPLES_PE" | "MULTIPLES_PB" | "EV_EBITDA">;
  financialMetrics: string[];
  riskCategories: string[];
  moatDrivers: string[];
  forbiddenConcepts: string[];
  isFinancialInstitution: boolean;
  standardMarginMetric: "EBITDA Margin" | "Operating Margin" | "NIM" | "Net Spread" | "Underwriting Margin";
}
