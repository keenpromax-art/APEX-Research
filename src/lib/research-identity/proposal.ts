export const RESEARCH_IDENTITY_PROPOSAL_VERSION = "research-identity-proposal-v1";

export const ECONOMIC_IDENTITY_TYPES = [
  "deposit-funded-bank",
  "lending-spread-finance",
  "underwriting-float-insurer",
  "subscription-platform",
  "transactional-platform",
  "branded-volume-business",
  "pipeline-research-business",
  "unit-volume-business",
  "project-pipeline-business",
  "contracted-asset-business",
  "asset-backed-business",
  "multi-segment-holding",
  "cyclical-capital-business",
  "distressed-turnaround",
  "diversified-corporate",
] as const;
export type EconomicIdentityType = (typeof ECONOMIC_IDENTITY_TYPES)[number];

export const VALUATION_IDENTITY_TYPES = [
  "residual-income-equity",
  "operating-cash-flow-dcf",
  "segment-sum-of-parts",
  "asset-nav",
  "recovery-option",
  "undetermined",
] as const;
export type ValuationIdentityType = (typeof VALUATION_IDENTITY_TYPES)[number];

export const INVESTOR_QUESTION_TYPES = [
  "balance-sheet-franchise",
  "credit-cycle",
  "returns-durability",
  "growth-durability",
  "unit-economics",
  "cycle-normalization",
  "segment-value",
  "capital-allocation",
  "valuation-expectations",
  "regulatory-capital",
  "turnaround-feasibility",
  "event-resolution",
  "unknown",
] as const;
export type InvestorQuestionType = (typeof INVESTOR_QUESTION_TYPES)[number];

export const NARRATIVE_ARCHETYPES = [
  "compounder",
  "growth",
  "forensic",
  "credit",
  "deep-value",
  "turnaround",
  "conglomerate",
  "asset-backed",
  "event-driven",
  "cyclical",
  "strategic",
] as const;
export type NarrativeArchetype = (typeof NARRATIVE_ARCHETYPES)[number];

export const VISUAL_ARCHETYPES = [
  "compounder",
  "growth",
  "forensic",
  "credit",
  "deep-value",
  "turnaround",
  "conglomerate",
  "asset-backed",
  "event-driven",
  "cyclical",
] as const;
export type VisualArchetype = (typeof VISUAL_ARCHETYPES)[number];

export const SIGNATURE_ANALYSIS_TYPES = [
  "balance-sheet-franchise",
  "credit-cycle-stress",
  "earnings-power-bridge",
  "growth-margin-cash-bridge",
  "volume-price-mix",
  "pipeline-research-economics",
  "contracted-cash-flow",
  "asset-base-returns",
  "segment-value-bridge",
  "cycle-normalization",
  "recovery-bridge",
  "capital-allocation-record",
  "market-implied-expectations",
  "unit-economics",
] as const;
export type SignatureAnalysisType = (typeof SIGNATURE_ANALYSIS_TYPES)[number];

export const MATERIALITY_TOPICS = [
  "growth-engine",
  "margin-returns",
  "cash-conversion",
  "capital-allocation",
  "balance-sheet",
  "asset-quality",
  "funding-liquidity",
  "segment-economics",
  "sum-of-parts",
  "project-pipeline",
  "unit-economics",
  "volume-price-mix",
  "research-pipeline",
  "valuation-expectations",
  "scenarios",
  "management",
  "risks",
  "catalysts",
  "peers",
  "evidence",
] as const;
export type MaterialityTopicId = (typeof MATERIALITY_TOPICS)[number];

export const ANALYTICAL_DEPTH_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type AnalyticalDepth = (typeof ANALYTICAL_DEPTH_LEVELS)[number];

export const MATERIALITY_TIERS = [
  "TIER_1_CORE",
  "TIER_2_IMPORTANT",
  "TIER_3_SUPPORTING",
  "TIER_4_BACKGROUND",
  "TIER_5_SUPPRESS",
] as const;
export type MaterialityTier = (typeof MATERIALITY_TIERS)[number];

export interface IdentityProposedAssertion {
  value?: string;
  confidence?: number;
  rationale?: string;
  evidenceIds?: string[];
}

export interface IdentityProposedMateriality {
  topicId?: string;
  scoreAdjustment?: number;
  rationale?: string;
  evidenceIds?: string[];
}

export interface IdentityProposedSignature {
  type?: string;
  title?: string;
  question?: string;
  rationale?: string;
  evidenceIds?: string[];
}

export interface IdentityProposedProfile {
  archetype?: string;
  rationale?: string;
  evidenceIds?: string[];
}

export interface IdentityProposedSection {
  sectionId?: string;
  depth?: number;
  reason?: string;
  evidenceIds?: string[];
}

export interface IdentityProposedCover {
  title?: string;
  subtitle?: string;
  rationale?: string;
  evidenceIds?: string[];
}

export interface ResearchIdentityProposal {
  version: string;
  generatedBy: string;
  economicIdentityType?: string;
  economicIdentity?: Record<string, IdentityProposedAssertion>;
  investorQuestion?: IdentityProposedAssertion & { type?: string };
  materiality?: IdentityProposedMateriality[];
  signatureAnalyses?: IdentityProposedSignature[];
  narrativeProfile?: IdentityProposedProfile;
  visualProfile?: IdentityProposedProfile;
  title?: IdentityProposedCover;
  sections?: IdentityProposedSection[];
}

function asString(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringList(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = asString(item, 220);
    if (text && !out.includes(text) && out.length < max) out.push(text);
  }
  return out;
}

function asAssertion(value: unknown): IdentityProposedAssertion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const assertion: IdentityProposedAssertion = {
    value: asString(input.value),
    rationale: asString(input.rationale),
    evidenceIds: asStringList(input.evidenceIds),
  };
  const confidence = asNumber(input.confidence);
  if (confidence !== undefined) assertion.confidence = Math.max(0, Math.min(1, confidence));
  if (!assertion.value && !assertion.rationale && (assertion.evidenceIds ?? []).length === 0) return undefined;
  return assertion;
}

function asRecord(value: unknown): Record<string, IdentityProposedAssertion> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, IdentityProposedAssertion> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
    const assertion = asAssertion(item);
    if (assertion) out[key] = assertion;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function asMateriality(value: unknown): IdentityProposedMateriality[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: IdentityProposedMateriality[] = [];
  for (const item of value.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const topicId = asString(row.topicId, 80);
    const adjustment = asNumber(row.scoreAdjustment);
    const rationale = asString(row.rationale);
    const evidenceIds = asStringList(row.evidenceIds);
    if (!topicId && adjustment === undefined && !rationale && evidenceIds.length === 0) continue;
    out.push({
      topicId,
      scoreAdjustment: adjustment === undefined ? undefined : Math.max(-0.2, Math.min(0.2, adjustment)),
      rationale,
      evidenceIds,
    });
  }
  return out.length > 0 ? out : undefined;
}

function asSignatures(value: unknown): IdentityProposedSignature[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: IdentityProposedSignature[] = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const signature: IdentityProposedSignature = {
      type: asString(row.type, 80),
      title: asString(row.title, 140),
      question: asString(row.question, 280),
      rationale: asString(row.rationale),
      evidenceIds: asStringList(row.evidenceIds),
    };
    if (signature.type || signature.title || signature.question) out.push(signature);
  }
  return out.length > 0 ? out : undefined;
}

function asProfile(value: unknown): IdentityProposedProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const profile: IdentityProposedProfile = {
    archetype: asString(row.archetype, 80),
    rationale: asString(row.rationale),
    evidenceIds: asStringList(row.evidenceIds),
  };
  if (!profile.archetype && !profile.rationale && (profile.evidenceIds ?? []).length === 0) return undefined;
  return profile;
}

function asSections(value: unknown): IdentityProposedSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: IdentityProposedSection[] = [];
  for (const item of value.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sectionId = asString(row.sectionId, 120);
    const depth = asNumber(row.depth);
    const reason = asString(row.reason);
    const evidenceIds = asStringList(row.evidenceIds);
    if (!sectionId && depth === undefined && !reason && evidenceIds.length === 0) continue;
    out.push({
      sectionId,
      depth: depth === undefined ? undefined : Math.max(0, Math.min(5, Math.round(depth))),
      reason,
      evidenceIds,
    });
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeIdentityProposal(input: unknown): ResearchIdentityProposal | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const version = asString(row.version, 80);
  if (version !== RESEARCH_IDENTITY_PROPOSAL_VERSION) return null;
  const generatedBy = asString(row.generatedBy, 120) ?? "unknown";
  const proposal: ResearchIdentityProposal = { version, generatedBy };
  const economicIdentityType = asString(row.economicIdentityType, 80);
  if (economicIdentityType) proposal.economicIdentityType = economicIdentityType;
  const economicIdentity = asRecord(row.economicIdentity);
  if (economicIdentity) proposal.economicIdentity = economicIdentity;
  if (row.investorQuestion && typeof row.investorQuestion === "object") {
    const question = asAssertion(row.investorQuestion);
    const type = asString((row.investorQuestion as Record<string, unknown>).type, 80);
    if (question || type) proposal.investorQuestion = { ...(question ?? {}), type };
  }
  const materiality = asMateriality(row.materiality);
  if (materiality) proposal.materiality = materiality;
  const signatureAnalyses = asSignatures(row.signatureAnalyses);
  if (signatureAnalyses) proposal.signatureAnalyses = signatureAnalyses;
  const narrativeProfile = asProfile(row.narrativeProfile);
  if (narrativeProfile) proposal.narrativeProfile = narrativeProfile;
  const visualProfile = asProfile(row.visualProfile);
  if (visualProfile) proposal.visualProfile = visualProfile;
  if (row.title && typeof row.title === "object") {
    const cover = row.title as Record<string, unknown>;
    const title = asString(cover.title, 140);
    const subtitle = asString(cover.subtitle, 220);
    const rationale = asString(cover.rationale);
    const evidenceIds = asStringList(cover.evidenceIds);
    if (title || subtitle || rationale || evidenceIds.length > 0) {
      proposal.title = { title, subtitle, rationale, evidenceIds };
    }
  }
  const sections = asSections(row.sections);
  if (sections) proposal.sections = sections;
  return proposal;
}
