"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Card, CardHeader, ErrorBanner, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

type Project = { id: number; name: string; ticker: string; updated_at: string };
type Suggestion = { symbol: string; name: string; exchange: string; quote_type: string };

export default function CompanyIndex() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestIdRef = useRef(0);
  const suppressRef = useRef(false);

  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch((loadError) => setError(getErrorMessage(loadError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const query = ticker.trim();
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      api<{ results: Suggestion[] }>(`/api/ticker/search?q=${encodeURIComponent(query)}`)
        .then((data) => {
          if (requestId !== requestIdRef.current || suppressRef.current) return;
          setSuggestions(data.results);
          setActiveIndex(-1);
          setShowSuggestions(data.results.length > 0);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current || suppressRef.current) return;
          setSuggestions([]);
          setShowSuggestions(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [ticker]);

  function openWith(symbol: string) {
    const value = symbol.trim().toUpperCase();
    if (value) router.push(`/company/${encodeURIComponent(value)}`);
  }

  function resolveTarget(): string {
    const typed = ticker.trim();
    const active = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
    if (active) return active.symbol;
    if (/\s/.test(typed) && suggestions.length > 0) {
      const exact = suggestions.find((row) => row.symbol.toUpperCase() === typed.toUpperCase());
      return exact ? exact.symbol : suggestions[0].symbol;
    }
    return typed;
  }

  function open(event: FormEvent) {
    event.preventDefault();
    openWith(resolveTarget());
  }

  function selectSuggestion(symbol: string) {
    suppressRef.current = true;
    setTicker(symbol);
    setShowSuggestions(false);
    setActiveIndex(-1);
    openWith(symbol);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setShowSuggestions(false);
      return;
    }
    if (!showSuggestions || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    }
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
              onChange={(event) => {
                suppressRef.current = false;
                setTicker(event.target.value);
              }}
              onKeyDown={handleKeyDown}
              onBlur={() => setShowSuggestions(false)}
              onFocus={() => {
                if (suggestions.length > 0 && ticker.trim().length >= 2) setShowSuggestions(true);
              }}
              placeholder="Search any company, e.g. Inox Wind, AAPL, RELIANCE.NS"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls="ticker-suggestions"
              aria-activedescendant={activeIndex >= 0 ? `ticker-option-${activeIndex}` : undefined}
              aria-autocomplete="list"
              className="w-full bg-panel border border-border rounded-md pl-9 pr-3 py-2.5 text-sm focus:border-accent outline-none"
            />
            {showSuggestions && suggestions.length > 0 ? (
              <ul
                id="ticker-suggestions"
                role="listbox"
                className="absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-y-auto rounded-md border border-border bg-panel shadow-xl"
              >
                {suggestions.map((row, index) => (
                  <li
                    key={row.symbol}
                    id={`ticker-option-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(row.symbol)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-border last:border-b-0",
                      index === activeIndex ? "bg-accent/15" : "hover:bg-panel/70",
                    )}
                  >
                    <span className="text-xs font-semibold text-accent w-28 shrink-0 truncate">{row.symbol}</span>
                    <span className="text-xs flex-1 truncate">{row.name}</span>
                    <span className="text-[10px] text-muted shrink-0">
                      {row.exchange}
                      {row.quote_type && row.quote_type !== "EQUITY" ? ` · ${row.quote_type}` : ""}
                    </span>
                  </li>
                ))}
                <li role="presentation" className="px-3 py-1.5 text-[10px] text-muted border-t border-border bg-panel/60">
                  All Yahoo Finance listings · ↑↓ to navigate, Enter to open
                </li>
              </ul>
            ) : null}
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
