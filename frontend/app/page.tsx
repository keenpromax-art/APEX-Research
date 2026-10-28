"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Calculator,
  Clock,
  Cpu,
  Database,
  FileText,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Badge, Button, EmptyState, Skeleton, Spinner } from "@/components/ui";

type Project = { id: number; name: string; ticker: string; description?: string | null; updated_at: string };
type Model = { name: string; provider: string; enabled: boolean; source: string };

const RECENT_KEY = "apex-recent-tickers";

const ENTRY_POINTS = [
  { href: "/company", label: "Company analysis", body: "Statements, metrics and price history", icon: BarChart3 },
  { href: "/modelling", label: "Modelling studio", body: "LBO, options, bond and WACC models", icon: Calculator },
  { href: "/research", label: "Research studio", body: "Versioned institutional PDF notes", icon: FileText },
  { href: "/ai", label: "AI Center", body: "Optional narrative providers", icon: Cpu },
  { href: "/library", label: "Library", body: "Saved projects and model snapshots", icon: BookOpen },
];

const FLOW = [
  {
    title: "Pull statements",
    body: "Annual and quarterly statements normalized in the browser. Missing data is labelled, never zero-filled.",
    icon: Database,
  },
  {
    title: "Model the business",
    body: "Linked three-statement forecast with a cash revolver; flex growth, margins and working capital.",
    icon: BarChart3,
  },
  {
    title: "Value it",
    body: "DCF, reverse DCF, WACC and two-way sensitivity — deterministic, tested code.",
    icon: Calculator,
  },
  {
    title: "Write the note",
    body: "AI-assisted research draft grounded in verified metrics, exported to Excel or PDF.",
    icon: Sparkles,
  },
];

export default function Home() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [recent, setRecent] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setRecent(parsed.filter((item) => typeof item === "string").slice(0, 8));
    } catch {
      // no stored history yet
    }
    setLoading(true);
    Promise.all([
      api<Project[]>("/api/projects").catch((loadError) => {
        if (active) setProjectsError(loadError instanceof Error ? loadError.message : "Could not load saved projects.");
        return [] as Project[];
      }),
      api<Model[]>("/api/ai/models").catch(() => [] as Model[]),
      api<{ status?: string }>("/health").then((body) => body.status === "ok").catch(() => false),
    ])
      .then(([projectRows, modelRows, engineOk]) => {
        if (!active) return;
        setProjects(projectRows);
        setModels(modelRows);
        setHealth(engineOk ? "ok" : "down");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function openTicker(event: FormEvent) {
    event.preventDefault();
    const value = ticker.trim().toUpperCase();
    if (value) router.push(`/company/${encodeURIComponent(value)}`);
  }

  const enabledModels = models.filter((model) => model.enabled).length;
  const forecastSnapshots = projects.length;

  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6 md:py-10 space-y-10">
      {/* Hero + primary workflow */}
      <section className="max-w-3xl">
        <div className="flex items-center gap-2 mb-4">
          <Badge tone="accent">Equity research terminal</Badge>
          <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
            {health === "ok" ? "Engine ready" : health === "down" ? "Engine error" : "Starting engine"}
          </Badge>
          {!loading && enabledModels > 0 ? <Badge tone="muted">{enabledModels} AI model{enabledModels === 1 ? "" : "s"}</Badge> : null}
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
          Ticker to investment view, without spreadsheet archaeology.
        </h1>
        <p className="text-sm md:text-base text-muted mt-3 max-w-2xl leading-relaxed">
          Pull the financials, build a linked forecast, value the business, and draft a research note.
          Every number is produced by tested code — AI only writes the narrative.
        </p>
        <form onSubmit={openTicker} className="mt-6 flex flex-col sm:flex-row gap-2 max-w-xl" role="search">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="Enter a ticker, e.g. AAPL, MSFT, RELIANCE.NS"
              className="w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2.5 text-sm focus:border-accent focus:bg-hover outline-none"
              aria-label="Ticker"
            />
          </div>
          <Button type="submit" size="lg">Open workspace</Button>
          <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/company/SAMPLE")}>
            Try sample
          </Button>
        </form>
        <p className="mt-3 text-[11px] text-dim">
          Everything runs in this browser — fundamentals, forecasts, valuation and exports come from the local engine.
        </p>
      </section>

      {/* Continue working: recents + saved projects */}
      <section>
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Clock size={16} className="text-accent" aria-hidden /> Continue working
            </h2>
            <p className="text-xs text-muted mt-0.5">Recently opened workspaces and saved projects, stored in this browser.</p>
          </div>
          <Link href="/library" className="text-xs text-accent inline-flex items-center gap-1 whitespace-nowrap">
            Library <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Saved projects</span>
              {loading ? <Spinner label="Loading" /> : <span className="text-xs tabular text-dim">{projects.length}</span>}
            </div>
            {loading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
                <Skeleton className="h-9 w-3/4" />
              </div>
            ) : projects.length === 0 ? (
              <EmptyState
                title={projectsError ? "Projects unavailable" : "No saved projects yet"}
                body={
                  projectsError
                    ? projectsError
                    : "Open a ticker workspace and use Save project to keep its assumptions, WACC and terminal settings."
                }
                action={
                  projectsError ? null : (
                    <Link href="/company" className="text-xs text-accent inline-flex items-center gap-1">
                      Open a company <ArrowRight size={12} />
                    </Link>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {projects.slice(0, 6).map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/company/${encodeURIComponent(project.ticker)}?project=${project.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel transition-colors"
                    >
                      <span className="text-xs font-semibold text-accent w-20 shrink-0 truncate mono">{project.ticker}</span>
                      <span className="text-xs truncate flex-1 min-w-0">{project.name}</span>
                      <span className="text-[10px] text-dim whitespace-nowrap hidden sm:block">{localDate(project.updated_at)}</span>
                      <ArrowUpRight size={13} className="text-dim shrink-0" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Recently opened</span>
              <span className="text-xs tabular text-dim">{recent.length}</span>
            </div>
            {recent.length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted text-center">
                Workspaces you open will appear here for one-click return.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((item) => (
                  <li key={item}>
                    <Link
                      href={`/company/${encodeURIComponent(item)}`}
                      className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-panel transition-colors"
                    >
                      <span className="text-xs font-semibold text-accent mono">{item}</span>
                      <span className="text-[11px] text-dim ml-auto">Reopen</span>
                      <ArrowUpRight size={13} className="text-dim" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Entry points */}
      <section>
        <h2 className="text-lg font-semibold tracking-tight mb-3">Workspaces</h2>
        <nav aria-label="Application sections" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {ENTRY_POINTS.map(({ href, label, body, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-xl border border-border bg-surface p-4 hover:border-accent/50 hover:bg-panel transition-colors flex flex-col gap-2 min-w-0"
            >
              <Icon size={17} className="text-accent" aria-hidden />
              <span className="text-sm font-medium leading-snug">{label}</span>
              <span className="text-[11px] text-muted leading-snug">{body}</span>
            </Link>
          ))}
        </nav>
      </section>

      {/* Workflow + status */}
      <section className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold tracking-tight mb-3">The workflow</h2>
          <ol className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
            {FLOW.map(({ title, body, icon: Icon }, index) => (
              <li key={title} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="h-7 w-7 rounded-full border border-accent/40 bg-accent/10 text-accent text-[11px] font-semibold flex items-center justify-center mono">
                    {index + 1}
                  </span>
                  {index < FLOW.length - 1 ? <span className="flex-1 w-px bg-border mt-2 hidden sm:block" aria-hidden /> : null}
                </div>
                <div className="min-w-0 pb-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <Icon size={14} className="text-accent" aria-hidden /> {title}
                  </div>
                  <p className="text-xs text-muted mt-1 leading-relaxed">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="text-sm font-medium mb-3">Workspace status</h3>
            <dl className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Saved projects</dt>
                <dd className="tabular">{loading ? "—" : forecastSnapshots}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">AI models enabled</dt>
                <dd className="tabular">{loading ? "—" : enabledModels}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Data engine</dt>
                <dd>
                  <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
                    {health === "ok" ? "ready" : health === "down" ? "error" : "starting"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Model integrity</dt>
                <dd className="flex items-center gap-1 text-pos">
                  <ShieldCheck size={13} aria-hidden /> Deterministic
                </dd>
              </div>
            </dl>
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              <Link href="/library" className="text-accent inline-flex items-center gap-1">Library <ArrowRight size={11} /></Link>
              <Link href="/ai" className="text-accent inline-flex items-center gap-1">AI Center <ArrowRight size={11} /></Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Cpu size={14} className="text-accent" aria-hidden /> AI is optional
            </h3>
            <p className="text-xs text-muted mt-2 leading-relaxed">
              Research reports need at least one configured model (OpenRouter, Groq, NVIDIA NIM or any OpenAI-compatible
              endpoint). Keys stay in this browser&apos;s local storage. Without a model, every deterministic workflow still
              works.
            </p>
            <Link href="/ai" className="text-xs text-accent inline-flex items-center gap-1 mt-3">
              Configure providers <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </section>

      <p className="text-[11px] text-dim border-t border-border pt-4">
        Formulas and sign conventions are documented in <span className="mono">docs/MODELS.md</span>; architecture and
        limitations in <span className="mono">docs/ARCHITECTURE.md</span>. This is research software, not investment advice.
      </p>
    </div>
  );
}
