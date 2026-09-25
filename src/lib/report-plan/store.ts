import type { ReportPlan } from "./types";
import type { ResearchDNA } from "@/lib/research-identity";
import { IDENTITY_STORE_BOUND } from "./identity-wiring";

export const REPORT_PLAN_STORE_BOUND = 50;
export const REPORT_IDENTITY_STORE_BOUND = IDENTITY_STORE_BOUND;

const planByTicker = new Map<string, ReportPlan[]>();
const identityByTicker = new Map<string, ResearchDNA[]>();

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function saveReportPlan(plan: ReportPlan): ReportPlan {
  const key = normalizeTicker(plan.ticker);
  const existing = planByTicker.get(key) ?? [];
  const withoutDuplicate = existing.filter((entry) => entry.planHash !== plan.planHash);
  withoutDuplicate.push(plan);
  while (withoutDuplicate.length > REPORT_PLAN_STORE_BOUND) withoutDuplicate.shift();
  planByTicker.set(key, withoutDuplicate);
  return plan;
}

export function loadReportPlans(ticker: string): ReportPlan[] {
  return [...(planByTicker.get(normalizeTicker(ticker)) ?? [])];
}

export function loadLatestReportPlan(ticker: string): ReportPlan | null {
  const entries = planByTicker.get(normalizeTicker(ticker)) ?? [];
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

export function clearReportPlans(ticker?: string): void {
  if (ticker) planByTicker.delete(normalizeTicker(ticker));
  else planByTicker.clear();
}

export function saveResearchIdentity(identity: ResearchDNA): ResearchDNA {
  const key = normalizeTicker(identity.ticker);
  const existing = identityByTicker.get(key) ?? [];
  const withoutDuplicate = existing.filter((entry) => entry.identityId !== identity.identityId);
  withoutDuplicate.push(identity);
  while (withoutDuplicate.length > REPORT_IDENTITY_STORE_BOUND) withoutDuplicate.shift();
  identityByTicker.set(key, withoutDuplicate);
  return identity;
}

export function loadPriorIdentities(ticker: string, excludeIdentityId?: string): ResearchDNA[] {
  const entries = identityByTicker.get(normalizeTicker(ticker)) ?? [];
  if (!excludeIdentityId) return [...entries];
  return entries.filter((entry) => entry.identityId !== excludeIdentityId);
}

export function clearResearchIdentities(ticker?: string): void {
  if (ticker) identityByTicker.delete(normalizeTicker(ticker));
  else identityByTicker.clear();
}

export function boundSizes(): { plans: number; identities: number } {
  let plans = 0;
  for (const entries of planByTicker.values()) plans += entries.length;
  let identities = 0;
  for (const entries of identityByTicker.values()) identities += entries.length;
  return { plans, identities };
}
