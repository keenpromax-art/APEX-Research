import { validateTicker } from "@/lib/security/request-policy";

export const WATCHLIST_VERSION = "apex-watchlist-v1" as const;

export interface WatchlistEntry {
  ticker: string;
  addedAt: string;
  lastReportId?: string;
  lastFairValue?: number;
  lastPrice?: number;
  note?: string;
}

export interface WatchlistState {
  version: typeof WATCHLIST_VERSION;
  entries: WatchlistEntry[];
}

export function createWatchlist(): WatchlistState {
  return { version: WATCHLIST_VERSION, entries: [] };
}

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Watchlist timestamps must be valid ISO dates");
  return new Date(parsed).toISOString();
}

function normalizeTicker(value: unknown): string {
  const result = validateTicker(value);
  if (!result.ok) throw new TypeError(result.error.message);
  return result.value;
}

function dedupe(entries: WatchlistEntry[]): WatchlistEntry[] {
  const byTicker = new Map<string, WatchlistEntry>();
  for (const entry of entries) byTicker.set(entry.ticker, entry);
  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function addWatchlistEntry(state: WatchlistState, input: { ticker: string; addedAt: string; lastReportId?: string; lastFairValue?: number; lastPrice?: number; note?: string }): WatchlistState {
  const entry: WatchlistEntry = {
    ticker: normalizeTicker(input.ticker),
    addedAt: timestamp(input.addedAt),
    ...(input.lastReportId === undefined ? {} : { lastReportId: input.lastReportId }),
    ...(Number.isFinite(input.lastFairValue) ? { lastFairValue: input.lastFairValue } : {}),
    ...(Number.isFinite(input.lastPrice) ? { lastPrice: input.lastPrice } : {}),
    ...(input.note === undefined ? {} : { note: input.note.slice(0, 500) }),
  };
  return { version: WATCHLIST_VERSION, entries: dedupe([...state.entries.filter((item) => item.ticker !== entry.ticker), entry]) };
}

export function removeWatchlistEntry(state: WatchlistState, ticker: string): WatchlistState {
  const normalized = normalizeTicker(ticker);
  return { version: WATCHLIST_VERSION, entries: state.entries.filter((entry) => entry.ticker !== normalized) };
}

export function updateWatchlistEntry(state: WatchlistState, ticker: string, patch: Partial<Omit<WatchlistEntry, "ticker" | "addedAt">>): WatchlistState {
  const normalized = normalizeTicker(ticker);
  return {
    version: WATCHLIST_VERSION,
    entries: state.entries.map((entry) => entry.ticker === normalized ? { ...entry, ...patch } : entry),
  };
}

export function parseWatchlist(raw: string | null | undefined): WatchlistState {
  if (!raw) return createWatchlist();
  try {
    const parsed = JSON.parse(raw) as Partial<WatchlistState>;
    if (parsed?.version !== WATCHLIST_VERSION || !Array.isArray(parsed.entries)) return createWatchlist();
    const entries: WatchlistEntry[] = [];
    for (const item of parsed.entries) {
      if (!item || typeof item !== "object") continue;
      const ticker = normalizeTicker((item as WatchlistEntry).ticker);
      entries.push({ ...(item as WatchlistEntry), ticker, addedAt: timestamp((item as WatchlistEntry).addedAt) });
    }
    return { version: WATCHLIST_VERSION, entries: dedupe(entries) };
  } catch {
    return createWatchlist();
  }
}
