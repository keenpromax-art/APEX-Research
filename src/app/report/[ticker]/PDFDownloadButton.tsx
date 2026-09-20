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

  const councilAudit = data.aiAnalysis?.councilVerification;
  const councilPassed = councilAudit?.status === "VERIFIED" || councilAudit?.status === "CORRECTED";
  const councilScore = councilAudit?.integrityScore ?? 0;
  const failedChecks = councilAudit?.checks?.filter(c => c.status === "FLAG") ?? [];
  const isBlocked = !councilPassed && councilAudit !== undefined;

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

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        className={`btn-primary ${styles.downloadBtn}`}
        onClick={handleDownload}
        disabled={loading || isBlocked}
        title={isBlocked ? `Council audit not passed (${councilScore}/100, ${failedChecks.length} flags). Retry flagged agents until audit passes.` : "Export PDF report"}
      >
        {loading ? (
          <>
            <span className={styles.btnSpinner}>⟳</span>
            {statusText || "Rendering PDF..."}
          </>
        ) : isBlocked ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Council Audit Pending ({councilScore}/100 — {failedChecks.length} flag{failedChecks.length !== 1 ? "s" : ""})
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
      {error && <span style={{ color: "#ef4444", fontSize: 12 }}>{error}</span>}
      {isBlocked && failedChecks.length > 0 && (
        <span style={{ color: "#f59e0b", fontSize: 11, textAlign: "right", maxWidth: 300 }}>
          Failed: {failedChecks.map(c => c.category).join(", ")}
        </span>
      )}
    </div>
  );
}
