"use client";

import { useCallback, useState } from "react";
import type { ReportData } from "@/types/report";
import type { ReportTypeId, ResearchDepth } from "@/lib/report-types";
import {
  RESEARCH_RUN_MANIFEST_VERSION,
  parseResearchRunManifest,
  type ResearchRunManifestV1,
  type ResearchRunStatus,
} from "./manifest";

export interface ResearchRunPersistenceOptions {
  readonly reportType: ReportTypeId;
  readonly depth: ResearchDepth;
  readonly status?: ResearchRunStatus;
  readonly sourceRunIds?: readonly string[];
}

export type ResearchRunPersistenceResult =
  | {
      readonly state: "saved";
      readonly runId: string;
      readonly disposition: "created" | "duplicate";
    }
  | {
      readonly state: "local-only";
      readonly reason: "durable-store-unavailable" | "network-unavailable" | "rejected" | "payload-too-large" | "incomplete-run";
      readonly message: string;
    };

export type ResearchRunPersistenceStatus = ResearchRunPersistenceResult | { readonly state: "idle" } | { readonly state: "saving" };

interface PersistApiResponse {
  readonly run?: { readonly runId?: unknown };
  readonly disposition?: unknown;
  readonly duplicate?: unknown;
}

function graphHashOf(report: ReportData): string | null {
  const value = report.researchMemory?.run.metadata.researchGraphHash;
  return typeof value === "string" ? value : null;
}

export function buildFinalizedResearchRunManifest(
  report: ReportData,
  options: ResearchRunPersistenceOptions,
): ResearchRunManifestV1 {
  const projections = report.canonicalForecast?.projections ?? [];
  const caseId = report.researchCase?.caseId;
  const occurredAt = report.generatedAt;
  const idempotencyKey = [
    "finalized",
    report.profile.ticker,
    options.reportType,
    options.depth,
    occurredAt,
  ].join(":");
  return parseResearchRunManifest({
    version: RESEARCH_RUN_MANIFEST_VERSION,
    company: {
      id: report.profile.ticker,
      ticker: report.profile.ticker,
      name: report.profile.name || null,
      exchange: report.profile.exchange || null,
    },
    occurredAt,
    dataCutoff: report.researchCase?.dataCutoff ?? occurredAt,
    schemaVersion: RESEARCH_RUN_MANIFEST_VERSION,
    pipelineVersion: "apex-report-pipeline-v1",
    modelVersion: report.researchReport?.modelVersion ?? report.researchCase?.modelVersion ?? "apex-financial-model-v1",
    promptVersion: report.researchReport?.promptVersion ?? "apex-no-prompt-v1",
    caseId,
    report: {
      type: options.reportType,
      depth: options.depth,
    },
    status: options.status ?? "complete",
    reportArtifact: report.reportArtifact ?? null,
    summary: {
      thesis: {
        statement: report.researchReport?.thesis.thesis ?? report.aiAnalysis.investmentThesis ?? "",
        keyDebate: report.researchReport?.thesis.keyDebate ?? null,
        invalidation: report.researchReport?.thesis.whatCouldInvalidate ?? [],
      },
      forecast: {
        projectionCount: projections.length,
        rows: projections.slice(0, 12).map((projection) => ({
          period: projection.label || String(projection.year),
          revenue: projection.revenue,
          ebit: projection.ebit,
          freeCashFlow: projection.freeCashFlow,
          eps: projection.eps,
        })),
      },
    },
    evidence: {
      evidenceCount: report.evidenceRegistry?.items.length ?? 0,
      conflictCount: report.evidenceRegistry?.conflicts?.length ?? 0,
      graphNodeCount: report.researchGraph?.nodes.length ?? 0,
      graphEdgeCount: report.researchGraph?.edges.length ?? 0,
      graphHash: graphHashOf(report),
    },
    sourceRunIds: options.sourceRunIds ?? (report.researchReport?.researchRunId ? [report.researchReport.researchRunId] : []),
    idempotencyKey,
  });
}

async function parsePersistResponse(response: Response): Promise<PersistApiResponse | null> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 65_536) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as PersistApiResponse
      : null;
  } catch {
    return null;
  }
}

export async function persistFinalizedResearchRun(
  report: ReportData,
  options: ResearchRunPersistenceOptions,
): Promise<ResearchRunPersistenceResult> {
  let manifest: ResearchRunManifestV1;
  try {
    manifest = buildFinalizedResearchRunManifest(report, options);
  } catch {
    return {
      state: "local-only",
      reason: "incomplete-run",
      message: "Finalized run is incomplete and remains local-only.",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("/api/research-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    return {
      state: "local-only",
      reason: "network-unavailable",
      message: "Durable research run storage was unreachable; this run remains local-only.",
    };
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 503) {
    return {
      state: "local-only",
      reason: "durable-store-unavailable",
      message: "Durable research run storage is unavailable; this run remains local-only.",
    };
  }
  if (response.status === 413) {
    return {
      state: "local-only",
      reason: "payload-too-large",
      message: "The bounded run manifest exceeded durable storage limits; this run remains local-only.",
    };
  }
  if (response.status === 409 || response.status === 422) {
    return {
      state: "local-only",
      reason: "rejected",
      message: "Durable storage rejected the finalized run; this run remains local-only.",
    };
  }
  if (response.status !== 200 && response.status !== 201) {
    return {
      state: "local-only",
      reason: "network-unavailable",
      message: "Durable research run persistence failed; this run remains local-only.",
    };
  }
  let body: PersistApiResponse | null;
  try {
    body = await parsePersistResponse(response);
  } catch {
    return {
      state: "local-only",
      reason: "network-unavailable",
      message: "Durable storage returned an unreadable response; this run remains local-only.",
    };
  }
  const runId = body?.run?.runId;
  const disposition = body?.disposition;
  if (
    typeof runId !== "string"
    || !/^RUN-[A-F0-9]{64}$/.test(runId)
    || (disposition !== "created" && disposition !== "duplicate")
  ) {
    return {
      state: "local-only",
      reason: "network-unavailable",
      message: "Durable storage returned an invalid response; this run remains local-only.",
    };
  }
  return { state: "saved", runId, disposition };
}

export function useResearchRunPersistence() {
  const [status, setStatus] = useState<ResearchRunPersistenceStatus>({ state: "idle" });
  const persist = useCallback(async (
    report: ReportData,
    options: ResearchRunPersistenceOptions,
  ): Promise<ResearchRunPersistenceResult> => {
    setStatus({ state: "saving" });
    const result = await persistFinalizedResearchRun(report, options);
    setStatus(result);
    return result;
  }, []);
  return { status, persist } as const;
}
