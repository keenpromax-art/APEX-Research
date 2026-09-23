"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import SearchBar from "@/components/SearchBar";
import ApiKeyModal, { loadSavedAiConfig } from "@/components/ApiKeyModal";
import { SUPPORTED_PROVIDERS, type CustomKeyConfig } from "@/lib/ai-providers";
import {
  DEFAULT_RESEARCH_DEPTH,
  DEFAULT_REPORT_TYPE,
  buildReportQuery,
  selectableReportTypes,
  type ReportTypeId,
  type ResearchDepth,
} from "@/lib/report-types";
import type { SearchResult } from "@/types/report";
import styles from "./page.module.css";

const CORE_CAPABILITIES = [
  {
    index: "01",
    title: "Discounted Cash Flow (DCF)",
    desc: "Rigorous 5-year discrete forecast with country-calibrated WACC, terminal growth anchors, and full EV-to-equity bridge calculation.",
    tags: ["WACC", "Gordon Growth", "FCFF", "Sensitivity Matrix"],
  },
  {
    index: "02",
    title: "5-Stage DuPont Decomposition",
    desc: "Deconstruct Return on Equity into Operating Margin, Asset Turnover, Financial Leverage, Tax Burden, and Interest Burden ratios.",
    tags: ["ROE Breakdown", "Tax Efficiency", "Asset Turnover", "Capital Structure"],
  },
  {
    index: "03",
    title: "5-Year Historical Financials",
    desc: "Audited financial trajectory spanning Revenue, EBITDA, EBIT, PAT, Capex, and Net Working Capital across all available annual cycles.",
    tags: ["Income Statement", "Balance Sheet", "Cash Flow", "Capex Intensity"],
  },
  {
    index: "04",
    title: "Peer Group Benchmarking",
    desc: "Automated peer valuation comps benchmarking trailing & forward P/E, EV/EBITDA, P/B multiples, and return on invested capital.",
    tags: ["Relative Valuation", "EV/EBITDA", "P/E Cohort", "Sector Comps"],
  },
  {
    index: "05",
    title: "Strategic & Risk Intelligence",
    desc: "Structured SWOT assessment, regulatory exposure factors, ESG considerations, and catalytic investment thesis drivers.",
    tags: ["SWOT Framework", "ESG Due Diligence", "Catalyst Timeline", "Risk Matrix"],
  },
  {
    index: "06",
    title: "Institutional Research PDF",
    desc: "Production-ready equity research report modeled on CFA and Tier-1 investment bank publishing standards with complete liability waiver.",
    tags: ["Full Dossier", "CFA Standard", "Full Disclosures", "Instant Export"],
  },
];

const CURATED_TICKERS = [
  { symbol: "SUZLON.NS", name: "Suzlon Energy", exchange: "NSE", region: "India" },
  { symbol: "RELIANCE.NS", name: "Reliance Ind.", exchange: "NSE", region: "India" },
  { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", region: "USA" },
  { symbol: "NVDA", name: "NVIDIA Corp.", exchange: "NASDAQ", region: "USA" },
  { symbol: "TCS.NS", name: "Tata Consultancy", exchange: "NSE", region: "India" },
  { symbol: "MSFT", name: "Microsoft Corp.", exchange: "NASDAQ", region: "USA" },
  { symbol: "CIPLA.NS", name: "Cipla Limited", exchange: "NSE", region: "India" },
];

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [customKeyConfig, setCustomKeyConfig] = useState<CustomKeyConfig | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  // Phase 9: report type + research depth chosen before navigation; carried
  // to the report page as ?type=…&depth=… (validated there, fail-closed).
  const [reportTypeId, setReportTypeId] = useState<ReportTypeId>(DEFAULT_REPORT_TYPE);
  const [depth, setDepth] = useState<ResearchDepth>(DEFAULT_RESEARCH_DEPTH);

  React.useEffect(() => {
    const saved = loadSavedAiConfig();
    if (saved) setCustomKeyConfig(saved);
  }, []);

  const reportHref = (symbol: string) =>
    `/report/${encodeURIComponent(symbol)}${buildReportQuery(reportTypeId, depth)}`;

  const handleSelect = (result: SearchResult) => {
    setLoading(true);
    router.push(reportHref(result.symbol));
  };

  const handleTickerClick = (ticker: string) => {
    setLoading(true);
    router.push(reportHref(ticker));
  };

  return (
    <div className={styles.page}>
      {/* ── Top Technical Navigation ── */}
      <nav className={styles.navbar}>
        <div className={styles.navBrand}>
          <div className={styles.brandIcon}>▲</div>
          <span className={styles.brandLabel}>APEX RESEARCH</span>
          <span className={styles.brandSub}>EQUITY VALUATION TERMINAL</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={() => setIsApiKeyModalOpen(true)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: customKeyConfig?.apiKey ? "#34d399" : "#f59e0b",
              background: customKeyConfig?.apiKey ? "rgba(16, 185, 129, 0.12)" : "rgba(245, 158, 11, 0.12)",
              border: customKeyConfig?.apiKey ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: "6px",
              padding: "5px 12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s ease",
            }}
            title="Configure AI Model Provider & Custom API Key"
          >
            <span style={{ fontSize: 13 }}>🔑</span>
            <span>
              {customKeyConfig?.apiKey
                ? `${SUPPORTED_PROVIDERS[customKeyConfig.provider]?.name || "Custom"}`
                : "AI Provider (Default)"}
            </span>
          </button>
        </div>
      </nav>

      {/* ── Hero Section ── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroTag}>
            <span className={styles.heroTagDot} />
            <span>INSTITUTIONAL VALUATION ENGINE</span>
          </div>

          <h1 className={styles.heroTitle}>
            Professional Equity Research.
            <br />
            <span className={styles.heroTitleSub}>
              For Every Public Company Globally.
            </span>
          </h1>

          <p className={styles.heroDesc}>
            Generate publication-grade institutional valuation models, DCF projections,
            and DuPont ratio analyses for publicly listed equities across 60+ global exchanges.
          </p>

          {/* ── Command Bar Search ── */}
          <div className={styles.searchSection}>
            <SearchBar onSelect={handleSelect} loading={loading} />

            {/* ── Phase 9: Report Type + Research Depth selectors ── */}
            <div className={styles.reportOptions}>
              <div className={styles.optionGroup}>
                <label className={styles.optionLabel} htmlFor="report-type-select">
                  Report Type
                </label>
                <select
                  id="report-type-select"
                  className={styles.reportTypeSelect}
                  value={reportTypeId}
                  disabled={loading}
                  onChange={(e) => setReportTypeId(e.target.value as ReportTypeId)}
                >
                  {selectableReportTypes().map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.optionGroup}>
                <span className={styles.optionLabel}>Research Depth</span>
                <div className={styles.depthToggle} role="group" aria-label="Research depth">
                  {(["concise", "full"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`${styles.depthBtn} ${depth === d ? styles.depthBtnActive : ""}`}
                      onClick={() => setDepth(d)}
                      disabled={loading}
                    >
                      {d === "concise" ? "Concise" : "Full"}
                    </button>
                  ))}
                </div>
              </div>
              <span className={styles.optionHint}>
                Structure &amp; depth set the report outline — no page caps.
              </span>
            </div>

            <div className={styles.quickTickers}>
              <span className={styles.quickLabel}>Quick Access:</span>
              {CURATED_TICKERS.map((item) => (
                <button
                  key={item.symbol}
                  className={styles.tickerChip}
                  onClick={() => handleTickerClick(item.symbol)}
                  disabled={loading}
                >
                  <span className={styles.tickerCode}>{item.symbol}</span>
                  <span className={styles.tickerExchange}>{item.exchange}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Technical Architecture Specs ── */}
      <section className={styles.specBanner}>
        <div className={styles.specPanel}>
          <div className={styles.specItem}>
            <span className={styles.specItemLabel}>Coverage</span>
            <span className={styles.specItemVal}>50,000+</span>
            <span className={styles.specItemSub}>Equities worldwide</span>
          </div>
          <div className={styles.specItem}>
            <span className={styles.specItemLabel}>Report Output</span>
            <span className={styles.specItemVal}>Comprehensive</span>
            <span className={styles.specItemSub}>Tier-1 investment grade</span>
          </div>
          <div className={styles.specItem}>
            <span className={styles.specItemLabel}>Valuation Standard</span>
            <span className={styles.specItemVal}>DCF + Multiples</span>
            <span className={styles.specItemSub}>Gordon Growth & WACC</span>
          </div>
          <div className={styles.specItem}>
            <span className={styles.specItemLabel}>Compliance</span>
            <span className={styles.specItemVal}>IDBI / SEBI Model</span>
            <span className={styles.specItemSub}>Statutory safe-harbor</span>
          </div>
        </div>
      </section>

      {/* ── Technical Capabilities Matrix (Linear.app aesthetic) ── */}
      <section className={styles.gridSection}>
        <div className={styles.gridHeader}>
          <div className={styles.gridTitle}>Analytical Capabilities</div>
          <div className={styles.gridCount}>06 MODULES</div>
        </div>

        <div className={styles.featureMatrix}>
          {CORE_CAPABILITIES.map((cap) => (
            <div key={cap.index} className={styles.matrixCard}>
              <div className={styles.matrixIndex}>{cap.index}</div>
              <h3 className={styles.matrixHeading}>{cap.title}</h3>
              <p className={styles.matrixText}>{cap.desc}</p>
              <div className={styles.matrixTagList}>
                {cap.tags.map((t) => (
                  <span key={t} className={styles.matrixTag}>{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <span>APEX EQUITY INTELLIGENCE</span>
          <span>·</span>
          <span>100% Yahoo Finance API Market Data</span>
          <span>·</span>
          <span>OpenRouter Reasoning Engine</span>
        </div>
        <div className={styles.footerDisclaimer}>
          Academic Research Platform · Not Investment Advice
        </div>
      </footer>

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSave={(newConfig) => {
          setCustomKeyConfig(newConfig);
        }}
        currentConfig={customKeyConfig}
      />
    </div>
  );
}
