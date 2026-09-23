/**
 * Research module implementations (Phase 3).
 * Each module is a thin, deterministic slice over ResearchCase + pipeline
 * context. Provided objects are referenced; nothing is recomputed here.
 */
import type { ResearchModule, ModuleContext } from "./types";
import type {
  BusinessModuleData,
  StatementsModuleData,
  ValuationModuleData,
  PeersModuleData,
  MoatModuleData,
  RiskCatalystModuleData,
  ManagementModuleData,
  QualityModuleData,
  ThesisModuleData,
} from "./types";
import { resolveValuationAnchors, resolveMoatAnchors } from "./anchors";

function pushSource(sources: string[], name: string, present: boolean): void {
  if (present) sources.push(name);
}

function pushUnknown(unknowns: string[], message: string): void {
  unknowns.push(message);
}

// ── business ───────────────────────────────────────────────────────────

export const businessModule: ResearchModule<BusinessModuleData> = {
  id: "business",
  title: "Business & Architecture",
  feeds: ["cover", "business-overview", "industry"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.company", "researchCase.architecture", "researchCase.ontology"];
    if (c.industry.revenueDrivers.length === 0 && c.industry.costDrivers.length === 0) {
      pushUnknown(unknowns, "Industry revenue/cost drivers not populated (research report absent or empty).");
    }
    return {
      data: {
        company: c.company,
        architecture: c.architecture,
        ontology: c.ontology,
        industry: c.industry,
      },
      available: Boolean(c.company?.ticker),
      unknowns,
      sources,
    };
  },
};

// ── statements ─────────────────────────────────────────────────────────

export const statementsModule: ResearchModule<StatementsModuleData> = {
  id: "statements",
  title: "Multi-Year Statements & Ratios",
  feeds: ["income-statement", "balance-sheet", "cash-flow"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.historicalFinancials", "researchCase.quarterlyFinancials"];
    pushSource(sources, "context.ratiosByYear", Array.isArray(ctx.ratiosByYear));
    pushSource(sources, "context.dupontByYear", Array.isArray(ctx.dupontByYear));
    pushSource(sources, "researchCase.canonicalFacts", Boolean(c.canonicalFacts));

    if (c.historicalFinancials.length === 0) {
      pushUnknown(unknowns, "No annual financial history on ResearchCase.");
    }
    if (!Array.isArray(ctx.ratiosByYear)) {
      pushUnknown(unknowns, "ratiosByYear not provided on ModuleContext (not recomputed by module).");
    }
    if (!Array.isArray(ctx.dupontByYear)) {
      pushUnknown(unknowns, "dupontByYear not provided on ModuleContext (not recomputed by module).");
    }
    if (!c.canonicalFacts) {
      pushUnknown(unknowns, "Canonical fact graph unavailable.");
    }

    return {
      data: {
        annual: c.historicalFinancials,
        quarterly: c.quarterlyFinancials,
        ratiosByYear: Array.isArray(ctx.ratiosByYear) ? ctx.ratiosByYear : null,
        dupontByYear: Array.isArray(ctx.dupontByYear) ? ctx.dupontByYear : null,
        canonicalFacts: c.canonicalFacts,
      },
      available: c.historicalFinancials.length > 0,
      unknowns,
      sources,
    };
  },
};

// ── valuation ──────────────────────────────────────────────────────────

export const valuationModule: ResearchModule<ValuationModuleData> = {
  id: "valuation",
  title: "Valuation, Scenarios & Recommendation",
  feeds: ["valuation", "scenarios", "methodology"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = [];
    pushSource(sources, "researchCase.assumptionsLedger", Boolean(c.assumptionsLedger));
    pushSource(sources, "researchCase.valuation", Boolean(c.valuation));
    pushSource(sources, "researchCase.scenarios", Boolean(c.scenarios));
    pushSource(sources, "context.masterReportFacts", Boolean(ctx.masterReportFacts));
    pushSource(sources, "context.valuationAudit", Boolean(ctx.valuationAudit));
    pushSource(sources, "context.calibration", Boolean(ctx.calibration));

    const anchors = resolveValuationAnchors(c, ctx.masterReportFacts);
    if (anchors.anchorsFrom === "none") {
      pushUnknown(unknowns, "No valuation anchors available (ledger, masterReportFacts, and dcf all absent).");
    }
    if (!c.scenarios) pushUnknown(unknowns, "Scenario set unavailable.");
    if (!c.valuation) pushUnknown(unknowns, "DCF/valuation result unavailable.");

    return {
      data: {
        dcf: c.valuation,
        ledger: c.assumptionsLedger,
        scenarios: c.scenarios,
        rating: anchors.rating,
        targetPrice: anchors.targetPrice,
        currentPrice: anchors.currentPrice,
        fairValue: anchors.fairValue,
        upsideDownsidePct: anchors.upsideDownsidePct,
        selectedModel: ctx.selectedModel ?? null,
        valuationLens: ctx.valuationLens ?? null,
        calibration: ctx.calibration ?? c.assumptionsLedger?.calibration ?? null,
        valuationAudit: ctx.valuationAudit ?? null,
        baselineReconciliation: ctx.baselineReconciliation ?? null,
        supervision: ctx.supervision ?? null,
        anchorsFrom: anchors.anchorsFrom,
      },
      available: anchors.anchorsFrom !== "none" || Boolean(c.valuation),
      unknowns,
      sources,
    };
  },
};

// ── peers ──────────────────────────────────────────────────────────────

export const peersModule: ResearchModule<PeersModuleData> = {
  id: "peers",
  title: "Comparable Company Analysis",
  feeds: ["comps"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.peers"];
    pushSource(sources, "context.masterReportFacts.peers", Boolean(ctx.masterReportFacts?.peers));

    if (!c.peers.available) {
      pushUnknown(unknowns, c.peers.gate.reason || "Peer set unavailable (similarity gate or fetch failure).");
    } else if (c.peers.peers.length === 0) {
      pushUnknown(unknowns, "Peer set empty after gate.");
    }

    return {
      data: {
        peerSet: c.peers,
        peerFacts: ctx.masterReportFacts?.peers ?? null,
      },
      available: c.peers.available && c.peers.peers.length > 0,
      unknowns,
      sources,
    };
  },
};

// ── moat ───────────────────────────────────────────────────────────────

export const moatModule: ResearchModule<MoatModuleData> = {
  id: "moat",
  title: "Competitive Moat & Unit Economics",
  feeds: ["moat", "moat-sources"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.competition"];
    const anchors = resolveMoatAnchors(c, ctx.masterReportFacts);
    pushSource(sources, `anchors:${anchors.sourcesFrom}`, anchors.sourcesFrom !== "none");
    pushSource(sources, "context.masterReportFacts.moat", Boolean(ctx.masterReportFacts?.moat));

    if (anchors.sourcesFrom === "none") {
      pushUnknown(unknowns, "Moat rating unavailable from ledger or masterReportFacts.");
    }
    if (!c.competition.available) {
      pushUnknown(unknowns, "Competition research unavailable (AI research report absent).");
    }

    return {
      data: {
        rating: anchors.rating,
        trend: anchors.trend,
        bridge: anchors.bridge,
        moatFacts: ctx.masterReportFacts?.moat ?? null,
        competition: c.competition,
        sourcesFrom: anchors.sourcesFrom,
      },
      available: anchors.sourcesFrom !== "none" || c.competition.available,
      unknowns,
      sources,
    };
  },
};

// ── risk-catalyst ──────────────────────────────────────────────────────

export const riskCatalystModule: ResearchModule<RiskCatalystModuleData> = {
  id: "risk-catalyst",
  title: "Risks, Catalysts & Market Reaction",
  feeds: ["bulls-bears", "risks", "catalysts", "events"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.risks", "researchCase.catalysts"];
    pushSource(sources, "context.eventPriceMovements", Array.isArray(ctx.eventPriceMovements));
    pushSource(sources, "context.masterReportFacts.risks", Boolean(ctx.masterReportFacts?.risks));

    const events = Array.isArray(ctx.eventPriceMovements) ? ctx.eventPriceMovements : [];
    const primaryRisks = ctx.masterReportFacts?.risks?.primaryRisks
      ? [...ctx.masterReportFacts.risks.primaryRisks]
      : [];

    if (!c.risks.available && c.risks.risks.length === 0) {
      pushUnknown(unknowns, "Narrative risks unavailable (AI research report absent).");
    }
    if (!c.catalysts.available && c.catalysts.catalysts.length === 0) {
      pushUnknown(unknowns, "Narrative catalysts unavailable (AI research report absent).");
    }
    if (events.length === 0) {
      pushUnknown(unknowns, "Event price movements not provided.");
    }

    return {
      data: {
        risks: c.risks,
        catalysts: c.catalysts,
        eventPriceMovements: events,
        uncertainty: ctx.masterReportFacts?.risks?.uncertainty ?? null,
        primaryRisks,
      },
      available:
        c.risks.available ||
        c.catalysts.available ||
        events.length > 0 ||
        primaryRisks.length > 0,
      unknowns,
      sources,
    };
  },
};

// ── management ─────────────────────────────────────────────────────────

export const managementModule: ResearchModule<ManagementModuleData> = {
  id: "management",
  title: "Management & Governance",
  feeds: ["management", "ownership"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.management", "researchCase.company.officers"];
    pushSource(sources, "context.shareholding", Boolean(ctx.shareholding));

    if (!c.management.available) {
      pushUnknown(unknowns, "Management narrative research unavailable (AI research report absent).");
    }
    if (!ctx.shareholding) {
      pushUnknown(unknowns, "Shareholding breakdown not provided.");
    }

    return {
      data: {
        management: c.management,
        officers: c.management.officers?.length
          ? c.management.officers
          : c.company?.officers ?? [],
        shareholding: ctx.shareholding ?? null,
      },
      available: (c.management.officers?.length ?? 0) > 0 || Boolean(ctx.shareholding),
      unknowns,
      sources,
    };
  },
};

// ── quality ────────────────────────────────────────────────────────────

export const qualityModule: ResearchModule<QualityModuleData> = {
  id: "quality",
  title: "Evidence, Data Confidence & QA",
  feeds: ["evidence-map", "qa-checksum", "disclosures"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const sources: string[] = ["researchCase.dataQuality", "researchCase.evidence"];
    pushSource(sources, "context.dataConfidence", Boolean(ctx.dataConfidence ?? c.dataQuality.confidence));
    pushSource(sources, "context.masterReportFacts.quality", Boolean(ctx.masterReportFacts?.quality));
    pushSource(sources, "context.qaReport", Boolean(ctx.qaReport));

    if (c.dataQuality.blockers.length > 0) {
      pushUnknown(unknowns, `Data-quality blockers: ${c.dataQuality.blockers.join(", ")}`);
    }
    if (!c.evidence) pushUnknown(unknowns, "Evidence registry unavailable.");
    if (!ctx.qaReport) pushUnknown(unknowns, "QA report not provided on ModuleContext.");

    return {
      data: {
        dataQuality: c.dataQuality,
        evidence: c.evidence,
        dataConfidence: ctx.dataConfidence ?? c.dataQuality.confidence,
        quality: ctx.masterReportFacts?.quality ?? null,
        qaReport: ctx.qaReport ?? null,
      },
      available: Boolean(c.evidence) || Boolean(ctx.masterReportFacts?.quality),
      unknowns,
      sources,
    };
  },
};

// ── thesis ─────────────────────────────────────────────────────────────

export const thesisModule: ResearchModule<ThesisModuleData> = {
  id: "thesis",
  title: "Executive Summary & Thesis",
  feeds: ["executive-summary"],
  run(ctx: ModuleContext) {
    const c = ctx.researchCase;
    const unknowns: string[] = [];
    const anchors = resolveValuationAnchors(c, ctx.masterReportFacts);
    const sources: string[] = [`anchors:${anchors.anchorsFrom}`, "researchCase.complexity", "researchCase.unknowns"];
    pushSource(sources, "context.aiAnalysis", Boolean(ctx.aiAnalysis));
    pushSource(sources, "context.researchReport", Boolean(ctx.researchReport ?? c.confidence));

    if (anchors.rating == null) {
      pushUnknown(unknowns, "Rating unavailable — executive summary cannot assert a stance.");
    }
    // Prefer ResearchReport thesis prose, then PE-style AI fields — never invent.
    const narrative: string | null =
      (ctx.researchReport?.thesis?.thesis as string | undefined) ||
      ctx.aiAnalysis?.investmentThesis ||
      ctx.aiAnalysis?.investmentConclusion ||
      null;
    if (!narrative) {
      pushUnknown(unknowns, "Thesis narrative not available (AI research absent) — left null.");
    }

    return {
      data: {
        rating: anchors.rating,
        targetPrice: anchors.targetPrice,
        currentPrice: anchors.currentPrice,
        fairValue: anchors.fairValue,
        upsideDownsidePct: anchors.upsideDownsidePct,
        complexity: c.complexity,
        researchQuestions: c.researchQuestions,
        unknowns: c.unknowns,
        confidence: c.confidence,
        narrative,
      },
      available: anchors.rating != null || Boolean(narrative),
      unknowns,
      sources,
    };
  },
};
