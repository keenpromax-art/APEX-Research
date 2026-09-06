"use client";
import React from "react";
import Link from "next/link";
import BacktestDashboard from "@/components/BacktestDashboard";
import styles from "../page.module.css";

export default function BacktestPage() {
  return (
    <div className={styles.page}>
      {/* ── Top Technical Navigation ── */}
      <nav className={styles.navbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 9 }}>
            <div className={styles.brandIcon}>▲</div>
            <span className={styles.brandLabel}>APEX RESEARCH</span>
            <span className={styles.brandSub}>EQUITY VALUATION TERMINAL</span>
          </Link>
          <span style={{ color: "var(--hairline)", fontSize: 13 }}>/</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Model Scoring Win-Rate &amp; Backtest
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink)",
              textDecoration: "none",
              padding: "5px 12px",
              borderRadius: "6px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            ← Back to Terminal
          </Link>
        </div>
      </nav>

      {/* ── Main Container ── */}
      <main style={{ maxWidth: 1280, width: "100%", margin: "0 auto", padding: "32px 24px 64px" }}>
        <BacktestDashboard />
      </main>

      {/* ── Technical Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <div className={styles.brandIcon}>▲</div>
          <span className={styles.brandLabel}>APEX RESEARCH TERMINAL</span>
        </div>
        <p className={styles.footerCopy}>
          Empirical backtesting results are derived from point-in-time quantitative snapshots and historical exchange data.
          Past performance does not guarantee future results. For institutional equity research purposes only.
        </p>
      </footer>
    </div>
  );
}
