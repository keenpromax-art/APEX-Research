/**
 * APEX RESEARCH — CANONICAL ANALYST BRIEF
 *
 * Single source of truth consumed by every downstream AI.
 * Eliminates context drift: model/valuation/scenarios/narrative
 * all receive the SAME evidence packet, not just company name.
 *
 * Structure per user audit §29:
 * 1 company identity, 2 business model, 3 economic engine,
 * 4 historical trajectory (derived), 5 current inflection,
 * 6 management signals, 7 model assumptions, 8 valuation,
 * 9 scenario range, 10 market expectations, 11 key risks,
 * 12 key catalysts, 13 competitive landscape, 14 contradictions,
 * 15 missing info, 16 evidence table, 17 core debate.
 */

import type {
  FactPack,
  CompanyUnderstanding,
  ForecastSpecification,
  ValuationSpecification,
  ValuationResult,
  ForecastResult,
  ScenarioSpecification,
} from "./types";
import { buildHistoricalAnalysisPack, renderHistoricalAnalysisPack, type HistoricalAnalysisPack } from "./historical-analysis";

export interface AnalystBrief {
  ticker: string;
  generatedAt: string;
  // 1
  companyIdentity: { name: string; ticker: string; country?: string; sector?: string; industry?: string; description?: string };
  // 2
  businessModel: { whatItDoes: string; howItMakesMoney: string; segments: CompanyUnderstanding["businessSegments"]; economicUnits: string[]; statementsThatMatterMost: string[] };
  // 3
  economicEngine: {
    primaryAbstraction: string;
    revenueDrivers: CompanyUnderstanding["revenueDrivers"];
    costDrivers: CompanyUnderstanding["costDrivers"];
    marginDrivers: CompanyUnderstanding["marginDrivers"];
    cashDrivers: CompanyUnderstanding["cashGenerationDrivers"];
    balanceSheetDrivers: CompanyUnderstanding["balanceSheetDrivers"];
    returnsDrivers: CompanyUnderstanding["returnsDrivers"];
    keyKpis: CompanyUnderstanding["keyKpis"];
    metricsToAvoid: CompanyUnderstanding["metricsToAvoid"];
  };
  // 4
  historical: HistoricalAnalysisPack;
  // 5-6 placeholders populated deterministically; AI enriches via context
  inflections: string[];
  managementSignals: string[];
  // 7-10 filled when available (pipeline builds incrementally)
  model?: { spec: ForecastSpecification; forecast?: ForecastResult };
  valuation?: { spec: ValuationSpecification; result?: ValuationResult };
  scenarios?: ScenarioSpecification[];
  marketExpectations?: { streetTarget?: number; recommendation?: string; estimates?: string[] };
  // 14-15
  contradictions: string[];
  missingInformation: string[];
  // 16 evidence table
  evidenceLines: string[];
  // 17
  coreDebate?: string;
  // raw fact evidence ids
  factIds: string[];
}

function textFact(pack: FactPack, metric: string): string | undefined {
  return pack.company.facts.find((f) => f.metric === metric)?.textValue;
}

export function buildAnalystBrief(input: {
  pack: FactPack;
  understanding: CompanyUnderstanding;
  forecastSpec?: ForecastSpecification;
  forecast?: ForecastResult;
  valuationSpec?: ValuationSpecification;
  valuation?: ValuationResult;
  scenarios?: ScenarioSpecification[];
}): AnalystBrief {
  const { pack, understanding, forecastSpec, forecast, valuationSpec, valuation, scenarios } = input;
  const historical = buildHistoricalAnalysisPack(pack);

  const contradictions: string[] = [];
  // Deterministic contradiction heuristics (explain contradictions per audit §11)
  // - revenue trend vs margin trend divergence
  if (historical.revenueSeries.length >= 2 && historical.netIncomeSeries.length >= 2) {
    const revUp = historical.revenueSeries[historical.revenueSeries.length - 1].value > historical.revenueSeries[0].value;
    const niDown = historical.netIncomeSeries[historical.netIncomeSeries.length - 1].value < historical.netIncomeSeries[historical.netIncomeSeries.length - 1 - 1]?.value;
    if (revUp && niDown) contradictions.push("Revenue rising while recent net income fell — margin/cost pressure contradicts top-line growth.");
  }
  // - leverage rising while FCF positive contradictions
  if (historical.debtSeries.length >= 2) {
    const dUp = historical.debtSeries[historical.debtSeries.length - 1].value > historical.debtSeries[0].value;
    if (dUp) contradictions.push("Debt balance expanded over history — verify whether growth is funded by leverage vs operating cash flow.");
  }
  // - valuation vs history: high P/E with low ROE
  const pe = pack.market.facts.find((f) => f.metric === "trailingPE")?.value;
  const lastRoe = historical.derived.find((d) => d.label === "ROE trend");
  if (pe !== undefined && pe > 25 && lastRoe && typeof lastRoe.value === "number" && lastRoe.value < 0.12) {
    contradictions.push(`Market prices at P/E ${pe.toFixed(1)} despite ROE ${((lastRoe.value as number) * 100).toFixed(1)}% — pricing implies growth or quality not yet in returns.`);
  }
  // - yfinance gaps
  const hasRevenue = historical.revenueSeries.length > 0;
  if (!hasRevenue) contradictions.push("No revenue history in yfinance — any growth forecast is assumption-heavy and low confidence.");

  const missingInformation: string[] = [];
  if (!understanding.businessSegments.length) missingInformation.push("Segment-level revenue contribution (requires latest annual report / filings).");
  if (historical.revenueSeries.length < 3) missingInformation.push("Deeper multi-year history for CAGR (only few yfinance periods available).");
  if (!pack.market.facts.find((f) => f.metric === "currentPrice")?.value) missingInformation.push("Current price/shares unavailable in yfinance — valuation upside cannot be computed.");
  missingInformation.push("Management guidance, order book, regulatory pipeline, consensus expectations (beyond yfinance estimates).");

  const evidenceLines: string[] = [];
  for (const sec of [pack.company, pack.market, pack.incomeStatement, pack.balanceSheet, pack.cashFlow]) {
    for (const f of sec.facts.slice(0, 30)) {
      if (f.value !== undefined || f.textValue) {
        const v = f.textValue ?? String(f.value);
        evidenceLines.push(`[F-${f.metric}] ${f.label} (${f.period}): ${v}${f.currency ? ` ${f.currency}` : ""}`);
      }
    }
  }

  const factIds = evidenceLines.map((l) => l.match(/\[F-[^\]]+\]/)?.[0] ?? "").filter(Boolean);

  const streetTarget = pack.market.facts.find((f) => f.metric === "targetMeanPrice")?.value;
  const rec = pack.company.facts.find((f) => f.metric === "recommendationKey")?.textValue || pack.market.facts.find((f) => f.metric === "recommendationKey")?.textValue;
  const estimates = pack.estimates.facts.map((f) => `${f.metric} (${f.period}): ${f.value ?? f.textValue}`);

  return {
    ticker: pack.ticker,
    generatedAt: new Date().toISOString(),
    companyIdentity: {
      name: understanding.companyName,
      ticker: pack.ticker,
      country: textFact(pack, "country"),
      sector: textFact(pack, "sector"),
      industry: textFact(pack, "industry"),
      description: textFact(pack, "description")?.slice(0, 800),
    },
    businessModel: {
      whatItDoes: understanding.whatItDoes,
      howItMakesMoney: understanding.howItMakesMoney,
      segments: understanding.businessSegments,
      economicUnits: understanding.economicUnits,
      statementsThatMatterMost: understanding.statementsThatMatterMost,
    },
    economicEngine: {
      primaryAbstraction: understanding.primaryEconomicAbstraction,
      revenueDrivers: understanding.revenueDrivers,
      costDrivers: understanding.costDrivers,
      marginDrivers: understanding.marginDrivers,
      cashDrivers: understanding.cashGenerationDrivers,
      balanceSheetDrivers: understanding.balanceSheetDrivers,
      returnsDrivers: understanding.returnsDrivers,
      keyKpis: understanding.keyKpis,
      metricsToAvoid: understanding.metricsToAvoid,
    },
    historical,
    inflections: [], // AI will populate via research planner; deterministic leaves empty
    managementSignals: [],
    model: forecastSpec ? { spec: forecastSpec, forecast } : undefined,
    valuation: valuationSpec ? { spec: valuationSpec, result: valuation } : undefined,
    scenarios,
    marketExpectations: { streetTarget, recommendation: rec, estimates: estimates.slice(0, 8) },
    contradictions,
    missingInformation,
    evidenceLines: evidenceLines.slice(0, 80),
    factIds,
    coreDebate: undefined,
  };
}

export function renderAnalystBrief(brief: AnalystBrief): string {
  const h = renderHistoricalAnalysisPack(brief.historical);
  const fmtDrivers = (label: string, drivers: Array<{ name: string; mechanism: string }>) =>
    drivers.length ? `${label}:\n${drivers.map((d) => `- ${d.name}: ${d.mechanism}`).join("\n")}` : `${label}: (none specified)`;
  const kpiLines = brief.economicEngine.keyKpis.map((k) => `- ${k.name} (${k.availability}): ${k.rationale}${k.unit ? ` [${k.unit}]` : ""}`).join("\n") || "- (none)";
  const avoid = brief.economicEngine.metricsToAvoid.map((m) => `- AVOID ${m.metric}: ${m.reason}`).join("\n") || "- (none)";

  const modelLines = brief.model
    ? [
        `FORECAST MODEL (AI spec, code executes): horizon ${brief.model.spec.horizonYears}Y — ${brief.model.spec.horizonRationale}`,
        `Variables: ${brief.model.spec.variables.map((v) => `${v.name}${v.baseValue !== undefined ? ` base=${v.baseValue}` : ""} [${v.kind}]`).join(", ")}`,
        `Formulas: ${brief.model.spec.formulas.map((f) => `[${f.id}] ${f.equation}`).join(" | ")}`,
        `Assumptions: ${brief.model.spec.assumptions.map((a) => `${a.variable}=${a.value}${a.unit} (${a.period}) — ${a.rationale.slice(0, 120)}`).join(" | ")}`,
        brief.model.forecast ? `Forecast check: ${brief.model.forecast.identityChecks.filter((c) => c.pass).length}/${brief.model.forecast.identityChecks.length} identities pass` : "",
      ].filter(Boolean).join("\n")
    : "FORECAST MODEL: (not yet built — model AI must still determine variables/formulas)";

  const valLines = brief.valuation
    ? [
        `VALUATION: ${brief.valuation.spec.methodology} — ${brief.valuation.spec.rationale.slice(0, 300)}`,
        `Discount rate: ${brief.valuation.spec.discountRate ?? "N/A"} (${brief.valuation.spec.discountRateRationale?.slice(0, 120) || ""})`,
        `Terminal growth: ${brief.valuation.spec.terminalAssumptions?.growth ?? "N/A"}`,
        brief.valuation.result?.fairValuePerShare !== undefined ? `Fair value: ${brief.valuation.result.fairValuePerShare.toFixed(2)} (upside ${brief.valuation.result.upsidePct?.toFixed(1) ?? "N/A"}%)` : "Fair value: not yet executed",
        `Methods considered: ${brief.valuation.spec.methodsConsidered.map((m) => `${m.method} ${m.verdict}: ${m.reason}`).join(" | ")}`,
      ].join("\n")
    : "VALUATION: (not yet selected)";

  const scenLines = brief.scenarios?.length
    ? `SCENARIOS: ${brief.scenarios.map((s) => `${s.name} target ${s.targetPrice ?? "N/A"} vars ${s.changedVariables.map((cv) => `${cv.variable} ${cv.baseValue ?? "?"}→${cv.scenarioValue}`).join(",")}`).join(" | ")}`
    : "SCENARIOS: (not yet generated)";

  const marketLines = [
    brief.marketExpectations?.streetTarget !== undefined ? `Street target mean: ${brief.marketExpectations.streetTarget}` : "Street target: N/A",
    brief.marketExpectations?.recommendation ? `Street recommendation: ${brief.marketExpectations.recommendation}` : null,
    brief.marketExpectations?.estimates?.length ? `Estimates: ${brief.marketExpectations.estimates.join(" | ")}` : null,
    `Current price: ${brief.historical.derived.find(() => false) ? "" : ""}${brief.evidenceLines.find((l) => l.includes("currentPrice")) || "See evidence table"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `APEX ANALYST BRIEF — ${brief.ticker} (${brief.generatedAt})`,
    `================================================================`,
    "",
    `1. COMPANY IDENTITY`,
    `Company: ${brief.companyIdentity.name} (${brief.companyIdentity.ticker})`,
    `Country: ${brief.companyIdentity.country || "N/A"} | Sector: ${brief.companyIdentity.sector || "N/A"} | Industry: ${brief.companyIdentity.industry || "N/A"}`,
    brief.companyIdentity.description ? `Description: ${brief.companyIdentity.description}` : "",
    "",
    `2. BUSINESS MODEL`,
    `What it does: ${brief.businessModel.whatItDoes}`,
    `How it makes money: ${brief.businessModel.howItMakesMoney}`,
    `Segments: ${brief.businessModel.segments.map((s) => s.name).join(", ") || "(none — see missing info)"}`,
    `Economic units: ${brief.businessModel.economicUnits.join(", ") || "(none)"}`,
    `Statements that matter most: ${brief.businessModel.statementsThatMatterMost.join(", ") || "incomeStatement"}`,
    "",
    `3. ECONOMIC ENGINE`,
    `Primary abstraction: ${brief.economicEngine.primaryAbstraction}`,
    fmtDrivers("Revenue drivers", brief.economicEngine.revenueDrivers),
    fmtDrivers("Cost drivers", brief.economicEngine.costDrivers),
    fmtDrivers("Margin drivers", brief.economicEngine.marginDrivers),
    fmtDrivers("Cash generation drivers", brief.economicEngine.cashDrivers),
    fmtDrivers("Balance-sheet drivers", brief.economicEngine.balanceSheetDrivers),
    fmtDrivers("Returns drivers", brief.economicEngine.returnsDrivers),
    `KPIs:`,
    kpiLines,
    `Metrics to avoid:`,
    avoid,
    "",
    `4. HISTORICAL TRAJECTORY (deterministic, derived from yfinance — not raw rows)`,
    h,
    "",
    `5. CURRENT INFLECTION / MANAGEMENT SIGNALS`,
    brief.inflections.length ? brief.inflections.join("\n") : "(No deterministic inflection detected — AI research planner must answer what changed/why)",
    brief.managementSignals.length ? brief.managementSignals.join("\n") : "",
    "",
    `6-7. MODEL & FORECAST`,
    modelLines,
    "",
    `8. VALUATION`,
    valLines,
    "",
    `9. SCENARIOS`,
    scenLines,
    "",
    `10. MARKET EXPECTATIONS`,
    marketLines,
    "",
    `11-13. RISKS / CATALYSTS / COMPETITIVE (populated by narrative AI from evidence)`,
    `(AI must generate evidence-constrained: cite [F-...] or model outputs; if insufficient evidence, set insufficient=true)`,
    "",
    `14. CONTRADICTIONS & 15. MISSING INFORMATION`,
    contradictionsLines(brief),
    "",
    `16. EVIDENCE TABLE (yfinance facts [F-...] — ONLY numbers you may use)`,
    brief.evidenceLines.join("\n"),
    "",
    `17. CORE DEBATE (AI must fill: 3-5 debates with FOR/AGAINST then central thesis)`,
    brief.coreDebate || "(AI to determine key debate after reviewing evidence)",
    "",
    `PROVENANCE: Every quantitative statement must cite [F-...] or AI model output (assumption/forecast/valuation). Tier-6 inference never presented as Tier-1 filing fact.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function contradictionsLines(b: AnalystBrief): string {
  const c = b.contradictions.length ? `Contradictions:\n${b.contradictions.map((x) => `- ${x}`).join("\n")}` : "Contradictions: (none detected deterministically — AI must search for what doesn't make sense)";
  const m = b.missingInformation.length ? `Missing information / required research:\n${b.missingInformation.map((x) => `- ${x}`).join("\n")}` : "";
  return [c, m].filter(Boolean).join("\n");
}

export default { buildAnalystBrief, renderAnalystBrief };
