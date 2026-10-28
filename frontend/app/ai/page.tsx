"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Cpu, ExternalLink, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, Field, InfoBanner, Select, Spinner, TableWrap } from "@/components/ui";
import { cn } from "@/lib/cn";

type Model = {
  name: string;
  provider: string;
  model_id: string;
  base_url?: string | null;
  enabled: boolean;
  has_key: boolean;
  source?: string;
};

type TestResult = { ok: boolean; latency_ms?: number; sample?: string; error?: string };

type Job = {
  id: number;
  ticker: string;
  status: string;
  progress: number;
  error?: string | null;
  created_at?: string | null;
};

type ProviderCatalog = {
  provider: string;
  label: string;
  base_url?: string | null;
  requires_base_url: boolean;
  model_hint?: string;
};

const PROVIDER_CATALOG_FALLBACK: ProviderCatalog[] = [
  { provider: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", requires_base_url: false, model_hint: "openai/gpt-4o-mini" },
  { provider: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", requires_base_url: false, model_hint: "llama-3.3-70b-versatile" },
  { provider: "nvidia", label: "NVIDIA NIM", base_url: "https://integrate.api.nvidia.com/v1", requires_base_url: false, model_hint: "meta/llama-3.1-70b-instruct" },
  { provider: "openai_compatible", label: "OpenAI-compatible", base_url: null, requires_base_url: true, model_hint: "vendor/model-name" },
];

const EMPTY_FORM = { name: "", provider: "openrouter", model_id: "", base_url: "", api_key: "" };

const MIRROR_KEY = "apex.ai.models.v1";

type LocalModel = {
  name: string;
  provider: string;
  model_id: string;
  base_url?: string | null;
  api_key?: string | null;
  enabled: boolean;
};

function readMirror(): LocalModel[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeMirror(rows: LocalModel[]) {
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable or full — backup simply disabled
  }
}

export default function AIPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalog[]>(PROVIDER_CATALOG_FALLBACK);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [modelRows, jobRows] = await Promise.all([
        api<Model[]>("/api/ai/models"),
        api<Job[]>("/api/ai/jobs?limit=10").catch(() => []),
      ]);
      setModels(modelRows);
      setJobs(jobRows);
      const serverNames = new Set(modelRows.map((row) => row.name));
      const missing = readMirror().filter((row) => row.name && !serverNames.has(row.name));
      let restored = 0;
      for (const row of missing) {
        try {
          await api("/api/ai/models", {
            method: "POST",
            body: JSON.stringify({
              name: row.name,
              provider: row.provider,
              model_id: row.model_id,
              base_url: row.base_url ?? null,
              api_key: row.api_key ?? null,
              enabled: row.enabled !== false,
            }),
          });
          restored += 1;
        } catch {
          // keep it in the browser backup; retried on the next load
        }
      }
      if (restored > 0) {
        try {
          setModels(await api<Model[]>("/api/ai/models"));
        } catch {
          // fall back to the pre-restore list
        }
        flash(`Restored ${restored} locally saved model${restored === 1 ? "" : "s"} missing from the server.`);
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api<ProviderCatalog[]>("/api/ai/providers")
      .then((rows) => {
        if (Array.isArray(rows) && rows.length) setCatalog(rows);
      })
      .catch(() => setCatalog(PROVIDER_CATALOG_FALLBACK));
  }, [load]);

  const providerOptions = catalog.map((row) => ({ value: row.provider, label: row.label }));
  const selectedProvider = catalog.find((row) => row.provider === form.provider);
  const defaultBaseUrl = selectedProvider?.base_url ?? "";
  const usingDefault = !form.base_url.trim() || form.base_url.trim() === defaultBaseUrl;

  function changeProvider(provider: string) {
    setForm((current) => {
      const next: Record<string, string> = { ...current, provider };
      const previousDefault = catalog.find((row) => row.provider === current.provider)?.base_url ?? "";
      const value = current.base_url.trim();
      if (!value || value === previousDefault) {
        next.base_url = catalog.find((row) => row.provider === provider)?.base_url ?? "";
      }
      if (!current.model_id.trim()) next.model_id = catalog.find((row) => row.provider === provider)?.model_hint ?? "";
      return next;
    });
  }

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  }

  async function addModel(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    try {
      if (!form.name.trim() || !form.model_id.trim()) {
        throw new Error("Name and model ID are required.");
      }
      if (form.provider === "openai_compatible" && !form.base_url.trim()) {
        throw new Error("A base URL is required for OpenAI-compatible providers.");
      }
      await api("/api/ai/models", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          provider: form.provider,
          model_id: form.model_id.trim(),
          base_url: form.base_url.trim() || null,
          api_key: form.api_key.trim() || null,
          enabled: true,
        }),
      });
      const saved: LocalModel = {
        name: form.name.trim(),
        provider: form.provider,
        model_id: form.model_id.trim(),
        base_url: form.base_url.trim() || null,
        api_key: form.api_key.trim() || null,
        enabled: true,
      };
      writeMirror([...readMirror().filter((row) => row.name !== saved.name), saved]);
      setForm(EMPTY_FORM);
      flash("Model added. Test the connection before using it for research.");
      await load();
    } catch (addError) {
      setError(getErrorMessage(addError));
    } finally {
      setAdding(false);
    }
  }

  async function toggleModel(model: Model) {
    setBusy(model.name);
    setError(null);
    try {
      await api(`/api/ai/models/${encodeURIComponent(model.name)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !model.enabled }),
      });
      writeMirror(readMirror().map((row) => (row.name === model.name ? { ...row, enabled: !model.enabled } : row)));
      setModels((current) => current.map((row) => (row.name === model.name ? { ...row, enabled: !row.enabled } : row)));
    } catch (toggleError) {
      setError(getErrorMessage(toggleError));
    } finally {
      setBusy(null);
    }
  }

  async function testModel(model: Model) {
    setBusy(model.name);
    setError(null);
    try {
      const result = await api<TestResult>(`/api/ai/models/${encodeURIComponent(model.name)}/test`, { method: "POST" });
      setTestResults((current) => ({ ...current, [model.name]: result }));
    } catch (testError) {
      setTestResults((current) => ({ ...current, [model.name]: { ok: false, error: getErrorMessage(testError) } }));
    } finally {
      setBusy(null);
    }
  }

  async function deleteModel(model: Model) {
    if (!window.confirm(`Delete the model “${model.name}”? The API key will be removed from the local database.`)) return;
    setBusy(model.name);
    setError(null);
    try {
      await api(`/api/ai/models/${encodeURIComponent(model.name)}`, { method: "DELETE" });
      writeMirror(readMirror().filter((row) => row.name !== model.name));
      setModels((current) => current.filter((row) => row.name !== model.name));
      flash(`Deleted “${model.name}”.`);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(null);
    }
  }

  const enabled = models.filter((model) => model.enabled).length;
  const envModels = models.filter((model) => model.source === "env").length;

  return (
    <div className="px-5 md:px-8 lg:px-10 py-6 md:py-8 max-w-[1680px] mx-auto space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Cpu size={18} className="text-accent" /> AI Control Center
          </h1>
          <p className="text-xs text-muted mt-1">
            Providers are optional. Keys stay in this browser&apos;s local storage and are only sent to the provider you configure. AI writes narrative only.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={enabled ? "pos" : "warn"}>{enabled} enabled</Badge>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <InfoBanner>{notice}</InfoBanner> : null}

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Configured models"
            subtitle={
              loading
                ? "Loading providers"
                : `${models.length} total · ${envModels} from environment · click Test to verify a connection`
            }
          />
          {loading ? (
            <div className="p-4">
              <Spinner label="Loading models" />
            </div>
          ) : models.length === 0 ? (
            <EmptyState
              title="No AI models configured"
              body="Add an OpenRouter, Groq, NVIDIA NIM or OpenAI-compatible endpoint. Deterministic research and modelling still work without one."
            />
          ) : (
            <TableWrap>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-panel/60">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Provider</th>
                    <th className="text-left px-3 py-2">Model ID</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-center px-3 py-2">Enabled</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const env = model.source === "env";
                    const result = testResults[model.name];
                    return (
                      <tr key={model.name} className="border-t border-border hover:bg-panel/40 align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{model.name}</div>
                          <div className="text-[10px] text-muted flex items-center gap-1 mt-0.5">
                            {model.has_key ? (
                              <>
                                <ShieldCheck size={11} className="text-pos" /> key stored
                              </>
                            ) : (
                              <span className="text-warn">no API key</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">{model.provider}</td>
                        <td className="px-3 py-2 mono">{model.model_id}</td>
                        <td className="px-3 py-2">
                          <Badge tone={env ? "accent" : "muted"}>{env ? "env" : "saved"}</Badge>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => toggleModel(model)}
                            disabled={env || busy === model.name}
                            className={cn(
                              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40",
                              model.enabled ? "bg-pos/70" : "bg-border",
                            )}
                            aria-label={`${model.enabled ? "Disable" : "Enable"} ${model.name}`}
                            title={env ? "Environment models are controlled by .env" : "Toggle this model"}
                          >
                            <span
                              className={cn(
                                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                                model.enabled ? "translate-x-[18px]" : "translate-x-0.5",
                              )}
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => testModel(model)} disabled={busy === model.name} className="text-accent hover:underline disabled:opacity-40">
                              Test
                            </button>
                            <button
                              onClick={() => deleteModel(model)}
                              disabled={env || busy === model.name}
                              className="text-neg hover:underline disabled:opacity-30 inline-flex items-center gap-1"
                              title={env ? "Environment models cannot be deleted here" : "Delete model"}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                          {busy === model.name && !result ? <Spinner label="Testing" /> : null}
                          {result ? (
                            <div className={cn("mt-1.5 text-[10px] flex items-start gap-1", result.ok ? "text-pos" : "text-neg")}>
                              {result.ok ? <CheckCircle2 size={11} className="mt-0.5" /> : <XCircle size={11} className="mt-0.5" />}
                              <span className="break-words">
                                {result.ok
                                  ? `OK · ${result.latency_ms ?? "—"} ms${result.sample ? ` · “${result.sample}”` : ""}`
                                  : result.error || "Connection failed"}
                              </span>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {envModels > 0 ? (
            <div className="px-4 py-3 text-[11px] text-muted border-t border-border">
              Environment models are read-only here. Add your own model below to change providers.
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Add a model" subtitle="Saved in this browser only" />
          <form onSubmit={addModel} className="p-4 space-y-2">
            <Field label="name" type="text" value={form.name} placeholder={selectedProvider ? `${selectedProvider.label} — model` : "OpenRouter — Sonnet"} onChange={(value) => setForm({ ...form, name: value })} />
            <Select label="provider" value={form.provider} onChange={changeProvider} options={providerOptions} />
            <Field
              label="model_id"
              type="text"
              value={form.model_id}
              placeholder={selectedProvider?.model_hint || "vendor/model-id"}
              onChange={(value) => setForm({ ...form, model_id: value })}
            />
            <Field
              label="base_url"
              type="text"
              value={form.base_url}
              placeholder={defaultBaseUrl || "https://host/v1 (required)"}
              onChange={(value) => setForm({ ...form, base_url: value })}
            />
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted pl-0.5">
              <span className="mono break-all">{defaultBaseUrl ? `Default for provider: ${defaultBaseUrl}` : "Required for OpenAI-compatible endpoints"}</span>
              {defaultBaseUrl && !usingDefault ? (
                <button type="button" onClick={() => setForm({ ...form, base_url: defaultBaseUrl })} className="text-accent hover:underline shrink-0">
                  Use default
                </button>
              ) : null}
            </div>
            <Field label="api_key" type="password" value={form.api_key} placeholder="sk-…" onChange={(value) => setForm({ ...form, api_key: value })} />
            <div className="rounded-md border border-border bg-panel/50 px-2.5 py-2 text-[10px] text-muted">
              The key is stored in this browser&apos;s local storage (unencrypted) and sent only to the provider endpoint you configured. Treat this browser profile as sensitive.
            </div>
            <Button type="submit" className="w-full" disabled={adding}>
              {adding ? "Adding..." : "Add model"}
            </Button>
          </form>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent research jobs"
          subtitle="Persisted runs from the company workspace, most recent first"
          action={
            <Link href="/company/SAMPLE" className="text-xs text-accent inline-flex items-center gap-1">
              Open a workspace <ExternalLink size={12} />
            </Link>
          }
        />
        {jobs.length === 0 ? (
          <EmptyState
            title="No research jobs yet"
            body="Generate a research note from a company workspace to see the job history here."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-panel/60">
                  <th className="text-left px-3 py-2">Job</th>
                  <th className="text-left px-3 py-2">Ticker</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Progress</th>
                  <th className="text-left px-3 py-2">Created</th>
                  <th className="text-left px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-border hover:bg-panel/40">
                    <td className="px-3 py-2 text-muted">#{job.id}</td>
                    <td className="px-3 py-2">
                      <Link href={`/company/${encodeURIComponent(job.ticker)}`} className="text-accent">
                        {job.ticker}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={job.status === "complete" ? "pos" : job.status === "failed" ? "neg" : "accent"}>{job.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular">{job.progress ?? 0}%</td>
                    <td className="px-3 py-2 text-muted">{localDate(job.created_at)}</td>
                    <td className="px-3 py-2 text-neg break-words max-w-64">{job.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="text-[11px] text-muted">
        AI output is grounded in verified metrics but remains a draft. The deterministic engine owns every final number.
      </div>
    </div>
  );
}
