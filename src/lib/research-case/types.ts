/**
 * APEX RESEARCH — ResearchCase (Phase 1)
 * --------------------------------------
 * The ResearchCase is the canonical, report-agnostic research object. Every
 * report type (institutional equity, tearsheet, valuation dossier, forensic,
 * earnings deep-dive, …) will consume THIS object — never its own private
 * copy of the financials.
 *
 * PHASE 1 RULES (non-negotiable):
 *  - Reference existing canonical objects; do not copy or recompute them.
 *  - Never invent missing information — absent data is `null` / empty and is
 *    recorded as an explicit unknown or data-quality blocker.
 *  - Deterministic complexity only (no LLM scores).
 *  - This module does not change existing report output.
 */
import type {
  AnnualFinancials,
  AssumptionsLedger,
  CompanyProfile,
  DCFResult,
  Officer,
  PeerData,
  QuarterlyFinancials,
  StatementArchitecture,
  StockData,
} from "@/types/report";
import type { CanonicalFactGraph } from "@/lib/canonical-facts";
import type { EvidenceRegistry } from "@/lib/evidence-registry";
import type { DataConfidenceReport } from "@/lib/data-confidence";
import type { ScenarioSet } from "@/lib/scenarios";
import type { CompanyOntology } from "@/lib/company-ontology";
import type { FinancialArchetype, GICSSector } from "@/lib/company-archetype";
import type { SectorId } from "@/lib/sectors/types";
import type { SectorProfile } from "@/lib/sectors/types";
import type {
  Catalyst,
  CompetitorAnalysis,
  ConfidenceAssessment,
  MoatAnalysis,
  Risk,
} from "@/lib/ai-first/types";
import type { ResearchQuestion } from "@/lib/ai-first/research-planner";
import type { AIAnalysis } from "@/types/report";
import type { EventPriceMovement } from "@/types/report";
import type { ResearchComplexity } from "./complexity";

export const RESEARCH_CASE_VERSION = "research-case-v1";

// ─────────────────────────────────────────────────────────────
// Architecture — the company's economic shape (never hardcoded)
// ─────────────────────────────────────────────────────────────

export interface ResearchArchitecture {
  sectorId: SectorId;
  sectorName: string;
  /** Yahoo/GICS industry string, e.g. "Banks - Regional". */
  industry: string;
  subSector: string;
  operatingArchetype: GICSSector;
  financialArchetype: FinancialArchetype;
  /** Statement family actually used by the latest row (A–E). */
  statementArchitecture: StatementArchitecture;
  isFinancialInstitution: boolean;
  isRegulatedSector: boolean;
  segments: string[];
  valuationMethods: SectorProfile["preferredValuationModels"];
  allowedKPIs: string[];
  forbiddenConcepts: string[];
  requiredConcepts: string[];
}

// ─────────────────────────────────────────────────────────────
// Peer set — curated seed universe + similarity gate decision
// ─────────────────────────────────────────────────────────────

export interface PeerSet {
  peers: PeerData[];
  /** Curated ontology competitor universe (fallback seed, not the final set). */
  curatedUniverse: string[];
  gate: { avg: number | null; qualifying: number; suppress: boolean; reason: string };
  available: boolean;
}

// ─────────────────────────────────────────────────────────────
// Research domains — thin slices over existing research objects
// ─────────────────────────────────────────────────────────────

export interface ManagementResearch {
  available: boolean;
  officers: Officer[];
  managementAnalysis: string | null;
  governance: string | null;
  capitalAllocation: string | null;
}

export interface CompetitionResearch {
  available: boolean;
  competitiveAnalysis: CompetitorAnalysis | null;
  moat: MoatAnalysis | null;
  curatedUniverse: string[];
}

export interface IndustryResearch {
  available: boolean;
  industryContext: string | null;
  sectorProfile: Pick<
    SectorProfile,
    "allowedKPIs" | "forbiddenConcepts" | "requiredConcepts" | "standardMarginMetric"
  > | null;
  revenueDrivers: string[];
  costDrivers: string[];
}

export interface AccountingResearch {
  available: boolean;
  financialQuality: string | null;
  /** Field names tagged as synthesized (from `estimatesUsed`), never laundered. */
  estimatedFields: string[];
}

export interface CatalystResearch {
  available: boolean;
  catalysts: Catalyst[];
  /** Categories observed in measured event-price movements, when present. */
  eventCategories: string[];
}

export interface RiskResearch {
  available: boolean;
  risks: Risk[];
}

// ─────────────────────────────────────────────────────────────
// Unknowns & questions — honest gaps, never filled with invention
// ─────────────────────────────────────────────────────────────

export type UnknownSource = "planner" | "epistemic" | "data-gap" | "analyst";

export interface ResearchUnknown {
  id: string;
  statement: string;
  source: UnknownSource;
  evidenceNeeded?: string;
}

// ─────────────────────────────────────────────────────────────
// Data quality — fail-closed availability flags
// ─────────────────────────────────────────────────────────────

export interface DataQualityAssessment {
  /** A–D from the existing confidence engine; "N/A" when it could not run. */
  grade: "A" | "B" | "C" | "D" | "N/A";
  confidence: DataConfidenceReport | null;
  missingCanonicalFields: string[];
  estimatedFields: string[];
  estimatedFieldCount: number;
  availability: {
    canonicalFacts: boolean;
    assumptionsLedger: boolean;
    valuation: boolean;
    scenarios: boolean;
    evidence: boolean;
    dataConfidence: boolean;
    researchReport: boolean;
  };
  /** Explicit fail-closed markers, e.g. NO_ANNUAL_FINANCIALS, NO_VALUATION. */
  blockers: string[];
}

// ─────────────────────────────────────────────────────────────
// Provenance of the case assembly itself
// ─────────────────────────────────────────────────────────────

export interface CaseProvenance {
  /** Inputs the caller supplied (referenced, not copied). */
  provided: string[];
  /** Pieces the builder derived via existing engines (still single-source). */
  derived: string[];
}

// ─────────────────────────────────────────────────────────────
// ResearchCase
// ─────────────────────────────────────────────────────────────

export interface ResearchCase {
  caseId: string;
  version: string;

  company: CompanyProfile;
  stock: StockData;

  architecture: ResearchArchitecture;

  historicalFinancials: AnnualFinancials[];
  quarterlyFinancials: QuarterlyFinancials[];

  ontology: CompanyOntology;

  /** Sealed canonical fact graph — referenced, never forked. */
  canonicalFacts: CanonicalFactGraph | null;
  assumptionsLedger: AssumptionsLedger | null;
  valuation: DCFResult | null;
  scenarios: ScenarioSet | null;
  peers: PeerSet;
  evidence: EvidenceRegistry | null;

  management: ManagementResearch;
  competition: CompetitionResearch;
  industry: IndustryResearch;
  accounting: AccountingResearch;
  catalysts: CatalystResearch;
  risks: RiskResearch;

  researchQuestions: ResearchQuestion[];
  unknowns: ResearchUnknown[];

  dataQuality: DataQualityAssessment;
  /** AI confidence when a research report exists; null = not assessed (never invented). */
  confidence: ConfidenceAssessment | null;
  complexity: ResearchComplexity;

  provenance: CaseProvenance;

  createdAt: string;
  dataCutoff: string;
  modelVersion: string;
}

// ─────────────────────────────────────────────────────────────
// Builder input
// ─────────────────────────────────────────────────────────────

export interface BuildResearchCaseParams {
  /** Required. */
  profile: CompanyProfile;
  /** Required. */
  stockData: StockData;

  annualFinancials?: AnnualFinancials[] | null;
  quarterlyFinancials?: QuarterlyFinancials[] | null;

  // Pre-built canonical objects from the existing pipeline — referenced as-is.
  ontology?: CompanyOntology | null;
  canonicalFacts?: CanonicalFactGraph | null;
  assumptionsLedger?: AssumptionsLedger | null;
  valuation?: DCFResult | null;
  scenarios?: ScenarioSet | null;
  peers?: PeerData[] | null;
  evidence?: EvidenceRegistry | null;
  dataConfidence?: DataConfidenceReport | null;

  // Optional research-layer inputs (populated when the AI research ran).
  researchReport?: import("@/lib/ai-first/types").ResearchReport | null;
  researchPlan?: { questions?: ResearchQuestion[]; unknowns?: string[] } | null;
  aiAnalysis?: AIAnalysis | null;
  eventPriceMovements?: EventPriceMovement[] | null;

  /** Wall-clock stamp for `createdAt` (injectable for deterministic tests). */
  createdAt?: string;
  /** Data cutoff; defaults to canonical-facts asOf, then `createdAt`. */
  dataCutoff?: string;
  modelVersion?: string;
}
