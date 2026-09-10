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

  // QA publication gate removed per owner request — export is always available.
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <button
        className={`btn-primary ${styles.downloadBtn}`}
        onClick={handleDownload}
        disabled={loading}
      >
        {loading ? (
          <>
            <span className={styles.btnSpinner}>⟳</span>
            {statusText || "Rendering PDF..."}
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
    </div>
  );
}
