export const FCFF_WHAT_IF_VERSION = "fcff-what-if-v1" as const;

export const SUPPORTED_WHAT_IF_METHODS = ["FCFF_DCF", "FCFF", "DCF"] as const;

export type SupportedWhatIfMethod = (typeof SUPPORTED_WHAT_IF_METHODS)[number];

export interface NumericRange {
  min: number;
  max: number;
}

export interface WhatIfBounds {
  wacc: NumericRange;
  terminalGrowth: NumericRange;
  terminalSpread: number;
}

export const DEFAULT_WHAT_IF_BOUNDS: WhatIfBounds = {
  wacc: { min: 0.01, max: 0.5 },
  terminalGrowth: { min: -0.1, max: 0.1 },
  terminalSpread: 0.02,
};

export interface WhatIfBoundsInput {
  wacc?: Partial<NumericRange>;
  terminalGrowth?: Partial<NumericRange>;
  terminalGrowthRate?: Partial<NumericRange>;
  terminalSpread?: number;
  minimumTerminalSpread?: number;
}

export interface WhatIfOverrides {
  wacc?: number | null;
  waccOverride?: number | null;
  terminalGrowthRate?: number | null;
  terminalGrowth?: number | null;
  terminalGrowthOverride?: number | null;
}

export interface FCFFWhatIfAssumptionsInput {
  wacc?: number | null;
  waccOverride?: number | null;
  baseWacc?: number | null;
  terminalGrowthRate?: number | null;
  terminalGrowth?: number | null;
  terminalGrowthOverride?: number | null;
  baseTerminalGrowthRate?: number | null;
  baseTerminalGrowth?: number | null;
}

export interface FCFFWhatIfProjectionInput {
  fcff?: number;
}

export interface FCFFWhatIfBaseInput {
  method?: string;
  selectedModel?: string;
  valuationMethod?: string;
  wacc?: number | null;
  waccOverride?: number | null;
  baseWacc?: number | null;
  terminalGrowthRate?: number | null;
  terminalGrowth?: number | null;
  baseTerminalGrowthRate?: number | null;
  baseTerminalGrowth?: number | null;
  assumptions?: FCFFWhatIfAssumptionsInput;
  fcff?: readonly number[];
  fcffs?: readonly number[];
  fcffPath?: readonly number[];
  fcffSeries?: readonly number[];
  forecastFcff?: readonly number[];
  projections?: readonly FCFFWhatIfProjectionInput[];
  terminalYearFcff?: number | null;
  sumPvFcff?: number | null;
  terminalValue?: number | null;
  unadjustedTerminalValue?: number | null;
  pvTerminalValue?: number | null;
  enterpriseValue?: number | null;
  equityValue?: number | null;
  intrinsicValue?: number | null;
  fairValue?: number | null;
  fairValuePerShare?: number | null;
  netDebt?: number | null;
  totalDebt?: number | null;
  cashAndEquiv?: number | null;
  cash?: number | null;
  lessDebt?: number | null;
  plusCash?: number | null;
  sharesOutstanding?: number | null;
  dilutedSharesOutstanding?: number | null;
  shares?: number | null;
  currentPrice?: number | null;
  currentMarketPrice?: number | null;
  terminalValueCapped?: boolean;
  terminalValueCapMultiple?: number | null;
  dcf?: FCFFWhatIfBaseInput;
}

export interface FCFFWhatIfInput {
  method?: string;
  valuationMethod?: string;
  selectedModel?: string;
  base?: FCFFWhatIfBaseInput;
  baseValuation?: FCFFWhatIfBaseInput;
  dcf?: FCFFWhatIfBaseInput;
  assumptions?: FCFFWhatIfAssumptionsInput;
  overrides?: WhatIfOverrides;
  override?: WhatIfOverrides;
  overlay?: WhatIfOverrides;
  whatIf?: WhatIfOverrides;
  wacc?: number | null;
  waccOverride?: number | null;
  terminalGrowthRate?: number | null;
  terminalGrowth?: number | null;
  terminalGrowthOverride?: number | null;
  currentPrice?: number | null;
  currentMarketPrice?: number | null;
  fcff?: readonly number[];
  fcffs?: readonly number[];
  fcffPath?: readonly number[];
  fcffSeries?: readonly number[];
  forecastFcff?: readonly number[];
  projections?: readonly FCFFWhatIfProjectionInput[];
  bounds?: WhatIfBoundsInput;
  terminalValueCapMultiple?: number | null;
  strictBounds?: boolean;
  boundsMode?: "clamp" | "reject";
}

export type WhatIfInput = FCFFWhatIfInput;
export type WhatIfResult = FCFFWhatIfResult;
export type FCFFOverlayInput = FCFFWhatIfInput;
export type FCFFOverlayResult = FCFFWhatIfResult;

export interface FCFFValuationSnapshot {
  sumPvFcff: number;
  terminalYearFcff: number;
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  equityValue: number;
  fairValuePerShare: number;
  currentPrice: number | null;
  upsideDownside: number | null;
  terminalValueCapped: boolean;
  unadjustedTerminalValue: number;
}

export interface WhatIfBoundValue {
  requested: number | null;
  applied: number;
  min: number;
  max: number;
  clamped: boolean;
}

export interface WhatIfBoundApplication {
  wacc: WhatIfBoundValue;
  terminalGrowth: WhatIfBoundValue;
  terminalSpread: {
    minimum: number;
    actual: number;
    satisfied: boolean;
    adjusted: boolean;
  };
}

export type FCFFWhatIfStatus = "ok" | "unsupported_method" | "invalid_input";

export interface FCFFWhatIfResult {
  version: typeof FCFF_WHAT_IF_VERSION;
  status: FCFFWhatIfStatus;
  supported: boolean;
  method: string;
  requested: {
    wacc: number | null;
    terminalGrowthRate: number | null;
  };
  overrides: {
    wacc: number | null;
    terminalGrowthRate: number | null;
  };
  applied: {
    wacc: number;
    terminalGrowthRate: number;
  } | null;
  bounded: WhatIfBoundApplication | null;
  base: FCFFValuationSnapshot | null;
  valuation: FCFFValuationSnapshot | null;
  result: FCFFValuationSnapshot | null;
  baseValue: number | null;
  value: number | null;
  fairValue: number | null;
  baseParity: boolean;
  diagnostics: string[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readString(source: UnknownRecord, key: string, path: string): string | null | undefined {
  if (!hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${path}.${key} must be a string`);
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readNumber(source: UnknownRecord, key: string, path: string): number | null | undefined {
  if (!hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path}.${key} must be a finite number`);
  return value;
}

function readBoolean(source: UnknownRecord, key: string, path: string): boolean | null | undefined {
  if (!hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${path}.${key} must be a boolean`);
  return value;
}

function readNumberFromSources(sources: Array<{ source: UnknownRecord; keys: string[]; path: string }>): number | null {
  for (const entry of sources) {
    for (const key of entry.keys) {
      const value = readNumber(entry.source, key, entry.path);
      if (value !== undefined) return value;
    }
  }
  return null;
}

function readStringFromSources(sources: Array<{ source: UnknownRecord; keys: string[]; path: string }>): string | null {
  for (const entry of sources) {
    for (const key of entry.keys) {
      const value = readString(entry.source, key, entry.path);
      if (value !== undefined) return value;
    }
  }
  return null;
}

function readBooleanFromSources(sources: Array<{ source: UnknownRecord; keys: string[]; path: string }>): boolean | null {
  for (const entry of sources) {
    for (const key of entry.keys) {
      const value = readBoolean(entry.source, key, entry.path);
      if (value !== undefined) return value;
    }
  }
  return null;
}

function normalizeMethod(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function methodFromInput(input: UnknownRecord, base: UnknownRecord | null, model: UnknownRecord | null): string {
  const value = readStringFromSources([
    { source: input, keys: ["method", "valuationMethod", "selectedModel"], path: "$" },
    { source: base ?? {}, keys: ["method", "valuationMethod", "selectedModel"], path: "$.base" },
    { source: model ?? {}, keys: ["method", "valuationMethod", "selectedModel"], path: "$.base.dcf" },
  ]);
  return value ? normalizeMethod(value) : "FCFF_DCF";
}

function resolveModelRecord(input: UnknownRecord): { base: UnknownRecord | null; model: UnknownRecord } {
  const candidate = isRecord(input.base) ? input.base : isRecord(input.baseValuation) ? input.baseValuation : isRecord(input.dcf) ? input.dcf : input;
  const model = isRecord(candidate.dcf) ? candidate.dcf : candidate;
  return { base: candidate === input ? null : candidate, model };
}

function resolveAssumptions(model: UnknownRecord): UnknownRecord {
  return isRecord(model.assumptions) ? model.assumptions : {};
}

function extractOverrides(input: UnknownRecord): WhatIfOverrides {
  const sources: UnknownRecord[] = [];
  if (isRecord(input.overrides)) sources.push(input.overrides);
  if (isRecord(input.override)) sources.push(input.override);
  if (isRecord(input.overlay)) sources.push(input.overlay);
  if (isRecord(input.whatIf)) sources.push(input.whatIf);
  const result: UnknownRecord = {};
  for (const source of sources) {
    for (const key of ["wacc", "waccOverride", "terminalGrowthRate", "terminalGrowth", "terminalGrowthOverride"]) {
      if (hasOwn(source, key) && !hasOwn(result, key)) result[key] = readNumber(source, key, "$.overrides") as number | null;
    }
  }
  const structuredBase = isRecord(input.base) || isRecord(input.baseValuation) || isRecord(input.dcf);
  const flatOverrideKeys = structuredBase ? ["wacc", "waccOverride", "terminalGrowthRate", "terminalGrowth", "terminalGrowthOverride"] : ["waccOverride", "terminalGrowthOverride"];
  for (const key of flatOverrideKeys) {
    if (!hasOwn(result, key) && hasOwn(input, key)) result[key] = readNumber(input, key, "$") as number | null;
  }
  return result as WhatIfOverrides;
}

function extractFcff(model: UnknownRecord): number[] {
  const direct = ["fcff", "fcffs", "fcffPath", "fcffSeries", "forecastFcff"].map((key) => model[key]).find((value) => value !== undefined);
  if (direct !== undefined) {
    if (!Array.isArray(direct)) throw new Error("$.base.fcff must be an array");
    return direct.map((value, index) => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`$.base.fcff[${index}] must be finite`);
      return value;
    });
  }
  const projections = model.projections;
  if (projections === undefined) return [];
  if (!Array.isArray(projections)) throw new Error("$.base.projections must be an array");
  return projections.map((projection, index) => {
    if (!isRecord(projection)) throw new Error(`$.base.projections[${index}] must be an object`);
    const value = projection.fcff;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`$.base.projections[${index}].fcff must be finite`);
    return value;
  });
}

function resolveRange(value: unknown, fallback: NumericRange, path: string): NumericRange {
  if (value === undefined || value === null) return { ...fallback };
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  const min = readNumber(value, "min", path);
  const max = readNumber(value, "max", path);
  const resolvedMin = min === undefined || min === null ? fallback.min : min;
  const resolvedMax = max === undefined || max === null ? fallback.max : max;
  if (!Number.isFinite(resolvedMin) || !Number.isFinite(resolvedMax) || resolvedMin > resolvedMax) throw new Error(`${path} has invalid bounds`);
  return { min: resolvedMin, max: resolvedMax };
}

function resolveBounds(input: UnknownRecord): WhatIfBounds {
  const raw = isRecord(input.bounds) ? input.bounds : {};
  const wacc = resolveRange(raw.wacc, DEFAULT_WHAT_IF_BOUNDS.wacc, "$.bounds.wacc");
  const terminalGrowth = resolveRange(raw.terminalGrowth ?? raw.terminalGrowthRate, DEFAULT_WHAT_IF_BOUNDS.terminalGrowth, "$.bounds.terminalGrowth");
  const spreadValue = readNumber(raw, "terminalSpread", "$.bounds") ?? readNumber(raw, "minimumTerminalSpread", "$.bounds");
  const terminalSpread = spreadValue === undefined || spreadValue === null ? DEFAULT_WHAT_IF_BOUNDS.terminalSpread : spreadValue;
  if (!Number.isFinite(terminalSpread) || terminalSpread < 0) throw new Error("$.bounds.terminalSpread must be a non-negative finite number");
  return { wacc, terminalGrowth, terminalSpread };
}

function clamp(value: number, range: NumericRange): number {
  return Math.max(range.min, Math.min(range.max, value));
}

function closeEnough(left: number, right: number): boolean {
  const tolerance = Math.max(0.01, Math.abs(right) * 1e-6);
  return Math.abs(left - right) <= tolerance;
}

function calculateSnapshot(params: {
  wacc: number;
  terminalGrowthRate: number;
  fcff: number[];
  netDebt: number;
  sharesOutstanding: number;
  currentPrice: number | null;
  terminalValueCapMultiple: number | null;
}): FCFFValuationSnapshot {
  const { wacc, terminalGrowthRate, fcff, netDebt, sharesOutstanding, currentPrice, terminalValueCapMultiple } = params;
  if (fcff.length === 0) throw new Error("at least one FCFF value is required");
  if (fcff.some((value) => value < 0)) throw new Error("FCFF values must be non-negative for a monotonic overlay");
  if (wacc <= -1) throw new Error("WACC must be greater than -1");
  if (sharesOutstanding <= 0) throw new Error("shares outstanding must be positive");
  const spread = wacc - terminalGrowthRate;
  if (spread <= 0) throw new Error("WACC must exceed terminal growth");
  const discountBase = 1 + wacc;
  const sumPvFcff = fcff.reduce((total, value, index) => total + value * Math.pow(discountBase, -(index + 0.5)), 0);
  const terminalYearFcff = fcff[fcff.length - 1];
  const unadjustedTerminalValue = terminalYearFcff * (1 + terminalGrowthRate) / spread;
  const capped = terminalValueCapMultiple !== null && terminalYearFcff > 0 && unadjustedTerminalValue > terminalYearFcff * terminalValueCapMultiple;
  const terminalValue = capped ? terminalYearFcff * (terminalValueCapMultiple as number) : unadjustedTerminalValue;
  const pvTerminalValue = terminalValue * Math.pow(discountBase, -fcff.length);
  const enterpriseValue = sumPvFcff + pvTerminalValue;
  const equityValue = enterpriseValue - netDebt;
  const fairValuePerShare = equityValue / sharesOutstanding;
  const upsideDownside = currentPrice !== null && currentPrice > 0 ? fairValuePerShare / currentPrice - 1 : null;
  const snapshot: FCFFValuationSnapshot = {
    sumPvFcff,
    terminalYearFcff,
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    fairValuePerShare,
    currentPrice,
    upsideDownside,
    terminalValueCapped: capped,
    unadjustedTerminalValue,
  };
  if (!Number.isFinite(snapshot.sumPvFcff) || !Number.isFinite(snapshot.terminalValue) || !Number.isFinite(snapshot.pvTerminalValue) || !Number.isFinite(snapshot.enterpriseValue) || !Number.isFinite(snapshot.equityValue) || !Number.isFinite(snapshot.fairValuePerShare) || !Number.isFinite(snapshot.unadjustedTerminalValue) || (snapshot.upsideDownside !== null && !Number.isFinite(snapshot.upsideDownside))) throw new Error("FCFF valuation produced a non-finite value");
  return snapshot;
}

function requestedValues(overrides: WhatIfOverrides): { wacc: number | null; terminalGrowthRate: number | null } {
  const wacc = overrides.wacc !== undefined ? overrides.wacc : overrides.waccOverride !== undefined ? overrides.waccOverride : null;
  const terminalGrowthRate = overrides.terminalGrowthRate !== undefined ? overrides.terminalGrowthRate : overrides.terminalGrowth !== undefined ? overrides.terminalGrowth : overrides.terminalGrowthOverride !== undefined ? overrides.terminalGrowthOverride : null;
  return { wacc, terminalGrowthRate };
}

function failure(method: string, diagnostics: string[]): FCFFWhatIfResult {
  const requested = { wacc: null, terminalGrowthRate: null };
  return {
    version: FCFF_WHAT_IF_VERSION,
    status: "invalid_input",
    supported: method === "FCFF_DCF" || method === "FCFF" || method === "DCF",
    method,
    requested,
    overrides: requested,
    applied: null,
    bounded: null,
    base: null,
    valuation: null,
    result: null,
    baseValue: null,
    value: null,
    fairValue: null,
    baseParity: false,
    diagnostics,
  };
}

function unsupported(method: string): FCFFWhatIfResult {
  const requested = { wacc: null, terminalGrowthRate: null };
  return {
    version: FCFF_WHAT_IF_VERSION,
    status: "unsupported_method",
    supported: false,
    method,
    requested,
    overrides: requested,
    applied: null,
    bounded: null,
    base: null,
    valuation: null,
    result: null,
    baseValue: null,
    value: null,
    fairValue: null,
    baseParity: false,
    diagnostics: [`UNSUPPORTED_METHOD:${method}`],
  };
}

function baseNumberSources(model: UnknownRecord, assumptions: UnknownRecord, outer: UnknownRecord | null, input: UnknownRecord): Array<{ source: UnknownRecord; keys: string[]; path: string }> {
  const sources: Array<{ source: UnknownRecord; keys: string[]; path: string }> = [
    { source: model, keys: ["wacc", "waccOverride", "baseWacc"], path: "$.base" },
    { source: assumptions, keys: ["wacc", "waccOverride", "baseWacc"], path: "$.base.assumptions" },
  ];
  if (outer) sources.push({ source: outer, keys: ["wacc", "waccOverride", "baseWacc"], path: "$.base" });
  sources.push({ source: input, keys: ["wacc", "waccOverride", "baseWacc"], path: "$" });
  return sources;
}

function buildBaseSnapshot(model: UnknownRecord, assumptions: UnknownRecord, outer: UnknownRecord | null, input: UnknownRecord, fcff: number[], capMultiple: number | null): { snapshot: FCFFValuationSnapshot; wacc: number; terminalGrowthRate: number; netDebt: number; sharesOutstanding: number; currentPrice: number | null } {
  const wacc = readNumberFromSources(baseNumberSources(model, assumptions, outer, input));
  const terminalGrowthRate = readNumberFromSources([
    { source: model, keys: ["terminalGrowthRate", "terminalGrowth", "baseTerminalGrowthRate", "baseTerminalGrowth"], path: "$.base" },
    { source: assumptions, keys: ["terminalGrowthRate", "terminalGrowth", "baseTerminalGrowthRate", "baseTerminalGrowth"], path: "$.base.assumptions" },
    ...(outer ? [{ source: outer, keys: ["terminalGrowthRate", "terminalGrowth", "baseTerminalGrowthRate", "baseTerminalGrowth"], path: "$.base" }] : []),
    { source: input, keys: ["terminalGrowthRate", "terminalGrowth", "baseTerminalGrowthRate", "baseTerminalGrowth"], path: "$" },
  ]);
  const netDebtValue = readNumberFromSources([
    { source: model, keys: ["netDebt"], path: "$.base" },
    { source: outer ?? {}, keys: ["netDebt"], path: "$.base" },
    { source: input, keys: ["netDebt"], path: "$" },
  ]);
  let netDebt = netDebtValue;
  if (netDebt === null) {
    const debt = readNumberFromSources([
      { source: model, keys: ["totalDebt"], path: "$.base" },
      { source: outer ?? {}, keys: ["totalDebt"], path: "$.base" },
      { source: input, keys: ["totalDebt"], path: "$" },
    ]);
    const cash = readNumberFromSources([
      { source: model, keys: ["cashAndEquiv", "cash"], path: "$.base" },
      { source: outer ?? {}, keys: ["cashAndEquiv", "cash"], path: "$.base" },
      { source: input, keys: ["cashAndEquiv", "cash"], path: "$" },
    ]);
    if (debt !== null && cash !== null) netDebt = debt - cash;
  }
  if (netDebt === null) {
    const lessDebt = readNumberFromSources([{ source: model, keys: ["lessDebt"], path: "$.base" }, { source: outer ?? {}, keys: ["lessDebt"], path: "$.base" }, { source: input, keys: ["lessDebt"], path: "$" }]);
    const plusCash = readNumberFromSources([{ source: model, keys: ["plusCash"], path: "$.base" }, { source: outer ?? {}, keys: ["plusCash"], path: "$.base" }, { source: input, keys: ["plusCash"], path: "$" }]);
    if (lessDebt !== null && plusCash !== null) netDebt = lessDebt - plusCash;
  }
  if (netDebt === null) netDebt = 0;
  const sharesOutstanding = readNumberFromSources([
    { source: model, keys: ["sharesOutstanding", "dilutedSharesOutstanding", "shares"], path: "$.base" },
    { source: outer ?? {}, keys: ["sharesOutstanding", "dilutedSharesOutstanding", "shares"], path: "$.base" },
    { source: input, keys: ["sharesOutstanding", "dilutedSharesOutstanding", "shares"], path: "$" },
  ]);
  if (wacc === null || terminalGrowthRate === null) throw new Error("base WACC and terminal growth are required");
  if (sharesOutstanding === null) throw new Error("shares outstanding are required");
  const currentPrice = readNumberFromSources([
    { source: model, keys: ["currentPrice", "currentMarketPrice"], path: "$.base" },
    { source: outer ?? {}, keys: ["currentPrice", "currentMarketPrice"], path: "$.base" },
    { source: input, keys: ["currentPrice", "currentMarketPrice"], path: "$" },
  ]);
  if (fcff.length > 0) {
    const computed = calculateSnapshot({ wacc, terminalGrowthRate, fcff, netDebt, sharesOutstanding, currentPrice, terminalValueCapMultiple: capMultiple });
    const sumPvFcff = readNumberFromSources([{ source: model, keys: ["sumPvFcff"], path: "$.base" }, { source: outer ?? {}, keys: ["sumPvFcff"], path: "$.base" }, { source: input, keys: ["sumPvFcff"], path: "$" }]);
    const terminalYearFcff = readNumberFromSources([{ source: model, keys: ["terminalYearFcff"], path: "$.base" }, { source: outer ?? {}, keys: ["terminalYearFcff"], path: "$.base" }, { source: input, keys: ["terminalYearFcff"], path: "$" }]);
    const terminalValue = readNumberFromSources([{ source: model, keys: ["terminalValue"], path: "$.base" }, { source: outer ?? {}, keys: ["terminalValue"], path: "$.base" }, { source: input, keys: ["terminalValue"], path: "$" }]);
    const unadjustedTerminalValue = readNumberFromSources([{ source: model, keys: ["unadjustedTerminalValue"], path: "$.base" }, { source: outer ?? {}, keys: ["unadjustedTerminalValue"], path: "$.base" }, { source: input, keys: ["unadjustedTerminalValue"], path: "$" }]);
    const pvTerminalValue = readNumberFromSources([{ source: model, keys: ["pvTerminalValue"], path: "$.base" }, { source: outer ?? {}, keys: ["pvTerminalValue"], path: "$.base" }, { source: input, keys: ["pvTerminalValue"], path: "$" }]);
    const enterpriseValue = readNumberFromSources([{ source: model, keys: ["enterpriseValue"], path: "$.base" }, { source: outer ?? {}, keys: ["enterpriseValue"], path: "$.base" }, { source: input, keys: ["enterpriseValue"], path: "$" }]);
    const equityValue = readNumberFromSources([{ source: model, keys: ["equityValue"], path: "$.base" }, { source: outer ?? {}, keys: ["equityValue"], path: "$.base" }, { source: input, keys: ["equityValue"], path: "$" }]);
    const fairValue = readNumberFromSources([
      { source: model, keys: ["fairValuePerShare", "fairValue", "intrinsicValue"], path: "$.base" },
      { source: outer ?? {}, keys: ["fairValuePerShare", "fairValue", "intrinsicValue"], path: "$.base" },
      { source: input, keys: ["fairValuePerShare", "fairValue", "intrinsicValue"], path: "$" },
    ]);
    const snapshot: FCFFValuationSnapshot = {
      sumPvFcff: sumPvFcff ?? computed.sumPvFcff,
      terminalYearFcff: terminalYearFcff ?? computed.terminalYearFcff,
      terminalValue: terminalValue ?? computed.terminalValue,
      pvTerminalValue: pvTerminalValue ?? computed.pvTerminalValue,
      enterpriseValue: enterpriseValue ?? computed.enterpriseValue,
      equityValue: equityValue ?? computed.equityValue,
      fairValuePerShare: fairValue ?? computed.fairValuePerShare,
      currentPrice: currentPrice ?? computed.currentPrice,
      upsideDownside: computed.upsideDownside,
      terminalValueCapped: readBooleanFromSources([{ source: model, keys: ["terminalValueCapped"], path: "$.base" }, { source: outer ?? {}, keys: ["terminalValueCapped"], path: "$.base" }, { source: input, keys: ["terminalValueCapped"], path: "$" }]) ?? computed.terminalValueCapped,
      unadjustedTerminalValue: unadjustedTerminalValue ?? computed.unadjustedTerminalValue,
    };
    return { snapshot, wacc, terminalGrowthRate, netDebt, sharesOutstanding, currentPrice };
  }
  const sumPvFcff = readNumberFromSources([{ source: model, keys: ["sumPvFcff"], path: "$.base" }, { source: outer ?? {}, keys: ["sumPvFcff"], path: "$.base" }, { source: input, keys: ["sumPvFcff"], path: "$" }]);
  const terminalYearFcff = readNumberFromSources([{ source: model, keys: ["terminalYearFcff"], path: "$.base" }, { source: outer ?? {}, keys: ["terminalYearFcff"], path: "$.base" }, { source: input, keys: ["terminalYearFcff"], path: "$" }]);
  const terminalValue = readNumberFromSources([{ source: model, keys: ["terminalValue"], path: "$.base" }, { source: outer ?? {}, keys: ["terminalValue"], path: "$.base" }, { source: input, keys: ["terminalValue"], path: "$" }]);
  const pvTerminalValue = readNumberFromSources([{ source: model, keys: ["pvTerminalValue"], path: "$.base" }, { source: outer ?? {}, keys: ["pvTerminalValue"], path: "$.base" }, { source: input, keys: ["pvTerminalValue"], path: "$" }]);
  const enterpriseValue = readNumberFromSources([{ source: model, keys: ["enterpriseValue"], path: "$.base" }, { source: outer ?? {}, keys: ["enterpriseValue"], path: "$.base" }, { source: input, keys: ["enterpriseValue"], path: "$" }]);
  const equityValue = readNumberFromSources([{ source: model, keys: ["equityValue"], path: "$.base" }, { source: outer ?? {}, keys: ["equityValue"], path: "$.base" }, { source: input, keys: ["equityValue"], path: "$" }]);
  const fairValue = readNumberFromSources([
    { source: model, keys: ["fairValuePerShare", "fairValue", "intrinsicValue"], path: "$.base" },
    { source: outer ?? {}, keys: ["fairValuePerShare", "fairValue", "intrinsicValue"], path: "$.base" },
    { source: input, keys: ["fairValuePerShare", "fairValue", "intrinsicValue"], path: "$" },
  ]);
  if ([sumPvFcff, terminalYearFcff, terminalValue, pvTerminalValue, enterpriseValue, equityValue, fairValue].some((value) => value === null)) throw new Error("FCFF path is required for an overlay");
  return {
    snapshot: {
      sumPvFcff: sumPvFcff as number,
      terminalYearFcff: terminalYearFcff as number,
      terminalValue: terminalValue as number,
      pvTerminalValue: pvTerminalValue as number,
      enterpriseValue: enterpriseValue as number,
      equityValue: equityValue as number,
      fairValuePerShare: fairValue as number,
      currentPrice,
      upsideDownside: currentPrice !== null && currentPrice > 0 ? (fairValue as number) / currentPrice - 1 : null,
      terminalValueCapped: readBooleanFromSources([{ source: model, keys: ["terminalValueCapped"], path: "$.base" }, { source: outer ?? {}, keys: ["terminalValueCapped"], path: "$.base" }, { source: input, keys: ["terminalValueCapped"], path: "$" }]) ?? false,
      unadjustedTerminalValue: readNumberFromSources([{ source: model, keys: ["unadjustedTerminalValue"], path: "$.base" }, { source: outer ?? {}, keys: ["unadjustedTerminalValue"], path: "$.base" }, { source: input, keys: ["unadjustedTerminalValue"], path: "$" }]) ?? (terminalValue as number),
    },
    wacc,
    terminalGrowthRate,
    netDebt,
    sharesOutstanding,
    currentPrice,
  };
}

function resolveCapMultiple(input: UnknownRecord, model: UnknownRecord, outer: UnknownRecord | null): number | null {
  const value = readNumberFromSources([
    { source: input, keys: ["terminalValueCapMultiple"], path: "$" },
    { source: model, keys: ["terminalValueCapMultiple"], path: "$.base" },
    { source: outer ?? {}, keys: ["terminalValueCapMultiple"], path: "$.base" },
  ]);
  if (value !== null && (!Number.isFinite(value) || value <= 0)) throw new Error("terminal value cap multiple must be positive");
  if (value !== null) return value;
  const capped = readBooleanFromSources([
    { source: model, keys: ["terminalValueCapped"], path: "$.base" },
    { source: outer ?? {}, keys: ["terminalValueCapped"], path: "$.base" },
  ]);
  return capped === true ? 25 : null;
}

function applyFCFFWhatIfInternal(input: UnknownRecord, method: string): FCFFWhatIfResult {
  if (method !== "FCFF_DCF" && method !== "FCFF" && method !== "DCF") return unsupported(method);
  const { base, model } = resolveModelRecord(input);
  const assumptions = resolveAssumptions(model);
  const overrides = extractOverrides(input);
  const requested = requestedValues(overrides);
  const fcff = extractFcff(model);
  const bounds = resolveBounds(input);
  const capMultiple = resolveCapMultiple(input, model, base);
  const baseData = buildBaseSnapshot(model, assumptions, base, input, fcff, capMultiple);
  const { snapshot: baseSnapshot, wacc: baseWacc, terminalGrowthRate: baseTerminalGrowth, netDebt, sharesOutstanding, currentPrice } = baseData;
  const computedBaseValue = fcff.length > 0 ? calculateSnapshot({ wacc: baseWacc, terminalGrowthRate: baseTerminalGrowth, fcff, netDebt, sharesOutstanding, currentPrice, terminalValueCapMultiple: capMultiple }).fairValuePerShare : null;
  if (baseWacc < bounds.wacc.min || baseWacc > bounds.wacc.max) throw new Error("base WACC is outside the configured bounds");
  if (baseTerminalGrowth < bounds.terminalGrowth.min || baseTerminalGrowth > bounds.terminalGrowth.max) throw new Error("base terminal growth is outside the configured bounds");
  if (baseWacc - baseTerminalGrowth < bounds.terminalSpread) throw new Error("base terminal spread is below the configured floor");
  const appliedWacc = requested.wacc === null ? baseWacc : clamp(requested.wacc, bounds.wacc);
  let appliedTerminalGrowth = requested.terminalGrowthRate === null ? baseTerminalGrowth : clamp(requested.terminalGrowthRate, bounds.terminalGrowth);
  const maximumTerminalGrowth = appliedWacc - bounds.terminalSpread;
  const spreadAdjusted = appliedTerminalGrowth > maximumTerminalGrowth;
  if (spreadAdjusted) appliedTerminalGrowth = maximumTerminalGrowth;
  if (appliedTerminalGrowth < bounds.terminalGrowth.min) throw new Error("bounds cannot satisfy the terminal spread floor");
  const waccClamped = requested.wacc !== null && appliedWacc !== requested.wacc;
  const terminalGrowthClamped = requested.terminalGrowthRate !== null && appliedTerminalGrowth !== requested.terminalGrowthRate;
  const strictBounds = input.strictBounds === true || input.boundsMode === "reject";
  if (strictBounds && (waccClamped || terminalGrowthClamped || spreadAdjusted)) throw new Error("what-if value is outside the configured bounds");
  const bounded: WhatIfBoundApplication = {
    wacc: { requested: requested.wacc, applied: appliedWacc, min: bounds.wacc.min, max: bounds.wacc.max, clamped: waccClamped },
    terminalGrowth: { requested: requested.terminalGrowthRate, applied: appliedTerminalGrowth, min: bounds.terminalGrowth.min, max: bounds.terminalGrowth.max, clamped: terminalGrowthClamped || spreadAdjusted },
    terminalSpread: { minimum: bounds.terminalSpread, actual: appliedWacc - appliedTerminalGrowth, satisfied: appliedWacc - appliedTerminalGrowth >= bounds.terminalSpread, adjusted: spreadAdjusted },
  };
  const noEffectiveChange = closeEnough(appliedWacc, baseWacc) && closeEnough(appliedTerminalGrowth, baseTerminalGrowth);
  const changedSnapshot = noEffectiveChange
    ? baseSnapshot
    : calculateSnapshot({ wacc: appliedWacc, terminalGrowthRate: appliedTerminalGrowth, fcff, netDebt, sharesOutstanding, currentPrice, terminalValueCapMultiple: capMultiple });
  const diagnostics: string[] = [];
  if (waccClamped) diagnostics.push("WACC_BOUND_CLAMPED");
  if (terminalGrowthClamped) diagnostics.push("TERMINAL_GROWTH_BOUND_CLAMPED");
  if (spreadAdjusted) diagnostics.push("TERMINAL_SPREAD_FLOOR_APPLIED");
  const baseParity = noEffectiveChange || (computedBaseValue !== null && closeEnough(computedBaseValue, baseSnapshot.fairValuePerShare));
  if (!baseParity) diagnostics.push("BASE_PARITY_MISMATCH");
  return {
    version: FCFF_WHAT_IF_VERSION,
    status: "ok",
    supported: true,
    method,
    requested,
    overrides: requested,
    applied: { wacc: appliedWacc, terminalGrowthRate: appliedTerminalGrowth },
    bounded,
    base: baseSnapshot,
    valuation: changedSnapshot,
    result: changedSnapshot,
    baseValue: baseSnapshot.fairValuePerShare,
    value: changedSnapshot.fairValuePerShare,
    fairValue: changedSnapshot.fairValuePerShare,
    baseParity,
    diagnostics,
  };
}

export function applyFCFFWhatIf(input: FCFFWhatIfInput, overrides?: WhatIfOverrides): FCFFWhatIfResult {
  let effectiveInput: UnknownRecord;
  if (isRecord(input)) {
    effectiveInput = overrides ? { ...input, overrides: { ...(isRecord(input.overrides) ? input.overrides : {}), ...overrides } } : input;
  } else {
    effectiveInput = {};
  }
  let method = "FCFF_DCF";
  try {
    method = methodFromInput(effectiveInput, isRecord(effectiveInput.base) ? effectiveInput.base : isRecord(effectiveInput.baseValuation) ? effectiveInput.baseValuation : null, isRecord(effectiveInput.dcf) ? effectiveInput.dcf : null);
    return applyFCFFWhatIfInternal(effectiveInput, method);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid what-if input";
    return failure(method, [`INVALID_INPUT:${message}`]);
  }
}

export const applyWhatIf = applyFCFFWhatIf;
export const computeWhatIf = applyFCFFWhatIf;
export const overlayWhatIf = applyFCFFWhatIf;
export const runWhatIf = applyFCFFWhatIf;
export const applyValuationWhatIf = applyFCFFWhatIf;
export const computeFCFFWhatIf = applyFCFFWhatIf;
export const overlayFCFFWhatIf = applyFCFFWhatIf;
