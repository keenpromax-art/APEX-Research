import { selectAccountingArchitecture } from "./accounting-architecture";
import { analyzeValuationCrossCheck, selectPrimaryValuationMethod } from "./valuation-cross-check";
import {
  buildValuationViabilityMatrix,
  methodPlansFromSpecification,
  normalizeValuationMethod,
  planToValuationSpecification,
  VALUATION_METHOD_REGISTRY,
  type ValuationMethodViability,
} from "./valuation-methods";
import {
  completeFinitePath,
  forecastLinePath,
  forecastLineValue,
  isFiniteNumber,
  latestValueFromPack,
  provenanceInput,
  resolveValuationAnchors,
  stableId,
  terminalPolicyOf,
  valuationAssumption,
} from "./valuation-helpers";
import type {
  Fact,
  FactPack,
  ForecastResult,
  ForecastSpecification,
  ValuationBridge,
  ValuationDiagnostic,
  ValuationExecutionStatus,
  ValuationMatrix,
  ValuationMatrixEntry,
  ValuationMethodId,
  ValuationMethodPlan,
  ValuationProvenance,
  ValuationResult,
  ValuationSpecification,
  ValuationTerminalPolicy,
} from "./types";

export interface ValuationExecutionOptions {
  forecastSpec?: ForecastSpecification;
  architecture?: string;
  requireEvidence?: boolean;
  selectedMethod?: string;
}

export interface ValuationMatrixInput extends ValuationExecutionOptions {
  specification: ValuationSpecification;
  forecast: ForecastResult;
  factPack: FactPack;
}

export interface FcffDerivation {
  fcff: number[];
  basis: "direct_fcff" | "ebit_build" | "cfo_less_capex";
  ebit: number[];
  taxes: number[];
  depreciationAndAmortization: number[];
  capex: number[];
  changeInWorkingCapital: number[];
  cfo: number[];
}

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function assumptionValue(plan: ValuationMethodPlan, names: readonly string[]): number | undefined {
  const assumption = valuationAssumption(plan, names);
  return assumption && isFiniteNumber(assumption.value) ? assumption.value : undefined;
}

function discountRateOf(plan: ValuationMethodPlan): number | undefined {
  return assumptionValue(plan, ["wacc", "discountRate", "costOfCapital", "costOfEquity", "requiredReturn", "ke"])
    ?? (isFiniteNumber(plan.discountRate) ? plan.discountRate : undefined);
}

function terminalPolicyOrThrow(plan: ValuationMethodPlan): ValuationTerminalPolicy {
  const policy = terminalPolicyOf(plan);
  if (!policy) throw new Error("Terminal policy is required");
  if (!isFiniteNumber(policy.growth) || policy.growth <= -1 || policy.growth >= 1) throw new Error("Terminal growth is invalid");
  if (!isFiniteNumber(policy.maxValueShare) || policy.maxValueShare <= 0 || policy.maxValueShare >= 1) throw new Error("Terminal value cap is invalid");
  return { ...policy, terminalMetric: policy.terminalMetric as ValuationTerminalPolicy["terminalMetric"] };
}

function absolutePath(path: Array<number | undefined>): number[] | undefined {
  return completeFinitePath(path) ? path.map((value) => Math.abs(value)) : undefined;
}

function capexOutflowPath(forecast: ForecastResult): number[] | undefined {
  const path = forecastLinePath(forecast, ["capex", "capitalExpenditures", "capitalExpenditure"]);
  return completeFinitePath(path) ? path.map((value) => Math.abs(value)) : undefined;
}

function workingCapitalChanges(forecast: ForecastResult, pack: FactPack): number[] | undefined {
  const direct = forecastLinePath(forecast, ["changeInWorkingCapital", "deltaWorkingCapital"]);
  if (completeFinitePath(direct)) return [...direct];
  const balances = forecastLinePath(forecast, ["workingCapital"]);
  if (!completeFinitePath(balances)) return undefined;
  const receivables = latestValueFromPack(pack, "accountsReceivable") ?? latestValueFromPack(pack, "receivables");
  const inventory = latestValueFromPack(pack, "inventory") ?? latestValueFromPack(pack, "totalInventory");
  const payables = latestValueFromPack(pack, "accountsPayable") ?? latestValueFromPack(pack, "payables");
  const componentOpening = isFiniteNumber(receivables) && isFiniteNumber(inventory) && isFiniteNumber(payables) ? receivables + inventory - payables : undefined;
  const opening = latestValueFromPack(pack, "workingCapital") ?? componentOpening;
  if (!isFiniteNumber(opening)) return undefined;
  return balances.map((balance, index) => balance - (index === 0 ? opening : balances[index - 1]));
}

function emptyDerivation(length: number): FcffDerivation {
  return {
    fcff: Array.from({ length }, () => Number.NaN),
    basis: "ebit_build",
    ebit: Array.from({ length }, () => Number.NaN),
    taxes: Array.from({ length }, () => Number.NaN),
    depreciationAndAmortization: Array.from({ length }, () => Number.NaN),
    capex: Array.from({ length }, () => Number.NaN),
    changeInWorkingCapital: Array.from({ length }, () => Number.NaN),
    cfo: Array.from({ length }, () => Number.NaN),
  };
}

export function deriveFcffForecast(plan: ValuationMethodPlan, forecast: ForecastResult, pack: FactPack): FcffDerivation {
  const length = Math.max(forecast.incomeStatement.length, forecast.balanceSheet.length, forecast.cashFlow.length);
  const direct = forecastLinePath(forecast, ["fcff", "unleveredFreeCashFlow"]);
  if (completeFinitePath(direct)) {
    const derivation = emptyDerivation(length);
    derivation.fcff = [...direct];
    derivation.basis = "direct_fcff";
    return derivation;
  }
  const ebit = forecastLinePath(forecast, ["ebit", "operatingIncome"]);
  const taxPath = forecastLinePath(forecast, ["tax", "taxExpense", "incomeTaxExpense"]);
  const taxRate = assumptionValue(plan, ["taxRate", "cashTaxRate", "effectiveTaxRate"]);
  const depreciation = absolutePath(forecastLinePath(forecast, ["depreciation", "depreciationAndAmortization", "da"]));
  const capex = capexOutflowPath(forecast);
  const workingCapital = workingCapitalChanges(forecast, pack);
  if (completeFinitePath(ebit) && depreciation && capex && workingCapital && (completeFinitePath(taxPath) || isFiniteNumber(taxRate))) {
    const taxes = completeFinitePath(taxPath)
      ? [...taxPath]
      : ebit.map((value) => value * (taxRate as number));
    const fcff = ebit.map((value, index) => value - taxes[index] + depreciation[index] - capex[index] - workingCapital[index]);
    return { fcff, basis: "ebit_build", ebit: [...ebit], taxes, depreciationAndAmortization: depreciation, capex, changeInWorkingCapital: workingCapital, cfo: Array.from({ length }, () => Number.NaN) };
  }
  const cfo = forecastLinePath(forecast, ["cfo", "operatingCashFlow", "totalCashFromOperatingActivities"]);
  if (completeFinitePath(cfo) && capex) {
    return {
      fcff: cfo.map((value, index) => value - capex[index]),
      basis: "cfo_less_capex",
      ebit: Array.from({ length }, () => Number.NaN),
      taxes: Array.from({ length }, () => Number.NaN),
      depreciationAndAmortization: Array.from({ length }, () => Number.NaN),
      capex,
      changeInWorkingCapital: Array.from({ length }, () => Number.NaN),
      cfo: [...cfo],
    };
  }
  return emptyDerivation(length);
}

function deriveFcfeForecast(forecast: ForecastResult): { fcfe: number[]; basis: "direct_fcfe" | "cfo_less_capex_plus_net_borrowing" } | undefined {
  const direct = forecastLinePath(forecast, ["fcfe", "freeCashFlowToEquity"]);
  if (completeFinitePath(direct)) return { fcfe: [...direct], basis: "direct_fcfe" };
  const cfo = forecastLinePath(forecast, ["cfo", "operatingCashFlow", "totalCashFromOperatingActivities"]);
  const capex = capexOutflowPath(forecast);
  const netBorrowing = forecastLinePath(forecast, ["netBorrowing"]);
  const borrowing = completeFinitePath(netBorrowing)
    ? [...netBorrowing]
    : (() => {
        const issuance = forecastLinePath(forecast, ["debtIssuance"]);
        const repayment = forecastLinePath(forecast, ["debtRepayment"]);
        return completeFinitePath(issuance) && completeFinitePath(repayment)
          ? issuance.map((value, index) => value - repayment[index])
          : undefined;
      })();
  if (completeFinitePath(cfo) && capex && borrowing) return { fcfe: cfo.map((value, index) => value - capex[index] + borrowing[index]), basis: "cfo_less_capex_plus_net_borrowing" };
  return undefined;
}

function midYearPresentValue(value: number, yearIndex: number, rate: number): number {
  return value / Math.pow(1 + rate, yearIndex + 0.5);
}

function terminalBridge(
  finalFlow: number,
  rate: number,
  growth: number,
  policy: ValuationTerminalPolicy,
  explicitPresentValue: number,
  horizon: number,
): { terminalValue: number; pvTerminalRaw: number; pvTerminalUsed: number; totalValue: number; capApplied: boolean } {
  const rawTerminalValue = finalFlow * (1 + growth) / (rate - growth);
  const pvTerminalRaw = rawTerminalValue / Math.pow(1 + rate, Math.max(0, horizon - 0.5));
  const rawTotal = explicitPresentValue + pvTerminalRaw;
  const rawShare = Math.abs(rawTotal) > 1e-12 ? pvTerminalRaw / rawTotal : 1;
  const capApplied = explicitPresentValue > 0 && rawShare > policy.maxValueShare;
  const pvTerminalUsed = capApplied ? policy.maxValueShare / (1 - policy.maxValueShare) * explicitPresentValue : pvTerminalRaw;
  return { terminalValue: rawTerminalValue, pvTerminalRaw, pvTerminalUsed, totalValue: explicitPresentValue + pvTerminalUsed, capApplied };
}

function presentValuePath(path: readonly number[], rate: number): number {
  return path.reduce((sum, value, index) => sum + midYearPresentValue(value, index, rate), 0);
}

function createProvenance(
  method: ValuationMethodId,
  plan: ValuationMethodPlan,
  spec: ValuationSpecification,
  forecast: ForecastResult,
  pack: FactPack,
  valuationId: string,
  factInputs: readonly Fact[],
): ValuationProvenance {
  const inputs = plan.assumptions.map((assumption) => provenanceInput(
    assumption.variable,
    assumption.value,
    assumption.unit,
    "assumption",
    {
      ...(assumption.factIds ? { factIds: [...assumption.factIds] } : {}),
      ...(assumption.evidenceIds ? { evidenceIds: [...assumption.evidenceIds] } : {}),
      source: assumption.historicalEvidence,
    },
  ));
  for (const fact of factInputs) {
    if (!fact) continue;
    inputs.push(provenanceInput(fact.metric, fact.value, fact.unit ?? fact.currency ?? "number", "fact", { factIds: [fact.factId ?? fact.metric], source: fact.source }));
  }
  for (const [alias, provenance] of [
    ["revenue", "forecast"],
    ["ebit", "forecast"],
    ["netIncome", "forecast"],
    ["cfo", "forecast"],
    ["capex", "forecast"],
  ] as const) {
    const value = forecastLineValue(forecast, [alias]);
    if (isFiniteNumber(value)) inputs.push(provenanceInput(alias, value, "currency", provenance));
  }
  return {
    valuationId,
    method,
    ...(spec.specId ? { specId: spec.specId } : {}),
    ...(forecastSpecId(forecast, spec) ? { modelId: forecastSpecId(forecast, spec), forecastId: forecast.forecastId ?? forecastSpecId(forecast, spec) } : {}),
    ...(pack.factPackId ? { factPackId: pack.factPackId } : {}),
    ...(forecast.architecture ? { architecture: forecast.architecture } : {}),
    inputs,
  };
}

function forecastSpecId(forecast: ForecastResult, spec: ValuationSpecification): string | undefined {
  return forecast.modelId ?? spec.modelId ?? spec.architecture;
}

function resultId(method: ValuationMethodId, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack): string {
  return stableId("VAL", [spec.specId ?? spec.methodology, method, forecast.forecastId ?? forecast.modelId, pack.factPackId ?? pack.contentHash ?? pack.ticker]);
}

function baseResult(
  method: ValuationMethodId | string,
  status: ValuationExecutionStatus,
  diagnostics: ValuationDiagnostic[],
  blockers: readonly string[],
  plan: ValuationMethodPlan | undefined,
  spec: ValuationSpecification,
  id: string,
  provenance?: ValuationProvenance,
): ValuationResult {
  return {
    id,
    methodology: String(method),
    method: String(method),
    status,
    outputs: {},
    executedFrom: plan ? planToValuationSpecification(plan, spec) : spec,
    bridge: { basis: "equity_value", steps: [] },
    ...(provenance ? { provenance } : {}),
    diagnostics,
    blockers: [...new Set(blockers)],
    publicationBlocked: status !== "ready",
  };
}

function completeResult(input: {
  method: ValuationMethodId;
  plan: ValuationMethodPlan;
  spec: ValuationSpecification;
  forecast: ForecastResult;
  pack: FactPack;
  enterpriseValue?: number;
  equityValue: number;
  fairValuePerShare: number;
  outputs: Record<string, number | undefined>;
  paths?: Record<string, number[]>;
  bridge: ValuationBridge;
  diagnostics?: ValuationDiagnostic[];
  id: string;
}): ValuationResult {
  const anchors = resolveValuationAnchors(input.pack);
  const upsidePct = isFiniteNumber(anchors.currentPrice) && anchors.currentPrice > 0 ? (input.fairValuePerShare / anchors.currentPrice - 1) * 100 : undefined;
  const factInputs = [
    anchors.currentPriceFact,
    anchors.sharesOutstandingFact,
    anchors.netDebtFact,
    anchors.debtFact,
    anchors.cashFact,
    anchors.totalEquityFact,
    anchors.bookValuePerShareFact,
  ].filter((fact): fact is Fact => fact !== undefined);
  return {
    id: input.id,
    methodology: input.method,
    method: input.method,
    status: "ready",
    enterpriseValue: input.enterpriseValue,
    fairValueEquity: input.equityValue,
    fairValuePerShare: input.fairValuePerShare,
    outputs: input.outputs,
    ...(upsidePct !== undefined ? { upsidePct } : {}),
    executedFrom: planToValuationSpecification(input.plan, input.spec),
    bridge: {
      ...input.bridge,
      ...(input.enterpriseValue !== undefined ? { enterpriseValue: input.enterpriseValue } : {}),
      equityValue: input.equityValue,
      ...(isFiniteNumber(input.bridge.netDebt) ? { netDebt: input.bridge.netDebt } : {}),
      ...(isFiniteNumber(input.bridge.debt) ? { debt: input.bridge.debt } : {}),
      ...(isFiniteNumber(input.bridge.cash) ? { cash: input.bridge.cash } : {}),
      ...(isFiniteNumber(input.bridge.sharesOutstanding) ? { sharesOutstanding: input.bridge.sharesOutstanding } : {}),
      fairValuePerShare: input.fairValuePerShare,
      ...(isFiniteNumber(anchors.currentPrice) ? { currentPrice: anchors.currentPrice } : {}),
    },
    provenance: createProvenance(input.method, input.plan, input.spec, input.forecast, input.pack, input.id, factInputs),
    diagnostics: input.diagnostics ?? [],
    blockers: [],
    publicationBlocked: false,
    ...(input.paths ? { paths: input.paths } : {}),
  };
}

function enterpriseBridge(enterpriseValue: number, netDebt: number, shares: number, currentPrice: number | undefined): ValuationBridge {
  const equityValue = enterpriseValue - netDebt;
  return {
    basis: "enterprise_to_equity",
    enterpriseValue,
    equityValue,
    netDebt,
    sharesOutstanding: shares,
    ...(isFiniteNumber(currentPrice) ? { currentPrice } : {}),
    steps: [
      { label: "Enterprise value", from: "enterprise", to: "enterprise", amount: enterpriseValue },
      { label: "Less net debt", from: "enterprise", to: "equity", amount: -netDebt, rate: netDebt / enterpriseValue },
      { label: "Equity value", from: "equity", to: "equity", amount: equityValue },
      { label: "Divide by diluted shares", from: "equity", to: "per_share", amount: equityValue / shares, rate: 1 / shares },
    ],
  };
}

function equityBridge(equityValue: number, shares: number, currentPrice: number | undefined): ValuationBridge {
  return {
    basis: "equity_to_per_share",
    equityValue,
    sharesOutstanding: shares,
    ...(isFiniteNumber(currentPrice) ? { currentPrice } : {}),
    steps: [
      { label: "Equity value", from: "equity", to: "equity", amount: equityValue },
      { label: "Divide by diluted shares", from: "equity", to: "per_share", amount: equityValue / shares, rate: 1 / shares },
    ],
  };
}

function executeFcff(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  const anchors = resolveValuationAnchors(pack);
  const rate = discountRateOf(plan);
  const policy = terminalPolicyOrThrow(plan);
  if (!isFiniteNumber(rate) || rate <= 0 || rate <= policy.growth) throw new Error("FCFF WACC must be positive and exceed terminal growth");
  if (!isFiniteNumber(anchors.sharesOutstanding) || anchors.sharesOutstanding <= 0 || !isFiniteNumber(anchors.netDebt)) throw new Error("FCFF requires explicit shares and net debt");
  const derivation = deriveFcffForecast(plan, forecast, pack);
  if (!completeFinitePath(derivation.fcff) || derivation.fcff.length === 0) throw new Error("FCFF could not be derived from canonical forecast lines");
  if (derivation.fcff[derivation.fcff.length - 1] <= 0) throw new Error("FCFF terminal cash flow must be positive");
  const pvExplicit = presentValuePath(derivation.fcff, rate);
  if (pvExplicit <= 0) throw new Error("FCFF explicit-period present value must be positive");
  const terminal = terminalBridge(derivation.fcff[derivation.fcff.length - 1], rate, policy.growth, policy, pvExplicit, derivation.fcff.length);
  const diagnostics = terminal.capApplied ? [diagnostic("TERMINAL_VALUE_CAP_APPLIED", `FCFF terminal present value was capped at ${(policy.maxValueShare * 100).toFixed(1)}% of enterprise value.`, "warning", "terminalPolicy.maxValueShare")] : [];
  return completeResult({
    method: "FCFF DCF",
    plan,
    spec,
    forecast,
    pack,
    enterpriseValue: terminal.totalValue,
    equityValue: terminal.totalValue - (anchors.netDebt as number),
    fairValuePerShare: (terminal.totalValue - (anchors.netDebt as number)) / (anchors.sharesOutstanding as number),
    outputs: {
      pvExplicitFcff: pvExplicit,
      terminalValue: terminal.terminalValue,
      pvTerminalValue: terminal.pvTerminalUsed,
      pvTerminalValueRaw: terminal.pvTerminalRaw,
      terminalValueShare: terminal.totalValue === 0 ? 0 : terminal.pvTerminalUsed / terminal.totalValue,
      enterpriseValue: terminal.totalValue,
      netDebt: anchors.netDebt,
      sharesOutstanding: anchors.sharesOutstanding,
    },
    paths: { fcff: derivation.fcff, ebit: derivation.ebit, taxes: derivation.taxes, depreciationAndAmortization: derivation.depreciationAndAmortization, capex: derivation.capex, changeInWorkingCapital: derivation.changeInWorkingCapital, cfo: derivation.cfo },
    bridge: enterpriseBridge(terminal.totalValue, anchors.netDebt as number, anchors.sharesOutstanding as number, anchors.currentPrice),
    diagnostics,
    id,
  });
}

function executeFcfe(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  const anchors = resolveValuationAnchors(pack);
  const rate = discountRateOf(plan);
  const policy = terminalPolicyOrThrow(plan);
  if (!isFiniteNumber(rate) || rate <= 0 || rate <= policy.growth) throw new Error("FCFE cost of equity must be positive and exceed terminal growth");
  if (!isFiniteNumber(anchors.sharesOutstanding) || anchors.sharesOutstanding <= 0) throw new Error("FCFE requires explicit shares");
  const derivation = deriveFcfeForecast(forecast);
  if (!derivation || !completeFinitePath(derivation.fcfe) || derivation.fcfe[derivation.fcfe.length - 1] <= 0) throw new Error("FCFE requires a complete positive terminal cash-flow path");
  const pvExplicit = presentValuePath(derivation.fcfe, rate);
  if (pvExplicit <= 0) throw new Error("FCFE explicit-period present value must be positive");
  const terminal = terminalBridge(derivation.fcfe[derivation.fcfe.length - 1], rate, policy.growth, policy, pvExplicit, derivation.fcfe.length);
  return completeResult({
    method: "FCFE",
    plan,
    spec,
    forecast,
    pack,
    equityValue: terminal.totalValue,
    fairValuePerShare: terminal.totalValue / (anchors.sharesOutstanding as number),
    outputs: { pvExplicitFcfe: pvExplicit, terminalValue: terminal.terminalValue, pvTerminalValue: terminal.pvTerminalUsed, pvTerminalValueRaw: terminal.pvTerminalRaw, terminalValueShare: terminal.totalValue === 0 ? 0 : terminal.pvTerminalUsed / terminal.totalValue, sharesOutstanding: anchors.sharesOutstanding },
    paths: { fcfe: derivation.fcfe },
    bridge: equityBridge(terminal.totalValue, anchors.sharesOutstanding as number, anchors.currentPrice),
    diagnostics: terminal.capApplied ? [diagnostic("TERMINAL_VALUE_CAP_APPLIED", `FCFE terminal present value was capped at ${(policy.maxValueShare * 100).toFixed(1)}% of equity value.`, "warning")] : [],
    id,
  });
}

function openingBookValue(pack: FactPack, shares: number): number | undefined {
  const direct = latestValueFromPack(pack, "bookValuePerShare");
  if (isFiniteNumber(direct)) return direct;
  const equity = resolveValuationAnchors(pack).totalEquity;
  return isFiniteNumber(equity) ? equity / shares : undefined;
}

function executeResidualIncome(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  const anchors = resolveValuationAnchors(pack);
  const rate = discountRateOf(plan);
  const policy = terminalPolicyOrThrow(plan);
  if (!isFiniteNumber(rate) || rate <= 0 || rate <= policy.growth) throw new Error("Residual-income cost of equity must exceed terminal growth");
  if (!isFiniteNumber(anchors.sharesOutstanding) || anchors.sharesOutstanding <= 0) throw new Error("Residual income requires explicit shares");
  const shares = anchors.sharesOutstanding;
  const opening = openingBookValue(pack, shares);
  if (!isFiniteNumber(opening)) throw new Error("Residual income requires opening common book value");
  const netIncome = forecastLinePath(forecast, ["netIncome"]);
  const epsPath = forecastLinePath(forecast, ["eps", "earningsPerShare"]);
  const earningsPerShare = completeFinitePath(epsPath) ? [...epsPath] : completeFinitePath(netIncome) ? netIncome.map((value) => value / shares) : undefined;
  if (!earningsPerShare) throw new Error("Residual income requires forecast net income or EPS");
  const directBvps = forecastLinePath(forecast, ["bookValuePerShare", "bookValue"]);
  const equityPath = forecastLinePath(forecast, ["totalEquity", "stockholdersEquity"]);
  const dividends = forecastLinePath(forecast, ["dividendsPaid", "dividends"]);
  const issuance = forecastLinePath(forecast, ["equityIssuance"]);
  const explicitBook: number[] = [];
  if (completeFinitePath(directBvps)) explicitBook.push(...directBvps);
  else if (completeFinitePath(equityPath)) explicitBook.push(...equityPath.map((value) => value / shares));
  else if (completeFinitePath(dividends) && completeFinitePath(issuance)) {
    let book = opening;
    for (let index = 0; index < earningsPerShare.length; index += 1) {
      book += earningsPerShare[index] - dividends[index] / shares + issuance[index] / shares;
      explicitBook.push(book);
    }
  }
  if (!completeFinitePath(explicitBook) || explicitBook.length !== earningsPerShare.length) throw new Error("Residual income requires a complete book-value roll-forward");
  if (completeFinitePath(dividends) && completeFinitePath(issuance)) {
    let rollForwardBook = opening;
    for (let index = 0; index < earningsPerShare.length; index += 1) {
      rollForwardBook += earningsPerShare[index] - dividends[index] / shares + issuance[index] / shares;
      if (Math.abs(explicitBook[index] - rollForwardBook) > 1e-6 * Math.max(1, Math.abs(explicitBook[index]), Math.abs(rollForwardBook))) throw new Error(`Residual income book-value roll-forward failed in forecast year ${index + 1}`);
    }
  }
  const residualIncome: number[] = [];
  let book = opening;
  for (let index = 0; index < earningsPerShare.length; index += 1) {
    residualIncome.push(earningsPerShare[index] - rate * book);
    book = explicitBook[index];
    if (!isFiniteNumber(book) || book <= 0) throw new Error("Residual income book value must remain positive");
  }
  const pvExplicit = presentValuePath(residualIncome, rate);
  const terminal = terminalBridge(residualIncome[residualIncome.length - 1], rate, policy.growth, policy, Math.max(0, pvExplicit), residualIncome.length);
  const fairValue = opening + pvExplicit + terminal.pvTerminalUsed;
  return completeResult({
    method: "Residual Income",
    plan,
    spec,
    forecast,
    pack,
    equityValue: fairValue * shares,
    fairValuePerShare: fairValue,
    outputs: { openingBookValuePerShare: opening, closingBookValuePerShare: book, pvResidualIncome: pvExplicit, terminalResidualIncome: terminal.terminalValue, pvTerminalResidualIncome: terminal.pvTerminalUsed, sharesOutstanding: shares },
    paths: { eps: earningsPerShare, openingBookValuePerShare: [opening, ...explicitBook.slice(0, -1)], closingBookValuePerShare: explicitBook, residualIncome },
    bridge: equityBridge(fairValue * shares, shares, anchors.currentPrice),
    diagnostics: terminal.capApplied ? [diagnostic("TERMINAL_VALUE_CAP_APPLIED", `Residual-income terminal present value was capped at ${(policy.maxValueShare * 100).toFixed(1)}%.`, "warning")] : [],
    id,
  });
}

function executeDdm(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  const anchors = resolveValuationAnchors(pack);
  const rate = discountRateOf(plan);
  const policy = terminalPolicyOrThrow(plan);
  if (!isFiniteNumber(rate) || rate <= 0 || rate <= policy.growth) throw new Error("DDM cost of equity must exceed terminal growth");
  if (!isFiniteNumber(anchors.sharesOutstanding) || anchors.sharesOutstanding <= 0) throw new Error("DDM requires explicit shares");
  const shares = anchors.sharesOutstanding;
  const direct = forecastLinePath(forecast, ["dps", "dividendPerShare"]);
  const totalDividends = forecastLinePath(forecast, ["dividendsPaid", "dividends"]);
  const dps = completeFinitePath(direct) ? [...direct] : completeFinitePath(totalDividends) ? totalDividends.map((value) => value / shares) : undefined;
  const assumptionPath = plan.assumptions.find((assumption) => ["dps", "dividendPerShare"].includes(assumption.variable) && (Array.isArray(assumption.valuePath) || Array.isArray(assumption.path)))?.valuePath
    ?? plan.assumptions.find((assumption) => ["dps", "dividendPerShare"].includes(assumption.variable) && (Array.isArray(assumption.valuePath) || Array.isArray(assumption.path)))?.path;
  const path = dps ?? (Array.isArray(assumptionPath) && assumptionPath.every(isFiniteNumber) ? assumptionPath : undefined);
  if (!path || path.some((value) => value < 0)) throw new Error("DDM requires an explicit non-negative forecast dividend path");
  const pvExplicit = presentValuePath(path, rate);
  if (pvExplicit <= 0) throw new Error("DDM explicit dividends must have positive present value");
  const terminal = terminalBridge(path[path.length - 1], rate, policy.growth, policy, pvExplicit, path.length);
  const fairValue = pvExplicit + terminal.pvTerminalUsed;
  return completeResult({
    method: "DDM",
    plan,
    spec,
    forecast,
    pack,
    equityValue: fairValue * shares,
    fairValuePerShare: fairValue,
    outputs: { pvExplicitDividends: pvExplicit, terminalValue: terminal.terminalValue, pvTerminalValue: terminal.pvTerminalUsed, sharesOutstanding: shares },
    paths: { dividendsPerShare: path },
    bridge: equityBridge(fairValue * shares, shares, anchors.currentPrice),
    diagnostics: terminal.capApplied ? [diagnostic("TERMINAL_VALUE_CAP_APPLIED", `DDM terminal present value was capped at ${(policy.maxValueShare * 100).toFixed(1)}% of equity value.`, "warning")] : [],
    id,
  });
}

function executeRelative(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  const anchors = resolveValuationAnchors(pack);
  if (!isFiniteNumber(anchors.sharesOutstanding) || anchors.sharesOutstanding <= 0) throw new Error("Relative valuation requires explicit shares");
  const shares = anchors.sharesOutstanding;
  if (plan.method === "P/E") {
    const multiple = assumptionValue(plan, ["targetPE", "peRatio", "pE", "exitPE"]);
    const earnings = forecastLineValue(forecast, ["netIncome"]);
    const eps = forecastLineValue(forecast, ["eps", "earningsPerShare"]);
    if (!isFiniteNumber(multiple) || multiple <= 0) throw new Error("P/E requires a positive target multiple");
    if (!isFiniteNumber(earnings) && !isFiniteNumber(eps)) throw new Error("P/E requires forecast net income or EPS");
    const fairValue = isFiniteNumber(eps) ? eps * multiple : ((earnings as number) / shares) * multiple;
    const equityValue = fairValue * shares;
    return completeResult({ method: "P/E", plan, spec, forecast, pack, equityValue, fairValuePerShare: fairValue, outputs: { targetPE: multiple, forecastNetIncome: earnings, forecastEPS: eps, sharesOutstanding: shares }, bridge: equityBridge(equityValue, shares, anchors.currentPrice), id });
  }
  if (plan.method === "P/B") {
    const multiple = assumptionValue(plan, ["targetPB", "pbRatio", "pB", "priceToBook"]);
    const book = openingBookValue(pack, shares);
    if (!isFiniteNumber(multiple) || multiple <= 0 || !isFiniteNumber(book)) throw new Error("P/B requires a positive target multiple and common book value");
    const fairValue = book * multiple;
    return completeResult({ method: "P/B", plan, spec, forecast, pack, equityValue: fairValue * shares, fairValuePerShare: fairValue, outputs: { targetPB: multiple, bookValuePerShare: book, sharesOutstanding: shares }, bridge: equityBridge(fairValue * shares, shares, anchors.currentPrice), id });
  }
  if (!isFiniteNumber(anchors.netDebt)) throw new Error(`${plan.method} requires explicit net debt`);
  if (plan.method === "EV/EBITDA") {
    const multiple = assumptionValue(plan, ["targetEVEBITDA", "evEBITDA", "evEbitda", "exitEVEBITDA"]);
    let ebitda = forecastLineValue(forecast, ["ebitda"]);
    if (!isFiniteNumber(ebitda)) {
      const ebit = forecastLineValue(forecast, ["ebit", "operatingIncome"]);
      const da = forecastLineValue(forecast, ["depreciation", "depreciationAndAmortization", "da"]);
      if (isFiniteNumber(ebit) && isFiniteNumber(da)) ebitda = ebit + Math.abs(da);
    }
    if (!isFiniteNumber(multiple) || multiple <= 0 || !isFiniteNumber(ebitda)) throw new Error("EV/EBITDA requires a positive target multiple and forecast EBITDA");
    const enterpriseValue = ebitda * multiple;
    const equityValue = enterpriseValue - anchors.netDebt;
    return completeResult({ method: "EV/EBITDA", plan, spec, forecast, pack, enterpriseValue, equityValue, fairValuePerShare: equityValue / shares, outputs: { targetEVEBITDA: multiple, forecastEbitda: ebitda, netDebt: anchors.netDebt, sharesOutstanding: shares }, bridge: enterpriseBridge(enterpriseValue, anchors.netDebt, shares, anchors.currentPrice), id });
  }
  if (plan.method === "EV/Sales") {
    const multiple = assumptionValue(plan, ["targetEVSales", "evSales", "evRevenue", "targetEVRevenue"]);
    const revenue = forecastLineValue(forecast, ["revenue", "totalRevenue", "sales"]);
    if (!isFiniteNumber(multiple) || multiple <= 0 || !isFiniteNumber(revenue)) throw new Error("EV/Sales requires a positive target multiple and forecast revenue");
    const enterpriseValue = revenue * multiple;
    const equityValue = enterpriseValue - anchors.netDebt;
    return completeResult({ method: "EV/Sales", plan, spec, forecast, pack, enterpriseValue, equityValue, fairValuePerShare: equityValue / shares, outputs: { targetEVSales: multiple, forecastRevenue: revenue, netDebt: anchors.netDebt, sharesOutstanding: shares }, bridge: enterpriseBridge(enterpriseValue, anchors.netDebt, shares, anchors.currentPrice), id });
  }
  throw new Error(`Unsupported relative method ${plan.method}`);
}

function executeComponents(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  const anchors = resolveValuationAnchors(pack);
  if (!isFiniteNumber(anchors.sharesOutstanding) || anchors.sharesOutstanding <= 0) throw new Error("Component valuation requires explicit shares");
  const components = plan.components ?? [];
  if (components.length === 0) throw new Error("Component valuation requires explicit components");
  if (plan.method === "NAV") {
    const assets = components.filter((component) => component.basis === "asset").reduce((sum, component) => sum + component.value * (component.probability ?? 1), 0);
    const liabilities = components.filter((component) => component.basis === "liability").reduce((sum, component) => sum + component.value * (component.probability ?? 1), 0);
    const equityValue = assets - liabilities;
    if (assets <= 0 || liabilities < 0 || equityValue <= 0) throw new Error("NAV requires positive assets, non-negative liabilities, and positive equity value");
    return completeResult({ method: "NAV", plan, spec, forecast, pack, equityValue, fairValuePerShare: equityValue / anchors.sharesOutstanding, outputs: { assetValue: assets, liabilityValue: liabilities, sharesOutstanding: anchors.sharesOutstanding }, paths: { components: components.map((component) => component.value * (component.probability ?? 1)) }, bridge: equityBridge(equityValue, anchors.sharesOutstanding, anchors.currentPrice), id });
  }
  const enterprise = components.every((component) => component.basis === "enterprise");
  const equity = components.every((component) => component.basis === "equity");
  if (!enterprise && !equity) throw new Error("SOTP components must use a consistent enterprise or equity basis");
  const aggregate = components.reduce((sum, component) => sum + component.value * (component.probability ?? 1), 0);
  if (aggregate <= 0) throw new Error("SOTP aggregate value must be positive");
  if (equity) return completeResult({ method: "SOTP", plan, spec, forecast, pack, equityValue: aggregate, fairValuePerShare: aggregate / anchors.sharesOutstanding, outputs: { aggregateComponentValue: aggregate, sharesOutstanding: anchors.sharesOutstanding }, paths: { components: components.map((component) => component.value * (component.probability ?? 1)) }, bridge: equityBridge(aggregate, anchors.sharesOutstanding, anchors.currentPrice), id });
  if (!isFiniteNumber(anchors.netDebt)) throw new Error("Enterprise-basis SOTP requires explicit net debt");
  const equityValue = aggregate - anchors.netDebt;
  return completeResult({ method: "SOTP", plan, spec, forecast, pack, enterpriseValue: aggregate, equityValue, fairValuePerShare: equityValue / anchors.sharesOutstanding, outputs: { aggregateEnterpriseValue: aggregate, netDebt: anchors.netDebt, sharesOutstanding: anchors.sharesOutstanding }, paths: { components: components.map((component) => component.value * (component.probability ?? 1)) }, bridge: enterpriseBridge(aggregate, anchors.netDebt, anchors.sharesOutstanding, anchors.currentPrice), id });
}

function executeMethod(plan: ValuationMethodPlan, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationResult {
  switch (plan.method) {
    case "FCFF DCF": return executeFcff(plan, spec, forecast, pack, id);
    case "FCFE": return executeFcfe(plan, spec, forecast, pack, id);
    case "Residual Income": return executeResidualIncome(plan, spec, forecast, pack, id);
    case "DDM": return executeDdm(plan, spec, forecast, pack, id);
    case "P/E":
    case "P/B":
    case "EV/EBITDA":
    case "EV/Sales": return executeRelative(plan, spec, forecast, pack, id);
    case "SOTP":
    case "NAV": return executeComponents(plan, spec, forecast, pack, id);
    default: throw new Error(`Unsupported valuation method ${String(plan.method ?? "unknown")}`);
  }
}

function unavailableProvenance(method: string, plan: ValuationMethodPlan | undefined, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack, id: string): ValuationProvenance {
  if (!method) return { valuationId: id, method, inputs: [] };
  const normalized = normalizeValuationMethod(method);
  if (!normalized) return { valuationId: id, method, ...(spec.specId ? { specId: spec.specId } : {}), inputs: [] };
  const anchors = resolveValuationAnchors(pack);
  return createProvenance(normalized, plan ?? { method: normalized, rationale: "", variablesDrivingValuation: [], assumptions: [] }, spec, forecast, pack, id, [anchors.currentPriceFact, anchors.sharesOutstandingFact, anchors.netDebtFact, anchors.debtFact, anchors.cashFact, anchors.totalEquityFact, anchors.bookValuePerShareFact].filter((fact): fact is Fact => fact !== undefined));
}

function viabilityResult(viability: ValuationMethodViability, spec: ValuationSpecification, pack: FactPack, forecast: ForecastResult): ValuationResult {
  const method = viability.normalizedMethod ?? viability.methodId;
  const id = viability.normalizedMethod ? resultId(viability.normalizedMethod, spec, forecast, pack) : stableId("VAL", [String(method), spec.specId ?? spec.methodology, pack.ticker]);
  return baseResult(method, viability.status === "viable" ? "blocked" : viability.status, viability.diagnostics, viability.blockers, viability.plan, spec, id, unavailableProvenance(String(method), viability.plan, spec, forecast, pack, id));
}

function executeAssessedMethod(viability: ValuationMethodViability, spec: ValuationSpecification, forecast: ForecastResult, pack: FactPack): ValuationResult {
  if (!viability.viable || !viability.plan || !viability.normalizedMethod) return viabilityResult(viability, spec, pack, forecast);
  const id = resultId(viability.normalizedMethod, spec, forecast, pack);
  try {
    return executeMethod(viability.plan, spec, forecast, pack, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return baseResult(viability.normalizedMethod, "failed", [diagnostic("VALUATION_EXECUTION_FAILED", message)], [message], viability.plan, spec, id, unavailableProvenance(viability.normalizedMethod, viability.plan, spec, forecast, pack, id));
  }
}

function entryFrom(viability: ValuationMethodViability, result: ValuationResult, selected: boolean, sensitivityRank: number | null): ValuationMatrixEntry {
  if (!viability.normalizedMethod) throw new Error("Cannot create a valuation matrix entry for an unsupported method");
  return { ...result, methodId: viability.normalizedMethod, suitability: viability.suitability, dataSufficiency: viability.dataSufficiency, selected, sensitivityRank };
}

export function executeValuationMatrix(input: ValuationMatrixInput): ValuationMatrix {
  const architecture = input.architecture ?? input.forecast.architecture ?? selectAccountingArchitecture({ factPack: input.factPack }).id;
  const plans = methodPlansFromSpecification(input.specification);
  const selectedMethod = input.selectedMethod ?? input.specification.selectedMethod ?? input.specification.methodology;
  const viability = buildValuationViabilityMatrix({
    plans,
    forecast: input.forecast,
    factPack: input.factPack,
    architecture,
    selectedMethod,
    requireEvidence: input.requireEvidence ?? true,
  });
  const entries = viability.map((item) => {
    const result = executeAssessedMethod(item, input.specification, input.forecast, input.factPack);
    const sensitivityVariables = item.plan?.sensitivityVariables ?? [];
    const driving = input.specification.variablesDrivingValuation.map((value) => value.toLowerCase());
    const explicitRank = sensitivityVariables.findIndex((variable) => driving.includes(variable.toLowerCase()));
    const rank = result.status === "ready" ? explicitRank >= 0 ? explicitRank : sensitivityVariables.length > 0 ? sensitivityVariables.length : 0 : null;
    return entryFrom(item, result, false, rank);
  });
  const primary = selectPrimaryValuationMethod(entries, selectedMethod);
  const normalizedSelected = normalizeValuationMethod(selectedMethod);
  const withSelection = entries.map((entry) => ({
    ...entry,
    ...(entry.methodId === normalizedSelected && input.specification.methodology ? { methodology: input.specification.methodology } : {}),
    selected: primary?.methodId === entry.methodId,
  }));
  const crossCheck = analyzeValuationCrossCheck(withSelection);
  const matrixId = stableId("VALMATRIX", [input.specification.specId ?? input.specification.methodology, input.forecast.forecastId ?? input.forecast.modelId, input.factPack.factPackId ?? input.factPack.contentHash ?? input.factPack.ticker]);
  const selectedBlocked = primary ? [] : (viability.find((item) => normalizeValuationMethod(item.methodId) === normalizeValuationMethod(selectedMethod))?.blockers ?? ["No ready valuation method"]);
  return {
    valuationId: matrixId,
    ...(input.forecast.modelId ? { modelId: input.forecast.modelId } : input.specification.architecture ? { modelId: input.specification.architecture } : {}),
    ...(input.forecast.forecastId ? { forecastId: input.forecast.forecastId } : {}),
    ...(input.factPack.factPackId ? { factPackId: input.factPack.factPackId } : {}),
    status: primary ? "ready" : "blocked",
    selectedMethod: normalizeValuationMethod(selectedMethod),
    primaryMethod: primary?.methodId ?? null,
    primaryValuationId: primary?.id ?? null,
    methods: withSelection,
    crossCheck,
    diagnostics: crossCheck.diagnostics,
    blockers: [...new Set(selectedBlocked)],
    publicationBlocked: !primary,
  };
}

export function executeValuation(
  spec: ValuationSpecification,
  forecast: ForecastResult,
  factPack: FactPack,
  options: ValuationExecutionOptions = {},
): ValuationResult {
  const selectedMethod = options.selectedMethod ?? spec.selectedMethod ?? spec.methodology;
  const normalized = normalizeValuationMethod(selectedMethod);
  if (!normalized) {
    const message = `Unsupported valuation method ${selectedMethod}.`;
    const id = stableId("VAL", [selectedMethod, spec.specId ?? spec.methodology, forecast.forecastId, factPack.factPackId ?? factPack.ticker]);
    return baseResult(selectedMethod, "unsupported", [diagnostic("METHOD_UNSUPPORTED", message)], [message], undefined, spec, id, unavailableProvenance(String(selectedMethod), undefined, spec, forecast, factPack, id));
  }
  const matrix = executeValuationMatrix({
    specification: spec,
    forecast,
    factPack,
    architecture: options.architecture,
    requireEvidence: options.requireEvidence,
    selectedMethod: normalized,
  });
  const selected = matrix.methods.find((method) => method.methodId === normalized);
  if (selected?.status === "ready") return selected;
  return matrix.methods.find((method) => method.methodId === matrix.primaryMethod) ?? selected ?? baseResult(normalized, "blocked", matrix.blockers.map((message) => diagnostic("VALUATION_BLOCKED", message)), matrix.blockers, methodPlansFromSpecification(spec).find((plan) => plan.method === normalized), spec, stableId("VAL", [normalized, spec.specId ?? spec.methodology, forecast.forecastId, factPack.ticker]));
}

export function validateValuationSpec(spec: ValuationSpecification): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!spec.methodology || !spec.methodology.trim()) issues.push("Missing methodology");
  if (!normalizeValuationMethod(spec.methodology)) issues.push(`Unsupported methodology ${spec.methodology}`);
  if (!spec.rationale?.trim()) issues.push("Missing rationale for methodology selection");
  if (!Array.isArray(spec.assumptions)) issues.push("Assumptions must be an array");
  else for (const assumption of spec.assumptions) {
    if (!assumption.assumption?.trim()) issues.push("Assumption missing description");
    if (!assumption.variable?.trim()) issues.push("Assumption missing variable");
    if (!isFiniteNumber(assumption.value)) issues.push(`Assumption [${assumption.variable}] must have a finite numeric value`);
    if (!assumption.unit?.trim()) issues.push(`Assumption [${assumption.variable}] missing unit`);
    if (!assumption.rationale?.trim()) issues.push(`Assumption [${assumption.variable}] missing rationale`);
  }
  const method = normalizeValuationMethod(spec.methodology);
  if (method && VALUATION_METHOD_REGISTRY[method].terminalPolicy === "required") {
    const policy = terminalPolicyOf(spec);
    if (!policy) issues.push(`${method} requires an explicit terminal policy`);
    else {
      if (!isFiniteNumber(policy.growth) || policy.growth <= -1 || policy.growth >= 1) issues.push("Terminal growth must be a finite decimal in (-1, 1)");
      if (!isFiniteNumber(policy.maxValueShare) || policy.maxValueShare <= 0 || policy.maxValueShare >= 1) issues.push("Terminal value cap must be in (0, 1)");
    }
  }
  return { valid: issues.length === 0, issues };
}

export const executeValuationMethod = executeValuation;
export const runValuationMatrix = executeValuationMatrix;

export default {
  deriveFcffForecast,
  executeValuation,
  executeValuationMatrix,
  executeValuationMethod,
  runValuationMatrix,
  validateValuationSpec,
};
