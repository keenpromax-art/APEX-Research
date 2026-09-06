"use client";
import React, { useState } from "react";
import type { ReportData } from "@/types/report";
import styles from "./report.module.css";

interface Props {
  data: ReportData;
}

export default function PDFDownloadButton({ data }: Props) {
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    try {
      setLoading(true);
      setError(null);
      setStatusText("Initializing PDF Engine...");

      // Pure client-side dynamic import: strictly isolated from SSR
      const [{ pdf }, { default: ReportDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/PDFDocument"),
      ]);

      setStatusText("Compiling PDF Report...");
      const blob = await pdf(<ReportDocument data={data} />).toBlob();

      setStatusText("Starting Download...");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.profile.ticker}_Institutional_Equity_Research.pdf`;
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

  const isBlocked = (data.qaReport && data.qaReport.gateStatus === "BLOCKED") ||
    (data.finalQAResult && !data.finalQAResult.canPublish);

  const blockedReasons: string[] = [];
  if (data.qaReport?.gateStatus === "BLOCKED") {
    for (const c of data.qaReport.checks.filter(c => c.status === "FAIL")) {
      blockedReasons.push(`${c.id}: ${c.name}`);
    }
  }
  if (data.finalQAResult && !data.finalQAResult.canPublish) {
    for (const e of data.finalQAResult.errors) {
      if (!blockedReasons.some(r => r.includes(e.code))) {
        blockedReasons.push(e.message);
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        className={`btn-primary ${styles.downloadBtn}`}
        onClick={handleDownload}
        disabled={loading || isBlocked}
        style={isBlocked ? { opacity: 0.5, cursor: "not-allowed", backgroundColor: "#374151" } : {}}
      >
        {loading ? (
          <>
            <span className={styles.btnSpinner}>⟳</span>
            {statusText || "Rendering PDF..."}
          </>
        ) : isBlocked ? (
          <>
            <span style={{ color: "#ef4444", fontWeight: "bold" }}>✕</span>
            Publication Blocked (QA Failed)
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download Institutional Report (PDF)
          </>
        )}
      </button>
      {isBlocked && (
        <span style={{ color: "#f87171", fontSize: 11, fontWeight: 500, maxWidth: 340, textAlign: "right" }}>
          Export blocked: Internal financial invariants failed audit {blockedReasons.length > 0 ? `(${blockedReasons.slice(0, 2).join("; ")}${blockedReasons.length > 2 ? ` +${blockedReasons.length - 2} more` : ""})` : ""}.
        </span>
      )}
      {error && <span style={{ color: "#ef4444", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
