"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Card, CardHeader, ErrorBanner, Spinner } from "@/components/ui";

type Project = { id: number; name: string; ticker: string; updated_at: string };

export default function CompanyIndex() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch((loadError) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false));
  }, []);

  function open(event: FormEvent) {
    event.preventDefault();
    const value = ticker.trim().toUpperCase();
    if (value) router.push(`/company/${encodeURIComponent(value)}`);
  }

  return (
    <div className="p-5 md:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Company workspace</h1>
        <p className="text-sm text-muted">Open a ticker to review statements, forecast, value and write research.</p>
      </div>

      <Card className="p-4">
        <form onSubmit={open} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="Ticker, e.g. AAPL, MSFT, RELIANCE.NS"
              className="w-full bg-panel border border-border rounded-md pl-9 pr-3 py-2.5 text-sm focus:border-accent outline-none"
            />
          </div>
          <button type="submit" className="bg-accent text-black px-4 py-2.5 rounded-md text-sm font-medium">
            Open
          </button>
          <Link href="/company/DEMO" className="border border-border rounded-md px-4 py-2.5 text-sm text-center hover:bg-panel">
            Demo
          </Link>
        </form>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <CardHeader title="Saved workspaces" subtitle="Projects are stored server-side in SQLite or Postgres." />
        <div className="p-3">
          {loading ? (
            <div className="p-3"><Spinner label="Loading projects" /></div>
          ) : projects.length === 0 ? (
            <div className="text-xs text-muted p-3">No saved projects yet.</div>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/company/${encodeURIComponent(project.ticker)}?project=${project.id}`}
                    className="flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-panel"
                  >
                    <span className="text-xs font-semibold text-accent w-20 truncate">{project.ticker}</span>
                    <span className="text-xs flex-1 truncate">{project.name}</span>
                    <span className="text-[10px] text-muted">{localDate(project.updated_at)}</span>
                    <ArrowRight size={13} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
