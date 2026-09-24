import { RESEARCH_IDENTITY_PROPOSAL_VERSION } from "./proposal";
import { normalizeIdentityProposal, type ResearchIdentityProposal } from "./proposal";

/**
 * Provider-agnostic AI tasks for the research identity layer.
 * Prompts request STRICT JSON matching RESEARCH_IDENTITY_PROPOSAL_VERSION;
 * responses are validated with normalizeIdentityProposal and every asserted
 * evidence id is re-checked against the deterministic reference index at
 * build time. AI may propose, never decide: unsupported proposals are ignored.
 */

export const IDENTITY_PROPOSAL_TASKS = [
  "economic-identity",
  "investor-question",
  "materiality-reasoning",
  "debate-identification",
  "signature-selection",
  "narrative-profile",
  "visual-profile",
  "structure-recommendation",
  "identity-validation",
] as const;

export type IdentityProposalTask = (typeof IDENTITY_PROPOSAL_TASKS)[number];

export function buildIdentityProposalPrompt(input: {
  ticker: string;
  companyName: string;
  sectorName: string;
  statementArchitecture: string;
  financialArchetype: string;
  economicAbstraction?: string | null;
}): string {
  return [
    `You are an institutional equity analyst. Propose a research identity for ${input.companyName} (${input.ticker}).`,
    `Sector: ${input.sectorName}. Statement architecture: ${input.statementArchitecture}. Archetype: ${input.financialArchetype}.`,
    input.economicAbstraction ? `Observed economic abstraction: ${input.economicAbstraction}.` : "No observed economic abstraction was supplied.",
    `Return STRICT JSON ONLY with version "${RESEARCH_IDENTITY_PROPOSAL_VERSION}".`,
    "Allowed top-level keys: version, generatedBy, economicIdentityType, economicIdentity, investorQuestion, materiality, signatureAnalyses, narrativeProfile, visualProfile, title, sections.",
    "Every assertion must cite evidenceIds that already exist in the supplied research (fact ids like [F-...], evidence registry ids, or canonical ids).",
    "If you lack evidence for a field, OMIT it — never invent evidence ids, numbers, peers, consensus, or financial facts.",
    "scoreAdjustment must stay within [-0.2, 0.2]; depth within [0, 5].",
  ].join("\n");
}

export function parseIdentityProposalResponse(raw: unknown): ResearchIdentityProposal | null {
  if (typeof raw === "string") {
    try {
      return normalizeIdentityProposal(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return normalizeIdentityProposal(raw);
}

export function identityProposalTaskList(): IdentityProposalTask[] {
  return [...IDENTITY_PROPOSAL_TASKS];
}
