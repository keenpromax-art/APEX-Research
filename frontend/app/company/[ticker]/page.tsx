"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Download, FileText, RefreshCw, Save, Sparkles } from "lucide-react";
import { api, apiBlob, downloadBlob, getErrorMessage } from "@/lib/api";
import { fmt, humanize, isNum, localDate, num, pct, periodLabel, safeNumber, tone } from "@/lib/format";
import { ForecastChart, MarginChart, PriceChart, RevenueChart } from "@/components/charts";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  Field,
  InfoBanner,
  Select,
  Skeleton,
  Spinner,
  Stat,
  TabPanel,
  TableWrap,
  Tabs,
  WarnBanner,
} from "@/components/ui";

const TABS = ["Overview", "Business", "Statements", "History", "Forecast", "Valuation", "Sensitivity", "Risks", "Report", "Sources"];

const ASSUMPTION_FIELDS = [
  { key: "revenue_growth", label: "Revenue growth", step: "0.01" },
  { key: "gross_margin", label: "Gross margin", step: "0.01" },
  { key: "opex_ratio", label: "Operating expense % revenue", step: "0.01" },
  { key: "tax_rate", label: "Tax rate", step: "0.01" },
  { key: "da_pct", label: "D&A % revenue", step: "0.01" },
  { key: "capex_pct", label: "Capex % revenue", step: "0.01" },
  { key: "nwc_pct", label: "Δ NWC % Δ revenue", step: "0.01" },
  { key: "interest_rate", label: "Interest rate", step: "0.01" },
  { key: "dividend_payout", label: "Dividend payout", step: "0.01" },
  { key: "excess_cash_sweep", label: "Excess cash sweep", step: "0.01" },
  { key: "share_dilution", label: "Annual share dilution", step: "0.01" },
];

const METRIC_KEYS = [
  "revenue",
  "revenue_growth",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "ebitda",
  "net_income",
  "eps_diluted",
  "roe",
  "roa",
  "roic",
  "fcf",
  "current_ratio",
  "net_debt",
  "book_value_per_share",
];

const PERCENT_METRICS = new Set(["revenue_growth", "gross_margin", "operating_margin", "net_margin", "roe", "roa", "roic"]);

const LINE_ORDER = [
  "revenue",
  "cost_of_revenue",
  "gross_profit",
  "operating_expense",
  "operating_income",
  "ebit",
  "da",
  "ebitda",
  "interest_expense",
  "pretax_income",
  "tax_expense",
  "net_income",
  "diluted_eps",
  "total_assets",
  "current_assets",
  "cash",
  "accounts_receivable",
  "inventory",
  "goodwill",
  "ppe_net",
  "total_non_current_assets",
  "total_liabilities",
  "change_in_wc",
  "da_cf",
  "current_liabilities",
  "accounts_payable",
  "total_debt",
  "equity",
  "shares_issued",
  "operating_cash_flow",
  "capex",
  "free_cash_flow",
];

const STATEMENTS = [
  { key: "income_statement", label: "Income statement" },
  { key: "balance_sheet", label: "Balance sheet" },
  { key: "cash_flow", label: "Cash flow" },
];

const DCF_SECTION_ORDER = [
  "executive_summary",
  "business_overview",
  "financial_performance",
  "strengths",
  "risks",
  "catalysts",
  "valuation_view",
  "conclusion",
  "disclaimer",
];

function fmtMetric(key: string, value: unknown) {
  if (PERCENT_METRICS.has(key)) return pct(value);
  return fmt(value);
}

function StatementTable({ rows, label, currency }: { rows: any[]; label: string; currency: string }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) {
    return <EmptyState title="No periods for this statement" body="The local engine has no periods for this statement in the selected range." />;
  }
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row.items || {}))));
  keys.sort((a, b) => {
    const ai = LINE_ORDER.indexOf(a);
    const bi = LINE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const visible = showAll ? rows : rows.slice(0, 8);
  const hiddenCount = rows.length - visible.length;
  return (
    <>
      <TableWrap className="max-h-[480px]">
        <table className="w-full min-w-[560px] text-xs">
          <caption className="sr-only">{`${label} by reporting period, latest first`}</caption>
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="text-left px-3 py-2 sticky left-0 top-0 z-20 bg-surface border-b border-border">Line item</th>
              {visible.map((row) => (
                <th key={row.period_end} className="text-right px-3 py-2 whitespace-nowrap bg-surface border-b border-border tabular">
                  {periodLabel(row.period_end)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key} className="border-b border-border/70 hover:bg-panel/40">
                <td className="px-3 py-1.5 sticky left-0 bg-surface z-10 whitespace-nowrap text-muted">{humanize(key)}</td>
                {visible.map((row) => (
                  <td key={row.period_end} className="text-right px-3 py-1.5 tabular whitespace-nowrap">
                    {fmt(row.items?.[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border text-[11px] text-muted">
        <span>
          Values in {currency}. Showing latest {visible.length} of {rows.length} periods{hiddenCount > 0 ? ` · ${hiddenCount} older hidden` : ""}.
        </span>
        {rows.length > 8 ? (
          <button
            onClick={() => setShowAll((current) => !current)}
            className="text-accent hover:underline whitespace-nowrap"
          >
            {showAll ? "Show latest 8" : `Show all ${rows.length} periods`}
          </button>
        ) : null}
      </div>
    </>
  );
}

function ReportValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-dim">—</span>;
  if (typeof value === "string") return <span className="break-words">{value}</span>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="mono tabular">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string" || typeof item === "number")) {
      return <span className="break-words">{value.map((item) => String(item)).join(" · ")}</span>;
    }
    return <span className="mono text-[11px] break-all">{JSON.stringify(value)}</span>;
  }
  return <span className="mono text-[11px] break-all">{JSON.stringify(value)}</span>;
}

function ReportContent({ content }: { content: unknown }) {
  if (content === null || content === undefined || content === "") {
    return <p className="text-xs text-dim">Not available for this report.</p>;
  }
  if (typeof content === "string") {
    return <p className="text-sm text-muted whitespace-pre-wrap leading-relaxed">{content}</p>;
  }
  if (typeof content === "number" || typeof content === "boolean") {
    return <p className="mono text-sm">{String(content)}</p>;
  }
  if (Array.isArray(content)) {
    if (content.every((item) => typeof item === "string" || typeof item === "number")) {
      return (
        <ul className="list-disc pl-5 text-sm space-y-1.5 text-muted">
          {content.map((item, index) => (
            <li key={index}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-3">
        {content.map((item, index) => (
          <div key={index} className="border-l-2 border-border pl-3">
            <ReportContent content={item} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(content as Record<string, unknown>);
  if (!entries.length) return <p className="text-xs text-dim">No content.</p>;
  return (
    <dl className="grid sm:grid-cols-2 gap-x-6 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-3 border-b border-border/60 py-1.5 min-w-0">
          <dt className="text-muted shrink-0">{humanize(key)}</dt>
          <dd className="text-right min-w-0">
            <ReportValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReportBlock({ section, content }: { section: string; content: unknown }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-2">{humanize(section)}</div>
      <ReportContent content={content} />
    </Card>
  );
}

export default function CompanyPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const ticker = decodeURIComponent(String(params?.ticker || "")).toUpperCase();
  const requestedProject = searchParams.get("project");
  const encodedTicker = encodeURIComponent(ticker);

  const [tab, setTab] = useState("Overview");
  const [periodicity, setPeriodicity] = useState<"annual" | "quarterly">("annual");
  const [company, setCompany] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [forecast, setForecast] = useState<any>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<Record<string, string | number>>({});
  const [years, setYears] = useState("5");

  const [wacc, setWacc] = useState("0.10");
  const [waccInputs, setWaccInputs] = useState<Record<string, string | number>>({
    risk_free: "0.04",
    beta: "1.0",
    market_premium: "0.055",
    cost_of_debt: "0.06",
    tax_rate: "0.25",
    equity_weight: "0.7",
    debt_weight: "0.3",
  });
  const [waccNote, setWaccNote] = useState<string | null>(null);
  const [terminalMode, setTerminalMode] = useState("growth");
  const [terminalGrowth, setTerminalGrowth] = useState("0.025");
  const [exitMultiple, setExitMultiple] = useState("10");
  const [sharesInput, setSharesInput] = useState("");
  const [netDebtInput, setNetDebtInput] = useState("");
  const [dcf, setDcf] = useState<any>(null);
  const [dcfLoading, setDcfLoading] = useState(false);
  const [dcfError, setDcfError] = useState<string | null>(null);
  const [reverse, setReverse] = useState<any>(null);

  const [sens, setSens] = useState<any>(null);
  const [sensLoading, setSensLoading] = useState(false);
  const [sensError, setSensError] = useState<string | null>(null);
  const [sensMode, setSensMode] = useState("growth");

  const [models, setModels] = useState<any[]>([]);
  const [modelName, setModelName] = useState("");
  const [report, setReport] = useState<any>(null);
  const [notePayload, setNotePayload] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportJob, setReportJob] = useState<number | null>(null);

  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  const loadData = useCallback(
    async (force = false) => {
      if (!ticker) return;
      setLoading(true);
      setError(null);
      try {
        const suffix = force ? "?refresh=true" : "";
        const [companyData, fundamentalData] = await Promise.all([
          api(`/api/company/${encodedTicker}${suffix}`),
          api(`/api/data/${encodedTicker}${suffix}`),
        ]);
        setCompany(companyData);
        setData(fundamentalData);
        try {
          const raw = localStorage.getItem("apex-recent-tickers");
          const parsed = raw ? JSON.parse(raw) : [];
          const list: string[] = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
          const next = [ticker, ...list.filter((item) => item !== ticker)].slice(0, 8);
          localStorage.setItem("apex-recent-tickers", JSON.stringify(next));
        } catch {
          // history is best-effort; storage may be unavailable
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [encodedTicker, ticker],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    api<any[]>("/api/ai/models")
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (!data || !ticker || requestedProject) return;
    let active = true;
    setForecastLoading(true);
    setForecastError(null);
    api(`/api/forecast/${encodedTicker}`, {
      method: "POST",
      body: JSON.stringify({ years: 5, assumptions: {} }),
    })
      .then((result) => {
        if (active) setForecast(result);
      })
      .catch((forecastFailure) => {
        if (active) setForecastError(getErrorMessage(forecastFailure));
      })
      .finally(() => {
        if (active) setForecastLoading(false);
      });
    return () => {
      active = false;
    };
  }, [data, encodedTicker, requestedProject, ticker]);

  useEffect(() => {
    if (!requestedProject) return;
    let active = true;
    setActiveProjectId(Number(requestedProject));
    api(`/api/projects/${requestedProject}`)
      .then((project) => {
        if (!active) return;
        const saved = project.data || {};
        const savedAssumptions = saved.assumptions || {};
        const savedYears = saved.years || 5;
        setAssumptions(savedAssumptions);
        setYears(String(savedYears));
        if (saved.wacc) setWacc(String(saved.wacc));
        if (saved.terminal_mode) setTerminalMode(saved.terminal_mode);
        setForecastLoading(true);
        return api(`/api/forecast/${encodedTicker}`, {
          method: "POST",
          body: JSON.stringify({ years: savedYears, assumptions: savedAssumptions }),
        }).then((result) => {
          if (active) setForecast(result);
        });
      })
      .catch((projectError) => {
        if (active) setForecastError(getErrorMessage(projectError));
      })
      .finally(() => {
        if (active) setForecastLoading(false);
      });
    return () => {
      active = false;
    };
  }, [encodedTicker, requestedProject]);

  const normalized = data?.normalized;
  const metricsPeriods = useMemo<any[]>(() => data?.metrics?.periods || [], [data]);
  const info = company || normalized?.info || {};
  const annual = normalized?.annual || {};
  const quarterly = normalized?.quarterly || {};
  const statementSet = periodicity === "annual" ? annual : quarterly;
  const latest = metricsPeriods[0] || {};
  const priceHistory = useMemo<any[]>(() => normalized?.price_history || [], [normalized]);
  const priceSummary = normalized?.price_summary || company?.price_summary;
  const currency = company?.currency || info.currency || "USD";
  const currentPrice = priceSummary?.last_close ?? info.regularMarketPrice ?? info.currentPrice ?? null;
  const latestBalance = (annual.balance_sheet || [])[0]?.items || {};
  const derivedShares = forecast?.periods?.[0]?.shares ?? latestBalance.shares_issued ?? latest.shares ?? info.sharesOutstanding ?? 1;
  const derivedNetDebt = (latestBalance.total_debt ?? 0) - (latestBalance.cash ?? 0);
  const effectiveShares = safeNumber(sharesInput, derivedShares) || 1;
  const effectiveNetDebt = safeNumber(netDebtInput, derivedNetDebt);
  const isDemo = Boolean(company?.demo || normalized?.demo);
  const stale = Boolean(normalized?.data_quality?.stale);
  const enabledModels = models.filter((model) => model.enabled);
  const hasForecast = Boolean(forecast?.periods?.length);

  const chartData = useMemo(
    () =>
      [...metricsPeriods].reverse().map((period: any) => ({
        ...period,
        label: periodLabel(period.period_end),
      })),
    [metricsPeriods],
  );

  const priceData = useMemo(
    () =>
      priceHistory
        .filter((point: any) => isNum(point.close))
        .map((point: any) => ({ date: point.date, close: point.close })),
    [priceHistory],
  );

  async function runForecast() {
    setForecastLoading(true);
    setForecastError(null);
    const cleaned: Record<string, number> = {};
    Object.entries(assumptions).forEach(([key, value]) => {
      if (value === "" || value === null || value === undefined) return;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) cleaned[key] = parsed;
    });
    try {
      const result = await api(`/api/forecast/${encodedTicker}`, {
        method: "POST",
        body: JSON.stringify({ years: Number(years) || 5, assumptions: cleaned }),
      });
      setForecast(result);
    } catch (forecastFailure) {
      setForecastError(getErrorMessage(forecastFailure));
    } finally {
      setForecastLoading(false);
    }
  }

  async function applyWacc() {
    setWaccNote(null);
    try {
      const result = await api<{ wacc: number }>("/api/wacc", {
        method: "POST",
        body: JSON.stringify(waccInputs),
      });
      setWacc(result.wacc.toFixed(4));
      setWaccNote(`Applied WACC ${pct(result.wacc)}`);
    } catch (waccFailure) {
      setDcfError(getErrorMessage(waccFailure));
    }
  }

  async function runDcf(implied = false) {
    if (!hasForecast) {
      setDcfError("Run a forecast first to generate cash flows.");
      return;
    }
    setDcfLoading(true);
    setDcfError(null);
    const fcf = forecast.periods.map((period: any) => period.fcf);
    try {
      if (implied && !isNum(currentPrice)) {
        throw new Error("A current market price is required for reverse DCF.");
      }
      if (implied) {
        const result = await api("/api/valuation/reverse-dcf", {
          method: "POST",
          body: JSON.stringify({
            fcf,
            current_price: currentPrice,
            shares: effectiveShares,
            net_debt: effectiveNetDebt,
            terminal_growth: Number(terminalGrowth),
          }),
        });
        if (result.error) throw new Error(result.error);
        setReverse(result);
      } else {
        const payload: Record<string, unknown> = {
          fcf,
          wacc: Number(wacc),
          net_debt: effectiveNetDebt,
          shares: effectiveShares,
        };
        if (terminalMode === "growth") payload.terminal_growth = Number(terminalGrowth);
        else {
          payload.exit_multiple = Number(exitMultiple);
          payload.final_ebitda = forecast.periods[forecast.periods.length - 1]?.ebitda;
        }
        const result = await api("/api/valuation/dcf", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (result.error) throw new Error(result.error);
        setReverse(null);
        setDcf(result);
      }
    } catch (dcfFailure) {
      setDcfError(getErrorMessage(dcfFailure));
    } finally {
      setDcfLoading(false);
    }
  }

  async function runSensitivity() {
    if (!hasForecast) {
      setSensError("Run a forecast first to generate cash flows.");
      return;
    }
    setSensLoading(true);
    setSensError(null);
    const fcf = forecast.periods.map((period: any) => period.fcf);
    const baseWacc = Number(wacc);
    const baseGrowth = Number(terminalGrowth);
    const waccValues = [-0.02, -0.01, 0, 0.01, 0.02].map((offset) => Number((baseWacc + offset).toFixed(5)));
    const terminalValues =
      sensMode === "growth"
        ? [-0.01, -0.005, 0, 0.005, 0.01].map((offset) => Math.max(0, Number((baseGrowth + offset).toFixed(5))))
        : [6, 8, 10, 12, 14];
    try {
      const result = await api("/api/valuation/sensitivity", {
        method: "POST",
        body: JSON.stringify({
          fcf,
          shares: effectiveShares,
          net_debt: effectiveNetDebt,
          final_ebitda: forecast.periods[forecast.periods.length - 1]?.ebitda || 0,
          wacc_values: waccValues,
          terminal_values: terminalValues,
          mode: sensMode,
        }),
      });
      setSens(result);
    } catch (sensitivityFailure) {
      setSensError(getErrorMessage(sensitivityFailure));
    } finally {
      setSensLoading(false);
    }
  }

  async function runReport() {
    setReportLoading(true);
    setReportError(null);
    setTab("Report");
    try {
      const result = await api("/api/ai/research", {
        method: "POST",
        body: JSON.stringify({ ticker, model: modelName || undefined }),
      });
      setReport(result.report);
      setNotePayload(result.payload ?? null);
      setReportJob(result.job_id ?? null);
    } catch (reportFailure) {
      setReportError(getErrorMessage(reportFailure));
    } finally {
      setReportLoading(false);
    }
  }

  async function saveProject() {
    const payload = {
      name: `${ticker} research`,
      ticker,
      description: company?.name || undefined,
      data: {
        assumptions,
        years: Number(years) || 5,
        wacc: Number(wacc),
        terminal_mode: terminalMode,
        terminal_growth: Number(terminalGrowth),
        exit_multiple: Number(exitMultiple),
        forecast_summary: forecast?.summary || null,
      },
    };
    try {
      const result = activeProjectId
        ? await api(`/api/projects/${activeProjectId}`, { method: "PUT", body: JSON.stringify(payload) })
        : await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
      setActiveProjectId(result.id);
      setSavedMsg(activeProjectId ? "Project updated" : "Project saved");
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (saveFailure) {
      setSavedMsg(getErrorMessage(saveFailure));
    }
  }

  async function saveModel() {
    if (!forecast) return;
    try {
      await api("/api/projects/models/saved", {
        method: "POST",
        body: JSON.stringify({
          name: `${ticker} forecast ${new Date().toISOString().slice(0, 10)}`,
          kind: "three_statement",
          ticker,
          project_id: activeProjectId,
          assumptions: forecast.assumptions,
          results: { summary: forecast.summary, dcf },
        }),
      });
      setSavedMsg("Model saved to library");
      setTimeout(() => setSavedMsg(null), 3000);
    } catch (saveFailure) {
      setSavedMsg(getErrorMessage(saveFailure));
    }
  }

  async function exportFile(kind: "xlsx" | "pdf") {
    setExporting(kind);
    setExportError(null);
    try {
      const blob = await apiBlob(`/api/export/${kind}`, {
        ticker,
        title: `${ticker} — APEX Terminal Research Report`,
        forecast,
        dcf,
        sensitivity: sens,
        report,
        research_payload: notePayload,
        assumptions: forecast?.assumptions || assumptions,
        data_quality: normalized?.data_quality,
        company: company || undefined,
        actuals: metricsPeriods[0] || undefined,
        price_summary: priceSummary || undefined,
      });
      downloadBlob(blob, kind === "xlsx" ? `apex_${ticker}_model.xlsx` : `apex_${ticker}_report.pdf`);
    } catch (exportFailure) {
      setExportError(getErrorMessage(exportFailure));
    } finally {
      setExporting(null);
    }
  }

  if (loading) {
    return (
      <div className="p-5 md:p-7 max-w-7xl mx-auto space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-20 rounded-lg" />
        <div className="grid md:grid-cols-3 gap-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {[0, 1].map((item) => (
            <Skeleton key={item} className="h-56 rounded-lg" />
          ))}
        </div>
        <Spinner label={`Loading ${ticker}`} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-3">
        <ErrorBanner message={error} onRetry={() => loadData(true)} />
        <div className="text-xs text-muted">
          Try <Link href="/company/SAMPLE" className="text-accent">the sample company</Link> to explore a fully populated fixture.
        </div>
      </div>
    );
  }

  const changePct = priceSummary?.change_pct;
  const upsides = dcf?.value_per_share && isNum(currentPrice) ? dcf.value_per_share / currentPrice - 1 : null;

  return (
    <div className="max-w-7xl mx-auto">
      <header className="px-5 md:px-7 pt-5 pb-4 border-b border-border">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              aria-hidden
              className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-panel mono text-sm font-bold text-accent"
            >
              {ticker.slice(0, 4)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <h1 className="text-lg md:text-xl font-semibold tracking-tight truncate">
                  {company?.name || info.longName || ticker}
                </h1>
                <span className="mono text-xs font-semibold text-accent border border-accent/40 bg-accent/10 rounded px-1.5 py-0.5 shrink-0">
                  {ticker}
                </span>
                {isDemo ? <Badge tone="warn">Synthetic data</Badge> : null}
                {stale ? <Badge tone="warn">Stale cache</Badge> : null}
              </div>
              <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                <span>{company?.exchange || info.exchange || "—"}</span>
                <span aria-hidden>·</span>
                <span>{company?.sector || info.sector || "—"}</span>
                <span aria-hidden>·</span>
                <span>Reporting currency {currency}</span>
                {company?.last_data_date ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>Data through {company.last_data_date}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isNum(currentPrice) ? (
              <div className="text-right mr-2">
                <div className="text-lg font-semibold tabular">{num(currentPrice)}</div>
                <div className={`text-[11px] tabular ${tone(changePct)}`}>
                  {isNum(changePct) ? pct(changePct) : "—"} today
                </div>
              </div>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadData(true)}
              title={isDemo ? "Recompute every figure from the local engine" : "Re-fetch market data from the provider, bypassing the cache"}
            >
              <RefreshCw size={13} /> Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={saveProject}>
              <Save size={13} /> {activeProjectId ? "Update project" : "Save project"}
            </Button>
            <Button
              size="sm"
              onClick={runReport}
              disabled={reportLoading || enabledModels.length === 0}
              title={enabledModels.length === 0 ? "Configure an AI model first" : "Generate a research draft"}
            >
              {reportLoading ? <Spinner label="Writing" /> : <><Sparkles size={13} /> Research note</>}
            </Button>
          </div>
        </div>
      </header>

      <div className="px-5 md:px-7 pb-6">
        {savedMsg ? <div className="mt-4"><InfoBanner>{savedMsg}</InfoBanner></div> : null}
        {isDemo ? (
          <div className="mt-4">
            <InfoBanner>
              Synthetic sample fixture. Figures are fabricated for product evaluation and are not a real company.
            </InfoBanner>
          </div>
        ) : null}
        {stale ? (
          <div className="mt-4">
            <InfoBanner>
              Some periods are incomplete for this ticker. Check the data-quality panel before relying on it.
            </InfoBanner>
          </div>
        ) : null}
        {exportError ? <div className="mt-4"><ErrorBanner message={exportError} /></div> : null}

        <div className="sticky top-0 z-20 -mx-5 px-5 md:-mx-7 md:px-7 mt-4 py-1 bg-bg/95 backdrop-blur-sm border-b border-border">
          <Tabs idBase="company-tabs" tabs={TABS} value={tab} onChange={setTab} className="border-b-0" />
        </div>

        <TabPanel idBase="company-tabs" active={tab} className="pt-4">

      {tab === "Overview" ? (
        <div className="space-y-4">
          <section aria-label="Primary metrics">
            <div className="text-[10px] uppercase tracking-[0.16em] text-dim font-medium mb-2">Headline · latest reported period {periodLabel(latest.period_end)}</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Market cap" value={fmt(company?.market_cap || info.marketCap)} hint={currency} />
              <Stat label="Revenue" value={fmt(latest.revenue)} hint={periodLabel(latest.period_end)} />
              <Stat label="Net margin" value={pct(latest.net_margin)} hint="Latest reported" />
              <Stat label="Free cash flow" value={fmt(latest.fcf)} hint={periodLabel(latest.period_end)} />
            </div>
          </section>

          {(() => {
            const SECONDARY = [
              { key: "roe", label: "ROE" },
              { key: "roa", label: "ROA" },
              { key: "roic", label: "ROIC" },
              { key: "eps_diluted", label: "EPS diluted" },
              { key: "revenue_growth", label: "Revenue growth" },
              { key: "current_ratio", label: "Current ratio" },
              { key: "net_debt", label: "Net debt" },
              { key: "book_value_per_share", label: "Book value / share" },
            ].filter((metric) => isNum(latest[metric.key]));
            if (!SECONDARY.length) return null;
            return (
              <section aria-label="Secondary metrics">
                <div className="text-[10px] uppercase tracking-[0.16em] text-dim font-medium mb-2">Returns, leverage and per-share · derived from reported statements</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {SECONDARY.map((metric) => (
                    <Stat
                      key={metric.key}
                      compact
                      label={metric.label}
                      value={fmtMetric(metric.key, latest[metric.key])}
                      tone={metric.key === "net_debt" && isNum(latest.net_debt) && latest.net_debt < 0 ? "text-pos" : undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })()}

          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Price history"
                subtitle={priceData.length ? `${priceData.length} sessions · ${periodLabel(priceData[0]?.date)} to ${periodLabel(priceData[priceData.length - 1]?.date)}` : "No market data"}
                action={
                  priceSummary ? (
                    <span className="text-[11px] text-muted">
                      52w {fmt(priceSummary.low_52w)} – {fmt(priceSummary.high_52w)}
                    </span>
                  ) : null
                }
              />
              <div className="h-64 p-2">
                <PriceChart data={priceData} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Data quality" subtitle="What came back from the provider" />
              <div className="p-4 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Retrieved</span>
                  <span className="text-right">{localDate(company?.retrieved_at || normalized?.retrieved_at)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Last period</span>
                  <span>{company?.last_data_date || latest.period_end || "—"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Annual periods</span>
                  <span>{annual.income_statement?.length || 0}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Quarterly periods</span>
                  <span>{quarterly.income_statement?.length || 0}</span>
                </div>
                <div className="border-t border-border pt-2 space-y-1.5">
                  {(company?.data_quality?.alerts || []).length === 0 ? (
                    <div className="text-muted">No data-quality alerts.</div>
                  ) : (
                    company.data_quality.alerts.map((alert: any, index: number) => (
                      <div key={index} className={alert.level === "warning" ? "text-warn" : "text-muted"}>
                        • {alert.message}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Revenue, net income and FCF" subtitle="Annual reported history" />
              <div className="h-64 p-2">
                <RevenueChart data={chartData} unit={currency} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Margin history" subtitle="Gross, operating and net margins" />
              <div className="h-64 p-2">
                <MarginChart data={chartData} />
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="text-sm font-medium mb-2">Business summary</div>
            <p className="text-sm text-muted leading-relaxed">
              {info.longBusinessSummary || company?.summary || "No description was provided by the data source."}
            </p>
          </Card>
        </div>
      ) : null}

      {tab === "Business" ? (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="p-4 lg:col-span-2">
            <div className="text-sm font-medium mb-2">Company profile</div>
            <p className="text-sm text-muted leading-relaxed">
              {info.longBusinessSummary || company?.summary || "No description available."}
            </p>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Key facts</div>
            <dl className="space-y-2 text-xs">
              {[
                ["Sector", company?.sector || info.sector],
                ["Industry", company?.industry || info.industry],
                ["Country", company?.country || info.country],
                ["Exchange", company?.exchange || info.exchange],
                ["Currency", currency],
                ["Website", company?.website || info.website],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right break-all">
                    {label === "Website" && value ? (
                      <a href={String(value)} target="_blank" rel="noreferrer" className="text-accent">
                        {String(value)}
                      </a>
                    ) : (
                      String(value || "—")
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      ) : null}

      {tab === "Statements" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex border border-border rounded-md overflow-hidden">
              {(["annual", "quarterly"] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setPeriodicity(option)}
                  className={`px-3 py-1.5 text-xs ${periodicity === option ? "btn-accent" : "text-muted hover:bg-panel"}`}
                >
                  {option === "annual" ? "Annual" : "Quarterly"}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-muted">Values in {currency}. Missing cells are shown as —.</span>
          </div>
          {STATEMENTS.map((statement) => (
            <Card key={statement.key}>
              <CardHeader
                title={statement.label}
                subtitle={`${(statementSet[statement.key] || []).length} periods available · latest first`}
                action={<Badge tone="muted">Reported</Badge>}
              />
              <StatementTable rows={statementSet[statement.key] || []} label={statement.label} currency={currency} />
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "History" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Operating history" subtitle="Reported metrics, most recent first · scroll for older periods" />
            <TableWrap className="max-h-[520px]">
              <table className="w-full min-w-[560px] text-xs">
                <caption className="sr-only">Reported metrics by reporting period, most recent first</caption>
                <thead>
                  <tr className="sticky top-0 z-10">
                    <th className="text-left px-3 py-2 sticky left-0 top-0 z-20 bg-surface border-b border-border">Metric</th>
                    {metricsPeriods.map((period: any) => (
                      <th key={period.period_end} className="text-right px-3 py-2 whitespace-nowrap bg-surface border-b border-border tabular">
                        {periodLabel(period.period_end)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_KEYS.map((key) => (
                    <tr key={key} className="border-b border-border/70 hover:bg-panel/40">
                      <td className="px-3 py-1.5 sticky left-0 bg-surface z-10 text-muted whitespace-nowrap">{humanize(key)}</td>
                      {metricsPeriods.map((period: any) => (
                        <td key={period.period_end} className="text-right px-3 py-1.5 tabular whitespace-nowrap">
                          {fmtMetric(key, period[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Margin trend" subtitle="Gross, operating and net margins" />
            <div className="h-64 p-2">
              <MarginChart data={chartData} />
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "Forecast" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Three-statement forecast"
              subtitle="Driver-based annual model with a cash revolver and a reported balance check."
              action={<Badge tone="accent">Inputs</Badge>}
            />
            <div className="p-4 space-y-4">
              {forecastError ? <ErrorBanner message={forecastError} /> : null}
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-muted" htmlFor="forecast-years">Years</label>
                <input
                  id="forecast-years"
                  type="number"
                  min={1}
                  max={25}
                  value={years}
                  onChange={(event) => setYears(event.target.value)}
                  className="w-16 bg-panel border border-border rounded-md px-2 py-1.5 text-xs focus:border-accent outline-none"
                />
                <Button size="sm" onClick={runForecast}>Run forecast</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAssumptions({});
                    setYears("5");
                  }}
                >
                  Reset
                </Button>
              </div>
              {[
                {
                  title: "Growth and profitability",
                  keys: ["revenue_growth", "gross_margin", "opex_ratio", "tax_rate"],
                },
                {
                  title: "Cash flow drivers",
                  keys: ["da_pct", "capex_pct", "nwc_pct", "interest_rate"],
                },
                {
                  title: "Capital returns and shares",
                  keys: ["dividend_payout", "excess_cash_sweep", "share_dilution"],
                },
              ].map((group) => (
                <fieldset key={group.title} className="min-w-0">
                  <legend className="text-[10px] uppercase tracking-[0.16em] text-dim font-medium mb-1.5 px-0">{group.title}</legend>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {group.keys.map((key) => {
                      const field = ASSUMPTION_FIELDS.find((item) => item.key === key);
                      if (!field) return null;
                      return (
                        <Field
                          key={field.key}
                          label={field.label}
                          step={field.step}
                          value={assumptions[field.key] ?? ""}
                          placeholder={String(forecast?.assumptions?.[field.key] ?? "default")}
                          onChange={(value) =>
                            setAssumptions((current) => ({ ...current, [field.key]: value === "" ? "" : value }))
                          }
                        />
                      );
                    })}
                  </div>
                </fieldset>
              ))}
              <div className="text-[11px] text-muted">
                Blank fields use the base-year value inferred from the latest statements. Percentages are decimals (0.05 = 5%).
              </div>
            </div>
          </Card>

          {forecastLoading ? <Spinner label="Building forecast" /> : null}

          {hasForecast ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label={`Revenue Y${forecast.periods.length}`} value={fmt(forecast.summary?.final_revenue)} hint={`CAGR ${pct(forecast.summary?.revenue_cagr)}`} />
                <Stat label={`EBITDA Y${forecast.periods.length}`} value={fmt(forecast.summary?.final_ebitda)} />
                <Stat label={`FCF Y${forecast.periods.length}`} value={fmt(forecast.summary?.final_fcf)} />
                <Stat
                  label="Balance check"
                  value={forecast.summary?.balance_ok ? "Balanced" : "Mismatch"}
                  tone={forecast.summary?.balance_ok ? "text-pos" : "text-warn"}
                  hint={`Max diff ${fmt(forecast.summary?.max_balance_check)}`}
                />
              </div>

              <Card>
                <CardHeader
                  title="Forecast summary"
                  subtitle="Revenue, EBITDA and free cash flow"
                  action={
                    <div className="flex items-center gap-2">
                      <Badge tone="muted">Calculated</Badge>
                      <Button variant="secondary" size="sm" onClick={saveModel}>
                        <Save size={13} /> Save model
                      </Button>
                    </div>
                  }
                />
                <div className="h-64 p-2">
                  <ForecastChart data={forecast.periods} unit={currency} />
                </div>
              </Card>

              <Card>
                <CardHeader title="Projected statements" subtitle="Selected lines; the full model is in the Excel export" />
                <TableWrap className="max-h-[520px]">
                  <table className="w-full min-w-[520px] text-xs">
                    <caption className="sr-only">Projected financial lines by forecast year</caption>
                    <thead>
                      <tr className="sticky top-0 z-10">
                        <th className="text-left px-3 py-2 sticky left-0 top-0 z-20 bg-surface border-b border-border">Line</th>
                        {forecast.periods.map((period: any) => (
                          <th key={period.year} className="text-right px-3 py-2 bg-surface border-b border-border tabular">Y{period.year}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {["revenue", "gross_profit", "ebitda", "ebit", "net_income", "ocf", "fcf", "capex", "cash", "debt", "equity", "eps", "balance_check"].map((key) => (
                        <tr key={key} className="border-b border-border/70 hover:bg-panel/40">
                          <td className="px-3 py-1.5 sticky left-0 bg-surface z-10 text-muted">{humanize(key)}</td>
                          {forecast.periods.map((period: any) => (
                            <td key={period.year} className="text-right px-3 py-1.5 tabular whitespace-nowrap">
                              {fmt(period[key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </Card>
            </>
          ) : !forecastLoading ? (
            <EmptyState title="No forecast yet" body="Run the model to project the three statements." />
          ) : null}
        </div>
      ) : null}

      {tab === "Valuation" ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader title="DCF assumptions" subtitle="Discount the forecast free cash flow to equity value." action={<Badge tone="accent">Inputs</Badge>} />
              <div className="p-4 grid md:grid-cols-2 gap-3">
                {dcfError ? <div className="md:col-span-2"><ErrorBanner message={dcfError} /></div> : null}
                <Field label="WACC" value={wacc} step="0.001" onChange={setWacc} hint={waccNote || "Decimal, e.g. 0.10"} />
                <Field label="Terminal growth" value={terminalGrowth} step="0.001" onChange={setTerminalGrowth} />
                <Select
                  label="Terminal value method"
                  value={terminalMode}
                  onChange={setTerminalMode}
                  options={[
                    { value: "growth", label: "Perpetuity growth" },
                    { value: "multiple", label: "Exit multiple" },
                  ]}
                />
                {terminalMode === "multiple" ? (
                  <Field label="Exit multiple (EV / EBITDA)" value={exitMultiple} step="0.5" onChange={setExitMultiple} />
                ) : null}
                <Field label="Shares outstanding" value={sharesInput} placeholder={String(Math.round(derivedShares))} onChange={setSharesInput} />
                <Field label="Net debt (debt − cash)" value={netDebtInput} placeholder={String(Math.round(derivedNetDebt))} onChange={setNetDebtInput} />
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => runDcf(false)} disabled={dcfLoading}>Run DCF</Button>
                  <Button variant="secondary" size="sm" onClick={() => runDcf(true)} disabled={dcfLoading || !hasForecast}>
                    Implied WACC at market price
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => exportFile("xlsx")} disabled={exporting !== null}>
                    <Download size={13} /> {exporting === "xlsx" ? "Exporting..." : "Excel"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => exportFile("pdf")} disabled={exporting !== null}>
                    <FileText size={13} /> {exporting === "pdf" ? "Exporting..." : "PDF"}
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="WACC calculator" subtitle="CAPM cost of equity plus after-tax debt" />
              <div className="p-4 grid grid-cols-2 gap-2">
                {[
                  ["risk_free", "Risk-free rate"],
                  ["beta", "Beta"],
                  ["market_premium", "Market premium"],
                  ["cost_of_debt", "Cost of debt"],
                  ["tax_rate", "Tax rate"],
                  ["equity_weight", "Equity weight"],
                  ["debt_weight", "Debt weight"],
                ].map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    step="0.001"
                    value={waccInputs[key] ?? ""}
                    onChange={(value) => setWaccInputs((current) => ({ ...current, [key]: value }))}
                  />
                ))}
                <div className="col-span-2">
                  <button onClick={applyWacc} className="w-full border border-border px-3 py-1.5 rounded-md text-xs hover:bg-panel">
                    Apply WACC
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {dcf && !dcf.error ? (
            <Card>
              <CardHeader title="Valuation bridge" subtitle={`Perpetuity growth ${pct(dcf.terminal_growth)}`} action={<Badge tone="muted">Calculated</Badge>} />
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="PV of cash flows" value={fmt(dcf.pv_cash_flows)} />
                <Stat label="PV of terminal value" value={fmt(dcf.pv_terminal_value)} />
                <Stat label="Enterprise value" value={fmt(dcf.enterprise_value)} />
                <Stat label="Equity value" value={fmt(dcf.equity_value)} />
                <Stat label="Value per share" value={num(dcf.value_per_share)} tone="text-accent" />
                <Stat label="Market price" value={num(currentPrice)} />
                <Stat label="Upside" value={isNum(upsides) ? pct(upsides) : "—"} tone={tone(upsides)} />
                <Stat label="Net debt" value={fmt(dcf.net_debt)} />
              </div>
              {dcf.warnings?.length ? (
                <div className="mx-4 mb-4">
                  <WarnBanner>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {dcf.warnings.map((warning: string, index: number) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </WarnBanner>
                </div>
              ) : null}
              <div className="px-4 pb-4 text-[11px] text-muted">
                WACC {pct(dcf.wacc)} · {dcf.cash_flow_count} forecast years · {terminalMode === "multiple" ? `exit multiple ${exitMultiple}x` : "perpetuity growth"}.
              </div>
            </Card>
          ) : null}

          {reverse ? (
            <Card>
              <CardHeader title="Reverse DCF" subtitle="The discount rate implied by today's share price." action={<Badge tone="muted">Calculated</Badge>} />
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="Implied WACC" value={pct(reverse.implied_wacc, 2)} tone="text-accent" />
                <Stat label="Current price" value={num(reverse.current_price)} />
                <Stat label="Terminal growth" value={pct(reverse.terminal_growth)} />
              </div>
              <div className="px-4 pb-4 text-[11px] text-muted">
                A higher implied WACC means the market is pricing more risk or lower growth than the model.
              </div>
            </Card>
          ) : null}

          {!hasForecast ? (
            <InfoBanner>Run the forecast first — the DCF consumes the projected free cash flows.</InfoBanner>
          ) : null}
        </div>
      ) : null}

      {tab === "Sensitivity" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Two-way sensitivity"
              subtitle="Share value across WACC and terminal assumptions"
              action={
                <div className="flex items-center gap-2">
                  <select
                    value={sensMode}
                    onChange={(event) => setSensMode(event.target.value)}
                    aria-label="Terminal assumption axis"
                    className="bg-panel border border-border rounded-md px-2 py-1.5 text-xs focus:border-accent outline-none"
                  >
                    <option value="growth">Terminal growth</option>
                    <option value="multiple">Exit multiple</option>
                  </select>
                  <Button size="sm" onClick={runSensitivity} disabled={sensLoading}>Run</Button>
                </div>
              }
            />
            <div className="p-4 space-y-3">
              {sensError ? <ErrorBanner message={sensError} /> : null}
              {sens ? (
                <TableWrap className="max-h-[520px]">
                  <table className="w-full min-w-[520px] text-xs">
                    <caption className="sr-only">Share value across WACC and terminal assumptions {currentPrice ? `against the current price ${num(currentPrice)}` : ""}</caption>
                    <thead>
                      <tr className="sticky top-0 z-10">
                        <th scope="col" className="text-left px-3 py-2 bg-surface border-b border-border whitespace-nowrap sticky left-0 top-0 z-20">
                          WACC \ {sensMode === "growth" ? "growth" : "multiple"}
                        </th>
                        {(sens.terminal_values || []).map((value: number) => (
                          <th key={value} scope="col" className="text-right px-3 py-2 bg-surface border-b border-border tabular whitespace-nowrap">
                            {sensMode === "growth" ? pct(value) : `${value.toFixed(1)}x`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(sens.wacc_values || []).map((waccValue: number, rowIndex: number) => (
                        <tr key={waccValue} className="border-b border-border/70 hover:bg-panel/30">
                          <th scope="row" className="text-left px-3 py-1.5 text-muted font-normal tabular whitespace-nowrap sticky left-0 bg-surface">
                            {pct(waccValue)}
                          </th>
                          {(sens.table[rowIndex] || []).map((value: any, columnIndex: number) => {
                            const above = isNum(value) && isNum(currentPrice) ? value >= currentPrice : null;
                            const spread = above !== null ? Math.abs(value / currentPrice - 1) : null;
                            const tint =
                              above !== null && spread !== null
                                ? `color-mix(in srgb, ${above ? "var(--pos)" : "var(--neg)"} ${Math.round(6 + Math.min(1, spread) * 26)}%, transparent)`
                                : undefined;
                            return (
                              <td
                                key={columnIndex}
                                style={{ background: tint }}
                                className={`text-right px-3 py-1.5 tabular whitespace-nowrap ${above === null ? "" : above ? "text-pos" : "text-neg"}`}
                              >
                                {above !== null ? (
                                  <>
                                    <span aria-hidden className="mr-1 text-[9px] align-[1px]">{above ? "▲" : "▼"}</span>
                                    <span className="sr-only">{above ? "above" : "below"} current price: </span>
                                  </>
                                ) : null}
                                {fmt(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <EmptyState title="No sensitivity table yet" body="Run the table to test how the share value responds to discount rate and terminal assumptions." />
              )}
              <div className="text-[11px] text-muted">
                ▲ above the current share price · ▼ below · deeper tint = larger spread.
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "Risks" ? (
        <div className="space-y-4">
          {report ? (
            <div className="grid lg:grid-cols-2 gap-4">
              <ReportBlock section="Risks" content={report.risks} />
              <ReportBlock section="Catalysts" content={report.catalysts} />
              <ReportBlock section="Strengths" content={report.strengths} />
              <ReportBlock section="Valuation view" content={report.valuation_view} />
            </div>
          ) : (
            <Card>
              <EmptyState
                title="Risks are generated from verified data"
                body="Generate the AI research note to see the risk, catalyst and strength sections. The underlying numbers still come from the deterministic engine."
                action={
                  <Button size="sm" onClick={runReport} disabled={reportLoading || enabledModels.length === 0}>
                    {reportLoading ? <Spinner label="Writing" /> : <><Sparkles size={13} /> Generate report</>}
                  </Button>
                }
              />
              {enabledModels.length === 0 ? (
                <div className="px-4 pb-4 text-center text-xs text-muted">
                  No AI model configured. <Link href="/ai" className="text-accent">Add one in the AI Control Center</Link>.
                </div>
              ) : null}
            </Card>
          )}
        </div>
      ) : null}

      {tab === "Report" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="AI research note"
              subtitle="Grounded in the verified metrics below the narrative."
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={modelName}
                    onChange={(event) => setModelName(event.target.value)}
                    aria-label="AI model"
                    className="bg-panel border border-border rounded-md px-2 py-1.5 text-xs max-w-56 focus:border-accent outline-none"
                  >
                    <option value="">Default model</option>
                    {enabledModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name} ({model.provider})
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={runReport} disabled={reportLoading || enabledModels.length === 0}>
                    {reportLoading ? "Generating..." : "Generate"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => exportFile("pdf")} disabled={exporting !== null}>
                    Export PDF
                  </Button>
                  <Link
                    href={`/research?ticker=${encodeURIComponent(ticker)}`}
                    className="border border-accent/50 text-accent px-3 py-1.5 rounded-md text-xs hover:bg-accent/10 inline-flex items-center"
                    title="Open the full institutional research studio versioned generator"
                  >
                    Research Studio
                  </Link>
                </div>
              }
            />
            <div className="p-4">
              {reportError ? <ErrorBanner message={reportError} /> : null}
              {reportLoading ? <Spinner label="Drafting research note" /> : null}
              {!report && !reportLoading ? (
                <EmptyState
                  title="No report yet"
                  body={enabledModels.length ? "Generate a research draft when you are ready." : "Configure an AI provider to generate research drafts."}
                  action={
                    enabledModels.length ? null : (
                      <Link href="/ai" className="btn-accent px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center">
                        Configure AI
                      </Link>
                    )
                  }
                />
              ) : null}
            </div>
          </Card>
          {report ? (
            <div className="space-y-3">
              {DCF_SECTION_ORDER.filter((section) => report[section] !== undefined).map((section) => (
                <ReportBlock key={section} section={section} content={report[section]} />
              ))}
              {Object.entries(report)
                .filter(([section]) => !DCF_SECTION_ORDER.includes(section))
                .map(([section, content]) => (
                  <ReportBlock key={section} section={section} content={content} />
                ))}
              <div className="text-[11px] text-muted">
                {reportJob ? `Research job #${reportJob} · ` : ""}AI-assisted narrative only. Verify all figures before use.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "Sources" ? (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Data provenance</div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-muted">Fundamentals</dt><dd>{company?.provider ? `${company.provider} snapshot` : "Local engine (in-browser)"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Retrieved</dt><dd>{localDate(company?.retrieved_at || normalized?.retrieved_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Latest period</dt><dd>{company?.last_data_date || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Coverage</dt><dd>{stale ? "Partial" : isDemo ? "Complete fixture" : "Provider snapshot"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Price sessions</dt><dd>{priceHistory.length}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Synthetic data</dt><dd>{isDemo ? "Yes — synthetic fixture" : "No — provider-sourced"}</dd></div>
            </dl>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Data-quality alerts</div>
            {(company?.data_quality?.alerts || []).length ? (
              <ul className="space-y-1.5 text-xs">
                {company.data_quality.alerts.map((alert: any, index: number) => (
                  <li key={index} className={alert.level === "warning" ? "text-warn" : "text-muted"}>
                    • {alert.message}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-muted">No alerts.</div>
            )}
          </Card>
          <Card className="p-4 lg:col-span-2">
            <div className="text-sm font-medium mb-2">How to read this workspace</div>
            <ul className="text-xs text-muted space-y-1.5 list-disc pl-5">
              <li>Historical statements are immutable inputs; forecasts are separate assumptions and never overwrite history.</li>
              <li>Missing values render as “—”; they are not silently converted to zero.</li>
              <li>Forecast balance checks are reported after a revolver draw, so a mismatch is visible rather than buried.</li>
              <li>AI writes narrative only. It cannot change the deterministic numbers in the model.</li>
              <li>This is research software, not investment advice.</li>
            </ul>
          </Card>
        </div>
      ) : null}
        </TabPanel>
      </div>
    </div>
  );
}
