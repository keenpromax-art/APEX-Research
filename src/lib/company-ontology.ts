/**
 * APEX RESEARCH - Hard Company / Sector Ontology (Priority 1)
 *
 * Single source of truth for business-model intelligence. Every module
 * (classifier, PE engine, LLM guardrail, sanitizer, valuation selector,
 * peer router, QA gate, PDF) MUST consume this — no forked keyword lists.
 *
 * Ontology = sector + sub-sector + segments + operating archetype +
 * revenue drivers + KPIs + risks + catalysts + valuation methods +
 * competitors + required concepts + forbidden concepts.
 */
import type { CompanyProfile } from "@/types/report";
import { classifySector, getSectorProfile } from "./sectors";
import type { SectorId, SectorProfile } from "./sectors/types";
import { classifyArchetype, type ArchetypeProfile, type GICSSector, type FinancialArchetype } from "./company-archetype";

export interface CompanyOntology {
  sectorId: SectorId;
  sectorName: string;
  subSector: string;
  segments: string[];
  operatingArchetype: GICSSector;
  financialArchetype: FinancialArchetype;
  revenueDrivers: string[];
  costDrivers: string[];
  capexDrivers: string[];
  kpis: string[];
  risks: string[];
  catalysts: string[];
  valuationMethods: SectorProfile["preferredValuationModels"];
  competitors: string[]; // curated peer universe tickers
  requiredConcepts: string[]; // must appear in narrative (else ONT-01 FAIL)
  forbiddenConcepts: string[]; // must never appear (else ONT-01 / BS-DETECTOR-04 FAIL)
  standardMarginMetric: SectorProfile["standardMarginMetric"];
  isFinancialInstitution: boolean;
  ontologyVersion: string;
}

export const ONTOLOGY_VERSION = "ontology-v1-2026-09";

/** Required concepts per sector — the positive control (forbidden is negative control). */
const REQUIRED_CONCEPTS: Record<string, string[]> = {
  bank: ["casa", "nim", "gnpa", "provision", "advances"],
  nbfc: ["aum", "collection efficiency", "credit cost", "borrowing"],
  insurance: ["vnb", "embedded value", "persistency", "combined ratio"],
  "ratings-agency": ["rating", "subscription", "analytical"],
  "asset-management": ["aum", "net flows", "fee rate"],
  "it-services": ["revenue growth", "ebit margin", "tcv", "attrition", "utilization"],
  "technology-hardware": ["units", "asp", "product mix", "component", "inventory", "channel", "gross margin"],
  "technology-software": ["arr", "retention", "tcv", "subscription", "expansion"],
  pharma: ["r&d", "us generics", "anda", "gross margin"],
  consumer: ["volume growth", "gross margin", "distribution", "premiumization"],
  industrial: ["order inflow", "order book", "capacity utilization", "roce"],
  auto: ["deliveries", "asp", "automotive gross margin", "free cash flow"],
  "renewable-energy": ["order book", "plf", "o&m", "net debt to ebitda"],
  telecom: ["arpu", "subscriber", "churn", "capex intensity"],
  "real-estate": ["noi", "occupancy", "wale", "cap rate", "nav"],
  hospitality: ["revpar", "adr", "occupancy", "goppar", "ebitdar"],
  utilities: ["plf", "ppa", "tariff", "regulated roe"],
  agrochemical: ["volume growth", "registration", "working capital", "realization"],
  cement: ["volume", "realization per tonne", "ebitda per tonne", "utilization"],
  "internet-retail": ["gmv", "aov", "take rate", "order volume"],
  "internet-platform": ["dau", "mau", "ad impressions", "price per ad", "arpu"],
  general: ["revenue", "ebitda margin", "free cash flow"],
};

/** Competitor universe per sector (curated candidate pool — similarity scorer ranks/filters). */
const COMPETITOR_UNIVERSE: Record<string, string[]> = {
  bank: ["HDFCBANK.NS", "ICICIBANK.NS", "KOTAKBANK.NS", "SBIN.NS", "JPM", "BAC", "GS", "MS"],
  nbfc: ["BAJFINANCE.NS", "CHOLAFIN.NS", "SHRIRAMFIN.NS", "CREDITACC.NS"],
  insurance: ["HDFCLIFE.NS", "SBILIFE.NS", "ICICIPRULI.NS"],
  "ratings-agency": ["CRISIL.NS", "ICRA.NS", "CAREERP.NS", "SPGI", "MCO"],
  "asset-management": ["HDFCAMC.NS", "NAM-INDIA.NS", "UTIAMC.NS", "BLK", "TROW"],
  "it-services": ["TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS"],
  "technology-hardware": ["AAPL", "DELL", "HPQ", "HPE", "LOGI", "NTAP"],
  "technology-software": ["MSFT", "ORCL", "ADBE", "CRM", "INTU"],
  pharma: ["SUNPHARMA.NS", "CIPLA.NS", "DRREDDY.NS", "LUPIN.NS", "JNJ", "PFE"],
  consumer: ["HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS", "NKE"],
  industrial: ["LT.NS", "SIEMENS.NS", "ABB.NS", "BHEL.NS"],
  auto: ["TATAMOTORS.NS", "MARUTI.NS", "M&M.NS", "F", "GM", "TM", "TSLA"],
  "renewable-energy": ["INOXWIND.NS", "SUZLON.NS", "TATAPOWER.NS", "NTPC.NS"],
  telecom: ["BHARTIARTL.NS", "IDEA.NS", "TATACOMM.NS", "VZ", "T"],
  "real-estate": ["DLF.NS", "GODREJPROP.NS", "OBEROIRLTY.NS", "AMT", "PLD"],
  hospitality: ["INDHOTEL.NS", "EIHOTEL.NS", "LEMONTREE.NS", "CHALET.NS", "MAR", "HLT", "H", "IHG"],
  utilities: ["NTPC.NS", "POWERGRID.NS", "TATAPOWER.NS"],
  agrochemical: ["PIIND.NS", "UPL.NS", "COROMANDEL.NS", "DHANUKA.NS"],
  cement: ["ULTRACEMCO.NS", "AMBUJACEM.NS", "SHREECEM.NS", "ACC.NS"],
  "internet-retail": ["ZOMATO.NS", "DELHIVERY.NS", "DASH", "UBER"],
  "internet-platform": ["GOOGL", "META", "SNAP", "PINS"],
  general: [],
};

function deriveSubSector(sectorId: SectorId, industry: string, archetypeSector: GICSSector): string {
  if (sectorId === "hospitality") {
    if (archetypeSector === "hospitality_asset_light") return "hospitality / asset-light management & franchise";
    if (archetypeSector === "hospitality_reit") return "hospitality / REIT";
    if (archetypeSector === "hospitality_owner_operator") return "hospitality / owner-operator";
    return "hospitality / owner-operator & managed";
  }
  if (sectorId === "real-estate") return "real-estate / REIT & development";
  if (sectorId === "bank") return "banking / commercial & retail";
  if (sectorId === "it-services") return "technology / IT services & consulting";
  if (sectorId === "technology-hardware") return "technology / hardware, devices & components";
  if (sectorId === "technology-software") return "technology / enterprise software & SaaS";
  return `${sectorId} / ${(industry || "general").toLowerCase().slice(0, 60)}`;
}

function deriveSegments(sectorId: SectorId, description: string): string[] {
  const d = (description || "").toLowerCase();
  if (sectorId === "hospitality") {
    const segs: string[] = ["rooms"];
    if (d.includes("f&b") || d.includes("food") || d.includes("banquet") || d.includes("restaurant")) segs.push("F&B / banquet / MICE");
    if (d.includes("manag") || d.includes("franchis")) segs.push("management & franchise fees");
    return segs;
  }
  if (sectorId === "real-estate") return ["leasing", "development"];
  if (sectorId === "technology-hardware") return ["devices & endpoints", "components & storage", "services attach (if disclosed)"];
  if (sectorId === "technology-software") return ["subscription / SaaS", "license", "services"];
  if (sectorId === "auto") return ["vehicles", "parts & services", "energy storage (if disclosed)"];
  if (sectorId === "it-services") return ["services", "consulting & outsourcing"];
  if (sectorId === "bank") return ["net interest income", "fee income"];
  return ["consolidated operations"];
}

/**
 * Build the authoritative ontology for a company. Pure + deterministic.
 * archetypeProfile may be supplied to avoid double classification (route.ts already has it).
 */
export function buildCompanyOntology(
  profile: CompanyProfile,
  archetypeProfile?: ArchetypeProfile
): CompanyOntology {
  const sectorProfile = getSectorProfile(profile.sector, profile.industry, profile.description);
  const arch = archetypeProfile ?? classifyArchetype(profile, { currentPrice: 0 } as never, [] as never);
  const sectorId = sectorProfile.id;
  const drivers = sectorProfile.driverSpec;

  const revenueDrivers =
    drivers?.revenueDrivers ??
    (sectorId === "technology-hardware"
      ? ["unit shipments by product line", "ASP & product mix", "services attach rate"]
      : sectorId === "technology-software"
        ? ["ARR base & seats", "net expansion (NRR)", "new logos & TCV conversion"]
        : sectorId === "auto"
      ? ["vehicle deliveries (units)", "ASP per vehicle", "mix & pricing"]
      : sectorId === "it-services"
        ? ["billed headcount & utilization", "realization rate", "large-deal TCV conversion"]
        : sectorId === "internet-platform"
          ? ["DAU/MAU", "ad impressions", "average price per ad"]
          : sectorId === "internet-retail"
            ? ["order volume", "AOV", "take rate"]
            : sectorId === "bank" || sectorId === "nbfc"
              ? ["advances / AUM", "NIM / spread", "fee income"]
              : ["volume", "realization / pricing", "mix"]);
  const costDrivers =
    drivers?.costDrivers ??
    (sectorId === "technology-hardware"
      ? ["component costs (memory/display/silicon)", "manufacturing conversion & warranty"]
      : sectorId === "technology-software"
        ? ["sales & marketing CAC", "cloud hosting & support"]
        : sectorId === "it-services"
          ? ["employee cost & wage inflation", "attrition & subcontracting"]
          : sectorId === "auto"
            ? ["bill of materials & battery cost", "manufacturing conversion cost"]
            : ["input costs", "operating leverage"]);
  const capexDrivers = drivers?.capexDrivers ?? ["maintenance capex", "growth capex"];

  return {
    sectorId,
    sectorName: sectorProfile.name,
    subSector: deriveSubSector(sectorId, profile.industry || "", arch.sector),
    segments: deriveSegments(sectorId, profile.description || ""),
    operatingArchetype: arch.sector,
    financialArchetype: arch.archetype,
    revenueDrivers,
    costDrivers,
    capexDrivers,
    kpis: [...sectorProfile.allowedKPIs],
    risks: [...sectorProfile.riskCategories],
    catalysts: [...sectorProfile.riskCategories].slice(0, 4),
    valuationMethods: [...sectorProfile.preferredValuationModels],
    competitors: [...(COMPETITOR_UNIVERSE[sectorId] ?? [])],
    requiredConcepts: [...(REQUIRED_CONCEPTS[sectorId] ?? REQUIRED_CONCEPTS.general)],
    forbiddenConcepts: [...sectorProfile.forbiddenConcepts],
    standardMarginMetric: sectorProfile.standardMarginMetric,
    isFinancialInstitution: sectorProfile.isFinancialInstitution,
    ontologyVersion: ONTOLOGY_VERSION,
  };
}

/** Validate narrative against ontology: missing required + present forbidden. Boundary-safe. */
export function validateOntologyCoverage(
  ontology: CompanyOntology,
  narrativeText: string
): { missingRequired: string[]; presentForbidden: string[] } {
  const lower = (narrativeText || "").toLowerCase();
  const hit = (phrase: string): boolean => {
    const esc = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(lower);
  };
  // Required: at least 2 of the required concepts must be evidenced (hospitality needs revpar+adr+occupancy — enforced stricter in QA HOSP-01/ONT-01)
  const missingRequired = ontology.requiredConcepts.filter((c) => !hit(c));
  const presentForbidden = ontology.forbiddenConcepts.filter((c) => hit(c));
  return { missingRequired, presentForbidden };
}
