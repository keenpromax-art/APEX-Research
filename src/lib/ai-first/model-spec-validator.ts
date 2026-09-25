import type { ExpressionNode } from "./model-runtime";
import { expressionVariables, parseExpression } from "./model-runtime";
import type { Fact, FactPack, ForecastSpecification, ForecastVariable, Formula } from "./types";

export type ModelSpecValidationSeverity = "error" | "warning";

export type ModelSpecValidationCode =
  | "SCHEMA_INVALID"
  | "INVALID_FIELD_TYPE"
  | "INVALID_ID"
  | "INVALID_NAME"
  | "EMPTY_VARIABLES"
  | "EMPTY_FORMULAS"
  | "EMPTY_OUTPUTS"
  | "DUPLICATE_VARIABLE"
  | "DUPLICATE_FORMULA_ID"
  | "DUPLICATE_ASSUMPTION_ID"
  | "DUPLICATE_OUTPUT"
  | "INVALID_BASE_VALUE"
  | "MISSING_BASE_VALUE"
  | "BASE_VALUE_MISMATCH"
  | "MISSING_CANONICAL_BASE"
  | "NO_ZERO_SUBSTITUTION"
  | "UNKNOWN_ASSUMPTION_VARIABLE"
  | "UNKNOWN_DRIVER_VARIABLE"
  | "INVALID_ASSUMPTION_VALUE"
  | "INVALID_DRIVER_VALUE"
  | "HORIZON_LENGTH_MISMATCH"
  | "INVALID_PERIOD"
  | "INVALID_EXPRESSION"
  | "FORMULA_VARIABLE_MISMATCH"
  | "UNKNOWN_FORMULA_VARIABLE"
  | "COMPUTED_VARIABLE_WITHOUT_FORMULA"
  | "DISCONNECTED_OUTPUT"
  | "UNUSED_VARIABLE"
  | "INVALID_UNIT"
  | "UNIT_MISMATCH"
  | "DIMENSION_MISMATCH"
  | "UNSAFE_VALUE"
  | "DEPENDENCY_CYCLE"
  | "UNKNOWN_DEPENDENCY"
  | "MISSING_EVIDENCE_ID"
  | "UNKNOWN_EVIDENCE_ID"
  | "INVALID_CONFIDENCE";

export interface ModelSpecValidationIssue {
  code: ModelSpecValidationCode;
  path: string;
  message: string;
  severity: ModelSpecValidationSeverity;
  blocking: boolean;
}

export interface ModelSpecValidationResult {
  valid: boolean;
  ok: boolean;
  blocked: boolean;
  issues: ModelSpecValidationIssue[];
  errors: ModelSpecValidationIssue[];
  warnings: ModelSpecValidationIssue[];
  evidenceIds: string[];
  dependencyGraph: Record<string, string[]>;
  formulaDependencyGraph: Record<string, string[]>;
  topologicalOrder: string[];
  formulaOrder: string[];
  spec?: ForecastSpecification;
  normalizedSpec?: ForecastSpecification;
}

export interface ModelSpecValidationOptions {
  requireEvidence?: boolean;
  enforceCanonicalBases?: boolean;
  allowUnresolvedBaseValues?: boolean;
  allowComputedWithoutBase?: boolean;
  allowComputedDriverPaths?: boolean;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const PERIOD = /^(?:Y\d+|Y\d+\s*-\s*Y\d+|FY\d{4}|annual|annualized|terminal|current)$/i;
const STATEMENT_OUTPUTS = new Set([
  "revenue", "totalrevenue", "grossprofit", "ebit", "operatingincome", "pbt", "pretaxincome", "netincome", "tax", "totalopex", "operatingexpenses",
  "cash", "cashclose", "cashopen", "cfo", "cfi", "cff", "totalassets", "totalliabilities", "totalequity",
  "stockholdersequity", "tot debt", "totaldebt", "retainedearnings", "workingcapital", "ppe", "capitalexpenditures",
]);

const UNIT_ALIASES: Record<string, string> = {
  "%": "ratio",
  percent: "ratio",
  percentage: "ratio",
  ratio: "ratio",
  decimal: "ratio",
  rate: "ratio",
  bps: "ratio",
  currency: "currency",
  money: "currency",
  cash: "currency",
  usd: "currency",
  eur: "currency",
  gbp: "currency",
  inr: "currency",
  jpy: "currency",
  count: "count",
  unit: "count",
  units: "count",
  vehicles: "count",
  subscribers: "count",
  customers: "count",
  shares: "shares",
  share: "shares",
  eps: "currencyPerShare",
  "currency/share": "currencyPerShare",
  "currency per share": "currencyPerShare",
  perShare: "currencyPerShare",
  "per share": "currencyPerShare",
  days: "days",
  day: "days",
  years: "years",
  year: "years",
  x: "multiple",
  multiple: "multiple",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function issue(result: ModelSpecValidationIssue[], code: ModelSpecValidationCode, path: string, message: string, severity: ModelSpecValidationSeverity = "error"): void {
  result.push({ code, path, message, severity, blocking: severity === "error" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function periodScore(period: string | undefined): number {
  if (!period) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(period);
  if (Number.isFinite(parsed)) return parsed;
  const match = period.match(/(?:19|20)\d{2}/)?.[0];
  return match ? Number(match) : Number.NEGATIVE_INFINITY;
}

function factSort(left: Fact, right: Fact): number {
  const leftPeriod = periodScore(left.reportingPeriod ?? left.fiscalPeriod ?? left.period);
  const rightPeriod = periodScore(right.reportingPeriod ?? right.fiscalPeriod ?? right.period);
  return rightPeriod - leftPeriod || (right.factId ?? "").localeCompare(left.factId ?? "");
}

function allFacts(pack: FactPack | undefined): Fact[] {
  if (!pack) return [];
  return [
    ...pack.company.facts,
    ...pack.market.facts,
    ...pack.incomeStatement.facts,
    ...pack.balanceSheet.facts,
    ...pack.cashFlow.facts,
    ...pack.shares.facts,
    ...pack.earnings.facts,
    ...pack.estimates.facts,
    ...pack.corporateActions.facts,
    ...pack.priceHistory.facts,
    ...pack.holders.facts,
  ];
}

function metricAliases(metric: string): string[] {
  const normalized = normalizedName(metric);
  const aliases = new Set([normalized]);
  const mappings: Record<string, string[]> = {
    revenue: ["totalrevenue", "revenue"],
    totalrevenue: ["revenue", "totalrevenue"],
    grossprofit: ["grossprofit"],
    ebit: ["operatingincome", "ebit"],
    operatingincome: ["ebit", "operatingincome"],
    pbt: ["pretaxincome", "pbt"],
    pretaxincome: ["pbt", "pretaxincome"],
    netincome: ["netincome"],
    totalassets: ["totalassets", "assets"],
    assets: ["totalassets", "assets"],
    totalliabilities: ["totalliabilities", "liabilities"],
    liabilities: ["totalliabilities", "liabilities"],
    totalequity: ["totalequity", "stockholdersequity", "equity"],
    stockholdersequity: ["totalequity", "stockholdersequity", "equity"],
    equity: ["totalequity", "stockholdersequity", "equity"],
    cash: ["cash", "cashandcashequivalents", "cashcashandcashequivalents"],
    totaldebt: ["totaldebt", "debt"],
    debt: ["totaldebt", "debt"],
    ppe: ["propertyplantandequipment", "propertyplantandequipmentnet", "ppe"],
    retainedearnings: ["retainedearnings", "retainedearningsaccumulateddeficit"],
    cfo: ["cashfromoperations", "operatingcashflow", "totalcashfromoperatingactivities", "cfo"],
    cfi: ["cashfrominvesting", "investingcashflow", "totalcashfrominvestingactivities", "cfi"],
    cff: ["cashfromfinancing", "financingcashflow", "totalcashfromfinancingactivities", "cff"],
  };
  for (const alias of mappings[normalized] ?? []) aliases.add(alias);
  return [...aliases];
}

function factsForMetric(pack: FactPack | undefined, metric: string): Fact[] {
  if (!pack) return [];
  const aliases = new Set(metricAliases(metric));
  return allFacts(pack)
    .filter((fact) => aliases.has(normalizedName(fact.metric)) || aliases.has(normalizedName(fact.label)) || metricAliases(fact.metric).includes(normalizedName(metric)))
    .filter((fact) => fact.value !== undefined && Number.isFinite(fact.value))
    .sort(factSort);
}

export function resolveFactReference(pack: FactPack | undefined, reference: unknown): Fact | undefined {
  if (!pack || typeof reference !== "string") return undefined;
  const raw = reference.trim();
  if (!raw) return undefined;
  const facts = allFacts(pack);
  const exact = facts.find((fact) => fact.factId === raw);
  if (exact) return exact;
  const unwrapped = raw.replace(/^\[|\]$/g, "").trim();
  const exactUnwrapped = facts.find((fact) => fact.factId === unwrapped);
  if (exactUnwrapped) return exactUnwrapped;
  const metric = unwrapped.replace(/^\[?F-?/i, "").replace(/\]$/g, "").trim();
  return factsForMetric(pack, metric)[0];
}

export function canonicalFactReference(pack: FactPack | undefined, reference: unknown): string | undefined {
  return resolveFactReference(pack, reference)?.factId;
}

function referencedEvidence(values: readonly unknown[] | undefined): string[] {
  return (values ?? []).filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
}

function evidenceFromText(value: string): string[] {
  const matches = value.match(/\[FACT-[A-Z0-9-]+\]|\[F-[^\]]+\]|\bFACT-[A-Z0-9-]+\b|\bF-[A-Za-z0-9_-]+\b/gi) ?? [];
  return [...new Set(matches.map((match) => match.replace(/^\[|\]$/g, "")))];
}

function validateEvidence(values: readonly string[], path: string, pack: FactPack | undefined, issues: ModelSpecValidationIssue[], evidenceIds: Set<string>, required: boolean): void {
  if (required && values.length === 0) issue(issues, "MISSING_EVIDENCE_ID", path, "Evidence must reference at least one canonical factId");
  for (const value of values) {
    const fact = resolveFactReference(pack, value);
    if (!fact?.factId) {
      issue(issues, "UNKNOWN_EVIDENCE_ID", path, `Evidence reference ${value} does not resolve to a canonical factId`);
    } else {
      evidenceIds.add(fact.factId);
    }
  }
}

const KNOWN_UNITS = new Set([
  "unknown", "text", "number", "numeric", "value", "ratio", "decimal", "percent", "percentage", "rate", "bps", "multiple", "x", "currency", "money", "cash",
  "count", "unit", "units", "shares", "share", "currencypershare", "pershare", "days", "day", "years", "year", "months", "month", "quarters", "quarter", "hours", "hour",
  "kg", "g", "tonnes", "tons", "kwh", "mwh", "gwh", "twh", "mw", "gw", "requests", "queries", "vehicles", "subscribers", "customers", "properties", "policies", "loans", "deposits", "aum",
]);

function unitName(unit: unknown): string {
  const raw = text(unit).toLowerCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (UNIT_ALIASES[raw]) return UNIT_ALIASES[raw];
  if (raw === "$") return "currency";
  if (raw === "currencypershare") return "currencyPerShare";
  if (/^(usd|eur|gbp|inr|jpy|cad|aud|chf|cny|hkd|sgd|sek|nok|dkk|zar|brl|mxn|krw)(?:m|mn|mm|b|bn|million|millions|thousand|thousands|billion|billions)?$/.test(raw)) return "currency";
  if (/^[a-z]+per[a-z]+$/.test(raw)) return "ratio";
  if (KNOWN_UNITS.has(raw)) return raw;
  return "";
}

function dimensionForUnit(unit: string): Record<string, number> {
  const name = unitName(unit);
  if (name === "currency") return { currency: 1 };
  if (name === "count") return {};
  if (name === "shares") return { shares: 1 };
  if (name === "ratio") return {};
  if (name === "currencyPerShare") return { currency: 1, shares: -1 };
  if (name === "days") return { days: 1 };
  if (name === "years") return { years: 1 };
  if (name === "multiple") return { multiple: 1 };
  return {};
}

function addDimensions(left: Record<string, number>, right: Record<string, number>, sign = 1): Record<string, number> {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) result[key] = (result[key] ?? 0) + sign * value;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => Math.abs(value) > 1e-12));
}

function dimensionsCompatible(left: Record<string, number>, right: Record<string, number>): boolean {
  if (Object.keys(left).length === 0 || Object.keys(right).length === 0) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function expressionDimension(node: ExpressionNode, dimensions: ReadonlyMap<string, Record<string, number>>): Record<string, number> | null {
  if (node.kind === "number") return {};
  if (node.kind === "identifier") return dimensions.get(node.name.toLowerCase()) ?? {};
  if (node.kind === "unary") return expressionDimension(node.operand, dimensions);
  const left = expressionDimension(node.left, dimensions);
  const right = expressionDimension(node.right, dimensions);
  if (!left || !right) return null;
  if (node.operator === "+" || node.operator === "-") return dimensionsCompatible(left, right) ? left : null;
  if (node.operator === "*") return addDimensions(left, right);
  return addDimensions(left, right, -1);
}

function safeValue(value: number, unit: string, variableName: string, issues: ModelSpecValidationIssue[], path: string): void {
  if (!Number.isFinite(value)) return;
  if (Math.abs(value) > 1e15) issue(issues, "UNSAFE_VALUE", path, `${variableName} is outside the safe numeric range`);
  const normalized = unitName(unit);
  if ((normalized === "ratio" || normalized === "multiple") && Math.abs(value) > 1000) issue(issues, "UNSAFE_VALUE", path, `${variableName} is outside the safe ratio range`);
  if (variableName.toLowerCase().includes("growth") && value <= -1) issue(issues, "UNSAFE_VALUE", path, `${variableName} cannot be less than or equal to -1`);
}

function variableMap(variables: readonly ForecastVariable[]): Map<string, ForecastVariable> {
  return new Map(variables.map((variable) => [variable.name.toLowerCase(), variable]));
}

function priorBaseName(name: string, variables: ReadonlyMap<string, ForecastVariable>): string | undefined {
  const lower = name.toLowerCase();
  const candidates = [lower];
  for (const prefix of ["prior_", "previous_", "prev_"]) if (lower.startsWith(prefix)) candidates.push(lower.slice(prefix.length));
  for (const suffix of ["_prior", "_prev", "_lag1", "_previous"]) if (lower.endsWith(suffix)) candidates.push(lower.slice(0, -suffix.length));
  for (const candidate of candidates) {
    if (variables.has(candidate)) return candidate;
    const camel = name.match(/^(?:prior|previous|prev)([A-Z].*)$/);
    if (camel && variables.has(camel[1].toLowerCase())) return camel[1].toLowerCase();
  }
  return undefined;
}

function resolveBaseFact(pack: FactPack | undefined, variable: ForecastVariable): { fact?: Fact; explicit: boolean } {
  if (!pack) return { explicit: false };
  const explicitReference = variable.baseFactId ?? variable.factId ?? ((variable.kind === "input" || variable.baseValue !== undefined) ? variable.statementLine : undefined);
  if (text(explicitReference)) {
    return { fact: resolveFactReference(pack, explicitReference), explicit: true };
  }
  if (variable.kind !== "input") return { explicit: false };
  const candidates = factsForMetric(pack, variable.name);
  return { fact: candidates[0], explicit: false };
}

function isCompatibleBaseUnit(variable: ForecastVariable, fact: Fact): boolean {
  const variableUnit = unitName(variable.unit);
  const factUnit = unitName(fact.unit ?? "");
  return !variableUnit || !factUnit || variableUnit === factUnit || variableUnit === "ratio" || factUnit === "ratio";
}

function validateBaseValues(
  variables: readonly ForecastVariable[],
  pack: FactPack | undefined,
  options: ModelSpecValidationOptions,
  issues: ModelSpecValidationIssue[],
): void {
  for (const variable of variables) {
    const path = `variables[${variable.name}]`;
    const hasBase = Object.prototype.hasOwnProperty.call(variable, "baseValue");
    const base = variable.baseValue;
    if (hasBase && !validNumber(base)) {
      issue(issues, "INVALID_BASE_VALUE", `${path}.baseValue`, "baseValue must be a finite number and cannot be null or substituted with zero");
      continue;
    }
    if (hasBase && validNumber(base)) safeValue(base, variable.unit, variable.name, issues, `${path}.baseValue`);
    const resolved = resolveBaseFact(pack, variable);
    if (hasBase && validNumber(base) && resolved.fact && (options.enforceCanonicalBases !== false || resolved.explicit)) {
      if (!isCompatibleBaseUnit(variable, resolved.fact)) issue(issues, "UNIT_MISMATCH", `${path}.baseValue`, `Base unit ${variable.unit} is incompatible with fact unit ${resolved.fact.unit ?? resolved.fact.currency ?? "unknown"}`);
      const difference = Math.abs(base - (resolved.fact.value as number));
      const tolerance = Math.max(1e-9, Math.abs(resolved.fact.value as number) * 1e-9);
      if (difference > tolerance) issue(issues, "BASE_VALUE_MISMATCH", `${path}.baseValue`, `Base value ${base} does not match canonical fact ${resolved.fact.factId ?? resolved.fact.metric} value ${resolved.fact.value}`);
    } else if (hasBase && validNumber(base) && base === 0 && !resolved.fact) {
      issue(issues, "NO_ZERO_SUBSTITUTION", `${path}.baseValue`, "Zero cannot stand in for a missing canonical fact");
    } else if (resolved.explicit && !resolved.fact) {
      issue(issues, "MISSING_CANONICAL_BASE", `${path}.baseValue`, "Declared base fact reference cannot be resolved");
    } else if (!hasBase && variable.kind === "input" && options.enforceCanonicalBases !== false && !options.allowUnresolvedBaseValues) {
      issue(issues, "MISSING_BASE_VALUE", `${path}.baseValue`, "Input variables require a canonical base value");
    } else if (!hasBase && variable.kind === "input" && options.allowUnresolvedBaseValues && resolved.fact) {
      issue(issues, "MISSING_BASE_VALUE", `${path}.baseValue`, "Canonical base fact exists but baseValue was omitted", "warning");
    }
  }
}

function formulaOutputs(formulas: readonly Formula[]): Map<string, Formula> {
  const map = new Map<string, Formula>();
  for (const formula of formulas) map.set(formula.output.toLowerCase(), formula);
  return map;
}

function topological(formulas: readonly Formula[], issues: ModelSpecValidationIssue[], variablesByName?: ReadonlyMap<string, ForecastVariable>): { order: string[]; graph: Record<string, string[]>; formulaOrder: string[] } {
  const producers = formulaOutputs(formulas);
  const graph: Record<string, string[]> = {};
  const indegree = new Map<string, number>();
  for (const formula of formulas) {
    const output = formula.output.toLowerCase();
    graph[output] ??= [];
    indegree.set(output, 0);
  }
  for (const formula of formulas) {
    const output = formula.output.toLowerCase();
    for (const variable of new Set(formula.variables.map((name) => (variablesByName ? priorBaseName(name, variablesByName) ?? name.toLowerCase() : name.toLowerCase())))) {
      if (!producers.has(variable) || variable === output) continue;
      graph[variable] ??= [];
      graph[variable].push(output);
      indegree.set(output, (indegree.get(output) ?? 0) + 1);
    }
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([name]) => name).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    order.push(current);
    for (const next of (graph[current] ?? []).sort()) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
    queue.sort();
  }
  if (order.length !== indegree.size) issue(issues, "DEPENDENCY_CYCLE", "formulas", "Formula dependencies contain a cycle");
  const formulaOrder = order.map((name) => producers.get(name)?.id ?? name);
  return { order, graph, formulaOrder } as { order: string[]; graph: Record<string, string[]>; formulaOrder: string[] };
}

function knownStatementOutput(variable: ForecastVariable, formula: Formula): boolean {
  const statementLine = normalizedName(variable.statementLine ?? "");
  const knownLine = STATEMENT_OUTPUTS.has(statementLine) || /^(?:income|balance|cash|statement)/.test(statementLine);
  return variable.statement !== undefined || knownLine || formula.terminal === true || STATEMENT_OUTPUTS.has(normalizedName(formula.output));
}

export function validateModelSpec(
  value: unknown,
  factPack?: FactPack,
  options: ModelSpecValidationOptions = {},
): ModelSpecValidationResult {
  const issues: ModelSpecValidationIssue[] = [];
  const evidenceIds = new Set<string>();
  if (!isObject(value)) {
    issue(issues, "SCHEMA_INVALID", "$", "Model specification must be an object");
    return { valid: false, ok: false, blocked: true, issues, errors: issues, warnings: [], evidenceIds: [], dependencyGraph: {}, formulaDependencyGraph: {}, topologicalOrder: [], formulaOrder: [] };
  }
  const horizon = value.horizonYears;
  if (!validNumber(horizon) || !Number.isInteger(horizon) || horizon < 1 || horizon > 10) issue(issues, "INVALID_FIELD_TYPE", "$.horizonYears", "horizonYears must be an integer from 1 through 10");
  if (typeof value.horizonRationale !== "string" || value.horizonRationale.trim() === "") issue(issues, "INVALID_FIELD_TYPE", "$.horizonRationale", "horizonRationale must be a non-empty string");
  if (!Array.isArray(value.variables) || value.variables.length === 0) issue(issues, "EMPTY_VARIABLES", "$.variables", "At least one variable is required");
  if (!Array.isArray(value.formulas) || value.formulas.length === 0) issue(issues, "EMPTY_FORMULAS", "$.formulas", "At least one formula is required");
  if (!Array.isArray(value.assumptions)) issue(issues, "INVALID_FIELD_TYPE", "$.assumptions", "assumptions must be an array");
  if (!isObject(value.driverPaths)) issue(issues, "INVALID_FIELD_TYPE", "$.driverPaths", "driverPaths must be an object");
  if (value.outputs !== undefined && (!Array.isArray(value.outputs) || value.outputs.length === 0)) issue(issues, "EMPTY_OUTPUTS", "$.outputs", "outputs must be a non-empty array when provided");

  const rawVariables = Array.isArray(value.variables) ? value.variables : [];
  const variables: ForecastVariable[] = [];
  const variableNames = new Set<string>();
  const variableIds = new Set<string>();
  rawVariables.forEach((raw, index) => {
    const path = `$.variables[${index}]`;
    if (!isObject(raw)) {
      issue(issues, "SCHEMA_INVALID", path, "Variable must be an object");
      return;
    }
    const name = text(raw.name);
    const label = text(raw.label);
    const unit = text(raw.unit);
    const kind = raw.kind;
    if (!name || !IDENTIFIER.test(name)) issue(issues, "INVALID_NAME", `${path}.name`, "Variable name must be a non-empty expression identifier");
    if (!label) issue(issues, "INVALID_FIELD_TYPE", `${path}.label`, "Variable label must be non-empty");
    if (!unit) issue(issues, "INVALID_UNIT", `${path}.unit`, "Variable unit must be non-empty");
    else if (!unitName(unit)) issue(issues, "INVALID_UNIT", `${path}.unit`, `Unsupported unit ${unit}`);
    if (kind !== "input" && kind !== "computed") issue(issues, "INVALID_FIELD_TYPE", `${path}.kind`, "Variable kind must be input or computed");
    const id = raw.id === undefined ? name : text(raw.id);
    if (!id || !STABLE_ID.test(id)) issue(issues, "INVALID_ID", `${path}.id`, "Variable id must be a stable non-empty identifier");
    const lowerName = name.toLowerCase();
    if (variableNames.has(lowerName)) issue(issues, "DUPLICATE_VARIABLE", `${path}.name`, `Duplicate variable name ${name}`);
    if (variableIds.has(id.toLowerCase())) issue(issues, "DUPLICATE_VARIABLE", `${path}.id`, `Duplicate variable id ${id}`);
    variableNames.add(lowerName);
    variableIds.add(id.toLowerCase());
    if (raw.baseValue !== undefined && raw.baseValue !== null && !validNumber(raw.baseValue)) issue(issues, "INVALID_BASE_VALUE", `${path}.baseValue`, "baseValue must be a finite number");
    if (raw.baseValue === null) issue(issues, "INVALID_BASE_VALUE", `${path}.baseValue`, "baseValue cannot be null");
    if (raw.statementLine !== undefined && typeof raw.statementLine !== "string") issue(issues, "INVALID_FIELD_TYPE", `${path}.statementLine`, "statementLine must be a string when present");
    if (raw.safeRange !== undefined) {
      if (!isObject(raw.safeRange) || (raw.safeRange.min !== undefined && !validNumber(raw.safeRange.min)) || (raw.safeRange.max !== undefined && !validNumber(raw.safeRange.max))) issue(issues, "UNSAFE_VALUE", `${path}.safeRange`, "safeRange must contain finite min/max values");
      else if (validNumber(raw.safeRange.min) && validNumber(raw.safeRange.max) && raw.safeRange.min > raw.safeRange.max) issue(issues, "UNSAFE_VALUE", `${path}.safeRange`, "safeRange min cannot exceed max");
      if (validNumber(raw.baseValue) && isObject(raw.safeRange) && ((validNumber(raw.safeRange.min) && raw.baseValue < raw.safeRange.min) || (validNumber(raw.safeRange.max) && raw.baseValue > raw.safeRange.max))) issue(issues, "UNSAFE_VALUE", `${path}.baseValue`, "baseValue is outside its declared safeRange");
    }
    const variable: ForecastVariable = {
      name,
      label,
      unit,
      kind: kind === "computed" ? "computed" : "input",
      ...(validNumber(raw.baseValue) ? { baseValue: raw.baseValue } : {}),
      ...(text(raw.statementLine) ? { statementLine: text(raw.statementLine) } : {}),
      ...(text(raw.id) ? { id: text(raw.id) } : {}),
      ...(text(raw.baseFactId) ? { baseFactId: text(raw.baseFactId) } : {}),
      ...(text(raw.factId) ? { factId: text(raw.factId) } : {}),
      ...(text(raw.dimension) ? { dimension: text(raw.dimension) } : {}),
      ...(isObject(raw.safeRange) ? { safeRange: raw.safeRange as { min?: number; max?: number } } : {}),
    };
    variables.push(variable);
  });

  const variablesByName = variableMap(variables);
  const rawFormulas = Array.isArray(value.formulas) ? value.formulas : [];
  const formulas: Formula[] = [];
  const formulaIds = new Set<string>();
  const outputNames = new Set<string>();
  rawFormulas.forEach((raw, index) => {
    const path = `$.formulas[${index}]`;
    if (!isObject(raw)) {
      issue(issues, "SCHEMA_INVALID", path, "Formula must be an object");
      return;
    }
    const id = text(raw.id);
    const expression = text(raw.expression);
    const output = text(raw.output);
    if (!id || !STABLE_ID.test(id)) issue(issues, "INVALID_ID", `${path}.id`, "Formula id must be a stable non-empty identifier");
    if (formulaIds.has(id.toLowerCase())) issue(issues, "DUPLICATE_FORMULA_ID", `${path}.id`, `Duplicate formula id ${id}`);
    formulaIds.add(id.toLowerCase());
    if (!expression) issue(issues, "INVALID_EXPRESSION", `${path}.expression`, "Formula expression must be non-empty");
    if (!output || !IDENTIFIER.test(output)) issue(issues, "INVALID_NAME", `${path}.output`, "Formula output must be a valid expression identifier");
    if (outputNames.has(output.toLowerCase())) issue(issues, "DUPLICATE_OUTPUT", `${path}.output`, `Duplicate formula output ${output}`);
    outputNames.add(output.toLowerCase());
    if (typeof raw.equation !== "string" || raw.equation.trim() === "") issue(issues, "INVALID_FIELD_TYPE", `${path}.equation`, "Formula equation must be non-empty");
    if (typeof raw.explanation !== "string") issue(issues, "INVALID_FIELD_TYPE", `${path}.explanation`, "Formula explanation must be a string");
    if (typeof raw.sourceFacts !== "undefined" && !Array.isArray(raw.sourceFacts)) issue(issues, "INVALID_FIELD_TYPE", `${path}.sourceFacts`, "sourceFacts must be an array");
    if (typeof raw.confidence !== "undefined" && (!validNumber(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) issue(issues, "INVALID_CONFIDENCE", `${path}.confidence`, "Formula confidence must be finite and between 0 and 1");
    if (raw.safeRange !== undefined && (!isObject(raw.safeRange) || (raw.safeRange.min !== undefined && !validNumber(raw.safeRange.min)) || (raw.safeRange.max !== undefined && !validNumber(raw.safeRange.max)))) issue(issues, "UNSAFE_VALUE", `${path}.safeRange`, "Formula safeRange must contain finite bounds");
    else if (isObject(raw.safeRange) && validNumber(raw.safeRange.min) && validNumber(raw.safeRange.max) && raw.safeRange.min > raw.safeRange.max) issue(issues, "UNSAFE_VALUE", `${path}.safeRange`, "Formula safeRange min cannot exceed max");
    if (!Array.isArray(raw.variables) || raw.variables.some((variable) => typeof variable !== "string" || variable.trim() === "")) issue(issues, "FORMULA_VARIABLE_MISMATCH", `${path}.variables`, "Formula variables must be a non-empty string array");
    const formula: Formula = {
      id,
      equation: text(raw.equation),
      expression,
      output,
      variables: Array.isArray(raw.variables) ? raw.variables.filter((variable): variable is string => typeof variable === "string").map((variable) => variable.trim()) : [],
      explanation: text(raw.explanation),
      sourceFacts: Array.isArray(raw.sourceFacts) ? raw.sourceFacts.filter((fact): fact is string => typeof fact === "string") : [],
      confidence: validNumber(raw.confidence) ? raw.confidence : 0,
      ...(isObject(raw.safeRange) ? { safeRange: raw.safeRange as { min?: number; max?: number } } : {}),
      ...(Array.isArray(raw.sourceFactIds) ? { sourceFactIds: raw.sourceFactIds.filter((fact): fact is string => typeof fact === "string") } : {}),
      ...(Array.isArray(raw.evidenceIds) ? { evidenceIds: raw.evidenceIds.filter((fact): fact is string => typeof fact === "string") } : {}),
      ...(Array.isArray(raw.dependencies) ? { dependencies: raw.dependencies.filter((fact): fact is string => typeof fact === "string") } : {}),
      ...(raw.terminal === true ? { terminal: true } : {}),
    };
    formulas.push(formula);
    const parsed = parseExpression(expression);
    if (!parsed.ok) {
      issue(issues, "INVALID_EXPRESSION", `${path}.expression`, parsed.error);
    } else {
      const declared = new Set(formula.variables.map((variable) => priorBaseName(variable, variablesByName) ?? variable.toLowerCase()));
      const actual = new Set(parsed.variables.map((variable) => priorBaseName(variable, variablesByName) ?? variable.toLowerCase()));
      const declaredNames = new Set(formula.variables.map((variable) => variable.toLowerCase()));
      if (declared.size !== declaredNames.size || actual.size !== declared.size || [...actual].some((variable) => !declared.has(variable)) || [...declared].some((variable) => !actual.has(variable))) issue(issues, "FORMULA_VARIABLE_MISMATCH", `${path}.variables`, "Formula variables must exactly equal identifiers used by the expression");
      for (const variable of actual) if (!variableNames.has(variable)) issue(issues, "UNKNOWN_FORMULA_VARIABLE", `${path}.variables`, `Expression references undeclared variable ${variable}`);
    }
    if (variableNames.has(output.toLowerCase())) {
      const variable = variables.find((candidate) => candidate.name.toLowerCase() === output.toLowerCase());
      if (variable && variable.kind !== "computed") issue(issues, "INVALID_FIELD_TYPE", `${path}.output`, "Formula output variable must be declared as computed");
    } else {
      issue(issues, "UNKNOWN_FORMULA_VARIABLE", `${path}.output`, `Formula output ${output} is not a declared variable`);
    }
    const refs = [...formula.sourceFacts, ...(formula.sourceFactIds ?? []), ...(formula.evidenceIds ?? [])];
    validateEvidence(refs, `${path}.sourceFacts`, factPack, issues, evidenceIds, options.requireEvidence !== false);
    if (formula.dependencies) {
      for (const dependency of formula.dependencies) if (!variableNames.has(dependency.toLowerCase())) issue(issues, "UNKNOWN_DEPENDENCY", `${path}.dependencies`, `Unknown dependency ${dependency}`);
    }
  });

  for (const variable of variables) {
    if (variable.kind === "computed" && !outputNames.has(variable.name.toLowerCase())) issue(issues, "COMPUTED_VARIABLE_WITHOUT_FORMULA", `$.variables[${variable.name}]`, "Every computed variable requires a formula output");
  }
  validateBaseValues(variables, factPack, { enforceCanonicalBases: options.enforceCanonicalBases !== false, allowUnresolvedBaseValues: options.allowUnresolvedBaseValues === true }, issues);

  const dimensions = new Map<string, Record<string, number>>();
  for (const variable of variables) {
    const dimension = dimensionForUnit(variable.dimension ?? variable.unit);
    dimensions.set(variable.name.toLowerCase(), dimension);
    for (const alias of [`${variable.name}_prior`, `${variable.name}_prev`, `${variable.name}_lag1`, `prior_${variable.name}`, `previous_${variable.name}`, `prev_${variable.name}`]) dimensions.set(alias.toLowerCase(), dimension);
  }
  for (const formula of formulas) {
    const parsed = parseExpression(formula.expression);
    if (parsed.ok) {
      const outputDimension = expressionDimension(parsed.ast, dimensions);
      const declaredDimension = dimensions.get(formula.output.toLowerCase());
      if (outputDimension && declaredDimension && !dimensionsCompatible(outputDimension, declaredDimension)) issue(issues, "DIMENSION_MISMATCH", `$.formulas[${formula.id}].output`, `Output dimension does not match expression dimension`);
    }
  }

  const rawAssumptions = Array.isArray(value.assumptions) ? value.assumptions : [];
  const assumptionIds = new Set<string>();
  const assumptionVariables = new Set<string>();
  rawAssumptions.forEach((raw, index) => {
    const path = `$.assumptions[${index}]`;
    if (!isObject(raw)) {
      issue(issues, "SCHEMA_INVALID", path, "Assumption must be an object");
      return;
    }
    const id = text(raw.id);
    if (!id || !STABLE_ID.test(id)) issue(issues, "INVALID_ID", `${path}.id`, "Assumption id must be a stable non-empty identifier");
    if (assumptionIds.has(id.toLowerCase())) issue(issues, "DUPLICATE_ASSUMPTION_ID", `${path}.id`, `Duplicate assumption id ${id}`);
    assumptionIds.add(id.toLowerCase());
    const variableName = text(raw.variable);
    if (!variableName || !variablesByName.has(variableName.toLowerCase())) issue(issues, "UNKNOWN_ASSUMPTION_VARIABLE", `${path}.variable`, `Assumption references undeclared variable ${variableName}`);
    assumptionVariables.add(variableName.toLowerCase());
    if (!validNumber(raw.value)) issue(issues, "INVALID_ASSUMPTION_VALUE", `${path}.value`, "Assumption value must be finite");
    else safeValue(raw.value, text(raw.unit), variableName, issues, `${path}.value`);
    if (!text(raw.unit) || !unitName(text(raw.unit))) issue(issues, "INVALID_UNIT", `${path}.unit`, "Assumption unit is invalid");
    const assumptionVariable = variablesByName.get(variableName.toLowerCase());
    const assumptionUnit = unitName(text(raw.unit));
    const variableUnit = assumptionVariable ? unitName(assumptionVariable.unit) : "";
    const growthUnit = ["ratio", "rate", "bps", "percent", "percentage", "number", "numeric", "value"].includes(assumptionUnit);
    if (assumptionVariable && variableUnit && assumptionUnit && variableUnit !== assumptionUnit && !growthUnit) issue(issues, "UNIT_MISMATCH", `${path}.unit`, `Assumption unit ${raw.unit} is incompatible with variable unit ${assumptionVariable.unit}`);
    if (raw.safeRange !== undefined) {
      if (!isObject(raw.safeRange) || (raw.safeRange.min !== undefined && !validNumber(raw.safeRange.min)) || (raw.safeRange.max !== undefined && !validNumber(raw.safeRange.max))) issue(issues, "UNSAFE_VALUE", `${path}.safeRange`, "Assumption safeRange must contain finite bounds");
      else if (validNumber(raw.safeRange.min) && validNumber(raw.safeRange.max) && raw.safeRange.min > raw.safeRange.max) issue(issues, "UNSAFE_VALUE", `${path}.safeRange`, "Assumption safeRange min cannot exceed max");
      else if (validNumber(raw.value) && isObject(raw.safeRange) && ((validNumber(raw.safeRange.min) && raw.value < raw.safeRange.min) || (validNumber(raw.safeRange.max) && raw.value > raw.safeRange.max))) issue(issues, "UNSAFE_VALUE", `${path}.value`, "Assumption value is outside its declared safeRange");
    }
    if (!PERIOD.test(text(raw.period))) issue(issues, "INVALID_PERIOD", `${path}.period`, "Assumption period must be an annual forecast period");
    if (typeof raw.rationale !== "string" || raw.rationale.trim() === "") issue(issues, "INVALID_FIELD_TYPE", `${path}.rationale`, "Assumption rationale must be non-empty");
    if (typeof raw.historicalEvidence !== "string") issue(issues, "INVALID_FIELD_TYPE", `${path}.historicalEvidence`, "historicalEvidence must be a string");
    if (raw.confidence !== undefined && (!validNumber(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) issue(issues, "INVALID_CONFIDENCE", `${path}.confidence`, "Assumption confidence must be between 0 and 1");
    if (raw.valuePath !== undefined && raw.path !== undefined) issue(issues, "HORIZON_LENGTH_MISMATCH", `${path}.valuePath`, "Declare only one assumption path field");
    const pathValues = raw.valuePath ?? raw.path;
    if (pathValues !== undefined) {
      if (!Array.isArray(pathValues) || pathValues.length !== (validNumber(horizon) ? horizon : 0) || pathValues.some((value) => !validNumber(value))) issue(issues, "HORIZON_LENGTH_MISMATCH", `${path}.valuePath`, "Assumption path must contain one finite value per forecast year");
    }
    const refs = [...referencedEvidence(Array.isArray(raw.factIds) ? raw.factIds : []), ...referencedEvidence(Array.isArray(raw.evidenceIds) ? raw.evidenceIds : []), ...evidenceFromText(text(raw.historicalEvidence)), ...evidenceFromText(text(raw.rationale))];
    validateEvidence(refs, `${path}.evidence`, factPack, issues, evidenceIds, options.requireEvidence !== false);
  });

  const paths = isObject(value.driverPaths) ? value.driverPaths : {};
  const pathKeys = new Set<string>();
  for (const [key, rawPath] of Object.entries(paths)) {
    if (pathKeys.has(key.toLowerCase())) issue(issues, "DUPLICATE_VARIABLE", `$.driverPaths.${key}`, `Duplicate driver path key ${key}`);
    pathKeys.add(key.toLowerCase());
    const path = `$.driverPaths[${key}]`;
    if (!variablesByName.has(key.toLowerCase())) {
      issue(issues, "UNKNOWN_DRIVER_VARIABLE", path, `Driver path references undeclared variable ${key}`);
      continue;
    }
    const variable = variablesByName.get(key.toLowerCase());
    if (variable?.kind === "computed" && options.allowComputedDriverPaths !== true) issue(issues, "UNKNOWN_DRIVER_VARIABLE", path, "Computed variables cannot have driver paths");
    if (!Array.isArray(rawPath) || rawPath.length !== (validNumber(horizon) ? horizon : 0)) issue(issues, "HORIZON_LENGTH_MISMATCH", path, "Driver path length must exactly equal horizonYears");
    if (Array.isArray(rawPath)) rawPath.forEach((rate, index) => {
      if (!validNumber(rate)) issue(issues, "INVALID_DRIVER_VALUE", `${path}[${index}]`, "Driver path values must be finite numbers");
      else safeValue(rate, "ratio", `${key}Growth`, issues, `${path}[${index}]`);
    });
  }
  for (const variable of variables) {
    if (variable.kind !== "input") continue;
    const hasPath = Object.prototype.hasOwnProperty.call(paths, variable.name) || Object.prototype.hasOwnProperty.call(paths, variable.name.toLowerCase());
    if (!hasPath && !assumptionVariables.has(variable.name.toLowerCase())) issue(issues, "UNKNOWN_DRIVER_VARIABLE", `$.variables[${variable.name}]`, "Every input variable requires a driver path or a declared assumption");
  }

  const consumers = new Map<string, number>();
  for (const formula of formulas) for (const variable of formula.variables) consumers.set(variable.toLowerCase(), (consumers.get(variable.toLowerCase()) ?? 0) + 1);
  const explicitOutputs = Array.isArray(value.outputs) ? value.outputs.map((output) => text(output).toLowerCase()).filter(Boolean) : [];
  const rootOutputs = new Set(explicitOutputs);
  for (const formula of formulas) {
    const variable = variablesByName.get(formula.output.toLowerCase());
    if (knownStatementOutput(variable ?? { name: formula.output, label: formula.output, unit: "", kind: "computed" }, formula)) rootOutputs.add(formula.output.toLowerCase());
    if (!consumers.has(formula.output.toLowerCase()) && !rootOutputs.has(formula.output.toLowerCase())) issue(issues, "DISCONNECTED_OUTPUT", `$.formulas[${formula.id}].output`, `Formula output ${formula.output} is disconnected from the model`);
  }
  for (const output of explicitOutputs) if (!outputNames.has(output)) issue(issues, "UNKNOWN_FORMULA_VARIABLE", "$.outputs", `Declared output ${output} has no formula`);
  if (outputNames.size === 0) issue(issues, "EMPTY_OUTPUTS", "$.formulas", "At least one formula output is required");

  const order = topological(formulas, issues, variablesByName);
  const formulaDependencyGraph: Record<string, string[]> = {};
  for (const formula of formulas) formulaDependencyGraph[formula.id] = formula.variables.map((variable) => priorBaseName(variable, variablesByName) ?? variable).filter((variable) => outputNames.has(variable.toLowerCase())).sort();
  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");
  const valid = errors.length === 0;
  const result: ModelSpecValidationResult = {
    valid,
    ok: valid,
    blocked: !valid,
    issues,
    errors,
    warnings,
    evidenceIds: [...evidenceIds].sort(),
    dependencyGraph: order.graph,
    formulaDependencyGraph,
    topologicalOrder: order.order,
    formulaOrder: order.formulaOrder,
    spec: value as unknown as ForecastSpecification,
    normalizedSpec: value as unknown as ForecastSpecification,
  };
  return result;
}

export class ModelSpecValidationError extends Error {
  public readonly validation: ModelSpecValidationResult;
  public readonly spec?: ForecastSpecification;

  public constructor(message: string, validation: ModelSpecValidationResult) {
    super(message);
    this.name = "ModelSpecValidationError";
    this.validation = validation;
    this.spec = validation.spec;
  }
}

export function assertValidModelSpec(value: unknown, factPack?: FactPack, options: ModelSpecValidationOptions = {}): asserts value is ForecastSpecification {
  const validation = validateModelSpec(value, factPack, options);
  if (!validation.valid) {
    const codes = [...new Set(validation.errors.map((entry) => entry.code))].join(", ");
    throw new ModelSpecValidationError(`AI model specification failed validation: ${codes}`, validation);
  }
}

export interface CanonicalizeModelSpecOptions {
  fillMissingEvidence?: boolean;
}

export function canonicalizeModelSpecReferences(spec: ForecastSpecification, pack: FactPack, options: CanonicalizeModelSpecOptions = {}): ForecastSpecification {
  const fallback = factsForMetric(pack, "totalRevenue")[0] ?? factsForMetric(pack, "revenue")[0] ?? allFacts(pack).find((fact) => fact.value !== undefined);
  const canonical = (reference: string): string | undefined => canonicalFactReference(pack, reference);
  const chooseEvidence = (output: string, refs: readonly string[]): string[] => {
    const resolved = refs.map(canonical);
    if (resolved.some((value) => value === undefined)) return [...new Set(refs)];
    const validResolved = resolved.filter((value): value is string => !!value);
    if (validResolved.length > 0) return [...new Set(validResolved)];
    if (options.fillMissingEvidence !== true) return [];
    const fact = factsForMetric(pack, output)[0] ?? fallback;
    return fact?.factId ? [fact.factId] : [];
  };
  return {
    ...spec,
    variables: spec.variables.map((variable) => {
      const statementReference = variable.baseFactId ?? variable.factId ?? variable.statementLine;
      const fact = statementReference ? resolveFactReference(pack, statementReference) : factsForMetric(pack, variable.name)[0];
      return {
        ...variable,
        ...(variable.kind === "input" && fact?.factId ? { baseFactId: fact.factId } : {}),
        ...(variable.baseValue === undefined && variable.kind === "input" && fact?.value !== undefined ? { baseValue: fact.value } : {}),
      };
    }),
    formulas: spec.formulas.map((formula) => {
      const sourceFacts = chooseEvidence(formula.output, [...formula.sourceFacts, ...(formula.sourceFactIds ?? []), ...(formula.evidenceIds ?? [])]);
      return { ...formula, sourceFacts, sourceFactIds: sourceFacts, evidenceIds: sourceFacts };
    }),
    assumptions: spec.assumptions.map((assumption) => {
      const evidence = chooseEvidence(assumption.variable, [...(assumption.factIds ?? []), ...(assumption.evidenceIds ?? []), ...evidenceFromText(assumption.historicalEvidence), ...evidenceFromText(assumption.rationale)]);
      return { ...assumption, factIds: evidence, evidenceIds: evidence, historicalEvidence: evidence.length > 0 ? [...evidence, assumption.historicalEvidence].filter(Boolean).join(" ") : assumption.historicalEvidence };
    }),
  };
}

export function modelDependencyOrder(spec: ForecastSpecification): string[] {
  const issues: ModelSpecValidationIssue[] = [];
  return topological(spec.formulas, issues).formulaOrder;
}

export function formulaExpressionVariables(formula: Pick<Formula, "expression">): string[] {
  return expressionVariables(formula.expression);
}

export const validateForecastSpecification = validateModelSpec;
export const validateModel = validateModelSpec;
export const assertModelSpecValid = assertValidModelSpec;

export default { validateModelSpec, validateForecastSpecification, validateModel, assertValidModelSpec, assertModelSpecValid, ModelSpecValidationError, canonicalizeModelSpecReferences, resolveFactReference, canonicalFactReference, modelDependencyOrder, formulaExpressionVariables };
