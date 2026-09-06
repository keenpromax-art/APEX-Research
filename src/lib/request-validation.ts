/**
 * Validation for values that are interpolated into upstream market-data URLs.
 * Yahoo symbols legitimately include values such as ^GSPC, BRK-B and 0700.HK.
 */
const TICKER_PATTERN = /^[A-Z0-9^.=\-]{1,32}$/;

export function normalizeTicker(input: string | null): string | null {
  if (typeof input !== "string") return null;
  const ticker = input.trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

export function normalizeSearchQuery(input: string | null): string | null {
  if (typeof input !== "string") return null;
  const query = input.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!query || query.length > 80) return null;
  return query;
}
