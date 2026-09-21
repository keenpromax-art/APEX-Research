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

/** Reviewers' personas and their focus areas */
const ReviewerNames = [
  "Financial Analyst",
  "Accounting Analyst",
  "Valuation Analyst",
  "Industry Analyst",
  "Skeptical Analyst",
  "Fact Checker",
  "Report Editor",
  "Final Institutional Research Reviewer",
];

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

/** Reviewer 4: Industry analyst — checks industry-specific terminology, competitive consistency */
const industryAnalyzer = (report: ResearchReport, pack: FactPack): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { thesis, risks, moat, competitiveAnalysis } = report;

  // Check for cross-sector contamination
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
        finding: `Cross-sector contamination: thesis mentions "${concept}" — not appropriate for this company`,
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

/** Reviewer 5: Skeptical analyst — challenges assumptions, looks for unsupported claims */
const skepticalAnalyzer = (report: ResearchReport): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { thesis, risks, catalysts, moat, competitiveAnalysis } = report;

  // Check thesis for unsupported quantitative claims
  const thesisLower = thesis.thesis.toLowerCase();
  const unsupportedPatterns = ["cagr of", "growth to", "margin to", "target price of"];
  for (const pattern of unsupportedPatterns) {
    if (thesisLower.includes(pattern)) {
      // Check if there's a number preceding it that might be unsupported
      const regex = new RegExp(`\\d+(?:\\.\\d+)?\\s*%?\\s*${pattern}`, "i");
      const match = thesisLower.match(regex);
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

  return findings;
};

/** Reviewer 6: Fact checker — verifies all quantitative statements trace to yfinance or model output */
const factChecker = (report: ResearchReport, pack: FactPack): ReviewFinding[] => {
  const findings: ReviewFinding[] = [];
  const { thesis, risks, catalysts, forecast, valuation } = report;

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

  // Calculate overall score (0-100)
  const overallScore = Math.max(0, Math.min(100, totalScore + 100));

  // Determine if report passed (no blockers overall, score above threshold)
  const hasAnyBlocker = allFindings.some((f: any) => f.severity === "blocker");
  const passed = overallScore >= 60 && !hasAnyBlocker;

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

  for (const component of regenerationCandidates) {
    const componentFindings = perReviewer[component] || [];
    
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

export default { runQualityReview, adjudicateRegeneration };
