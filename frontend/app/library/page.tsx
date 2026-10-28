"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, FolderOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, getErrorMessage } from "@/lib/api";
import { localDate } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBanner, InfoBanner, Spinner } from "@/components/ui";

type Project = {
  id: number;
  name: string;
  ticker: string;
  description?: string | null;
  updated_at: string;
};

type SavedModel = {
  id: number;
  name: string;
  kind: string;
  ticker?: string | null;
  project_id?: number | null;
  updated_at: string;
};

const MODELLING_KINDS = new Set(["lbo", "option", "bond", "wacc"]);

function kindLabel(kind: string) {
  const normalized = (kind || "").toLowerCase();
  if (normalized === "three_statement") return "Forecast";
  if (normalized === "option") return "Options";
  if (normalized === "lbo") return "LBO";
  if (normalized === "bond") return "Bond";
  if (normalized === "wacc") return "WACC";
  return kind || "Model";
}

function modelHref(model: SavedModel) {
  const kind = (model.kind || "").toLowerCase();
  if (MODELLING_KINDS.has(kind)) return `/modelling?model=${model.id}`;
  if (model.ticker && model.project_id) {
    return `/company/${encodeURIComponent(model.ticker)}?project=${model.project_id}`;
  }
  if (model.ticker) return `/company/${encodeURIComponent(model.ticker)}`;
  return null;
}

export default function LibraryPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [models, setModels] = useState<SavedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [projectRows, modelRows] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<SavedModel[]>("/api/projects/models/saved"),
      ]);
      setProjects(projectRows);
      setModels(modelRows);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`Delete the project “${project.name}”? This cannot be undone.`)) return;
    setBusy(`project-${project.id}`);
    setError(null);
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      setProjects((current) => current.filter((row) => row.id !== project.id));
      flash(`Deleted project “${project.name}”.`);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(null);
    }
  }

  async function deleteModel(model: SavedModel) {
    if (!window.confirm(`Delete the saved model “${model.name}”? This cannot be undone.`)) return;
    setBusy(`model-${model.id}`);
    setError(null);
    try {
      await api(`/api/projects/models/saved/${model.id}`, { method: "DELETE" });
      setModels((current) => current.filter((row) => row.id !== model.id));
      flash(`Deleted model “${model.name}”.`);
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setBusy(null);
    }
  }

  const needle = query.trim().toLowerCase();
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        !needle || `${project.ticker} ${project.name} ${project.description || ""}`.toLowerCase().includes(needle),
      ),
    [needle, projects],
  );
  const filteredModels = useMemo(
    () => models.filter((model) => !needle || `${model.ticker || ""} ${model.name} ${model.kind}`.toLowerCase().includes(needle)),
    [models, needle],
  );

  return (
    <div className="px-5 md:px-8 lg:px-10 py-6 md:py-8 max-w-[1680px] mx-auto space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookOpen size={18} className="text-accent" /> Research Library
          </h1>
          <p className="text-xs text-muted mt-1">
            Saved workspaces and model snapshots. Projects reopen the full company workspace; standalone models reopen in the studio.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by ticker, name or kind"
              aria-label="Filter library"
              className="bg-panel border border-border rounded-md pl-8 pr-2 py-1.5 text-xs w-60 focus:border-accent outline-none"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <InfoBanner>{notice}</InfoBanner> : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">Projects</div>
          <div className="text-lg font-semibold tabular">{loading ? "—" : projects.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">Saved models</div>
          <div className="text-lg font-semibold tabular">{loading ? "—" : models.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">Forecast snapshots</div>
          <div className="text-lg font-semibold tabular">
            {loading ? "—" : models.filter((model) => (model.kind || "").toLowerCase() === "three_statement").length}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">Modelling snapshots</div>
          <div className="text-lg font-semibold tabular">
            {loading ? "—" : models.filter((model) => MODELLING_KINDS.has((model.kind || "").toLowerCase())).length}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Projects"
            subtitle={filteredProjects.length === projects.length ? `${projects.length} saved workspaces` : `${filteredProjects.length} of ${projects.length} shown`}
            action={<Link href="/company" className="text-xs text-accent">New research</Link>}
          />
          {loading ? (
            <div className="p-4"><Spinner label="Loading projects" /></div>
          ) : filteredProjects.length === 0 ? (
            <EmptyState
              title={projects.length ? "No matching projects" : "No projects yet"}
              body={projects.length ? "Clear the filter to see every saved workspace." : "Open a ticker workspace and save the project to keep its assumptions."}
              action={
                projects.length ? (
                  <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                    Clear filter
                  </Button>
                ) : (
                  <Link href="/company" className="btn-accent px-3 py-1.5 rounded-md text-xs font-medium">
                    Browse companies
                  </Link>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {filteredProjects.map((project) => (
                <li key={project.id} className="flex items-start gap-3 px-4 py-3 hover:bg-panel/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-accent">{project.ticker}</span>
                      <span className="text-sm truncate">{project.name}</span>
                    </div>
                    {project.description ? <div className="text-[11px] text-muted truncate mt-0.5">{project.description}</div> : null}
                    <div className="text-[10px] text-muted mt-1">Updated {localDate(project.updated_at)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/company/${encodeURIComponent(project.ticker)}?project=${project.id}`}
                      className="border border-border px-2.5 py-1 rounded-md text-[11px] hover:bg-panel inline-flex items-center gap-1"
                    >
                      <FolderOpen size={12} /> Open
                    </Link>
                    <button
                      onClick={() => deleteProject(project)}
                      disabled={busy === `project-${project.id}`}
                      className="text-neg p-1.5 hover:bg-panel rounded-md disabled:opacity-40"
                      title="Delete project"
                      aria-label={`Delete project ${project.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Saved models"
            subtitle={filteredModels.length === models.length ? `${models.length} snapshots` : `${filteredModels.length} of ${models.length} shown`}
            action={<Link href="/modelling" className="text-xs text-accent">Open studio</Link>}
          />
          {loading ? (
            <div className="p-4"><Spinner label="Loading models" /></div>
          ) : filteredModels.length === 0 ? (
            <EmptyState
              title={models.length ? "No matching models" : "No saved models yet"}
              body={
                models.length
                  ? "Clear the filter to see every saved snapshot."
                  : "Save a forecast from a company workspace, or a result from the modelling studio."
              }
              action={
                models.length ? (
                  <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                    Clear filter
                  </Button>
                ) : (
                  <Link href="/modelling" className="btn-accent px-3 py-1.5 rounded-md text-xs font-medium">
                    Open modelling
                  </Link>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {filteredModels.map((model) => {
                const href = modelHref(model);
                return (
                  <li key={model.id} className="flex items-start gap-3 px-4 py-3 hover:bg-panel/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone={(model.kind || "").toLowerCase() === "three_statement" ? "accent" : "muted"}>{kindLabel(model.kind)}</Badge>
                        <span className="text-sm truncate">{model.name}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-1">
                        {model.ticker ? <span className="text-fg mr-2">{model.ticker}</span> : null}
                        Updated {localDate(model.updated_at)}
                        {model.project_id ? ` · project #${model.project_id}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {href ? (
                        <Link href={href} className="border border-border px-2.5 py-1 rounded-md text-[11px] hover:bg-panel inline-flex items-center gap-1">
                          <ExternalLink size={12} /> Open
                        </Link>
                      ) : (
                        <span className="text-[10px] text-muted">No target</span>
                      )}
                      <button
                        onClick={() => deleteModel(model)}
                        disabled={busy === `model-${model.id}`}
                        className="text-neg p-1.5 hover:bg-panel rounded-md disabled:opacity-40"
                        title="Delete model"
                        aria-label={`Delete model ${model.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="text-[11px] text-muted">
        Deleting a project does not delete model snapshots. Snapshots are static copies and never silently update with new data.
      </div>
    </div>
  );
}
