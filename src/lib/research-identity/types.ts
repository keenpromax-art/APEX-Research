import type { AIAnalysis } from "@/types/report";
import type { ResearchCase } from "@/lib/research-case";
import type { ResearchReport } from "@/lib/ai-first/types";
import type { ResearchModuleId } from "@/lib/research-modules";
import type { ReportTypeId, ResolvedSection, ResearchDepth } from "@/lib/report-types";
import type { SourceTier } from "@/lib/evidence-registry";
export type {
  AnalyticalDepth,
  EconomicIdentityType,
  InvestorQuestionType,
  MaterialityTier,
  MaterialityTopicId,
  NarrativeArchetype,
  ResearchIdentityProposal,
  SignatureAnalysisType,
  ValuationIdentityType,
  VisualArchetype,
} from "./proposal";
import type {
  AnalyticalDepth,
  EconomicIdentityType,
  InvestorQuestionType,
  MaterialityTier,
  MaterialityTopicId,
  NarrativeArchetype,
  ResearchIdentityProposal,
  SignatureAnalysisType,
  ValuationIdentityType,
  VisualArchetype,
} from "./proposal";

export const RESEARCH_IDENTITY_VERSION = "research-identity-v1";
export const RESEARCH_IDENTITY_MODEL_VERSION = "apex-financial-model-v1";

export type IdentityAssertionStatus = "supported" | "insufficient_evidence" | "conflicted" | "unavailable";
export type IdentityEvidenceKind =
  | "evidence-registry"
  | "canonical-fact"
  | "derived-calculation"
  | "ai-fact"
  | "insufficient-evidence";
export type IdentityAvailability = "available" | "insufficient" | "unavailable";
export type ReportCompatibilityStatus = "supported" | "limited" | "unsupported";
export type CollisionStatus = "clear" | "watch" | "template-collision";

export interface IdentityEvidenceReference {
  id: string;
  kind: IdentityEvidenceKind;
  status: IdentityAssertionStatus;
  tier?: SourceTier | number;
  source?: string;
  path?: string;
  confidence?: number;
}

export interface IdentityReferenceInput {
  id: string;
  kind?: IdentityEvidenceKind;
  tier?: SourceTier | number;
  source?: string;
  path?: string;
}

export interface IdentityClaim<T = string> {
  value: T | null;
  status: IdentityAssertionStatus;
  confidence: number;
  rationale: string;
  references: IdentityEvidenceReference[];
}

export interface InvestorQuestion {
  type: InvestorQuestionType;
  status: IdentityAvailability;
  question: string | null;
  rationale: string;
  references: IdentityEvidenceReference[];
  confidence: number;
}

export interface EconomicIdentity {
  type: EconomicIdentityType;
  status: IdentityAssertionStatus;
  confidence: number;
  primaryRevenueEngine: IdentityClaim;
  primaryMarginEngine: IdentityClaim;
  capitalStructureIdentity: IdentityClaim;
  competitiveIdentity: IdentityClaim;
  pricingPower: IdentityClaim;
  cyclicality: IdentityClaim;
  regulatoryDependence: IdentityClaim;
  recurringRevenue: IdentityClaim;
  capitalIntensity: IdentityClaim;
  capitalAllocationImportance: IdentityClaim;
  workingCapitalImportance: IdentityClaim;
  financingDependence: IdentityClaim;
  unitEconomics: IdentityClaim;
  supportingReferences: IdentityEvidenceReference[];
}

export type MaterialityDimension =
  | "earningsImpact"
  | "valuationImpact"
  | "thesisRelevance"
  | "riskRelevance"
  | "uncertainty"
  | "evidenceStrength"
  | "balanceSheetImpact"
  | "strategicImportance"
  | "investorAttention"
  | "historicalAbnormality";

export type MaterialityDimensionScores = Record<MaterialityDimension, number>;

export interface MaterialityAssessment {
  topicId: MaterialityTopicId;
  label: string;
  tier: MaterialityTier;
  score: number;
  depth: AnalyticalDepth;
  dimensions: MaterialityDimensionScores;
  rationale: string;
  references: IdentityEvidenceReference[];
  proposalAdjustment: number;
}

export interface MaterialityProfile {
  status: IdentityAvailability;
  assessments: MaterialityAssessment[];
  coreTopics: MaterialityTopicId[];
  suppressedTopics: MaterialityTopicId[];
  averageScore: number;
  references: IdentityEvidenceReference[];
}

export interface ValuationIdentity {
  type: ValuationIdentityType;
  status: IdentityAssertionStatus;
  method: string | null;
  lens: string | null;
  methodReferences: IdentityEvidenceReference[];
  reverseVariable: string | null;
  reverseConverged: boolean;
  reverseCentral: boolean;
  reverseInterpretation: string | null;
  reverseReferences: IdentityEvidenceReference[];
  confidence: number;
}

export interface EvidenceProfile {
  status: IdentityAvailability;
  registryItems: number;
  aiFactItems: number;
  primaryItems: number;
  secondaryItems: number;
  tertiaryItems: number;
  modelDerivedItems: number;
  missingFields: string[];
  unknownCount: number;
  coverageScore: number;
  confidence: number;
}

export interface IdentityEventItem {
  id: string;
  title: string;
  mechanism: string;
  horizon: string | null;
  direction: "positive" | "negative" | "mixed" | "unknown";
  quantitative: boolean;
  references: IdentityEvidenceReference[];
}

export interface EventProfile {
  status: IdentityAvailability;
  catalysts: IdentityEventItem[];
  risks: IdentityEventItem[];
  eventCategories: string[];
  coverageScore: number;
  references: IdentityEvidenceReference[];
}

export interface ResearchDebate {
  id: string;
  rank: number;
  central: boolean;
  question: string;
  assumption: string | null;
  marketView: IdentityClaim;
  apexEvidence: IdentityEvidenceReference[];
  counterEvidence: IdentityEvidenceReference[];
  difference: string | null;
  mustHappen: string | null;
  invalidate: string | null;
  financialConsequence: string | null;
  valuationConsequence: string | null;
  resolutionSignal: string | null;
  confidence: number;
  status: IdentityAssertionStatus;
}

export interface DebateMap {
  status: IdentityAvailability;
  centralDebateId: string | null;
  debates: ResearchDebate[];
  unsupportedCount: number;
}

export interface NarrativeProfile {
  archetype: NarrativeArchetype;
  status: IdentityAssertionStatus;
  fundamentalIntensity: number;
  valuationIntensity: number;
  forensicIntensity: number;
  strategicIntensity: number;
  eventIntensity: number;
  creditIntensity: number;
  quantitativeDensity: number;
  skepticism: number;
  evidenceRequirement: number;
  scenarioEmphasis: number;
  managementWeight: number;
  rationale: string;
  references: IdentityEvidenceReference[];
  confidence: number;
}

export interface VisualProfile {
  archetype: VisualArchetype;
  status: IdentityAssertionStatus;
  density: "spacious" | "balanced" | "dense";
  chartFrequency: number;
  tableFrequency: number;
  calloutFrequency: number;
  dividerStyle: "hairline" | "numbered-band" | "question-led";
  coverStructure: "question-led" | "metrics-led" | "valuation-led" | "segment-led" | "recovery-led" | "evidence-led";
  typographyEmphasis: "question" | "metrics" | "valuation" | "evidence";
  chartEmphasis: "trend" | "comparison" | "composition" | "sensitivity";
  rationale: string;
  references: IdentityEvidenceReference[];
  confidence: number;
}

export interface SignatureAnalysis {
  id: string;
  type: SignatureAnalysisType;
  title: string;
  question: string;
  topicId: MaterialityTopicId;
  depth: AnalyticalDepth;
  sectionId: string | null;
  chartIds: string[];
  tableIds: string[];
  status: IdentityAssertionStatus;
  rationale: string;
  references: IdentityEvidenceReference[];
  confidence: number;
}

export type ChartFamily =
  | "growth"
  | "profitability"
  | "cash-flow"
  | "leverage"
  | "returns"
  | "funding"
  | "asset-quality"
  | "capital"
  | "portfolio"
  | "pipeline"
  | "valuation"
  | "expectations"
  | "sensitivity"
  | "scenarios"
  | "comparison"
  | "ownership"
  | "events"
  | "evidence";

export type TableFamily =
  | "statements"
  | "valuation"
  | "scenarios"
  | "sensitivity"
  | "segments"
  | "peers"
  | "capital"
  | "funding"
  | "asset-quality"
  | "portfolio"
  | "pipeline"
  | "risks"
  | "catalysts"
  | "management"
  | "evidence";

export interface ChartPlan {
  id: string;
  title: string;
  family: ChartFamily;
  question: string;
  topicId: MaterialityTopicId;
  selected: boolean;
  priority: number;
  sectionId: string | null;
  signatureIds: string[];
  modules: ResearchModuleId[];
  dataSelector: string;
  decisionValue: string;
  omissionReason: string | null;
  references: IdentityEvidenceReference[];
}

export interface ChartSelection {
  status: IdentityAvailability;
  selected: ChartPlan[];
  omitted: ChartPlan[];
}

export interface TablePlan {
  id: string;
  title: string;
  family: TableFamily;
  question: string;
  topicId: MaterialityTopicId;
  selected: boolean;
  priority: number;
  sectionId: string | null;
  signatureIds: string[];
  modules: ResearchModuleId[];
  dataSelector: string;
  decisionValue: string;
  omissionReason: string | null;
  references: IdentityEvidenceReference[];
}

export interface TableSelection {
  status: IdentityAvailability;
  selected: TablePlan[];
  omitted: TablePlan[];
}

export interface SectionPlan {
  sectionId: string;
  title: string;
  topicId: MaterialityTopicId;
  order: number;
  depth: AnalyticalDepth;
  priority: number;
  include: boolean;
  mandatory: boolean;
  signatureIds: string[];
  chartIds: string[];
  tableIds: string[];
  rationale: string;
  rhythm: string[];
  references: IdentityEvidenceReference[];
}

export interface SectionArchitecture {
  status: IdentityAvailability;
  sections: SectionPlan[];
  included: SectionPlan[];
  suppressed: SectionPlan[];
  orderingRationale: string;
}

export interface PageAllocation {
  sectionId: string;
  title: string;
  depth: AnalyticalDepth;
  spaceUnits: number;
  relativeShare: number;
  estimatedPages: number;
  chartCount: number;
  tableCount: number;
  rationale: string;
}

export interface PageAllocationPlan {
  status: IdentityAvailability;
  totalUnits: number;
  estimatedPages: number;
  allocations: PageAllocation[];
}

export interface CoverSpec {
  title: string;
  subtitle: string;
  eyebrow: string;
  investorQuestion: string | null;
  questionStatus: IdentityAvailability;
  metricKeys: string[];
  arrangement: VisualProfile["coverStructure"];
  emphasis: string;
  references: IdentityEvidenceReference[];
}

export interface ReportCompatibility {
  reportTypeId: ReportTypeId;
  status: ReportCompatibilityStatus;
  capability: string;
  reasons: string[];
}

export interface SimilarityScore {
  fingerprint: string;
  sectionOrderSimilarity: number;
  chartSimilarity: number;
  tableSimilarity: number;
  profileSimilarity: number;
  titleSimilarity: number;
  overall: number;
}

export interface CollisionReport {
  status: CollisionStatus;
  comparisons: number;
  maximumSimilarity: number;
  averageSimilarity: number;
  reasons: string[];
  fingerprint: string;
}

export interface FlavourFinding {
  id: string;
  check: string;
  severity: "pass" | "warning" | "blocker";
  message: string;
  sectionId: string | null;
}

export interface FlavourQaResult {
  version: string;
  identityId: string;
  caseId: string;
  evaluatedAt: string;
  passed: boolean;
  score: number;
  findings: FlavourFinding[];
  blockers: string[];
  warnings: string[];
}

export interface ResearchIdentityDebug {
  summary: string;
  economicIdentity: string;
  investorQuestion: string;
  materiality: string;
  signatureAnalyses: string[];
  includedSections: string[];
  suppressedSections: string[];
  selectedCharts: string[];
  selectedTables: string[];
  narrativeProfile: string;
  visualProfile: string;
  pageAllocation: string;
  similarity: string;
  collision: string;
  fingerprint: string;
}

export interface ResearchIdentityCanonicalIntegrity {
  canonicalSealValidBefore: boolean;
  canonicalSealValidAfter: boolean;
  canonicalHashBefore: string | null;
  canonicalHashAfter: string | null;
  financialSnapshotBefore: string;
  financialSnapshotAfter: string;
  unchanged: boolean;
}

export interface ResearchDNA {
  version: string;
  identityId: string;
  caseId: string;
  ticker: string;
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  asOf: string;
  proposalUsed: boolean;
  economicIdentity: EconomicIdentity;
  investorQuestion: InvestorQuestion;
  materiality: MaterialityProfile;
  valuationIdentity: ValuationIdentity;
  evidenceProfile: EvidenceProfile;
  eventProfile: EventProfile;
  debates: DebateMap;
  narrativeProfile: NarrativeProfile;
  visualProfile: VisualProfile;
  signatureAnalyses: SignatureAnalysis[];
  sections: SectionArchitecture;
  charts: ChartSelection;
  tables: TableSelection;
  pageAllocation: PageAllocationPlan;
  cover: CoverSpec;
  compatibility: ReportCompatibility;
  collision: CollisionReport;
  canonicalIntegrity: ResearchIdentityCanonicalIntegrity;
  debug: ResearchIdentityDebug;
}

export interface ResearchIdentitySource {
  researchCase: ResearchCase;
  researchReport?: ResearchReport | null;
  aiAnalysis?: AIAnalysis | null;
  proposal?: ResearchIdentityProposal | null;
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  priorIdentities?: ResearchDNA[];
  createdAt?: string;
}

export interface ResearchIdentitySectionContext {
  outline: ResolvedSection[];
  blueprintId: ReportTypeId;
}
