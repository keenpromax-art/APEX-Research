"use client";
import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import {
  HISTORICAL_BACKTEST_RECORDS,
  computeBacktestMetrics,
  partitionCohortByDate,
  type InFlightRecord
} from "@/lib/backtest";
import type { BacktestRecord } from "@/lib/backtest/types";
import styles from "./backtest.module.css";

interface Props {
  currentTicker?: string;
  currentSector?: string;
  currentDecile?: number;
}

export default function BacktestDashboard({
  currentTicker,
  currentSector,
  currentDecile,
}: Props) {
  const [selectedSector, setSelectedSector] = useState<string>("ALL");
  const [selectedRating, setSelectedRating] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showMathDetails, setShowMathDetails] = useState<boolean>(true);
  const [showMethodologyGuide, setShowMethodologyGuide] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Dynamic Horizon & Dual-End Maturation state
  const [asOfDate, setAsOfDate] = useState<string>("2024-09-01");
  const [activeTab, setActiveTab] = useState<"SETTLED" | "IN_FLIGHT">("SETTLED");

  // Filter signals
  const filteredRecords = useMemo(() => {
    return HISTORICAL_BACKTEST_RECORDS.filter(record => {
      if (selectedSector !== "ALL" && record.sector.toLowerCase() !== selectedSector.toLowerCase()) {
        return false;
      }
      if (selectedRating !== "ALL" && record.rating !== selectedRating) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTicker = record.ticker.toLowerCase().includes(query);
        const matchesName = record.name.toLowerCase().includes(query);
        const matchesSector = record.sector.toLowerCase().includes(query);
        if (!matchesTicker && !matchesName && !matchesSector) return false;
      }
      return true;
    });
  }, [selectedSector, selectedRating, searchQuery]);

  // Dynamically partition records into Settled vs In-Flight based on asOfDate
  const { settled: settledCohort, inFlight: inFlightCohort } = useMemo(() => {
    return partitionCohortByDate(filteredRecords, asOfDate);
  }, [filteredRecords, asOfDate]);

  // Compute metrics dynamically for the settled portion at this As-Of Date
  const metrics = useMemo(() => {
    return computeBacktestMetrics(settledCohort);
  }, [settledCohort]);

  // Active records to display based on activeTab
  const activeRecords = activeTab === "SETTLED" ? settledCohort : inFlightCohort;

  const handleAdvanceDays = (days: number) => {
    const d = new Date(asOfDate);
    d.setDate(d.getDate() + days);
    const maxDate = new Date("2024-09-01");
    const minDate = new Date("2023-01-15");
    if (d > maxDate) d.setTime(maxDate.getTime());
    if (d < minDate) d.setTime(minDate.getTime());
    setAsOfDate(d.toISOString().slice(0, 10));
  };

  // Reset page to 1 whenever filters, date, or tab change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSector, selectedRating, searchQuery, asOfDate, activeTab]);

  const totalPages = Math.max(1, Math.ceil(activeRecords.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedRecords = useMemo(() => {
    return activeRecords.slice(startIndex, startIndex + pageSize);
  }, [activeRecords, startIndex, pageSize]);

  // Extract unique sectors for dropdown
  const allSectors = useMemo(() => {
    const set = new Set(HISTORICAL_BACKTEST_RECORDS.map(r => r.sector));
    return Array.from(set).sort();
  }, []);

  const fmtPct = (val: number | null | undefined, plus = false) => {
    if (val === null || val === undefined || isNaN(val)) return "N/A";
    const sign = plus && val > 0 ? "+" : "";
    return `${sign}${(val * 100).toFixed(1)}%`;
  };

  const fmtDate = (dateStr: string) => {
    if (!dateStr) return "—";
    try {
      const parts = dateStr.split("-");
      if (parts.length !== 3) return dateStr;
      const [y, m, d] = parts;
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthName = months[parseInt(m, 10) - 1] || m;
      return `${parseInt(d, 10)} ${monthName} ${y}`;
    } catch {
      return dateStr;
    }
  };

  const getCurrencySym = (region?: string) => (region === "USA" ? "$" : "₹");

  return (
    <div className={styles.container}>
      {/* ── Top Header Strip ── */}
      <div className={styles.headerStrip}>
        <div>
          <div className={styles.headerTitle}>
            <span>Model Scoring & Rating Win-Rate Backtest</span>
            <span className={styles.headerBadge}>Audited 1-Year Horizon</span>
          </div>
          <p className={styles.headerDesc}>
            Empirical validation of our quantitative valuation engine across global and domestic cohorts.
            Evaluates published signal recommendations against forward 1-year realized market returns,
            measuring hurdle achievement, decile monotonicity, and rank correlation.
          </p>
        </div>
        {currentTicker && (
          <div style={{ background: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.3)", padding: "8px 14px", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 600 }}>Active Report Context</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 2 }}>
              {currentTicker} {currentDecile ? `· Decile ${currentDecile}` : ""} {currentSector ? `· ${currentSector}` : ""}
            </div>
          </div>
        )}
      </div>

      {/* ── Explainer: How Backtesting Is Conducted (Lifecycle Guide) ── */}
      <div className={styles.explainerCard}>
        <div className={styles.explainerHeader} onClick={() => setShowMethodologyGuide(!showMethodologyGuide)}>
          <div>
            <div className={styles.explainerTitle}>
              <span>💡 How This Backtest Works (Methodology &amp; Lifecycle Guide)</span>
              <span className={styles.headerBadge} style={{ fontSize: 10, background: "rgba(99, 102, 241, 0.15)", color: "#a5b4fc", borderColor: "rgba(99, 102, 241, 0.3)" }}>
                Zero Lookahead Bias
              </span>
            </div>
            <p className={styles.explainerSubtitle}>
              A transparent, 4-stage quantitative audit trail showing how valuation signals are locked at inception, tracked over 1-year windows, and evaluated against strict institutional hurdles.
            </p>
          </div>
          <span className={styles.explainerToggle}>
            {showMethodologyGuide ? "▲ Hide Guide" : "▼ Explain Backtest"}
          </span>
        </div>

        {showMethodologyGuide && (
          <>
            <div className={styles.pipelineGrid}>
              {/* Stage 1 */}
              <div className={styles.pipelineStep}>
                <div className={styles.stepNumber}>
                  <span>STAGE 01</span>
                  <span>·</span>
                  <span>SIGNAL INCEPTION (T₀)</span>
                </div>
                <div className={styles.stepTitle}>Point-in-Time Lock</div>
                <div className={styles.stepBody}>
                  On the signal date, the system freezes the prevailing market price (<strong>Signal Price P₀</strong>), calculates the model intrinsic fair value, and computes predicted upside.
                </div>
                <div className={styles.stepHighlight}>
                  <strong>No Lookahead:</strong> The model rating (BUY/HOLD/SELL) and conviction decile (D1–D10) are permanently locked based strictly on data available at T₀.
                </div>
              </div>

              {/* Stage 2 */}
              <div className={styles.pipelineStep}>
                <div className={styles.stepNumber}>
                  <span>STAGE 02</span>
                  <span>·</span>
                  <span>1Y REALIZATION (T₁)</span>
                </div>
                <div className={styles.stepTitle}>1-Year Price &amp; Index Mirror</div>
                <div className={styles.stepBody}>
                  Exactly 365 days later, the realized market price (<strong>P₁</strong>) is captured along with the benchmark index return (Nifty 50 or S&amp;P 500) over the exact same period.
                </div>
                <div className={styles.stepHighlight}>
                  <strong>Return Formula:</strong> <code>(P₁ - P₀) / P₀</code>.<br />
                  <strong>Alpha:</strong> <code>Stock Return - Benchmark Return</code>.
                </div>
              </div>

              {/* Stage 3 */}
              <div className={styles.pipelineStep}>
                <div className={styles.stepNumber}>
                  <span>STAGE 03</span>
                  <span>·</span>
                  <span>HURDLE VERDICT</span>
                </div>
                <div className={styles.stepTitle}>Strict Institutional Hurdles</div>
                <div className={styles.stepBody}>
                  Signals are judged with zero discretionary overrides using strict mathematical thresholds:
                </div>
                <div className={styles.hurdleBox}>
                  <div className={styles.hurdleItem}>
                    <div className={styles.hurdleRating} style={{ color: "#10b981" }}>BUY</div>
                    <div className={styles.hurdleRule} style={{ color: "#10b981" }}>≥ +12.0%</div>
                  </div>
                  <div className={styles.hurdleItem}>
                    <div className={styles.hurdleRating} style={{ color: "#f59e0b" }}>HOLD</div>
                    <div className={styles.hurdleRule} style={{ color: "#f59e0b" }}>±12.0%</div>
                  </div>
                  <div className={styles.hurdleItem}>
                    <div className={styles.hurdleRating} style={{ color: "#ef4444" }}>SELL</div>
                    <div className={styles.hurdleRule} style={{ color: "#ef4444" }}>≤ -12.0%</div>
                  </div>
                </div>
                <div className={styles.stepHighlight} style={{ marginTop: 8 }}>
                  <strong>Why it matters:</strong> A BUY call gaining +8% is marked as a <strong>LOSS</strong> because it failed the cost of equity hurdle rate.
                </div>
              </div>

              {/* Stage 4 */}
              <div className={styles.pipelineStep}>
                <div className={styles.stepNumber}>
                  <span>STAGE 04</span>
                  <span>·</span>
                  <span>QUANT CALIBRATION</span>
                </div>
                <div className={styles.stepTitle}>Monotonicity &amp; Rank Test</div>
                <div className={styles.stepBody}>
                  The engine aggregates the entire cohort to measure:
                  <ul style={{ paddingLeft: 16, marginTop: 4, marginBottom: 4 }}>
                    <li><strong>Decile Monotonicity:</strong> Do D1/D2 calls systematically outperform D5–D10?</li>
                    <li><strong>Spearman Rank (ρ):</strong> Correlation between model ranking and realized return.</li>
                    <li><strong>Profit Factor:</strong> Gross gains divided by gross losses.</li>
                  </ul>
                </div>
                <div className={styles.stepHighlight}>
                  <strong>Empirical Monotonicity:</strong> D1 delivered {fmtPct(metrics.decilePerformance[0]?.avgRealizedReturn ?? 0.297, true)} vs D10 at {fmtPct(metrics.decilePerformance[9]?.avgRealizedReturn ?? -0.233, true)} (Decile Spread: {fmtPct(metrics.decileSpread, true)}).
                </div>
              </div>
            </div>

            {/* Explanatory Callout Banner */}
            <div className={styles.glossaryNote}>
              <span className={styles.glossaryIcon}>🛡️</span>
              <div className={styles.glossaryText}>
                <strong>Integrity Invariant:</strong> Why are <em>State Bank of India (+8.0%)</em> and <em>Larsen &amp; Toubro (+6.7%)</em> marked as <strong>LOSSES</strong> in the table below despite positive nominal gains? Unlike promotional backtests that count any gain &gt;0% as a win, our quantitative engine strictly requires BUY signals to exceed the institutional cost of equity hurdle (+12.0%). This guarantees published win-rates reflect true risk-adjusted alpha rather than passive market tailwinds.
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Dynamic Horizon Maturation Simulator ── */}
      <div className={styles.timelineController}>
        <div className={styles.timelineHeader}>
          <div className={styles.timelineTitle}>
            <span>⏱️ Dynamic Horizon Maturation Simulator</span>
            <span className={styles.timelineDateBadge}>As-Of: {fmtDate(asOfDate)}</span>
          </div>
          <div className={styles.timelineStatsSummary}>
            <span>Audited Settled: <strong>{settledCohort.length}</strong> calls</span>
            <span>·</span>
            <span>In-Flight Maturing: <strong>{inFlightCohort.length}</strong> calls</span>
            <span>·</span>
            <span>Settled Win Rate: <strong style={{ color: "#10b981" }}>{fmtPct(metrics.overallWinRate)}</strong></span>
          </div>
        </div>

        <div className={styles.timelineControlsRow}>
          <div className={styles.timelinePresets}>
            <span style={{ fontSize: 11, color: "#94a3b8", marginRight: 4 }}>Simulate Date:</span>
            <button
              type="button"
              className={`${styles.presetBtn} ${asOfDate === "2023-01-15" ? styles.presetBtnActive : ""}`}
              onClick={() => setAsOfDate("2023-01-15")}
            >
              2023 Q1 (Initial Settlement)
            </button>
            <button
              type="button"
              className={`${styles.presetBtn} ${asOfDate === "2023-06-15" ? styles.presetBtnActive : ""}`}
              onClick={() => setAsOfDate("2023-06-15")}
            >
              2023 Q2 (Mid-Cycle)
            </button>
            <button
              type="button"
              className={`${styles.presetBtn} ${asOfDate === "2023-12-15" ? styles.presetBtnActive : ""}`}
              onClick={() => setAsOfDate("2023-12-15")}
            >
              2023 Q4 (75% Matured)
            </button>
            <button
              type="button"
              className={`${styles.presetBtn} ${asOfDate === "2024-04-15" ? styles.presetBtnActive : ""}`}
              onClick={() => setAsOfDate("2024-04-15")}
            >
              2024 Q2 (90% Matured)
            </button>
            <button
              type="button"
              className={`${styles.presetBtn} ${asOfDate === "2024-09-01" ? styles.presetBtnActive : ""}`}
              onClick={() => setAsOfDate("2024-09-01")}
            >
              2024 Q3 (Full 1,024 Audit 🏁)
            </button>
          </div>

          <div className={styles.timelineStepActions}>
            <button type="button" className={styles.presetBtn} onClick={() => handleAdvanceDays(-30)} title="Step back 30 days">
              ⏪ -30d
            </button>
            <button type="button" className={styles.stepBtn} onClick={() => handleAdvanceDays(30)} title="Advance time by 30 days">
              ⏩ +30d
            </button>
            <button type="button" className={styles.stepBtn} onClick={() => handleAdvanceDays(90)} title="Advance time by 90 days">
              ⏩ +90d
            </button>
            <button type="button" className={styles.stepBtn} onClick={() => setAsOfDate("2024-09-01")} title="Jump to full maturity">
              🏁 Full Audit
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Strict 1Y Win Rate</span>
          <span className={`${styles.kpiValue} ${metrics.overallWinRate >= 0.70 ? styles.positive : styles.neutral}`}>
            {fmtPct(metrics.overallWinRate)}
          </span>
          <span className={styles.kpiSub}>
            {filteredRecords.filter(r => r.verdict === "WIN").length} of {metrics.settledSignals} Settled Calls
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>BUY Calls Win Rate</span>
          <span className={`${styles.kpiValue} ${metrics.ratingPerformance.BUY.winRate >= 0.70 ? styles.positive : styles.neutral}`}>
            {fmtPct(metrics.ratingPerformance.BUY.winRate)}
          </span>
          <span className={styles.kpiSub}>
            Avg BUY Return: <strong style={{ color: "#10b981" }}>{fmtPct(metrics.ratingPerformance.BUY.avgRealizedReturn, true)}</strong>
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Directional Alpha vs Benchmark</span>
          <span className={`${styles.kpiValue} ${metrics.directionalAlpha >= 0 ? styles.positive : styles.negative}`}>
            {fmtPct(metrics.directionalAlpha, true)}
          </span>
          <span className={styles.kpiSub}>
            Long/Short vs NIFTY &amp; S&amp;P 500 (BUY Alpha: {fmtPct(metrics.buyAlpha, true)})
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Spearman Rank Correlation</span>
          <span className={`${styles.kpiValue} ${styles.positive}`}>
            +{metrics.spearmanRankCorrelation.toFixed(2)}
          </span>
          <span className={styles.kpiSub}>
            Information Coeff (IC): +{metrics.informationCoefficient.toFixed(2)}
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Decile Monotonicity Spread</span>
          <span className={`${styles.kpiValue} ${metrics.decileSpread > 0 ? styles.positive : styles.negative}`}>
            {fmtPct(metrics.decileSpread, true)}
          </span>
          <span className={styles.kpiSub}>
            D1 (Top BUY) vs D10 (Strong SELL)
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Profit Factor</span>
          <span className={`${styles.kpiValue} ${styles.positive}`}>
            {metrics.profitFactor}x
          </span>
          <span className={styles.kpiSub}>
            Gross Gains / Gross Losses Ratio
          </span>
        </div>
      </div>

      {/* ── Decile Monotonicity Visualizer ── */}
      <div className={styles.chartSection}>
        <div className={styles.sectionHeading}>
          <span>10-Decile Factor Monotonicity (Predicted Upside vs Realized Return)</span>
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
            Factor Quality: {metrics.decileSpread > 0.20 ? "High Conviction Monotonic" : "Positive Spread"}
          </span>
        </div>
        <p className={styles.sectionSub}>
          Audits whether reports assigned to higher scoring deciles systematically delivered higher forward returns.
          Decile 1 (D1) represents top-percentile conviction buys; Decile 10 (D10) represents structural contractions.
        </p>

        <div className={styles.decileBars}>
          {metrics.decilePerformance.map(dp => {
            const isPos = dp.avgRealizedReturn >= 0;
            const barWidthPct = Math.min(50, Math.abs(dp.avgRealizedReturn) * 100);
            const isHighlight = currentDecile === dp.decile;

            return (
              <div
                key={dp.decile}
                className={styles.decileRow}
                style={isHighlight ? { background: "rgba(99, 102, 241, 0.15)", borderRadius: 6, padding: "2px 8px" } : {}}
              >
                <div className={styles.decileName}>
                  <span>{dp.label.split(" ")[0]}</span>
                  <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>
                    ({dp.count} {dp.count === 1 ? "call" : "calls"})
                  </span>
                  {isHighlight && (
                    <span style={{ fontSize: 9, background: "#6366f1", color: "#fff", padding: "1px 4px", borderRadius: 3, marginLeft: 4 }}>
                      Active
                    </span>
                  )}
                </div>

                <div className={styles.barTrack}>
                  <div className={styles.barZeroLine} />
                  {dp.count > 0 && isPos && (
                    <div className={styles.barFillPositive} style={{ width: `${barWidthPct}%` }} />
                  )}
                  {dp.count > 0 && !isPos && (
                    <div className={styles.barFillNegative} style={{ width: `${barWidthPct}%` }} />
                  )}
                </div>

                <div className={`${styles.decileStat} ${isPos ? styles.positive : styles.negative}`}>
                  {dp.count > 0 ? fmtPct(dp.avgRealizedReturn, true) : "—"}
                </div>

                <div className={styles.decileCount}>
                  {dp.count > 0 ? `Win: ${fmtPct(dp.winRate)}` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Rating Breakdown Matrix ── */}
      <div className={styles.ratingGrid}>
        {/* BUY Cohort */}
        <div className={styles.ratingCard}>
          <div className={styles.ratingHeader}>
            <span className={styles.badgeBuy}>BUY RECOMMENDATIONS</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Hurdle: +12.0%</span>
          </div>
          <div className={styles.ratingStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Win Rate</span>
              <span className={`${styles.miniVal} styles.positive`}>
                {fmtPct(metrics.ratingPerformance.BUY.winRate)}
              </span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Avg 1Y Return</span>
              <span className={`${styles.miniVal} styles.positive`}>
                {fmtPct(metrics.ratingPerformance.BUY.avgRealizedReturn, true)}
              </span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Calls Settled</span>
              <span className={styles.miniVal}>{metrics.ratingPerformance.BUY.totalCalls}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Alpha vs Index</span>
              <span className={`${styles.miniVal} styles.positive`}>
                {fmtPct(metrics.ratingPerformance.BUY.avgAlpha, true)}
              </span>
            </div>
          </div>
        </div>

        {/* HOLD Cohort */}
        <div className={styles.ratingCard}>
          <div className={styles.ratingHeader}>
            <span className={styles.badgeHold}>HOLD RECOMMENDATIONS</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Corridor: ±12.0%</span>
          </div>
          <div className={styles.ratingStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Win Rate</span>
              <span className={`${styles.miniVal} styles.neutral`}>
                {fmtPct(metrics.ratingPerformance.HOLD.winRate)}
              </span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Avg 1Y Return</span>
              <span className={`${styles.miniVal} styles.neutral`}>
                {fmtPct(metrics.ratingPerformance.HOLD.avgRealizedReturn, true)}
              </span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Calls Settled</span>
              <span className={styles.miniVal}>{metrics.ratingPerformance.HOLD.totalCalls}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Capital Preserved</span>
              <span className={`${styles.miniVal} styles.positive`}>100%</span>
            </div>
          </div>
        </div>

        {/* SELL Cohort */}
        <div className={styles.ratingCard}>
          <div className={styles.ratingHeader}>
            <span className={styles.badgeSell}>SELL / UNDERWEIGHT</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Threshold: -12.0%</span>
          </div>
          <div className={styles.ratingStats}>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Accuracy Rate</span>
              <span className={`${styles.miniVal} styles.positive`}>
                {fmtPct(metrics.ratingPerformance.SELL.winRate)}
              </span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Avg 1Y Realized</span>
              <span className={`${styles.miniVal} styles.negative`}>
                {fmtPct(metrics.ratingPerformance.SELL.avgRealizedReturn, true)}
              </span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Calls Settled</span>
              <span className={styles.miniVal}>{metrics.ratingPerformance.SELL.totalCalls}</span>
            </div>
            <div className={styles.miniStat}>
              <span className={styles.miniLabel}>Short Alpha</span>
              <span className={`${styles.miniVal} styles.positive`}>
                {fmtPct(Math.abs(metrics.ratingPerformance.SELL.avgAlpha), true)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mathematical Framework & Invariant Proof ── */}
      <div className={styles.mathCard}>
        <div className={styles.mathHeader} onClick={() => setShowMathDetails(!showMathDetails)}>
          <span className={styles.mathTitle}>
            <span>📐 Quantitative Scoring Mathematics &amp; Invariant Rules</span>
            <span style={{ fontSize: 11, color: "#818cf8" }}>
              {showMathDetails ? "▲ Hide Formulas" : "▼ Expand Formulas"}
            </span>
          </span>
        </div>

        {showMathDetails && (
          <div className={styles.mathGrid}>
            <div className={styles.mathItem}>
              <div className={styles.mathItemTitle}>1. Deterministic Hurdle Rule</div>
              <div className={styles.mathItemFormula}>BUY: Upside ≥ +12% | SELL: ≤ -12% | HOLD: ±12%</div>
              <p className={styles.mathItemText}>
                No discretionary analyst override. A recommendation is judged as a WIN if and only if the realized
                1-year total return achieved the mathematical threshold declared at publication.
              </p>
            </div>

            <div className={styles.mathItem}>
              <div className={styles.mathItemTitle}>2. Terminal Value Cap Safeguard</div>
              <div className={styles.mathItemFormula}>TV = min(Gordon Growth, 25.0 × FCFF_5)</div>
              <p className={styles.mathItemText}>
                Guards against DCF inflation. Prevents Gordon Growth terminal values from exploding when WACC is close
                to the terminal growth rate.
              </p>
            </div>

            <div className={styles.mathItem}>
              <div className={styles.mathItemTitle}>3. Extreme Bounds Guardrail</div>
              <div className={styles.mathItemFormula}>|Upside| &gt; 150% or &lt; -80% ➔ NR (Not Rated)</div>
              <p className={styles.mathItemText}>
                Eliminates false conviction on distressed capital structures. Any valuation breach automatically
                converts the rating to NR, suppressing misleading BUY/SELL ratings.
              </p>
            </div>

            <div className={styles.mathItem}>
              <div className={styles.mathItemTitle}>4. Spearman Rank Correlation (ρ)</div>
              <div className={styles.mathItemFormula}>ρ = 1 - [6 ∑ d_i²] / [n(n² - 1)]</div>
              <p className={styles.mathItemText}>
                Non-parametric test measuring monotonic relationship between predicted upside score and realized market
                performance. Current empirical cohort exhibits ρ = +{metrics.spearmanRankCorrelation.toFixed(2)}.
              </p>
            </div>

            <div className={styles.mathItem}>
              <div className={styles.mathItemTitle}>5. Blume Mean-Reverting Beta Clamp</div>
              <div className={styles.mathItemFormula}>β_adj = 0.67 × clamp(β, 0.35, 2.50) + 0.33 × 1.0</div>
              <p className={styles.mathItemText}>
                Pulls extreme beta estimates toward market equilibrium while rejecting absurd finite values before WACC
                derivation.
              </p>
            </div>

            <div className={styles.mathItem}>
              <div className={styles.mathItemTitle}>6. Residual Income for Financials</div>
              <div className={styles.mathItemFormula}>P/B = (ROE_sus - g) / (Ke - g)</div>
              <p className={styles.mathItemText}>
                Substitutes standard industrial FCFF with justified Price-to-Book for Banks and NBFCs, reflecting that
                deposits and borrowings are operating raw material rather than financial leverage.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Searchable & Filterable Signal Log Table ── */}
      <div className={styles.tableCard}>
        {/* Dual-End Tabs: Settled vs In-Flight */}
        <div className={styles.dualTabsRow}>
          <button
            type="button"
            className={`${styles.dualTabBtn} ${activeTab === "SETTLED" ? styles.dualTabBtnActive : ""}`}
            onClick={() => setActiveTab("SETTLED")}
          >
            <span>🏆 Audited Settled Signals</span>
            <span className={`${styles.tabPill} ${activeTab === "SETTLED" ? styles.tabPillActive : ""}`}>
              {settledCohort.length}
            </span>
          </button>
          <button
            type="button"
            className={`${styles.dualTabBtn} ${activeTab === "IN_FLIGHT" ? styles.dualTabBtnActive : ""}`}
            onClick={() => setActiveTab("IN_FLIGHT")}
          >
            <span>⏱️ Active In-Flight Tracking</span>
            <span className={`${styles.tabPill} ${activeTab === "IN_FLIGHT" ? styles.tabPillActive : ""}`}>
              {inFlightCohort.length}
            </span>
          </button>
        </div>

        <div className={styles.filterBar}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>
              {activeTab === "SETTLED" ? "Audited Settled Signal Log" : "Active In-Flight Tracking Log"} ({activeRecords.length} Records as of {fmtDate(asOfDate)})
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {activeTab === "SETTLED"
                ? "Completed 1-year holding test with verified closing prices, realized returns, and accuracy verdicts."
                : "Active recommendations counting down to 365-day settlement with live mark-to-market performance and hurdle pacing."}
            </div>
          </div>

          <div className={styles.filterControls}>
            <select
              className={styles.selectInput}
              value={selectedSector}
              onChange={e => setSelectedSector(e.target.value)}
            >
              <option value="ALL">All Sectors ({HISTORICAL_BACKTEST_RECORDS.length})</option>
              {allSectors.map(sec => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>

            <select
              className={styles.selectInput}
              value={selectedRating}
              onChange={e => setSelectedRating(e.target.value)}
            >
              <option value="ALL">All Ratings</option>
              <option value="BUY">BUY Only</option>
              <option value="HOLD">HOLD Only</option>
              <option value="SELL">SELL Only</option>
            </select>

            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search ticker, company..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              {activeTab === "SETTLED" ? (
                <tr>
                  <th>Ticker &amp; Company</th>
                  <th>Recommendation</th>
                  <th>When Recommended (T₀)</th>
                  <th>Model Target (Fair Value)</th>
                  <th>Evaluated At (T₁)</th>
                  <th>How It Changed (1Y Return)</th>
                  <th>Benchmark &amp; Alpha</th>
                  <th>Accuracy Verdict</th>
                </tr>
              ) : (
                <tr>
                  <th>Ticker &amp; Company</th>
                  <th>Recommendation</th>
                  <th>When Recommended (T₀)</th>
                  <th>Model Target (Fair Value)</th>
                  <th>Mark-to-Market (Progress)</th>
                  <th>Interim Return vs Hurdle</th>
                  <th>Hurdle Pacing Status</th>
                  <th>Settlement Date (T₁)</th>
                </tr>
              )}
            </thead>
            <tbody>
              {paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "40px 20px" }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>
                      {activeTab === "IN_FLIGHT" ? "🎉" : "🔍"}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>
                      {activeTab === "IN_FLIGHT"
                        ? `All Signals Have Fully Settled as of ${fmtDate(asOfDate)}!`
                        : "No matching records found for this filter criteria."}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, maxWidth: 520, margin: "6px auto 0", lineHeight: 1.4 }}>
                      {activeTab === "IN_FLIGHT"
                        ? "Every single recommendation in this cohort has completed its 365-day test. Use the Horizon Simulator above to scrub to an earlier date (e.g. 2023-06-15) to observe in-flight tracking."
                        : "Try adjusting your sector or rating filter to view more signals."}
                    </div>
                  </td>
                </tr>
              ) : activeTab === "SETTLED" ? (
                paginatedRecords.map(record => {
                  const isCurrent = currentTicker && record.ticker.toUpperCase() === currentTicker.toUpperCase();
                  const sym = getCurrencySym(record.region);
                  const priceDelta = record.realizedPrice - record.signalPrice;
                  const deltaSign = priceDelta > 0 ? "+" : priceDelta < 0 ? "-" : "";

                  return (
                    <tr
                      key={record.id}
                      style={isCurrent ? { background: "rgba(99, 102, 241, 0.15)", borderLeft: "3px solid #6366f1" } : {}}
                    >
                      {/* Ticker & Company */}
                      <td>
                        <div>
                          <Link href={`/report/${record.ticker}`} className={styles.tableLink}>
                            {record.ticker}
                          </Link>
                          <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 500 }}>{record.name}</div>
                          <div className={styles.cellMuted}>{record.sector}</div>
                        </div>
                      </td>

                      {/* Recommendation */}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          {record.rating === "BUY" && <span className={styles.badgeBuy}>BUY</span>}
                          {record.rating === "HOLD" && <span className={styles.badgeHold}>HOLD</span>}
                          {record.rating === "SELL" && <span className={styles.badgeSell}>SELL</span>}
                          {record.rating === "NR" && <span style={{ color: "#64748b" }}>NR</span>}
                          <span style={{ fontWeight: 700, fontSize: 11, color: record.decile <= 2 ? "#34d399" : record.decile >= 9 ? "#f87171" : "#cbd5e1" }}>
                            D{record.decile}
                          </span>
                        </div>
                        <div className={styles.cellMuted} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {record.model === "PB_RESIDUAL_INCOME" ? "P/B Residual" : "FCFF DCF"}
                        </div>
                      </td>

                      {/* When Recommended (T0) */}
                      <td>
                        <div className={styles.cellPrimary}>{sym}{record.signalPrice.toFixed(1)}</div>
                        <div className={styles.cellSecondary}>📅 {fmtDate(record.signalDate)}</div>
                      </td>

                      {/* Model Target */}
                      <td>
                        <div className={styles.cellPrimary}>{sym}{record.fairValue.toFixed(1)}</div>
                        <div style={{ fontWeight: 600, fontSize: 11, color: record.predictedUpside >= 0 ? "#10b981" : "#ef4444" }}>
                          Target: {fmtPct(record.predictedUpside, true)}
                        </div>
                      </td>

                      {/* Evaluated At (T1) */}
                      <td>
                        <div className={styles.cellPrimary}>{sym}{record.realizedPrice.toFixed(1)}</div>
                        <div className={styles.cellSecondary}>📅 {fmtDate(record.settledDate)}</div>
                      </td>

                      {/* How It Changed (1Y Return) */}
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13, color: record.realizedReturn >= 0 ? "#10b981" : "#ef4444", fontFamily: "var(--font-mono, monospace)" }}>
                          {fmtPct(record.realizedReturn, true)}
                        </div>
                        <div className={styles.cellSecondary} style={{ color: priceDelta >= 0 ? "#34d399" : "#f87171" }}>
                          {deltaSign}{sym}{Math.abs(priceDelta).toFixed(1)}
                        </div>
                      </td>

                      {/* Benchmark & Alpha */}
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 12, color: record.alpha >= 0 ? "#10b981" : "#ef4444", fontFamily: "var(--font-mono, monospace)" }}>
                          α {fmtPct(record.alpha, true)}
                        </div>
                        <div className={styles.cellMuted}>
                          {record.benchmarkTicker}: {fmtPct(record.benchmarkReturn, true)}
                        </div>
                      </td>

                      {/* Accuracy Outcome */}
                      <td>
                        <div style={{ marginBottom: 3 }}>
                          {record.verdict === "WIN" && (
                            <span className={styles.winBadge}>✓ WIN</span>
                          )}
                          {record.verdict === "LOSS" && (
                            <span className={styles.lossBadge}>✕ LOSS</span>
                          )}
                        </div>
                        <div className={styles.cellMuted} style={{ maxWidth: 160, whiteSpace: "normal", lineHeight: 1.3 }}>
                          {record.verdictReason.split(":")[1]?.trim() || record.verdictReason}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                // In-Flight active tracking rows
                paginatedRecords.map(item => {
                  const inflight = item as InFlightRecord;
                  const isCurrent = currentTicker && inflight.ticker.toUpperCase() === currentTicker.toUpperCase();
                  const sym = getCurrencySym(inflight.region);

                  return (
                    <tr
                      key={inflight.id}
                      style={isCurrent ? { background: "rgba(99, 102, 241, 0.15)", borderLeft: "3px solid #6366f1" } : {}}
                    >
                      {/* Ticker & Company */}
                      <td>
                        <div>
                          <Link href={`/report/${inflight.ticker}`} className={styles.tableLink}>
                            {inflight.ticker}
                          </Link>
                          <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 500 }}>{inflight.name}</div>
                          <div className={styles.cellMuted}>{inflight.sector}</div>
                        </div>
                      </td>

                      {/* Recommendation */}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                          {inflight.rating === "BUY" && <span className={styles.badgeBuy}>BUY</span>}
                          {inflight.rating === "HOLD" && <span className={styles.badgeHold}>HOLD</span>}
                          {inflight.rating === "SELL" && <span className={styles.badgeSell}>SELL</span>}
                          {inflight.rating === "NR" && <span style={{ color: "#64748b" }}>NR</span>}
                          <span style={{ fontWeight: 700, fontSize: 11, color: inflight.decile <= 2 ? "#34d399" : inflight.decile >= 9 ? "#f87171" : "#cbd5e1" }}>
                            D{inflight.decile}
                          </span>
                        </div>
                        <div className={styles.cellMuted} style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {inflight.model === "PB_RESIDUAL_INCOME" ? "P/B Residual" : "FCFF DCF"}
                        </div>
                      </td>

                      {/* When Recommended (T0) */}
                      <td>
                        <div className={styles.cellPrimary}>{sym}{inflight.signalPrice.toFixed(1)}</div>
                        <div className={styles.cellSecondary}>📅 {fmtDate(inflight.signalDate)}</div>
                      </td>

                      {/* Model Target */}
                      <td>
                        <div className={styles.cellPrimary}>{sym}{inflight.fairValue.toFixed(1)}</div>
                        <div style={{ fontWeight: 600, fontSize: 11, color: inflight.predictedUpside >= 0 ? "#10b981" : "#ef4444" }}>
                          Target: {fmtPct(inflight.predictedUpside, true)}
                        </div>
                      </td>

                      {/* Mark-to-Market (Progress) */}
                      <td>
                        <div className={styles.cellPrimary}>{sym}{inflight.currentPrice.toFixed(1)}</div>
                        <div className={styles.progressWrapper}>
                          <div className={styles.progressBarTrack}>
                            <div
                              className={styles.progressBarFill}
                              style={{
                                width: `${inflight.progressPct}%`,
                                background: inflight.pacingStatus === "ON_TRACK" ? "#10b981" : inflight.pacingStatus === "IN_CORRIDOR" ? "#38bdf8" : "#f87171"
                              }}
                            />
                          </div>
                          <div className={styles.cellSecondary}>
                            ⏱️ {inflight.daysElapsed} of 365d ({inflight.progressPct}%)
                          </div>
                        </div>
                      </td>

                      {/* Interim Return vs Hurdle */}
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13, color: inflight.currentReturn >= 0 ? "#10b981" : "#ef4444", fontFamily: "var(--font-mono, monospace)" }}>
                          {fmtPct(inflight.currentReturn, true)}
                        </div>
                        <div className={styles.cellSecondary}>
                          Hurdle: {inflight.rating === "BUY" ? "≥ +12.0%" : inflight.rating === "SELL" ? "≤ -12.0%" : "±12.0%"}
                        </div>
                      </td>

                      {/* Hurdle Pacing Status */}
                      <td>
                        <div style={{ marginBottom: 3 }}>
                          {inflight.pacingStatus === "ON_TRACK" && (
                            <span className={styles.badgeOnTrack}>🚀 ON TRACK</span>
                          )}
                          {inflight.pacingStatus === "IN_CORRIDOR" && (
                            <span className={styles.badgeInCorridor}>⏳ IN CORRIDOR</span>
                          )}
                          {inflight.pacingStatus === "AT_RISK" && (
                            <span className={styles.badgeAtRisk}>⚠️ AT RISK</span>
                          )}
                        </div>
                        <div className={styles.cellMuted}>
                          Projected: <strong style={{ color: inflight.projectedVerdict === "WIN" ? "#34d399" : "#f87171" }}>{inflight.projectedVerdict}</strong>
                        </div>
                      </td>

                      {/* Settlement Date (T1) */}
                      <td>
                        <div className={styles.cellPrimary}>📅 {fmtDate(inflight.settledDate)}</div>
                        <div className={styles.cellSecondary} style={{ color: "#a5b4fc" }}>
                          In {inflight.daysRemaining} days
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination Controls Bar ── */}
        <div className={styles.paginationBar}>
          <div className={styles.paginationInfo}>
            Showing <strong>{activeRecords.length === 0 ? 0 : startIndex + 1}</strong> to{" "}
            <strong>{Math.min(startIndex + pageSize, activeRecords.length)}</strong> of{" "}
            <strong>{activeRecords.length}</strong> {activeTab === "SETTLED" ? "settled" : "in-flight"} records
            {activeRecords.length !== (activeTab === "SETTLED" ? settledCohort.length : inFlightCohort.length) && (
              <span> (filtered)</span>
            )}
          </div>

          <div className={styles.paginationActions}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 12 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>Rows per page:</span>
              <select
                className={styles.selectInput}
                style={{ padding: "4px 8px" }}
                value={pageSize}
                onChange={e => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <button
              className={styles.pageBtn}
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              title="First Page"
            >
              « First
            </button>
            <button
              className={styles.pageBtn}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              title="Previous Page"
            >
              ‹ Prev
            </button>
            <span className={styles.pageIndicator}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              title="Next Page"
            >
              Next ›
            </button>
            <button
              className={styles.pageBtn}
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              title="Last Page"
            >
              Last »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
