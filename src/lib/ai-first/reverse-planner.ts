import { parseLlmJson } from "./llm";
import { DEPTH_DIRECTIVES, DEPTH_TOKEN_BUDGETS } from "./depth-guidance";
import { evidenceReferencesExist, isFiniteNumber, stableId } from "./valuation-helpers";
import { normalizeValuationMethod } from "./valuation-methods";
import type {
  CompanyUnderstanding,
  FactPack,
  ForecastSpecification,
  ReverseValuationPlan,
  ReverseVariableId,
  ValuationDiagnostic,
  ValuationResult,
} from "./types";

export type ReversePlannerTransport = (opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}) => Promise<string>;

export interface ReversePlannerInput {
  pack: FactPack;
  understanding: CompanyUnderstanding;
  forecastSpec: ForecastSpecification;
  valuation: ValuationResult;
  architecture?: string;
}

const VARIABLE_ALIASES: Record<string, ReverseVariableId> = {
  revenuecagr: "revenueCagr",
  revenuegrowth: "revenueCagr",
  cagr: "revenueCagr",
  ebitmargin: "ebitMargin",
  operatingmargin: "ebitMargin",
  margin: "ebitMargin",
  nim: "nim",
  netinterestmargin: "nim",
  roe: "roe",
  returnonequity: "roe",
  arpu: "arpu",
};

const SYSTEM_PROMPT = `You are an institutional reverse-valuation planner. Select exactly one economically meaningful variable to solve, or return unavailable when the deterministic model cannot solve it.

Supported variables: revenueCagr, ebitMargin, nim, roe, arpu.

RULES:
- Never select a variable merely because of company description.
- modelVariable must exactly match a known input variable in the supplied forecast model.
- The variable must have an explicit annual driver or assumption path and a real formula linkage to forecastLine.
- valuationMethod must match the ready deterministic valuation method.
- range must be an explicit bounded [min,max] in the variable's unit. Do not invent defaults.
- revenueCagr is solvable only for methods and model paths where revenue changes cash flow/earnings value.
- ebitMargin requires an actual margin path linked to EBIT/earnings.
- nim requires a bank/depository model with an actual NIM path linked to net interest income.
- roe requires residual income or P/B plus an actual ROE/earnings/book-value path.
- arpu requires an actual ARPU path linked to revenue.
- If any condition is absent, return status unavailable with a precise blocker.

Respond with ONLY JSON:
{
  "status": "viable|unavailable",
  "variable": "revenueCagr|ebitMargin|nim|roe|arpu|null",
  "why": "string",
  "unit": "decimal|currency",
  "range": {"min":0.0,"max":0.2},
  "economicLinkage": "mechanism → financial line → valuation",
  "forecastLinkage": "modelVariable → formula path → forecastLine",
  "modelVariable": "exact model input name or empty",
  "forecastLine": "exact forecast line or empty",
  "method": "valuation method",
  "factIds": ["F-..."],
  "evidenceIds": ["string"],
  "blockers": ["string"]
}

${DEPTH_DIRECTIVES.valuation}`;

function diagnostic(code: string, message: string, severity: ValuationDiagnostic["severity"] = "error", field?: string): ValuationDiagnostic {
  return { code, severity, message, ...(field ? { field } : {}) };
}

export function normalizeReverseVariable(value: unknown): ReverseVariableId | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return VARIABLE_ALIASES[key] ?? null;
}

function modelVariable(forecastSpec: ForecastSpecification, variable: string) {
  const normalized = variable.toLowerCase();
  return forecastSpec.variables.find((candidate) => candidate.kind === "input" && candidate.name.toLowerCase() === normalized);
}

function variablePath(forecastSpec: ForecastSpecification, variable: string): number[] | undefined {
  const direct = forecastSpec.driverPaths[variable] ?? Object.entries(forecastSpec.driverPaths).find(([key]) => key.toLowerCase() === variable.toLowerCase())?.[1];
  if (Array.isArray(direct) && direct.length === forecastSpec.horizonYears && direct.every(isFiniteNumber)) return [...direct];
  const assumption = forecastSpec.assumptions.find((candidate) => candidate.variable.toLowerCase() === variable.toLowerCase());
  const path = assumption?.valuePath ?? assumption?.path;
  return Array.isArray(path) && path.length === forecastSpec.horizonYears && path.every(isFiniteNumber) ? [...path] : undefined;
}

function variableInfluences(forecastSpec: ForecastSpecification, variable: string, line: string, seen = new Set<string>()): boolean {
  const normalizedVariable = variable.toLowerCase();
  const normalizedLine = line.toLowerCase();
  if (normalizedVariable === normalizedLine) return true;
  if (seen.has(normalizedLine)) return false;
  seen.add(normalizedLine);
  const formula = forecastSpec.formulas.find((candidate) => candidate.output.toLowerCase() === normalizedLine);
  if (!formula) return false;
  return formula.variables.some((dependency) => dependency.toLowerCase() === normalizedVariable || variableInfluences(forecastSpec, dependency, normalizedLine, seen));
}

function expectedLines(variable: ReverseVariableId, architecture?: string): string[] {
  switch (variable) {
    case "revenueCagr": return ["revenue", "totalRevenue", "ebit", "netIncome", "cfo", "fcff", "fcfe"];
    case "ebitMargin": return ["ebit", "operatingIncome", "ebitda", "netIncome", "cfo", "fcff"];
    case "nim": return architecture === "depository" ? ["netInterestIncome", "nii", "interestIncome", "revenue", "netIncome"] : [];
    case "roe": return ["netIncome", "eps", "totalEquity", "bookValuePerShare"];
    case "arpu": return ["revenue", "totalRevenue"];
  }
}

function allowedMethods(variable: ReverseVariableId): string[] {
  switch (variable) {
    case "revenueCagr": return ["FCFF DCF", "FCFE", "P/E", "EV/EBITDA", "EV/Sales", "SOTP"];
    case "ebitMargin": return ["FCFF DCF", "FCFE", "P/E", "EV/EBITDA", "Residual Income", "SOTP"];
    case "nim": return ["Residual Income", "P/B", "DDM"];
    case "roe": return ["Residual Income", "P/B"];
    case "arpu": return ["FCFF DCF", "FCFE", "P/E", "EV/Sales", "SOTP"];
  }
}

export function reversePlannerContext(input: ReversePlannerInput): string {
  return [
    `COMPANY: ${input.understanding.companyName} (${input.pack.ticker})`,
    `ECONOMIC ABSTRACTION: ${input.understanding.primaryEconomicAbstraction}`,
    `ARCHITECTURE: ${input.architecture ?? input.valuation.provenance?.architecture ?? "unknown"}`,
    `VALUATION: ${input.valuation.method ?? input.valuation.methodology} | status=${input.valuation.status ?? "legacy"} | fairValue=${input.valuation.fairValuePerShare ?? "missing"}`,
    "",
    "KNOWN FORECAST INPUTS:",
    ...input.forecastSpec.variables.filter((variable) => variable.kind === "input").map((variable) => `- ${variable.name} | unit=${variable.unit} | base=${variable.baseValue ?? "missing"} | id=${variable.id ?? "missing"}`),
    "DRIVER PATHS:",
    ...Object.entries(input.forecastSpec.driverPaths).map(([variable, path]) => `- ${variable}: ${path.join(", ")}`),
    "ASSUMPTION PATHS:",
    ...input.forecastSpec.assumptions.map((assumption) => `- ${assumption.variable}: ${assumption.valuePath?.join(", ") ?? assumption.path?.join(", ") ?? assumption.value} ${assumption.unit}`),
    "FORMULA LINKS:",
    ...input.forecastSpec.formulas.map((formula) => `- ${formula.output}=${formula.expression} | variables=${formula.variables.join(",")}`),
    "FACT IDS:",
    ...[...input.pack.market.facts, ...input.pack.balanceSheet.facts, ...input.pack.incomeStatement.facts, ...input.pack.cashFlow.facts].filter((fact) => fact.value !== undefined).slice(0, 80).map((fact) => `- ${fact.factId ?? fact.metric}`),
  ].join("\n");
}

function normalizePlan(raw: any, input: ReversePlannerInput): ReverseValuationPlan {
  const variable = normalizeReverseVariable(raw?.variable);
  const method = normalizeValuationMethod(input.valuation.method ?? input.valuation.methodology) ?? String(raw?.method ?? input.valuation.methodology);
  const modelVariableName = String(raw?.modelVariable ?? "");
  return {
    id: stableId("REVPLAN", [input.pack.ticker, input.forecastSpec.modelId ?? input.forecastSpec.architecture, method, variable ?? "unavailable", modelVariableName, raw?.forecastLine ?? ""]),
    ...(variable ? { variable } : { variable: "revenueCagr" }),
    why: String(raw?.why ?? ""),
    unit: raw?.unit === "currency" ? "currency" : "decimal",
    range: {
      min: typeof raw?.range?.min === "number" && Number.isFinite(raw.range.min) ? raw.range.min : Number.NaN,
      max: typeof raw?.range?.max === "number" && Number.isFinite(raw.range.max) ? raw.range.max : Number.NaN,
    },
    economicLinkage: String(raw?.economicLinkage ?? ""),
    forecastLinkage: String(raw?.forecastLinkage ?? ""),
    modelVariable: modelVariableName,
    forecastLine: String(raw?.forecastLine ?? ""),
    method,
    factIds: [...new Set<string>(Array.isArray(raw?.factIds) ? raw.factIds.map((entry: unknown) => String(entry)) : [])],
    evidenceIds: [...new Set<string>(Array.isArray(raw?.evidenceIds) ? raw.evidenceIds.map((entry: unknown) => String(entry)) : [])],
    status: raw?.status === "unavailable" || !variable ? "unavailable" : "viable",
    ...(Array.isArray(raw?.blockers) || !variable ? { blockers: [...(Array.isArray(raw?.blockers) ? raw.blockers.map((entry: unknown) => String(entry)) : []), ...(!variable ? ["No supported reverse variable was selected."] : [])] } : {}),
  };
}

export function validateReverseValuationPlan(plan: ReverseValuationPlan, input: ReversePlannerInput): ReverseValuationPlan {
  const diagnostics: ValuationDiagnostic[] = [];
  const blockers: string[] = [...(plan.blockers ?? [])];
  const variable = normalizeReverseVariable(plan.variable);
  if (!variable) {
    const message = "Reverse plan does not select a supported variable.";
    diagnostics.push(diagnostic("REVERSE_VARIABLE_UNSUPPORTED", message));
    blockers.push(message);
  }
  if (plan.unit !== "decimal" && plan.unit !== "currency") {
    const message = "Reverse plan unit must be decimal or currency.";
    diagnostics.push(diagnostic("REVERSE_UNIT_INVALID", message));
    blockers.push(message);
  }
  if (variable === "arpu" && plan.unit !== "currency") {
    const message = "ARPU must use a currency unit.";
    diagnostics.push(diagnostic("REVERSE_UNIT_INVALID", message, "error", "unit"));
    blockers.push(message);
  }
  if (!isFiniteNumber(plan.range.min) || !isFiniteNumber(plan.range.max) || plan.range.min >= plan.range.max) {
    const message = "Reverse plan requires an explicit finite range with min < max.";
    diagnostics.push(diagnostic("REVERSE_RANGE_INVALID", message));
    blockers.push(message);
  } else if (plan.unit === "decimal" && (plan.range.min < -1 || plan.range.max > 2)) {
    const message = "Decimal reverse ranges must remain within [-100%, 200%].";
    diagnostics.push(diagnostic("REVERSE_RANGE_UNECONOMIC", message));
    blockers.push(message);
  } else if (plan.unit === "currency" && plan.range.min < 0) {
    const message = "Currency reverse ranges cannot include negative unit values.";
    diagnostics.push(diagnostic("REVERSE_RANGE_UNECONOMIC", message));
    blockers.push(message);
  }
  if (!plan.why.trim() || !plan.economicLinkage.trim() || !plan.forecastLinkage.trim()) {
    const message = "Reverse plan requires why, economic linkage, and forecast linkage.";
    diagnostics.push(diagnostic("REVERSE_LINKAGE_MISSING", message));
    blockers.push(message);
  }
  if (input.valuation.status !== "ready" || !isFiniteNumber(input.valuation.fairValuePerShare)) {
    const message = "Reverse valuation requires a ready deterministic valuation method.";
    diagnostics.push(diagnostic("REVERSE_VALUATION_BLOCKED", message));
    blockers.push(message);
  }
  const selectedMethod = normalizeValuationMethod(input.valuation.method ?? input.valuation.methodology);
  if (selectedMethod !== normalizeValuationMethod(plan.method)) {
    const message = `Reverse plan method ${plan.method} does not match executed valuation ${String(input.valuation.method ?? input.valuation.methodology)}.`;
    diagnostics.push(diagnostic("REVERSE_METHOD_MISMATCH", message));
    blockers.push(message);
  }
  const definition = modelVariable(input.forecastSpec, plan.modelVariable);
  if (!definition) {
    const message = `Reverse model variable ${plan.modelVariable || "missing"} is not a known input variable.`;
    diagnostics.push(diagnostic("REVERSE_MODEL_VARIABLE_UNKNOWN", message));
    blockers.push(message);
  }
  const semanticPatterns: Record<ReverseVariableId, RegExp> = {
    revenueCagr: /revenue|volume|price|user|subscriber|arpu|customer/i,
    ebitMargin: /margin|ebit|operating/i,
    nim: /nim|interest/i,
    roe: /roe|return.*equity|equity|netincome|margin/i,
    arpu: /arpu/i,
  };
  if (variable && definition && !semanticPatterns[variable].test(definition.name)) {
    const message = `${plan.modelVariable} is not a semantically valid model input for ${variable}.`;
    diagnostics.push(diagnostic("REVERSE_VARIABLE_SEMANTICS_INVALID", message));
    blockers.push(message);
  }
  if (!variablePath(input.forecastSpec, plan.modelVariable)) {
    const message = `Reverse model variable ${plan.modelVariable || "missing"} has no explicit annual path.`;
    diagnostics.push(diagnostic("REVERSE_MODEL_PATH_MISSING", message));
    blockers.push(message);
  }
  const architecture = input.architecture ?? input.valuation.provenance?.architecture ?? input.forecastSpec.architecture;
  const lines = variable ? expectedLines(variable, architecture) : [];
  const linked = !!variable && lines.some((line) => line.toLowerCase() === plan.forecastLine.toLowerCase()) && variableInfluences(input.forecastSpec, plan.modelVariable, plan.forecastLine);
  if (!linked) {
    const message = `${plan.modelVariable || "Selected variable"} does not drive ${plan.forecastLine || "a compatible forecast line"} in the supplied model.`;
    diagnostics.push(diagnostic("REVERSE_FORECAST_LINK_INVALID", message));
    blockers.push(message);
  }
  if (variable && !allowedMethods(variable).includes(String(selectedMethod))) {
    const message = `${variable} is not solvable with the selected ${String(selectedMethod)} method.`;
    diagnostics.push(diagnostic("REVERSE_METHOD_UNSOLVABLE", message));
    blockers.push(message);
  }
  if (variable === "nim" && architecture !== "depository") {
    const message = "NIM reverse valuation requires a depository accounting architecture.";
    diagnostics.push(diagnostic("REVERSE_NIM_ARCHITECTURE_INAPPLICABLE", message));
    blockers.push(message);
  }
  if (!evidenceReferencesExist(input.pack, [...plan.factIds, ...plan.evidenceIds])) {
    const message = "Reverse plan requires valid fact or evidence references.";
    diagnostics.push(diagnostic("REVERSE_EVIDENCE_INVALID", message));
    blockers.push(message);
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    ...plan,
    ...(variable ? { variable } : {}),
    status: uniqueBlockers.length === 0 ? "viable" : plan.status === "unavailable" || uniqueBlockers.length > 0 ? "unavailable" : "invalid",
    diagnostics,
    blockers: uniqueBlockers,
    publicationBlocked: uniqueBlockers.length > 0,
  };
}

export async function buildReverseValuationPlan(transport: ReversePlannerTransport, input: ReversePlannerInput): Promise<ReverseValuationPlan> {
  const response = await transport({
    system: SYSTEM_PROMPT,
    user: `REVERSE VALUATION CONTEXT\n=======================\n${reversePlannerContext(input)}\n\nTASK\n====\nReturn one evidence-backed solvable plan or an explicit unavailable result. Return only JSON.`,
    temperature: 0.15,
    maxTokens: DEPTH_TOKEN_BUDGETS.valuation,
    jsonMode: true,
  });
  const parsed = parseLlmJson<Record<string, any>>(response);
  if (!parsed || typeof parsed !== "object") throw new Error(`AI reverse planner returned unparseable output for ${input.pack.ticker}`);
  return validateReverseValuationPlan(normalizePlan(parsed, input), input);
}

export default {
  buildReverseValuationPlan,
  normalizeReverseVariable,
  reversePlannerContext,
  validateReverseValuationPlan,
};
