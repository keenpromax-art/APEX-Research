import { addWatchlistEntry, createWatchlist, parseWatchlist, removeWatchlistEntry, updateWatchlistEntry } from "../src/lib/watchlist";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`PASS ${name}`); } else { failed++; console.error(`FAIL ${name}`); }
}

const now = "2026-09-25T00:00:00.000Z";
let state = createWatchlist();
state = addWatchlistEntry(state, { ticker: "reliance.ns", addedAt: now, lastFairValue: 1000, lastPrice: 900 });
check("normalizes and stores ticker", state.entries.length === 1 && state.entries[0].ticker === "RELIANCE.NS");
state = addWatchlistEntry(state, { ticker: "RELIANCE.NS", addedAt: now, lastFairValue: 1100 });
check("updates existing ticker", state.entries.length === 1 && state.entries[0].lastFairValue === 1100);
state = updateWatchlistEntry(state, "reliance.ns", { note: "core" });
check("updates metadata", state.entries[0].note === "core");
state = removeWatchlistEntry(state, "RELIANCE.NS");
check("removes ticker", state.entries.length === 0);
check("malformed storage falls back", parseWatchlist("{bad").entries.length === 0);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
