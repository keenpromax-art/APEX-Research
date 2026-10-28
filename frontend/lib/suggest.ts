// ---------------------------------------------------------------------------
// AI suggestion of modelling inputs ("AI fill").
//
// Calls a configured OpenAI-compatible chat-completions endpoint and coerces
// the reply into bounded numeric inputs for one of the deterministic
// calculators. Every field the model returns is clamped to a hard per-field
// bound before it reaches the form, so a runaway value can never break the
// downstream engine. Failures return a structured error rather than null so the
// UI can tell the analyst exactly what went wrong.
// ---------------------------------------------------------------------------

import { SUGGEST_SYSTEM_PROMPT, buildSuggestUserPrompt, type SuggestFieldSpec } from "./prompts";

export type SuggestTab = "LBO" | "Options" | "Bond" | "WACC";

export type SuggestProvider = {
  name: string;
  base_url?: string | null;
  api_key?: string | null;
  model_id?: string | null;
};

export type SuggestContext = {
  ticker?: string;
  company?: Record<string, unknown> | null;
  current: Record<string, string>;
};

export type SuggestResult =
  | { ok: true; values: Record<string, string | number>; reasoning: string }
  | { ok: false; error: string };

/** Per-field hard bounds. A returned value outside its bounds is clamped. */
export const SUGGEST_FIELDS: Record<SuggestTab, SuggestFieldSpec[]> = {
  LBO: [
    { name: "entry_ebitda", bounds: [1, 1e9], note: "entry EBITDA, same units as reported EBITDA" },
    { name: "entry_multiple", bounds: [1, 30], note: "EV/EBITDA paid at entry" },
    { name: "exit_multiple", bounds: [1, 30], note: "EV/EBITDA at exit" },
    { name: "hold_years", bounds: [1, 15], note: "integer years" },
    { name: "revenue_growth", bounds: [-0.5, 1], note: "annual EBITDA growth rate, decimal" },
    { name: "tax_rate", bounds: [0, 0.6], note: "decimal" },
    { name: "interest_rate", bounds: [0, 0.5], note: "annual rate on debt, decimal" },
    { name: "debt_paydown_pct", bounds: [0, 1], note: "share of post-interest cash swept to debt, decimal" },
    { name: "fees_pct", bounds: [0, 0.1], note: "transaction fees as share of purchase price, decimal" },
  ],
  Options: [
    { name: "S", bounds: [0.01, 1e6], note: "spot price" },
    { name: "K", bounds: [0.01, 1e6], note: "strike price" },
    { name: "T", bounds: [0.01, 30], note: "years to expiry" },
    { name: "r", bounds: [0, 0.5], note: "risk-free rate, decimal" },
    { name: "sigma", bounds: [0.001, 5], note: "annualised volatility, decimal (0.2 = 20%)" },
    { name: "q", bounds: [0, 0.5], note: "continuous dividend yield, decimal" },
  ],
  Bond: [
    { name: "face", bounds: [1, 1e7], note: "face value" },
    { name: "coupon_rate", bounds: [0, 0.5], note: "annual coupon, decimal" },
    { name: "ytm", bounds: [0, 0.5], note: "yield to maturity, decimal" },
    { name: "years", bounds: [0.1, 50], note: "years to maturity" },
    { name: "freq", bounds: [1, 12], note: "coupons per year, integer (2 = semiannual)" },
  ],
  WACC: [
    { name: "risk_free", bounds: [0, 0.2], note: "decimal" },
    { name: "beta", bounds: [-2, 5], note: "levered beta" },
    { name: "market_premium", bounds: [0, 0.2], note: "equity risk premium, decimal" },
    { name: "cost_of_debt", bounds: [0, 0.5], note: "pre-tax cost of debt, decimal" },
    { name: "tax_rate", bounds: [0, 0.6], note: "decimal" },
    { name: "equity_weight", bounds: [0, 1], note: "decimal" },
    { name: "debt_weight", bounds: [0, 1], note: "decimal; should pair with equity_weight to sum to 1" },
  ],
};

/** Fields that must come back as whole numbers. */
const INTEGER_FIELDS = new Set(["hold_years", "freq"]);
/** Price-like fields keep cents. */
const PRICE_FIELDS = new Set(["S", "K", "face"]);

function roundForField(name: string, value: number): number {
  if (INTEGER_FIELDS.has(name)) return Math.round(value);
  if (PRICE_FIELDS.has(name)) return Math.round(value * 100) / 100;
  return Math.round(value * 10000) / 10000;
}

/**
 * Clamp and round a raw model reply into safe, well-formed form values.
 * Exported for testing. Returns the accepted values plus a count of how many
 * fields were usable, so a caller can reject an entirely-empty reply.
 */
export function coerceSuggestValues(
  tab: SuggestTab,
  parsed: Record<string, unknown>,
): { values: Record<string, string | number>; accepted: number } {
  const values: Record<string, string | number> = {};
  let accepted = 0;

  for (const spec of SUGGEST_FIELDS[tab]) {
    const rawValue = parsed[spec.name];
    if (rawValue === null || rawValue === undefined) continue;
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) continue;
    const clamped = Math.min(Math.max(numeric, spec.bounds[0]), spec.bounds[1]);
    values[spec.name] = roundForField(spec.name, clamped);
    accepted += 1;
  }

  if (tab === "Options") {
    const kind = String(parsed.option_type ?? "").toLowerCase();
    values.option_type = kind === "put" ? "put" : "call";
    accepted += 1;
  }

  // Keep the WACC weights a true partition of the capital structure.
  if (tab === "WACC") {
    const equity = Number(values.equity_weight);
    const debt = Number(values.debt_weight);
    if (Number.isFinite(equity) && Number.isFinite(debt)) {
      const total = equity + debt;
      if (total > 0 && Math.abs(total - 1) > 0.01) {
        values.equity_weight = roundForField("equity_weight", equity / total);
        values.debt_weight = roundForField("debt_weight", debt / total);
      }
    }
  }

  return { values, accepted };
}

/**
 * Ask the configured provider for a set of bounded inputs for one tab.
 * Mirrors the request shape used by tryProviderNarrative in narrative.ts.
 */
export async function suggestModelInputs(
  provider: SuggestProvider,
  tab: SuggestTab,
  context: SuggestContext,
  timeoutMs = 30000,
): Promise<SuggestResult> {
  if (!provider.api_key) return { ok: false, error: "The selected AI model has no API key configured." };
  const baseUrl = String(provider.base_url || "").replace(/\/$/, "");
  if (!baseUrl) return { ok: false, error: "The selected AI model has no base URL configured." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.api_key}`,
      },
      body: JSON.stringify({
        model: provider.model_id || undefined,
        messages: [
          { role: "system", content: SUGGEST_SYSTEM_PROMPT },
          { role: "user", content: buildSuggestUserPrompt(tab, SUGGEST_FIELDS[tab], context) },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: `Provider returned HTTP ${response.status}.` };

    const body = (await response.json()) as any;
    const raw = body?.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "The model returned an empty response." };

    const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return { ok: false, error: "The model returned malformed JSON." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "The model response was not a JSON object." };
    }

    const record = parsed as Record<string, unknown>;
    const { values, accepted } = coerceSuggestValues(tab, record);
    if (accepted === 0) return { ok: false, error: "The model returned no usable numeric fields." };

    const reasoning = typeof record.reasoning === "string" && record.reasoning.trim() ? record.reasoning.trim() : "";
    return { ok: true, values, reasoning };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "The AI request timed out." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "The AI request failed." };
  } finally {
    clearTimeout(timer);
  }
}
