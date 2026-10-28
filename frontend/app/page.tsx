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
  Cpu,
  Database,
  FileText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Badge, Button, EmptyState, SectionBar, Skeleton, Spinner } from "@/components/ui";

type Project = { id: number; name: string; ticker: string; description?: string | null; updated_at: string };
type Model = { name: string; provider: string; enabled: boolean; source: string };

const RECENT_KEY = "apex-recent-tickers";

const ENTRY_POINTS = [
  { href: "/company", label: "Company analysis", body: "Statements, metrics, price history", icon: BarChart3 },
  { href: "/modelling", label: "Modelling studio", body: "LBO, options, bond, WACC", icon: Calculator },
  { href: "/research", label: "Research studio", body: "Versioned institutional PDF notes", icon: FileText },
  { href: "/ai", label: "AI Center", body: "Optional narrative providers", icon: Cpu },
  { href: "/library", label: "Library", body: "Saved projects, model snapshots", icon: BookOpen },
];

const FLOW = [
  { title: "Source", body: "Annual and quarterly statements normalized in-browser. Missing data is labelled, never zero-filled.", icon: Database },
  { title: "Analyse", body: "Revenue, margins, returns and cash conversion across the reported record.", icon: BarChart3 },
  { title: "Forecast", body: "Linked three-statement model with a cash revolver; flex growth, margins and working capital.", icon: TrendingUp },
  { title: "Value", body: "DCF, reverse DCF, WACC and two-way sensitivity — deterministic, tested code.", icon: Calculator },
  { title: "Write", body: "AI-assisted research draft grounded in verified metrics, exported to Excel or PDF.", icon: Sparkles },
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
    } catch {}
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
    <div className="relative z-10 mx-auto max-w-[1600px] px-0 py-0">
      {/* Hero */}
      <section className="px-6 md:px-10 py-10 md:py-14 border-b border-border">
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Badge tone="accent">Equity research platform</Badge>
          <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
            {health === "ok" ? "Engine ready" : health === "down" ? "Engine error" : "Starting engine"}
          </Badge>
          {!loading && enabledModels > 0 ? (
            <Badge tone="muted">{enabledModels} AI model{enabledModels === 1 ? "" : "s"}</Badge>
          ) : null}
        </div>
        <h1 className="display max-w-3xl">
          Ticker in.
          <br />
          Investment view out.
        </h1>
        <p className="text-[14px] text-muted mt-4 max-w-xl leading-relaxed">
          Financials, forecast, valuation, research note. Every number produced by tested code.
          AI only writes the narrative.
        </p>
        <form onSubmit={openTicker} className="mt-6 flex flex-col sm:flex-row gap-2 max-w-xl" role="search">
          <div className="relative flex-1">
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="AAPL   MSFT   RELIANCE.NS"
              className="w-full bg-elev border border-border px-3 py-2.5 text-[13px] focus:border-accent outline-none transition-colors placeholder:text-dim"
              aria-label="Ticker"
            />
          </div>
          <Button type="submit" size="lg">Open</Button>
          <Button type="button" variant="secondary" size="lg" onClick={() => router.push("/company/SAMPLE")}>
            Sample
          </Button>
        </form>
        <p className="mt-3 text-[10px] text-dim uppercase tracking-wider">
          All computation local — no data leaves this browser
        </p>
      </section>

      {/* 01 Overview */}
      <section>
        <SectionBar num="01" title="Overview" />
        <div className="grid-visible grid-cols-2 md:grid-cols-4">
          {[
            { label: "Projects", value: loading ? "—" : projects.length, hint: "saved" },
            { label: "AI models", value: loading ? "—" : enabledModels, hint: "enabled" },
            { label: "Engine", value: health === "ok" ? "OK" : health === "down" ? "ERR" : "...", hint: "local" },
            { label: "Integrity", value: "Deterministic", hint: "tested" },
          ].map((m) => (
            <div key={m.label} className="px-4 py-4">
              <div className="text-[9px] uppercase tracking-[0.14em] text-dim">{m.label}</div>
              <div className="text-xl font-bold tabular mt-1 leading-tight text-fg">{m.value}</div>
              <div className="text-[9px] text-dim mt-px uppercase tracking-wider">{m.hint}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 02 Continue working */}
      <section>
        <SectionBar
          num="02"
          title="Continue working"
          action={
            <Link href="/library" className="text-white/80 text-[10px] uppercase tracking-wider hover:text-white inline-flex items-center gap-1">
              Library <ArrowRight size={10} />
            </Link>
          }
        />
        <div className="grid lg:grid-cols-3">
          <div className="lg:col-span-2 border-r border-border">
            <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Saved projects</span>
              {loading ? <Spinner label="Loading" /> : <span className="text-[11px] tabular text-dim">{projects.length}</span>}
            </div>
            {loading ? (
              <div className="p-3 space-y-1.5">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8 w-3/4" />
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
                    <Link href="/company" className="text-[11px] text-accent inline-flex items-center gap-1 uppercase tracking-wider">
                      Open a company <ArrowRight size={11} />
                    </Link>
                  )
                }
              />
            ) : (
              <ul>
                {projects.slice(0, 7).map((project) => (
                  <li key={project.id} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/company/${encodeURIComponent(project.ticker)}?project=${project.id}`}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-hover transition-colors group"
                    >
                      <span className="text-[11px] font-bold text-accent w-24 shrink-0 truncate">{project.ticker}</span>
                      <span className="text-[12px] truncate flex-1 min-w-0">{project.name}</span>
                      <span className="text-[10px] text-dim whitespace-nowrap hidden sm:block tabular">{localDate(project.updated_at)}</span>
                      <ArrowUpRight size={12} className="text-dim shrink-0 group-hover:text-accent transition-colors" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-3">
              <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Recently opened</span>
              <span className="text-[11px] tabular text-dim">{recent.length}</span>
            </div>
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-[11px] text-dim text-center uppercase tracking-wider">
                Workspaces open here
              </div>
            ) : (
              <ul>
                {recent.map((item) => (
                  <li key={item} className="border-b border-border last:border-b-0">
                    <Link
                      href={`/company/${encodeURIComponent(item)}`}
                      className="flex items-center gap-2 px-4 py-2 hover:bg-hover transition-colors group"
                    >
                      <span className="text-[12px] font-bold text-accent">{item}</span>
                      <span className="text-[10px] text-dim ml-auto uppercase tracking-wider">Open</span>
                      <ArrowUpRight size={11} className="text-dim group-hover:text-accent transition-colors" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 03 Workspaces */}
      <section>
        <SectionBar num="03" title="Workspaces" />
        <nav aria-label="Application sections" className="grid-visible grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {ENTRY_POINTS.map(({ href, label, body, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group p-4 hover:bg-hover transition-colors flex flex-col gap-2 min-w-0"
            >
              <div className="grid place-items-center h-7 w-7 bg-accent/10 border border-accent/30 text-accent group-hover:border-accent transition-colors shrink-0">
                <Icon size={14} aria-hidden />
              </div>
              <div>
                <span className="text-[12px] font-bold leading-snug block uppercase tracking-wide">{label}</span>
                <span className="text-[10px] text-dim leading-snug mt-0.5 block">{body}</span>
              </div>
              <ArrowUpRight size={12} className="text-dim group-hover:text-accent transition-colors mt-auto" aria-hidden />
            </Link>
          ))}
        </nav>
      </section>

      {/* 04 Pipeline */}
      <section>
        <SectionBar num="04" title="Pipeline" />
        <div className="grid-visible grid-cols-1 md:grid-cols-5">
          {FLOW.map(({ title, body, icon: Icon }, index) => (
            <div key={title} className="p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center h-6 w-6 bg-accent text-white text-[10px] font-bold shrink-0">
                  {index + 1}
                </span>
                <Icon size={13} className="text-accent" aria-hidden />
                <span className="text-[11px] font-bold uppercase tracking-wider">{title}</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 05 Status */}
      <section>
        <SectionBar num="05" title="System status" />
        <div className="grid lg:grid-cols-3">
          <div className="lg:col-span-2 p-4 border-r border-border">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-dim">Saved projects</dt>
                <dd className="tabular font-medium">{loading ? "—" : projects.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-dim">AI models enabled</dt>
                <dd className="tabular font-medium">{loading ? "—" : enabledModels}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-dim">Data engine</dt>
                <dd>
                  <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
                    {health === "ok" ? "ready" : health === "down" ? "error" : "starting"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-dim">Model integrity</dt>
                <dd className="flex items-center gap-1.5 text-pos font-medium">
                  <ShieldCheck size={12} aria-hidden /> Deterministic
                </dd>
              </div>
            </dl>
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-wider">
              <Link href="/library" className="text-accent inline-flex items-center gap-1 hover:underline">Library <ArrowRight size={10} /></Link>
              <Link href="/ai" className="text-accent inline-flex items-center gap-1 hover:underline">AI Center <ArrowRight size={10} /></Link>
              <Link href="/company" className="text-accent inline-flex items-center gap-1 hover:underline">Company <ArrowRight size={10} /></Link>
            </div>
          </div>

          <div className="p-4">
            <h3 className="text-[11px] uppercase tracking-[0.14em] text-dim mb-2">AI optional</h3>
            <p className="text-[11px] text-muted leading-relaxed">
              Research reports need at least one configured model (OpenRouter, Groq, NVIDIA NIM or any OpenAI-compatible
              endpoint). Keys stay in local storage. Without a model, every deterministic workflow still works.
            </p>
            <Link href="/ai" className="text-[11px] text-accent inline-flex items-center gap-1 mt-2 hover:underline uppercase tracking-wider">
              Configure providers <ArrowRight size={10} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="text-[10px] text-dim border-t border-border px-6 md:px-10 py-3 flex flex-wrap items-center justify-between gap-2 uppercase tracking-wider">
        <span>
          Formulas in <span className="text-muted">docs/MODELS.md</span> · Architecture in <span className="text-muted">docs/ARCHITECTURE.md</span>
        </span>
        <span>Research software, not investment advice</span>
      </footer>
    </div>
  );
}
