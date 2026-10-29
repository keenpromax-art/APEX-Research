"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Eye, FileText, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api, apiBlob, downloadBlob, getErrorMessage } from "@/lib/api";
import { fmt, money, pct } from "@/lib/format";
import { Card, CardHeader, Button, EmptyState, ErrorBanner, Field, InfoBanner, Select, Spinner, Stat } from "@/components/ui";

type ReportSummary = {
  id: number;
  ticker: string;
  company_name?: string | null;
  title: string;
  report_type: string;
  status: "complete" | "preliminary" | "failed";
  rating?: string | null;
  target_price?: number | null;
  current_price?: number | null;
  upside?: number | null;
  currency?: string | null;
  horizon?: string | null;
  ai_model?: string | null;
  page_count?: number | null;
  pdf_size?: number | null;
  previous_version_id?: number | null;
  warnings?: string[] | null;
  pdf_qa?: { level: string; check: string; detail: string }[] | null;
  created_at?: string | null;
};

type ModelRow = {
  name: string;
  enabled: boolean;
  provider?: string;
  model_id?: string;
  base_url?: string | null;
  api_key?: string | null;
  source?: string;
  has_key?: boolean;
};

type PreviewPage = { number: number; width: number; height: number; image: string };
type Preview = { id: number; page_count: number; rendered: number; pages: PreviewPage[] };

const ratingTone: Record<string, string> = { BUY: "text-pos", HOLD: "text-warn", SELL: "text-neg", "NOT RATED": "text-muted" };
const statusTone: Record<string, string> = { complete: "text-pos", preliminary: "text-warn", failed: "text-neg" };

export default function ResearchPage() {
  return <ResearchStudio />;
}

function ResearchStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTicker = (searchParams.get("ticker") || "").toUpperCase();

  const [ticker, setTicker] = useState(initialTicker || "SAMPLE");
  const [title, setTitle] = useState("");
  const [reportType, setReportType] = useState<"quick" | "full">("full");
  const [years, setYears] = useState("5");
  const [horizon, setHorizon] = useState("12M");
  const [terminalMode, setTerminalMode] = useState<"growth" | "multiple">("growth");
  const [terminalGrowth, setTerminalGrowth] = useState("0.025");
  const [exitMultiple, setExitMultiple] = useState("10");
  const [waccEnabled, setWaccEnabled] = useState(false);
  const [wacc, setWacc] = useState("0.08");
  const [ratingMode, setRatingMode] = useState<"auto" | "manual">("auto");
  const [manualRating, setManualRating] = useState("BUY");
  const [manualTarget, setManualTarget] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [peers, setPeers] = useState("");
  const [autoPeers, setAutoPeers] = useState<string[]>([]);
  const [peersBusy, setPeersBusy] = useState(false);
  const [peersStatus, setPeersStatus] = useState<"idle" | "finding" | "found" | "none">("idle");
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false);
  const peersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reportDate, setReportDate] = useState("");

  const [models, setModels] = useState<ModelRow[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selected, setSelected] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
  }, [selected?.id]);

  async function loadPreview(id: number) {
    setPreviewBusy(true);
    setError("");
    try {
      setPreview(await api<Preview>(`/api/research/reports/${id}/preview`));
    } catch (err) {
      setPreview(null);
      setError(getErrorMessage(err));
    } finally {
      setPreviewBusy(false);
    }
  }

  const loadReports = useCallback(async (focusTicker?: string) => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (focusTicker) params.set("ticker", focusTicker.trim().toUpperCase());
      setReports(await api<ReportSummary[]>(`/api/research/reports?${params.toString()}`));
    } catch (err) {
      setReports([]);
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await api<ModelRow[]>("/api/ai/models");
        setModels(rows.filter((row) => row.enabled));
      } catch {
        setModels([]);
      }
    })();
    void loadReports(initialTicker);
  }, [initialTicker, loadReports]);

  // Auto-fetch validated peer companies when the ticker changes.
  useEffect(() => {
    if (peersTimer.current) clearTimeout(peersTimer.current);
    setPeers("");
    setAutoPeers([]);
    setPeersStatus("idle");

    const clean = ticker.trim().toUpperCase();
    if (!clean || clean === "SAMPLE") return;

    setPeersStatus("finding");
    setPeersBusy(true);
    peersTimer.current = setTimeout(async () => {
      try {
        const result = await api<{
          ok: boolean;
          peers: string[];
          sector: string | null;
          target: string;
          cached?: boolean;
        }>(`/api/peers?target=${encodeURIComponent(clean)}&minCount=3&maxCount=5`);
        if (result.ok && result.peers.length > 0) {
          setAutoPeers(result.peers);
          setPeers(result.peers.join(", "));
          setPeersStatus(result.peers.length >= 5 ? "found" : "none");
        } else {
          setAutoPeers([]);
          setPeersStatus("none");
        }
      } catch {
        setAutoPeers([]);
        setPeersStatus("none");
      } finally {
        setPeersBusy(false);
      }
    }, 400);

    return () => {
      if (peersTimer.current) clearTimeout(peersTimer.current);
    };
  }, [ticker]);

  // AI-suggest peers: fetch validated candidates from Yahoo, then ask the AI to pick
  // the most relevant ones based on sector/industry/business similarity.
  // If Yahoo is down, fall back to the user's manually entered peers.
  async function suggestAiPeers() {
    const clean = ticker.trim().toUpperCase();
    if (!clean || clean === "SAMPLE") {
      setError("Enter a ticker first.");
      return;
    }
    if (!aiModel) {
      setError("Select an AI model first.");
      return;
    }
    setAiSuggestBusy(true);
    setError("");
    try {
      // Step 1: fetch validated candidates for this ticker from Yahoo Finance.
      const peersRes = await api<{
        ok: boolean;
        peers: string[];
        sector: string | null;
        target: string;
        error?: string;
      }>(`/api/peers?target=${encodeURIComponent(clean)}&minCount=1&maxCount=10`);

      // Step 2: Build candidate list — Yahoo results first, fall back to
      // user-entered peers if Yahoo returns nothing.
      let candidates: string[] = [];
      if (peersRes.ok && peersRes.peers.length) {
        candidates = peersRes.peers;
      } else {
        const manual = peers
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter((p) => p && p !== clean);
        candidates = manual;
      }

      // Step 3: ask the AI to select the most relevant peers from candidates.
      const selectedModel = models.find((m) => m.name === aiModel);
      const suggestRes = await api<{
        ok: boolean;
        peers: string[];
        peerDetails: Array<{ ticker: string; reason: string }>;
        sector: string | null;
        industry: string | null;
        aiUsed: boolean;
        error?: string;
      }>("/api/peers/suggest", {
        method: "POST",
        body: JSON.stringify({
          target: clean,
          candidates,
          model: selectedModel,
        }),
      });

      if (!suggestRes.ok || !suggestRes.peers.length) {
        // AI didn't return anything — just use the candidates we have.
        setAutoPeers(candidates);
        setPeers(candidates.join(", "));
        setPeersStatus(candidates.length > 0 ? "found" : "none");
        setAiSuggestBusy(false);
        return;
      }

      setAutoPeers(suggestRes.peers);
      setPeers(suggestRes.peers.join(", "));
      setPeersStatus(suggestRes.peers.length > 0 ? "found" : "none");
    } catch {
      // Never block: if everything fails, keep whatever the user typed.
      setAiSuggestBusy(false);
    }
  }

  function handleTickerSubmit(event: FormEvent) {
    event.preventDefault();
    const clean = ticker.trim().toUpperCase();
    if (clean) void loadReports(clean);
  }

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ticker: ticker.trim().toUpperCase(),
      report_type: reportType,
      years: Math.max(1, Math.min(10, Number(years) || 5)),
      horizon,
      terminal_mode: terminalMode,
      terminal_growth: Number(terminalGrowth) || 0.025,
      exit_multiple: Number(exitMultiple) || 10,
      rating_mode: ratingMode,
      force_refresh: forceRefresh,
    };
    if (title.trim()) body.title = title.trim();
    if (peers.trim()) body.peers = peers.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
    if (reportDate.trim()) body.report_date = reportDate.trim();
    if (waccEnabled) body.wacc = Number(wacc) || undefined;
    if (ratingMode === "manual") body.manual_rating = manualRating;
    if (ratingMode === "manual" && manualTarget) body.manual_target_price = Number(manualTarget) || undefined;
    if (aiModel) body.ai_model = aiModel;
    return body;
  }

  async function generate() {
    const clean = ticker.trim().toUpperCase();
    if (!clean) {
      setError("Enter a ticker first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = await api<ReportSummary>("/api/research/generate", {
        method: "POST",
        body: JSON.stringify(buildBody()),
      });
      setSelected(payload);
      router.replace(`/research?ticker=${encodeURIComponent(clean)}`);
      await loadReports(clean);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(id: number) {
    setBusy(true);
    setError("");
    try {
      const payload = await api<ReportSummary>(`/api/research/reports/${id}/rebuild`, { method: "POST" });
      setSelected(payload);
      await loadReports(ticker.trim().toUpperCase());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf(id: number, name?: string) {
    setError("");
    try {
      const blob = await apiBlob(`/api/research/reports/${id}/pdf`, { id });
      downloadBlob(blob, name || `apex_report_${id}.pdf`);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this report version? The PDF will be removed with it.")) return;
    setError("");
    try {
      await api(`/api/research/reports/${id}`, { method: "DELETE" });
      if (selected?.id === id) setSelected(null);
      await loadReports(ticker.trim().toUpperCase());
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const selectedWarnings = selected?.warnings?.length ? selected.warnings : [];
  const selectedQa = selected?.pdf_qa?.length ? selected.pdf_qa.filter((q) => q.level !== "info") : [];

  return (
    <div className="px-5 md:px-8 lg:px-10 py-6 md:py-8 space-y-6 max-w-[1680px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <FileText size={20} /> Research Studio
          </h1>
          <p className="text-xs text-muted mt-1">
            Institutional PDF research notes — deterministic valuation engine, auditable sources, AI narrative (optional).
          </p>
        </div>
        <form onSubmit={handleTickerSubmit} className="flex gap-2 items-center">
          <input
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            className="bg-panel border border-border px-3 py-1.5 text-sm w-44 focus:border-accent outline-none uppercase"
            placeholder="Ticker"
            aria-label="Report ticker"
          />
        </form>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1 self-start">
          <CardHeader title="Report configuration" subtitle="Everything here is recorded as provenance S5." />
          <div className="p-4 grid grid-cols-2 gap-3">
            <div className="col-span-2 text-[10px] uppercase tracking-[0.16em] text-dim font-medium border-b border-border pb-1.5">Report identity</div>
            <Field label="Title" type="text" value={title} onChange={setTitle} placeholder="Auto from company + rating" className="col-span-2" />
            <Field label="Report date" type="date" value={reportDate} onChange={setReportDate} hint="defaults to today" />
            <Select label="Note type" value={reportType} onChange={(value) => setReportType(value as "quick" | "full")} options={[{ value: "full", label: "Full institutional note" }, { value: "quick", label: "Quick note (3-5 pages)" }]} />

            <div className="col-span-2 text-[10px] uppercase tracking-[0.16em] text-dim font-medium border-b border-border pb-1.5 pt-2">Forecast and valuation</div>
            <Field label="Forecast years" value={years} onChange={setYears} hint="1-10" />
            <Field label="Horizon" type="text" value={horizon} onChange={setHorizon} hint="e.g. 12M" />
            <Select label="Terminal value" value={terminalMode} onChange={(value) => setTerminalMode(value as "growth" | "multiple")} options={[{ value: "growth", label: "Perpetuity growth" }, { value: "multiple", label: "Exit multiple" }]} />
            <Field label={terminalMode === "growth" ? "Terminal growth" : "Exit multiple"} value={terminalMode === "growth" ? terminalGrowth : exitMultiple} onChange={terminalMode === "growth" ? setTerminalGrowth : setExitMultiple} />
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={waccEnabled} onChange={(event) => setWaccEnabled(event.target.checked)} className="accent-[var(--accent)]" />
              Override WACC (CAPM inputs are otherwise used and listed in the PDF)
            </label>
            {waccEnabled ? <Field label="WACC" value={wacc} onChange={setWacc} hint="e.g. 0.08 = 8%" /> : null}

            <div className="col-span-2 text-[10px] uppercase tracking-[0.16em] text-dim font-medium border-b border-border pb-1.5 pt-2">Rating</div>
            <Select label="Rating" value={ratingMode} onChange={(value) => setRatingMode(value as "auto" | "manual")} options={[{ value: "auto", label: "Auto from DCF bands" }, { value: "manual", label: "Manual (documented)" }]} />
            {ratingMode === "manual" ? (
              <>
                <Select label="Manual rating" value={manualRating} onChange={setManualRating} options={["BUY", "HOLD", "SELL"].map((code) => ({ value: code, label: code }))} />
                <Field label="Manual target" value={manualTarget} onChange={setManualTarget} placeholder="Leave empty to keep model target" className="col-span-2" />
              </>
            ) : null}

            <div className="col-span-2 text-[10px] uppercase tracking-[0.16em] text-dim font-medium border-b border-border pb-1.5 pt-2">Data and AI</div>
            <div className="col-span-2 flex items-center gap-2">
              <Field
                label="Peers"
                type="text"
                value={peers}
                onChange={(value) => {
                  setPeers(value);
                  setAutoPeers([]);
                  setPeersStatus("idle");
                }}
                placeholder="MSFT, AAPL, GOOGL"
                hint="comma-separated, optional"
                className="col-span-2"
              />
              {peersBusy ? (
                <Spinner label="Finding peers…" />
              ) : peersStatus === "found" ? (
                <span className="text-[10px] text-muted font-medium">
                  ✓ {autoPeers.length} validated peer(s)
                </span>
              ) : peersStatus === "none" ? (
                <span className="text-[10px] text-muted font-medium">
                  No peers yet
                </span>
              ) : null}
              {!peersBusy && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={suggestAiPeers}
                  disabled={aiSuggestBusy || !aiModel || !ticker.trim()}
                  title="AI-suggest relevant peers"
                >
                  {aiSuggestBusy ? <Sparkles className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  AI peers
                </Button>
              )}
              {!aiModel && (
                <span className="text-[10px] text-warn font-medium">Select an AI model</span>
              )}
            </div>
            <Select
              label="AI narrative"
              value={aiModel}
              onChange={setAiModel}
              options={[{ value: "", label: "None — deterministic only" }, ...models.map((model) => ({ value: model.name, label: model.name }))]}
            />
            <label className="col-span-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} className="accent-[var(--accent)]" />
              Force fresh provider fetch (ignore cache)
            </label>
            <div className="col-span-2 flex flex-wrap items-center gap-3 pt-1">
              <Button onClick={() => void generate()} disabled={busy}>
                {busy ? <Spinner label="Building..." /> : "Generate report"}
              </Button>
              <span className="text-[11px] text-muted">The pipeline never invents numbers; QC runs on every build.</span>
            </div>
          </div>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader title={selected ? selected.title || `Report #${selected.id}` : "Latest report"} subtitle={selected ? `#${selected.id} · ${selected.ticker} · ${selected.report_type}` : "Generated reports appear here"} />
            {selected ? (
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Rating" value={selected.rating || "NOT RATED"} tone={ratingTone[selected.rating || ""] || "text-muted"} hint={selected.horizon || "12M"} />
                  <Stat label="Target" value={money(selected.target_price, selected.currency || "USD")} hint={`vs ${money(selected.current_price, selected.currency || "USD")} price`} />
                  <Stat label="Implied upside" value={selected.upside == null ? "—" : pct(selected.upside)} tone={selected.upside != null && selected.upside >= 0 ? "text-pos" : "text-neg"} />
                  <Stat label="Status" value={selected.status} tone={statusTone[selected.status] || "text-muted"} hint={selected.page_count ? `${selected.page_count} pages · ${fmt(selected.pdf_size || 0)} bytes` : undefined} />
                </div>
                {selectedWarnings.length ? (
                  <InfoBanner>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {selectedWarnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </InfoBanner>
                ) : null}
                {selectedQa.length ? (
                  <div className="border border-border p-3">
                    <div className="text-xs font-medium mb-1">PDF render QA</div>
                    <ul className="space-y-0.5">
                      {selectedQa.map((issue, index) => (
                        <li key={index} className={`text-[11px] ${issue.level === "error" ? "text-neg" : "text-warn"}`}>
                          <span className="font-medium uppercase">{issue.level}</span> · {issue.check.replace(/^pdf\./, "")} — {issue.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void downloadPdf(selected.id, `apex_${selected.ticker}_${selected.id}.pdf`)}>
                    <Download size={14} /> Download PDF
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => (preview ? setPreview(null) : void loadPreview(selected.id))}
                    disabled={previewBusy || !selected.pdf_size}
                  >
                    <Eye size={14} /> {previewBusy ? "Rendering…" : preview ? "Hide preview" : "Preview pages"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void regenerate(selected.id)} disabled={busy}>
                    <RefreshCw size={14} /> Regenerate (new version)
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void remove(selected.id)}>
                    <Trash2 size={14} /> Delete
                  </Button>
                  {selected.ai_model ? <span className="text-[11px] text-muted self-center">AI narrative: {selected.ai_model}</span> : <span className="text-[11px] text-muted self-center">No AI narrative (deterministic)</span>}
                </div>
                {preview ? (
                  <div className="border border-border">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border text-xs">
                      <span className="font-medium">Page preview</span>
                      <span className="text-muted">
                        {preview.rendered >= preview.page_count
                          ? `${preview.page_count} page${preview.page_count === 1 ? "" : "s"}`
                          : `showing ${preview.rendered} of ${preview.page_count} pages`}
                      </span>
                    </div>
                    <div className="max-h-[70vh] overflow-auto p-3 space-y-3 bg-black/10">
                      {preview.pages.map((page) => (
                        <figure key={page.number} className="mx-auto max-w-[640px]">
                          <img
                            src={page.image}
                            alt={`Report page ${page.number}`}
                            width={page.width}
                            height={page.height}
                            className="w-full h-auto border border-border/60 bg-white"
                          />
                          <figcaption className="text-center text-[11px] text-muted mt-1">Page {page.number}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState title="No report selected" body="Generate a note from the configuration panel, or pick a version from the library below." />
            )}
          </Card>

          <Card>
            <CardHeader title="Report library" subtitle={`${reports.length} version${reports.length === 1 ? "" : "s"}${ticker ? ` for ${ticker.toUpperCase()}` : ""}`} />
            <div className="overflow-auto">
              {reports.length === 0 ? (
                <EmptyState title="No reports yet" body="Generate your first research note. Regenerating never rewrites history — each build is a new version." />
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted border-b border-border">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Ticker</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Rating</th>
                      <th className="px-3 py-2 font-medium text-right">Target</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Created</th>
                      <th className="px-3 py-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((row) => (
                      <tr
                        key={row.id}
                        tabIndex={0}
                        aria-label={`Select version ${row.id} of the ${row.ticker} report`}
                        className={`border-b border-border/60 hover:bg-hover cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-accent ${selected?.id === row.id ? "bg-panel" : ""}`}
                        onClick={() => setSelected(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelected(row);
                          }
                        }}
                      >
                        <td className="px-3 py-2 tabular">{row.id}</td>
                        <td className="px-3 py-2 font-medium">{row.ticker}{row.previous_version_id ? <span className="text-muted"> · v({row.previous_version_id})</span> : null}</td>
                        <td className="px-3 py-2 capitalize">{row.report_type}</td>
                        <td className={`px-3 py-2 font-medium ${ratingTone[row.rating || ""] || "text-muted"}`}>{row.rating || "NOT RATED"}</td>
                        <td className="px-3 py-2 text-right tabular">{money(row.target_price, row.currency || "USD")}</td>
                        <td className={`px-3 py-2 capitalize ${statusTone[row.status] || ""}`}>{row.status}</td>
                        <td className="px-3 py-2 text-muted">{(row.created_at || "").slice(0, 16).replace("T", " ")}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                          <button
                            onClick={() => void downloadPdf(row.id, `apex_${row.ticker}_${row.id}.pdf`)}
                            className="inline-flex p-1.5 hover:bg-border/60"
                            title="Download PDF"
                            aria-label="Download PDF"
                          >
                            <Download size={14} />
                          </button>
                          <button onClick={() => void regenerate(row.id)} disabled={busy} className="inline-flex p-1.5 hover:bg-border/60 disabled:opacity-50" title="Regenerate" aria-label="Regenerate report">
                            <RefreshCw size={14} />
                          </button>
                          <button onClick={() => void remove(row.id)} className="inline-flex p-1.5 hover:bg-neg/10 text-neg" title="Delete" aria-label="Delete report">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
