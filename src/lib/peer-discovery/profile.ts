import { compareStableStrings, stableHash } from "@/lib/research-ledger/stable";
import type { FactPack } from "@/lib/ai-first/types";
import type { CompanyUnderstanding } from "@/lib/ai-first/types";
import {
  PEER_DIMENSION_KEYS,
  type PeerDimensionKey,
  type PeerEconomicProfile,
  type PeerProfileInput,
  type PeerProfileStatus,
} from "./types";
import { listHistoryFacts, historyFiscalYear } from "@/lib/history/facts";

const PROFILE_DOMAIN = "peer-discovery/profile/v1";

function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? round6(value) : null;
}

function cleanList(values: readonly string[] | undefined): readonly string[] {
  if (!values) return Object.freeze([]) as readonly string[];
  const out = new Set<string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) out.add(normalized);
  }
  return Object.freeze([...out].sort(compareStableStrings));
}

function cleanText(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

function comparableKeys(profile: PeerEconomicProfile): readonly PeerDimensionKey[] {
  const keys: PeerDimensionKey[] = [];
  for (const key of PEER_DIMENSION_KEYS) {
    const value = dimensionInputs(profile, key);
    if (value.present) keys.push(key);
  }
  return keys;
}

function dimensionInputs(profile: PeerEconomicProfile, key: PeerDimensionKey): { present: boolean; text: string | null; numeric: number | null } {
  switch (key) {
    case "economicSegment": {
      const segments = profile.economicSegments;
      return { present: segments.length > 0, text: segments.join(" | ") || null, numeric: null };
    }
    case "revenueEngine": {
      const engines = profile.revenueEngines;
      return { present: engines.length > 0, text: engines.join(" | ") || null, numeric: null };
    }
    case "operatingKpi": {
      const kpis = profile.operatingKpis;
      return { present: kpis.length > 0, text: kpis.join(" | ") || null, numeric: null };
    }
    case "profitability": {
      const parts = [
        profile.operatingMargin === null ? null : `opm ${round6(profile.operatingMargin)}`,
        profile.netMargin === null ? null : `nim ${round6(profile.netMargin)}`,
        profile.returnOnEquity === null ? null : `roe ${round6(profile.returnOnEquity)}`,
      ].filter((entry): entry is string => entry !== null);
      return { present: parts.length > 0, text: parts.join(" ") || null, numeric: null };
    }
    case "growth":
      return { present: profile.revenueGrowth !== null, text: profile.revenueGrowth === null ? null : String(round6(profile.revenueGrowth)), numeric: profile.revenueGrowth };
    case "capitalIntensity": {
      const parts = [
        profile.capexIntensity === null ? null : `capex ${round6(profile.capexIntensity)}`,
        profile.workingCapitalIntensity === null ? null : `wc ${round6(profile.workingCapitalIntensity)}`,
      ].filter((entry): entry is string => entry !== null);
      return { present: parts.length > 0, text: parts.join(" ") || null, numeric: null };
    }
    case "balanceSheet": {
      const parts = [
        profile.leverage === null ? null : `lev ${round6(profile.leverage)}`,
        profile.returnOnAssets === null ? null : `roa ${round6(profile.returnOnAssets)}`,
      ].filter((entry): entry is string => entry !== null);
      return { present: parts.length > 0, text: parts.join(" ") || null, numeric: null };
    }
    case "geography":
      return { present: profile.geography !== null, text: profile.geography, numeric: null };
    case "valuation": {
      const entries = (Object.keys(profile.multiples) as Array<keyof typeof profile.multiples>)
        .map((key) => (profile.multiples[key] === null ? null : `${key} ${round6(profile.multiples[key] as number)}`))
        .filter((entry): entry is string => entry !== null);
      return { present: entries.length > 0, text: entries.join(" ") || null, numeric: null };
    }
    case "scale":
      return { present: profile.marketCap !== null, text: profile.marketCap === null ? null : String(round6(profile.marketCap)), numeric: profile.marketCap };
    default:
      return { present: false, text: null, numeric: null };
  }
}

export function buildPeerEconomicProfile(input: PeerProfileInput): PeerEconomicProfile {
  const id = String(input.id ?? "").trim().toUpperCase();
  const label = cleanText(input.label) ?? id;
  const economicSegments = cleanList(input.economicSegments);
  const revenueEngines = cleanList(input.revenueEngines);
  const operatingKpis = cleanList(input.operatingKpis);
  const grossMargin = finiteOrNull(input.grossMargin);
  const operatingMargin = finiteOrNull(input.operatingMargin);
  const netMargin = finiteOrNull(input.netMargin);
  const revenueGrowth = finiteOrNull(input.revenueGrowth);
  const capexIntensity = finiteOrNull(input.capexIntensity);
  const workingCapitalIntensity = finiteOrNull(input.workingCapitalIntensity);
  const leverage = finiteOrNull(input.leverage);
  const returnOnEquity = finiteOrNull(input.returnOnEquity);
  const returnOnAssets = finiteOrNull(input.returnOnAssets);
  const marketCap = finiteOrNull(input.marketCap);
  const multiples = {
    pe: finiteOrNull(input.multiples?.pe),
    evEbitda: finiteOrNull(input.multiples?.evEbitda),
    evSales: finiteOrNull(input.multiples?.evSales),
    priceToBook: finiteOrNull(input.multiples?.priceToBook),
  } as PeerEconomicProfile["multiples"];
  const sourceTiers = cleanList(input.sourceTiers);
  const sourceQuotes = cleanList(input.sourceQuotes);
  const evidenceIds = [...new Set((input.evidenceIds ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort(compareStableStrings);
  const diagnostics: string[] = [];
  if (!economicSegments.length) diagnostics.push("PEER_SEGMENTS_UNKNOWN");
  if (!revenueEngines.length) diagnostics.push("PEER_REVENUE_ENGINES_UNKNOWN");
  if (operatingMargin === null && netMargin === null) diagnostics.push("PEER_MARGIN_UNKNOWN");
  if (revenueGrowth === null) diagnostics.push("PEER_GROWTH_UNKNOWN");
  if (capexIntensity === null) diagnostics.push("PEER_CAPITAL_INTENSITY_UNKNOWN");
  if (leverage === null) diagnostics.push("PEER_LEVERAGE_UNKNOWN");
  if (sourceQuotes.length === 0) diagnostics.push("PEER_SOURCE_QUOTE_MISSING");
  if (evidenceIds.length === 0) diagnostics.push("PEER_EVIDENCE_MISSING");
  const draft: PeerEconomicProfile = {
    id,
    label,
    status: "empty",
    economicSegments,
    revenueEngines,
    operatingKpis,
    primaryEconomicAbstraction: cleanText(input.primaryEconomicAbstraction),
    sector: cleanText(input.sector),
    industry: cleanText(input.industry),
    geography: cleanText(input.geography),
    currency: cleanText(input.currency)?.toUpperCase() ?? null,
    grossMargin,
    operatingMargin,
    netMargin,
    revenueGrowth,
    capexIntensity,
    workingCapitalIntensity,
    leverage,
    returnOnEquity,
    returnOnAssets,
    marketCap,
    multiples,
    competitiveRelationships: cleanList(input.competitiveRelationships),
    evidenceIds,
    sourceTiers,
    sourceQuotes,
    comparableDimensions: 0,
    diagnostics,
  };
  const comparable = comparableKeys(draft);
  const status: PeerProfileStatus = comparable.length >= 6 ? "complete" : comparable.length > 0 ? "partial" : "empty";
  return { ...draft, status, comparableDimensions: comparable.length };
}

function latestByPeriod(facts: ReturnType<typeof listHistoryFacts>, aliases: readonly string[]): number | null {
  let best: { period: string; value: number } | null = null;
  for (const fact of facts) {
    if (!aliases.includes(fact.metric)) continue;
    if (fact.value === undefined) continue;
    const period = (fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period ?? "").slice(0, 10);
    if (!period) continue;
    if (!best || period > best.period || (period === best.period && (fact.value as number) > best.value)) {
      best = { period, value: fact.value };
    }
  }
  return best ? round6(best.value) : null;
}

function revenueByPeriod(facts: ReturnType<typeof listHistoryFacts>, aliases: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const fact of facts) {
    if (!aliases.includes(fact.metric)) continue;
    if (fact.value === undefined || !Number.isFinite(fact.value)) continue;
    const period = (fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period ?? "").slice(0, 10);
    if (!period) continue;
    const existing = out.get(period);
    if (existing === undefined || (fact.value as number) > existing) out.set(period, fact.value);
  }
  return out;
}

function revenueGrowthFrom(facts: ReturnType<typeof listHistoryFacts>, aliases: readonly string[]): number | null {
  const byPeriod = revenueByPeriod(facts, aliases);
  const periods = [...byPeriod.keys()].sort();
  if (periods.length < 2) return null;
  const lastPeriod = periods[periods.length - 1] as string;
  const lastYear = historyFiscalYear(lastPeriod) ?? 0;
  const priorPeriod = [...periods].reverse().find((period) => (historyFiscalYear(period) ?? 0) <= lastYear - 1);
  if (!priorPeriod) return null;
  const last = byPeriod.get(lastPeriod) as number;
  const prior = byPeriod.get(priorPeriod) as number;
  if (prior === 0) return null;
  return round6(last / prior - 1);
}

function marginOf(facts: ReturnType<typeof listHistoryFacts>, numerator: readonly string[], denominator: readonly string[]): number | null {
  const top = latestByPeriod(facts, numerator);
  const bottom = latestByPeriod(facts, denominator);
  if (top === null || bottom === null || bottom === 0) return null;
  return round6(top / bottom);
}

function textFactValue(factPack: FactPack | null, metric: string): string | null {
  const fact = factPack?.company?.facts.find((entry) => entry.metric === metric);
  return cleanText(fact?.textValue);
}

export function buildSubjectPeerProfile(input: {
  readonly factPack: FactPack | null;
  readonly understanding?: CompanyUnderstanding | null;
  readonly evidenceIds?: readonly string[];
  readonly competitiveSeedNames?: readonly string[];
}): PeerEconomicProfile {
  const factPack = input.factPack ?? null;
  const facts = listHistoryFacts(factPack);
  const understanding = input.understanding ?? null;
  const revenueAliases = ["totalRevenue", "operatingRevenue", "totalRevenues", "revenue", "netRevenue"];
  const revenue = latestByPeriod(facts, revenueAliases);
  const marketCap = latestByPeriod(facts, ["marketCap"]);
  const marketCapFact = factPack?.market?.facts.find((fact) => fact.metric === "marketCap" && typeof fact.value === "number");
  const currency = marketCapFact?.currency ?? facts.find((fact) => fact.currency)?.currency ?? null;
  const currentAssets = latestByPeriod(facts, ["totalCurrentAssets"]);
  const currentLiabilities = latestByPeriod(facts, ["totalCurrentLiabilities"]);
  const workingCapitalIntensity = revenue && revenue !== 0 && currentAssets !== null && currentLiabilities !== null
    ? round6((currentAssets - currentLiabilities) / revenue)
    : null;
  return buildPeerEconomicProfile({
    id: factPack?.ticker ?? "UNKNOWN",
    label: textFactValue(factPack, "companyName") ?? understanding?.companyName ?? factPack?.ticker ?? "UNKNOWN",
    economicSegments: (understanding?.businessSegments ?? []).map((segment) => segment.name),
    revenueEngines: (understanding?.revenueDrivers ?? []).map((driver) => driver.name),
    operatingKpis: (understanding?.keyKpis ?? []).map((kpi) => kpi.name),
    primaryEconomicAbstraction: understanding?.primaryEconomicAbstraction ?? null,
    sector: textFactValue(factPack, "sector"),
    industry: textFactValue(factPack, "industry"),
    geography: textFactValue(factPack, "country"),
    currency,
    grossMargin: marginOf(facts, ["grossProfit"], revenueAliases),
    operatingMargin: marginOf(facts, ["operatingIncome"], revenueAliases),
    netMargin: marginOf(facts, ["netIncome"], revenueAliases),
    revenueGrowth: revenueGrowthFrom(facts, revenueAliases),
    capexIntensity: (() => {
      const capex = latestByPeriod(facts, ["capitalExpenditures", "capitalExpenditureReported", "purchaseOfPPE"]);
      if (capex === null || revenue === null || revenue === 0) return null;
      return round6(Math.abs(capex) / revenue);
    })(),
    workingCapitalIntensity,
    leverage: (() => {
      const debt = latestByPeriod(facts, ["totalDebt", "totalDebtAndCapitalLeaseObligation"]);
      const equity = latestByPeriod(facts, ["totalEquity", "StockholdersEquity", "stockholdersEquity", "totalStockholderEquity"]);
      if (debt === null || equity === null || equity === 0) return null;
      return round6(debt / equity);
    })(),
    returnOnEquity: marginOf(facts, ["netIncome"], ["totalEquity", "StockholdersEquity", "stockholdersEquity", "totalStockholderEquity"]),
    returnOnAssets: marginOf(facts, ["netIncome"], ["totalAssets"]),
    marketCap: marketCap ?? null,
    multiples: {
      pe: latestByPeriod(facts, ["trailingPE"]),
      evEbitda: null,
      evSales: null,
      priceToBook: latestByPeriod(facts, ["priceToBook"]),
    },
    competitiveRelationships: input.competitiveSeedNames ?? [],
    evidenceIds: input.evidenceIds ?? [],
    sourceTiers: factPack ? ["secondary"] : [],
    sourceQuotes: factPack ? [`factpack:${factPack.version}`] : [],
  });
}

export function peerProfileContentHash(profile: PeerEconomicProfile): string {
  return stableHash({
    id: profile.id,
    status: profile.status,
    comparableDimensions: profile.comparableDimensions,
    economicSegments: profile.economicSegments,
    revenueEngines: profile.revenueEngines,
    geography: profile.geography,
  }, PROFILE_DOMAIN);
}
