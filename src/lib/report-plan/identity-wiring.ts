import { stableHash } from "@/lib/research-ledger/stable";
import type { CanonicalResearchPackage } from "@/lib/research-package/types";
import type { ResearchDNA } from "@/lib/research-identity";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";
import { buildResearchIdentity } from "@/lib/research-identity/build";
import type { ResearchCase } from "@/lib/research-case";

export const COMPANY_IDENTITY_KIND = "IDENTITY";
export const COMPANY_IDENTITY_VERSION = "company-identity-v1";
export const IDENTITY_STORE_BOUND = 20;

export interface CompanyIdentity {
  kind: typeof COMPANY_IDENTITY_KIND;
  version: typeof COMPANY_IDENTITY_VERSION;
  identityId: string;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  statementArchitecture: string | null;
  archetype: string | null;
  sourceHash: string | null;
  asOf: string;
  fingerprint: string;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function fingerprintCompanyIdentity(value: Omit<CompanyIdentity, "fingerprint" | "identityId"> & { identityId?: string }): string {
  const payload = {
    kind: value.kind,
    version: value.version,
    ticker: value.ticker,
    companyName: value.companyName,
    sector: value.sector,
    industry: value.industry,
    currency: value.currency,
    statementArchitecture: value.statementArchitecture,
    archetype: value.archetype,
    sourceHash: value.sourceHash,
    asOf: value.asOf,
  };
  return stableHash(payload, "company-identity/v1");
}

export function buildCompanyIdentity(input: { ticker: string; companyName?: string | null; sector?: string | null; industry?: string | null; currency?: string | null; statementArchitecture?: string | null; archetype?: string | null; sourceHash?: string | null; asOf: string }): CompanyIdentity {
  const ticker = input.ticker.trim().toUpperCase();
  const base = {
    kind: COMPANY_IDENTITY_KIND as typeof COMPANY_IDENTITY_KIND,
    version: COMPANY_IDENTITY_VERSION as typeof COMPANY_IDENTITY_VERSION,
    ticker,
    companyName: cleanString(input.companyName),
    sector: cleanString(input.sector),
    industry: cleanString(input.industry),
    currency: cleanString(input.currency),
    statementArchitecture: cleanString(input.statementArchitecture),
    archetype: cleanString(input.archetype),
    sourceHash: cleanString(input.sourceHash),
    asOf: input.asOf,
  };
  const fingerprint = fingerprintCompanyIdentity(base);
  const identityId = `IDENTITY-${fingerprint.slice(0, 24).toUpperCase()}`;
  return { ...base, identityId, fingerprint };
}

export function companyIdentityFromPackage(packageValue: CanonicalResearchPackage, asOf: string): CompanyIdentity {
  const profile = packageValue.sourceContext.profile as unknown as Record<string, unknown>;
  const ticker = String(packageValue.ticker ?? profile.ticker ?? "UNKNOWN");
  return buildCompanyIdentity({
    ticker,
    companyName: typeof profile.name === "string" ? profile.name : null,
    sector: typeof profile.sector === "string" ? profile.sector : null,
    industry: typeof profile.industry === "string" ? profile.industry : null,
    currency: typeof profile.currency === "string" ? profile.currency : null,
    statementArchitecture: null,
    archetype: null,
    sourceHash: packageValue.sourceSnapshotHash ?? null,
    asOf,
  });
}

export function isCompanyIdentity(value: unknown): value is CompanyIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as CompanyIdentity;
  return candidate.kind === COMPANY_IDENTITY_KIND && candidate.version === COMPANY_IDENTITY_VERSION && typeof candidate.identityId === "string" && typeof candidate.ticker === "string";
}

export function isResearchDna(value: unknown): value is ResearchDNA {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return candidate.version === "research-identity-v1" && typeof candidate.identityId === "string" && (candidate as { identityId?: string }).identityId?.startsWith("rid-") === true;
}

export interface WireIdentityInput {
  researchCase: ResearchCase;
  reportTypeId: ReportTypeId;
  depth: ResearchDepth;
  createdAt: string;
  priorIdentities?: ResearchDNA[];
  proposal?: import("@/lib/research-identity").ResearchIdentityProposal | null;
  researchReport?: ResearchCase extends never ? never : import("@/lib/ai-first/types").ResearchReport | null;
}

export function wireResearchIdentity(input: WireIdentityInput): ResearchDNA {
  const prior = Array.isArray(input.priorIdentities) ? input.priorIdentities.slice(-IDENTITY_STORE_BOUND) : [];
  return buildResearchIdentity({
    researchCase: input.researchCase,
    reportTypeId: input.reportTypeId,
    depth: input.depth,
    createdAt: input.createdAt,
    priorIdentities: prior,
    ...(input.proposal !== undefined ? { proposal: input.proposal } : {}),
    ...(input.researchReport !== undefined ? { researchReport: input.researchReport } : {}),
  });
}

export interface IdentityPublicationInput {
  identity: ResearchDNA | null;
  companyIdentity: CompanyIdentity | null;
  qaDecision: string | null;
  canPublish: boolean;
}

export function identityPublicationStatus(input: IdentityPublicationInput): { canPublish: boolean; publishAllowed: boolean; label: string; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.identity) reasons.push("Research identity is unavailable");
  if (!input.companyIdentity) reasons.push("Company identity is unavailable");
  if (input.identity && input.companyIdentity && input.identity.ticker !== input.companyIdentity.ticker) reasons.push("Identity ticker mismatch");
  const collision = input.identity?.collision;
  if (collision?.status === "template-collision") reasons.push(`Identity collision: ${collision.reasons.join("; ") || "template collision"}`);
  if (input.qaDecision === "BLOCK") reasons.push("Canonical QA decision is BLOCK");
  if (input.qaDecision === "REVIEW") reasons.push("Canonical QA decision is REVIEW");
  if (!input.canPublish) reasons.push("Canonical quality gate does not allow publication");
  const blocked = reasons.length > 0;
  if (blocked) {
    const preview = input.qaDecision === "REVIEW" || input.qaDecision === "BLOCK" || !input.canPublish || collision?.status === "template-collision";
    return { canPublish: false, publishAllowed: false, label: preview ? "Diagnostic preview (non-publishable)" : "Diagnostic preview (non-publishable)", reasons };
  }
  if (collision?.status === "watch") {
    return { canPublish: true, publishAllowed: true, label: "Qualified PDF with disclosed qualifications", reasons: [`Identity watch: ${collision.reasons.join("; ")}`] };
  }
  if (input.qaDecision === "QUALIFIED") {
    return { canPublish: true, publishAllowed: true, label: "Qualified PDF with disclosed qualifications", reasons: [] };
  }
  return { canPublish: true, publishAllowed: true, label: "PDF", reasons: [] };
}
