import { addWatchlistEntry, createWatchlist, parseWatchlist, removeWatchlistEntry, updateWatchlistEntry, type WatchlistState } from "./index";

export const WATCHLIST_STORAGE_KEY = "apex_watchlist_v1";

export function loadWatchlist(storageKey = WATCHLIST_STORAGE_KEY): WatchlistState {
  if (typeof window === "undefined" || !window.localStorage) return createWatchlist();
  try {
    return parseWatchlist(window.localStorage.getItem(storageKey));
  } catch {
    return createWatchlist();
  }
}

export function saveWatchlist(state: WatchlistState, storageKey = WATCHLIST_STORAGE_KEY): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    return;
  }
}

export { addWatchlistEntry, removeWatchlistEntry, updateWatchlistEntry };
