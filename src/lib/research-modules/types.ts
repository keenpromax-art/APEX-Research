/**
 * APEX RESEARCH — Research Modules (Phase 3)
 * ------------------------------------------
 * Report-agnostic module contract. Each module is a pure, deterministic
 * WRAPPER around objects the existing pipeline (or ResearchCase) already
 * produced. Modules never rewrite calculations and never invent numbers.
 *
 * PHASE 3 RULES (non-negotiable):
 *  - Prefer reference identity with provided pipeline objects.
 *  - Resolve anchors through the existing single-source hierarchy
 *    (ledger → masterReportFacts → dcf) — never a parallel formula.
 *  - Missing data stays null / empty and is recorded as an explicit unknown.
 *  - No LLM calls. No PDF/page coupling. Report output is unchanged.
 */
import type {
  AIAnalysis,
  AnnualFinancials,
  AssumptionsLedger,
  CompanyProfile,
  DCFResult,
  DuPontAnalysis,
  EventPriceMovement,
  Officer,
  QuarterlyFinancials,
  Ratios,
  ReportQAResult,
  FinancialSupervisionSummary,
  ShareholdingData,
  TickerNewsItem,
} from "@/types/report";
import type { CanonicalFactGraph } from "@/lib/canonical-facts";
import type { DataConfidenceReport } from "@/lib/data-confidence";
import type { EvidenceRegistry } from "@/lib/evidence-registry";
import type { ScenarioSet } from "@/lib/scenarios";
import type { CompanyOntology } from "@/lib/company-ontology";
import type { MasterReportFacts, DataQuality, PeerFacts } from "@/lib/report-facts";
import type { MoatFacts } from "@/lib/moat";
import type { UncertaintyFacts } from "@/lib/uncertainty";
import type { ValuationAuditReport } from "@/lib/valuation-audit";
import type { BaselineReconciliation } from "@/lib/guidance-reconciliation";
import type { ValuationCalibration } from "@/types/report";
import type { ResearchReport } from "@/lib/ai-first/types";
import type {
  CatalystResearch,
  CompetitionResearch,
  IndustryResearch,
  ManagementResearch,
  PeerSet,
  ResearchArchitecture,
  ResearchCase,
  ResearchComplexity,
  ResearchUnknown,
  RiskResearch,
  DataQualityAssessment,
} from "@/lib/research-case";
import type { ResearchQuestion } from "@/lib/ai-first/research-planner";
import type { ConfidenceAssessment } from "@/lib/ai-first/types";

export const RESEARCH_MODULES_VERSION = "research-modules-v1";

export type ResearchModuleId =
  | "business"
  | "statements"
  | "valuation"
  | "peers"
  | "moat"
  | "risk-catalyst"
  | "management"
  | "quality"
  | "thesis";

/** Canonical presentation order (blueprints may select a subset). */
export const RESEARCH_MODULE_ORDER: readonly ResearchModuleId[] = [
  "business",
  "statements",
  "valuation",
  "peers",
  "moat",
  "risk-catalyst",
  "management",
  "quality",
  "thesis",
] as const;

/**
 * Pipeline context: ResearchCase plus optional objects that only the live
 * route / ReportClient hold. All optional fields are REFERENCED, never rebuilt.
 */
export interface ModuleContext {
  researchCase: ResearchCase;
  masterReportFacts?: MasterReportFacts | null;
  ratiosByYear?: Ratios[] | null;
  dupontByYear?: DuPontAnalysis[] | null;
  dataConfidence?: DataConfidenceReport | null;
  valuationAudit?: ValuationAuditReport | null;
  baselineReconciliation?: BaselineReconciliation | null;
  supervision?: FinancialSupervisionSummary | null;
  selectedModel?: string | null;
  valuationLens?: string | null;
  calibration?: ValuationCalibration | null;
  aiAnalysis?: AIAnalysis | null;
  researchReport?: ResearchReport | null;
  eventPriceMovements?: EventPriceMovement[] | null;
  shareholding?: ShareholdingData | null;
  news?: TickerNewsItem[] | null;
  qaReport?: ReportQAResult | null;
}

export interface ModuleRunMeta {
  moduleId: ResearchModuleId;
  title: string;
  /** ReportBlueprint section ids this module feeds (Phase 4+). */
  feeds: string[];
  /** True when the module produced a usable slice (gaps allowed inside). */
  available: boolean;
  /** Explicit gaps — never filled with invention. */
  unknowns: string[];
  /** Names of existing objects referenced as sources. */
  sources: string[];
  /** Present only when the module threw (non-blocking runner catches). */
  error?: string;
}

export interface ResearchModule<TData> {
  id: ResearchModuleId;
  title: string;
  feeds: string[];
  run(ctx: ModuleContext): { data: TData; available: boolean; unknowns: string[]; sources: string[] };
}

export type ResearchModuleRun<TData = unknown> = ModuleRunMeta & { data: TData | null };

export interface ModuleRunBundle {
  caseId: string;
  version: string;
  modulesVersion: string;
  ranAt: string;
  modules: ResearchModuleRun[];
  /** Aggregated unknowns across selected modules. */
  unknowns: string[];
}

// ─────────────────────────────────────────────────────────────
// Module data slices (thin — existing types, no parallel models)
// ─────────────────────────────────────────────────────────────

export interface BusinessModuleData {
  company: CompanyProfile;
  architecture: ResearchArchitecture;
  ontology: CompanyOntology;
  industry: IndustryResearch;
}

export interface StatementsModuleData {
  annual: AnnualFinancials[];
  quarterly: QuarterlyFinancials[];
  ratiosByYear: Ratios[] | null;
  dupontByYear: DuPontAnalysis[] | null;
  canonicalFacts: CanonicalFactGraph | null;
}

export type ValuationAnchorSource = "ledger" | "masterReportFacts" | "dcf" | "none";

export interface ValuationModuleData {
  dcf: DCFResult | null;
  ledger: AssumptionsLedger | null;
  scenarios: ScenarioSet | null;
  rating: "BUY" | "HOLD" | "SELL" | "NR" | null;
  targetPrice: number | null;
  currentPrice: number | null;
  fairValue: number | null;
  upsideDownsidePct: number | null;
  selectedModel: string | null;
  valuationLens: string | null;
  calibration: ValuationCalibration | null;
  valuationAudit: ValuationAuditReport | null;
  baselineReconciliation: BaselineReconciliation | null;
  supervision: FinancialSupervisionSummary | null;
  /** Which existing object supplied rating/FV/currentPrice anchors. */
  anchorsFrom: ValuationAnchorSource;
}

export interface PeersModuleData {
  peerSet: PeerSet;
  peerFacts: PeerFacts | null;
}

export interface MoatModuleData {
  /** Ledger uses Positive/Stable/Negative; moat engine uses Improving/Stable/Declining. */
  rating: "Wide" | "Narrow" | "None" | null;
  trend: "Positive" | "Stable" | "Negative" | "Improving" | "Declining" | null;
  bridge: string | null;
  moatFacts: MoatFacts | null;
  competition: CompetitionResearch;
  sourcesFrom: "ledger" | "masterReportFacts" | "none";
}

export interface RiskCatalystModuleData {
  risks: RiskResearch;
  catalysts: CatalystResearch;
  eventPriceMovements: EventPriceMovement[];
  uncertainty: UncertaintyFacts | null;
  primaryRisks: string[];
}

export interface ManagementModuleData {
  management: ManagementResearch;
  officers: Officer[];
  shareholding: ShareholdingData | null;
}

export interface QualityModuleData {
  dataQuality: DataQualityAssessment;
  evidence: EvidenceRegistry | null;
  dataConfidence: DataConfidenceReport | null;
  quality: DataQuality | null;
  qaReport: ReportQAResult | null;
}

export interface ThesisModuleData {
  rating: "BUY" | "HOLD" | "SELL" | "NR" | null;
  targetPrice: number | null;
  currentPrice: number | null;
  fairValue: number | null;
  upsideDownsidePct: number | null;
  complexity: ResearchComplexity;
  researchQuestions: ResearchQuestion[];
  unknowns: ResearchUnknown[];
  confidence: ConfidenceAssessment | null;
  /** AI-supplied thesis prose when present; null = not available (never invented). */
  narrative: string | null;
}

export type ResearchModuleOutputMap = {
  business: BusinessModuleData;
  statements: StatementsModuleData;
  valuation: ValuationModuleData;
  peers: PeersModuleData;
  moat: MoatModuleData;
  "risk-catalyst": RiskCatalystModuleData;
  management: ManagementModuleData;
  quality: QualityModuleData;
  thesis: ThesisModuleData;
};
