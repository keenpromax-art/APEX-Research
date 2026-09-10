/**
 * APEX RESEARCH — 50-Agent Report Team (mini-agent runtime).
 *
 * Whole-report authorship by AI, numbers strictly ours: every agent reads from
 * ONE yfinance-grounded fact ledger (buildFactLedger) and every figure an
 * author writes must cite a fact ID ([F-...]) or the citation gate cuts it.
 *
 * Team shape (50 roles):
 *   10 harvesters — normalize yfinance output into ledger sections (deterministic)
 *   10 quants     — math on the ledger via existing engines (deterministic)
 *   14 authors    — LLM prose, one voice per section (the writers)
 *   10 checkers   — LLM-lite citation auditors, each paired to help specific
 *                   authors work better (checker.helps = author role id)
 *    4 designers  — chart/table data specs for the PDF (deterministic)
 *    2 orchestrators — planner (flagship) + gatekeeper (publish/block)
 *
 * Cost discipline: only authors/checkers/orchestrators spend LLM calls
 * (26 max, checkers on the lite tier); harvesters/quants/designers are pure
 * functions. The default report pipeline is untouched — runAgentTeam is
 * opt-in so nothing fires (or bills) unless the caller asks.
 */
import type { AnnualFinancials, CompanyProfile, DCFResult, StockData } from "@/types/report";

// ─────────────────────────────────────────────
// Roster
// ─────────────────────────────────────────────

export type AgentFamily = "harvest" | "quant" | "author" | "checker" | "design" | "orchestrate";
export type ModelTier = "lite" | "standard" | "flagship";

export interface TeamRole {
  id: string;
  family: AgentFamily;
  name: string;
  /** One-line job contract: what it consumes, what it delivers. */
  job: string;
  tier: ModelTier;
  /** For checkers: the author role id(s) this mini-agent helps. */
  helps?: string[];
  /** True when the role needs an LLM call (authors/checkers/orchestrators). */
  needsLlm: boolean;
}

const H = (id: string, name: string, job: string): TeamRole => ({ id, family: "harvest", name, job, tier: "lite", needsLlm: false });
const Q = (id: string, name: string, job: string): TeamRole => ({ id, family: "quant", name, job, tier: "lite", needsLlm: false });
const A = (id: string, name: string, job: string): TeamRole => ({ id, family: "author", name, job, tier: "standard", needsLlm: true });
const C = (id: string, name: string, helps: string[], job: string): TeamRole => ({ id, family: "checker", name, job, tier: "lite", needsLlm: true, helps });
const D = (id: string, name: string, job: string): TeamRole => ({ id, family: "design", name, job, tier: "lite", needsLlm: false });
const O = (id: string, name: string, job: string): TeamRole => ({ id, family: "orchestrate", name, job, tier: "flagship", needsLlm: true });

export const AGENT_TEAM_ROSTER: TeamRole[] = [
  // — Harvesters: yfinance → ledger sections (each owns its slice) —
  H("h-profile", "Identity Harvester", "Company identity, sector, industry, listing facts → ledger identity section."),
  H("h-market", "Market Harvester", "Price, market cap, beta, 52w range, shares → ledger market section."),
  H("h-income", "Income Harvester", "Revenue/EBIT/EBITDA/NI series per year → ledger income section."),
  H("h-balance", "Balance Harvester", "Debt splits, leases, cash, equity series → ledger balance section."),
  H("h-cashflow", "Cashflow Harvester", "CFO/capex/FCF/dividends series → ledger cashflow section."),
  H("h-dcf", "Valuation Harvester", "DCF outputs (FV, EV, net debt, projections) → ledger valuation section."),
  H("h-scenarios", "Scenario Harvester", "Bull/base/bear targets + weights → ledger scenarios section."),
  H("h-moat", "Moat Harvester", "Canonical moat rating, trend, pillars → ledger moat section."),
  H("h-peers", "Peer Harvester", "Curated peer set + medians (or insufficiency flag) → ledger peers section."),
  H("h-news", "News Harvester", "Verified news items + dates → ledger news section (no sentiment invention)."),
  // — Quants: math on the ledger (delegate to existing engines) —
  Q("q-growth", "Growth Quant", "Hist CAGR, YoY deltas, forecast fade → growth table for authors."),
  Q("q-margins", "Margin Quant", "Gross/EBIT/EBITDA/net margin walk + common-size → margin table."),
  Q("q-fcf", "FCF Quant", "NOPAT+D&A−capex−ΔNWC bridge per forecast year → FCF table."),
  Q("q-credit", "Credit Quant", "NetDebt/EBITDA, coverage, lease-inclusive debt bridge → credit table."),
  Q("q-returns", "Returns Quant", "ROIC/ROE/DuPont decomposition → returns table."),
  Q("q-comps", "Comps Quant", "Peer multiples + medians (N/M when peers absent) → comps table."),
  Q("q-sensitivity", "Sensitivity Quant", "WACC×g grid + scenario deltas → sensitivity table."),
  Q("q-dividend", "Payout Quant", "DPS, payout, buybacks, FCF coverage → payout table."),
  Q("q-nwc", "NWC Quant", "DSO/DIO/DPO/CCC + NWC walk → working-capital table."),
  Q("q-valuation", "Valuation Quant", "P/FV, upside, star band, reverse-DCF implied growth → valuation table."),
  // — Authors: LLM prose, one voice per section —
  A("a-thesis", "Thesis Author", "Cover investment thesis (3 sentences, every figure cited)."),
  A("a-business", "Business Author", "What the company does + segment mix in plain words."),
  A("a-moat", "Moat Author", "Moat verdict + pillar narratives within the canonical rating ceiling."),
  A("a-bulls", "Bulls Author", "Bull case: upside drivers, each tied to a cited fact."),
  A("a-bears", "Bears Author", "Bear case: risks with cited magnitudes, no vague dread."),
  A("a-risks", "Risks Author", "Risk register with impact + mitigation per risk."),
  A("a-income", "Income Author", "Revenue/EBIT/NI walk note under the income table."),
  A("a-balance", "Balance Author", "Debt/lease/equity note under the balance table."),
  A("a-cashflow", "Cashflow Author", "FCF vs narrative honesty note (burn flagged, never hidden)."),
  A("a-valuation", "Valuation Author", "DCF bridge story: growth→margins→capex→FCFF→TV→EV→FV."),
  A("a-scenarios", "Scenarios Author", "Bull/base/bear operating stories behind the matrix."),
  A("a-peers", "Peers Author", "Relative verdict (or insufficiency honesty when peers absent)."),
  A("a-outlook", "Outlook Author", "12-month watchlist: catalysts that would change the rating."),
  A("a-catalysts", "Catalysts Author", "Near-term catalyst calendar with cited evidence."),
  // — Checkers: mini-agents that help authors work better (citation audits) —
  C("c-thesis", "Thesis Checker", ["a-thesis"], "Every thesis figure traces to a fact ID; cut or flag the rest."),
  C("c-moat", "Moat Checker", ["a-moat"], "No pillar outranks the canonical composite; rating words match ledger."),
  C("c-numbers", "Numbers Checker", ["a-income", "a-balance", "a-cashflow"], "Statement-note figures equal ledger values within tolerance."),
  C("c-valuation", "Valuation Checker", ["a-valuation", "a-scenarios"], "FV/EV/Upside arithmetic re-solved from ledger; no invented multiples."),
  C("c-bulls", "Bulls Checker", ["a-bulls", "a-catalysts", "a-outlook"], "Upside claims cite facts; forward-looking lines labeled as views."),
  C("c-bears", "Bears Checker", ["a-bears", "a-risks"], "Risk magnitudes cited; no new risks invented beyond ledger+news."),
  C("c-business", "Business Checker", ["a-business"], "Segment/product claims stay inside profile+description vocabulary."),
  C("c-peers", "Peers Checker", ["a-peers"], "Peer names/numbers match ledger set; insufficiency never papered over."),
  C("c-style", "Style Checker", ["a-thesis", "a-business", "a-moat", "a-bulls", "a-bears", "a-risks", "a-income", "a-balance", "a-cashflow", "a-valuation", "a-scenarios", "a-peers", "a-outlook", "a-catalysts"], "One editorial voice: tense, units (Cr), no purple prose, no repeated claims across sections."),
  C("c-compliance", "Compliance Checker", ["a-thesis", "a-valuation", "a-outlook"], "No guaranteed returns, no advice language, uncertainty labeled; SEBI-safe."),
  // — Designers: chart/table specs for the PDF (deterministic) —
  D("d-pricechart", "Price/Fair Designer", "Price-vs-fair trajectory points + axis ticks spec."),
  D("d-bridge", "Bridge Designer", "FCFF→TV→EV→equity waterfall rows spec."),
  D("d-margins", "Margin Designer", "Margin-walk series (gross/EBIT/net/FCF conv.) spec."),
  D("d-cover", "Cover Designer", "Hero numbers + KPI strip selection spec."),
  // — Orchestrators —
  O("o-planner", "Team Planner", "Reads ledger, assigns authors/checkers, sets per-section figure budgets."),
  O("o-gatekeeper", "Team Gatekeeper", "Final publish/block: all checker flags clear + citation coverage ≥ bar."),
];

export function rosterByFamily(family: AgentFamily): TeamRole[] {
  return AGENT_TEAM_ROSTER.filter((r) => r.family === family);
}

export function llmRoles(): TeamRole[] {
  return AGENT_TEAM_ROSTER.filter((r) => r.needsLlm);
}

// ─────────────────────────────────────────────
// Fact ledger — the ONLY numbers agents may use
// ─────────────────────────────────────────────

export interface FactEntry {
  id: string;
  label: string;
  value: number | string;
  source: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function buildFactLedger(input: {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  dcf: DCFResult;
  moatRating?: string;
  peers?: Array<{ ticker: string }>;
}): FactEntry[] {
  const { profile, stockData, annualFinancials, dcf } = input;
  const sd = stockData as unknown as Record<string, unknown>;
  const dr = dcf as unknown as Record<string, unknown>;
  const out: FactEntry[] = [];
  const push = (id: string, label: string, value: number | string, source: string) => {
    out.push({ id, label, value, source });
  };
  // Identity + market (h-profile, h-market)
  push("F-NAME", "Company name", String(profile.name || profile.ticker), "yfinance:profile");
  push("F-TICKER", "Ticker", String(profile.ticker), "yfinance:profile");
  push("F-SECTOR", "Sector · industry", `${profile.sector || "n/a"} · ${profile.industry || "n/a"}`, "yfinance:profile");
  const px = num(sd.currentPrice);
  if (px !== null) push("F-PRICE", "Current market price", px, "yfinance:quote");
  const mc = num(sd.marketCap);
  if (mc !== null && mc > 0) push("F-MCAP", "Market capitalization", mc, "yfinance:quote|derived:px*shares");
  const sh = num(sd.sharesOutstanding);
  if (sh !== null && sh > 0) push("F-SHARES", "Shares outstanding", sh, "yfinance:keyStats|statements");
  // Yearly statements, last 4 (h-income, h-balance, h-cashflow)
  const yrs = annualFinancials.slice(-4);
  for (const f of yrs) {
    const fr = f as unknown as Record<string, unknown>;
    const y = String(f.year).replace(/[^0-9]/g, "").slice(-2) || String(f.year);
    const cell = (suffix: string, label: string, v: unknown) => {
      const n = num(v);
      if (n !== null) push(`F-${suffix}-FY${y}`, `${label} FY${y}`, n, "yfinance:statements");
    };
    cell("REV", "Revenue", fr.revenue);
    cell("EBIT", "EBIT", fr.ebit ?? fr.operatingIncome);
    cell("EBITDA", "EBITDA", fr.ebitda);
    cell("NI", "Net income", fr.netIncome);
    cell("DEBT", "Total debt", fr.totalDebt);
    cell("LEASES", "Finance leases", fr.capitalLeaseObligations);
    cell("CASH", "Cash", fr.cash);
    cell("OCF", "Operating cash flow", fr.operatingCashFlow);
    cell("CAPEX", "Capital expenditure", fr.capitalExpenditures);
    cell("FCF", "Free cash flow", fr.freeCashFlow);
  }
  // Valuation (h-dcf, h-scenarios, h-moat, h-peers)
  const dv = (id: string, label: string, v: unknown, src: string) => {
    const n = num(v);
    if (n !== null) push(id, label, n, src);
  };
  dv("F-FV", "DCF fair value per share", dr.intrinsicValue, "model:dcf");
  dv("F-EV", "Enterprise value", dr.enterpriseValue, "model:dcf");
  dv("F-NETDEBT", "Net debt (lease-inclusive)", dr.netDebt, "model:dcf");
  const dassump = (dcf.assumptions ?? {}) as unknown as Record<string, unknown>;
  dv("F-WACC", "WACC", dassump.wacc, "model:dcf");
  dv("F-TG", "Terminal growth", dassump.terminalGrowthRate, "model:dcf");
  const projs = (dcf as unknown as { projections?: Array<Record<string, unknown>> }).projections || [];
  projs.forEach((p, i) => {
    dv(`F-G${i + 1}`, `Forecast revenue growth yr${i + 1}`, p.revenueGrowth, "model:drivers");
    dv(`F-M${i + 1}`, `Forecast EBIT margin yr${i + 1}`, p.ebitMargin, "model:drivers");
    dv(`F-FCFF${i + 1}`, `Forecast FCFF yr${i + 1}`, p.fcff, "model:drivers");
  });
  if (input.moatRating) push("F-MOAT", "Canonical moat rating", String(input.moatRating), "model:moat");
  const verdict = dr.verdict;
  if (typeof verdict === "string") push("F-VERDICT", "Model verdict", verdict, "model:dcf");
  if (input.peers && input.peers.length > 0) {
    push("F-PEERS", "Peer count", input.peers.length, "model:peers");
  } else {
    push("F-PEERS", "Peer coverage", "INSUFFICIENT", "model:peers");
  }
  return out;
}

/** Render ledger as prompt context with the citation contract. */
export function renderFactLedger(ledger: FactEntry[]): string {
  const lines = ledger.map((f) => `- [${f.id}] ${f.label}: ${typeof f.value === "number" ? fmtLedgerNum(f.value) : f.value}`);
  return [
    "CANONICAL FACT LEDGER (yfinance-grounded; the ONLY numbers you may use):",
    ...lines,
    "",
    "CITATION CONTRACT: every figure you write MUST append its fact ID in brackets, e.g. Rs.1,275.00 [F-PRICE].",
    "A figure without a fact ID will be cut by your checker. Never invent, round beyond the ledger, or carry peer numbers from memory.",
  ].join("\n");
}

function fmtLedgerNum(v: number): string {
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e7) return `${(v / 1e7).toFixed(1)} Cr`;
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(1)} L`;
  if (Number.isInteger(v)) return v.toLocaleString("en-IN");
  if (Math.abs(v) < 1 && Math.abs(v) > 0) return `${(v * 100).toFixed(1)}%`;
  return String(Math.round(v * 100) / 100);
}

// ─────────────────────────────────────────────
// Citation audit — deterministic checker core
// ─────────────────────────────────────────────

export interface CitationFinding {
  cited: string[];
  uncitedNumbers: string[];
  mismatched: Array<{ text: string; value: number; nearestId: string; nearestValue: number; relGap: number }>;
}

/**
 * Audit prose: (1) collect [F-...] citations, (2) extract bare numbers and
 * require each material one to either carry a citation nearby or match a
 * ledger value within tolerance, (3) verify cited values match the ledger.
 * Years (1990–2100), tiny bare ints, and star counts are skipped by design.
 */
export function auditCitations(prose: string, ledger: FactEntry[], tol = 0.03): CitationFinding {
  const byId = new Map(ledger.map((f) => [f.id, f]));
  const cited = [...prose.matchAll(/\[([A-Z0-9-]+)\]/g)].map((m) => m[1]).filter((id) => byId.has(id));
  const uncitedNumbers: string[] = [];
  const mismatched: CitationFinding["mismatched"] = [];
  // Cited-value verification: number immediately before [F-ID] must match ledger.
  for (const m of prose.matchAll(/([\d,]+(?:\.\d+)?)\s*(T|Cr|L|B|M|K|%|x)?\s*\[([A-Z0-9-]+)\]/g)) {
    const entry = byId.get(m[3]);
    if (!entry || typeof entry.value !== "number") continue;
    const raw = parseFloat(m[1].replace(/,/g, ""));
    const unit = (m[2] || "").toLowerCase();
    let scaled = raw;
    if (unit === "%" || unit === "x") {
      // Ledger stores rates as decimals only when |v|<1; compare both forms.
      const cands = [entry.value, entry.value * 100];
      const ok = cands.some((c) => Math.abs(c - raw) / Math.max(1e-9, Math.abs(c)) <= tol + (unit === "x" ? 0.05 : 0));
      if (!ok) mismatched.push({ text: m[0].slice(0, 60), value: raw, nearestId: entry.id, nearestValue: entry.value, relGap: Math.abs(entry.value - raw) / Math.max(1e-9, Math.abs(entry.value)) });
      continue;
    }
    const scale = unit === "t" ? 1e12 : unit === "cr" ? 1e7 : unit === "l" ? 1e5 : unit === "b" ? 1e9 : unit === "m" ? 1e6 : unit === "k" ? 1e3 : 1;
    scaled = raw * scale;
    // Compare against ledger value allowing ledger-side unit labels (Cr/T).
    const ledgerScaled = entry.value;
    const gap = Math.abs(ledgerScaled - scaled) / Math.max(1e-9, Math.abs(ledgerScaled));
    // Also accept raw equality when prose mirrors ledger formatting (e.g. "17.25T" vs 1.7e13 fails; handled by scale above).
    if (gap > tol && Math.abs(ledgerScaled - raw) / Math.max(1e-9, Math.abs(ledgerScaled)) > tol) {
      mismatched.push({ text: m[0].slice(0, 60), value: scaled, nearestId: entry.id, nearestValue: entry.value, relGap: gap });
    }
  }
  // Bare-number sweep: material numbers lacking their OWN citation. A citation
  // belongs to a figure only in the standard number-then-cite form (`Rs.X [F-ID]`
  // within 30 chars after the number's end) — a wide ±window leaks one figure's
  // citation onto its uncited neighbor and hides invented numbers.
  const citedSpans: Array<[number, number]> = [...prose.matchAll(/\[[A-Z0-9-]+\]/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  for (const m of prose.matchAll(/(Rs\.?\s*|\$)?([\d,]+(?:\.\d+)?)\s*(T|Cr|Lakh|B|M|K|%|x)?/g)) {
    const raw = m[2].replace(/,/g, "");
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) continue;
    const unit = m[3] || "";
    const hasCurr = !!m[1];
    // Skip years, tiny bare ints, and ordinals without units/currency.
    if (!hasCurr && !unit) {
      if (num >= 1900 && num <= 2100) continue;
      if (num < 100) continue;
    }
    if (num >= 1900 && num <= 2100 && !hasCurr) continue; // calendar years
    const pos = m.index ?? 0;
    const mEnd = pos + m[0].length;
    const nearCite = citedSpans.some(([a, b]) => (a >= mEnd && a - mEnd < 30) || (b <= pos && pos - b < 8));
    if (nearCite) continue;
    // Matchable to ledger? If yes within tol → tolerated but flagged; else uncited.
    const scale = /t/i.test(unit) ? 1e12 : /cr/i.test(unit) ? 1e7 : /lakh/i.test(unit) ? 1e5 : /b/i.test(unit) ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1;
    const scaled = unit === "%" ? num : num * scale;
    let matched = false;
    for (const f of ledger) {
      if (typeof f.value !== "number") continue;
      const cands = unit === "%" ? [f.value, f.value * 100] : [f.value];
      if (cands.some((c) => Math.abs(c - scaled) / Math.max(1e-9, Math.abs(c)) <= tol)) { matched = true; break; }
    }
    if (!matched) uncitedNumbers.push(m[0].slice(0, 40));
  }
  return { cited: [...new Set(cited)], uncitedNumbers: [...new Set(uncitedNumbers)].slice(0, 20), mismatched: mismatched.slice(0, 20) };
}

// ─────────────────────────────────────────────
// Runner — bounded parallel fan-out (transport-injected)
// ─────────────────────────────────────────────

export interface TeamTransport {
  complete(prompt: { system: string; user: string }, opts?: { tier: ModelTier; roleId: string }): Promise<string>;
}

export interface TeamRunResult {
  prose: Record<string, string>;
  audits: Record<string, CitationFinding>;
  blocked: string[];
  publishable: boolean;
}

export function buildAuthorPrompt(role: TeamRole, ledgerText: string, companyName: string): { system: string; user: string } {
  return {
    system: `You are the ${role.name} on an institutional equity research desk. ${role.job} Write tight, editorial, numbers-first prose. OBEY THE CITATION CONTRACT — uncited figures are cut.`,
    user: `Company: ${companyName}\n\n${ledgerText}\n\nWrite your section now. Every figure carries its [F-ID].`,
  };
}

export function buildCheckerPrompt(role: TeamRole, authorProse: string, ledgerText: string): { system: string; user: string } {
  return {
    system: `You are the ${role.name}. ${role.job} You help ${role.helps?.join(", ") || "authors"} work better: verify, never rewrite from scratch. Reply with: KEEP lines (verified) and CUT/FLAG lines with reasons.`,
    user: `Fact ledger:\n${ledgerText}\n\nAuthor prose to audit:\n${authorProse}`,
  };
}

/** Run author roles in parallel (bounded), then their checkers. Pure orchestration — no LLM vendor lock-in. */
export async function runAgentTeam(params: {
  roles: TeamRole[];
  ledger: FactEntry[];
  companyName: string;
  transport: TeamTransport;
  concurrency?: number;
}): Promise<TeamRunResult> {
  const { roles, ledger, companyName, transport } = params;
  const concurrency = Math.max(1, params.concurrency ?? 5);
  const ledgerText = renderFactLedger(ledger);
  const prose: Record<string, string> = {};
  const authors = roles.filter((r) => r.family === "author");
  const checkers = roles.filter((r) => r.family === "checker");
  // Bounded fan-out for authors.
  for (let i = 0; i < authors.length; i += concurrency) {
    const batch = authors.slice(i, i + concurrency);
    const outs = await Promise.all(
      batch.map((r) => transport.complete(buildAuthorPrompt(r, ledgerText, companyName), { tier: r.tier, roleId: r.id }).catch(() => ""))
    );
    batch.forEach((r, k) => { prose[r.id] = outs[k]; });
  }
  // Checkers audit only non-empty prose from authors they help.
  const audits: Record<string, CitationFinding> = {};
  const checkerTargets = checkers.flatMap((c) => (c.helps || []).map((a) => ({ checker: c, author: a })));
  for (let i = 0; i < checkerTargets.length; i += concurrency) {
    const batch = checkerTargets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ checker, author }) => {
        const text = prose[author] || "";
        if (!text) return;
        const key = `${checker.id}→${author}`;
        if (audits[key]) return;
        const deterministic = auditCitations(text, ledger);
        let llmNote = "";
        try {
          llmNote = await transport.complete(buildCheckerPrompt(checker, text, ledgerText), { tier: checker.tier, roleId: checker.id });
        } catch { llmNote = ""; }
        void llmNote;
        audits[key] = deterministic;
      })
    );
  }
  const blocked = Object.entries(audits)
    .filter(([, a]) => a.uncitedNumbers.length > 0 || a.mismatched.length > 0)
    .map(([k]) => k);
  return { prose, audits, blocked, publishable: blocked.length === 0 };
}
