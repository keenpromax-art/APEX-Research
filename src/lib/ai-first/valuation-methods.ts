import type { AccountingArchitectureId } from "./accounting-architecture";
import type {
  Assumption,
  FactPack,
  ForecastResult,
  ValuationDataSufficiency,
  ValuationDiagnostic,
  ValuationEvidence,
  ValuationMethodId,
  ValuationMethodPlan,
  ValuationMethodSuitability,
  ValuationSpecification,
  ValuationTerminalPolicy,
} from "./types";
import {
  assumptionEvidenceReferences,
  completeFinitePath,
  evidenceReferencesExist,
  forecastLinePath,
  isFiniteNumber,
  isForecastBlocked,
  latestValueFromPack,
  resolveValuationAnchors,
  terminalPolicyOf,
  valuationAssumption,
} from "./valuation-helpers";

export type ValuationBridgeBasis = "enterprise_to_equity" | "equity_to_per_share" | "equity_value" | "enterprise_value";

export interface ValuationMethodDefinition {
  method: ValuationMethodId;
  aliases: readonly string[];
  family: "cash_flow" | "equity_claim" | "relative" | "sum_of_parts" | "asset_based";
  bridge: ValuationBridgeBasis;
  applicableArchitectures: readonly AccountingArchitectureId[];
  terminalPolicy: "required" | "not_applicable";
  requiredAssumptionGroups: ReadonlyArray<{ key: string; anyOf: readonly string[] }>;
  sensitivityVariables: readonly string[];
  requiresShares: boolean;
  requiresNetDebt: boolean;
  supportsExplicitComponents: boolean;
  description: string;
}

export const VALUATION_METHODS: readonly ValuationMethodId[] = [
  "FCFF DCF",
  "FCFE",
  "Residual Income",
  "DDM",
  "P/E",
  "EV/EBITDA",
  "EV/Sales",
  "P/B",
  "SOTP",
  "NAV",
];

const CORPORATE_LIKE: readonly AccountingArchitectureId[] = ["corporate", "reit", "fee_based", "conglomerate"];
const COMPONENT_ARCHITECTURES: readonly AccountingArchitectureId[] = ["corporate", "reit", "fee_based", "conglomerate"];
const ALL_ARCHITECTURES: readonly AccountingArchitectureId[] = ["corporate", "depository", "insurance", "reit", "fee_based", "conglomerate"];

export const VALUATION_METHOD_REGISTRY: Readonly<Record<ValuationMethodId, ValuationMethodDefinition>> = Object.freeze({
  "FCFF DCF": Object.freeze({
    method: "FCFF DCF",
    aliases: ["FCFF_DCF", "FCFF DCF", "FCFF", "DCF", "Discounted Cash Flow"],
    family: "cash_flow",
    bridge: "enterprise_to_equity",
    applicableArchitectures: CORPORATE_LIKE,
    terminalPolicy: "required",
    requiredAssumptionGroups: [
      { key: "discountRate", anyOf: ["wacc", "discountRate", "costOfCapital"] },
      { key: "terminalGrowth", anyOf: ["terminalGrowth", "terminalGrowthRate", "g"] },
    ],
    sensitivityVariables: ["wacc", "terminalGrowth"],
    requiresShares: true,
    requiresNetDebt: true,
    supportsExplicitComponents: false,
    description: "Unlevered free cash flow to the firm discounted at WACC with an explicit terminal policy.",
  }),
  FCFE: Object.freeze({
    method: "FCFE",
    aliases: ["FCFE DCF", "FCFE", "Equity DCF"],
    family: "cash_flow",
    bridge: "equity_to_per_share",
    applicableArchitectures: CORPORATE_LIKE,
    terminalPolicy: "required",
    requiredAssumptionGroups: [
      { key: "costOfEquity", anyOf: ["costOfEquity", "requiredReturn", "discountRate", "ke"] },
      { key: "terminalGrowth", anyOf: ["terminalGrowth", "terminalGrowthRate", "g"] },
    ],
    sensitivityVariables: ["costOfEquity", "terminalGrowth"],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: false,
    description: "Levered free cash flow to equity discounted at the cost of equity.",
  }),
  "Residual Income": Object.freeze({
    method: "Residual Income",
    aliases: ["Residual Income", "ResidualIncome", "RI"],
    family: "equity_claim",
    bridge: "equity_to_per_share",
    applicableArchitectures: ALL_ARCHITECTURES,
    terminalPolicy: "required",
    requiredAssumptionGroups: [
      { key: "costOfEquity", anyOf: ["costOfEquity", "requiredReturn", "discountRate", "ke"] },
      { key: "terminalGrowth", anyOf: ["terminalGrowth", "terminalGrowthRate", "g"] },
    ],
    sensitivityVariables: ["costOfEquity", "terminalGrowth"],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: false,
    description: "Opening book value plus discounted residual income with an explicit book-value roll-forward.",
  }),
  DDM: Object.freeze({
    method: "DDM",
    aliases: ["DDM", "Dividend Discount", "Dividend Discount Model"],
    family: "equity_claim",
    bridge: "equity_to_per_share",
    applicableArchitectures: ALL_ARCHITECTURES,
    terminalPolicy: "required",
    requiredAssumptionGroups: [
      { key: "costOfEquity", anyOf: ["costOfEquity", "requiredReturn", "discountRate", "ke"] },
      { key: "terminalGrowth", anyOf: ["terminalGrowth", "terminalGrowthRate", "g"] },
    ],
    sensitivityVariables: ["costOfEquity", "terminalGrowth"],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: false,
    description: "Present value of explicit dividends per share and a disciplined terminal dividend.",
  }),
  "P/E": Object.freeze({
    method: "P/E",
    aliases: ["P/E", "PE", "Price Earnings", "Price/Earnings"],
    family: "relative",
    bridge: "equity_to_per_share",
    applicableArchitectures: ALL_ARCHITECTURES,
    terminalPolicy: "not_applicable",
    requiredAssumptionGroups: [{ key: "targetPE", anyOf: ["targetPE", "peRatio", "pE", "exitPE"] }],
    sensitivityVariables: ["targetPE"],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: false,
    description: "Target equity earnings multiple applied to forecast earnings per share.",
  }),
  "EV/EBITDA": Object.freeze({
    method: "EV/EBITDA",
    aliases: ["EV/EBITDA", "EVEBITDA", "EV/EBITDА", "EV/EBITDA Multiple"],
    family: "relative",
    bridge: "enterprise_to_equity",
    applicableArchitectures: CORPORATE_LIKE,
    terminalPolicy: "not_applicable",
    requiredAssumptionGroups: [{ key: "targetEVEBITDA", anyOf: ["targetEVEBITDA", "evEBITDA", "evEbitda", "exitEVEBITDA"] }],
    sensitivityVariables: ["targetEVEBITDA"],
    requiresShares: true,
    requiresNetDebt: true,
    supportsExplicitComponents: false,
    description: "Target enterprise multiple applied to forecast EBITDA with a complete enterprise-to-equity bridge.",
  }),
  "EV/Sales": Object.freeze({
    method: "EV/Sales",
    aliases: ["EV/Sales", "EV/Revenue", "EVRevenue", "EV/Sales Multiple"],
    family: "relative",
    bridge: "enterprise_to_equity",
    applicableArchitectures: CORPORATE_LIKE,
    terminalPolicy: "not_applicable",
    requiredAssumptionGroups: [{ key: "targetEVSales", anyOf: ["targetEVSales", "evSales", "evRevenue", "targetEVRevenue"] }],
    sensitivityVariables: ["targetEVSales"],
    requiresShares: true,
    requiresNetDebt: true,
    supportsExplicitComponents: false,
    description: "Target enterprise value-to-sales multiple with a complete enterprise-to-equity bridge.",
  }),
  "P/B": Object.freeze({
    method: "P/B",
    aliases: ["P/B", "PB", "Price/Book", "Price to Book"],
    family: "relative",
    bridge: "equity_to_per_share",
    applicableArchitectures: ALL_ARCHITECTURES,
    terminalPolicy: "not_applicable",
    requiredAssumptionGroups: [{ key: "targetPB", anyOf: ["targetPB", "pbRatio", "pB", "priceToBook"] }],
    sensitivityVariables: ["targetPB"],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: false,
    description: "Target price-to-book multiple applied to explicit common equity value.",
  }),
  SOTP: Object.freeze({
    method: "SOTP",
    aliases: ["SOTP", "Sum of the Parts", "Sum-of-the-Parts"],
    family: "sum_of_parts",
    bridge: "enterprise_to_equity",
    applicableArchitectures: COMPONENT_ARCHITECTURES,
    terminalPolicy: "not_applicable",
    requiredAssumptionGroups: [],
    sensitivityVariables: [],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: true,
    description: "Explicit evidence-backed component values aggregated on a consistent enterprise or equity basis.",
  }),
  NAV: Object.freeze({
    method: "NAV",
    aliases: ["NAV", "Net Asset Value", "Net Asset Valuation"],
    family: "asset_based",
    bridge: "equity_to_per_share",
    applicableArchitectures: COMPONENT_ARCHITECTURES,
    terminalPolicy: "not_applicable",
    requiredAssumptionGroups: [],
    sensitivityVariables: [],
    requiresShares: true,
    requiresNetDebt: false,
    supportsExplicitComponents: true,
    description: "Explicit asset values less explicit liabilities, with evidence for every component.",
  }),
});

const methodEntries = Object.values(VALUATION_METHOD_REGISTRY);

export function normalizeValuationMethod(value: unknown): ValuationMethodId | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  const direct = methodEntries.find((definition) => definition.method.toLowerCase() === candidate.toLowerCase());
  if (direct) return direct.method;
  const alias = methodEntries.find((definition) => definition.aliases.some((entry) => entry.toLowerCase() === candidate.toLowerCase()));
  return alias?.method ?? null;
}

export function getValuationMethod(value: unknown): ValuationMethodDefinition | undefined {
  const method = normalizeValuationMethod(value);
  return method ? VALUATION_METHOD_REGISTRY[method] : undefined;
}

export const getValuationMethodDefinition = getValuationMethod;

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

function addEvidenceForSpec(spec: ValuationEvidence[], references: readonly string[]): ValuationEvidence[] {
  return [...spec, ...references.map((id) => ({ id }))];
}

function assumptionOrTopLevel(
  plan: ValuationMethodPlan,
  group: { key: string; anyOf: readonly string[] },
): { value?: number; references: string[]; source: "assumption" | "field" | "missing" } {
  const assumption = valuationAssumption(plan, group.anyOf);
  if (assumption && isFiniteNumber(assumption.value)) return { value: assumption.value, references: assumptionEvidenceReferences(assumption), source: "assumption" };
  if (group.key === "discountRate" || group.key === "costOfEquity") {
    if (isFiniteNumber(plan.discountRate)) {
      return { value: plan.discountRate, references: [...(plan.discountRateEvidenceIds ?? []), ...(plan.evidenceIds ?? [])], source: "field" };
    }
  }
  if (group.key === "terminalGrowth" && plan.terminalAssumptions && isFiniteNumber(plan.terminalAssumptions.growth)) {
    return { value: plan.terminalAssumptions.growth, references: [...(plan.terminalGrowthEvidenceIds ?? []), ...(plan.evidenceIds ?? [])], source: "field" };
  }
  return { references: [], source: "missing" };
}

function evidenceRequiredForGroup(
  plan: ValuationMethodPlan,
  group: { key: string; anyOf: readonly string[] },
  pack: FactPack,
): { missing: boolean; references: string[] } {
  const resolved = assumptionOrTopLevel(plan, group);
  if (resolved.references.length > 0 && evidenceReferencesExist(pack, resolved.references, plan)) return { missing: false, references: resolved.references };
  const general = plan.evidenceIds ?? [];
  if (general.length > 0 && evidenceReferencesExist(pack, general, plan)) return { missing: false, references: general };
  return { missing: true, references: resolved.references };
}

function completeLine(forecast: ForecastResult, aliases: readonly string[]): boolean {
  return completeFinitePath(forecastLinePath(forecast, aliases));
}

function lineAvailable(forecast: ForecastResult, aliases: readonly string[]): boolean {
  return forecastLinePath(forecast, aliases).some(isFiniteNumber);
}

function fcffLinesViable(plan: ValuationMethodPlan, forecast: ForecastResult, pack: FactPack): { viable: boolean; missing: string[] } {
  if (completeLine(forecast, ["fcff", "unleveredFreeCashFlow"])) return { viable: true, missing: [] };
  if (completeLine(forecast, ["cfo", "operatingCashFlow", "totalCashFromOperatingActivities"]) && completeLine(forecast, ["capex", "capitalExpenditures", "capitalExpenditure"])) return { viable: true, missing: [] };
  const missing: string[] = [];
  if (!completeLine(forecast, ["ebit", "operatingIncome"])) missing.push("ebit");
  const taxRate = valuationAssumption(plan, ["taxRate", "cashTaxRate", "effectiveTaxRate"]);
  if (!lineAvailable(forecast, ["tax", "taxExpense", "incomeTaxExpense"]) && !isFiniteNumber(taxRate?.value)) missing.push("tax");
  if (!completeLine(forecast, ["depreciation", "depreciationAndAmortization", "da"])) missing.push("depreciation");
  if (!completeLine(forecast, ["capex", "capitalExpenditures", "capitalExpenditure"])) missing.push("capex");
  const workingCapitalPath = completeLine(forecast, ["workingCapital"]);
  const changePath = completeLine(forecast, ["changeInWorkingCapital", "deltaWorkingCapital"]);
  const baseWorkingCapital = latestValueFromPack(pack, "workingCapital");
  if (!workingCapitalPath && !changePath && !isFiniteNumber(baseWorkingCapital)) missing.push("workingCapitalOrChange");
  return { viable: missing.length === 0, missing };
}

function fcfeLinesViable(forecast: ForecastResult): { viable: boolean; missing: string[] } {
  if (completeLine(forecast, ["fcfe", "freeCashFlowToEquity"])) return { viable: true, missing: [] };
  const missing: string[] = [];
  if (!completeLine(forecast, ["cfo", "operatingCashFlow", "totalCashFromOperatingActivities"])) missing.push("cfo");
  if (!completeLine(forecast, ["capex", "capitalExpenditures", "capitalExpenditure"])) missing.push("capex");
  const netBorrowing = completeLine(forecast, ["netBorrowing"]);
  const debtFlows = completeLine(forecast, ["debtIssuance"]) && completeLine(forecast, ["debtRepayment"]);
  if (!netBorrowing && !debtFlows) missing.push("netBorrowingOrDebtFlows");
  return { viable: missing.length === 0, missing };
}

export function validateResidualIncomeBookRollForward(forecast: ForecastResult, pack: FactPack, shares: number | undefined): { valid: boolean; openingBookValuePerShare?: number; earningsPerShare?: number[]; closingBookValuePerShare?: number[]; missing: string[] } {
  const missing: string[] = [];
  const anchors = resolveValuationAnchors(pack);
  const openingBookValuePerShare = anchors.bookValuePerShare ?? (isFiniteNumber(anchors.totalEquity) && isFiniteNumber(shares) && shares > 0 ? anchors.totalEquity / shares : undefined);
  const netIncomePath = forecastLinePath(forecast, ["netIncome"]);
  const epsPath = forecastLinePath(forecast, ["eps", "earningsPerShare"]);
  const earningsPerShare = completeFinitePath(epsPath) ? [...epsPath] : completeFinitePath(netIncomePath) && isFiniteNumber(shares) && shares > 0 ? netIncomePath.map((value) => value / shares) : undefined;
  const directBookPath = forecastLinePath(forecast, ["bookValuePerShare", "bookValue"]);
  const equityPath = forecastLinePath(forecast, ["totalEquity", "stockholdersEquity"]);
  const closingBookValuePerShare = completeFinitePath(directBookPath) ? [...directBookPath] : completeFinitePath(equityPath) && isFiniteNumber(shares) && shares > 0 ? equityPath.map((value) => value / shares) : undefined;
  const dividends = completeFinitePath(forecastLinePath(forecast, ["dividendsPaid", "dividends"])) ? forecastLinePath(forecast, ["dividendsPaid", "dividends"]) as number[] : undefined;
  const issuance = completeFinitePath(forecastLinePath(forecast, ["equityIssuance"])) ? forecastLinePath(forecast, ["equityIssuance"]) as number[] : undefined;
  if (!isFiniteNumber(openingBookValuePerShare)) missing.push("openingBookValue");
  if (!earningsPerShare) missing.push("netIncomeOrEps");
  if (!closingBookValuePerShare && !(dividends && issuance)) missing.push("bookValueRollForward");
  if (missing.length > 0) return { valid: false, ...(isFiniteNumber(openingBookValuePerShare) ? { openingBookValuePerShare } : {}), ...(earningsPerShare ? { earningsPerShare } : {}), ...(closingBookValuePerShare ? { closingBookValuePerShare } : {}), missing };
  if (!dividends || !issuance || !isFiniteNumber(shares) || shares <= 0) return { valid: closingBookValuePerShare !== undefined, openingBookValuePerShare, earningsPerShare, closingBookValuePerShare, missing: [] };
  let expected = openingBookValuePerShare as number;
  for (let index = 0; index < (earningsPerShare as number[]).length; index += 1) {
    expected += (earningsPerShare as number[])[index] - dividends[index] / shares + issuance[index] / shares;
    if (closingBookValuePerShare && Math.abs(closingBookValuePerShare[index] - expected) > 1e-6 * Math.max(1, Math.abs(closingBookValuePerShare[index]), Math.abs(expected))) {
      missing.push("bookValueRollForwardIdentity");
      break;
    }
  }
  return { valid: missing.length === 0, openingBookValuePerShare, earningsPerShare, closingBookValuePerShare, missing };
}

function residualIncomeLinesViable(forecast: ForecastResult, pack: FactPack, shares: number | undefined): { viable: boolean; missing: string[] } {
  const validation = validateResidualIncomeBookRollForward(forecast, pack, shares);
  return { viable: validation.valid, missing: validation.missing };
}

function ddmLinesViable(plan: ValuationMethodPlan, forecast: ForecastResult, shares: number | undefined): { viable: boolean; missing: string[] } {
  const direct = completeLine(forecast, ["dps", "dividendPerShare"]);
  const total = isFiniteNumber(shares) && completeLine(forecast, ["dividendsPaid", "dividends"]);
  const assumptionPath = plan.assumptions.find((assumption) => ["dps", "dividendPerShare"].includes(assumption.variable) && Array.isArray(assumption.valuePath ?? assumption.path))?.valuePath
    ?? plan.assumptions.find((assumption) => ["dps", "dividendPerShare"].includes(assumption.variable) && Array.isArray(assumption.valuePath ?? assumption.path))?.path;
  return direct || total || (Array.isArray(assumptionPath) && assumptionPath.length === forecast.incomeStatement.length && assumptionPath.every(isFiniteNumber)) ? { viable: true, missing: [] } : { viable: false, missing: ["forecastDpsOrDividendsPaid"] };
}

function lineBlockersForMethod(method: ValuationMethodId, plan: ValuationMethodPlan, forecast: ForecastResult, pack: FactPack, shares: number | undefined): { missing: string[]; viable: boolean } {
  switch (method) {
    case "FCFF DCF":
      return fcffLinesViable(plan, forecast, pack);
    case "FCFE":
      return fcfeLinesViable(forecast);
    case "Residual Income":
      return residualIncomeLinesViable(forecast, pack, shares);
    case "DDM":
      return ddmLinesViable(plan, forecast, shares);
    case "P/E":
      return { viable: lineAvailable(forecast, ["netIncome", "eps", "earningsPerShare"]), missing: lineAvailable(forecast, ["netIncome", "eps", "earningsPerShare"]) ? [] : ["forecastNetIncomeOrEps"] };
    case "EV/EBITDA": {
      const direct = lineAvailable(forecast, ["ebitda"]);
      const derived = lineAvailable(forecast, ["ebit", "operatingIncome"]) && lineAvailable(forecast, ["depreciation", "depreciationAndAmortization", "da"]);
      return { viable: direct || derived, missing: direct || derived ? [] : ["forecastEbitdaOrEbitAndDa"] };
    }
    case "EV/Sales":
      return { viable: lineAvailable(forecast, ["revenue", "totalRevenue", "sales"]), missing: lineAvailable(forecast, ["revenue", "totalRevenue", "sales"]) ? [] : ["forecastRevenue"] };
    case "P/B": {
      const anchors = resolveValuationAnchors(pack);
      const direct = isFiniteNumber(anchors.bookValuePerShare);
      const derived = isFiniteNumber(shares) && isFiniteNumber(anchors.totalEquity);
      return { viable: direct || derived, missing: direct || derived ? [] : ["commonEquityOrBookValuePerShare"] };
    }
    case "SOTP": {
      const components = plan.components ?? [];
      const enterprise = components.some((component) => component.basis === "enterprise");
      const anchors = resolveValuationAnchors(pack);
      const numeric = components.every((component) => isFiniteNumber(component.value) && component.value >= 0 && component.rationale.trim().length > 0);
      const consistent = components.length > 0 && components.every((component) => component.basis === "enterprise" || component.basis === "equity") && (!enterprise || components.every((component) => component.basis === "enterprise"));
      const valid = numeric && consistent && (!enterprise || isFiniteNumber(anchors.netDebt));
      return { viable: valid, missing: valid ? [] : !numeric ? ["validComponentValuesAndRationales"] : consistent ? ["enterpriseBasisNetDebt"] : ["consistentEnterpriseOrEquityComponents"] };
    }
    case "NAV": {
      const components = plan.components ?? [];
      const assets = components.filter((component) => component.basis === "asset").length;
      const liabilities = components.filter((component) => component.basis === "liability").length;
      const numeric = components.every((component) => isFiniteNumber(component.value) && component.value >= 0 && component.rationale.trim().length > 0);
      const valid = assets > 0 && liabilities > 0 && numeric;
      return { viable: valid, missing: valid ? [] : !numeric ? ["validComponentValuesAndRationales"] : ["explicitAssetAndLiabilityComponents"] };
    }
  }
}

function validateTerminal(method: ValuationMethodId, plan: ValuationMethodPlan, pack: FactPack, requireEvidence: boolean, diagnostics: ValuationDiagnostic[]): { valid: boolean; policy?: ValuationTerminalPolicy; evidence: string[] } {
  const policy = terminalPolicyOf(plan);
  if (!policy) return { valid: false, evidence: [] };
  const expectedMetric: Record<string, ValuationTerminalPolicy["terminalMetric"]> = { "FCFF DCF": "fcff", FCFE: "fcfe", "Residual Income": "residual_income", DDM: "dividend" };
  if (plan.terminalPolicy && expectedMetric[method] && policy.terminalMetric !== expectedMetric[method]) {
    diagnostics.push(diagnostic("TERMINAL_METRIC_INVALID", `${method} requires terminalMetric=${expectedMetric[method]}.`, "error", "terminalPolicy.terminalMetric"));
    return { valid: false, evidence: [] };
  }
  if (!isFiniteNumber(policy.growth) || policy.growth <= -1 || policy.growth >= 1) {
    diagnostics.push(diagnostic("TERMINAL_GROWTH_INVALID", "Terminal growth must be a finite decimal greater than -100% and below 100%.", "error", "terminalGrowth"));
    return { valid: false, evidence: [] };
  }
  if (!isFiniteNumber(policy.maxValueShare) || policy.maxValueShare <= 0 || policy.maxValueShare >= 1) {
    diagnostics.push(diagnostic("TERMINAL_CAP_INVALID", "Terminal maximum value share must be between zero and one.", "error", "terminalPolicy.maxValueShare"));
    return { valid: false, evidence: [] };
  }
  const rate = assumptionOrTopLevel(plan, { key: "discountRate", anyOf: ["wacc", "discountRate", "costOfCapital", "costOfEquity", "requiredReturn", "discountRate", "ke"] });
  if (isFiniteNumber(rate.value) && rate.value <= policy.growth) {
    diagnostics.push(diagnostic("TERMINAL_SPREAD_INVALID", `Discount rate ${rate.value} must exceed terminal growth ${policy.growth}.`, "error", "terminalPolicy.growth"));
    return { valid: false, evidence: [] };
  }
  const evidence = [...(policy.evidenceIds ?? []), ...(plan.terminalGrowthEvidenceIds ?? []), ...(plan.evidenceIds ?? [])];
  if (requireEvidence && !evidenceReferencesExist(pack, evidence, plan)) {
    diagnostics.push(diagnostic("TERMINAL_EVIDENCE_MISSING", "Terminal policy requires valid fact or evidence references.", "error", "terminalPolicy.evidenceIds"));
    return { valid: false, evidence };
  }
  return { valid: true, policy, evidence };
}

function componentEvidenceValid(component: { factIds: string[]; evidenceIds: string[] }, pack: FactPack, plan: ValuationMethodPlan): boolean {
  const references = [...component.factIds, ...component.evidenceIds];
  return references.length > 0 && evidenceReferencesExist(pack, references, plan);
}

function evidenceDiagnosticsForPlan(method: ValuationMethodId, plan: ValuationMethodPlan, pack: FactPack, requireEvidence: boolean): { diagnostics: ValuationDiagnostic[]; references: string[]; missing: string[] } {
  const definition = VALUATION_METHOD_REGISTRY[method];
  const diagnostics: ValuationDiagnostic[] = [];
  const references = new Set<string>();
  const missing: string[] = [];
  for (const group of definition.requiredAssumptionGroups) {
    const resolved = evidenceRequiredForGroup(plan, group, pack);
    resolved.references.forEach((reference) => references.add(reference));
    if (resolved.missing) {
      missing.push(group.key);
      if (requireEvidence) diagnostics.push(diagnostic("VALUATION_EVIDENCE_MISSING", `${method} requires valid evidence for ${group.key}.`, "error", group.key));
      else diagnostics.push(diagnostic("VALUATION_EVIDENCE_UNVERIFIED", `${method} has no verified evidence reference for ${group.key}.`, "warning", group.key));
    }
  }
  if ((method === "SOTP" || method === "NAV") && requireEvidence) {
    for (const component of plan.components ?? []) {
      if (!componentEvidenceValid(component, pack, plan)) {
        missing.push(`component:${component.id}`);
        diagnostics.push(diagnostic("COMPONENT_EVIDENCE_MISSING", `${method} component ${component.id} requires valid explicit evidence.`, "error", `components.${component.id}`));
      }
    }
  }
  return { diagnostics, references: [...references].sort(), missing };
}

export interface ValuationMethodViability {
  methodId: ValuationMethodId | string;
  normalizedMethod: ValuationMethodId | null;
  status: "viable" | "unsupported" | "not_applicable" | "blocked";
  viable: boolean;
  suitability: ValuationMethodSuitability;
  dataSufficiency: ValuationDataSufficiency;
  diagnostics: ValuationDiagnostic[];
  blockers: string[];
  publicationBlocked: boolean;
  plan?: ValuationMethodPlan;
}

export interface ValuationViabilityInput {
  plans: readonly (ValuationMethodPlan | ValuationSpecification)[];
  forecast: ForecastResult;
  factPack: FactPack;
  architecture?: string;
  selectedMethod?: string;
  requireEvidence?: boolean;
}

function planForMethod(input: ValuationViabilityInput, method: ValuationMethodId): ValuationMethodPlan | undefined {
  const normalizedSelected = input.selectedMethod ? normalizeValuationMethod(input.selectedMethod) : undefined;
  const plans = [...input.plans].sort((left, right) => {
    const leftSelected = normalizeValuationMethod(left.method) === normalizedSelected ? 1 : 0;
    const rightSelected = normalizeValuationMethod(right.method) === normalizedSelected ? 1 : 0;
    return rightSelected - leftSelected || String(left.method ?? "").localeCompare(String(right.method ?? ""));
  });
  return plans.find((plan) => normalizeValuationMethod(plan.method) === method);
}

function missingFactNames(method: ValuationMethodId, definition: ValuationMethodDefinition, plan: ValuationMethodPlan, pack: FactPack, forecast: ForecastResult): { requiredFacts: string[]; missingFacts: string[] } {
  const anchors = resolveValuationAnchors(pack);
  const requiredFacts = ["sharesOutstanding"];
  const missingFacts = isFiniteNumber(anchors.sharesOutstanding) && anchors.sharesOutstanding > 0 ? [] : ["sharesOutstanding"];
  const enterpriseBasisSotp = method === "SOTP" && (plan.components ?? []).length > 0 && (plan.components ?? []).every((component) => component.basis === "enterprise");
  if (definition.requiresNetDebt || enterpriseBasisSotp) {
    requiredFacts.push("netDebtOrDebtAndCash");
    if (!isFiniteNumber(anchors.netDebt)) missingFacts.push("netDebtOrDebtAndCash");
  }
  if (method === "P/B") {
    requiredFacts.push("commonEquityOrBookValuePerShare");
    if (!isFiniteNumber(anchors.bookValuePerShare) && !(isFiniteNumber(anchors.totalEquity) && isFiniteNumber(anchors.sharesOutstanding))) missingFacts.push("commonEquityOrBookValuePerShare");
  }
  if (method === "Residual Income") {
    requiredFacts.push("openingBookValue");
    if (!isFiniteNumber(anchors.bookValuePerShare) && !(isFiniteNumber(anchors.totalEquity) && isFiniteNumber(anchors.sharesOutstanding))) missingFacts.push("openingBookValue");
  }
  return { requiredFacts, missingFacts };
}

function missingAssumptionNames(definition: ValuationMethodDefinition, plan: ValuationMethodPlan): string[] {
  return definition.requiredAssumptionGroups.filter((group) => assumptionOrTopLevel(plan, group).value === undefined).map((group) => group.key);
}

function assessOne(input: ValuationViabilityInput, method: ValuationMethodId): ValuationMethodViability {
  const definition = VALUATION_METHOD_REGISTRY[method];
  const architecture = input.architecture ?? input.forecast.architecture;
  const diagnostics: ValuationDiagnostic[] = [];
  const blockers: string[] = [];
  const applicable = !!architecture && (definition.applicableArchitectures as readonly string[]).includes(architecture);
  const suitability: ValuationMethodSuitability = {
    score: applicable ? 1 : 0,
    label: applicable ? "high" : "inapplicable",
    applicableArchitectures: [...definition.applicableArchitectures],
    reasons: applicable ? [`${method} is defined for the ${architecture} accounting architecture.`] : [`${method} is not economically applicable to the ${architecture ?? "unknown"} accounting architecture.`],
  };
  if (!applicable) {
    const message = `${method} is not applicable to accounting architecture ${architecture ?? "unknown"}.`;
    diagnostics.push(diagnostic("METHOD_NOT_APPLICABLE", message, "error", "architecture"));
    blockers.push(message);
  }
  const plan = planForMethod(input, method);
  if (!plan) {
    const message = `${method} has no explicit AI method plan with assumptions and evidence.`;
    diagnostics.push(diagnostic("METHOD_PLAN_MISSING", message, "error", "methodPlans"));
    blockers.push(message);
  }
  if (isForecastBlocked(input.forecast)) {
    const message = `Forecast is blocked: ${input.forecast.blockers?.join("; ") || "publicationBlocked=true"}.`;
    diagnostics.push(diagnostic("FORECAST_BLOCKED", message, "error", "forecast.status"));
    blockers.push(message);
  }
  const anchors = resolveValuationAnchors(input.factPack);
  const { requiredFacts, missingFacts } = plan
    ? missingFactNames(method, definition, plan, input.factPack, input.forecast)
    : { requiredFacts: ["sharesOutstanding"], missingFacts: [] };
  for (const fact of missingFacts) {
    const message = `${method} requires ${fact}; missing values are never replaced with zero.`;
    diagnostics.push(diagnostic("REQUIRED_FACT_MISSING", message, "error", fact));
    blockers.push(message);
  }
  const requiredAssumptions = plan ? definition.requiredAssumptionGroups.map((group) => group.key) : [];
  const missingAssumptions = plan ? missingAssumptionNames(definition, plan) : [];
  for (const assumption of missingAssumptions) {
    const message = `${method} requires a finite ${assumption} assumption.`;
    diagnostics.push(diagnostic("REQUIRED_ASSUMPTION_MISSING", message, "error", assumption));
    blockers.push(message);
  }
  if (definition.terminalPolicy === "required" && plan) {
    const terminal = validateTerminal(method, plan, input.factPack, input.requireEvidence ?? true, diagnostics);
    if (!terminal.valid && !blockers.some((blocker) => blocker.startsWith("Terminal") || blocker.includes("terminal"))) blockers.push(`${method} terminal policy is invalid or ungrounded.`);
  } else if (definition.terminalPolicy === "required") {
    const message = `${method} requires an explicit terminal policy.`;
    diagnostics.push(diagnostic("TERMINAL_POLICY_MISSING", message, "error", "terminalPolicy"));
    blockers.push(message);
  }
  let requiredForecastLines: string[] = [];
  let missingForecastLines: string[] = [];
  let evidenceIds: string[] = [];
  let missingEvidence: string[] = [];
  if (plan) {
    const lineStatus = lineBlockersForMethod(method, plan, input.forecast, input.factPack, anchors.sharesOutstanding);
    requiredForecastLines = [...new Set(lineStatus.missing.length === 0 ? methodForecastLines(method) : [...methodForecastLines(method), ...lineStatus.missing])];
    missingForecastLines = lineStatus.missing;
    for (const line of lineStatus.missing) {
      const message = `${method} requires forecast line data: ${line}.`;
      diagnostics.push(diagnostic("REQUIRED_FORECAST_LINE_MISSING", message, "error", line));
      blockers.push(message);
    }
    const evidenceStatus = evidenceDiagnosticsForPlan(method, plan, input.factPack, input.requireEvidence ?? true);
    diagnostics.push(...evidenceStatus.diagnostics);
    evidenceIds = evidenceStatus.references;
    missingEvidence = evidenceStatus.missing;
    for (const missing of evidenceStatus.missing) {
      if (input.requireEvidence) blockers.push(`${method} evidence is missing or invalid for ${missing}.`);
    }
  }
  const totalChecks = requiredFacts.length + requiredAssumptions.length + requiredForecastLines.length + (method === "SOTP" || method === "NAV" ? (plan?.components?.length ?? 0) : 0);
  const totalMissing = missingFacts.length + missingAssumptions.length + missingForecastLines.length + (method === "SOTP" || method === "NAV" ? (plan?.components?.length ?? 0) - (plan?.components?.filter((component) => componentEvidenceValid(component, input.factPack, plan)).length ?? 0) : 0);
  const score = totalChecks === 0 ? 0 : Math.max(0, 1 - totalMissing / totalChecks);
  const dataSufficiency: ValuationDataSufficiency = {
    score,
    label: score >= 0.95 ? "sufficient" : score >= 0.6 ? "partial" : "insufficient",
    requiredFacts,
    missingFacts,
    requiredForecastLines,
    missingForecastLines,
    requiredAssumptions,
    missingAssumptions,
    evidenceIds,
    missingEvidence,
  };
  const status = blockers.length === 0 && applicable && plan ? "viable" : applicable ? "blocked" : "not_applicable";
  return { methodId: method, normalizedMethod: method, status, viable: status === "viable", suitability, dataSufficiency, diagnostics, blockers: [...new Set(blockers)], publicationBlocked: status !== "viable", ...(plan ? { plan } : {}) };
}

function methodForecastLines(method: ValuationMethodId): string[] {
  switch (method) {
    case "FCFF DCF": return ["ebit", "tax", "depreciation", "capex", "workingCapital"];
    case "FCFE": return ["cfo", "capex", "netBorrowing"];
    case "Residual Income": return ["netIncome", "bookValue", "dividendsPaid", "equityIssuance"];
    case "DDM": return ["dps"];
    case "P/E": return ["netIncome"];
    case "EV/EBITDA": return ["ebitda"];
    case "EV/Sales": return ["revenue"];
    case "P/B": return ["totalEquity"];
    case "SOTP": return [];
    case "NAV": return [];
  }
}

export function assessValuationMethodViability(input: ValuationViabilityInput & { method: string }): ValuationMethodViability {
  const normalized = normalizeValuationMethod(input.method);
  if (!normalized) {
    const message = `Unsupported valuation method ${input.method}.`;
    return {
      methodId: input.method,
      normalizedMethod: null,
      status: "unsupported",
      viable: false,
      suitability: { score: 0, label: "inapplicable", applicableArchitectures: [], reasons: [message] },
      dataSufficiency: { score: 0, label: "insufficient", requiredFacts: [], missingFacts: [], requiredForecastLines: [], missingForecastLines: [], requiredAssumptions: [], missingAssumptions: [], evidenceIds: [], missingEvidence: [input.method] },
      diagnostics: [diagnostic("METHOD_UNSUPPORTED", message, "error", "methodology")],
      blockers: [message],
      publicationBlocked: true,
    };
  }
  return assessOne(input, normalized);
}

export function buildValuationViabilityMatrix(input: ValuationViabilityInput): ValuationMethodViability[] {
  return VALUATION_METHODS.map((method) => assessOne(input, method));
}

export function isValuationMethodApplicable(method: string, architecture: string): boolean {
  const definition = getValuationMethod(method);
  return !!definition && (definition.applicableArchitectures as readonly string[]).includes(architecture);
}

export function methodPlansFromSpecification(spec: ValuationSpecification): ValuationMethodPlan[] {
  const plans: ValuationMethodPlan[] = [];
  const add = (plan: ValuationMethodPlan | undefined): void => {
    if (!plan) return;
    const method = normalizeValuationMethod(plan.method);
    if (!method) return;
    const normalized: ValuationMethodPlan = {
      ...plan,
      method,
      variablesDrivingValuation: [...(plan.variablesDrivingValuation ?? [])],
      assumptions: (plan.assumptions ?? []).map((assumption) => ({ ...assumption })),
      ...(plan.evidence ? { evidence: plan.evidence.map((item) => ({ ...item, ...(item.factIds ? { factIds: [...item.factIds] } : {}) })) } : {}),
      ...(plan.evidenceIds ? { evidenceIds: [...plan.evidenceIds] } : {}),
      ...(plan.components ? { components: plan.components.map((component) => ({ ...component, factIds: [...component.factIds], evidenceIds: [...component.evidenceIds] })) } : {}),
    };
    if (!plans.some((candidate) => normalizeValuationMethod(candidate.method) === method)) plans.push(normalized);
  };
  add({
    method: normalizeValuationMethod(spec.methodology) ?? spec.selectedMethod ?? spec.methodology,
    rationale: spec.rationale,
    variablesDrivingValuation: spec.variablesDrivingValuation,
    assumptions: spec.assumptions,
    discountRate: spec.discountRate,
    discountRateRationale: spec.discountRateRationale,
    terminalAssumptions: spec.terminalAssumptions,
    terminalPolicy: spec.terminalPolicy,
    components: spec.components,
    evidence: spec.evidence,
    evidenceIds: spec.evidenceIds,
    discountRateEvidenceIds: spec.discountRateEvidenceIds,
    terminalGrowthEvidenceIds: spec.terminalGrowthEvidenceIds,
    sensitivityVariables: spec.sensitivityVariables,
  });
  for (const plan of spec.methodPlans ?? []) add(plan);
  return plans;
}

export function planToValuationSpecification(plan: ValuationMethodPlan, template?: ValuationSpecification): ValuationSpecification {
  const method = plan.method ?? "unknown";
  return {
    ...(template ?? {}),
    methodology: method,
    selectedMethod: method,
    rationale: plan.rationale,
    variablesDrivingValuation: [...(plan.variablesDrivingValuation ?? [])],
    assumptions: (plan.assumptions ?? []).map((assumption) => ({ ...assumption })),
    discountRate: plan.discountRate,
    discountRateRationale: plan.discountRateRationale,
    terminalAssumptions: plan.terminalAssumptions,
    terminalPolicy: plan.terminalPolicy,
    components: plan.components,
    evidence: plan.evidence,
    evidenceIds: plan.evidenceIds,
    discountRateEvidenceIds: plan.discountRateEvidenceIds,
    terminalGrowthEvidenceIds: plan.terminalGrowthEvidenceIds,
    sensitivityVariables: plan.sensitivityVariables,
    methodsConsidered: template?.methodsConsidered?.length ? template.methodsConsidered : [{ method, verdict: "selected", reason: plan.rationale }],
  };
}

export function evidenceForPlan(plan: ValuationMethodPlan, pack: FactPack, requireEvidence = true): { valid: boolean; references: string[]; missing: string[] } {
  const method = normalizeValuationMethod(plan.method);
  if (!method) return { valid: false, references: [], missing: ["supportedMethod"] };
  const result = evidenceDiagnosticsForPlan(method, plan, pack, requireEvidence);
  return { valid: result.missing.length === 0, references: result.references, missing: result.missing };
}

export function valuationMethodEvidenceRegistry(spec: ValuationMethodPlan): Map<string, ValuationEvidence> {
  const references = new Set<string>();
  for (const assumption of spec.assumptions ?? []) assumptionEvidenceReferences(assumption).forEach((reference) => references.add(reference));
  for (const component of spec.components ?? []) [...component.factIds, ...component.evidenceIds].forEach((reference) => references.add(reference));
  const registry = new Map((spec.evidence ?? []).map((item) => [item.id, item]));
  for (const reference of references) if (!registry.has(reference)) registry.set(reference, addEvidenceForSpec([], [reference])[0]);
  return registry;
}

export const VALUATION_METHOD_ALIASES = Object.freeze(Object.fromEntries(methodEntries.map((definition) => [definition.method, definition.aliases])));

export default {
  VALUATION_METHODS,
  VALUATION_METHOD_REGISTRY,
  VALUATION_METHOD_ALIASES,
  assessValuationMethodViability,
  buildValuationViabilityMatrix,
  evidenceForPlan,
  getValuationMethod,
  getValuationMethodDefinition,
  isValuationMethodApplicable,
  methodPlansFromSpecification,
  normalizeValuationMethod,
  planToValuationSpecification,
  valuationMethodEvidenceRegistry,
};
