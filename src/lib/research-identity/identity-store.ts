import type { ResearchDNA } from "./types";

export const IDENTITY_PERSISTENCE_BOUND = 20;

const storedByTicker = new Map<string, ResearchDNA[]>();

function keyFor(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function persistResearchIdentity(identity: ResearchDNA): ResearchDNA {
  const key = keyFor(identity.ticker);
  const existing = storedByTicker.get(key) ?? [];
  const filtered = existing.filter((entry) => entry.identityId !== identity.identityId);
  filtered.push(identity);
  while (filtered.length > IDENTITY_PERSISTENCE_BOUND) filtered.shift();
  storedByTicker.set(key, filtered);
  return identity;
}

export function loadStoredIdentities(ticker: string): ResearchDNA[] {
  return [...(storedByTicker.get(keyFor(ticker)) ?? [])];
}

export function loadBoundedPriors(ticker: string, excludeId?: string, bound: number = IDENTITY_PERSISTENCE_BOUND): ResearchDNA[] {
  const entries = storedByTicker.get(keyFor(ticker)) ?? [];
  const filtered = excludeId ? entries.filter((entry) => entry.identityId !== excludeId) : entries;
  return filtered.slice(-bound);
}

export function clearStoredIdentities(ticker?: string): void {
  if (ticker) storedByTicker.delete(keyFor(ticker));
  else storedByTicker.clear();
}

export function storedIdentityCount(): number {
  let total = 0;
  for (const entries of storedByTicker.values()) total += entries.length;
  return total;
}
