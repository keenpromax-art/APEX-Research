"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BarChart3, BookOpen, Calculator, Cpu, Database, Search, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Badge, Card, CardHeader, Spinner } from "@/components/ui";

type Project = { id: number; name: string; ticker: string; description?: string | null; updated_at: string };
type Model = { name: string; provider: string; enabled: boolean; source: string };

const FLOW = [
  {
    title: "Pull statements",
    body: "Normalize annual and quarterly statements in the browser, with missing data surfaced instead of zero-filled.",
    icon: Database,
  },
  {
    title: "Model the business",
    body: "Build a linked three-statement forecast with a cash revolver, then flex growth, margins and working capital.",
    icon: BarChart3,
  },
  {
    title: "Value it",
    body: "Run DCF, reverse DCF, WACC and two-way sensitivity with deterministic, tested code.",
    icon: Calculator,
  },
  {
    title: "Write the note",
    body: "Generate an AI-assisted research draft grounded in verified metrics, then export Excel or PDF.",
    icon: Sparkles,
  },
];

export default function Home() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api<Project[]>("/api/projects").catch(() => []),
      api<Model[]>("/api/ai/models").catch(() => []),
      api<{ status?: string }>("/health").then((body) => body.status === "ok").catch(() => false),
    ])
      .then(([projectRows, modelRows, engineOk]) => {
        if (!active) return;
        setProjects(projectRows);
        setModels(modelRows);
        setHealth(engineOk ? "ok" : "down");
      })
      .catch(() => undefined)
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
    <div className="p-5 md:p-8 space-y-6 max-w-7xl mx-auto">
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface p-6 md:p-8">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_15%_10%,color-mix(in_srgb,var(--accent)_16%,transparent),transparent_38%)]" />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <Badge tone="accent">Equity research</Badge>
            <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
              {health === "ok" ? "Local engine" : health === "down" ? "Engine error" : "Starting engine"}
            </Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Ticker to investment view, without spreadsheet archaeology.
          </h1>
          <p className="text-sm text-muted mt-2 max-w-2xl">
            Pull the financials, build a linked forecast, value the business, and draft a research note.
            Every number is produced by tested code — AI only writes the narrative.
          </p>
          <form onSubmit={openTicker} className="mt-5 flex flex-col sm:flex-row gap-2 max-w-xl">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
                placeholder="Enter a ticker, e.g. AAPL, MSFT, RELIANCE.NS"
                className="w-full bg-panel border border-border rounded-md pl-9 pr-3 py-2.5 text-sm focus:border-accent outline-none"
                aria-label="Ticker"
              />
            </div>
            <button type="submit" className="bg-accent text-black px-4 py-2.5 rounded-md text-sm font-medium hover:opacity-90">
              Open workspace
            </button>
            <Link
              href="/company/SAMPLE"
              className="border border-border rounded-md px-4 py-2.5 text-sm text-center hover:bg-panel whitespace-nowrap"
            >
                Try sample
            </Link>
          </form>
          <div className="mt-3 text-[11px] text-muted">
            Everything runs in this browser — fundamentals, forecasts, valuation and exports come from the local engine.
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">Projects</div>
          <div className="text-2xl font-semibold tabular mt-1">{loading ? "—" : projects.length}</div>
          <Link href="/library" className="text-xs text-accent inline-flex items-center gap-1 mt-1">
            Open library <ArrowRight size={12} />
          </Link>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">AI models ready</div>
          <div className="text-2xl font-semibold tabular mt-1">{loading ? "—" : enabledModels}</div>
          <Link href="/ai" className="text-xs text-accent inline-flex items-center gap-1 mt-1">
            Configure <ArrowRight size={12} />
          </Link>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">Data engine</div>
          <div className="text-sm font-medium mt-1">in-browser engine</div>
          <div className="text-[11px] text-muted mt-1">Missing data is labelled, never silent.</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">Model integrity</div>
          <div className="text-sm font-medium mt-1 flex items-center gap-1">
            <ShieldCheck size={14} className="text-pos" /> Deterministic
          </div>
          <div className="text-[11px] text-muted mt-1">AI cannot set final figures.</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="The workflow" subtitle="Four steps, one workspace, exportable outputs." />
          <div className="grid sm:grid-cols-2 gap-3 p-4">
            {FLOW.map(({ title, body, icon: Icon }, index) => (
              <div key={title} className="rounded-lg border border-border bg-panel/60 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Icon size={15} className="text-accent" />
                  <div className="text-sm font-medium">{title}</div>
                </div>
                <p className="text-xs text-muted mt-2 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent projects"
            subtitle={projects.length ? "Reopen your saved work" : "Save a workspace to see it here"}
            action={<Link href="/library" className="text-xs text-accent">All</Link>}
          />
          <div className="p-3">
            {loading ? (
              <div className="p-3"><Spinner label="Loading projects" /></div>
            ) : projects.length === 0 ? (
              <div className="text-xs text-muted p-3">
                No projects yet. Open a ticker and use <span className="text-fg">Save project</span>.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {projects.slice(0, 6).map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/company/${encodeURIComponent(project.ticker)}?project=${project.id}`}
                      className="flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-panel"
                    >
                      <span className="text-xs font-semibold text-accent w-16 truncate">{project.ticker}</span>
                      <span className="text-xs truncate flex-1">{project.name}</span>
                      <span className="text-[10px] text-muted whitespace-nowrap">{localDate(project.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cpu size={15} className="text-accent" /> AI is optional
          </div>
          <p className="text-xs text-muted mt-2 leading-relaxed">
            Research reports need at least one configured model (OpenRouter, Groq, NVIDIA NIM or any OpenAI-compatible
            endpoint). Keys stay in this browser&apos;s local storage. Without a model, every deterministic workflow still
            works.
          </p>
          <Link href="/ai" className="text-xs text-accent inline-flex items-center gap-1 mt-3">
            AI Control Center <ArrowRight size={12} />
          </Link>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BookOpen size={15} className="text-accent" /> Read the model docs
          </div>
          <p className="text-xs text-muted mt-2 leading-relaxed">
            Formulas, sign conventions and engine behaviour live in docs/MODELS.md. The architecture and current
            limitations are documented in docs/ARCHITECTURE.md.
          </p>
          <div className="text-[11px] text-muted mt-3">Available in the repository under <span className="mono">docs/</span>.</div>
        </Card>
      </div>
    </div>
  );
}
