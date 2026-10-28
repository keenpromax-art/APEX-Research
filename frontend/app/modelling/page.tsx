"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen, Calculator, Save, Sparkles } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { fmt, isNum, num, pct, tone } from "@/lib/format";
import { suggestModelInputs, type SuggestTab } from "@/lib/suggest";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, InfoBanner, Select, Spinner, Stat, TabPanel, TableWrap, Tabs, WarnBanner } from "@/components/ui";
import { cn } from "@/lib/cn";

function InputGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="text-[10px] uppercase tracking-[0.16em] text-dim font-medium mb-1.5 px-0">{title}</legend>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </fieldset>
  );
}

const TABS = ["LBO", "Options", "Bond", "WACC"] as const;

const LBO_DEFAULTS: Record<string, string> = {
  entry_ebitda: "100",
  entry_multiple: "8",
  exit_multiple: "9",
  hold_years: "5",
  revenue_growth: "0.05",
  tax_rate: "0.25",
  interest_rate: "0.07",
  debt_paydown_pct: "0.5",
  fees_pct: "0.02",
};

const OPTION_DEFAULTS: Record<string, string> = {
  S: "100",
  K: "100",
  T: "1",
  r: "0.05",
  sigma: "0.2",
  q: "0",
  option_type: "call",
};

const BOND_DEFAULTS: Record<string, string> = {
  face: "1000",
  coupon_rate: "0.05",
  ytm: "0.06",
  years: "10",
  freq: "2",
};

const WACC_DEFAULTS: Record<string, string> = {
  risk_free: "0.04",
  beta: "1.0",
  market_premium: "0.055",
  cost_of_debt: "0.06",
  tax_rate: "0.25",
  equity_weight: "0.7",
  debt_weight: "0.3",
};

function numberFrom(state: Record<string, string>, key: string, fallback: number) {
  const parsed = Number(state[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function lboPayload(state: Record<string, string>) {
  return {
    entry_ebitda: numberFrom(state, "entry_ebitda", 100),
    entry_multiple: numberFrom(state, "entry_multiple", 8),
    exit_multiple: numberFrom(state, "exit_multiple", 9),
    hold_years: numberFrom(state, "hold_years", 5),
    revenue_growth: numberFrom(state, "revenue_growth", 0.05),
    tax_rate: numberFrom(state, "tax_rate", 0.25),
    interest_rate: numberFrom(state, "interest_rate", 0.07),
    debt_paydown_pct: numberFrom(state, "debt_paydown_pct", 0.5),
    fees_pct: numberFrom(state, "fees_pct", 0.02),
  };
}

function optionPayload(state: Record<string, string>) {
  return {
    S: numberFrom(state, "S", 100),
    K: numberFrom(state, "K", 100),
    T: numberFrom(state, "T", 1),
    r: numberFrom(state, "r", 0.05),
    sigma: numberFrom(state, "sigma", 0.2),
    q: numberFrom(state, "q", 0),
    option_type: state.option_type === "put" ? "put" : "call",
  };
}

function bondPayload(state: Record<string, string>) {
  return {
    face: numberFrom(state, "face", 1000),
    coupon_rate: numberFrom(state, "coupon_rate", 0.05),
    ytm: numberFrom(state, "ytm", 0.05),
    years: numberFrom(state, "years", 10),
    freq: Math.max(1, Math.round(numberFrom(state, "freq", 2))),
  };
}

function waccPayload(state: Record<string, string>) {
  return {
    risk_free: numberFrom(state, "risk_free", 0.04),
    beta: numberFrom(state, "beta", 1),
    market_premium: numberFrom(state, "market_premium", 0.055),
    cost_of_debt: numberFrom(state, "cost_of_debt", 0.06),
    tax_rate: numberFrom(state, "tax_rate", 0.25),
    equity_weight: numberFrom(state, "equity_weight", 0.7),
    debt_weight: numberFrom(state, "debt_weight", 0.3),
  };
}

function stringify(values: Record<string, unknown>, defaults: Record<string, string>) {
  const next = { ...defaults };
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    next[key] = String(value);
  });
  return next;
}

function tabForKind(kind: string): (typeof TABS)[number] {
  const normalized = (kind || "").toLowerCase();
  if (normalized.startsWith("opt")) return "Options";
  if (normalized.startsWith("bond")) return "Bond";
  if (normalized.startsWith("wacc")) return "WACC";
  return "LBO";
}

function kindForTab(tab: string) {
  if (tab === "Options") return "option";
  if (tab === "Bond") return "bond";
  if (tab === "WACC") return "wacc";
  return "lbo";
}

export default function ModellingPage() {
  const searchParams = useSearchParams();
  const requestedModel = searchParams.get("model");

  const [tab, setTab] = useState<string>("LBO");
  const [lboIn, setLboIn] = useState<Record<string, string>>(LBO_DEFAULTS);
  const [optionIn, setOptionIn] = useState<Record<string, string>>(OPTION_DEFAULTS);
  const [bondIn, setBondIn] = useState<Record<string, string>>(BOND_DEFAULTS);
  const [waccIn, setWaccIn] = useState<Record<string, string>>(WACC_DEFAULTS);

  const [lboResult, setLboResult] = useState<any>(null);
  const [optionResult, setOptionResult] = useState<any>(null);
  const [bondResult, setBondResult] = useState<any>(null);
  const [waccResult, setWaccResult] = useState<any>(null);

  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const [importTicker, setImportTicker] = useState("");
  const [importing, setImporting] = useState(false);

  const [models, setModels] = useState<any[]>([]);
  const [aiModel, setAiModel] = useState("");
  const [suggesting, setSuggesting] = useState<SuggestTab | null>(null);

  useEffect(() => {
    api<any[]>("/api/ai/models").then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(() => {
    if (!requestedModel) return;
    let active = true;
    api(`/api/projects/models/saved/${encodeURIComponent(requestedModel)}`)
      .then((row) => {
        if (!active) return;
        const target = tabForKind(row.kind);
        setTab(target);
        if (target === "LBO") setLboIn(stringify(row.assumptions, LBO_DEFAULTS));
        if (target === "Options") setOptionIn(stringify(row.assumptions, OPTION_DEFAULTS));
        if (target === "Bond") setBondIn(stringify(row.assumptions, BOND_DEFAULTS));
        if (target === "WACC") setWaccIn(stringify(row.assumptions, WACC_DEFAULTS));
        if (target === "LBO") setLboResult(row.results || null);
        if (target === "Options") setOptionResult(row.results || null);
        if (target === "Bond") setBondResult(row.results || null);
        if (target === "WACC") setWaccResult(row.results || null);
        setModelLabel(row.name || "");
        setNotice(`Loaded “${row.name}” from the library.`);
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [requestedModel]);

  async function runTab(target: string) {
    setRunning(target);
    setError(null);
    try {
      if (target === "LBO") {
        const result = await api("/api/advanced/lbo", { method: "POST", body: JSON.stringify(lboPayload(lboIn)) });
        setLboResult(result);
      } else if (target === "Options") {
        const result = await api("/api/advanced/option", { method: "POST", body: JSON.stringify(optionPayload(optionIn)) });
        setOptionResult(result);
      } else if (target === "Bond") {
        const result = await api("/api/advanced/bond", { method: "POST", body: JSON.stringify(bondPayload(bondIn)) });
        setBondResult(result);
      } else {
        const result = await api("/api/wacc", { method: "POST", body: JSON.stringify(waccPayload(waccIn)) });
        setWaccResult(result);
      }
    } catch (runError) {
      setError(getErrorMessage(runError));
    } finally {
      setRunning(null);
    }
  }

  async function importFromCompany() {
    const ticker = importTicker.trim().toUpperCase();
    if (!ticker) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const forecast = await api("/api/forecast/" + encodeURIComponent(ticker), {
        method: "POST",
        body: JSON.stringify({ years: 1, assumptions: {} }),
      });
      const ebitda = forecast?.periods?.[0]?.ebitda;
      if (!isNum(ebitda)) throw new Error("The company forecast did not return an EBITDA figure.");
      const growth = forecast?.assumptions?.revenue_growth;
      setLboIn((current) => ({
        ...current,
        entry_ebitda: String(Math.round(ebitda)),
        revenue_growth: isNum(growth) ? growth.toFixed(4) : current.revenue_growth,
      }));
      setNotice(`Imported ${ticker} year-1 EBITDA (${fmt(ebitda)}) into the LBO.`);
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setImporting(false);
    }
  }

  const enabledModels = models.filter((model) => model.enabled);
  const usableModels = enabledModels.filter((model) => model.api_key);
  const selectedModel = aiModel ? models.find((model) => model.name === aiModel) : usableModels[0];
  const hasAI = Boolean(selectedModel?.api_key);

  async function suggestTab(target: SuggestTab) {
    if (!selectedModel?.api_key) return;
    setSuggesting(target);
    setError(null);
    setNotice(null);
    try {
      const ticker = importTicker.trim().toUpperCase();
      let company: Record<string, unknown> | null = null;
      if (ticker) {
        const [forecast, market] = await Promise.all([
          api<any>("/api/forecast/" + encodeURIComponent(ticker), {
            method: "POST",
            body: JSON.stringify({ years: 1, assumptions: {} }),
          }).catch(() => null),
          api<any>("/api/market/" + encodeURIComponent(ticker)).catch(() => null),
        ]);
        company = {
          ticker,
          price: market?.price ?? market?.current_price ?? null,
          market_cap: market?.market_cap ?? null,
          beta: market?.beta ?? null,
          currency: market?.currency ?? null,
          revenue: forecast?.periods?.[0]?.revenue ?? null,
          ebitda: forecast?.periods?.[0]?.ebitda ?? null,
          ebit: forecast?.periods?.[0]?.ebit ?? null,
          revenue_growth: forecast?.assumptions?.revenue_growth ?? null,
          tax_rate: forecast?.assumptions?.tax_rate ?? null,
          interest_rate: forecast?.assumptions?.interest_rate ?? null,
        };
      }
      const current = target === "LBO" ? lboIn : target === "Options" ? optionIn : target === "Bond" ? bondIn : waccIn;
      const result = await suggestModelInputs(
        {
          name: selectedModel.name,
          base_url: selectedModel.base_url,
          api_key: selectedModel.api_key,
          model_id: selectedModel.model_id,
        },
        target,
        { ticker: ticker || undefined, company, current },
      );
      if (!result.ok) throw new Error(result.error);
      const suggested = stringify(result.values, current);
      if (target === "LBO") setLboIn(suggested);
      else if (target === "Options") setOptionIn(suggested);
      else if (target === "Bond") setBondIn(suggested);
      else setWaccIn(suggested);
      setNotice(
        `AI suggested ${target} inputs${ticker ? ` for ${ticker}` : ""}${result.reasoning ? ` — ${result.reasoning}` : ""}. Review them, then run the model.`,
      );
    } catch (suggestError) {
      setError(getErrorMessage(suggestError));
    } finally {
      setSuggesting(null);
    }
  }

  const currentResult =
    tab === "LBO" ? lboResult : tab === "Options" ? optionResult : tab === "Bond" ? bondResult : waccResult;

  async function saveCurrent() {
    const target = tab;
    const result = currentResult;
    if (!result) return;
    const assumptions =
      target === "LBO" ? lboPayload(lboIn) : target === "Options" ? optionPayload(optionIn) : target === "Bond" ? bondPayload(bondIn) : waccPayload(waccIn);
    setSaving(true);
    setError(null);
    try {
      const name = modelLabel.trim() || `${target} model ${new Date().toISOString().slice(0, 10)}`;
      await api("/api/projects/models/saved", {
        method: "POST",
        body: JSON.stringify({
          name,
          kind: kindForTab(target),
          ticker: importTicker.trim().toUpperCase() || null,
          assumptions,
          results: result,
        }),
      });
      setNotice(`Saved “${name}” to the library.`);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const ke = numberFrom(waccIn, "risk_free", 0.04) + numberFrom(waccIn, "beta", 1) * numberFrom(waccIn, "market_premium", 0.055);
  const kdAfterTax = numberFrom(waccIn, "cost_of_debt", 0.06) * (1 - numberFrom(waccIn, "tax_rate", 0.25));
  const weightTotal = numberFrom(waccIn, "equity_weight", 0.7) + numberFrom(waccIn, "debt_weight", 0.3);

  function aiFillButton(target: SuggestTab) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void suggestTab(target)}
        disabled={suggesting !== null || running !== null || !hasAI}
        title={
          hasAI
            ? "Ask the AI to suggest well-grounded inputs for this model"
            : "Configure an AI model with an API key in the AI Center first"
        }
      >
        {suggesting === target ? (
          <Spinner label="Thinking" />
        ) : (
          <>
            <Sparkles size={13} /> AI fill
          </>
        )}
      </Button>
    );
  }

  return (
    <div className="px-5 md:px-8 lg:px-10 py-6 md:py-8 max-w-[1680px] mx-auto space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Calculator size={18} className="text-accent" /> Financial Modelling Studio
          </h1>
          <p className="text-xs text-muted mt-1">
            LBO, option, bond and WACC calculators. Every output is deterministic in-browser code; save results to the library.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={aiModel}
            onChange={(event) => setAiModel(event.target.value)}
            aria-label="AI model"
            disabled={enabledModels.length === 0}
            className="bg-panel border border-border px-2 py-1.5 text-xs w-44 focus:border-accent outline-none disabled:opacity-40"
          >
            <option value="">{usableModels.length ? "Default AI model" : "No AI model"}</option>
            {enabledModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}{model.api_key ? "" : " (no key)"}
              </option>
            ))}
          </select>
          <input
            value={modelLabel}
            onChange={(event) => setModelLabel(event.target.value)}
            placeholder="Model name (optional)"
            aria-label="Model name"
            className="bg-panel border border-border px-2 py-1.5 text-xs w-48 focus:border-accent outline-none"
          />
          <Button variant="secondary" size="sm" onClick={saveCurrent} disabled={saving || !currentResult}>
            <Save size={13} /> {saving ? "Saving..." : "Save result"}
          </Button>
          <Link href="/library" className="text-xs text-accent inline-flex items-center gap-1">
            Library <BookOpen size={12} />
          </Link>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <InfoBanner>{notice}</InfoBanner> : null}

      <Tabs idBase="model-tabs" tabs={TABS} value={tab} onChange={setTab} />

      <TabPanel idBase="model-tabs" active={tab} className="space-y-4">
      {tab === "LBO" ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Leveraged buyout"
                subtitle="Annual debt sweep; debt_paydown_pct is the share of post-interest cash swept to debt."
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">Inputs</Badge>
                    {aiFillButton("LBO")}
                    <Button size="sm" onClick={() => runTab("LBO")} disabled={running !== null}>
                      {running === "LBO" ? "Running..." : "Run LBO"}
                    </Button>
                  </div>
                }
              />
              <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                <InputGroup title="Entry">
                  <Field key="entry_ebitda" label="entry_ebitda" step="1" value={lboIn.entry_ebitda} onChange={(value) => setLboIn((current) => ({ ...current, entry_ebitda: value }))} />
                  <Field key="entry_multiple" label="entry_multiple" step="0.5" value={lboIn.entry_multiple} onChange={(value) => setLboIn((current) => ({ ...current, entry_multiple: value }))} />
                </InputGroup>
                <InputGroup title="Operating performance">
                  <Field key="revenue_growth" label="revenue_growth" step="0.01" value={lboIn.revenue_growth} onChange={(value) => setLboIn((current) => ({ ...current, revenue_growth: value }))} />
                  <Field key="tax_rate" label="tax_rate" step="0.01" value={lboIn.tax_rate} onChange={(value) => setLboIn((current) => ({ ...current, tax_rate: value }))} />
                </InputGroup>
                <InputGroup title="Financing">
                  <Field key="interest_rate" label="interest_rate" step="0.01" value={lboIn.interest_rate} onChange={(value) => setLboIn((current) => ({ ...current, interest_rate: value }))} />
                  <Field key="debt_paydown_pct" label="debt_paydown_pct" step="0.05" value={lboIn.debt_paydown_pct} onChange={(value) => setLboIn((current) => ({ ...current, debt_paydown_pct: value }))} />
                  <Field key="fees_pct" label="fees_pct" step="0.005" value={lboIn.fees_pct} onChange={(value) => setLboIn((current) => ({ ...current, fees_pct: value }))} />
                </InputGroup>
                <InputGroup title="Hold and exit">
                  <Field key="hold_years" label="hold_years" step="1" value={lboIn.hold_years} onChange={(value) => setLboIn((current) => ({ ...current, hold_years: value }))} />
                  <Field key="exit_multiple" label="exit_multiple" step="0.5" value={lboIn.exit_multiple} onChange={(value) => setLboIn((current) => ({ ...current, exit_multiple: value }))} />
                </InputGroup>
              </div>
              <div className="px-4 pb-4 text-[11px] text-muted">
                EBITDA grows at the revenue-growth rate. Exit fees are 1% of exit value. Percentages are decimals.
              </div>
            </Card>

            <Card>
              <CardHeader title="Seed from a company" subtitle="Pull year-1 EBITDA from the forecast engine" />
              <div className="p-4 space-y-2">
                <Field label="Ticker" type="text" value={importTicker} placeholder="SAMPLE" onChange={setImportTicker} />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={importFromCompany}
                  disabled={importing || !importTicker.trim()}
                  className="w-full"
                >
                  {importing ? <Spinner label="Importing" /> : "Use company EBITDA"}
                </Button>
                <p className="text-[11px] text-muted">
                  Imports the first forecast year&apos;s EBITDA and growth. This ticker is also used to ground the
                  &quot;AI fill&quot; suggestion with real company data.
                </p>
              </div>
            </Card>
          </div>

          {running === "LBO" ? <Spinner label="Running the LBO" /> : null}

          {lboResult ? (
            <Card>
              <CardHeader
                title="LBO result"
                subtitle={`${lboResult.hold_years ?? "—"}-year hold · ${
                  isNum(lboResult.debt_pct) ? `debt ${pct(lboResult.debt_pct, 0)}` : "debt n/a"
                }`}
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="muted">Calculated</Badge>
                    <Badge tone={lboResult.moic >= 2 ? "pos" : lboResult.moic >= 1 ? "muted" : "neg"}>
                      MOIC {isNum(lboResult.moic) ? `${num(lboResult.moic)}x` : "—"}
                    </Badge>
                    <Badge tone={lboResult.irr >= 0.2 ? "pos" : lboResult.irr >= 0 ? "muted" : "neg"}>
                      IRR {pct(lboResult.irr)}
                    </Badge>
                  </div>
                }
              />
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Purchase price" value={fmt(lboResult.purchase_price)} hint={`${lboIn.entry_multiple}x entry EBITDA`} />
                <Stat label="Total sources" value={fmt(lboResult.total_sources)} hint={`fees ${fmt(lboResult.fees)}`} />
                <Stat label="Debt at close" value={fmt(lboResult.debt)} hint={pct(lboResult.debt_pct, 0)} />
                <Stat label="Sponsor equity" value={fmt(lboResult.equity)} />
                <Stat label="Exit enterprise value" value={fmt(lboResult.exit_value)} hint={`${num(lboResult.exit_ebitda)} EBITDA`} />
                <Stat label="Debt at exit" value={fmt(lboResult.debt_balance_exit)} />
                <Stat label="Net exit proceeds" value={fmt(lboResult.net_exit_proceeds)} tone={tone(lboResult.net_exit_proceeds)} />
                <Stat label="MOIC" value={isNum(lboResult.moic) ? `${num(lboResult.moic)}x` : "—"} tone={tone(lboResult.moic)} />
              </div>
              <TableWrap className="max-h-[440px]">
                <table className="w-full min-w-[560px] text-xs">
                  <caption className="sr-only">LBO annual schedule: EBITDA, NOPAT, interest, cash sweep and closing debt balance by year</caption>
                  <thead>
                    <tr className="sticky top-0 z-10">
                      {["Year", "EBITDA", "NOPAT", "Interest", "Cash available", "Debt paydown", "Debt balance"].map((heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className={`px-3 py-2 bg-surface border-b border-border ${heading === "Year" ? "text-left" : "text-right"}`}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(lboResult.schedule || []).map((row: any) => (
                      <tr key={row.year} className="border-b border-border/70 hover:bg-hover/60">
                        <td className="px-3 py-1.5 text-muted">Year {row.year}</td>
                        <td className="text-right px-3 py-1.5 tabular">{fmt(row.ebitda)}</td>
                        <td className="text-right px-3 py-1.5 tabular">{fmt(row.nopat)}</td>
                        <td className="text-right px-3 py-1.5 tabular">{fmt(row.interest)}</td>
                        <td className={`text-right px-3 py-1.5 tabular ${tone(row.cash_available)}`}>{fmt(row.cash_available)}</td>
                        <td className="text-right px-3 py-1.5 tabular">{fmt(row.debt_paydown)}</td>
                        <td className="text-right px-3 py-1.5 tabular">{fmt(row.debt_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <div className="px-4 py-3 text-[11px] text-muted">
                Simplified annual LBO: no transaction fees in the debt balance, no dividends, no management rollover. Treat as a screening model.
              </div>
            </Card>
          ) : running !== "LBO" ? (
            <Card>
              <EmptyState title="No LBO yet" body="Set the entry and exit assumptions, then run the model." />
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "Options" ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Black-Scholes option value"
                subtitle="European option with a continuous dividend yield."
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">Inputs</Badge>
                    {aiFillButton("Options")}
                    <Button size="sm" onClick={() => runTab("Options")} disabled={running !== null}>
                      {running === "Options" ? "Pricing..." : "Price option"}
                    </Button>
                  </div>
                }
              />
              <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                <InputGroup title="Instrument">
                  <Field key="S" label="S" step="1" value={optionIn.S} onChange={(value) => setOptionIn((current) => ({ ...current, S: value }))} />
                  <Field key="K" label="K" step="1" value={optionIn.K} onChange={(value) => setOptionIn((current) => ({ ...current, K: value }))} />
                  <Field key="T" label="T" step="0.25" value={optionIn.T} onChange={(value) => setOptionIn((current) => ({ ...current, T: value }))} />
                  <Select label="Option type" value={optionIn.option_type} onChange={(value) => setOptionIn((current) => ({ ...current, option_type: value }))} options={[{ value: "call", label: "Call" }, { value: "put", label: "Put" }]} />
                </InputGroup>
                <InputGroup title="Rates and volatility">
                  <Field key="r" label="r" step="0.01" value={optionIn.r} onChange={(value) => setOptionIn((current) => ({ ...current, r: value }))} />
                  <Field key="q" label="q" step="0.01" value={optionIn.q} onChange={(value) => setOptionIn((current) => ({ ...current, q: value }))} />
                  <Field key="sigma" label="sigma" step="0.01" value={optionIn.sigma} onChange={(value) => setOptionIn((current) => ({ ...current, sigma: value }))} />
                </InputGroup>
              </div>
              <div className="px-4 pb-4 text-[11px] text-muted">
                S and K are prices, T is years, r and q are continuous rates, sigma is annualised volatility. Theta is per year, vega per 1.00 of volatility.
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm font-medium mb-2">Reading the Greeks</div>
              <ul className="text-xs text-muted space-y-1.5 list-disc pl-4">
                <li>Delta is the change in option value per 1.00 move in the underlying.</li>
                <li>Gamma is the change in delta per 1.00 move in the underlying.</li>
                <li>Theta is the value lost per year, all else equal.</li>
                <li>Rho is the value change per 1.00 change in the risk-free rate.</li>
              </ul>
            </Card>
          </div>

          {running === "Options" ? <Spinner label="Pricing the option" /> : null}

          {optionResult ? (
            <Card>
              <CardHeader
                title="Option result"
                subtitle={optionIn.option_type === "put" ? "European put" : "European call"}
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="muted">Calculated</Badge>
                    <Badge tone="accent">Price {num(optionResult.price)}</Badge>
                  </div>
                }
              />
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Price" value={num(optionResult.price)} tone="text-accent" />
                <Stat label="Intrinsic" value={num(optionResult.intrinsic)} />
                <Stat label="Time value" value={num(optionResult.time_value)} />
                <Stat label="d1 / d2" value={`${num(optionResult.d1)} / ${num(optionResult.d2)}`} />
                <Stat label="Delta" value={num(optionResult.delta, 3)} />
                <Stat label="Gamma" value={num(optionResult.gamma, 4)} />
                <Stat label="Vega" value={num(optionResult.vega, 3)} hint="per 1.00 vol" />
                <Stat label="Theta" value={num(optionResult.theta, 3)} hint="per year" />
                <Stat label="Rho" value={num(optionResult.rho, 3)} hint="per 1.00 rate" />
                <Stat label="P(d1)" value={pct(optionResult.d1_probability)} hint="risk-neutral ITM proxy" />
                <Stat label="P(d2)" value={pct(optionResult.d2_probability)} />
              </div>
              {optionResult.warning ? (
                <div className="mx-4 mb-4"><WarnBanner>{optionResult.warning}</WarnBanner></div>
              ) : null}
            </Card>
          ) : running !== "Options" ? (
            <Card>
              <EmptyState title="No option value yet" body="Enter the spot, strike, expiry and volatility, then price the option." />
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "Bond" ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Bond pricing"
                subtitle="Fixed-coupon bond priced from a yield to maturity."
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">Inputs</Badge>
                    {aiFillButton("Bond")}
                    <Button size="sm" onClick={() => runTab("Bond")} disabled={running !== null}>
                      {running === "Bond" ? "Valuing..." : "Value bond"}
                    </Button>
                  </div>
                }
              />
              <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                <InputGroup title="Instrument">
                  <Field key="face" label="face" step="100" value={bondIn.face} onChange={(value) => setBondIn((current) => ({ ...current, face: value }))} />
                  <Field key="coupon_rate" label="coupon_rate" step="0.005" value={bondIn.coupon_rate} onChange={(value) => setBondIn((current) => ({ ...current, coupon_rate: value }))} />
                  <Field key="years" label="years" step="0.5" value={bondIn.years} onChange={(value) => setBondIn((current) => ({ ...current, years: value }))} />
                  <Field key="freq" label="freq" step="1" value={bondIn.freq} onChange={(value) => setBondIn((current) => ({ ...current, freq: value }))} />
                </InputGroup>
                <InputGroup title="Market yield">
                  <Field key="ytm" label="ytm" step="0.005" value={bondIn.ytm} onChange={(value) => setBondIn((current) => ({ ...current, ytm: value }))} />
                </InputGroup>
              </div>
              <div className="px-4 pb-4 text-[11px] text-muted">
                freq is coupons per year (2 = semiannual). Price is the present value of coupons and principal; accrued interest is not modelled.
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm font-medium mb-2">Risk measures</div>
              <ul className="text-xs text-muted space-y-1.5 list-disc pl-4">
                <li>Macaulay duration is the present-value-weighted time to cash flows, in years.</li>
                <li>Modified duration estimates the price change for a 1.00 change in yield.</li>
                <li>Convexity captures the curvature of the price-yield relationship.</li>
              </ul>
            </Card>
          </div>

          {running === "Bond" ? <Spinner label="Valuing the bond" /> : null}

          {bondResult ? (
            <Card>
              <CardHeader
                title="Bond result"
                subtitle={`${bondResult.periods ?? "—"} coupon periods`}
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="muted">Calculated</Badge>
                    <Badge tone="accent">Price {num(bondResult.price)}</Badge>
                  </div>
                }
              />
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Price" value={num(bondResult.price)} tone="text-accent" />
                <Stat label="Current yield" value={pct(bondResult.current_yield)} />
                <Stat label="Yield to maturity" value={pct(bondResult.ytm)} />
                <Stat label="Coupon per period" value={num(bondResult.coupon_payment)} />
                <Stat label="Macaulay duration" value={num(bondResult.macaulay_duration, 3)} hint="years" />
                <Stat label="Modified duration" value={num(bondResult.modified_duration, 3)} />
                <Stat label="Convexity" value={num(bondResult.convexity, 3)} />
                <Stat label="Periods" value={String(bondResult.periods ?? "—")} />
              </div>
            </Card>
          ) : running !== "Bond" ? (
            <Card>
              <EmptyState title="No bond value yet" body="Enter face value, coupon, yield and maturity, then value the bond." />
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "WACC" ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader
                title="WACC calculator"
                subtitle="CAPM cost of equity plus after-tax cost of debt."
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">Inputs</Badge>
                    {aiFillButton("WACC")}
                    <Button size="sm" onClick={() => runTab("WACC")} disabled={running !== null}>
                      {running === "WACC" ? "Calculating..." : "Calculate WACC"}
                    </Button>
                  </div>
                }
              />
              <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                <InputGroup title="Cost of equity (CAPM)">
                  <Field key="risk_free" label="risk_free" step="0.001" value={waccIn.risk_free} onChange={(value) => setWaccIn((current) => ({ ...current, risk_free: value }))} />
                  <Field key="beta" label="beta" step="0.05" value={waccIn.beta} onChange={(value) => setWaccIn((current) => ({ ...current, beta: value }))} />
                  <Field key="market_premium" label="market_premium" step="0.001" value={waccIn.market_premium} onChange={(value) => setWaccIn((current) => ({ ...current, market_premium: value }))} />
                </InputGroup>
                <InputGroup title="Cost of debt">
                  <Field key="cost_of_debt" label="cost_of_debt" step="0.001" value={waccIn.cost_of_debt} onChange={(value) => setWaccIn((current) => ({ ...current, cost_of_debt: value }))} />
                  <Field key="tax_rate" label="tax_rate" step="0.01" value={waccIn.tax_rate} onChange={(value) => setWaccIn((current) => ({ ...current, tax_rate: value }))} />
                </InputGroup>
                <InputGroup title="Capital weights">
                  <Field key="equity_weight" label="equity_weight" step="0.05" value={waccIn.equity_weight} onChange={(value) => setWaccIn((current) => ({ ...current, equity_weight: value }))} />
                  <Field key="debt_weight" label="debt_weight" step="0.05" value={waccIn.debt_weight} onChange={(value) => setWaccIn((current) => ({ ...current, debt_weight: value }))} />
                </InputGroup>
              </div>
              {Math.abs(weightTotal - 1) > 0.001 ? (
                <div className="px-4 pb-3 text-xs text-warn">
                  Equity and debt weights sum to {num(weightTotal, 3)}, not 1.000. The result will not be a weighted average.
                </div>
              ) : null}
            </Card>
            <Card className="p-4">
              <div className="text-sm font-medium mb-3">Cost of capital build</div>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Cost of equity</dt>
                  <dd className="tabular">{pct(ke)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">After-tax cost of debt</dt>
                  <dd className="tabular">{pct(kdAfterTax)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Equity weight</dt>
                  <dd className="tabular">{pct(numberFrom(waccIn, "equity_weight", 0.7))}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Debt weight</dt>
                  <dd className="tabular">{pct(numberFrom(waccIn, "debt_weight", 0.3))}</dd>
                </div>
              </dl>
              <p className="text-[11px] text-muted mt-3">Ke = rf + beta × premium. WACC = we × Ke + wd × Kd × (1 − tax).</p>
            </Card>
          </div>

          {running === "WACC" ? <Spinner label="Calculating WACC" /> : null}

          {waccResult ? (
            <Card>
              <CardHeader title="WACC result" subtitle="Use this rate in the DCF tab of a company workspace." action={<Badge tone="muted">Calculated</Badge>} />
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="WACC" value={pct(waccResult.wacc, 2)} tone="text-accent" />
                <Stat label="Cost of equity" value={pct(ke, 2)} />
                <Stat label="After-tax cost of debt" value={pct(kdAfterTax, 2)} />
              </div>
            </Card>
          ) : running !== "WACC" ? (
            <Card>
              <EmptyState title="No WACC yet" body="Fill in the capital-structure inputs and calculate." />
            </Card>
          ) : null}
        </div>
      ) : null}
      </TabPanel>

      <div className="text-[11px] text-muted">
        Outputs are screening estimates for research use, not investment advice. Saved models reopen from the library.
      </div>
    </div>
  );
}
