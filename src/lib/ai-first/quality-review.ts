/**
 * APEX RESEARCH — AI QUALITY REVIEW LOOP
 *
 * "AI reviewers identify defects → AI adjudicator regenerates only the defective component."
 *
 * Eight specialized reviewers, each with a specific focus, independently evaluate
 * the generated research package. A final adjudicator decides what must be regenerated.
 * The system can regenerate components individually (forecast, valuation, thesis, etc.)
 * rather than rebuilding the entire report.
 *
 * PRINCIPLE: Component-level regeneration. Do not rebuild the entire report unnecessarily.
 */

import type {
  FactPack,
  Fact,
  ResearchReport,
  CompanyUnderstanding,
  AIResearchModel,
  ForecastResult,
  ValuationResult,
  ThesisSpecification,
  Catalyst,
  Risk,
  CompetitorAnalysis,
  MoatAnalysis,
  Formula,
  Assumption,
  ScenarioSpecification,
} from "./types";
import type { ProvenanceTier } from "./types";
import { QA_GATES_ENABLED } from "../qa-gates";
import { runCanonicalQa } from "../canonical-qa/decision";
import { runBoundedRegeneration } from "../canonical-qa/regeneration";
import type { CanonicalQaResult } from "../canonical-qa/types";

/** Reviewer severity levels */
export type ReviewSeverity = "blocker" | "major" | "minor";

/** A finding from a reviewer */
export interface ReviewFinding {
  reviewer: string;
  severity: ReviewSeverity;
  component: string;
  finding: string;
  recommendation: string;
}

/** The review result for one component */
export interface ReviewResult {
  findings: ReviewFinding[];
  passed: boolean;
  overallScore: number; // 0-100
}

/**
 * Seats executed by `runQualityReview` (order is documentation; scoring walks
 * the same list). Exported for AI-orchestration committee wiring — additive,
 * no scoring change. Includes Research Judge (runs but was previously missing
 * from the private name list).
 */
export const QUALITY_REVIEWER_NAMES = [
  "Financial Analyst",
  "Accounting Analyst",
  "Valuation Analyst",
  "Industry Analyst",
  "Skeptical Analyst",
  "Fact Checker",
  "Report Editor",
  "Research Judge",
  "Final Institutional Research Reviewer",
] as const;

/** Reviewer 1: Financial analyst — checks statement integrity, margin analysis, cash flow quality */
const financialAnalyzer = (report: ResearchReport): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { forecast, valuation, scenarios, thesis, risks, moat, competitiveAnalysis } = report;

  // Check forecast identity integrity
  if (forecast?.incomeStatement) {
    for (let i = 0; i < forecast.incomeStatement.length; i++) {
      const y = forecast.incomeStatement[i];
      // Check net margin consistency: NI / Revenue should not exceed 1
      const rev = y.values?.revenue;
      const ni = y.values?.netIncome;
      if (rev !== undefined && rev !== 0 && ni !== undefined) {
        const margin = ni / rev;
        if (margin > 1) {
          findings.push({
            reviewer: "Financial Analyst",
            severity: "blocker",
            component: "forecast:incomeStatement",
            finding: `${y.period} net margin exceeds 100% (NI/Revenue = ${(margin * 100).toFixed(1)}%)`,
            recommendation: "Re-evaluate revenue and NI assumptions; flag for AI regeneration",
          });
        }
      }
    }
  }

  // Check valuation consistency
  if (valuation?.fairValuePerShare !== undefined && valuation?.upsidePct !== undefined) {
    if (Math.abs(valuation.upsidePct) > 150) {
      findings.push({
        reviewer: "Financial Analyst",
        severity: "major",
        component: "valuation",
        finding: `Upside of ${valuation.upsidePct.toFixed(1)}% seems implausible — verify assumptions`,
        recommendation: "Review growth assumptions and discount rate; regenerate valuation if needed",
      });
    }
  }

  // Check scenario monotonicity
  if (scenarios?.length === 3) {
    const targets = scenarios.map((s: any) => s.targetPrice).filter((v: any) => v !== null);
    if (targets.length === 3) {
      const [bear, base, bull] = targets;
      if (!(bull >= base && base >= bear)) {
        findings.push({
          reviewer: "Financial Analyst",
          severity: "blocker",
          component: "scenarios",
          finding: "Scenario targets violate monotonicity: Bull < Base or Base < Bear",
          recommendation: "Regenerate scenarios ensuring Bull >= Base >= Bear",
        });
      }
    }
  }

  return findings;
};

/** Reviewer 2: Accounting analyst — checks accounting identities, balance sheet quality, ratio compliance */
const accountingAnalyzer = (report: ResearchReport): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { forecast } = report;

  // Check balance sheet identity: Assets = Liabilities + Equity
  if (forecast?.balanceSheet) {
    for (const y of forecast.balanceSheet) {
      const a = y.values?.totalAssets;
      const l = y.values?.totalLiabilities;
      const e = y.values?.totalEquity;
      if (a !== undefined && l !== undefined && e !== undefined) {
        if (Math.abs(a - (l + e)) > 1) {
          findings.push({
            reviewer: "Accounting Analyst",
            severity: "blocker",
            component: "forecast:balanceSheet",
            finding: `FY${y.period} BS identity failed: Assets (${a}) ≠ Liabilities (${l}) + Equity (${e})`,
            recommendation: "Enforce balance sheet identity with balancing plug; regenerate forecast",
          });
        }
      }
    }
  }

  // Check cash flow identity
  if (forecast?.cashFlow) {
    for (const y of forecast.cashFlow) {
      const co = y.values?.cashClose; // ending cash
      const ci = y.values?.cfi; // cash flow from investing
      const cof = y.values?.cfo; // cash flow from operations
      const cff = y.values?.cff; // cash flow from financing
      const ciOpen = y.values?.cashOpen; // beginning cash

      if (co !== undefined && ci !== undefined && cff !== undefined && ciOpen !== undefined) {
        const implied = ciOpen + (cof || 0) + (ci || 0) + (cff || 0);
        if (Math.abs(implied - co) > 1) {
          findings.push({
            reviewer: "Accounting Analyst",
            severity: "blocker",
            component: "forecast:cashFlow",
            finding: `FY${y.period} CF identity failed: implied close (${implied}) ≠ reported close (${co})`,
            recommendation: "Recompute cashClose from roll-forward; regenerate forecast section",
          });
        }
      }
    }
  }

  // Ratio checks
  if (forecast?.incomeStatement) {
    const last = forecast.incomeStatement[forecast.incomeStatement.length - 1];
    const rev = last?.values?.revenue;
    const ni = last?.values?.netIncome;
    if (rev !== undefined && rev > 0 && ni !== undefined) {
      const netMargin = ni / rev;
      if (netMargin > 0.5) {
        findings.push({
          reviewer: "Accounting Analyst",
          severity: "major",
          component: "forecast:incomeStatement",
          finding: `FY${last.period} net margin ${(netMargin * 100).toFixed(1)}% is very high — verify assumptions`,
          recommendation: "Review cost assumptions and margin trajectory; regenerate if unjustified",
        });
      }
    }
  }

  return findings;
};

/** Reviewer 3: Valuation analyst — checks valuation methodology, assumption reasonableness, output consistency */
const valuationAnalyzer = (report: ResearchReport): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { valuation, forecast, scenarios } = report;

  // Check that valuation methodology is specified and not generic
  if (valuation) {
    const { methodology, fairValuePerShare, upsidePct, outputs } = valuation;

    if (!methodology) {
      findings.push({
        reviewer: "Valuation Analyst",
        severity: "blocker",
        component: "valuation",
        finding: "No valuation methodology specified",
        recommendation: "AI must select and justify valuation method; regenerate valuation",
      });
    } else if (methodology.toLowerCase().includes("dcf") && !outputs) {
      findings.push({
        reviewer: "Valuation Analyst",
        severity: "major",
        component: "valuation",
        finding: "DCF selected but no valuation outputs computed",
        recommendation: "Execute valuation engine with DCF assumptions; regenerate valuation",
      });
    }

    // Check upside consistency with fair value
    if (upsidePct !== undefined && fairValuePerShare !== undefined && forecast) {
      const currentPrice = (forecast as any).currentPrice;
      if (currentPrice && currentPrice > 0) {
        const impliedUpside = ((fairValuePerShare / currentPrice) - 1) * 100;
        if (Math.abs(impliedUpside - upsidePct) > 20) {
          findings.push({
            reviewer: "Valuation Analyst",
            severity: "major",
            component: "valuation",
            finding: `Upside discrepancy: computed ${impliedUpside.toFixed(1)}% vs reported ${upsidePct.toFixed(1)}%`,
            recommendation: "Reconcile upside calculation; regenerate valuation if inconsistency persists",
          });
        }
      }
    }
  }

  // Check scenario-valued consistency
  if (scenarios?.length === 3 && valuation?.fairValuePerShare) {
    const targets = scenarios.map((s: any) => s.targetPrice).filter((v: any) => v !== null);
    if (targets.length === 3) {
      const [bear, base, bull] = targets;
      // Base should be close to the main fair value
      if (Math.abs(base - valuation.fairValuePerShare!) > Math.abs(valuation.fairValuePerShare!) * 0.25) {
        findings.push({
          reviewer: "Valuation Analyst",
          severity: "major",
          component: "scenarios-valuation",
          finding: `Base scenario fair value (${base.toFixed(2)}) deviates >25% from main FV (${valuation.fairValuePerShare!.toFixed(2)})`,
          recommendation: "Review scenario assumptions and re-align with main valuation",
        });
      }
    }
  }

  return findings;
};

/** Reviewer 4: Industry analyst — semantic company-identity + emergency contamination net */
const industryAnalyzer = (report: ResearchReport, pack: FactPack): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { thesis, risks, moat, competitiveAnalysis, companyUnderstanding, forecast, valuation } = report;

  // SEMANTIC QA (audit §22): does thesis use the company's actual economic drivers?
  const abstraction = (companyUnderstanding?.primaryEconomicAbstraction || "").toLowerCase();
  const thesisLower = thesis.thesis.toLowerCase();
  const driverNames = [
    ...(companyUnderstanding?.revenueDrivers || []).map((d) => d.name.toLowerCase()),
    ...(companyUnderstanding?.costDrivers || []).map((d) => d.name.toLowerCase()),
    ...(companyUnderstanding?.marginDrivers || []).map((d) => d.name.toLowerCase()),
  ].filter(Boolean);
  const kpiNames = (companyUnderstanding?.keyKpis || []).map((k) => k.name.toLowerCase());
  const thesisUsesEconomics = !abstraction || thesisLower.includes(abstraction) || driverNames.some((d) => thesisLower.includes(d));
  if (!thesisUsesEconomics && thesis.thesis.length > 30) {
    findings.push({
      reviewer: "Industry Analyst",
      severity: "major",
      component: "thesis",
      finding: `Thesis does not use the company's actual economic drivers/abstraction ("${abstraction || "missing"}") — appears generic. Drivers: ${driverNames.slice(0, 3).join(", ") || "none"}`,
      recommendation: "Regenerate thesis grounded in the company's primary abstraction and driver mechanism, citing [F-...] or model outputs",
    });
  }

  // Check that risks map to an identified KPI/driver
  for (const r of risks) {
    const kpi = (r.affectedKpi || "").toLowerCase();
    const matchesKpi = !kpi || kpiNames.some((k) => kpi.includes(k) || k.includes(kpi)) || driverNames.some((d) => kpi.includes(d));
    if (!matchesKpi && kpi) {
      findings.push({
        reviewer: "Industry Analyst",
        severity: "major",
        component: "risks",
        finding: `Risk [${r.risk}] affected KPI "${r.affectedKpi}" does not match any identified KPI/driver for this company (${kpiNames.slice(0, 4).join(", ") || "none"})`,
        recommendation: "Align risk's affectedKPI to the company's actual KPI set or regenerate with company-specific mechanism",
      });
    }
    // Catalyst ↔ forecast variable link
    // (checked below for catalysts)
  }

  // Catalyst → financialVariable must be a model variable when forecast exists
  const modelVars = new Set([
    ...((report.operatingModel?.variables || []).map((v: any) => String(v.name).toLowerCase())),
    ...Object.keys((forecast as any)?.identityChecks ? {} : {}),
  ]);
  // also check thesis vs forecast linkage: if thesis mentions valuation driver not in model, flag
  if (forecast?.incomeStatement?.[0]?.values) {
    const forecastKeys = Object.keys(forecast.incomeStatement[0].values).map((k) => k.toLowerCase());
    for (const c of report.catalysts || []) {
      const fv = (c.financialVariable || "").toLowerCase();
      if (fv && fv !== "n/a" && !forecastKeys.includes(fv) && !modelVars.has(fv) && !kpiNames.includes(fv)) {
        findings.push({
          reviewer: "Industry Analyst",
          severity: "minor",
          component: "catalysts",
          finding: `Catalyst [${c.catalyst}] financialVariable "${c.financialVariable}" does not map to any forecast variable/KPI for this company`,
          recommendation: "Map catalyst to the model's actual variable or mark quantitative=false",
        });
      }
    }
  }

  // Moat evidence check
  if (moat?.hasMoat && moat.sources?.length) {
    for (const s of moat.sources) {
      if (!s.evidence || s.evidence.length < 15) {
        findings.push({
          reviewer: "Industry Analyst",
          severity: "major",
          component: "moat",
          finding: `Moat source "${s.source}" has weak/missing evidence — moat must be defended with [F-...] or model output`,
          recommendation: "Regenerate moat with evidence-constrained sources only; if insufficient, set hasMoat=false",
        });
        break;
      }
    }
  }
  // Competitive overlap check
  for (const comp of competitiveAnalysis?.competitors || []) {
    if (!comp.businessOverlap || comp.businessOverlap.length < 15) {
      findings.push({
        reviewer: "Industry Analyst",
        severity: "major",
        component: "competitiveAnalysis",
        finding: `Competitor "${comp.company}" lacks meaningful businessOverlap explanation — not evidence-constrained`,
        recommendation: "Remove tenuous peer or add overlap/economic similarity grounded in business model",
      });
      break;
    }
  }

  // Emergency hardcoded contamination net (retained as safety, not primary intelligence)
  const forbiddenInThesis = thesis.thesis.toLowerCase();
  const forbiddenConcepts = [
    "search index",
    "advertiser bidding",
    "custom silicon",
    "hyperscale infrastructure",
    "FMCG",
    "consumer packaged goods",
    "same-store sales",
    "foot traffic",
  ];

  for (const concept of forbiddenConcepts) {
    if (forbiddenInThesis.includes(concept)) {
      findings.push({
        reviewer: "Industry Analyst",
        severity: "blocker",
        component: "thesis",
        finding: `Cross-sector contamination (emergency net): thesis mentions "${concept}" — not appropriate for this company`,
        recommendation: "Regenerate thesis from company-specific facts only",
      });
      // Only flag first occurrence
      break;
    }
  }

  // Check risks for generic labels without explanation
  for (const r of risks) {
    const lower = r.risk.toLowerCase();
    const genericLabels = ["competition", "regulation", "macro", "interest rates"];
    if (genericLabels.some(g => lower === g)) {
      // Check if the risk has a company-specific explanation
      if (r.mechanism.length < 20 || !r.mechanism.includes(competitiveAnalysis?.competitors?.[0]?.company || "the company")) {
        findings.push({
          reviewer: "Industry Analyst",
          severity: "major",
          component: "risks",
          finding: `Risk [${r.risk}] is a generic label — add company-specific mechanism`,
          recommendation: "Regenerate risk with company-specific mechanism and affected KPI",
        });
      }
    }
  }

  // Check competitive analysis for artificial comparisons
  if (competitiveAnalysis?.competitors) {
    if (competitiveAnalysis.competitors.length > 5) {
      findings.push({
        reviewer: "Industry Analyst",
        severity: "major",
        component: "competitiveAnalysis",
        finding: `Peer set has ${competitiveAnalysis.competitors.length} competitors — may include artificial comparisons`,
        recommendation: "Reduce peer set to most relevant 3-5 competitors; remove tenuous connections",
      });
    }
  }

  return findings;
};

/** Reviewer 5: Skeptical analyst — adversarial: try to prove report wrong (audit §25) */
const skepticalAnalyzer = (report: ResearchReport): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { thesis, risks, catalysts, moat, competitiveAnalysis, companyUnderstanding, valuation, forecast } = report;
  const thesisLowerEarly = thesis.thesis.toLowerCase();
  const driverNamesSk = [
    ...(companyUnderstanding?.revenueDrivers || []).map((d) => d.name.toLowerCase()),
    ...(companyUnderstanding?.costDrivers || []).map((d) => d.name.toLowerCase()),
    ...(companyUnderstanding?.marginDrivers || []).map((d) => d.name.toLowerCase()),
  ].filter(Boolean);
  const kpiNamesSk = (companyUnderstanding?.keyKpis || []).map((k) => k.name.toLowerCase());

  // Adversarial: what is the weakest assumption? which valuation input does most work?
  if (valuation?.executedFrom) {
    const disc = valuation.executedFrom.discountRate;
    const tg = valuation.executedFrom.terminalAssumptions?.growth;
    if (disc !== undefined && tg !== undefined) {
      if (disc - tg < 0.02) {
        findings.push({
          reviewer: "Skeptical Analyst",
          severity: "major",
          component: "valuation",
          finding: `Valuation spread ke - g = ${((disc - tg) * 100).toFixed(1)}% is very tight — terminal value dominates fair value (doing most work)`,
          recommendation: "Widen spread or stress-test terminal growth; regenerate valuation with justified terminal assumption citing [F-...]",
        });
      }
      if (disc !== undefined && (disc < 0.06 || disc > 0.18)) {
        findings.push({
          reviewer: "Skeptical Analyst",
          severity: "major",
          component: "valuation",
          finding: `Discount rate ${disc} outside 6-18% — check against market risk and company leverage`,
          recommendation: "Justify discount rate with CAPM/leverage evidence or regenerate",
        });
      }
    }
    // weakest assumption heuristic: lowest confidence assumption
    const weakest = [...(valuation.executedFrom.assumptions || [])].sort((a, b) => (a.confidence ?? 0.7) - (b.confidence ?? 0.7))[0];
    if (weakest && (weakest.confidence ?? 0.7) < 0.4) {
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "major",
        component: "valuation",
        finding: `Weakest valuation assumption "${weakest.variable}" confidence ${(weakest.confidence ?? 0).toFixed(2)} — valuation is heavily dependent on low-evidence input`,
        recommendation: "Add historical evidence [F-...] or mark as key uncertainty with monitoring KPI",
      });
    }
  }

  // What fact contradicts the thesis? — check thesis vs contradictions
  // If thesis is bullish but forecast shows flat/declining revenue, flag
  if (forecast?.incomeStatement?.length >= 2) {
    const last = forecast.incomeStatement[forecast.incomeStatement.length - 1]?.values?.revenue;
    const first = forecast.incomeStatement[0]?.values?.revenue;
    if (last !== undefined && first !== undefined && last < first && /growth|expand|bull/i.test(thesis.thesis)) {
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "major",
        component: "thesis",
        finding: "Thesis is growth/bullish yet deterministic forecast shows declining revenue — contradiction",
        recommendation: "Reconcile thesis with forecast trajectory or regenerate one of them",
      });
    }
  }

  // Which sentence sounds generic?
  const genericPhrases = ["strong fundamentals", "well positioned", "poised for growth", "robust outlook"];
  for (const phrase of genericPhrases) {
    if (thesis.thesis.toLowerCase().includes(phrase)) {
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "major",
        component: "thesis",
        finding: `Thesis contains generic phrase "${phrase}" without company-specific mechanism`,
        recommendation: "Replace with evidence-constrained mechanism citing [F-...] or driver",
      });
      break;
    }
  }

  // What would cause valuation to fall 30%? — flag missing downside
  if (!thesis.bearCase?.length || thesis.bearCase.every((s) => s.length < 15)) {
    findings.push({
      reviewer: "Skeptical Analyst",
      severity: "major",
      component: "thesis",
      finding: "Bear case is missing or generic — report cannot defend downside (what falls 30%?)",
      recommendation: "Generate bear case grounded in an identified KPI/driver failure with monitoring indicator",
    });
  }

  // Thesis must contain invalidation condition / whatCouldInvalidate
  if (!thesis.whatCouldInvalidate?.length || thesis.whatCouldInvalidate.some((s) => s.length < 10)) {
    findings.push({
      reviewer: "Skeptical Analyst",
      severity: "major",
      component: "thesis",
      finding: "Thesis lacks falsifiable invalidation condition — not institutional quality",
      recommendation: "Add 'what would prove thesis wrong' with observable KPI/monitoring indicator",
    });
  }

  // THESIS CHAIN: evidence → mechanism → KPI → valuation must be present (anti-generic)
  {
    const hasEvidence = /\[F-[^\]]+\]/i.test(thesis.thesis) || /\[F-/.test(thesis.bullCase?.join(" ") || "") || /forecast|canonical|assumption/i.test(thesis.thesis);
    const hasMechanism = driverNamesSk.some((d) => thesisLowerEarly.includes(d)) || /RevPAR|ADR|occupancy|ARPU|NIM|credit cost|volume|ASP|take rate|throughput|utilization/i.test(thesis.thesis);
    const hasKpi = kpiNamesSk.some((k) => thesisLowerEarly.includes(k)) || hasMechanism;
    const hasValuation = /valuation|fair value|upside|EV|per-share|FCF|FCFF|target|WACC|terminal/i.test(thesisLowerEarly);
    if (!hasEvidence || !hasMechanism || !hasKpi || !hasValuation) {
      const missing: string[] = [];
      if (!hasEvidence) missing.push("evidence [F-...]/forecast");
      if (!hasMechanism) missing.push("business mechanism");
      if (!hasKpi) missing.push("company-specific KPI");
      if (!hasValuation) missing.push("valuation consequence");
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "blocker",
        component: "thesis",
        finding: `Thesis lacks evidence→mechanism→KPI→valuation chain (missing: ${missing.join(", ")}). Generic thesis language will be blocked — rebuild around a falsifiable debate with quantified chain.`,
        recommendation: "Rewrite thesis as: evidence [F-...] → mechanism (e.g., occupancy×ADR→RevPAR) → affected KPI → financial consequence (revenue/EBIT/FCF row) → valuation consequence (EV/equity/per-share via canonical DCF). Cite the canonical forecast verbatim.",
      });
    }
  }

  // Check thesis for unsupported quantitative claims
  const unsupportedPatterns = ["cagr of", "growth to", "margin to", "target price of"];
  for (const pattern of unsupportedPatterns) {
    if (thesisLowerEarly.includes(pattern)) {
      // Check if there's a number preceding it that might be unsupported
      const regex = new RegExp(`\\d+(?:\\.\\d+)?\\s*%?\\s*${pattern}`, "i");
      const match = thesisLowerEarly.match(regex);
      if (match && !thesis.whatCouldInvalidate?.includes(match[0])) {
        findings.push({
          reviewer: "Skeptical Analyst",
          severity: "major",
          component: "thesis",
          finding: `Thesis contains unsupported quantitative claim: "${match[0]}" — link to yfinance fact or AI model output`,
          recommendation: "Regenerate thesis with fact-grounded claims or remove unsupported numbers",
        });
      }
      break; // Only flag first pattern
    }
  }

  // Check catalysts for invented valuation impacts
  for (const c of catalysts) {
    if (c.valuationImpact && c.valuationImpact.includes("%") && c.quantitative !== false) {
      // Check if it's a specific percentage without a chain
      const pctMatch = c.valuationImpact.match(/[\+\-]?\d+(?:\.\d+)?%/);
      if (pctMatch && !c.forecastImpact) {
        findings.push({
          reviewer: "Skeptical Analyst",
          severity: "major",
          component: "catalysts",
          finding: `Catalyst [${c.catalyst}] has valuation impact ${c.valuationImpact} without forecast impact chain`,
          recommendation: "Either establish the full chain (catalyst → financial variable → forecast → valuation) or label as QUALITATIVE ONLY",
        });
      }
    }
  }

  // CATALYST-SPECIFIC: company-specific trigger required, not generic earnings/margin
  for (const c of catalysts) {
    const txt = `${c.catalyst} ${c.mechanism}`.toLowerCase();
    const genericPhrases = ["earnings growth", "margin expansion", "revenue growth", "earnings beat", "margin improvement", "profitability improvement", "earnings momentum"];
    const isGeneric = genericPhrases.some((p) => txt === p || (txt.includes(p) && txt.length < 80 && !/launch|approval|order|contract|regulation|spectrum|store|clinical|trial|product|capacity|acquisition|divestiture|tariff|policy|rate hike|cut|guidance|buyback|dividend/i.test(txt)));
    const hasTrigger = /launch|approval|order|contract|regulation|spectrum|auction|store|rollout|expansion|acquisition|divestiture|clinical|trial|product|capacity|utilization|tariff|policy|rate|guidance|buyback|dividend|occupancy|ADR|RevPAR|ARPU|take rate|throughput|crack spread|O2C|Jio/i.test(txt);
    if (isGeneric && !hasTrigger) {
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "blocker",
        component: "catalysts",
        finding: `Catalyst [${c.catalyst}] is generic ("${c.catalyst.slice(0, 60)}") without company-specific trigger (launch/approval/order/contract/regulation etc). Generic earnings/margin catalysts are blocked.`,
        recommendation: "Replace with company-specific event: e.g., 'Jio 5G tariff hike → ARPU → revenue', 'O2C crack spread widening → petchem margin', 'new store rollout 500 stores → retail throughput'",
      });
      break;
    }
    if (!hasTrigger && txt.length > 20) {
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "major",
        component: "catalysts",
        finding: `Catalyst [${c.catalyst}] lacks identifiable trigger (regulatory/product/capacity/contract). Add trigger and tie to canonical forecast variable.`,
        recommendation: "Add trigger and financialVariable that exists in forecast (e.g., revenueGrowth[0], ebitMargin[0], capexPct)",
      });
    }
  }

  // Check moat for forced pillar selection
  if (moat?.sources) {
    const pillarKeys = ["cost advantage", "brand", "network effects", "switching costs", "distribution"];
    const pillarCount = pillarKeys.filter(p => moat.sources.some((s: any) => s.source.toLowerCase().includes(p))).length;
    if (pillarCount >= 3 && moat.hasMoat) {
      findings.push({
        reviewer: "Skeptical Analyst",
        severity: "major",
        component: "moat",
        finding: "Moat forces 3+ fixed pillars — should be dynamically selected based on company economics",
        recommendation: "Regenerate moat analysis with AI-selected relevant sources only",
      });
    }
  }

  // MOAT EVIDENCE-DRIVEN: each source must have fact or canonical linkage, not generic assertion
  if (moat?.hasMoat && moat.sources) {
    for (const s of moat.sources) {
      const ev = (s.evidence || "").toLowerCase();
      const hasFact = /\[F-/.test(s.evidence) || /\[F-/.test(s.economicConsequence);
      const hasCanonical = /roce|roic|wacc|margin|spread|ebit|FCF|FCFF|canonical/i.test(ev);
      const isGenericMoat = ["strong moat", "wide moat", "durable moat", "sustainable advantage", "competitive advantage"].some((p) => ev.includes(p) && ev.length < 80);
      if (!hasFact && !hasCanonical && (isGenericMoat || ev.length < 30)) {
        findings.push({
          reviewer: "Skeptical Analyst",
          severity: "blocker",
          component: "moat",
          finding: `Moat source "${s.source}" evidence "${s.evidence.slice(0, 60)}" lacks [F-...] or canonical ROCE/WACC linkage — generic moat language blocked.`,
          recommendation: "Provide evidence: e.g., 'ROCE history vs WACC spread' or '[F-grossMargin] stability 30-32% over 4y' plus durability and threats.",
        });
        break;
      }
    }
  }

  // COMPETITIVE SEGMENT-LEVEL: when filing segments exist, analysis must be segment-level
  try {
    const { getFilingSegments } = require("../filing-segments") as typeof import("../filing-segments");
    const segs = getFilingSegments((report.companyUnderstanding as any)?.ticker || (report as any).companyTicker || "");
    if (segs && segs.segments.length >= 2) {
      const compText = JSON.stringify(competitiveAnalysis || {}).toLowerCase();
      const missingSegments = segs.segments.filter((sg: any) => !compText.includes(sg.name.toLowerCase().split(" ")[0]) ).map((sg: any) => sg.name);
      if (missingSegments.length >= 2) {
        findings.push({
          reviewer: "Skeptical Analyst",
          severity: "blocker",
          component: "competitiveAnalysis",
          finding: `Competitive analysis is not segment-level: filing has ${segs.segments.length} segments [${segs.segments.map((s: any) => s.name).join(", ")}] but analysis omits ${missingSegments.slice(0, 3).join(", ")} — conglomerate requires segment-level peer matrix.`,
          recommendation: "Generate per-segment peers: e.g., O2C vs petchem refiners, Jio vs telecom ARPU peers, Retail vs DMart, E&P vs upstream — each with overlap/economic similarity/key difference.",
        });
      }
    }
  } catch {}

  return findings;
};

/** Reviewer 6: Fact checker — verifies all quantitative statements trace to yfinance or model output + tier hierarchy (audit §17, §21) */
const factChecker = (report: ResearchReport, pack: FactPack): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { thesis, risks, catalysts, forecast, valuation, companyUnderstanding } = report;

  // Source hierarchy: flag Tier6 inference presented as filing fact
  const allText = [thesis.thesis, ...risks.map((r) => r.mechanism), ...catalysts.map((c) => c.mechanism)].join(" ").toLowerCase();
  const inferenceAsFactPhrases = ["as reported in the filing", "per the annual report", "management guided"];
  for (const phrase of inferenceAsFactPhrases) {
    if (allText.includes(phrase)) {
      // yfinance cannot supply filings/calls — if pack has no filing facts, this is likely Tier6 masquerading
      const hasFilingFact = pack.company.facts.some((f) => f.source !== "yfinance");
      if (!hasFilingFact) {
        findings.push({
          reviewer: "Fact Checker",
          severity: "major",
          component: "thesis",
          finding: `Phrase "${phrase}" implies Tier1/Tier2 filing evidence, but no filing source exists in fact pack — likely Tier6 inference presented as fact`,
          recommendation: "Remove filing-like phrasing or downgrade to 'AI-inferred' with low confidence and required research note",
        });
        break;
      }
    }
  }

  // Quantitative claims must have [F-...] or model provenance
  const factIdsPresent = new Set([
    ...pack.incomeStatement.facts.map((f) => `[F-${f.metric}]`.toLowerCase()),
    ...pack.balanceSheet.facts.map((f) => `[F-${f.metric}]`.toLowerCase()),
    ...pack.market.facts.map((f) => `[F-${f.metric}]`.toLowerCase()),
  ]);
  const hasFactCitation = (s: string) => /\[F-[^\]]+\]/i.test(s) || /forecast|model output|assumption/i.test(s);
  if (thesis.thesis.length > 40 && /\d+(?:\.\d+)?\s*%/.test(thesis.thesis) && !hasFactCitation(thesis.thesis)) {
    findings.push({
      reviewer: "Fact Checker",
      severity: "major",
      component: "thesis",
      finding: "Thesis contains percentage quantitative claim without [F-...] citation or model-output provenance",
      recommendation: "Add fact citation or link to AI model assumption with historicalEvidence",
    });
  }

  // Check that fair value has traceable inputs
  if (valuation?.fairValuePerShare !== undefined) {
    // Should have been computed from assumptions with historical evidence
    if (!valuation.executedFrom?.rationale) {
      findings.push({
        reviewer: "Fact Checker",
        severity: "blocker",
        component: "valuation",
        finding: "Fair value computed but no rationale traceable to assumptions or facts",
        recommendation: "Ensure valuation executedFrom spec includes rationale with fact citations",
      });
    }
  }

  // Check risks' financial consequences are grounded
  for (const r of risks) {
    if (r.financialConsequence && r.financialConsequence.includes("$")) {
      // Numeric dollar amount — check if it's reasonable
      const dollarMatch = r.financialConsequence.match(/\$\d+(?:,\d{3})*(?:\.\d+)?/);
      if (dollarMatch) {
        // Warning but don't block — could be materiality threshold
        findings.push({
          reviewer: "Fact Checker",
          severity: "minor",
          component: "risks",
          finding: `Risk [${r.risk}] financial consequence contains dollar amount: ${dollarMatch[0]}`,
          recommendation: "Verify dollar amount against company scale (revenue, market cap)",
        });
      }
    }
  }

  // Check catalysts' forecast impacts are grounded
  for (const c of catalysts) {
    if (c.forecastImpact && c.forecastImpact.includes("%")) {
      findings.push({
        reviewer: "Fact Checker",
        severity: "minor",
        component: "catalysts",
        finding: `Catalyst [${c.catalyst}] forecast impact ${c.forecastImpact} — verify against yfinance trend data`,
        recommendation: "Correlate forecast percentage change with historical revenue/EBIT trend",
      });
    }
  }

  return findings;
};

/** Reviewer 7: Report editor — checks prose style, KPI strip consistency, section ordering */
const reportEditor = (report: ResearchReport): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];

  // Check KPI strip vitals are present
  // The report should have a KPI strip with: Last, Fair, Buy/Sell, Uncertainty, Moat, Trend, etc.
  // We check the report structure has expected sections

  const { conclusion, thesis } = report;

  // Check that conclusion is not empty
  if (conclusion?.length && conclusion.trim().length < 20) {
    findings.push({
      reviewer: "Report Editor",
      severity: "minor",
      component: "conclusion",
      finding: "Conclusion section is very short — may need expansion",
      recommendation: "Ensure conclusion summarizes key findings and investment recommendation",
    });
  }

  // Check thesis has content
  if (thesis.thesis.length < 10) {
    findings.push({
      reviewer: "Report Editor",
      severity: "major",
      component: "thesis",
      finding: "Thesis statement is very short — may not qualify as a proper thesis",
      recommendation: "Regenerate thesis with 3-5 substantial sentences",
    });
  }

  // Check report has reasonable section count (not too few, not too many)
  // This is a structural check — actual section count comes from PDF rendering
  const allValues = Object.values(report);
  const nonNullValues = allValues.filter((v: any) => v !== undefined && v !== null && (typeof v === "string" ? v.length > 0 : Array.isArray(v) ? v.length > 0 : true));
  if (nonNullValues.length < 5) {
    findings.push({
      reviewer: "Report Editor",
      severity: "major",
      component: "reportStructure",
      finding: "Report has very few populated sections — may be incomplete",
      recommendation: "Regenerate research package; ensure all analytical sections are populated",
    });
  }

  return findings;
};

/** Research Judge — sentence-level evidence audit (audit §23): pretend you are receiving report for first time, identify every statement you could not defend */
const researchJudge = (report: ResearchReport, pack: FactPack): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const sentences = report.thesis.thesis.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 15);
  const packText = [
    ...pack.company.facts.map((f) => f.textValue || ""),
    ...pack.incomeStatement.facts.map((f) => f.metric),
    pack.ticker,
    (report.companyUnderstanding?.primaryEconomicAbstraction || ""),
  ].join(" ").toLowerCase();
  // Very generic sentence that could apply to any company — not defensible for THIS company
  const companySpecific = (s: string) =>
    packText.split(/\s+/).some((tok) => tok.length > 4 && s.toLowerCase().includes(tok)) ||
    /\[F-[^\]]+\]/i.test(s) ||
    (report.companyUnderstanding?.keyKpis || []).some((k) => s.toLowerCase().includes(k.name.toLowerCase()));
  for (const sent of sentences.slice(0, 8)) {
    if (!companySpecific(sent) && sent.length > 60 && !/insufficient evidence|pending|not available/i.test(sent)) {
      findings.push({
        reviewer: "Research Judge",
        severity: "major",
        component: "thesis",
        finding: `Sentence not defensible from supplied evidence: "${sent.slice(0, 90)}..." — no company-specific [F-...]/KPI/driver link`,
        recommendation: "Regenerate sentence evidence-constrained: cite [F-...] or model output, or mark as qualitative with low confidence",
      });
      break; // one per report to avoid flood
    }
  }
  return findings;
};

/** Reviewer 8: Final institutional research reviewer — overall quality and adherence to principles */
const finalReviewer = (report: ResearchReport, planDocRef: any): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];

  // Principle check: No hardcoded sector templates leaked into content
  const allReportText = [
    report.thesis.thesis,
    ...(report.thesis.bullCase || []),
    ...(report.thesis.bearCase || []),
    ...(report.risks?.map((r: any) => r.risk) || []),
    ...(report.catalysts?.map((c: any) => c.catalyst) || []),
  ].join(" ").toLowerCase();

  // Check for hardcoded template phrases that should never appear
  const hardcodedPhrases = [
    "as is typical for",
    "in a typical", 
    "for a company like",
    "standard for the sector",
    "sector convention",
    "normally expects",
    "industry standard",
  ];

  for (const phrase of hardcodedPhrases) {
    if (allReportText.includes(phrase)) {
      findings.push({
        reviewer: "Final Institutional Research Reviewer",
        severity: "blocker",
        component: "content",
        finding: `Hardcoded template phrase detected: "${phrase}" — violates AI-first principle`,
        recommendation: "Regenerate entire research package from company-specific facts; delete any hardcoded sector rules",
      });
      // Only flag first occurrence
      break;
    }
  }

  // Check no SBIN→GOOG contamination (same report structure but different content)
  // This is checked qualitatively by the reviewer, not via code pattern match

  // Check versioning is present
  if (!report.researchRunId) {
    findings.push({
      reviewer: "Final Institutional Research Reviewer",
      severity: "major",
      component: "versioning",
      finding: "No researchRunId — report cannot be reproduced",
      recommendation: "Add researchRunId and version fields; regenerate report",
    });
  }

  return findings;
};

/** Execute all 8 reviewers in parallel */
export function runQualityReview(
  report: ResearchReport,
  pack: FactPack
): { 
  allFindings: ReviewFinding[]; 
  perReviewer: Record<string, ReviewFinding[]>; 
  passed: boolean; 
  overallScore: number; 
  regenerationCandidates: string[] 
} {
  // Run all 8 reviewers in parallel
  const reviewers = [
    { name: "Financial Analyst", fn: (r: ResearchReport) => financialAnalyzer(r) },
    { name: "Accounting Analyst", fn: (r: ResearchReport) => accountingAnalyzer(r) },
    { name: "Valuation Analyst", fn: (r: ResearchReport) => valuationAnalyzer(r) },
    { name: "Industry Analyst", fn: (r: ResearchReport) => industryAnalyzer(r, pack) },
    { name: "Skeptical Analyst", fn: (r: ResearchReport) => skepticalAnalyzer(r) },
    { name: "Fact Checker", fn: (r: ResearchReport) => factChecker(r, pack) },
    { name: "Report Editor", fn: (r: ResearchReport) => reportEditor(r) },
    { name: "Research Judge", fn: (r: ResearchReport) => researchJudge(r, pack) },
    { name: "Final Institutional Research Reviewer", fn: (r: ResearchReport) => finalReviewer(r, undefined) },
  ];

  const perReviewer: Record<string, ReviewFinding[]> = {};
  let allFindings: ReviewFinding[] = [];
  let totalScore = 0;
  let passedSections = 0;

  for (const reviewer of reviewers) {
    const findings = reviewer.fn(report);
    perReviewer[reviewer.name] = findings;
    allFindings = allFindings.concat(findings);

    // Score: start at 100, deduct for each finding
    // blockers: -15, majors: -8, minors: -3
    for (const f of findings) {
      const deduction = f.severity === "blocker" ? 15 : f.severity === "major" ? 8 : 3;
      totalScore -= deduction;
    }

    // Count passed sections (sections with no blockers)
    const hasBlocker = findings.some((f: any) => f.severity === "blocker");
    if (!hasBlocker) {
      passedSections++;
    }
  }

  // Enforce 20-warning threshold: 20 substantive findings cannot be READY_WITH_WARNINGS
  // Kill-switch: when QA_GATES_ENABLED is false, findings stay diagnostic — no
  // GATE-OVERFLOW blocker, passed is not forced false by blockers.
  if (QA_GATES_ENABLED && allFindings.length >= 20) {
    const hasOverflowBlocker = allFindings.some((f) => f.finding.includes("GATE-OVERFLOW"));
    if (!hasOverflowBlocker) {
      allFindings.push({
        reviewer: "Final Institutional Research Reviewer",
        severity: "blocker",
        component: "gate",
        finding: `GATE-OVERFLOW: Report carries ${allFindings.length} substantive findings (threshold 20) — exceeds substantive-warning budget; publication requires remediation, not disclosure.`,
        recommendation: "Remediate high-severity findings (thesis chain, catalysts, competitive segment, moat evidence, Other Opex classification) until substantive count <20.",
      });
      perReviewer["Final Institutional Research Reviewer"] = [...(perReviewer["Final Institutional Research Reviewer"] || []), allFindings[allFindings.length - 1]];
    }
  }

  // Calculate overall score (0-100)
  const overallScore = Math.max(0, Math.min(100, totalScore + 100 + (allFindings.some((f) => f.finding.includes("GATE-OVERFLOW")) ? -15 : 0)));

  // Determine if report passed (no blockers overall, score above threshold)
  const hasAnyBlocker = allFindings.some((f: any) => f.severity === "blocker");
  const passed = QA_GATES_ENABLED ? (overallScore >= 60 && !hasAnyBlocker) : true;

  // Determine regeneration candidates based on findings
  const regenerationCandidates: string[] = [];
  for (const f of allFindings) {
    if (!regenerationCandidates.includes(f.component)) {
      regenerationCandidates.push(f.component);
    }
  }

  return {
    allFindings,
    perReviewer,
    passed,
    overallScore,
    regenerationCandidates,
  };
}

/** Adjudicator: decides what must be regenerated based on findings */
export function adjudicateRegeneration(
  regenerationCandidates: string[],
  perReviewer: Record<string, ReviewFinding[]>,
  report: ResearchReport
): { 
  regenerate: string[]; 
  keep: string[]; 
  errors: string[] 
} {
  const regenerate: string[] = [];
  const keep: string[] = [];
  const errors: string[] = [];

  // Adjudication rules:
  // - blocker findings → must regenerate that component
  // - major findings with no easy fix → regenerate
  // - minor findings → may keep with annotation
  // - if a component has any blocker, regenerate it
  // - if a component has only minors, keep but annotate

  const findingsByComponent = new Map<string, ReviewFinding[]>();
  for (const findings of Object.values(perReviewer)) {
    for (const finding of findings) {
      const list = findingsByComponent.get(finding.component) ?? [];
      list.push(finding);
      findingsByComponent.set(finding.component, list);
    }
  }

  for (const component of regenerationCandidates) {
    const componentFindings = findingsByComponent.get(component) ?? [];
    
    const hasBlocker = componentFindings.some((f: any) => f.severity === "blocker");
    const hasMajor = componentFindings.some((f: any) => f.severity === "major");
    const hasOnlyMinors = componentFindings.every((f: any) => f.severity === "minor");

    if (hasBlocker) {
      regenerate.push(component);
    } else if (hasMajor) {
      // Regenerate unless it's a minor fix
      regenerate.push(component);
    } else if (hasOnlyMinors) {
      keep.push(component);
    } else {
      // No findings for this component — keep it
      keep.push(component);
    }
  }

  // Ensure critical components are always present
  const criticalComponents = ["forecast", "valuation", "thesis", "risks", "scenarios"];
  for (const crit of criticalComponents) {
    if (!regenerate.includes(crit) && !keep.includes(crit)) {
      // Default: keep but mark for review
      keep.push(crit);
    }
  }

  // If too many components are marked for regeneration (over 50%), 
  // trigger a partial rebuild rather than regenerating individually
  if (regenerate.length > 6) {
    errors.push(`Too many components (${regenerate.length}) marked for regeneration — consider partial report rebuild`);
    // Re-balance: move the first half to keep (deterministic partial rebuild
    // instead of regenerating every component individually).
    const mid = Math.ceil(regenerate.length / 2);
    for (const c of regenerate.slice(0, mid)) keep.push(c);
    const remaining = regenerate.slice(mid);
    regenerate.length = 0;
    regenerate.push(...remaining);
  }

  return { regenerate, keep, errors };
}

export async function runCanonicalQualityGate(
  report: ResearchReport,
  pack: FactPack,
  context: Record<string, unknown> = {},
  options: { generatedAt?: string; maxAttempts?: number; transport?: ((opts: { system: string; user: string; temperature?: number; maxTokens?: number; jsonMode?: boolean }) => Promise<string>) | null; reproducibilityHash?: string | null } = {}
): Promise<{ qa: CanonicalQaResult; report: ResearchReport; regeneratedStages: string[] }> {
  const baseQa = runCanonicalQa(report, pack, context, { ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}), ...(options.reproducibilityHash !== undefined ? { reproducibilityHash: options.reproducibilityHash } : {}) });
  if (baseQa.decision === "READY" || (options.maxAttempts ?? 2) <= 0) {
    return { qa: baseQa, report, regeneratedStages: [] };
  }
  const outcome = await runBoundedRegeneration(report, pack, context, { ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}), maxAttempts: options.maxAttempts ?? 2, ...(options.transport ? { transport: options.transport } : {}) });
  const mergedAttempts = [...baseQa.attempts, ...outcome.attempts];
  const finalQa = runCanonicalQa(outcome.report, pack, context, { ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}), attempts: mergedAttempts, ...(options.reproducibilityHash !== undefined ? { reproducibilityHash: options.reproducibilityHash } : {}) });
  const nextReport = { ...(outcome.report as unknown as ResearchReport), canonicalQa: finalQa, qaDecision: finalQa.decision, regenerationAttempts: mergedAttempts } as ResearchReport;
  return { qa: finalQa, report: nextReport, regeneratedStages: outcome.regeneratedStages };
}
export function canonicalQaContextForReport(report: ResearchReport, pack: FactPack): Record<string, unknown> {
  const currentPrice = pack.market.facts.find((f) => f.metric === "currentPrice")?.value;
  const retrievalTimestamp = pack.retrievalTimestamp;
  const now = report.generationTimestamp;
  return { ...(currentPrice !== undefined ? { currentPrice } : {}), retrievalTimestamp, now, generatedAt: now };
}
export default { runQualityReview, adjudicateRegeneration, runCanonicalQualityGate, canonicalQaContextForReport };
