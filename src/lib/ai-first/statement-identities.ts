import type { ForecastStatementYear } from "./types";

export interface BalancePlug {
  variable: string;
  computedValue: number;
  kind: "balancing-plug" | "cash-roll-forward";
}

export interface IdentityCheck {
  check: string;
  pass: boolean;
  detail?: string;
  critical?: boolean;
  code?: string;
  actual?: number;
  expected?: number;
  tolerance?: number;
}

export interface StatementIdentityOptions {
  log?: string[];
  statements?: {
    incomeStatement?: readonly ForecastStatementYear[];
    balanceSheet?: readonly ForecastStatementYear[];
    cashFlow?: readonly ForecastStatementYear[];
  };
  architecture?: { kind?: string } | string;
  baseValues?: Record<string, number | undefined>;
}

export interface StatementRollforwardResult {
  years: ForecastStatementYear[];
  plugs: BalancePlug[];
  identityChecks: IdentityCheck[];
}

export const TOL = 1;

function numberValue(values: Record<string, number | undefined>, key: string): number | undefined {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function magnitudeTolerance(values: Array<number | undefined>): number {
  const scale = Math.max(0, ...values.filter((value): value is number => value !== undefined).map((value) => Math.abs(value)));
  return Math.max(1e-6, scale * 1e-9);
}

function addCheck(checks: IdentityCheck[], check: string, expected: number, actual: number, code: string, critical = true): void {
  const tolerance = magnitudeTolerance([expected, actual]);
  const pass = Math.abs(actual - expected) <= tolerance;
  checks.push({ check, pass, critical, code, actual, expected, tolerance, ...(pass ? {} : { detail: `difference ${actual - expected} exceeds tolerance ${tolerance}` }) });
}

function addStockCheck(checks: IdentityCheck[], check: string, expected: number, actual: number, code: string): void {
  addCheck(checks, check, expected, actual, code, true);
}

function statementYears(input: ForecastStatementYear[] | StatementIdentityOptions["statements"]): {
  income: ForecastStatementYear[];
  balance: ForecastStatementYear[];
  cash: ForecastStatementYear[];
} {
  if (Array.isArray(input)) return { income: input, balance: input, cash: input };
  return {
    income: [...(input?.incomeStatement ?? [])],
    balance: [...(input?.balanceSheet ?? [])],
    cash: [...(input?.cashFlow ?? [])],
  };
}

function checkIncome(years: readonly ForecastStatementYear[], checks: IdentityCheck[]): void {
  for (const year of years) {
    const values = year.values;
    const grossProfit = numberValue(values, "grossProfit");
    const operatingExpense = numberValue(values, "totalOpex") ?? numberValue(values, "operatingExpenses");
    const ebit = numberValue(values, "ebit") ?? numberValue(values, "operatingIncome");
    if (grossProfit !== undefined && operatingExpense !== undefined && ebit !== undefined) addCheck(checks, `IS ${year.period}: GP − Opex = EBIT`, grossProfit - operatingExpense, ebit, "IS_GP_OPEX_EBIT");
    const pbt = numberValue(values, "pbt") ?? numberValue(values, "pretaxIncome");
    const netInterest = numberValue(values, "netInterest") ?? numberValue(values, "interestExpense");
    if (pbt !== undefined && ebit !== undefined && netInterest !== undefined) addCheck(checks, `IS ${year.period}: PBT = EBIT − net interest`, ebit - netInterest, pbt, "IS_PBT_EBIT_INTEREST");
    const tax = numberValue(values, "tax");
    const netIncome = numberValue(values, "netIncome");
    if (pbt !== undefined && tax !== undefined && netIncome !== undefined) addCheck(checks, `IS ${year.period}: NI = PBT − tax`, pbt - tax, netIncome, "IS_NI_PBT_TAX");
    const revenue = numberValue(values, "revenue");
    if (revenue !== undefined && netIncome !== undefined) checks.push({ check: `IS ${year.period}: NI ≤ Revenue`, pass: revenue >= 0 ? netIncome <= revenue + magnitudeTolerance([revenue, netIncome]) : netIncome <= revenue, critical: true, code: "IS_NET_INCOME_SANITY" });
  }
}

function checkBalance(years: readonly ForecastStatementYear[], checks: IdentityCheck[], baseValues: Record<string, number | undefined> = {}): void {
  for (const year of years) {
    const values = year.values;
    const assets = numberValue(values, "totalAssets") ?? numberValue(values, "assets");
    const liabilities = numberValue(values, "totalLiabilities") ?? numberValue(values, "liabilities");
    const equity = numberValue(values, "totalEquity") ?? numberValue(values, "stockholdersEquity") ?? numberValue(values, "equity");
    if (assets !== undefined && liabilities !== undefined && equity !== undefined) addCheck(checks, `BS ${year.period}: Assets = Liabilities + Equity`, liabilities + equity, assets, "BS_CLOSURE");
  }
  for (let index = 0; index < years.length; index += 1) {
    const previous = index === 0 ? baseValues : years[index - 1].values;
    const current = years[index].values;
    const previousRetained = previous ? numberValue(previous, "retainedEarnings") ?? numberValue(previous, "retainedEarningsBalance") : undefined;
    const currentRetained = numberValue(current, "retainedEarnings") ?? numberValue(current, "retainedEarningsBalance");
    const netIncome = numberValue(current, "netIncome");
    const dividends = numberValue(current, "dividendsPaid") ?? numberValue(current, "dividends");
    if (previousRetained !== undefined && currentRetained !== undefined && netIncome !== undefined && dividends !== undefined) addStockCheck(checks, `BS ${years[index].period}: RE = prior RE + NI − dividends`, previousRetained + netIncome - dividends, currentRetained, "BS_RETAINED_EARNINGS_ROLLFORWARD");
    const previousPpe = previous ? numberValue(previous, "ppe") ?? numberValue(previous, "propertyPlantEquipment") : undefined;
    const currentPpe = numberValue(current, "ppe") ?? numberValue(current, "propertyPlantEquipment");
    const capex = numberValue(current, "capex") ?? numberValue(current, "capitalExpenditures");
    const depreciation = numberValue(current, "depreciation") ?? numberValue(current, "depreciationAndAmortization");
    if (previousPpe !== undefined && currentPpe !== undefined && capex !== undefined && depreciation !== undefined) addStockCheck(checks, `BS ${years[index].period}: PPE = prior PPE + capex − depreciation`, previousPpe + Math.abs(capex) - Math.abs(depreciation), currentPpe, "BS_PPE_ROLLFORWARD");
    const previousDebt = previous ? numberValue(previous, "totalDebt") ?? numberValue(previous, "debt") : undefined;
    const currentDebt = numberValue(current, "totalDebt") ?? numberValue(current, "debt");
    const issuance = numberValue(current, "debtIssuance");
    const repayment = numberValue(current, "debtRepayment");
    if (previousDebt !== undefined && currentDebt !== undefined && issuance !== undefined && repayment !== undefined) addStockCheck(checks, `BS ${years[index].period}: Debt = prior debt + issuance − repayment`, previousDebt + issuance - repayment, currentDebt, "BS_DEBT_ROLLFORWARD");
    const previousEquity = previous ? numberValue(previous, "totalEquity") ?? numberValue(previous, "stockholdersEquity") : undefined;
    const currentEquity = numberValue(current, "totalEquity") ?? numberValue(current, "stockholdersEquity");
    const equityIssuance = numberValue(current, "equityIssuance");
    if (previousEquity !== undefined && currentEquity !== undefined && netIncome !== undefined && dividends !== undefined && equityIssuance !== undefined) addStockCheck(checks, `BS ${years[index].period}: Equity = prior equity + NI − dividends + issuance`, previousEquity + netIncome - dividends + equityIssuance, currentEquity, "BS_EQUITY_ROLLFORWARD");
  }
}

function checkCash(years: readonly ForecastStatementYear[], checks: IdentityCheck[], baseValues: Record<string, number | undefined> = {}): void {
  for (const year of years) {
    const values = year.values;
    const open = numberValue(values, "cashOpen");
    const cfo = numberValue(values, "cfo") ?? numberValue(values, "operatingCashFlow");
    const cfi = numberValue(values, "cfi") ?? numberValue(values, "investingCashFlow");
    const cff = numberValue(values, "cff") ?? numberValue(values, "financingCashFlow");
    const close = numberValue(values, "cashClose") ?? numberValue(values, "cash");
    if (open !== undefined && cfo !== undefined && cfi !== undefined && cff !== undefined && close !== undefined) addCheck(checks, `CF ${year.period}: close = open + CFO + CFI + CFF`, open + cfo + cfi + cff, close, "CF_CASH_ROLLFORWARD");
  }
  for (let index = 0; index < years.length; index += 1) {
    const previousClose = index === 0
      ? baseValues.cash ?? baseValues.cashClose ?? baseValues.cashAndCashEquivalents
      : numberValue(years[index - 1].values, "cashClose") ?? numberValue(years[index - 1].values, "cash");
    const currentOpen = numberValue(years[index].values, "cashOpen");
    if (previousClose !== undefined && currentOpen !== undefined) addStockCheck(checks, `CF ${years[index].period}: opening cash equals prior close`, previousClose, currentOpen, "CF_PRIOR_CASH_ROLLFORWARD");
  }
}

export function enforceStatementIdentities(
  years: ForecastStatementYear[] | StatementIdentityOptions["statements"],
  opts: StatementIdentityOptions = {},
): StatementRollforwardResult {
  const statements = statementYears(years);
  const checks: IdentityCheck[] = [];
  checkIncome(statements.income, checks);
  checkBalance(statements.balance, checks, opts.baseValues);
  checkCash(statements.cash, checks, opts.baseValues);
  const architecture = typeof opts.architecture === "string" ? opts.architecture : opts.architecture?.kind;
  if (architecture === "depository") {
    for (const year of statements.income) {
      const income = numberValue(year.values, "interestIncome");
      const expense = numberValue(year.values, "interestExpense");
      const netInterest = numberValue(year.values, "netInterestIncome") ?? numberValue(year.values, "netInterest");
      if (income !== undefined && expense !== undefined && netInterest !== undefined) addCheck(checks, `DEP ${year.period}: NII = interest income − interest expense`, income - expense, netInterest, "DEP_NET_INTEREST_INCOME");
    }
  }
  if (architecture === "insurance") {
    for (const year of statements.income) {
      const premiums = numberValue(year.values, "premiums");
      const claims = numberValue(year.values, "claims");
      const underwriting = numberValue(year.values, "underwritingIncome");
      if (premiums !== undefined && claims !== undefined && underwriting !== undefined) addCheck(checks, `INS ${year.period}: underwriting result = premiums − claims`, premiums - claims, underwriting, "INS_UNDERWRITING_RESULT", false);
    }
  }
  if (architecture === "reit") {
    for (const year of statements.income) {
      const rental = numberValue(year.values, "rentalIncome");
      const costs = numberValue(year.values, "propertyOperatingCosts");
      const noi = numberValue(year.values, "noi");
      if (rental !== undefined && costs !== undefined && noi !== undefined) addCheck(checks, `REIT ${year.period}: NOI = rental income − property costs`, rental - costs, noi, "REIT_NOI", false);
    }
  }
  if (architecture === "fee_based") {
    for (const year of statements.income) {
      const feeRevenue = numberValue(year.values, "feeRevenue");
      const expenses = numberValue(year.values, "operatingExpenses");
      const operatingIncome = numberValue(year.values, "operatingIncome");
      if (feeRevenue !== undefined && expenses !== undefined && operatingIncome !== undefined) addCheck(checks, `FEE ${year.period}: operating result = fee revenue − expenses`, feeRevenue - expenses, operatingIncome, "FEE_OPERATING_RESULT", false);
    }
  }
  if (architecture === "conglomerate") {
    for (const year of statements.income) {
      const revenue = numberValue(year.values, "revenue");
      const segmentRevenue = numberValue(year.values, "segmentRevenue");
      if (revenue !== undefined && segmentRevenue !== undefined) addCheck(checks, `SEG ${year.period}: consolidated revenue = segment revenue`, segmentRevenue, revenue, "SEGMENT_REVENUE_CLOSURE", false);
    }
  }
  for (let index = 0; index < statements.balance.length; index += 1) {
    const balanceCash = numberValue(statements.balance[index].values, "cash") ?? numberValue(statements.balance[index].values, "cashAndCashEquivalents");
    const cashClose = numberValue(statements.cash[index]?.values ?? {}, "cashClose") ?? numberValue(statements.cash[index]?.values ?? {}, "cash");
    if (balanceCash !== undefined && cashClose !== undefined) addCheck(checks, `BS/CF ${statements.balance[index].period}: balance cash = cash close`, cashClose, balanceCash, "BS_CASH_TIE");
  }
  if (checks.length === 0) {
    checks.push({ check: "Forecast identity checks are available", pass: false, critical: true, code: "IDENTITY_CHECKS_UNAVAILABLE", detail: "No complete statement identity had sufficient canonical inputs" });
  }
  return { years: Array.isArray(years) ? years : statements.income, plugs: [], identityChecks: checks };
}

export function identityTolerance(values: Array<number | undefined>): number {
  return magnitudeTolerance(values);
}

export default { enforceStatementIdentities, identityTolerance, TOL };
