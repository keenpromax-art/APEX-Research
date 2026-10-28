"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Keyboard, Moon, RefreshCw, Server, ShieldCheck, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/components/ThemeProvider";
import { Badge, Button, Card, CardHeader, InfoBanner, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

type Health = { status?: string; service?: string; version?: string };

const SHORTCUTS = [
  { keys: "Ctrl / ⌘ + K", action: "Focus the ticker search" },
  { keys: "/", action: "Focus search (when not typing)" },
  { keys: "Esc", action: "Close the mobile navigation overlay" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [healthInfo, setHealthInfo] = useState<Health | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [projects, setProjects] = useState<number | null>(null);
  const [models, setModels] = useState<number | null>(null);
  const [enabledModels, setEnabledModels] = useState<number | null>(null);

  const check = useCallback(async () => {
    setHealth("checking");
    const started = performance.now();
    try {
      const body = await api<Health>("/health");
      setLatency(Math.round(performance.now() - started));
      setHealth(body.status === "ok" ? "ok" : "down");
      setHealthInfo(body);
    } catch {
      setHealth("down");
      setHealthInfo(null);
      setLatency(null);
    }
    const [projectRows, modelRows] = await Promise.all([
      api<unknown[]>("/api/projects").catch(() => null),
      api<{ enabled: boolean }[]>("/api/ai/models").catch(() => null),
    ]);
    setProjects(projectRows ? projectRows.length : null);
    setModels(modelRows ? modelRows.length : null);
    setEnabledModels(modelRows ? modelRows.filter((model) => model.enabled).length : null);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <div className="p-5 md:p-7 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-xs text-muted mt-1">Local display preferences and a read-only view of the engine status.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Appearance" subtitle="Stored in this browser only" action={<Badge tone="muted">{theme}</Badge>} />
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "dark", label: "Dark", icon: Moon, hint: "Default terminal palette" },
                { value: "light", label: "Light", icon: Sun, hint: "High-ambient-light palette" },
              ] as const).map(({ value, label, icon: Icon, hint }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2.5 text-left transition-colors",
                    theme === value ? "border-accent bg-accent/5" : "border-border hover:bg-panel",
                  )}
                >
                  <Icon size={15} className={theme === value ? "text-accent mt-0.5" : "text-muted mt-0.5"} />
                  <span className="min-w-0">
                    <span className="text-sm flex items-center gap-1.5">
                      {label}
                      {theme === value ? <Check size={12} className="text-accent" /> : null}
                    </span>
                    <span className="text-[10px] text-muted block mt-0.5">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    try {
                      localStorage.removeItem("apex-theme");
                    } catch {
                      // ignore
                    }
                    setTheme("dark");
                  }}
                >
                  Reset preference
                </Button>
              <span className="text-[11px] text-muted">Theme choice never leaves this device.</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Local engine"
            subtitle="Every calculation runs in this browser — no server required"
            action={
              <Button variant="secondary" size="sm" onClick={check}>
                <RefreshCw size={12} /> Recheck
              </Button>
            }
          />
          <div className="p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Runtime</span>
              <span className="mono text-right break-all">{healthInfo?.service || "apex-client-engine"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Status</span>
              <Badge tone={health === "ok" ? "pos" : health === "down" ? "neg" : "muted"}>
                {health === "checking" ? "checking" : health === "ok" ? "ready" : "error"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Version</span>
              <span className="mono">{healthInfo?.version || "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Call latency</span>
              <span className="tabular">{latency !== null ? `${latency} ms` : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Projects / models</span>
              <span className="tabular">
                {projects ?? "—"} / {models ?? "—"}
                {enabledModels !== null ? ` (${enabledModels} enabled)` : ""}
              </span>
            </div>
            {health === "checking" ? <Spinner label="Checking engine" /> : null}
            {health === "down" ? (
              <div className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">
                The local engine did not respond. Reload the page — nothing is installed on a server.
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Keyboard shortcuts" subtitle="Work the terminal without the mouse" />
          <div className="p-4 space-y-2">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted">{shortcut.action}</span>
                <kbd className="mono text-[10px] border border-border rounded px-1.5 py-0.5 bg-panel whitespace-nowrap">{shortcut.keys}</kbd>
              </div>
            ))}
            <div className="text-[11px] text-muted pt-1 flex items-center gap-1.5">
              <Keyboard size={12} /> Shortcuts are disabled while typing in an input.
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Data and privacy" subtitle="Where your information lives" />
          <div className="p-4 space-y-2 text-xs text-muted">
            <div className="flex items-start gap-2">
              <Server size={13} className="mt-0.5 text-accent shrink-0" />
              <span>Forecasts, valuations and PDF/Excel exports are generated by the in-browser engine. Fundamentals come from the market-data provider (Yahoo Finance) when reachable; if it is unreachable a clearly labelled synthetic fixture is used. Nothing is uploaded.</span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck size={13} className="mt-0.5 text-pos shrink-0" />
              <span>AI keys live in this browser&apos;s local storage and are only sent to the provider endpoint you configured.</span>
            </div>
            <div className="flex items-start gap-2">
              <Check size={13} className="mt-0.5 text-pos shrink-0" />
              <span>Projects, models and report versions live in this browser&apos;s local storage; deleting them is immediate and permanent.</span>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href="/ai" className="text-accent">AI providers</Link>
              <Link href="/library" className="text-accent">Library</Link>
              <Link href="/company/SAMPLE" className="text-accent">Sample workspace</Link>
            </div>
          </div>
        </Card>
      </div>

      <InfoBanner>
        This is research software, not investment advice. Market data can be delayed, incomplete or wrong; verify figures before acting on them.
      </InfoBanner>
    </div>
  );
}
