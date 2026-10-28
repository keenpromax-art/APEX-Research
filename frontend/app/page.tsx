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
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Badge, Button, EmptyState, Skeleton, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

type Project = { id: number; name: string; ticker: string; description?: string | null; updated_at: string };
type Model = { name: string; provider: string; enabled: boolean; source: string };

const RECENT_KEY = "apex-recent-tickers";

const ENTRY_POINTS = [
  { href: "/company", label: "Company analysis", body: "Statements, metrics and price history", icon: BarChart3, accent: "from-accent/20 to-cyan/10" },
  { href: "/modelling", label: "Modelling studio", body: "LBO, options, bond and WACC models", icon: Calculator, accent: "from-indigo/20 to-accent/10" },
  { href: "/research", label: "Research studio", body: "Versioned institutional PDF notes", icon: FileText, accent: "from-pos/20 to-cyan/10" },
  { href: "/ai", label: "AI Center", body: "Optional narrative providers", icon: Cpu, accent: "from-warn/20 to-neg/10" },
  { href: "/library", label: "Library", body: "Saved projects and model snapshots", icon: BookOpen, accent: "from-muted/20 to-dim/10" },
];

const FLOW = [
  { title: "Source financial data", body: "Annual and quarterly statements normalized in-browser. Missing data is labelled, never zero-filled.", icon: Database },
  { title: "Analyse history", body: "Revenue, margins, returns and cash conversion across the reported record.", icon: BarChart3 },
  { title: "Build the forecast", body: "Linked three-statement model with a cash revolver; flex growth, margins and working capital.", icon: TrendingUp },
  { title: "Value the business", body: "DCF, reverse DCF, WACC and two-way sensitivity — deterministic, tested code.", icon: Calculator },
  { title: "Write the note", body: "AI-assisted research draft grounded in verified metrics, exported to Excel or PDF.", icon: Sparkles },
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

  return (
    <div className="relative z-10 mx-auto max-w-[1680px] px-5 md:px-8 lg:px-10 py-6 md:py-8 space-y-10">
      {/* Hero */}
      <section>
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Badge tone="accent">Equity research terminal</Badge>
          <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
            {health === "ok" ? "Engine ready" : health === "down" ? "Engine error" : "Starting engine"}
          </Badge>
          {!loading && enabledModels > 0 ? (
            <Badge tone="muted">{enabledModels} AI model{enabledModels === 1 ? "" : "s"}</Badge>
          ) : null}
        </div>
        <h1 className="display text-gradient max-w-3xl">
          Ticker to investment view, without spreadsheet archaeology.
        </h1>
        <p className="text-base md:text-lg text-muted mt-4 max-w-2xl leading-relaxed">
          Pull the financials, build a linked forecast, value the business, and draft a research note.
          Every number is produced by tested code — AI only writes the narrative.
        </p>
        <form onSubmit={openTicker} className="mt-7 flex flex-col sm:flex-row gap-2 max-w-xl" role="search">
          <div className="relative flex-1">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="Enter a ticker, e.g. AAPL, MSFT, RELIANCE.NS"
              className="w-full bg-surface border border-border rounded-xl pl-10 pr-3 py-3 text-sm focus:border-accent focus:bg-hover outline-none transition-colors shadow-xs"
              aria-label="Ticker"
            />
          </div>
          <Button type="submit" size="lg">Open workspace</Button>
          <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/company/SAMPLE")}>
            Try sample
          </Button>
        </form>
        <p className="mt-3 text-xs text-dim">
          Everything runs in this browser — fundamentals, forecasts, valuation and exports come from the local engine.
        </p>
      </section>

      {/* Overview strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Saved projects", value: loading ? "—" : projects.length, hint: "workspaces" },
          { label: "AI models enabled", value: loading ? "—" : enabledModels, hint: "providers" },
          { label: "Data engine", value: health === "ok" ? "Ready" : health === "down" ? "Error" : "Starting", hint: "local" },
          { label: "Model integrity", value: "Deterministic", hint: "tested code" },
        ].map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
            <div className="text-[10px] uppercase tracking-[0.12em] text-dim font-medium">{m.label}</div>
            <div className="text-xl font-semibold tabular mt-1.5 leading-tight text-fg">{m.value}</div>
            <div className="text-[10px] text-muted mt-0.5">{m.hint}</div>
          </div>
        ))}
      </section>

      {/* Continue working */}
      <section>
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Clock size={17} className="text-accent" aria-hidden /> Continue working
            </h2>
            <p className="text-sm text-muted mt-1">Recently opened workspaces and saved projects, stored in this browser.</p>
          </div>
          <Link href="/library" className="text-sm text-accent inline-flex items-center gap-1 whitespace-nowrap hover:underline">
            Library <ArrowRight size={13} />
          </Link>
        </div>
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-border bg-surface overflow-hidden shadow-xs">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Saved projects</span>
              {loading ? <Spinner label="Loading" /> : <span className="text-xs tabular text-dim">{projects.length}</span>}
            </div>
            {loading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10 w-3/4" />
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
                    <Link href="/company" className="text-sm text-accent inline-flex items-center gap-1">
                      Open a company <ArrowRight size={13} />
                    </Link>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {projects.slice(0, 7).map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/company/${encodeURIComponent(project.ticker)}?project=${project.id}`}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-panel transition-colors group"
                    >
                      <span className="text-xs font-semibold text-accent w-24 shrink-0 truncate mono">{project.ticker}</span>
                      <span className="text-sm truncate flex-1 min-w-0">{project.name}</span>
                      <span className="text-xs text-dim whitespace-nowrap hidden sm:block">{localDate(project.updated_at)}</span>
                      <ArrowUpRight size={14} className="text-dim shrink-0 group-hover:text-accent transition-colors" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-xs">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Recently opened</span>
              <span className="text-xs tabular text-dim">{recent.length}</span>
            </div>
            {recent.length === 0 ? (
              <div className="px-5 py-8 text-sm text-muted text-center">
                Workspaces you open will appear here for one-click return.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((item) => (
                  <li key={item}>
                    <Link
                      href={`/company/${encodeURIComponent(item)}`}
                      className="flex items-center gap-2.5 px-5 py-3 hover:bg-panel transition-colors group"
                    >
                      <span className="text-sm font-semibold text-accent mono">{item}</span>
                      <span className="text-xs text-dim ml-auto">Reopen</span>
                      <ArrowUpRight size={13} className="text-dim group-hover:text-accent transition-colors" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Workspaces */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight mb-4">Workspaces</h2>
        <nav aria-label="Application sections" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {ENTRY_POINTS.map(({ href, label, body, icon: Icon, accent }) => (
            <Link
              key={href}
              href={href}
              className="group relative rounded-xl border border-border bg-surface p-5 hover:border-accent/50 transition-all card-interactive flex flex-col gap-3 min-w-0 overflow-hidden"
            >
              <div className={cn("absolute -top-8 -right-8 h-24 w-24 rounded-full bg-gradient-to-br opacity-60 blur-2xl", accent)} aria-hidden />
              <div className="relative grid place-items-center h-9 w-9 rounded-lg bg-panel border border-border text-accent group-hover:border-accent/40 transition-colors">
                <Icon size={17} aria-hidden />
              </div>
              <div className="relative">
                <span className="text-sm font-semibold leading-snug block">{label}</span>
                <span className="text-xs text-muted leading-snug mt-1 block">{body}</span>
              </div>
              <ArrowUpRight size={14} className="relative text-dim group-hover:text-accent transition-colors mt-auto" aria-hidden />
            </Link>
          ))}
        </nav>
      </section>

      {/* Workflow pipeline */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight mb-4">The workflow</h2>
        <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
          <ol className="grid grid-cols-1 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-border">
            {FLOW.map(({ title, body, icon: Icon }, index) => (
              <li key={title} className="p-5 flex flex-col gap-3 relative">
                <div className="flex items-center gap-2.5">
                  <span className="grid place-items-center h-8 w-8 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs font-semibold mono shrink-0">
                    {index + 1}
                  </span>
                  <Icon size={15} className="text-accent" aria-hidden />
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-tight">{title}</div>
                  <p className="text-xs text-muted mt-1.5 leading-relaxed">{body}</p>
                </div>
                {index < FLOW.length - 1 ? (
                  <ArrowRight size={14} className="hidden md:block absolute -right-2 top-1/2 -translate-y-1/2 text-dim bg-surface rounded-full" aria-hidden />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Status + AI */}
      <section className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-5 shadow-xs">
          <h3 className="text-sm font-semibold tracking-tight mb-4 flex items-center gap-2">
            <ShieldCheck size={15} className="text-pos" aria-hidden /> Workspace status
          </h3>
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Saved projects</dt>
              <dd className="tabular font-medium">{loading ? "—" : projects.length}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">AI models enabled</dt>
              <dd className="tabular font-medium">{loading ? "—" : enabledModels}</dd>
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
              <dd className="flex items-center gap-1.5 text-pos font-medium">
                <ShieldCheck size={14} aria-hidden /> Deterministic
              </dd>
            </div>
          </dl>
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link href="/library" className="text-accent inline-flex items-center gap-1.5 hover:underline">Library <ArrowRight size={13} /></Link>
            <Link href="/ai" className="text-accent inline-flex items-center gap-1.5 hover:underline">AI Center <ArrowRight size={13} /></Link>
            <Link href="/company" className="text-accent inline-flex items-center gap-1.5 hover:underline">Company <ArrowRight size={13} /></Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Cpu size={15} className="text-accent" aria-hidden /> AI is optional
          </h3>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            Research reports need at least one configured model (OpenRouter, Groq, NVIDIA NIM or any OpenAI-compatible
            endpoint). Keys stay in this browser&apos;s local storage. Without a model, every deterministic workflow still
            works.
          </p>
          <Link href="/ai" className="text-sm text-accent inline-flex items-center gap-1.5 mt-3 hover:underline">
            Configure providers <ArrowRight size={13} />
          </Link>
        </div>
      </section>

      <footer className="text-xs text-dim border-t border-border pt-5 flex flex-wrap items-center justify-between gap-3">
        <span>
          Formulas and sign conventions are documented in <span className="mono">docs/MODELS.md</span>; architecture and
          limitations in <span className="mono">docs/ARCHITECTURE.md</span>.
        </span>
        <span>This is research software, not investment advice.</span>
      </footer>
    </div>
  );
}
