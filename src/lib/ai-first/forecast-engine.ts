import type { CompanyUnderstanding, EconomicEngine, FactPack, ForecastSpecification, ForecastResult, ProvenanceTier } from "./types";
import { compileForecast } from "./forecast-compiler";
import { selectAccountingArchitecture, type AccountingArchitecture } from "./accounting-architecture";
import { enforceStatementIdentities, type IdentityCheck } from "./statement-identities";
import { validateModelSpec, type ModelSpecValidationResult } from "./model-spec-validator";

export interface ForecastEngineInput {
  model: ForecastSpecification;
  factPack: FactPack;
  architecture?: AccountingArchitecture;
  understanding?: Partial<CompanyUnderstanding>;
  engine?: Partial<EconomicEngine>;
  validationOptions?: {
    requireEvidence?: boolean;
    enforceCanonicalBases?: boolean;
    allowUnresolvedBaseValues?: boolean;
  };
  validation?: ModelSpecValidationResult;
}

export interface ForecastEngineOutput {
  forecast: ForecastResult;
  formulasEvaluated: Record<string, number | null>;
  identityChecks: IdentityCheck[];
  provenance: Record<string, ProvenanceTier>;
  plugs: string[];
  validation?: ModelSpecValidationResult;
  architecture?: AccountingArchitecture;
  status: "ready" | "blocked" | "incomplete";
  blockers: string[];
  publicationBlocked: boolean;
}

function blockedResult(validation: ModelSpecValidationResult, architecture?: AccountingArchitecture): ForecastEngineOutput {
  const blockers = validation.errors.map((entry) => `${entry.code}: ${entry.message}`);
  const identityChecks: IdentityCheck[] = [{ check: "Forecast execution is blocked", pass: false, critical: true, code: "MODEL_SPEC_INVALID", detail: blockers.join("; ") || "Model validation failed" }];
  const forecast: ForecastResult = {
    incomeStatement: [],
    balanceSheet: [],
    cashFlow: [],
    identityChecks,
    status: "blocked",
    publicationStatus: "blocked",
    blockers,
    publicationBlocked: true,
    validation: { valid: false, issues: blockers },
    modelValidation: { valid: false, issues: blockers },
    ...(architecture ? { architecture: architecture.id } : {}),
  };
  const formulasEvaluated: Record<string, number | null> = {};
  for (const formula of validation.spec?.formulas ?? []) formulasEvaluated[formula.id] = null;
  return { forecast, formulasEvaluated, identityChecks, provenance: {}, plugs: [], validation, architecture, status: "blocked", blockers, publicationBlocked: true };
}

function valueForYear(result: ForecastResult, statement: "incomeStatement" | "balanceSheet" | "cashFlow", key: string): number | undefined {
  const years = result[statement];
  return years[years.length - 1]?.values?.[key];
}

export function executeForecast(input: ForecastEngineInput): ForecastEngineOutput {
  const architecture = input.architecture ?? selectAccountingArchitecture({ understanding: input.understanding, engine: input.engine, factPack: input.factPack });
  let validation = input.validation ?? validateModelSpec(input.model, input.factPack, {
    requireEvidence: input.validationOptions?.requireEvidence ?? false,
    enforceCanonicalBases: input.validationOptions?.enforceCanonicalBases ?? false,
    allowUnresolvedBaseValues: input.validationOptions?.allowUnresolvedBaseValues ?? true,
    allowComputedDriverPaths: true,
  });
  if (input.model.validation?.valid === false && validation.valid) {
    const markerIssues = input.model.validation.issues.map((message) => `MODEL_SPEC_INVALID: ${message}`);
    const marker = { code: "SCHEMA_INVALID" as const, path: "$.validation", message: markerIssues.join("; "), severity: "error" as const, blocking: true };
    validation = { ...validation, valid: false, ok: false, blocked: true, issues: [...validation.issues, marker], errors: [...validation.errors, marker], modelValidation: { valid: false, issues: markerIssues } } as ModelSpecValidationResult;
  }
  if (!validation.valid) return blockedResult(validation, architecture);
  const compiled = compileForecast({ model: input.model, factPack: input.factPack, architecture });
  const identity = enforceStatementIdentities({
    incomeStatement: compiled.years.map((year) => year.incomeStatement),
    balanceSheet: compiled.years.map((year) => year.balanceSheet),
    cashFlow: compiled.years.map((year) => year.cashFlow),
  }, { architecture, baseValues: compiled.baseValues });
  const coverageChecks: IdentityCheck[] = [];
  const allValues = compiled.years.flatMap((year) => [year.incomeStatement.values, year.balanceSheet.values, year.cashFlow.values]);
  const lineAliases: Record<string, string[]> = { netInterestIncome: ["netInterestIncome", "netInterest", "nii"], interestIncome: ["interestIncome", "interestIncomeTotal"], interestExpense: ["interestExpense", "interestExpenseTotal"], feeRevenue: ["feeRevenue", "feeBasedRevenue", "revenue"], rentalIncome: ["rentalIncome", "rental"], properties: ["properties", "propertyPlantAndEquipment", "ppe"], premiums: ["premiums", "premiumRevenue"], claims: ["claims", "claimsExpense"] };
  const hasValue = (key: string): boolean => {
    const aliases = lineAliases[key] ?? [key];
    return allValues.some((values) => aliases.some((alias) => typeof values[alias] === "number" && Number.isFinite(values[alias])));
  };
  const statementCheck = (prefix: string): boolean => identity.identityChecks.some((check) => check.code?.startsWith(prefix));
  if (!statementCheck("IS_") && architecture.primaryStatement !== "balanceSheet") coverageChecks.push({ check: "Income statement identity coverage", pass: false, critical: true, code: "IS_IDENTITIES_UNAVAILABLE", detail: "No complete income identity was executable" });
  if (!statementCheck("BS_")) coverageChecks.push({ check: "Balance sheet identity coverage", pass: false, critical: true, code: "BS_IDENTITIES_UNAVAILABLE", detail: "No complete balance-sheet identity was executable" });
  if (architecture.supportsCashFlow && !statementCheck("CF_")) coverageChecks.push({ check: "Cash flow identity coverage", pass: false, critical: true, code: "CF_IDENTITIES_UNAVAILABLE", detail: "No complete cash-flow identity was executable" });
  for (const line of architecture.requiredLines) if (!hasValue(line)) coverageChecks.push({ check: `Required architecture line ${line}`, pass: false, critical: true, code: "MISSING_REQUIRED_ARCHITECTURE_LINE", detail: `No canonical or forecast value was available for ${line}` });
  identity.identityChecks.push(...coverageChecks);
  const blockers = [...compiled.blockers];
  for (const check of identity.identityChecks) if (check.critical && !check.pass) blockers.push(`${check.code ?? "IDENTITY"}: ${check.detail ?? check.check}`);
  const forecast: ForecastResult = {
    incomeStatement: compiled.years.map((year) => year.incomeStatement),
    balanceSheet: compiled.years.map((year) => year.balanceSheet),
    cashFlow: compiled.years.map((year) => year.cashFlow),
    identityChecks: identity.identityChecks,
    status: blockers.length === 0 && identity.identityChecks.length > 0 ? "ready" : "blocked",
    publicationStatus: blockers.length === 0 && identity.identityChecks.length > 0 ? "ready" : "blocked",
    blockers: [...new Set(blockers)],
    publicationBlocked: blockers.length > 0 || identity.identityChecks.length === 0,
    validation: { valid: true, issues: [] },
    modelValidation: { valid: true, issues: validation.issues.map((entry) => `${entry.code}: ${entry.message}`) },
    architecture: architecture.id,
  };
  const formulasEvaluated: Record<string, number | null> = {};
  for (const formula of input.model.formulas) {
    const result = compiled.formulaValues[compiled.formulaValues.length - 1]?.[formula.id];
    formulasEvaluated[formula.id] = result === undefined ? null : result;
  }
  return {
    forecast,
    formulasEvaluated,
    identityChecks: identity.identityChecks,
    provenance: compiled.provenance,
    plugs: [],
    validation,
    architecture,
    status: forecast.status === "ready" ? "ready" : "blocked",
    blockers: forecast.blockers ?? [],
    publicationBlocked: forecast.publicationBlocked === true,
  };
}

export function renderForecastContext(forecast: ForecastResult, agentKind: "valuation" | "scenarios" | "risks" | "thesis"): string {
  const lines: string[] = [`FORECAST CONTEXT — ${agentKind.toUpperCase()}`, `Horizon: ${forecast.incomeStatement.length} years`, `Status: ${forecast.status ?? "unknown"}`];
  if (forecast.blockers?.length) lines.push(`Blockers: ${forecast.blockers.join(" | ")}`);
  lines.push("");
  for (const year of forecast.incomeStatement) {
    const values = year.values;
    const format = (value: number | undefined): string => value === undefined ? "N/A" : String(Math.round(value * 100) / 100);
    lines.push(`  ${year.period}: Revenue ${format(values.revenue)} | EBIT ${format(values.ebit)} | NI ${format(values.netIncome)} | Equity ${format(valueForYear(forecast, "balanceSheet", "totalEquity"))} | CFO ${format(valueForYear(forecast, "cashFlow", "cfo"))}`);
  }
  const failed = forecast.identityChecks.filter((check) => !check.pass);
  if (failed.length > 0) {
    lines.push("", "IDENTITY BLOCKERS:");
    for (const check of failed) lines.push(`  - ${check.check}: ${check.detail ?? "failed"}`);
  }
  return lines.join("\n");
}

export default { executeForecast, renderForecastContext };
