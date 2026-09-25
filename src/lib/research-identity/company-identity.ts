import { stableHash } from "@/lib/research-ledger/stable";

export const IDENTITY_KIND = "IDENTITY";
export const IDENTITY_VERSION = "company-identity-v1";

export interface IdentityCompanySnapshot {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  statementArchitecture: string | null;
  archetype: string | null;
  sourceHash: string | null;
  asOf: string;
}

export interface CompanyIdentityRecord extends IdentityCompanySnapshot {
  kind: typeof IDENTITY_KIND;
  version: typeof IDENTITY_VERSION;
  identityId: string;
  fingerprint: string;
}

function cleanOptional(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildIdentityCompanySnapshot(input: {
  ticker: string;
  companyName?: unknown;
  sector?: unknown;
  industry?: unknown;
  currency?: unknown;
  statementArchitecture?: unknown;
  archetype?: unknown;
  sourceHash?: unknown;
  asOf: string;
}): IdentityCompanySnapshot {
  return {
    ticker: String(input.ticker ?? "").trim().toUpperCase() || "UNKNOWN",
    companyName: cleanOptional(input.companyName),
    sector: cleanOptional(input.sector),
    industry: cleanOptional(input.industry),
    currency: cleanOptional(input.currency),
    statementArchitecture: cleanOptional(input.statementArchitecture),
    archetype: cleanOptional(input.archetype),
    sourceHash: cleanOptional(input.sourceHash),
    asOf: input.asOf,
  };
}

export function fingerprintIdentityCompany(snapshot: IdentityCompanySnapshot): string {
  return stableHash(snapshot, "research-identity/company-identity/v1");
}

export function buildCompanyIdentityRecord(snapshot: IdentityCompanySnapshot): CompanyIdentityRecord {
  const fingerprint = fingerprintIdentityCompany(snapshot);
  return {
    ...snapshot,
    kind: IDENTITY_KIND,
    version: IDENTITY_VERSION,
    identityId: `IDENTITY-${fingerprint.slice(0, 24).toUpperCase()}`,
    fingerprint,
  };
}

export function isIdentityCompany(value: unknown): value is CompanyIdentityRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as CompanyIdentityRecord;
  return candidate.kind === IDENTITY_KIND && candidate.version === IDENTITY_VERSION && typeof candidate.identityId === "string";
}

export function identityCompanyFromResearchCase(input: { ticker?: unknown; companyName?: unknown; sector?: unknown; industry?: unknown; currency?: unknown; statementArchitecture?: unknown; archetype?: unknown; sourceHash?: unknown; asOf: string }): CompanyIdentityRecord {
  return buildCompanyIdentityRecord(buildIdentityCompanySnapshot({
    ticker: typeof input.ticker === "string" && input.ticker ? input.ticker : "UNKNOWN",
    companyName: input.companyName,
    sector: input.sector,
    industry: input.industry,
    currency: input.currency,
    statementArchitecture: input.statementArchitecture,
    archetype: input.archetype,
    sourceHash: input.sourceHash,
    asOf: input.asOf,
  }));
}
