"use client";

import { useEffect, useRef, useState } from "react";
import { BlockRenderer } from "@/components/Blocks";
import SettingsModal, { getSavedKey, hasSavedKey } from "@/components/SettingsModal";
import type { Block } from "@/lib/types";

const PIPELINE_STEPS = [
  "Fetching data...",
  "Preparing financial context...",
  "AI analyzing...",
  "Rendering analysis...",
];

interface AnalysisResult {
  title: string;
  summary: string;
  blocks: Block[];
  meta: { generatedAt: string; tickers: string[]; dataSource: string };
}

const DEPTH_OPTIONS = [
  { value: "brief", label: "Brief" },
  { value: "standard", label: "Standard" },
  { value: "deep", label: "Deep dive" },
] as const;

type DepthValue = (typeof DEPTH_OPTIONS)[number]["value"];

function userRequestDefault(depth: DepthValue): string {
  if (depth === "brief") return "Give a concise note on what matters most in this company's data.";
  if (depth === "deep")
    return "Produce a comprehensive institutional-grade equity research report covering every dimension the data supports.";
  return "Analyze this company.";
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function Home() {
  const [tickers, setTickers] = useState("");
  const [depth, setDepth] = useState<DepthValue>("standard");
  const [focus, setFocus] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [keyActive, setKeyActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setKeyActive(hasSavedKey());
  }, [showSettings]);

  const runAnalysis = (tickerList: string) => {
    if (!tickerList.trim() || running) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setStatus([]);
    setActiveStep(-1);

    const { provider, key, model } = getSavedKey();
    const ask = focus.trim()
      ? `${userRequestDefault(depth)} ${focus.trim()}`
      : userRequestDefault(depth);
    let url = `/api/analyze?tickers=${encodeURIComponent(tickerList)}&depth=${depth}&request=${encodeURIComponent(ask)}`;
    if (provider && key) {
      url += `&provider=${encodeURIComponent(provider)}&key=${encodeURIComponent(key)}`;
      if (model) url += `&model=${encodeURIComponent(model)}`;
    }

    const source = new EventSource(url);
    source.addEventListener("status", (e) => {
      const data = (e as MessageEvent).data;
      const idx = PIPELINE_STEPS.indexOf(data);
      if (idx >= 0) {
        setActiveStep(idx);
        setStatus((prev) => [...prev.slice(0, idx), data]);
      }
    });
    source.addEventListener("result", (e) => {
      source.close();
      setRunning(false);
      setResult(JSON.parse((e as MessageEvent).data) as AnalysisResult);
    });
    source.addEventListener("error", (e) => {
      source.close();
      setRunning(false);
      let message = "Analysis failed.";
      try {
        const payload = JSON.parse((e as MessageEvent).data);
        if (payload?.message) message = payload.message;
      } catch {
        /* keep default */
      }
      setError(message);
    });
  };

  return (
    <main className="container">
      <header className="hero">
        <div className="hero-top">
          <div className="hero-badge">
            <span className="pulse-dot" />
            yfinance data · AI analysis
          </div>
          <button
            className={`icon-btn${keyActive ? " key-active" : ""}`}
            title="AI provider settings"
            aria-label="AI provider settings"
            onClick={() => setShowSettings(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
        </div>
        <h1>
          Equity Research <span className="gradient-text">Engine</span>
        </h1>
        <p className="subtitle">
          Enter any public ticker. The engine retrieves Yahoo Finance data, computes
          deterministic metrics, and lets AI reason over the numbers — no fixed report format.
        </p>

        <form
          className="search-bar"
          onSubmit={(e) => {
            e.preventDefault();
            runAnalysis(tickers);
          }}
        >
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input
              ref={inputRef}
              id="ticker-input"
              type="text"
              placeholder="Ticker or tickers — e.g. RELIANCE.NS, AAPL, MSFT"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
            />
            <kbd>Enter</kbd>
          </div>
          <button id="analyze-btn" type="submit" disabled={running}>
            <span>{running ? "Analyzing..." : "Analyze"}</span>
            {!running && (
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            )}
          </button>
        </form>

        <div className="controls">
          <div className="seg" role="group" aria-label="Report depth">
            {DEPTH_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`seg-btn${depth === o.value ? " active" : ""}`}
                onClick={() => setDepth(o.value)}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            className="focus-input"
            type="text"
            placeholder="Optional focus — e.g. why did margins change?"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="quick-chips">
          {["RELIANCE.NS", "AAPL", "NVDA", "MSFT", "TCS.NS"].map((t) => (
            <button key={t} className="chip" onClick={() => { setTickers(t); runAnalysis(t); }}>
              {t}
            </button>
          ))}
          <button className="chip" onClick={() => { setTickers("AAPL, MSFT"); runAnalysis("AAPL, MSFT"); }}>
            Compare AAPL · MSFT
          </button>
        </div>
      </header>

      {running && (
        <div className="status-panel">
          <div className="status-steps">
            {PIPELINE_STEPS.map((label, i) => (
              <div key={label} className={`status-step${i < activeStep ? " done" : i === activeStep ? " active" : ""}`}>
                <span className="step-icon">{i < activeStep ? "✓" : ""}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="status-bar">
            <div className="status-bar-fill" style={{ width: `${((activeStep + 1) / PIPELINE_STEPS.length) * 100}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="error-panel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          <div>
            <strong>Analysis failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {result && (
        <section ref={resultRef}>
          <div className="doc-header">
            <div>
              <h2>{result.title}</h2>
              <p className="doc-summary">{result.summary}</p>
            </div>
            <div className="doc-meta">
              <span className="ticker-tag">{(result.meta.tickers ?? []).join(", ")}</span>
              <span>generated {formatDate(result.meta.generatedAt)}</span>
            </div>
          </div>
          <div>
            {result.blocks.map((block, i) => (
              <div key={i} className="block">
                <BlockRenderer block={block} />
              </div>
            ))}
          </div>
          <footer className="doc-footer">
            <span>Source: Yahoo Finance (yfinance)</span>
            <span className="dot-sep" />
            <span>Ticker(s): {(result.meta.tickers ?? []).join(", ")}</span>
            <span className="dot-sep" />
            <span>{formatDate(result.meta.generatedAt)}</span>
          </footer>
        </section>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </main>
  );
}
