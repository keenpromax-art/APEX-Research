import type { CompanyUnderstanding, EconomicEngine, FactPack } from "./types";

export type AccountingArchitectureId = "corporate" | "depository" | "insurance" | "reit" | "fee_based" | "conglomerate";

export type StatementModel = "operating" | "balance_sheet" | "flow" | "asset_manager" | "real_estate" | "segmented";

export interface AccountingIdentityRule {
  id: string;
  statement: "incomeStatement" | "balanceSheet" | "cashFlow";
  expression: string;
  requiredLines: readonly string[];
  critical: boolean;
}

export interface AccountingArchitecture {
  id: AccountingArchitectureId;
  kind: AccountingArchitectureId;
  family: AccountingArchitectureId;
  name: string;
  statementModel: StatementModel;
  statementType: StatementModel;
  primaryStatement: "incomeStatement" | "balanceSheet" | "cashFlow";
  requiredLines: readonly string[];
  requiredFacts: readonly string[];
  optionalLines: readonly string[];
  identityRules: readonly AccountingIdentityRule[];
  identitySet: readonly string[];
  rollForwardLines: readonly string[];
  supportsCashFlow: boolean;
  supportsDebtEquity: boolean;
  supportsWorkingCapital: boolean;
  supportsPPE: boolean;
  evidence: readonly string[];
  score: number;
  confidence: number;
  reason: string;
}

export interface AccountingArchitectureInput {
  understanding?: Partial<CompanyUnderstanding>;
  engine?: Partial<EconomicEngine>;
  factPack?: FactPack;
  facts?: FactPack;
  economicEvidence?: readonly string[];
  declaredArchitecture?: AccountingArchitectureId;
  evidence?: readonly string[];
  architectureEvidence?: readonly string[];
}

const contracts: Record<AccountingArchitectureId, Omit<AccountingArchitecture, "evidence" | "score" | "confidence" | "reason" | "family" | "statementType" | "requiredFacts" | "identitySet">> = {
  corporate: {
    id: "corporate",
    kind: "corporate",
    name: "Corporate operating model",
    statementModel: "operating",
    primaryStatement: "incomeStatement",
    requiredLines: ["revenue", "netIncome"],
    optionalLines: ["grossProfit", "ebit", "pbt", "tax", "totalOpex", "cfo", "capex", "totalAssets", "totalLiabilities", "totalEquity", "workingCapital", "ppe"],
    identityRules: [
      { id: "income-chain", statement: "incomeStatement", expression: "revenue - costs = ebit; ebit - tax = netIncome", requiredLines: ["revenue", "ebit", "netIncome"], critical: true },
      { id: "balance-closure", statement: "balanceSheet", expression: "assets = liabilities + equity", requiredLines: ["totalAssets", "totalLiabilities", "totalEquity"], critical: true },
      { id: "cash-closure", statement: "cashFlow", expression: "cashClose = cashOpen + cfo + cfi + cff", requiredLines: ["cashOpen", "cfo", "cfi", "cff", "cashClose"], critical: true },
    ],
    rollForwardLines: ["cash", "totalDebt", "totalEquity", "retainedEarnings", "workingCapital", "ppe"],
    supportsCashFlow: true,
    supportsDebtEquity: true,
    supportsWorkingCapital: true,
    supportsPPE: true,
  },
  depository: {
    id: "depository",
    kind: "depository",
    name: "Depository balance-sheet model",
    statementModel: "balance_sheet",
    primaryStatement: "balanceSheet",
    requiredLines: ["totalAssets", "totalLiabilities", "totalEquity", "interestIncome", "interestExpense", "netInterestIncome"],
    optionalLines: ["deposits", "loans", "advances", "netInterestMargin", "creditCost", "cash", "totalDebt", "retainedEarnings"],
    identityRules: [
      { id: "net-interest-income", statement: "incomeStatement", expression: "interestIncome - interestExpense = netInterestIncome", requiredLines: ["interestIncome", "interestExpense", "netInterestIncome"], critical: true },
      { id: "balance-closure", statement: "balanceSheet", expression: "assets = liabilities + equity", requiredLines: ["totalAssets", "totalLiabilities", "totalEquity"], critical: true },
    ],
    rollForwardLines: ["cash", "deposits", "loans", "advances", "totalDebt", "totalEquity", "retainedEarnings"],
    supportsCashFlow: false,
    supportsDebtEquity: true,
    supportsWorkingCapital: false,
    supportsPPE: false,
  },
  insurance: {
    id: "insurance",
    kind: "insurance",
    name: "Insurance underwriting and balance-sheet model",
    statementModel: "balance_sheet",
    primaryStatement: "balanceSheet",
    requiredLines: ["totalAssets", "totalLiabilities", "totalEquity", "premiums", "claims"],
    optionalLines: ["underwritingIncome", "lossRatio", "combinedRatio", "policyholderFunds", "reinsurance", "netIncome"],
    identityRules: [
      { id: "insurance-balance-closure", statement: "balanceSheet", expression: "assets = liabilities + equity", requiredLines: ["totalAssets", "totalLiabilities", "totalEquity"], critical: true },
      { id: "underwriting-result", statement: "incomeStatement", expression: "premiums - claims = underwriting result", requiredLines: ["premiums", "claims", "underwritingIncome"], critical: false },
    ],
    rollForwardLines: ["cash", "policyholderFunds", "totalDebt", "totalEquity", "retainedEarnings"],
    supportsCashFlow: false,
    supportsDebtEquity: true,
    supportsWorkingCapital: false,
    supportsPPE: false,
  },
  reit: {
    id: "reit",
    kind: "reit",
    name: "Real-estate operating model",
    statementModel: "real_estate",
    primaryStatement: "incomeStatement",
    requiredLines: ["revenue", "netIncome", "rentalIncome", "properties"],
    optionalLines: ["occupancy", "revpar", "noi", "fundsFromOperations", "totalAssets", "totalLiabilities", "totalEquity", "ppe"],
    identityRules: [
      { id: "property-closure", statement: "balanceSheet", expression: "assets = liabilities + equity", requiredLines: ["totalAssets", "totalLiabilities", "totalEquity"], critical: true },
      { id: "rental-result", statement: "incomeStatement", expression: "rental income - property operating costs = property result", requiredLines: ["rentalIncome", "propertyOperatingCosts", "noi"], critical: false },
    ],
    rollForwardLines: ["cash", "properties", "ppe", "totalDebt", "totalEquity", "retainedEarnings"],
    supportsCashFlow: true,
    supportsDebtEquity: true,
    supportsWorkingCapital: false,
    supportsPPE: true,
  },
  fee_based: {
    id: "fee_based",
    kind: "fee_based",
    name: "Fee and asset-management model",
    statementModel: "asset_manager",
    primaryStatement: "incomeStatement",
    requiredLines: ["revenue", "feeRevenue", "netIncome"],
    optionalLines: ["aum", "feeRate", "assetsUnderManagement", "takeRate", "advisoryRevenue", "commissionRevenue", "totalAssets", "totalEquity"],
    identityRules: [
      { id: "fee-result", statement: "incomeStatement", expression: "fee revenue - operating expense = operating result", requiredLines: ["feeRevenue", "operatingExpenses", "operatingIncome"], critical: false },
      { id: "balance-closure", statement: "balanceSheet", expression: "assets = liabilities + equity", requiredLines: ["totalAssets", "totalLiabilities", "totalEquity"], critical: true },
    ],
    rollForwardLines: ["cash", "totalDebt", "totalEquity", "retainedEarnings"],
    supportsCashFlow: true,
    supportsDebtEquity: true,
    supportsWorkingCapital: false,
    supportsPPE: false,
  },
  conglomerate: {
    id: "conglomerate",
    kind: "conglomerate",
    name: "Segmented conglomerate model",
    statementModel: "segmented",
    primaryStatement: "incomeStatement",
    requiredLines: ["revenue", "netIncome"],
    optionalLines: ["segmentRevenue", "segmentOperatingIncome", "totalAssets", "totalLiabilities", "totalEquity", "cash", "totalDebt", "retainedEarnings"],
    identityRules: [
      { id: "segment-revenue-closure", statement: "incomeStatement", expression: "sum(segment revenue) = consolidated revenue", requiredLines: ["revenue", "segmentRevenue"], critical: false },
      { id: "balance-closure", statement: "balanceSheet", expression: "assets = liabilities + equity", requiredLines: ["totalAssets", "totalLiabilities", "totalEquity"], critical: true },
      { id: "cash-closure", statement: "cashFlow", expression: "cashClose = cashOpen + cfo + cfi + cff", requiredLines: ["cashOpen", "cfo", "cfi", "cff", "cashClose"], critical: true },
    ],
    rollForwardLines: ["cash", "totalDebt", "totalEquity", "retainedEarnings", "workingCapital", "ppe"],
    supportsCashFlow: true,
    supportsDebtEquity: true,
    supportsWorkingCapital: true,
    supportsPPE: true,
  },
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function evidenceText(input: AccountingArchitectureInput): string {
  const values: string[] = [];
  values.push(...(input.evidence ?? []).map(textOf), ...(input.economicEvidence ?? []).map(textOf), ...(input.architectureEvidence ?? []).map(textOf));
  const understanding = input.understanding;
  if (understanding) {
    values.push(textOf(understanding.whatItDoes), textOf(understanding.howItMakesMoney), textOf(understanding.primaryEconomicAbstraction));
    values.push(...(understanding.economicUnits ?? []).map(textOf));
    values.push(...(understanding.businessSegments ?? []).map((segment) => `${textOf(segment.name)} ${textOf(segment.description)}`));
    for (const group of [understanding.revenueDrivers ?? [], understanding.costDrivers ?? [], understanding.marginDrivers ?? [], understanding.cashGenerationDrivers ?? [], understanding.balanceSheetDrivers ?? [], understanding.returnsDrivers ?? [], understanding.capitalEngines ?? []]) {
      values.push(...group.map((driver) => `${textOf(driver.name)} ${textOf(driver.mechanism)}`));
    }
  }
  const engine = input.engine;
  if (engine) {
    values.push(textOf(engine.primaryAbstraction));
    values.push(...(engine.valueQuestions ?? []).map(textOf));
    values.push(...(engine.statementBindings ?? []).map((binding) => `${textOf(binding.statementLine)} ${textOf(binding.drivenBy)} ${textOf(binding.mechanism)}`));
  }
  const factPack = input.factPack ?? input.facts;
  if (factPack) {
    for (const section of [factPack.incomeStatement, factPack.balanceSheet, factPack.cashFlow, factPack.market, factPack.shares]) {
      values.push(...section.facts.map((fact) => `${fact.metric} ${fact.label}`));
    }
  }
  return values.join(" ").toLowerCase();
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function segmentCount(input: AccountingArchitectureInput): number {
  return Math.max(input.understanding?.businessSegments?.length ?? 0, input.engine?.statementBindings?.length ?? 0);
}

function makeSelection(id: AccountingArchitectureId, evidence: readonly string[], score: number, reason: string, allScores: Record<AccountingArchitectureId, number>): AccountingArchitecture {
  const base = contracts[id];
  const total = Object.values(allScores).reduce((sum, value) => sum + Math.max(0, value), 0);
  const confidence = total > 0 ? Math.min(0.99, Math.max(0.2, score / Math.max(1, total))) : 0.2;
  return Object.freeze({ ...base, family: id, statementType: base.statementModel, requiredFacts: base.requiredLines, identitySet: base.identityRules.map((rule) => rule.id), evidence: Object.freeze([...new Set(evidence)].sort()), score, confidence, reason });
}

export function selectAccountingArchitecture(input?: AccountingArchitectureInput): AccountingArchitecture;
export function selectAccountingArchitecture(understanding?: Partial<CompanyUnderstanding>, engine?: Partial<EconomicEngine>, factPack?: FactPack): AccountingArchitecture;
export function selectAccountingArchitecture(inputOrUnderstanding: AccountingArchitectureInput | Partial<CompanyUnderstanding> = {}, engine?: Partial<EconomicEngine>, factPack?: FactPack): AccountingArchitecture {
  const input: AccountingArchitectureInput = "understanding" in inputOrUnderstanding || "evidence" in inputOrUnderstanding || "factPack" in inputOrUnderstanding || "facts" in inputOrUnderstanding || "economicEvidence" in inputOrUnderstanding || "architectureEvidence" in inputOrUnderstanding || "declaredArchitecture" in inputOrUnderstanding ? inputOrUnderstanding as AccountingArchitectureInput : { understanding: inputOrUnderstanding as Partial<CompanyUnderstanding>, engine, factPack };
  const text = evidenceText(input);
  const scores: Record<AccountingArchitectureId, number> = {
    corporate: countMatches(text, [/revenue/, /gross profit/, /operating income/, /cost of goods/, /ppe|property plant/, /capital expenditure/, /inventory/]),
    depository: countMatches(text, [/deposit/, /loan/, /advance/, /interest income/, /interest expense/, /net interest/, /\bnim\b/, /credit cost/, /loan loss/, /lending/]),
    insurance: countMatches(text, [/insurance/, /premium/, /policyholder/, /claim/, /underwriting/, /loss ratio/, /combined ratio/, /annuity/, /reinsurance/]),
    reit: countMatches(text, [/\breit\b/, /real estate/, /rental/, /lease income/, /property portfolio/, /occupancy/, /\brevpar\b/, /funds from operations/, /\bnoi\b/, /tenant/]),
    fee_based: countMatches(text, [/fee[- ]based/, /asset management/, /management fee/, /advisory fee/, /commission/, /\baum\b/, /assets under management/, /subscription fee/, /brokerage/, /take rate/]),
    conglomerate: countMatches(text, [/conglomerate/, /diversified/, /portfolio of businesses/, /multi[- ]segment/, /several distinct/]) + Math.max(0, segmentCount(input) - 1),
  };
  if (input.declaredArchitecture && isAccountingArchitectureId(input.declaredArchitecture)) return makeSelection(input.declaredArchitecture, [input.declaredArchitecture], 1, `Declared economic architecture ${input.declaredArchitecture}`, scores);
  const ranked = (Object.entries(scores) as Array<[AccountingArchitectureId, number]>).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const selected = ranked[0][1] > 0 ? ranked[0][0] : "corporate";
  const evidence = text === "" ? ["No explicit economic evidence; corporate contract selected conservatively"] : text.split(/[.!?;,]/).map((part) => part.trim()).filter((part) => part.length > 0).slice(0, 8);
  const reason = selected === "corporate" && scores.corporate === 0
    ? "No stronger architecture-specific economic evidence was declared; the corporate contract is the conservative default."
    : `Selected ${selected} from economic evidence, not ticker or sector classification.`;
  return makeSelection(selected, evidence, scores[selected], reason, scores);
}

export const chooseAccountingArchitecture = selectAccountingArchitecture;
export const selectArchitecture = selectAccountingArchitecture;
export const determineAccountingArchitecture = selectAccountingArchitecture;
export const classifyAccountingArchitecture = selectAccountingArchitecture;

export function getAccountingArchitecture(id: AccountingArchitectureId): AccountingArchitecture {
  if (!isAccountingArchitectureId(id)) throw new TypeError(`Unknown accounting architecture ${String(id)}`);
  return makeSelection(id, [id], 1, `Requested accounting architecture contract ${id}`, { corporate: 0, depository: 0, insurance: 0, reit: 0, fee_based: 0, conglomerate: 0 });
}

export const ACCOUNTING_ARCHITECTURES = Object.freeze(Object.keys(contracts) as AccountingArchitectureId[]);

export function isAccountingArchitectureId(value: unknown): value is AccountingArchitectureId {
  return typeof value === "string" && ACCOUNTING_ARCHITECTURES.includes(value as AccountingArchitectureId);
}

export default { selectAccountingArchitecture, chooseAccountingArchitecture, selectArchitecture, determineAccountingArchitecture, classifyAccountingArchitecture, getAccountingArchitecture, ACCOUNTING_ARCHITECTURES };
