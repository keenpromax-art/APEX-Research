"use client";
import React, { useState } from "react";
import type { ReportData } from "@/types/report";
import { canPublishReport } from "@/lib/canonical";
import { getReportBlueprint } from "@/lib/report-types";
import styles from "./report.module.css";
interface Props {
  data: ReportData;
}
function extraOf(data: ReportData, key: string): unknown {
  return (data as unknown as Record<string, unknown>)[key] ?? null;
}
export default function PDFDownloadButton({ data }: Props) {
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const councilAudit = data.aiAnalysis?.councilVerification;
  const councilPassed = councilAudit?.status === "VERIFIED" || councilAudit?.status === "CORRECTED";
  const councilScore = councilAudit?.integrityScore ?? 0;
  const failedChecks = councilAudit?.checks?.filter(c => c.status === "FLAG") ?? [];
  const publishGate = canPublishReport(data);
  const qaBlocked = !publishGate.canPublish;
  const qaFailCount = (data.qaReport?.checks ?? []).filter((check) => check.status === "FAIL").length;
  const originality = extraOf(data, "originalityReport") as { status?: string; reasons?: string[] } | null;
  const identityPublication = extraOf(data, "identityPublication") as { canPublish?: boolean; label?: string; reasons?: string[] } | null;
  const originalityBlocked = originality?.status === "collision";
  const identityBlocked = identityPublication ? identityPublication.canPublish === false : false;
  const canonicalBlocked = qaBlocked || originalityBlocked || identityBlocked;
  const isBlocked = canonicalBlocked || (!councilPassed && councilAudit !== undefined);
  const bpTitle =
    (data.composedReport &&
      getReportBlueprint(data.composedReport.blueprintId)?.title) ||
    "Institutional Equity Research";
  const planHash = (extraOf(data, "reportPlan") as { planHash?: string } | null)?.planHash ?? (data.composedReport as unknown as { reportPlan?: { planHash?: string } } | null)?.reportPlan?.planHash ?? null;
  const handleDownload = async (diagnostic = false) => {
    try {
      const latestGate = canPublishReport(data);
      const latestOriginality = extraOf(data, "originalityReport") as { status?: string; reasons?: string[] } | null;
      const latestIdentity = extraOf(data, "identityPublication") as { canPublish?: boolean; reasons?: string[] } | null;
      if (!diagnostic && !latestGate.canPublish) throw new Error(latestGate.reasons.join("; ") || "Publication gate is blocked");
      if (!diagnostic && latestOriginality?.status === "collision") throw new Error(latestOriginality.reasons?.join("; ") || "Originality collision blocks publication");
      if (!diagnostic && latestIdentity && latestIdentity.canPublish === false) throw new Error(latestIdentity.reasons?.join("; ") || "Identity gate blocks publication");
      setLoading(true);
      setError(null);
      setStatusText("Initializing PDF Engine...");
      const [{ pdf }, { default: ReportDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/PDFDocument"),
      ]);
      setStatusText(diagnostic ? "Compiling diagnostic preview..." : "Compiling PDF Report...");
      const renderData = diagnostic ? { ...data, diagnosticPreview: true } : data;
      const blob = await pdf(<ReportDocument data={renderData} composed={data.composedReport ?? null} />).toBlob();
      setStatusText("Starting Download...");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileLabel = bpTitle
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      a.download = `${data.profile.ticker}_${fileLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to compile PDF: ${msg}`);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  };
  const handleJsonDownload = () => {
    if (!data.reportArtifact) {
      setError("JSON artifact is not available");
      return;
    }
    const blob = new Blob([JSON.stringify(data.reportArtifact, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${data.profile.ticker}_research_artifact.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };
  const blockedTitle = qaBlocked ? `QA gate BLOCKED (${qaFailCount} FAIL check(s)) — resolve gate findings before export.` : originalityBlocked ? `Originality collision blocks publication — resolve collision before export.` : identityBlocked ? `Identity gate blocks publication — resolve identity findings before export.` : isBlocked ? `Council audit not passed (${councilScore}/100, ${failedChecks.length} flags). Retry flagged agents until audit passes.` : "Export PDF report";
  const blockedLabel = qaBlocked ? `QA Gate BLOCKED (${qaFailCount} FAIL)` : originalityBlocked ? `Originality BLOCKED` : identityBlocked ? `Identity Gate BLOCKED` : `Council Audit Pending (${councilScore}/100 — ${failedChecks.length} flag${failedChecks.length !== 1 ? "s" : ""})`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        aria-label={isBlocked ? `Export blocked: ${blockedTitle}` : `Export PDF report ${bpTitle}`}
        aria-disabled={loading || isBlocked}
        className={`btn-primary ${styles.downloadBtn}`}
        onClick={() => handleDownload(false)}
        disabled={loading || isBlocked}
        title={blockedTitle}
      >
        {loading ? (
          <>
            <span className={styles.btnSpinner}>⟳</span>
            {statusText || "Rendering PDF..."}
          </>
        ) : isBlocked ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {blockedLabel}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download {bpTitle} (PDF)
          </>
        )}
      </button>
      {planHash && (
        <span style={{ color: "#64748b", fontSize: 11 }}>Plan {String(planHash).slice(0, 12)} · presentation-bound export</span>
      )}
      {isBlocked && (
        <button
          aria-label="Render diagnostic preview, non-publishable"
          className={`btn-secondary ${styles.downloadBtn}`}
          onClick={() => handleDownload(true)}
          disabled={loading}
          title="Render a diagnostic preview. This output is non-publishable while the canonical package gate is blocked."
        >
          {loading ? "Rendering preview..." : "Diagnostic preview (non-publishable)"}
        </button>
      )}
      <button
        aria-label="Export research artifact as JSON"
        className={`btn-secondary ${styles.downloadBtn}`}
        onClick={handleJsonDownload}
        disabled={!data.reportArtifact || isBlocked}
        title="Export the versioned research artifact as JSON"
      >
        Download JSON artifact
      </button>
      {error && <span role="alert" style={{ color: "#ef4444", fontSize: 12 }}>{error}</span>}
      {isBlocked && (failedChecks.length > 0 || qaBlocked || originalityBlocked || identityBlocked) && (
        <span style={{ color: "#f59e0b", fontSize: 11, textAlign: "right", maxWidth: 300 }}>
          Failed: {qaBlocked ? `QA gate (${qaFailCount} FAIL: ${((data as unknown as Record<string, { checks?: Array<{ status?: string; id?: string }> }>).qaReport?.checks ?? []).filter((c) => c.status === "FAIL").slice(0, 3).map((c) => c.id).join(", ")})` : ""}{qaBlocked && (failedChecks.length > 0 || originalityBlocked || identityBlocked) ? " | " : ""}{failedChecks.length > 0 ? failedChecks.map(c => c.category).join(", ") : ""}{originalityBlocked ? "originality-collision" : ""}{identityBlocked ? "identity-gate" : ""}
        </span>
      )}
    </div>
  );
}
