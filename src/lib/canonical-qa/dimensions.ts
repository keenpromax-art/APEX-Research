import type { CanonicalQaDiagnostic, CanonicalQaDimension } from "./types";
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function rec(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
function diag(
  id: string,
  dimension: CanonicalQaDimension,
  severity: CanonicalQaDiagnostic["severity"],
  component: string,
  finding: string,
  recommendation: string,
  evidenceRefs: string[] = []
): CanonicalQaDiagnostic {
  return { id, dimension, severity, component, finding, recommendation, evidenceRefs, deterministic: true };
}
function forecastYears(report: Record<string, unknown>): Record<string, unknown>[] {
  const forecast = rec(report.forecast);
  const income = forecast.incomeStatement;
  return Array.isArray(income) ? (income as Record<string, unknown>[]) : [];
}
function balanceYears(report: Record<string, unknown>): Record<string, unknown>[] {
  const forecast = rec(report.forecast);
  const bs = forecast.balanceSheet;
  return Array.isArray(bs) ? (bs as Record<string, unknown>[]) : [];
}
function cashYears(report: Record<string, unknown>): Record<string, unknown>[] {
  const forecast = rec(report.forecast);
  const cf = forecast.cashFlow;
  return Array.isArray(cf) ? (cf as Record<string, unknown>[]) : [];
}
function valuesOf(year: Record<string, unknown>): Record<string, number> {
  const values = rec(year.values);
  const out: Record<string, number> = {};
  for (const key of Object.keys(values)) {
    const v = num(values[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}
export function runCanonicalQaDimensions(
  reportInput: unknown,
  packInput: unknown,
  contextInput: unknown = {}
): CanonicalQaDiagnostic[] {
  const report = rec(reportInput);
  const pack = packInput !== null && typeof packInput === "object" ? (packInput as Record<string, unknown>) : null;
  const context = rec(contextInput);
  const out: CanonicalQaDiagnostic[] = [];
  const thesis = rec(report.thesis);
  const thesisText = str(thesis.thesis);
  const thesisLower = thesisText.toLowerCase();
  const valuation = rec(report.valuation);
  const forecast = rec(report.forecast);
  const scenarios = arr(report.scenarios) as Record<string, unknown>[];
  const risks = arr(report.risks) as Record<string, unknown>[];
  const catalysts = arr(report.catalysts) as Record<string, unknown>[];
  const comp = rec(report.competitiveAnalysis);
  const competitors = arr(comp.competitors) as Record<string, unknown>[];
  const moat = rec(report.moat);
  const years = forecastYears(report);
  for (let i = 0; i < years.length; i += 1) {
    const vals = valuesOf(years[i] as Record<string, unknown>);
    const rev = vals.revenue;
    const ni = vals.netIncome;
    if (rev !== undefined && rev !== 0 && ni !== undefined) {
      const margin = ni / rev;
      if (margin > 1) out.push(diag("NUM-01", "numerical", "blocker", "forecast:incomeStatement", `Period ${str((years[i] as Record<string, unknown>).period)} net margin ${(margin * 100).toFixed(1)}% exceeds 100%`, "Re-evaluate revenue and net income assumptions before publication"));
      else if (margin > 0.5) out.push(diag("NUM-02", "numerical", "major", "forecast:incomeStatement", `Period ${str((years[i] as Record<string, unknown>).period)} net margin ${(margin * 100).toFixed(1)}% is unusually high`, "Verify cost assumptions and margin trajectory"));
    }
    for (const key of Object.keys(vals)) {
      if (!Number.isFinite(vals[key])) out.push(diag("NUM-03", "numerical", "blocker", `forecast:${key}`, `Non-finite value in forecast field ${key}`, "Replace non-finite forecast output with a computed finite value or block publication"));
    }
  }
  const fv = num(valuation.fairValuePerShare);
  const upside = num(valuation.upsidePct);
  if (upside !== undefined && Math.abs(upside) > 150) out.push(diag("NUM-04", "numerical", "major", "valuation", `Upside ${upside.toFixed(1)}% is implausible`, "Review growth assumptions and discount rate"));
  const bsYears = balanceYears(report);
  for (const y of bsYears) {
    const vals = valuesOf(y);
    if (vals.totalAssets !== undefined && vals.totalLiabilities !== undefined && vals.totalEquity !== undefined) {
      if (Math.abs(vals.totalAssets - (vals.totalLiabilities + vals.totalEquity)) > 1) out.push(diag("ACC-01", "accounting", "blocker", "forecast:balanceSheet", `Period ${str(y.period)} balance sheet identity failed`, "Enforce Assets equals Liabilities plus Equity with a balancing plug"));
    }
  }
  const cfYears = cashYears(report);
  for (const y of cfYears) {
    const vals = valuesOf(y);
    if (vals.cashClose !== undefined && vals.cashOpen !== undefined) {
      const implied = vals.cashOpen + (vals.cfo ?? 0) + (vals.cfi ?? 0) + (vals.cff ?? 0);
      if (Math.abs(implied - vals.cashClose) > 1) out.push(diag("ACC-02", "accounting", "blocker", "forecast:cashFlow", `Period ${str(y.period)} cash roll-forward failed`, "Recompute closing cash from the roll-forward"));
    }
  }
  if (years.length === 0) out.push(diag("ACC-03", "accounting", "blocker", "forecast", "Forecast contains no income statement years", "Execute the deterministic forecast before publication"));
  const hasFactCitation = (s: string): boolean => /\[F-[^\]]+\]/i.test(s) || /forecast|model output|assumption/i.test(s);
  if (thesisText.length > 40 && /\d+(?:\.\d+)?\s*%/.test(thesisText) && !hasFactCitation(thesisText)) out.push(diag("EVI-01", "evidence", "major", "thesis", "Thesis contains a percentage claim without evidence citation", "Add an evidence citation or link to a model assumption"));
  if (fv !== undefined && !str(rec(valuation.executedFrom).rationale).trim() && !str(valuation.methodology).trim()) out.push(diag("EVI-02", "evidence", "blocker", "valuation", "Fair value has no traceable rationale", "Attach valuation rationale with evidence references"));
  const operatingModel = rec(report.operatingModel);
  const formulas = arr(operatingModel.formulas);
  if (formulas.length === 0) out.push(diag("MOD-01", "model", "blocker", "operatingModel", "Operating model contains no executable formulas", "Generate model formulas before publication"));
  const forecastSpecVars = rec(report.forecastSpec);
  if (Array.isArray(rec(report).forecastSpec)) out.push(diag("MOD-02", "model", "info", "model", "Unexpected forecast spec shape", "Verify model specification shape"));
  void forecastSpecVars;
  const spec = rec((report as Record<string, unknown>).forecastSpec);
  const driverPaths = rec(spec.driverPaths);
  if (Object.keys(driverPaths).length === 0 && years.length > 0) out.push(diag("MOD-03", "model", "major", "model", "Model has no driver paths", "Provide driver paths for each input variable"));
  const forecastStatus = str(forecast.status) || str(forecast.publicationStatus);
  if (forecastStatus && forecastStatus !== "ready") out.push(diag("FOR-01", "forecast", "blocker", "forecast", `Forecast status is ${forecastStatus}`, "Resolve forecast blockers before publication"));
  const identityChecks = arr(forecast.identityChecks) as Record<string, unknown>[];
  const failedCritical = identityChecks.filter((c) => c.critical === true && c.pass === false);
  if (failedCritical.length > 0) out.push(diag("FOR-02", "forecast", "blocker", "forecast", `${failedCritical.length} critical identity checks failed`, "Fix statement identities before publication"));
  if (!str(valuation.methodology).trim()) out.push(diag("VAL-01", "valuation", "blocker", "valuation", "No valuation methodology specified", "Select and justify a valuation method"));
  if (fv === undefined) out.push(diag("VAL-02", "valuation", "blocker", "valuation", "Fair value per share is missing", "Execute the valuation matrix before publication"));
  const executedFrom = rec(valuation.executedFrom);
  const disc = num(executedFrom.discountRate);
  const termGrowth = num(rec(executedFrom.terminalAssumptions).growth);
  if (disc !== undefined && termGrowth !== undefined && disc - termGrowth < 0.02) out.push(diag("VAL-03", "valuation", "major", "valuation", `Discount minus terminal growth spread ${((disc - termGrowth) * 100).toFixed(1)}% is very tight`, "Widen the spread or stress-test terminal growth"));
  if (disc !== undefined && (disc < 0.06 || disc > 0.18)) out.push(diag("VAL-04", "valuation", "major", "valuation", `Discount rate ${disc} is outside 6 to 18 percent`, "Justify the discount rate with market evidence"));
  if (scenarios.length !== 3 && scenarios.length !== 0) out.push(diag("SCE-01", "scenario", "major", "scenarios", `Expected 3 scenarios, found ${scenarios.length}`, "Generate bear, base and bull scenarios"));
  if (scenarios.length === 3) {
    const targets = scenarios.map((s) => num(rec(s).targetPrice)).filter((v): v is number => v !== undefined);
    if (targets.length === 3) {
      const bear = targets[0] as number;
      const base = targets[1] as number;
      const bull = targets[2] as number;
      if (!(bull >= base && base >= bear)) out.push(diag("SCE-02", "scenario", "blocker", "scenarios", "Scenario targets violate Bull >= Base >= Bear monotonicity", "Regenerate scenarios with monotone targets"));
      if (fv !== undefined && Math.abs(base - fv) > Math.abs(fv) * 0.25) out.push(diag("SCE-03", "scenario", "major", "scenarios-valuation", "Base scenario deviates more than 25 percent from main fair value", "Re-align scenario assumptions with the main valuation"));
    }
  }
  if (competitors.length > 5) out.push(diag("COM-01", "competitive", "major", "competitiveAnalysis", `Peer set has ${competitors.length} competitors`, "Reduce the peer set to the most relevant 3 to 5 competitors"));
  for (const c of competitors) {
    if (str(c.businessOverlap).length < 15) {
      out.push(diag("COM-02", "competitive", "major", "competitiveAnalysis", `Competitor ${str(c.company) || "unknown"} lacks overlap explanation`, "Add business overlap grounded in the business model"));
      break;
    }
  }
  if (thesisText.length < 10) out.push(diag("NAR-01", "narrative", "major", "thesis", "Thesis statement is too short", "Regenerate thesis with substantive sentences"));
  const genericPhrases = ["strong fundamentals", "well positioned", "poised for growth", "robust outlook"];
  for (const phrase of genericPhrases) {
    if (thesisLower.includes(phrase)) {
      out.push(diag("NAR-02", "narrative", "major", "thesis", `Thesis contains generic phrase ${phrase}`, "Replace with an evidence-constrained mechanism"));
      break;
    }
  }
  const bearCase = arr(thesis.bearCase) as unknown[];
  if (bearCase.length === 0 || bearCase.every((s) => str(s).length < 15)) out.push(diag("NAR-03", "narrative", "major", "thesis", "Bear case is missing or generic", "Generate a grounded bear case with a monitoring indicator"));
  const invalidation = arr(thesis.whatCouldInvalidate) as unknown[];
  if (invalidation.length === 0 || invalidation.some((s) => str(s).length < 10)) out.push(diag("NAR-04", "narrative", "major", "thesis", "Thesis lacks a falsifiable invalidation condition", "Add what would prove the thesis wrong with an observable indicator"));
  if (fv !== undefined && scenarios.length === 3) {
    const baseTarget = num(rec(scenarios[1]).targetPrice);
    if (baseTarget !== undefined && Math.abs(baseTarget - fv) > Math.abs(fv) * 0.5) out.push(diag("XSC-01", "cross-section", "major", "scenarios-valuation", "Base scenario and main valuation disagree materially", "Reconcile scenario execution with the main valuation"));
  }
  if (years.length >= 2) {
    const firstRev = valuesOf(years[0] as Record<string, unknown>).revenue;
    const lastRev = valuesOf(years[years.length - 1] as Record<string, unknown>).revenue;
    if (firstRev !== undefined && lastRev !== undefined && lastRev < firstRev && /growth|expand|bull/i.test(thesisText)) out.push(diag("XSC-02", "cross-section", "major", "thesis", "Bullish thesis contradicts declining forecast revenue", "Reconcile thesis with the forecast trajectory"));
  }
  if (upside !== undefined && fv !== undefined) {
    const currentPrice = num(rec(context).currentPrice);
    if (currentPrice !== undefined && currentPrice > 0) {
      const implied = (fv / currentPrice - 1) * 100;
      if (Math.abs(implied - upside) > 20) out.push(diag("XSC-03", "cross-section", "major", "valuation", "Reported upside disagrees with fair value over price", "Reconcile the upside calculation"));
    }
  }
  const allText = [thesisText, ...risks.map((r) => str(rec(r).risk)), ...catalysts.map((c) => str(rec(c).catalyst))].join(" ").toLowerCase();
  const forbidden = ["search index", "advertiser bidding", "custom silicon", "hyperscale infrastructure", "fmcg", "same-store sales", "foot traffic"];
  for (const concept of forbidden) {
    if (allText.includes(concept)) {
      out.push(diag("CON-01", "contamination", "blocker", "thesis", `Cross-sector term detected: ${concept}`, "Regenerate from company-specific facts only"));
      break;
    }
  }
  const templatePhrases = ["as is typical for", "in a typical", "for a company like", "standard for the sector", "sector convention"];
  for (const phrase of templatePhrases) {
    if (allText.includes(phrase)) {
      out.push(diag("CON-02", "contamination", "blocker", "content", `Template phrase detected: ${phrase}`, "Regenerate the package from company-specific facts"));
      break;
    }
  }
  const freshness = str(rec(context).priceFreshness) || str(rec(context).freshness);
  if (freshness === "stale") out.push(diag("FRE-01", "freshness", "major", "market-price", "Current price is stale", "Refresh market data before publication"));
  const retrievalStatus = str(rec(context).retrievalStatus);
  if (retrievalStatus === "failed" || retrievalStatus === "unavailable") out.push(diag("FRE-02", "freshness", "blocker", "retrieval", `Retrieval is ${retrievalStatus}`, "Configure retrieval and resolve failed tasks"));
  const retrievalTs = str(rec(context).retrievalTimestamp);
  const nowTs = str(rec(context).now) || str(rec(context).generatedAt);
  if (retrievalTs && nowTs) {
    const age = Date.parse(nowTs) - Date.parse(retrievalTs);
    if (Number.isFinite(age) && age > 1000 * 60 * 60 * 24 * 30) out.push(diag("FRE-03", "freshness", "major", "data", "Market data is older than 30 days", "Refresh the source context before publication"));
  }
  if (!str(report.researchRunId).trim()) out.push(diag("REP-01", "reproducibility", "major", "versioning", "No research run identifier", "Add a research run identifier"));
  if (!str(report.modelVersion).trim() || !str(report.promptVersion).trim()) out.push(diag("REP-02", "reproducibility", "major", "versioning", "Model or prompt version is missing", "Record model and prompt versions"));
  const artifactIds = rec(report.artifactIds);
  if (Object.keys(artifactIds).length === 0) out.push(diag("REP-03", "reproducibility", "minor", "versioning", "Artifact identifiers are missing", "Record fact, model, forecast and valuation identifiers"));
  if (!str(report.companyTicker).trim()) out.push(diag("PDF-01", "pdf-plumbing", "blocker", "reportStructure", "Company ticker is missing", "Populate the company ticker before export"));
  const keyMetrics = arr(report.keyMetrics);
  if (keyMetrics.length === 0) out.push(diag("PDF-02", "pdf-plumbing", "major", "reportStructure", "Key metrics are empty", "Populate key metrics for the cover and KPI strip"));
  if (!str(report.conclusion).trim()) out.push(diag("PDF-03", "pdf-plumbing", "minor", "conclusion", "Conclusion is empty", "Populate the conclusion before export"));
  if (pack !== null) {
    const ticker = str(rec(pack).ticker);
    if (ticker && ticker !== str(report.companyTicker)) out.push(diag("XSC-04", "cross-section", "blocker", "ticker", "Report ticker does not match fact pack ticker", "Align report and fact pack tickers"));
  }
  const seen = new Set<string>();
  const deduped: CanonicalQaDiagnostic[] = [];
  for (const d of out) {
    const key = `${d.id}:${d.component}:${d.finding.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(d);
  }
  return deduped;
}
