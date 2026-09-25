import type { ReportData } from "@/types/report";
import { createResearchRunEnvelope } from "./run-envelope";
import { classifyThesisBreak, diffThesisFields, type ThesisSnapshot } from "./thesis";
import { createUnknownRegistry, registerUnknown, type UnknownRegistry } from "./unknowns";
import { createResearchEvent } from "./events";
import { issueCanonicalForecast, type ForecastIssuance } from "./forecast";
import type { ResearchEvent } from "./types";
import { stableHash } from "./stable";
import { buildExpectationsGap, buildOperatingModelProfile, buildRiskValueMap, buildThesisTree } from "@/lib/research-core";
import type { ResearchLedgerPayload, ResearchRunEnvelope } from "./types";
import { appendLongitudinalMemory, buildWhatChangedReport, deriveUpdateMode, snapshotForMemory, verifyLongitudinalMemoryEntry } from "@/lib/canonical-qa/memory";
import type { LongitudinalMemoryEntry, ResearchUpdateMode, WhatChangedReport } from "@/lib/canonical-qa/types";

export interface ResearchMemorySnapshot {
  version: "research-memory-v1";
  run: ResearchRunEnvelope<ResearchLedgerPayload>;
  thesis: ThesisSnapshot;
  thesisDiff: ReturnType<typeof diffThesisFields>;
  thesisBreak: ReturnType<typeof classifyThesisBreak>;
  forecastIssuances: readonly ForecastIssuance[];
  unknownRegistry: UnknownRegistry;
  eventHistory: readonly ResearchEvent[];
  thesisTree: ReturnType<typeof buildThesisTree>;
  expectationsGap: ReturnType<typeof buildExpectationsGap>;
  riskValueMap: ReturnType<typeof buildRiskValueMap>;
  operatingModel: ReturnType<typeof buildOperatingModelProfile>;
  updateMode?: ResearchUpdateMode;
  whatChanged?: WhatChangedReport | null;
  longitudinalEntry?: LongitudinalMemoryEntry | null;
  lineage?: string[];
  serverStatus?: string;
}

function thesisOf(report: ReportData): ThesisSnapshot {
  const thesis = report.researchReport?.thesis;
  if (thesis) return { ...thesis } as ThesisSnapshot;
  return {
    thesis: report.aiAnalysis?.investmentThesis ?? "",
    bullCase: [],
    bearCase: [],
    keyDebate: report.aiAnalysis?.summary ?? "",
    whatMarketMayBeMissing: "",
    whatCouldInvalidate: [],
  };
}

function companyOf(report: ReportData) {
  return {
    id: report.profile.ticker,
    ticker: report.profile.ticker,
    name: report.profile.name,
    exchange: report.profile.exchange,
  };
}

function forecastIssuances(report: ReportData, companyId: string, runId: string): ForecastIssuance[] {
  const forecast = report.canonicalForecast;
  if (!forecast || forecast.projections.length === 0) return [];
  const out: ForecastIssuance[] = [];
  const metrics = ["revenue", "ebit", "freeCashFlow", "eps"] as const;
  for (const metric of metrics) {
    for (const projection of forecast.projections) {
      if (!Number.isFinite(projection[metric])) continue;
      out.push(issueCanonicalForecast({
        companyId,
        runId,
        forecast,
        metric,
        period: projection.label || String(projection.year),
        issuedAt: report.generatedAt,
        unit: metric === "revenue" || metric === "ebit" || metric === "freeCashFlow" ? "money" : "per-share",
        currency: report.profile.currency,
      }));
    }
  }
  return out;
}

function unknownRegistryOf(report: ReportData, companyId: string): UnknownRegistry {
  let registry = createUnknownRegistry(companyId);
  for (const unknown of report.researchCase?.unknowns ?? []) {
    try {
      registry = registerUnknown(registry, {
        unknownId: unknown.id,
        companyId,
        statement: unknown.statement,
        source: unknown.source,
        evidenceNeeded: unknown.evidenceNeeded,
        registeredAt: report.researchCase?.createdAt ?? report.generatedAt,
      }).registry;
    } catch {
      continue;
    }
  }
  return registry;
}

function eventHistoryOf(report: ReportData, companyId: string, runId: string): ResearchEvent[] {
  const events: ResearchEvent[] = [];
  for (const movement of report.eventPriceMovements ?? []) {
    const occurredAt = Date.parse(movement.eventDate);
    if (!Number.isFinite(occurredAt)) continue;
    events.push(createResearchEvent({
      type: "market-event",
      company: companyId,
      runId,
      occurredAt: new Date(occurredAt).toISOString(),
      summary: movement.headline,
      tags: [movement.category, movement.measured ? "measured" : "illustrative"],
      metrics: {
        immediateReturnPct: movement.immediateReturnPct,
        multiDayReturnPct: movement.multiDayReturnPct,
        abnormalReturnPct: movement.abnormalReturnPct,
      },
      details: { eventId: movement.id, publisher: movement.publisher ?? null },
    }));
  }
  return events;
}

export function snapshotForLongitudinalMemory(report: ReportData): Record<string, unknown> {
  return snapshotForMemory({
    thesis: thesisOf(report),
    valuation: report.researchReport?.valuation ?? report.dcf ?? null,
    forecast: report.canonicalForecast ?? report.researchReport?.forecast ?? null,
    assumptions: report.assumptionsLedger ?? null,
    risks: report.researchReport?.risks ?? [],
    catalysts: (report.researchReport as unknown as { catalysts?: unknown })?.catalysts ?? [],
    guidance: report.researchReport?.guidanceReconciliation ?? null,
    unknowns: report.researchCase?.unknowns ?? [],
    evidence: report.evidenceRegistry ?? null,
  });
}
export function deriveMemoryUpdateMode(previous: ResearchMemorySnapshot | null | undefined, deepDive: boolean, eventIds: string[]): ResearchUpdateMode {
  return deriveUpdateMode({ previousRunId: previous?.run.runId ?? null, thesisBreak: previous ? classifyThesisBreak({ previous: previous.thesis, current: previous.thesis }) : null, eventIds, deepDive });
}
export function buildWhatChangedDeltas(previous: ResearchMemorySnapshot | null | undefined, current: ReportData, toRunId: string, mode: ResearchUpdateMode): WhatChangedReport {
  const previousSnapshot = previous ? snapshotForLongitudinalMemory({ generatedAt: previous.run.occurredAt, profile: { ticker: previous.run.company.ticker } } as unknown as ReportData) : null;
  void previousSnapshot;
  const currentSnapshot = snapshotForLongitudinalMemory(current);
  const priorSnapshot = previous?.longitudinalEntry?.snapshot ?? null;
  return buildWhatChangedReport({ previousSnapshot: priorSnapshot, currentSnapshot, fromRunId: previous?.run.runId ?? null, toRunId, mode, generatedAt: current.generatedAt });
}
export function verifyServerMemoryEntry(entry: unknown): boolean {
  return verifyLongitudinalMemoryEntry(entry);
}
export function buildResearchMemorySnapshot(
  report: ReportData,
  previous?: ResearchMemorySnapshot | null,
  options: { updateMode?: ResearchUpdateMode; deepDive?: boolean; eventIds?: string[] } = {},
): ResearchMemorySnapshot {
  const company = companyOf(report);
  const thesis = thesisOf(report);
  const occurredAt = report.generatedAt;
  const dataCutoff = report.researchCase?.dataCutoff ?? occurredAt;
  const run = createResearchRunEnvelope<ResearchLedgerPayload>({
    company,
    occurredAt,
    dataCutoff,
    pipelineVersion: "apex-report-pipeline-v1",
    modelVersion: report.researchReport?.modelVersion ?? report.researchCase?.modelVersion ?? "apex-financial-model-v1",
    promptVersion: report.researchReport?.promptVersion,
    payload: {
      thesis: report.researchReport?.thesis,
      canonicalForecast: report.canonicalForecast,
      values: {
        rating: report.assumptionsLedger?.rating ?? report.recommendation,
        targetPrice: report.assumptionsLedger?.targetPrice ?? report.targetPrice,
        fairValue: report.assumptionsLedger?.fairValue ?? report.dcf?.intrinsicValue ?? null,
        currentPrice: report.assumptionsLedger?.currentPrice ?? report.cmp,
      },
    },
    metadata: {
      researchGraphHash: report.researchGraph ? stableHash(report.researchGraph, "apex/research-graph/v1") : null,
      evidenceCount: report.evidenceRegistry?.items.length ?? 0,
      conflictCount: report.evidenceRegistry?.conflicts?.length ?? 0,
    },
  });
  const previousThesis = previous?.thesis ?? {};
  const thesisDiff = diffThesisFields(previousThesis, thesis, {
    fromRunId: previous?.run.runId,
    toRunId: run.runId,
  });
  const thesisBreak = classifyThesisBreak({
    previous: previousThesis,
    current: thesis,
    fromRunId: previous?.run.runId,
    toRunId: run.runId,
  });
  const eventIds = options.eventIds ?? eventHistoryOf(report, company.id, run.runId).map((e) => e.eventId);
  const updateMode = options.updateMode ?? deriveUpdateMode({ previousRunId: previous?.run.runId ?? null, thesisBreak, eventIds, deepDive: options.deepDive ?? false });
  const currentSnapshot = snapshotForLongitudinalMemory(report);
  const priorSnapshot = previous?.longitudinalEntry?.snapshot ?? null;
  const whatChanged = buildWhatChangedReport({ previousSnapshot: priorSnapshot, currentSnapshot, fromRunId: previous?.run.runId ?? null, toRunId: run.runId, mode: updateMode, generatedAt: occurredAt });
  const priorEntries = previous?.longitudinalEntry ? [previous.longitudinalEntry] : [];
  const longitudinal = appendLongitudinalMemory({ store: priorEntries, companyId: company.id, runId: run.runId, mode: updateMode, occurredAt, dataCutoff, snapshot: currentSnapshot, generatedAt: occurredAt });
  const serverStatus = longitudinal.entry.status;
  return {
    version: "research-memory-v1",
    run,
    thesis,
    thesisDiff,
    thesisBreak,
    forecastIssuances: forecastIssuances(report, company.id, run.runId),
    unknownRegistry: unknownRegistryOf(report, company.id),
    eventHistory: eventHistoryOf(report, company.id, run.runId),
    thesisTree: buildThesisTree(report.researchReport?.thesis, report.evidenceRegistry),
    expectationsGap: buildExpectationsGap({ reverseValuation: report.researchReport?.reverseValuation, baselineReconciliation: report.baselineReconciliation }),
    riskValueMap: buildRiskValueMap({ risks: report.researchReport?.risks ?? [], scenarios: report.researchReport?.scenarios ?? [], currentPrice: report.cmp }),
    operatingModel: buildOperatingModelProfile({ understanding: report.researchReport?.companyUnderstanding, engine: report.researchReport?.economicEngine }),
    updateMode,
    whatChanged,
    longitudinalEntry: longitudinal.entry,
    lineage: longitudinal.entry.lineage,
    serverStatus,
  };
}

export function loadResearchMemory(storageKey: string): ResearchMemorySnapshot | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResearchMemorySnapshot;
    return parsed?.version === "research-memory-v1" && parsed.run?.version === "research-run-v1" ? parsed : null;
  } catch {
    return null;
  }
}

export function storeResearchMemory(storageKey: string, snapshot: ResearchMemorySnapshot): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    return;
  }
}
