"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ProgressTracker from "@/components/ProgressTracker";
import ApiKeyModal, { loadSavedAiConfig, loadServerModelOverride } from "@/components/ApiKeyModal";
import { SUPPORTED_PROVIDERS, type CustomKeyConfig } from "@/lib/ai-providers";
import { adaptCanonicalResearchPackage } from "@/lib/research-package/adapter";
import { exportGateForReport } from "@/lib/research-runs/client";
import type { CanonicalResearchPackage, ResearchRunEvent } from "@/lib/research-package/types";
import { getReportBlueprint, selectableReportTypes, type ReportTypeId, type ResearchDepth } from "@/lib/report-types";
import PDFDownloadButton from "./PDFDownloadButton";
import WatchlistButton from "@/components/WatchlistButton";
import type { AgentCheckpoint, GenerationState, ReportData } from "@/types/report";
import styles from "./report.module.css";
interface Props {
  ticker: string;
  initialReportType?: ReportTypeId;
  initialDepth?: ResearchDepth;
}
type ViewTab = "overview" | "forecast" | "valuation" | "quality" | "plan" | "identity" | "charts" | "audit" | "runs";
const CHECKPOINTS: AgentCheckpoint[] = [
  { id: "source", name: "Canonical source context", role: "Quote, timeseries, currency and share basis", status: "pending" },
  { id: "understanding", name: "Company understanding", role: "Economic architecture and research questions", status: "pending" },
  { id: "model", name: "Model specification", role: "Validated forecast model", status: "pending" },
  { id: "forecast", name: "Executed forecast", role: "Deterministic statement execution", status: "pending" },
  { id: "valuation", name: "Valuation matrix", role: "Canonical method execution", status: "pending" },
  { id: "scenarios", name: "Scenarios and uncertainty", role: "Bear, base, bull, sensitivity and Monte Carlo", status: "pending" },
  { id: "review", name: "Quality and publication gate", role: "Canonical integrity and evidence review", status: "pending" },
];
function cloneCheckpoints(): AgentCheckpoint[] {
  return CHECKPOINTS.map((checkpoint) => ({ ...checkpoint }));
}
function stageIndex(stage: string | undefined): number {
  const value = (stage ?? "").toLowerCase();
  if (value.includes("source") || value.includes("fact")) return 0;
  if (value.includes("understand")) return 1;
  if (value.includes("model")) return 2;
  if (value.includes("forecast")) return 3;
  if (value.includes("valuation")) return 4;
  if (value.includes("scenario") || value.includes("sensitivity") || value.includes("monte") || value.includes("reverse")) return 5;
  if (value.includes("review") || value.includes("quality") || value.includes("done")) return 6;
  return 0;
}
function displayNumber(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "Unavailable";
}
function displayState(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "Unavailable";
}
function eventFromChunk(value: string): ResearchRunEvent | null {
  const dataLine = value.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) return null;
  try {
    const parsed = JSON.parse(dataLine.slice(5).trim()) as ResearchRunEvent;
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}
function readExtra(report: ReportData | null, key: string): unknown {
  if (!report) return null;
  return (report as unknown as Record<string, unknown>)[key] ?? null;
}
export default function ReportClient({ ticker, initialReportType = "institutional_equity_v1", initialDepth = "concise" }: Props) {
  const router = useRouter();
  const [reportTypeId, setReportTypeId] = useState<ReportTypeId>(initialReportType);
  const [depth, setDepth] = useState<ResearchDepth>(initialDepth);
  const [state, setState] = useState<GenerationState>({
    step: "idle",
    progress: 0,
    message: "Initialising canonical research…",
    agentCheckpoints: cloneCheckpoints(),
  });
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [canonicalPackage, setCanonicalPackage] = useState<CanonicalResearchPackage | null>(null);
  const [customKeyConfig, setCustomKeyConfig] = useState<CustomKeyConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<{ provider?: string; message?: string; kind?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>("overview");
  const configRef = useRef<CustomKeyConfig | null>(null);
  const resumeRef = useRef<Record<string, unknown> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const saved = loadSavedAiConfig();
    configRef.current = saved;
    setCustomKeyConfig(saved);
    setConfigReady(true);
    try {
      const raw = localStorage.getItem(`apex_canonical_resume_${ticker}`);
      if (raw) {
        resumeRef.current = JSON.parse(raw) as Record<string, unknown>;
        setIsPaused(true);
      }
    } catch {
      resumeRef.current = null;
    }
  }, [ticker]);
  const applyPackage = useCallback((value: CanonicalResearchPackage) => {
    const adapted = adaptCanonicalResearchPackage(value, { reportTypeId, depth });
    setCanonicalPackage(value);
    setReportData(adapted);
    setState({
      step: "done",
      progress: 100,
      message: value.quality.canPublish ? "Canonical package ready for publication." : "Diagnostic preview ready; publication is blocked.",
      agentCheckpoints: cloneCheckpoints().map((checkpoint) => ({ ...checkpoint, status: "complete" })),
    });
    setIsPaused(false);
    resumeRef.current = null;
    try {
      localStorage.removeItem(`apex_canonical_resume_${ticker}`);
    } catch {
      return;
    }
  }, [depth, reportTypeId, ticker]);
  const updateEvent = useCallback((event: ResearchRunEvent, checkpoints: AgentCheckpoint[]): AgentCheckpoint[] => {
    const index = stageIndex(event.stage);
    let next = checkpoints.map((checkpoint, checkpointIndex) => {
      if (checkpointIndex < index) return { ...checkpoint, status: "complete" as const };
      if (checkpointIndex === index && (event.type === "stage_started" || event.type === "checkpoint")) return { ...checkpoint, status: "running" as const };
      if (checkpointIndex === index && event.type === "stage_completed") return { ...checkpoint, status: "complete" as const };
      return checkpoint;
    });
    if (event.type === "run_started") {
      setState((current) => ({ ...current, step: "fetching_data", progress: 8, message: "Fetching one canonical source context…" }));
    } else if (event.type === "stage_started" || event.type === "checkpoint") {
      setState((current) => ({ ...current, step: "generating_ai", progress: Math.min(92, 15 + index * 11), message: event.data?.detail ? String(event.data.detail) : `Running ${event.stage ?? "research"}…`, agentCheckpoints: next }));
    } else if (event.type === "stage_completed") {
      setState((current) => ({ ...current, progress: Math.min(94, 20 + index * 12), message: `${event.stage ?? "Stage"} completed.`, agentCheckpoints: next }));
    } else if (event.type === "quality_update") {
      setState((current) => ({ ...current, step: "building_pdf", progress: 96, message: "Canonical quality gate evaluated.", agentCheckpoints: next }));
    } else if (event.type === "paused") {
      const resume = event.data?.resumeFrom;
      if (resume && typeof resume === "object") {
        resumeRef.current = resume as Record<string, unknown>;
        try { localStorage.setItem(`apex_canonical_resume_${ticker}`, JSON.stringify(resumeRef.current)); } catch {}
      }
      setIsPaused(true);
      setIsApiKeyModalOpen(true);
      setRateLimitInfo({ provider: "AI Provider", message: event.data?.message ? String(event.data.message) : "Research paused; resume from the saved checkpoint." });
      setState((current) => ({ ...current, step: "generating_ai", message: "Research paused; resume is available." }));
    } else if (event.type === "failed") {
      setState({ step: "error", progress: 0, message: "", error: event.error?.message ?? "Research run failed." });
    } else if (event.type === "completed") {
      next = cloneCheckpoints().map((checkpoint) => ({ ...checkpoint, status: "complete" as const }));
    }
    return next;
  }, [ticker]);
  const consumeResponse = useCallback(async (response: Response) => {
    if (response.status === 429) {
      let body: { message?: string; provider?: string; error?: string } = {};
      try { body = await response.json(); } catch { body = {}; }
      setIsPaused(true);
      setIsApiKeyModalOpen(true);
      setRateLimitInfo({ provider: body.provider, message: body.message ?? body.error ?? "Research paused." });
      return;
    }
    if (!response.ok) {
      let message = `Research request failed (${response.status}).`;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) message = body.error;
      } catch {
        return;
      }
      throw new Error(message);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const body = await response.json() as { package?: CanonicalResearchPackage };
      if (!body.package) throw new Error("Canonical package missing from response.");
      applyPackage(body.package);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let checkpoints = cloneCheckpoints();
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const event = eventFromChunk(part);
        if (!event) continue;
        checkpoints = updateEvent(event, checkpoints);
        if (event.package) applyPackage(event.package);
      }
      if (chunk.done) break;
    }
  }, [applyPackage, updateEvent]);
  const generateReport = useCallback(async (resume = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ step: "fetching_data", progress: 5, message: "Connecting to the canonical research pipeline…", agentCheckpoints: cloneCheckpoints() });
    setIsPaused(false);
    const activeConfig = configRef.current;
    const serverModel = loadServerModelOverride();
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream, application/json" };
    if (activeConfig?.apiKey) {
      headers["x-custom-api-key"] = activeConfig.apiKey;
      headers["x-custom-api-provider"] = activeConfig.provider;
      if (activeConfig.model) headers["x-custom-api-model"] = activeConfig.model;
    } else if (serverModel) {
      headers["x-custom-api-model"] = serverModel;
    }
    try {
      const response = await fetch("/api/analyze?stream=true", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          ticker,
          options: {
            reportTypeId,
            depth,
            ...(resume && resumeRef.current ? { resumeFrom: resumeRef.current } : {}),
          },
          ...(activeConfig ? { customKeyConfig: activeConfig } : {}),
        }),
      });
      await consumeResponse(response);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      setState({ step: "error", progress: 0, message: "", error: error instanceof Error ? error.message : "Research request failed." });
    }
  }, [consumeResponse, depth, reportTypeId, ticker]);
  useEffect(() => {
    if (configReady) void generateReport(false);
  }, [configReady, generateReport]);
  useEffect(() => {
    if (!canonicalPackage) return;
    setReportData(adaptCanonicalResearchPackage(canonicalPackage, { reportTypeId, depth }));
  }, [canonicalPackage, depth, reportTypeId]);
  const handleKeyModalSave = (config: CustomKeyConfig | null, retry = false) => {
    configRef.current = config;
    setCustomKeyConfig(config);
    setIsApiKeyModalOpen(false);
    if (retry || isPaused) void generateReport(true);
  };
  const exportGate = reportData ? exportGateForReport(reportData) : null;
  const packageQuality = canonicalPackage?.quality;
  const identityPublication = readExtra(reportData, "identityPublication") as { canPublish?: boolean; publishAllowed?: boolean; label?: string; reasons?: string[] } | null;
  const identityQaPublication = readExtra(reportData, "identityQaPublication") as { canPublish?: boolean; publishAllowed?: boolean; label?: string; reasons?: string[] } | null;
  const originalityReport = readExtra(reportData, "originalityReport") as { status?: string; maximumSimilarity?: number; reasons?: string[] } | null;
  const originalityBlocking = originalityReport?.status === "collision";
  const identityBlocking = identityPublication ? identityPublication.canPublish === false : false;
  const baseBlocked = exportGate ? !exportGate.exportAllowed : packageQuality ? !packageQuality.canPublish : false;
  const isBlocked = baseBlocked || identityBlocking || originalityBlocking;
  const exportLabel = isBlocked ? "Diagnostic preview (non-publishable)" : exportGate?.label ?? (packageQuality && !packageQuality.canPublish ? "Diagnostic preview (non-publishable)" : "PDF");
  const previewPolicy = canonicalPackage?.canonicalQa?.advisoryPreview ?? null;
  const fairValue = canonicalPackage?.valuationResult.fairValuePerShare;
  const currentPrice = canonicalPackage?.sourceContext.stockData.currentPrice;
  const rating = canonicalPackage?.rating ?? "NR";
  const forecastRows = canonicalPackage?.executedForecast.incomeStatement ?? [];
  const selectedTitle = getReportBlueprint(reportTypeId)?.title ?? "Institutional Equity Research";
  const currency = reportData?.profile.currency ?? "USD";
  const isLoading = state.step !== "done" && state.step !== "error";
  const formattedPackage = useMemo(() => ({
    id: canonicalPackage?.packageId ?? "Unavailable",
    hash: canonicalPackage?.packageHash ?? "Unavailable",
    cutoff: canonicalPackage?.dataCutoff ?? "Unavailable",
    runId: canonicalPackage?.researchRunId ?? "Unavailable",
    auditHash: canonicalPackage?.auditPackageHash ?? "Unavailable",
    qaDecision: canonicalPackage?.qaDecision ?? canonicalPackage?.canonicalQa?.decision ?? "Unavailable",
  }), [canonicalPackage]);
  const planView = readExtra(reportData, "reportPlan") as { planId?: string; planHash?: string; sections?: Array<{ id: string; title: string; order: number; depth: number; priority: number; include: boolean; chartIds: string[]; tableIds: string[] }>; unresolvedBlockers?: string[]; compatibility?: { status: string; capability: string; reasons: string[] }; coverage?: { coverageScore: number; missingEvidence: string[] } } | null;
  const companyIdentity = readExtra(reportData, "companyIdentity") as { kind?: string; identityId?: string; ticker?: string; fingerprint?: string } | null;
  const researchIdentity = reportData?.researchIdentity ?? null;
  const chartSpecs = (readExtra(reportData, "chartSpecs") as Array<{ id: string; title: string; provenance: string; omissionReason: string | null; hash: string }> | null) ?? [];
  const tableSpecs = (readExtra(reportData, "tableSpecs") as Array<{ id: string; title: string; provenance: string; omissionReason: string | null; hash: string }> | null) ?? [];
  const presentation = readExtra(reportData, "presentationViewModel") as { viewHash?: string; metrics?: Array<{ key: string; label: string; display: string; state: string; provenance: string }>; disclosures?: string[]; visualLabels?: string[] } | null;
  const auditPackage = canonicalPackage?.auditPackage ?? null;
  const runView = canonicalPackage?.run ?? null;
  const memoryView = canonicalPackage?.researchMemory ?? null;
  const deltasView = canonicalPackage?.whatChanged ?? null;
  const acceptedCharts = chartSpecs.filter((spec) => !spec.omissionReason);
  const omittedCharts = chartSpecs.filter((spec) => spec.omissionReason);
  const acceptedTables = tableSpecs.filter((spec) => !spec.omissionReason);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={() => router.push("/")}>Terminal</button>
          <div className={styles.breadcrumb}><span>Equities</span><span className={styles.breadSep}>/</span><span>{ticker}</span></div>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.keySettingsBtn} onClick={() => setIsApiKeyModalOpen(true)}>
            {customKeyConfig?.apiKey ? SUPPORTED_PROVIDERS[customKeyConfig.provider]?.name ?? "Custom key" : "AI key: Default"}
          </button>
          <WatchlistButton ticker={ticker} reportId={canonicalPackage?.researchRunId} fairValue={fairValue} currentPrice={currentPrice} />
        </div>
      </header>
      <main className={styles.content}>
        {isLoading && (
          <div className={styles.loadingCard}>
            <div className={styles.loadingTop}>
              <div className={styles.loadingSpinner} />
              <h1 className={styles.loadingTitle}>Researching <span>{ticker}</span></h1>
              <p className={styles.loadingDesc}>One source context, one model execution, one canonical package.</p>
            </div>
            <ProgressTracker step={state.step} message={state.message} progress={state.progress} agentCheckpoints={state.agentCheckpoints} reportContext={`${selectedTitle} · ${depth}`} reportTitle={selectedTitle} />
            {isPaused && <button className="btn-primary" onClick={() => void generateReport(true)}>Resume canonical run</button>}
          </div>
        )}
        {state.step === "error" && (
          <div className={styles.errorCard}>
            <h2 className={styles.errorTitle}>Research run failed</h2>
            <p className={styles.errorMessage}>{state.error}</p>
            <button className="btn-primary" onClick={() => void generateReport(false)}>Retry</button>
          </div>
        )}
        {state.step === "done" && reportData && canonicalPackage && (
          <div className={styles.resultWrapper}>
            {isBlocked && (
              <div role="alert" aria-live="polite" style={{ padding: 12, marginBottom: 12, border: "1px solid rgba(245,158,11,.45)", borderRadius: 8, color: "#f59e0b" }}>
                {exportLabel} — canonical publication is blocked. PDF export remains available as a non-publishable preview.
              </div>
            )}
            <div className={styles.heroCard}>
              <div className={styles.heroTopRow}>
                <div className={styles.companyIdentity}>
                  <div className={styles.identityMeta}><span className={styles.symbolPill}>{ticker}</span><span className={styles.exchangeTag}>{reportData.profile.exchange || "Global"}</span></div>
                  <h1 className={styles.companyName}>{reportData.profile.name || ticker}</h1>
                  <div className={styles.industryMeta}>{reportData.profile.sector} · {reportData.profile.industry}</div>
                </div>
                <div className={styles.quoteMatrix}>
                  <div className={styles.quoteMetric}><span className={styles.quoteMetricLabel}>Current price</span><span className={styles.quoteMetricVal}>{displayNumber(currentPrice)} {currency}</span></div>
                  <div className={styles.quoteMetric}><span className={styles.quoteMetricLabel}>Fair value</span><span className={styles.quoteMetricVal}>{displayNumber(fairValue)} {currency}</span></div>
                  <div className={styles.quoteMetric}><span className={styles.quoteMetricLabel}>Rating</span><span className={styles.quoteMetricVal}>{rating}</span></div>
                </div>
              </div>
            </div>
            <div className={styles.exportBanner}>
              <div className={styles.exportLeft}><div className={styles.exportHeading}>{selectedTitle}</div><div className={styles.exportSub}>Package {formattedPackage.id} · cutoff {formattedPackage.cutoff}</div><div className={styles.exportSub}>Plan {planView?.planHash ? planView.planHash.slice(0, 12) : "Unavailable"} · QA {String(formattedPackage.qaDecision)} · {previewPolicy ? previewPolicy.label : exportLabel}</div></div>
              <PDFDownloadButton data={reportData} />
            </div>
            <div className={styles.selectorBar}>
              <span className={styles.selectorLabel}>Report type</span>
              <select aria-label="Report type" className={styles.selectorSelect} value={reportTypeId} onChange={(event) => setReportTypeId(event.target.value as ReportTypeId)}>
                {selectableReportTypes().map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
              </select>
              <span className={styles.selectorLabel}>Depth</span>
              <div className={styles.depthToggle} role="group" aria-label="Research depth">
                {(["concise", "full"] as const).map((value) => <button key={value} aria-pressed={depth === value} className={`${styles.depthBtn} ${depth === value ? styles.depthBtnActive : ""}`} onClick={() => setDepth(value)}>{value}</button>)}
              </div>
            </div>
            <div className={styles.tabBar} role="tablist" aria-label="Canonical report views">
              {(["overview", "forecast", "valuation", "quality", "plan", "identity", "charts", "audit", "runs"] as const).map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ""}`} onClick={() => setActiveTab(tab)}>{tab}</button>)}
            </div>
            <div className={styles.tabContent}>
              {activeTab === "overview" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Canonical research overview</div>
                  <p className={styles.editorialBody}>{reportData.aiAnalysis?.companyOverview || canonicalPackage.researchReport?.businessModel || "Narrative unavailable."}</p>
                  <p className={styles.editorialBody}>{canonicalPackage.researchReport?.thesis?.thesis || "No thesis text available."}</p>
                </div>
              )}
              {activeTab === "forecast" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Executed canonical forecast</div>
                  <div className="fin-table-container"><table className="fin-table"><thead><tr><th>Period</th><th>Revenue</th><th>EBIT</th><th>Net income</th></tr></thead><tbody>{forecastRows.map((row) => <tr key={row.period}><td>{row.period}</td><td>{displayNumber(row.values.revenue)}</td><td>{displayNumber(row.values.ebit ?? row.values.operatingIncome)}</td><td>{displayNumber(row.values.netIncome)}</td></tr>)}</tbody></table></div>
                </div>
              )}
              {activeTab === "valuation" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Canonical valuation</div>
                  <p className={styles.editorialBody}>Method: {canonicalPackage.valuationResult.methodology || "Unavailable"}</p>
                  <p className={styles.editorialBody}>Fair value: {displayNumber(fairValue)} {currency}</p>
                  <p className={styles.editorialBody}>Status: {canonicalPackage.valuationResult.status || "unavailable"}</p>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(canonicalPackage.scenarios, null, 2)}</pre>
                </div>
              )}
              {activeTab === "quality" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Quality and integrity</div>
                  <p className={styles.editorialBody}>Package hash: {formattedPackage.hash}</p>
                  <p className={styles.editorialBody}>Source snapshot: {canonicalPackage.sourceSnapshotHash}</p>
                  <p className={styles.editorialBody}>QA decision: {String(formattedPackage.qaDecision)}</p>
                  <p className={styles.editorialBody}>Preview policy: {previewPolicy ? `${previewPolicy.label} — ${previewPolicy.reason}` : exportLabel}</p>
                  <ul>{(canonicalPackage.quality.checks ?? []).map((check) => <li key={check.id}>{check.status.toUpperCase()}: {check.message}</li>)}</ul>
                </div>
              )}
              {activeTab === "plan" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Company-specific report plan</div>
                  <p className={styles.editorialBody}>Plan {planView?.planId ?? "Unavailable"} · hash {planView?.planHash ?? "Unavailable"}</p>
                  <p className={styles.editorialBody}>Coverage {planView?.coverage ? String(planView.coverage.coverageScore) : "Unavailable"} · compatibility {planView?.compatibility?.status ?? "Unavailable"}</p>
                  <ul>{(planView?.sections ?? []).map((section) => <li key={section.id}>{section.order}. {section.title} — depth {section.depth} priority {section.priority} {section.include ? "" : "(excluded)"}</li>)}</ul>
                  <p className={styles.editorialBody}>Unresolved blockers: {(planView?.unresolvedBlockers ?? []).join("; ") || "None"}</p>
                </div>
              )}
              {activeTab === "identity" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Research identity</div>
                  <p className={styles.editorialBody}>IDENTITY {companyIdentity?.identityId ?? "Unavailable"} · kind {companyIdentity?.kind ?? "Unavailable"}</p>
                  <p className={styles.editorialBody}>ResearchDNA {researchIdentity?.identityId ?? "Unavailable"} · collision {researchIdentity?.collision.status ?? "Unavailable"}</p>
                  <p className={styles.editorialBody}>Publication: {identityPublication?.label ?? identityQaPublication?.label ?? exportLabel}</p>
                  <p className={styles.editorialBody}>Originality: {originalityReport?.status ?? "Unavailable"} · max {displayState(originalityReport?.maximumSimilarity)}</p>
                </div>
              )}
              {activeTab === "charts" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Deterministic charts and tables</div>
                  <p className={styles.editorialBody}>Accepted charts {acceptedCharts.length} · omitted {omittedCharts.length} · tables {acceptedTables.length}</p>
                  <ul>{acceptedCharts.map((spec) => <li key={spec.id}>{spec.id} — {spec.title} · {spec.provenance} · {spec.hash.slice(0, 12)}</li>)}</ul>
                  <ul>{omittedCharts.map((spec) => <li key={spec.id}>{spec.id} omitted — {spec.omissionReason}</li>)}</ul>
                  <p className={styles.editorialBody}>Presentation {presentation?.viewHash ?? "Unavailable"}</p>
                  <ul>{(presentation?.disclosures ?? []).map((text, index) => <li key={index}>{text}</li>)}</ul>
                </div>
              )}
              {activeTab === "audit" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Audit package</div>
                  <p className={styles.editorialBody}>Audit hash: {formattedPackage.auditHash}</p>
                  <p className={styles.editorialBody}>Package hash: {formattedPackage.hash}</p>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(auditPackage?.hashes ?? {}, null, 2)}</pre>
                </div>
              )}
              {activeTab === "runs" && (
                <div className={styles.editorialCard}>
                  <div className={styles.cardSectionHeader}>Run, memory and deltas</div>
                  <p className={styles.editorialBody}>Run {formattedPackage.runId} · status {runView?.status ?? "Unavailable"}</p>
                  <p className={styles.editorialBody}>Memory {memoryView ? `${memoryView.runId} · ${memoryView.mode}` : "Unavailable"}</p>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(deltasView?.changedFields ?? deltasView ?? {}, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      <ApiKeyModal isOpen={isApiKeyModalOpen} onClose={() => setIsApiKeyModalOpen(false)} onSave={handleKeyModalSave} isRateLimitTriggered={isPaused} rateLimitInfo={rateLimitInfo} currentConfig={customKeyConfig} />
    </div>
  );
}
