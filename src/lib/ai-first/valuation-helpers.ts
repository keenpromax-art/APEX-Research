import { getAccountingArchitecture, isAccountingArchitectureId } from "./accounting-architecture";
import type {
  Assumption,
  Fact,
  FactPack,
  ForecastResult,
  ForecastSpecification,
  ForecastStatementYear,
  ProvenanceTier,
  ValuationEvidence,
  ValuationProvenanceInput,
  ValuationTerminalPolicy,
} from "./types";

export interface ValuationAnchors {
  currentPrice?: number;
  currentPriceFact?: Fact;
  sharesOutstanding?: number;
  sharesOutstandingFact?: Fact;
  cash?: number;
  cashFact?: Fact;
  debt?: number;
  debtFact?: Fact;
  netDebt?: number;
  netDebtFact?: Fact;
  totalEquity?: number;
  totalEquityFact?: Fact;
  bookValuePerShare?: number;
  bookValuePerShareFact?: Fact;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function periodScore(period: string | undefined): number {
  if (!period) return Number.NEGATIVE_INFINITY;
  if (period.toLowerCase() === "current") return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(period);
  if (Number.isFinite(parsed)) return parsed;
  const year = period.match(/(?:19|20)\d{2}/)?.[0];
  return year ? Number(year) : Number.NEGATIVE_INFINITY;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function allPackFacts(pack: FactPack): Fact[] {
  return [
    ...pack.market.facts,
    ...pack.shares.facts,
    ...pack.incomeStatement.facts,
    ...pack.balanceSheet.facts,
    ...pack.cashFlow.facts,
  ];
}

function latestExactFact(facts: readonly Fact[], metric: string): Fact | undefined {
  return facts
    .filter((fact) => fact.metric === metric && isFiniteNumber(fact.value))
    .sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period) || (right.factId ?? "").localeCompare(left.factId ?? ""))[0];
}

export function latestFactFromPack(pack: FactPack, metric: string): Fact | undefined {
  const exactSections = [pack.market, pack.shares, pack.incomeStatement, pack.balanceSheet, pack.cashFlow];
  const exact = exactSections
    .map((section) => latestExactFact(section.facts, metric))
    .filter((fact): fact is Fact => fact !== undefined)
    .sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period) || (right.factId ?? "").localeCompare(left.factId ?? ""))[0];
  if (exact) return exact;
  const wanted = normalized(metric);
  return allPackFacts(pack)
    .filter((fact) => normalized(fact.metric) === wanted && isFiniteNumber(fact.value))
    .sort((left, right) => periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period) - periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period) || (right.factId ?? "").localeCompare(left.factId ?? ""))[0];
}

export function latestFactByAliases(pack: FactPack, metrics: readonly string[]): Fact | undefined {
  for (const metric of metrics) {
    const fact = latestFactFromPack(pack, metric);
    if (fact) return fact;
  }
  return undefined;
}

export function latestValueFromPack(pack: FactPack, metric: string): number | undefined {
  return latestFactFromPack(pack, metric)?.value;
}

export function resolveValuationAnchors(pack: FactPack): ValuationAnchors {
  const currentPriceFact = latestFactByAliases(pack, ["currentPrice", "regularMarketPrice", "sharePrice"]);
  const sharesOutstandingFact = latestFactByAliases(pack, ["sharesOutstanding", "ordinarySharesNumber", "shareIssued"]);
  const cashFact = latestFactByAliases(pack, ["cash", "cashAndCashEquivalents", "cashCashEquivalents", "cashAndShortTermInvestments"]);
  const debtFact = latestFactByAliases(pack, ["totalDebt", "debt", "shortTermDebtAndCurrentPortionLongTermDebt"]);
  const explicitNetDebtFact = latestFactByAliases(pack, ["netDebt", "netDebtIncludingLeaseLiabilities"]);
  const totalEquityFact = latestFactByAliases(pack, ["commonStockEquity", "stockholdersEquity", "totalEquity"]);
  const bookValuePerShareFact = latestFactByAliases(pack, ["bookValuePerShare", "bookValue"]);
  const derivedNetDebt = debtFact?.value !== undefined && cashFact?.value !== undefined ? debtFact.value - cashFact.value : undefined;
  const resolvedNetDebt = explicitNetDebtFact?.value ?? derivedNetDebt;
  return {
    ...(currentPriceFact ? { currentPrice: currentPriceFact.value, currentPriceFact } : {}),
    ...(sharesOutstandingFact ? { sharesOutstanding: sharesOutstandingFact.value, sharesOutstandingFact } : {}),
    ...(cashFact ? { cash: cashFact.value, cashFact } : {}),
    ...(debtFact ? { debt: debtFact.value, debtFact } : {}),
    ...(isFiniteNumber(resolvedNetDebt) ? { netDebt: resolvedNetDebt, ...(explicitNetDebtFact ? { netDebtFact: explicitNetDebtFact } : {}) } : {}),
    ...(totalEquityFact ? { totalEquity: totalEquityFact.value, totalEquityFact } : {}),
    ...(bookValuePerShareFact ? { bookValuePerShare: bookValuePerShareFact.value, bookValuePerShareFact } : {}),
  };
}

function statementYears(forecast: ForecastResult): ForecastStatementYear[] {
  const count = Math.max(forecast.incomeStatement.length, forecast.balanceSheet.length, forecast.cashFlow.length);
  return Array.from({ length: count }, (_, index) => ({
    period: forecast.incomeStatement[index]?.period ?? forecast.balanceSheet[index]?.period ?? forecast.cashFlow[index]?.period ?? `Y${index + 1}`,
    values: {
      ...(forecast.incomeStatement[index]?.values ?? {}),
      ...(forecast.balanceSheet[index]?.values ?? {}),
      ...(forecast.cashFlow[index]?.values ?? {}),
    },
    provenance: {
      ...(forecast.incomeStatement[index]?.provenance ?? {}),
      ...(forecast.balanceSheet[index]?.provenance ?? {}),
      ...(forecast.cashFlow[index]?.provenance ?? {}),
    },
    factIds: {
      ...(forecast.incomeStatement[index]?.factIds ?? {}),
      ...(forecast.balanceSheet[index]?.factIds ?? {}),
      ...(forecast.cashFlow[index]?.factIds ?? {}),
    },
  }));
}

export function forecastLineValue(forecast: ForecastResult, aliases: readonly string[], yearIndex?: number): number | undefined {
  const years = statementYears(forecast);
  if (yearIndex !== undefined) {
    const year = years[yearIndex];
    if (!year) return undefined;
    return aliases.map((alias) => year.values[alias]).find(isFiniteNumber);
  }
  for (let index = years.length - 1; index >= 0; index -= 1) {
    const value = aliases.map((alias) => years[index].values[alias]).find(isFiniteNumber);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function forecastLinePath(forecast: ForecastResult, aliases: readonly string[]): Array<number | undefined> {
  const years = statementYears(forecast);
  return years.map((year) => aliases.map((alias) => year.values[alias]).find(isFiniteNumber));
}

export function completeFinitePath(path: ReadonlyArray<number | undefined>): path is number[] {
  return path.length > 0 && path.every(isFiniteNumber);
}

export function forecastLineProvenance(forecast: ForecastResult, aliases: readonly string[]): ProvenanceTier[] {
  const years = statementYears(forecast);
  return years.map((year) => {
    const key = aliases.find((alias) => isFiniteNumber(year.values[alias]));
    return key ? year.provenance[key] ?? "derived" : "derived";
  });
}

export function assumptionFor(spec: ForecastSpecification | { assumptions: readonly Assumption[] }, names: readonly string[]): Assumption | undefined {
  const wanted = new Set(names.map(normalized));
  return spec.assumptions.find((assumption) => wanted.has(normalized(assumption.variable)));
}

export function valuationAssumption(spec: { assumptions: readonly Assumption[] }, names: readonly string[]): Assumption | undefined {
  return assumptionFor(spec, names);
}

export function terminalPolicyOf(spec: { terminalPolicy?: ValuationTerminalPolicy; terminalAssumptions?: { growth: number; rationale: string } }): ValuationTerminalPolicy | undefined {
  if (spec.terminalPolicy) return spec.terminalPolicy;
  if (!spec.terminalAssumptions) return undefined;
  return { growth: spec.terminalAssumptions.growth, maxValueShare: 0.75, terminalMetric: "fcff", rationale: spec.terminalAssumptions.rationale };
}

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function stableId(prefix: string, parts: readonly unknown[]): string {
  return `${prefix}-${stableHash(parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("|"))}`;
}

export function canonicalFactReference(value: string): string {
  return value.trim().replace(/^\[F-|\]$/gi, "").replace(/^F-/i, "");
}

export function factReferenceExists(pack: FactPack, reference: string): boolean {
  const wanted = canonicalFactReference(reference).toLowerCase();
  return allPackFacts(pack).some((fact) => {
    const candidates = [fact.factId, fact.metric, fact.sourceId].filter((value): value is string => typeof value === "string");
    return candidates.some((candidate) => canonicalFactReference(candidate).toLowerCase() === wanted);
  });
}

export function evidenceRegistry(spec: { evidence?: readonly ValuationEvidence[] }): Map<string, ValuationEvidence> {
  return new Map((spec.evidence ?? []).map((item) => [item.id, item]));
}

export function evidenceReferencesExist(pack: FactPack, references: readonly string[], spec?: { evidence?: readonly ValuationEvidence[] }): boolean {
  const registry = evidenceRegistry(spec ?? {});
  return references.length > 0 && references.every((reference) => registry.has(reference) || factReferenceExists(pack, reference));
}

export function assumptionEvidenceReferences(assumption: Assumption): string[] {
  const references = [...(assumption.factIds ?? []), ...(assumption.evidenceIds ?? [])];
  const cited = assumption.historicalEvidence.match(/\[F-[^\]]+\]/gi) ?? [];
  return [...new Set([...references, ...cited.map((value) => value.replace(/^\[F-|\]$/g, ""))])];
}

export function provenanceInput(
  name: string,
  value: number | undefined,
  unit: string,
  provenance: ProvenanceTier,
  extra: Partial<Omit<ValuationProvenanceInput, "name" | "value" | "unit" | "provenance">> = {},
): ValuationProvenanceInput {
  return { name, ...(value !== undefined ? { value } : {}), unit, provenance, ...extra };
}

export function cloneForecastSpecification(spec: ForecastSpecification): ForecastSpecification {
  return {
    ...spec,
    variables: spec.variables.map((variable) => ({ ...variable, ...(variable.safeRange ? { safeRange: { ...variable.safeRange } } : {}) })),
    formulas: spec.formulas.map((formula) => ({ ...formula, variables: [...formula.variables], sourceFacts: [...formula.sourceFacts], ...(formula.sourceFactIds ? { sourceFactIds: [...formula.sourceFactIds] } : {}), ...(formula.evidenceIds ? { evidenceIds: [...formula.evidenceIds] } : {}), ...(formula.safeRange ? { safeRange: { ...formula.safeRange } } : {}) })),
    assumptions: spec.assumptions.map((assumption) => ({ ...assumption, ...(assumption.factIds ? { factIds: [...assumption.factIds] } : {}), ...(assumption.evidenceIds ? { evidenceIds: [...assumption.evidenceIds] } : {}), ...(assumption.valuePath ? { valuePath: [...assumption.valuePath] } : {}), ...(assumption.path ? { path: [...assumption.path] } : {}), ...(assumption.safeRange ? { safeRange: { ...assumption.safeRange } } : {}) })),
    driverPaths: Object.fromEntries(Object.entries(spec.driverPaths).map(([key, path]) => [key, [...path]])),
    outputs: spec.outputs ? [...spec.outputs] : undefined,
    statementOutputs: spec.statementOutputs ? Object.fromEntries(Object.entries(spec.statementOutputs).map(([key, value]) => [key, [...value]])) : undefined,
    validation: spec.validation ? { ...spec.validation, issues: [...spec.validation.issues] } : undefined,
  };
}

export function forecastPathEquals(left: readonly number[], right: readonly number[], tolerance = 1e-9): boolean {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= tolerance * Math.max(1, Math.abs(value), Math.abs(right[index])));
}

export function forecastStatementsEqual(left: ForecastResult, right: ForecastResult, tolerance = 1e-9): boolean {
  const compare = (a: readonly ForecastStatementYear[], b: readonly ForecastStatementYear[]): boolean => a.length === b.length && a.every((year, index) => {
    const other = b[index];
    if (!other || year.period !== other.period) return false;
    const keys = new Set([...Object.keys(year.values), ...Object.keys(other.values)]);
    return [...keys].every((key) => {
      const leftValue = year.values[key];
      const rightValue = other.values[key];
      if (!isFiniteNumber(leftValue) && !isFiniteNumber(rightValue)) return leftValue === rightValue;
      return isFiniteNumber(leftValue) && isFiniteNumber(rightValue) && Math.abs(leftValue - rightValue) <= tolerance * Math.max(1, Math.abs(leftValue), Math.abs(rightValue));
    });
  });
  return compare(left.incomeStatement, right.incomeStatement) && compare(left.balanceSheet, right.balanceSheet) && compare(left.cashFlow, right.cashFlow);
}

export function architectureInput(value: string | undefined) {
  return value && isAccountingArchitectureId(value) ? getAccountingArchitecture(value) : undefined;
}

export function isForecastBlocked(forecast: ForecastResult): boolean {
  return forecast.status === "blocked" || forecast.publicationStatus === "blocked" || forecast.publicationBlocked === true;
}

export default {
  allPackFacts,
  architectureInput,
  assumptionEvidenceReferences,
  assumptionFor,
  canonicalFactReference,
  cloneForecastSpecification,
  completeFinitePath,
  evidenceReferencesExist,
  factReferenceExists,
  forecastLinePath,
  forecastLineProvenance,
  forecastLineValue,
  forecastPathEquals,
  forecastStatementsEqual,
  isFiniteNumber,
  isForecastBlocked,
  latestFactByAliases,
  latestFactFromPack,
  latestValueFromPack,
  periodScore,
  provenanceInput,
  resolveValuationAnchors,
  stableHash,
  stableId,
  terminalPolicyOf,
  valuationAssumption,
};
