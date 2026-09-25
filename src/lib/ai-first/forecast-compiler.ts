import type { AccountingArchitecture } from "./accounting-architecture";
import { getAccountingArchitecture, isAccountingArchitectureId, selectAccountingArchitecture } from "./accounting-architecture";
import { evalExpression } from "./model-runtime";
import { modelDependencyOrder, resolveFactReference } from "./model-spec-validator";
import type { CompanyUnderstanding, EconomicEngine, Fact, FactPack, ForecastSpecification, ForecastStatementYear, ForecastVariable, ProvenanceTier } from "./types";

export type StatementName = "incomeStatement" | "balanceSheet" | "cashFlow";

export interface ForecastCompilerInput {
  model?: ForecastSpecification;
  spec?: ForecastSpecification;
  factPack?: FactPack;
  facts?: FactPack;
  architecture?: AccountingArchitecture;
  understanding?: Partial<CompanyUnderstanding>;
  engine?: Partial<EconomicEngine>;
}

export interface CompiledStatementSet {
  period: string;
  incomeStatement: ForecastStatementYear;
  balanceSheet: ForecastStatementYear;
  cashFlow: ForecastStatementYear;
}

export interface ForecastCompilerOutput {
  years: CompiledStatementSet[];
  statements: CompiledStatementSet[];
  incomeStatement: ForecastStatementYear[];
  balanceSheet: ForecastStatementYear[];
  cashFlow: ForecastStatementYear[];
  formulaValues: Array<Record<string, number | undefined>>;
  formulaValuesByYear: Array<Record<string, number | undefined>>;
  basePeriod: string;
  baseValues: Record<string, number>;
  dependencyOrder: string[];
  architecture: AccountingArchitecture;
  blockers: string[];
  provenance: Record<string, ProvenanceTier>;
}

interface RuntimeState {
  values: Record<string, number>;
  provenance: Record<string, ProvenanceTier>;
  factIds: Record<string, string>;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function outsideSafeRange(value: number, range: { min?: number; max?: number } | undefined): boolean {
  return !!range && ((range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max));
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function periodScore(period: string | undefined): number {
  if (!period) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(period);
  if (Number.isFinite(parsed)) return parsed;
  const year = period.match(/(?:19|20)\d{2}/)?.[0];
  return year ? Number(year) : Number.NEGATIVE_INFINITY;
}

function factPeriod(fact: Fact): string {
  return fact.reportingPeriod ?? fact.fiscalPeriod ?? fact.period;
}

function allFacts(pack: FactPack): Fact[] {
  return [
    ...pack.incomeStatement.facts,
    ...pack.balanceSheet.facts,
    ...pack.cashFlow.facts,
    ...pack.market.facts,
    ...pack.shares.facts,
  ];
}

function latestFacts(pack: FactPack): Fact[] {
  const byMetric = new Map<string, Fact>();
  for (const fact of allFacts(pack)) {
    if (!finite(fact.value)) continue;
    const key = normalized(fact.metric);
    const previous = byMetric.get(key);
    if (!previous || periodScore(factPeriod(fact)) > periodScore(factPeriod(previous)) || (periodScore(factPeriod(fact)) === periodScore(factPeriod(previous)) && (fact.factId ?? "").localeCompare(previous.factId ?? "") > 0)) byMetric.set(key, fact);
  }
  return [...byMetric.values()];
}

function metricFact(facts: readonly Fact[], names: readonly string[]): Fact | undefined {
  const wanted = new Set(names.map(normalized));
  const exact = facts.filter((fact) => wanted.has(normalized(fact.metric))).sort((left, right) => periodScore(factPeriod(right)) - periodScore(factPeriod(left)) || (right.factId ?? "").localeCompare(left.factId ?? ""));
  if (exact[0]) return exact[0];
  const aliases: Record<string, string[]> = {
    revenue: ["totalrevenue", "revenue"],
    totalrevenue: ["totalrevenue", "revenue"],
    grossprofit: ["grossprofit"],
    ebit: ["operatingincome", "ebit"],
    operatingincome: ["operatingincome", "ebit"],
    pbt: ["pretaxincome", "pbt"],
    pretaxincome: ["pretaxincome", "pbt"],
    netincome: ["netincome"],
    cash: ["cash", "cashandcashequivalents", "cashcashandcashequivalents"],
    totalassets: ["totalassets", "assets"],
    totalliabilities: ["totalliabilities", "liabilities"],
    totalequity: ["totalequity", "stockholdersequity", "equity"],
    totaldebt: ["totaldebt", "debt"],
    debt: ["totaldebt", "debt"],
    ppe: ["propertyplantandequipment", "propertyplantandequipmentnet", "ppe"],
    cfo: ["totalcashfromoperatingactivities", "operatingcashflow", "cfo"],
    cfi: ["totalcashfrominvestingactivities", "investingcashflow", "cfi"],
    cff: ["totalcashfromfinancingactivities", "financingcashflow", "cff"],
    capex: ["capitalexpenditures", "capitalexpenditure", "capex"],
  };
  for (const name of names) {
    const candidates = facts.filter((fact) => (aliases[normalized(name)] ?? [normalized(name)]).includes(normalized(fact.metric))).sort((left, right) => periodScore(factPeriod(right)) - periodScore(factPeriod(left)) || (right.factId ?? "").localeCompare(left.factId ?? ""));
    if (candidates[0]) return candidates[0];
  }
  return undefined;
}

function setValue(state: RuntimeState, name: string, value: number | undefined, provenance: ProvenanceTier, factId?: string): void {
  if (!finite(value)) return;
  state.values[name] = value;
  state.provenance[name] = provenance;
  if (factId) state.factIds[name] = factId;
}

function getValue(state: RuntimeState, names: readonly string[]): number | undefined {
  for (const name of names) {
    const direct = state.values[name];
    if (finite(direct)) return direct;
    const lower = name.toLowerCase();
    const key = Object.keys(state.values).find((candidate) => candidate.toLowerCase() === lower);
    if (key && finite(state.values[key])) return state.values[key];
  }
  return undefined;
}

function cloneState(state: RuntimeState): RuntimeState {
  return { values: { ...state.values }, provenance: { ...state.provenance }, factIds: { ...state.factIds } };
}

function addPriorAliases(target: Record<string, number>, previous: RuntimeState): void {
  for (const [name, value] of Object.entries(previous.values)) {
    if (!finite(value)) continue;
    target[`${name}_prior`] = value;
    target[`${name}_prev`] = value;
    target[`${name}_lag1`] = value;
    target[`prior_${name}`] = value;
    const capitalized = name.length === 0 ? name : `${name[0].toUpperCase()}${name.slice(1)}`;
    target[`prior${capitalized}`] = value;
    target[`previous${capitalized}`] = value;
    target[`prev${capitalized}`] = value;
    target[`${name}Lag1`] = value;
  }
}

function statementNameForVariable(variable: ForecastVariable): StatementName | undefined {
  if (variable.statement) return variable.statement;
  const text = `${variable.statementLine ?? ""} ${variable.name}`.toLowerCase();
  if (/asset|liabil|equity|debt|cash(?!flow)|receiv|inventory|payable|retained|ppe|property/.test(text)) return "balanceSheet";
  if (/cash|cfo|cfi|cff|capitalexpend|workingcapital|depreciation|dividend|financing|investing/.test(text)) return "cashFlow";
  if (/revenue|income|profit|ebit|tax|interest|margin|expense|cost|gross/.test(text)) return "incomeStatement";
  if (text.trim().length > 0) return "incomeStatement";
  return undefined;
}

function addStatementValue(target: ForecastStatementYear, key: string, value: number | undefined, provenance: ProvenanceTier, factId?: string): void {
  if (!finite(value)) {
    if (!(key in target.values)) {
      target.values[key] = undefined;
      target.explicitValues = { ...(target.explicitValues ?? {}), [key]: null };
      target.nullableValues = { ...(target.nullableValues ?? {}), [key]: null };
      target.missing = [...(target.missing ?? []), key];
      target.missingValues = [...(target.missingValues ?? []), key];
      target.nullValues = [...(target.nullValues ?? []), key];
    }
    return;
  }
  target.values[key] = value;
  target.provenance[key] = provenance;
  target.explicitValues = { ...(target.explicitValues ?? {}), [key]: value };
  target.nullableValues = { ...(target.nullableValues ?? {}), [key]: value };
}

function statementYear(period: string, values: Record<string, number | undefined>, provenance: Record<string, ProvenanceTier>, factIds: Record<string, string>, keys: readonly string[]): ForecastStatementYear {
  const selectedValues: Record<string, number | undefined> = {};
  const selectedProvenance: Record<string, ProvenanceTier> = {};
  const selectedFactIds: Record<string, string> = {};
  const explicitValues: Record<string, number | null> = {};
  const missing: string[] = [];
  for (const key of keys) {
    const value = values[key];
    if (finite(value)) {
      selectedValues[key] = value;
      selectedProvenance[key] = provenance[key] ?? "derived";
      explicitValues[key] = value;
      if (factIds[key]) selectedFactIds[key] = factIds[key];
    } else {
      selectedValues[key] = undefined;
      explicitValues[key] = null;
      missing.push(key);
    }
  }
  return { period, values: selectedValues, provenance: selectedProvenance, missing, missingValues: [...missing], nullValues: [...missing], explicitValues, nullableValues: { ...explicitValues }, factIds: selectedFactIds };
}

function nextPeriod(basePeriod: string, offset: number): string {
  const match = basePeriod.match(/(?:FY\s*)?((?:19|20)\d{2})/i);
  if (!match) return `FY${new Date().getUTCFullYear() + offset}`;
  const year = Number(match[1]) + offset;
  return `FY${year}`;
}

function basePeriodFromFacts(facts: readonly Fact[]): string {
  const dated = facts.filter((fact) => finite(fact.value) && fact.period !== "current" && Number.isFinite(periodScore(factPeriod(fact))));
  const latest = dated.sort((left, right) => periodScore(factPeriod(right)) - periodScore(factPeriod(left)) || (right.factId ?? "").localeCompare(left.factId ?? ""))[0];
  return latest ? factPeriod(latest) : "current";
}

function inputPath(spec: ForecastSpecification, variable: ForecastVariable): { values: number[]; cumulative: boolean } | undefined {
  const direct = spec.driverPaths[variable.name] ?? Object.entries(spec.driverPaths).find(([key]) => key.toLowerCase() === variable.name.toLowerCase())?.[1];
  if (Array.isArray(direct) && direct.length === spec.horizonYears && direct.every(finite)) return { values: direct, cumulative: true };
  const assumption = spec.assumptions.find((candidate) => candidate.variable.toLowerCase() === variable.name.toLowerCase() && Array.isArray(candidate.valuePath ?? candidate.path));
  const path = assumption?.valuePath ?? assumption?.path;
  if (!Array.isArray(path) || path.length !== spec.horizonYears || !path.every(finite)) return undefined;
  const unit = assumption?.unit.toLowerCase() ?? "";
  const cumulative = unit === "%" || unit === "percent" || unit === "rate";
  return { values: path, cumulative };
}

function scalarAssumption(spec: ForecastSpecification, variable: ForecastVariable): ForecastSpecification["assumptions"][number] | undefined {
  return spec.assumptions.find((candidate) => candidate.variable.toLowerCase() === variable.name.toLowerCase());
}

function applyInput(spec: ForecastSpecification, variable: ForecastVariable, state: RuntimeState, environment: Record<string, number>, yearIndex: number, previousBase: number | undefined, blockers: string[]): number | undefined {
  const base = finite(variable.baseValue) ? variable.baseValue : getValue(state, [variable.name, variable.statementLine ?? ""]);
  const path = inputPath(spec, variable);
  if (path) {
    if (!path.cumulative) {
      const value = path.values[yearIndex];
      environment[variable.name] = value;
      state.values[variable.name] = value;
      state.provenance[variable.name] = "assumption";
      return value;
    }
    if (!finite(base)) {
      blockers.push(`Missing base value for input variable ${variable.name}`);
      return undefined;
    }
    let value = base;
    for (let index = 0; index <= yearIndex; index += 1) value *= 1 + path.values[index];
    environment[variable.name] = value;
    state.values[variable.name] = value;
    state.provenance[variable.name] = "forecast";
    state.provenance[`${variable.name}_growth`] = "assumption";
    environment[`${variable.name}_growth`] = path.values[yearIndex];
    return value;
  }
  const assumption = scalarAssumption(spec, variable);
  if (assumption && finite(assumption.value)) {
    const unit = assumption.unit.toLowerCase();
    if (unit === "%" || unit === "percent" || unit === "rate") {
      if (!finite(base)) {
        blockers.push(`Missing base value for growth assumption ${variable.name}`);
        return undefined;
      }
      let value = base;
      for (let index = 0; index <= yearIndex; index += 1) value *= 1 + assumption.value;
      environment[variable.name] = value;
      state.values[variable.name] = value;
      state.provenance[variable.name] = "forecast";
      state.provenance[`${variable.name}_growth`] = "assumption";
      environment[`${variable.name}_growth`] = assumption.value;
      return value;
    }
    environment[variable.name] = assumption.value;
    state.values[variable.name] = assumption.value;
    state.provenance[variable.name] = "assumption";
    return assumption.value;
  }
  if (finite(previousBase)) {
    environment[variable.name] = previousBase;
    state.values[variable.name] = previousBase;
    state.provenance[variable.name] = "forecast";
    return previousBase;
  }
  if (finite(base)) {
    environment[variable.name] = base;
    state.values[variable.name] = base;
    state.provenance[variable.name] = state.provenance[variable.name] ?? "fact";
    return base;
  }
  blockers.push(`No base value or forecast path for input variable ${variable.name}`);
  return undefined;
}

function formulaOrder(spec: ForecastSpecification): string[] {
  return modelDependencyOrder(spec);
}

function evaluateFormulas(spec: ForecastSpecification, state: RuntimeState, environment: Record<string, number>, period: string, blockers: string[]): Record<string, number | undefined> {
  const byId = new Map(spec.formulas.map((formula) => [formula.id, formula]));
  const results: Record<string, number | undefined> = {};
  for (const id of formulaOrder(spec)) {
    const formula = byId.get(id);
    if (!formula) continue;
    const evaluated = evalExpression(formula.expression, environment);
    if (!evaluated.ok) {
      results[formula.id] = undefined;
      blockers.push(`${period}: formula ${formula.id} failed: ${evaluated.error}`);
      continue;
    }
    results[formula.id] = evaluated.value;
    environment[formula.output] = evaluated.value;
    state.values[formula.output] = evaluated.value;
    state.provenance[formula.output] = "forecast";
  }
  for (const formula of spec.formulas) if (!(formula.id in results)) results[formula.id] = undefined;
  return results;
}

function integrateStatementValues(state: RuntimeState, previous: RuntimeState, environment: Record<string, number>): void {
  const get = (names: readonly string[]): number | undefined => getValue(state, names);
  const set = (name: string, value: number | undefined, provenance: ProvenanceTier = "derived"): void => setValue(state, name, value, provenance);
  const revenue = get(["revenue", "totalRevenue"]);
  const grossProfit = get(["grossProfit"]);
  const ebit = get(["ebit", "operatingIncome"]);
  const pbt = get(["pbt", "pretaxIncome"]);
  const netIncome = get(["netIncome"]);
  const tax = get(["tax"]);
  const totalOpex = get(["totalOpex", "operatingExpenses"]);
  if (grossProfit !== undefined && ebit !== undefined && totalOpex === undefined) set("totalOpex", grossProfit - ebit);
  if (pbt !== undefined && netIncome !== undefined && tax === undefined) set("tax", pbt - netIncome);
  const netInterest = get(["netInterest", "netInterestIncome"]);
  if (ebit !== undefined && pbt !== undefined && netInterest === undefined) set("netInterest", ebit - pbt);
  const cash = get(["cash", "cashAndCashEquivalents"]);
  const cfo = get(["cfo", "operatingCashFlow", "totalCashFromOperatingActivities"]);
  const cfi = get(["cfi", "investingCashFlow", "totalCashFromInvestingActivities"]);
  const cff = get(["cff", "financingCashFlow", "totalCashFromFinancingActivities"]);
  const capex = get(["capex", "capitalExpenditures", "capitalExpenditure"]);
  const cashOpen = getValue(previous, ["cashClose", "cash", "cashAndCashEquivalents"]) ?? get(["cashOpen"]);
  if (cashOpen !== undefined) set("cashOpen", cashOpen);
  if (cfo !== undefined && get(["cfo"]) === undefined) set("cfo", cfo, "derived");
  if (cfi !== undefined && get(["cfi"]) === undefined) set("cfi", cfi, "derived");
  if (cff !== undefined && get(["cff"]) === undefined) set("cff", cff, "derived");
  if (capex !== undefined && get(["capex"]) === undefined) set("capex", capex, "derived");
  if (get(["depreciation"]) === undefined && get(["depreciationAndAmortization"]) !== undefined) set("depreciation", get(["depreciationAndAmortization"]), "derived");
  if (get(["dividendsPaid"]) === undefined && get(["dividends"]) !== undefined) set("dividendsPaid", get(["dividends"]), "derived");
  if (cfi === undefined && capex !== undefined) set("cfi", -Math.abs(capex), "derived");
  if (cff === undefined) {
    const debtIssuance = get(["debtIssuance"]);
    const debtRepayment = get(["debtRepayment"]);
    const equityIssuance = get(["equityIssuance"]);
    const dividendsPaid = get(["dividendsPaid", "dividends"]);
    if (debtIssuance !== undefined && debtRepayment !== undefined && equityIssuance !== undefined && dividendsPaid !== undefined) set("cff", debtIssuance - debtRepayment + equityIssuance - dividendsPaid, "derived");
  }
  const cashClose = get(["cashClose"]);
  const finalCfo = get(["cfo", "operatingCashFlow", "totalCashFromOperatingActivities"]);
  const finalCfi = get(["cfi", "investingCashFlow", "totalCashFromInvestingActivities"]);
  const finalCff = get(["cff", "financingCashFlow", "totalCashFromFinancingActivities"]);
  if (cashClose === undefined && cashOpen !== undefined && finalCfo !== undefined && finalCfi !== undefined && finalCff !== undefined) set("cashClose", cashOpen + finalCfo + finalCfi + finalCff, "derived");
  if (get(["cash"]) === undefined || get(["cash"]) === get(["cashOpen"])) {
    const close = get(["cashClose"]);
    if (close !== undefined) set("cash", close, "derived");
  }
  const previousRetained = getValue(previous, ["retainedEarnings", "retainedEarningsBalance"]);
  const dividends = get(["dividendsPaid", "dividends"]);
  if (get(["retainedEarnings"]) === undefined && previousRetained !== undefined && get(["netIncome"]) !== undefined && dividends !== undefined) set("retainedEarnings", previousRetained + get(["netIncome"])! - dividends);
  const previousEquity = getValue(previous, ["totalEquity", "stockholdersEquity", "equity"]);
  const currentEquity = get(["totalEquity", "stockholdersEquity", "equity"]);
  const equityIssuance = get(["equityIssuance"]);
  if (currentEquity === undefined && previousEquity !== undefined) {
    if (get(["netIncome"]) !== undefined && dividends !== undefined && equityIssuance !== undefined) set("totalEquity", previousEquity + get(["netIncome"])! - dividends + equityIssuance);
    else if (get(["netIncome"]) !== undefined && dividends !== undefined) set("totalEquity", previousEquity + get(["netIncome"])! - dividends, "derived");
    else set("totalEquity", previousEquity, "forecast");
  }
  const previousDebt = getValue(previous, ["totalDebt", "debt"]);
  const currentDebt = get(["totalDebt", "debt"]);
  const debtIssuance = get(["debtIssuance"]);
  const debtRepayment = get(["debtRepayment"]);
  if (currentDebt === undefined && previousDebt !== undefined) {
    if (debtIssuance !== undefined && debtRepayment !== undefined) set("totalDebt", previousDebt + debtIssuance - debtRepayment, "derived");
    else set("totalDebt", previousDebt, "forecast");
  }
  const previousPpe = getValue(previous, ["ppe", "propertyPlantEquipment"]);
  const currentPpe = get(["ppe", "propertyPlantEquipment"]);
  const depreciation = get(["depreciation", "depreciationAndAmortization"]);
  if (currentPpe === undefined && previousPpe !== undefined) {
    if (capex !== undefined && depreciation !== undefined) set("ppe", previousPpe + Math.abs(capex) - Math.abs(depreciation), "derived");
    else set("ppe", previousPpe, "forecast");
  }
  if (get(["workingCapital"]) === undefined) {
    const receivables = get(["accountsReceivable", "receivables"]);
    const inventoryValue = get(["inventory"]);
    const payables = get(["accountsPayable", "payables"]);
    if (receivables !== undefined && inventoryValue !== undefined && payables !== undefined) set("workingCapital", receivables + inventoryValue - payables, "derived");
    else {
      const priorWorkingCapital = getValue(previous, ["workingCapital"]);
      if (priorWorkingCapital !== undefined) set("workingCapital", priorWorkingCapital, "forecast");
    }
  }
  const totalDebtValue = get(["totalDebt", "debt"]);
  const cashValue = get(["cash", "cashAndCashEquivalents"]);
  if (get(["netDebt"]) === undefined && totalDebtValue !== undefined && cashValue !== undefined) set("netDebt", totalDebtValue - cashValue, "derived");
  const assets = get(["totalAssets", "assets"]);
  const liabilities = get(["totalLiabilities", "liabilities"]);
  const equity = get(["totalEquity", "stockholdersEquity", "equity"]);
  if (assets !== undefined && equity !== undefined && liabilities === undefined) set("totalLiabilities", assets - equity, "derived");
  else if (assets !== undefined && liabilities !== undefined && equity === undefined) set("totalEquity", assets - liabilities, "derived");
  const finalCashClose = get(["cashClose"]);
  if (finalCashClose !== undefined) environment.cashClose = finalCashClose;
}

function buildStatementYear(period: string, state: RuntimeState, keys: readonly string[]): ForecastStatementYear {
  return statementYear(period, state.values, state.provenance, state.factIds, keys);
}

function buildCompilerInput(modelOrInput: ForecastCompilerInput | ForecastSpecification, factPack?: FactPack, architecture?: AccountingArchitecture): ForecastCompilerInput {
  if ("model" in modelOrInput || "spec" in modelOrInput) {
    const model = modelOrInput.model ?? modelOrInput.spec;
    const pack = modelOrInput.factPack ?? modelOrInput.facts;
    if (!model || !pack) throw new TypeError("A model and fact pack are required to compile a forecast");
    return { ...modelOrInput, model, factPack: pack, architecture: modelOrInput.architecture ?? architecture };
  }
  if (!factPack) throw new TypeError("A fact pack is required to compile a forecast");
  return { model: modelOrInput as ForecastSpecification, factPack, architecture };
}

export function compileForecast(input: ForecastCompilerInput): ForecastCompilerOutput;
export function compileForecast(model: ForecastSpecification, factPack: FactPack, architecture?: AccountingArchitecture): ForecastCompilerOutput;
export function compileForecast(modelOrInput: ForecastCompilerInput | ForecastSpecification, factPack?: FactPack, architecture?: AccountingArchitecture): ForecastCompilerOutput {
  const input = buildCompilerInput(modelOrInput, factPack, architecture);
  const model = input.model;
  const pack = input.factPack;
  if (!model || !pack) throw new TypeError("A model and fact pack are required to compile a forecast");
  const facts = latestFacts(pack);
  const basePeriod = basePeriodFromFacts(facts);
  const selectedArchitecture = input.architecture ?? (model.architecture && isAccountingArchitectureId(model.architecture) ? getAccountingArchitecture(model.architecture) : selectAccountingArchitecture({ understanding: input.understanding, engine: input.engine, factPack: pack }));
  const base: RuntimeState = { values: {}, provenance: {}, factIds: {} };
  for (const fact of facts) {
    setValue(base, fact.metric, fact.value, "fact", fact.factId);
    const normalizedMetric = normalized(fact.metric);
    if (normalizedMetric === "totalrevenue" && base.values.revenue === undefined) setValue(base, "revenue", fact.value, "fact", fact.factId);
    if (normalizedMetric === "stockholdersequity" && base.values.totalEquity === undefined) setValue(base, "totalEquity", fact.value, "fact", fact.factId);
    if (normalizedMetric === "operatingincome" && base.values.ebit === undefined) setValue(base, "ebit", fact.value, "fact", fact.factId);
    if (normalizedMetric === "pretaxincome" && base.values.pbt === undefined) setValue(base, "pbt", fact.value, "fact", fact.factId);
    if (normalizedMetric === "propertyplantandequipment" && base.values.ppe === undefined) setValue(base, "ppe", fact.value, "fact", fact.factId);
  }
  for (const variable of model.variables) {
    const declaredBase = finite(variable.baseValue) ? variable.baseValue : undefined;
    const fact = resolveFactReference(pack, variable.baseFactId ?? variable.factId) ?? metricFact(facts, [variable.statementLine ?? "", variable.name]);
    if (declaredBase !== undefined) setValue(base, variable.name, declaredBase, fact ? "fact" : "derived", fact?.factId);
    else if (fact?.value !== undefined) setValue(base, variable.name, fact.value, "fact", fact.factId);
  }
  const years: CompiledStatementSet[] = [];
  const formulaValues: Array<Record<string, number | undefined>> = [];
  const blockers: string[] = [];
  let previousState = cloneState(base);
  for (let yearIndex = 0; yearIndex < model.horizonYears; yearIndex += 1) {
    const period = nextPeriod(basePeriod, yearIndex + 1);
    const state = cloneState(previousState);
    delete state.values.cashOpen;
    delete state.provenance.cashOpen;
    delete state.factIds.cashOpen;
    delete state.values.cashClose;
    delete state.provenance.cashClose;
    delete state.factIds.cashClose;
    const environment: Record<string, number> = { ...state.values };
    addPriorAliases(environment, previousState);
    for (const variable of model.variables) {
      if (variable.kind !== "input") continue;
      const priorInput = getValue(previousState, [variable.name]);
      applyInput(model, variable, state, environment, yearIndex, priorInput, blockers);
    }
    const formulaResult = evaluateFormulas(model, state, environment, period, blockers);
    formulaValues.push(formulaResult);
    integrateStatementValues(state, previousState, environment);
    const incomeKeys = ["revenue", "grossProfit", "ebit", "pbt", "netIncome", "tax", "totalOpex", "netInterest"];
    const balanceKeys = ["totalAssets", "totalLiabilities", "totalEquity", "cash", "totalDebt", "retainedEarnings", "workingCapital", "ppe", "netDebt"];
    const cashKeys = ["cash", "cfo", "cfi", "cff", "cashOpen", "cashClose", "capex", "depreciation", "dividendsPaid", "debtIssuance", "debtRepayment", "equityIssuance"];
    const income = buildStatementYear(period, state, incomeKeys);
    const balance = buildStatementYear(period, state, balanceKeys);
    const cashFlow = buildStatementYear(period, state, cashKeys);
    for (const variable of model.variables) {
      const statement = statementNameForVariable(variable);
      if (!statement) continue;
      const target = statement === "incomeStatement" ? income : statement === "balanceSheet" ? balance : cashFlow;
      addStatementValue(target, variable.name, state.values[variable.name], state.provenance[variable.name] ?? "forecast", state.factIds[variable.name]);
    }
    for (const formula of model.formulas) {
      const statement = formula.statement ?? (statementNameForVariable(model.variables.find((variable) => variable.name.toLowerCase() === formula.output.toLowerCase()) ?? { name: formula.output, label: formula.output, unit: "", kind: "computed" }));
      if (!statement) continue;
      const target = statement === "incomeStatement" ? income : statement === "balanceSheet" ? balance : cashFlow;
      addStatementValue(target, formula.output, state.values[formula.output], "forecast");
    }
    years.push({ period, incomeStatement: income, balanceSheet: balance, cashFlow });
    previousState = cloneState(state);
  }
  const provenance: Record<string, ProvenanceTier> = { ...base.provenance };
  for (const year of years) Object.assign(provenance, year.incomeStatement.provenance, year.balanceSheet.provenance, year.cashFlow.provenance);
  const incomeStatement = years.map((year) => year.incomeStatement);
  const balanceSheet = years.map((year) => year.balanceSheet);
  const cashFlow = years.map((year) => year.cashFlow);
  return { years, statements: years, incomeStatement, balanceSheet, cashFlow, formulaValues, formulaValuesByYear: formulaValues, basePeriod, baseValues: { ...base.values }, dependencyOrder: formulaOrder(model), architecture: selectedArchitecture, blockers: [...new Set(blockers)], provenance };
}

export class ForecastCompiler {
  private readonly input: ForecastCompilerInput;

  public constructor(input: ForecastCompilerInput | ForecastSpecification, factPack?: FactPack, architecture?: AccountingArchitecture) {
    this.input = buildCompilerInput(input, factPack, architecture);
  }

  public compile(): ForecastCompilerOutput {
    return compileForecast(this.input);
  }
}

export const compileModelForecast = compileForecast;
export const compileModel = compileForecast;
export const compileForecastStatements = compileForecast;

export default { compileForecast, compileModelForecast, compileModel, compileForecastStatements, ForecastCompiler };
