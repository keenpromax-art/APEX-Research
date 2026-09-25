import { computeDuPont, computeRatios } from "@/lib/calculations";
import { buildMasterReportFacts } from "@/lib/report-facts";
import { buildResearchCase } from "@/lib/research-case";
import { finalizeReport } from "@/lib/report-finalization";
import { enrichAIAnalysisFromResearchReport } from "@/lib/ai-first/enrich-report";
import { verifyCanonicalResearchPackage } from "./hash";
import { deepFreeze } from "@/lib/research-ledger/immutable";
import { compileReportPlan } from "@/lib/report-plan/compiler";
import { companyIdentityFromPackage } from "@/lib/report-plan/identity-wiring";
import { buildPresentationViewModel } from "@/lib/report-plan/presentation";
import { saveReportPlan, saveResearchIdentity, loadPriorIdentities } from "@/lib/report-plan/store";
import { buildChartSpecs, buildTableSpecs } from "@/lib/report-charts/builder";
import { computeReportFingerprints } from "@/lib/report-originality/fingerprints";
import { detectOriginalityCollision } from "@/lib/report-originality/collision";
import { persistOriginalitySummary, loadPriorFingerprints } from "@/lib/report-originality/store";
import { wireResearchIdentity, identityPublicationStatus } from "@/lib/report-plan/identity-wiring";
import { identityPublicationFromQa } from "@/lib/research-identity/identity-publication";
import type { CanonicalResearchPackage } from "./types";
import type {
  AIAnalysis,
  AnnualFinancials,
  AssumptionsLedger,
  CompanyProfile,
  DCFAssumptions,
  DCFProjection,
  DCFResult,
  DuPontAnalysis,
  QuarterlyFinancials,
  Ratios,
  ReportData,
  StockData,
} from "@/types/report";

export interface CompatibilityAdapterOptions {
  reportTypeId?: string;
  depth?: string;
  finalize?: boolean;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return finite(value) ? value : undefined;
}

function valueFor(statement: { values: Record<string, number | undefined> } | undefined, names: string[]): number | undefined {
  if (!statement) return undefined;
  for (const name of names) {
    const value = statement.values[name];
    if (finite(value)) return value;
  }
  return undefined;
}

function emptyAiAnalysis(): AIAnalysis {
  return {
    companyOverview: "",
    economicContext: "",
    globalIndustryAnalysis: "",
    domesticIndustryAnalysis: "",
    segmentAnalysis: "",
    quarterlyResultsCommentary: "",
    managementCommentary: "",
    revenueCommentary: "",
    ebitdaCommentary: "",
    ebitCommentary: "",
    patCommentary: "",
    balanceSheetCommentary: "",
    cashFlowCommentary: "",
    dupontCommentary: "",
    ratioCommentary: "",
    dcfCommentary: "",
    swotStrengths: [],
    swotWeaknesses: [],
    swotOpportunities: [],
    swotThreats: [],
    keyRisks: [],
    investmentConclusion: "",
    competitiveMoat: "",
  };
}

function currentPriceOf(packageValue: CanonicalResearchPackage): number | undefined {
  return numberOrUndefined(packageValue.sourceContext.stockData.currentPrice);
}

function discountAssumption(packageValue: CanonicalResearchPackage): number | undefined {
  return numberOrUndefined(packageValue.valuationSpec.discountRate);
}

function terminalGrowth(packageValue: CanonicalResearchPackage): number | undefined {
  return numberOrUndefined(packageValue.valuationSpec.terminalAssumptions?.growth ?? packageValue.valuationSpec.assumptions.find((assumption) => assumption.variable.toLowerCase().includes("terminal"))?.value);
}

function legacyAssumptions(packageValue: CanonicalResearchPackage): DCFAssumptions {
  const wacc = discountAssumption(packageValue);
  const growth = terminalGrowth(packageValue);
  const growthPath = Object.entries(packageValue.forecastSpec.driverPaths).find(([key]) => /revenue|sales/i.test(key))?.[1] ?? [];
  const marginPath = Object.entries(packageValue.forecastSpec.driverPaths).find(([key]) => /margin|ebit|operating/i.test(key))?.[1] ?? [];
  return {
    riskFreeRate: undefined as unknown as number,
    equityRiskPremium: undefined as unknown as number,
    beta: numberOrUndefined(packageValue.sourceContext.stockData.beta) as number,
    costOfEquity: undefined as unknown as number,
    costOfDebtPreTax: undefined as unknown as number,
    marginalTaxRate: numberOrUndefined(packageValue.forecastSpec.assumptions.find((assumption) => /tax/i.test(assumption.variable))?.value) as number,
    costOfDebtPostTax: undefined as unknown as number,
    debtWeight: undefined as unknown as number,
    equityWeight: undefined as unknown as number,
    wacc: wacc as number,
    terminalGrowthRate: growth as number,
    revenueGrowthRates: [...growthPath],
    ebitMargins: [...marginPath],
  };
}

function legacyProjections(packageValue: CanonicalResearchPackage): DCFProjection[] {
  const rate = discountAssumption(packageValue);
  return packageValue.executedForecast.incomeStatement.map((statement, index) => {
    const ebit = valueFor(statement, ["ebit", "operatingIncome"]);
    const revenue = valueFor(statement, ["revenue", "totalRevenue"]);
    const ebitMargin = ebit !== undefined && revenue !== undefined && revenue !== 0 ? ebit / revenue : undefined;
    return {
      year: statement.period,
      revenue: revenue as number,
      revenueGrowth: numberOrUndefined(statement.values.revenueGrowth) as number,
      ebitMargin: ebitMargin as number,
      ebit: ebit as number,
      taxPayment: valueFor(statement, ["taxPayment", "tax", "incomeTaxExpense"]) as number,
      nopat: valueFor(statement, ["nopat", "nopatValue"]) as number,
      depreciation: valueFor(statement, ["depreciation", "depreciationAndAmortization"]) as number,
      ebitda: valueFor(statement, ["ebitda"]) as number,
      capex: (() => { const capex = valueFor(packageValue.executedForecast.cashFlow[index], ["capex", "capitalExpenditures"]); return capex === undefined ? undefined as unknown as number : Math.abs(capex); })(),
      changeInWorkingCapital: valueFor(packageValue.executedForecast.cashFlow[index], ["changeInWorkingCapital", "deltaWorkingCapital"]) as number,
      fcff: valueFor(packageValue.executedForecast.cashFlow[index], ["fcff", "unleveredFreeCashFlow"]) as number,
      discountFactor: rate !== undefined ? 1 / Math.pow(1 + rate, index + 0.5) : undefined as unknown as number,
      pvFcff: valueFor(packageValue.executedForecast.cashFlow[index], ["pvFcff", "presentValue"]) as number,
    };
  });
}

function legacyDcf(packageValue: CanonicalResearchPackage): DCFResult {
  const valuation = packageValue.valuationResult;
  const bridge = valuation.bridge;
  const fairValue = numberOrUndefined(valuation.fairValuePerShare);
  const currentPrice = currentPriceOf(packageValue);
  const upsidePct = numberOrUndefined(valuation.upsidePct);
  const dcf = {
    status: valuation.status === "ready" ? "valid" : "insufficient_data",
    diagnostics: valuation.diagnostics?.map((diagnostic) => diagnostic.message) ?? [],
    assumptions: legacyAssumptions(packageValue),
    projections: legacyProjections(packageValue),
    sumPvFcff: numberOrUndefined(valuation.outputs.sumPvFcff) as number,
    terminalYearFcff: numberOrUndefined(valuation.outputs.terminalYearFcff) as number,
    terminalValue: numberOrUndefined(valuation.outputs.terminalValue) as number,
    pvTerminalValue: numberOrUndefined(valuation.outputs.pvTerminalValue) as number,
    enterpriseValue: numberOrUndefined(valuation.enterpriseValue ?? bridge?.enterpriseValue) as number,
    totalDebt: numberOrUndefined(bridge?.debt) as number,
    cashAndEquiv: numberOrUndefined(bridge?.cash) as number,
    netDebt: numberOrUndefined(bridge?.netDebt) as number,
    lessDebt: numberOrUndefined(bridge?.debt) as number,
    plusCash: numberOrUndefined(bridge?.cash) as number,
    equityValue: numberOrUndefined(valuation.fairValueEquity ?? bridge?.equityValue) as number,
    sharesOutstanding: numberOrUndefined(bridge?.sharesOutstanding ?? packageValue.sourceContext.stockData.sharesOutstanding) as number,
    intrinsicValue: fairValue as number,
    fairValuePerShare: fairValue as number,
    currentMarketPrice: currentPrice as number,
    upsideDownside: upsidePct !== undefined ? upsidePct / 100 : undefined as unknown as number,
    verdict: packageValue.rating,
    confidence: valuation.status === "ready" ? "medium" : "low",
    modelVersion: packageValue.versions.forecast,
    ...(packageValue.reverseResult ? { reverseDCF: undefined } : {}),
  } as unknown as DCFResult;
  return dcf;
}

function legacyLedger(packageValue: CanonicalResearchPackage, dcf: DCFResult): AssumptionsLedger {
  const fairValue = numberOrUndefined(packageValue.valuationResult.fairValuePerShare);
  const currentPrice = currentPriceOf(packageValue);
  const canonicalUpside = numberOrUndefined(packageValue.valuationResult.upsidePct);
  const upside = canonicalUpside !== undefined ? canonicalUpside / 100 : fairValue !== undefined && currentPrice !== undefined && currentPrice > 0 ? (fairValue - currentPrice) / currentPrice : undefined;
  const bridge = packageValue.valuationResult.bridge;
  return {
    fairValue: fairValue as number,
    targetPrice: fairValue as number,
    currentPrice: currentPrice as number,
    upsideDownsidePct: upside as number,
    rating: packageValue.rating,
    ratingRationale: packageValue.quality.canPublish ? "Canonical package valuation." : "Diagnostic only: canonical publication gate is blocked.",
    riskFreeRate: numberOrUndefined(dcf.assumptions.riskFreeRate) as number,
    equityRiskPremium: numberOrUndefined(dcf.assumptions.equityRiskPremium) as number,
    beta: numberOrUndefined(dcf.assumptions.beta) ?? numberOrUndefined(packageValue.sourceContext.stockData.beta) as number,
    costOfEquity: numberOrUndefined(dcf.assumptions.costOfEquity) as number,
    costOfDebtPreTax: numberOrUndefined(dcf.assumptions.costOfDebtPreTax) as number,
    marginalTaxRate: numberOrUndefined(dcf.assumptions.marginalTaxRate) as number,
    costOfDebtPostTax: numberOrUndefined(dcf.assumptions.costOfDebtPostTax) as number,
    debtWeight: numberOrUndefined(dcf.assumptions.debtWeight) as number,
    equityWeight: numberOrUndefined(dcf.assumptions.equityWeight) as number,
    wacc: numberOrUndefined(dcf.assumptions.wacc) as number,
    terminalGrowthRate: numberOrUndefined(dcf.assumptions.terminalGrowthRate) as number,
    sumPvFcff: numberOrUndefined(dcf.sumPvFcff) as number,
    pvTerminalValue: numberOrUndefined(dcf.pvTerminalValue) as number,
    enterpriseValue: numberOrUndefined(dcf.enterpriseValue) as number,
    totalDebt: numberOrUndefined(dcf.totalDebt) as number,
    cashAndEquiv: numberOrUndefined(dcf.cashAndEquiv) as number,
    netDebt: numberOrUndefined(dcf.netDebt) as number,
    equityValue: numberOrUndefined(dcf.equityValue) as number,
    sharesOutstanding: numberOrUndefined(dcf.sharesOutstanding) as number,
    moatRating: packageValue.researchReport.moat.hasMoat ? "Wide" : "None",
    moatTrend: "Stable",
    moatBridge: packageValue.researchReport.moat.verdict,
    currency: packageValue.sourceContext.profile.currency,
    reportingUnit: packageValue.sourceContext.profile.currency,
    unitMultiplier: 1,
    ...(bridge ? {} : {}),
  } as AssumptionsLedger;
}

function ratiosAndDupont(annual: AnnualFinancials[], currentPrice: number | undefined): { ratios: Ratios[]; dupont: DuPontAnalysis[] } {
  return {
    ratios: currentPrice === undefined ? [] : annual.map((financial) => computeRatios(financial, currentPrice)),
    dupont: annual.map((financial) => computeDuPont(financial)),
  };
}

function projectMasterFacts(report: ReportData): any {
  if (!report.assumptionsLedger || !report.dcf) return undefined;
  try {
    return buildMasterReportFacts({
      stockData: report.stockData,
      profile: report.profile,
      annualFinancials: report.annualFinancials,
      ratiosByYear: report.ratiosByYear,
      dupontByYear: report.dupontByYear,
      dcf: report.dcf,
      peers: report.peers,
      ledger: report.assumptionsLedger,
    });
  } catch {
    return undefined;
  }
}

function setMasterAuthority(master: any, report: ReportData, packageValue: CanonicalResearchPackage): any {
  if (!master) return master;
  master.generatedAt = packageValue.run.completedAt ?? packageValue.run.startedAt;
  if (master.market) master.market.asOfDate = packageValue.dataCutoff;
  const fairValue = packageValue.valuationResult.fairValuePerShare;
  const currentPrice = currentPriceOf(packageValue);
  if (master.valuation?.fairValue) master.valuation.fairValue.value = finite(fairValue) ? fairValue : null;
  if (master.valuation?.upside) master.valuation.upside.value = finite(packageValue.valuationResult.upsidePct) ? packageValue.valuationResult.upsidePct! / 100 : null;
  if (master.market?.currentPrice) master.market.currentPrice.value = finite(currentPrice) ? currentPrice : null;
  if (master.recommendation) master.recommendation.rating = packageValue.rating;
  if (master.provenance) {
    master.provenance.valuation = "DERIVED";
    master.provenance.recommendation = "DERIVED";
  }
  return master;
}

export function adaptCanonicalResearchPackage(
  packageValue: CanonicalResearchPackage,
  options: CompatibilityAdapterOptions = {},
): ReportData {
  packageValue = deepFreeze(packageValue) as CanonicalResearchPackage;
  if (!verifyCanonicalResearchPackage(packageValue)) throw new TypeError("Cannot adapt a package that fails integrity verification");
  const profile: CompanyProfile = packageValue.sourceContext.profile;
  const stockData: StockData = packageValue.sourceContext.stockData;
  const annualFinancials: AnnualFinancials[] = packageValue.sourceContext.annualFinancials;
  const quarterlyFinancials: QuarterlyFinancials[] = packageValue.sourceContext.quarterlyFinancials;
  const { ratios, dupont } = ratiosAndDupont(annualFinancials, currentPriceOf(packageValue));
  const dcf = legacyDcf(packageValue);
  const assumptionsLedger = legacyLedger(packageValue, dcf);
  const aiAnalysis = enrichAIAnalysisFromResearchReport(emptyAiAnalysis(), packageValue.researchReport);
  const base: ReportData = {
    generatedAt: packageValue.run.completedAt ?? packageValue.run.startedAt,
    profile,
    stockData,
    annualFinancials,
    quarterlyFinancials,
    ratiosByYear: ratios,
    dupontByYear: dupont,
    dcf,
    assumptionsLedger,
    researchPlan: packageValue.researchPlan ?? null,
    researchReport: packageValue.researchReport,
    canonicalPackage: packageValue,
    canonicalQuality: packageValue.quality,
    diagnosticPreview: !packageValue.quality.canPublish,
    shareholding: packageValue.sourceContext.shareholding,
    peers: [],
    aiAnalysis,
    news: [],
    eventPriceMovements: [],
    recommendation: packageValue.rating,
    targetPrice: packageValue.valuationResult.fairValuePerShare as number,
    cmp: currentPriceOf(packageValue) as number,
    analystName: "Apex Research Team",
    calibration: undefined,
    qaReport: undefined,
    finalQAResult: undefined,
  } as ReportData;
  const researchCase = (() => {
    try {
      return buildResearchCase({
        profile,
        stockData,
        annualFinancials,
        quarterlyFinancials,
        valuation: dcf,
        assumptionsLedger,
        researchReport: packageValue.researchReport,
        researchPlan: packageValue.researchPlan,
        aiAnalysis,
        createdAt: base.generatedAt,
        dataCutoff: packageValue.dataCutoff,
        modelVersion: packageValue.versions.model,
      });
    } catch {
      return null;
    }
  })();
  base.researchCase = researchCase;
  if (researchCase?.evidence) base.evidenceRegistry = researchCase.evidence;
  else delete base.evidenceRegistry;
  base.researchGraph = null;
  base.masterReportFacts = setMasterAuthority(projectMasterFacts(base), base, packageValue);
  const qaDecision = packageValue.qaDecision ?? packageValue.canonicalQa?.decision ?? null;
  const qaGateStatus = qaDecision === "READY" ? "READY" : qaDecision === "QUALIFIED" ? "READY_WITH_WARNINGS" : "BLOCKED";
  const qaPassed = packageValue.quality.canPublish && qaDecision !== "BLOCK" && qaDecision !== "REVIEW";
  base.qaReport = {
    passed: qaPassed,
    score: qaPassed ? 100 : packageValue.quality.canPublish ? 70 : 0,
    gateStatus: packageValue.quality.canPublish ? qaGateStatus : "BLOCKED",
    tierSummary: {
      consistency: packageValue.quality.canPublish ? "PASS" : "FAIL",
      plausibility: packageValue.quality.canPublish ? "PASS" : "WARN",
      appropriateness: packageValue.quality.canPublish ? "PASS" : "FAIL",
    },
    timestamp: base.generatedAt,
    checks: packageValue.quality.checks.map((check) => ({
      id: check.id,
      category: "CROSS_REFERENCE" as const,
      name: check.id,
      status: check.status === "pass" ? "PASS" as const : check.status === "warn" ? "WARN" as const : "FAIL" as const,
      details: check.message,
    })),
    checksums: {
      fairValueMatchCount: packageValue.quality.canPublish ? 1 : 0,
      fairValueLedger: numberOrUndefined(packageValue.valuationResult.fairValuePerShare) ?? 0,
      waccLedger: discountAssumption(packageValue) ?? 0,
      tgrLedger: terminalGrowth(packageValue) ?? 0,
      balanceSheetVariance: 0,
      ratingAlignedWithUpside: packageValue.quality.canPublish,
    },
  };
  base.finalQAResult = {
    canPublish: packageValue.quality.canPublish,
    status: packageValue.quality.canPublish ? (qaDecision === "QUALIFIED" ? "QUALIFIED" : "READY") : (qaDecision === "REVIEW" ? "REVIEW" : "BLOCKED"),
    qaDecision: qaDecision ?? (packageValue.quality.canPublish ? "READY" : "BLOCK"),
    errors: packageValue.quality.blockers.map((message) => ({ code: "CANONICAL_PACKAGE_BLOCKED", message })),
  };
  attachCanonicalPresentation(base, packageValue, researchCase, options);
  if (options.finalize === false) return base;
  try {
    const finalized = finalizeReport(base, {
      reportTypeId: (options.reportTypeId ?? "institutional_equity_v1") as never,
      depth: (options.depth ?? "concise") as never,
      composedAt: base.generatedAt,
      graphBuiltAt: base.generatedAt,
    }).report;
    finalized.canonicalPackage = packageValue;
    finalized.canonicalQuality = packageValue.quality;
    finalized.diagnosticPreview = !packageValue.quality.canPublish;
    finalized.qaReport = base.qaReport;
    finalized.finalQAResult = base.finalQAResult;
    carryCanonicalPresentation(base, finalized);
    return finalized;
  } catch {
    return base;
  }
}

function attachCanonicalPresentation(base: ReportData, packageValue: CanonicalResearchPackage, researchCase: ReturnType<typeof buildResearchCase> | null, options: CompatibilityAdapterOptions): void {
  const record = base as unknown as Record<string, unknown>;
  const reportTypeId = (options.reportTypeId ?? "institutional_equity_v1") as "institutional_equity_v1";
  const depth = (options.depth ?? "concise") as "concise" | "full";
  const generatedAt = base.generatedAt;
  try {
    const companyIdentity = companyIdentityFromPackage(packageValue, generatedAt);
    record.companyIdentity = companyIdentity;
    record.reportCompanyIdentity = companyIdentity;
  } catch {
    return;
  }
  let researchIdentity: import("@/lib/research-identity").ResearchDNA | null = null;
  if (researchCase) {
    try {
      const priors = loadPriorIdentities(packageValue.ticker).slice(-20);
      researchIdentity = wireResearchIdentity({ researchCase, reportTypeId: reportTypeId as never, depth: depth as never, createdAt: generatedAt, priorIdentities: priors });
      record.researchIdentity = researchIdentity;
      try { saveResearchIdentity(researchIdentity); } catch { return; }
    } catch {
      researchIdentity = null;
    }
  }
  let reportPlan: import("@/lib/report-plan/types").ReportPlan | null = null;
  try {
    reportPlan = compileReportPlan({ packageValue, blueprintId: reportTypeId as never, depth: depth as never, identity: researchIdentity, researchPlan: packageValue.researchPlan ?? null, generatedAt });
    record.reportPlan = reportPlan;
    try { saveReportPlan(reportPlan); } catch { return; }
  } catch {
    reportPlan = null;
  }
  let chartSpecs: import("@/lib/report-charts/builder").ChartSpec[] | null = null;
  let tableSpecs: import("@/lib/report-charts/builder").TableSpec[] | null = null;
  if (reportPlan) {
    try {
      const charts = buildChartSpecs({ packageValue, plan: reportPlan });
      chartSpecs = [...charts.specs, ...charts.omitted];
      record.chartSpecs = chartSpecs;
      record.reportChartSpecs = chartSpecs;
    } catch {
      chartSpecs = null;
    }
    try {
      const tables = buildTableSpecs({ packageValue, plan: reportPlan });
      tableSpecs = [...tables.specs, ...tables.omitted];
      record.tableSpecs = tableSpecs;
      record.reportTableSpecs = tableSpecs;
    } catch {
      tableSpecs = null;
    }
  }
  if (reportPlan) {
    try {
      const acceptedCharts = (chartSpecs ?? []).filter((spec) => spec.omissionReason === null);
      const acceptedTables = (tableSpecs ?? []).filter((spec) => spec.omissionReason === null);
      const presentation = buildPresentationViewModel({ packageValue, plan: reportPlan, charts: acceptedCharts, tables: acceptedTables, generatedAt });
      record.presentationViewModel = presentation;
      record.reportPresentation = presentation;
    } catch {
      return;
    }
  }
  try {
    const presentation = record.presentationViewModel as import("@/lib/report-plan/presentation").PresentationViewModel | undefined;
    const acceptedCharts = (chartSpecs ?? []).filter((spec) => spec.omissionReason === null);
    const acceptedTables = (tableSpecs ?? []).filter((spec) => spec.omissionReason === null);
    if (reportPlan && presentation) {
      const fingerprints = computeReportFingerprints({ packageValue, plan: reportPlan, charts: acceptedCharts, tables: acceptedTables, identity: researchIdentity });
      record.reportFingerprints = fingerprints;
      const priors = loadPriorFingerprints(packageValue.ticker);
      const peerTickers = Array.isArray((packageValue as unknown as { peers?: unknown }).peers) ? [] as string[] : [];
      const originality = detectOriginalityCollision({ ticker: packageValue.ticker, fingerprints, priors, generatedAt, peerTickers });
      record.originalityReport = originality;
      record.reportOriginality = originality;
      try { persistOriginalitySummary({ ticker: packageValue.ticker, fingerprints, report: originality }); } catch { return; }
      const qaDecision = packageValue.qaDecision ?? packageValue.canonicalQa?.decision ?? null;
      const companyIdentity = record.companyIdentity as import("@/lib/report-plan/identity-wiring").CompanyIdentity | undefined;
      if (companyIdentity) {
        record.identityPublication = identityPublicationStatus({ identity: researchIdentity, companyIdentity, qaDecision: qaDecision as string | null, canPublish: packageValue.quality.canPublish });
        record.identityQaPublication = identityPublicationFromQa({ identity: researchIdentity, qaDecision: qaDecision as string | null, canPublish: packageValue.quality.canPublish });
      }
    }
  } catch {
    return;
  }
}

function carryCanonicalPresentation(source: ReportData, target: ReportData): void {
  const from = source as unknown as Record<string, unknown>;
  const to = target as unknown as Record<string, unknown>;
  for (const key of ["companyIdentity", "reportCompanyIdentity", "researchIdentity", "reportPlan", "chartSpecs", "reportChartSpecs", "tableSpecs", "reportTableSpecs", "presentationViewModel", "reportPresentation", "reportFingerprints", "originalityReport", "reportOriginality", "identityPublication", "identityQaPublication"]) {
    if (from[key] !== undefined) to[key] = from[key];
  }
}

export const projectCanonicalPackage = adaptCanonicalResearchPackage;
export const adaptCanonicalPackageToReportData = adaptCanonicalResearchPackage;
export const buildCompatibilityReportData = adaptCanonicalResearchPackage;
export const toReportData = adaptCanonicalResearchPackage;
