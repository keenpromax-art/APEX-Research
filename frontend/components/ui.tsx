"use client";

import { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-surface border border-border rounded-lg", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {subtitle ? <div className="text-xs text-muted mt-0.5">{subtitle}</div> : null}
      </div>
      {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-md p-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted truncate">{label}</div>
      <div className={cn("text-lg font-semibold tabular mt-1 truncate", tone)}>{value}</div>
      {hint ? <div className="text-[11px] text-muted mt-0.5 truncate">{hint}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "pos" | "neg" | "warn";
}) {
  const tones: Record<string, string> = {
    muted: "border-border text-muted",
    accent: "border-accent/40 text-accent bg-accent/10",
    pos: "border-pos/40 text-pos bg-pos/10",
    neg: "border-neg/40 text-neg bg-neg/10",
    warn: "border-warn/40 text-warn bg-warn/10",
  };
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", tones[tone])}>
      {children}
    </span>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly string[];
  value: string;
  onChange: (tab: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 border-b border-border overflow-x-auto", className)}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={cn(
            "px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors",
            value === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Inbox size={22} className="text-muted" />
      <div className="text-sm font-medium">{title}</div>
      {body ? <div className="text-xs text-muted max-w-sm">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <Loader2 size={14} className="animate-spin" />
      {label || "Working..."}
    </span>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-neg/40 bg-neg/10 px-3 py-2 text-xs text-neg">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
      {onRetry ? (
        <button onClick={onRetry} className="ml-auto shrink-0 underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted">{children}</div>;
}

export function Field({
  label,
  value,
  onChange,
  step,
  placeholder,
  hint,
  type = "number",
  className,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  step?: string;
  placeholder?: string;
  hint?: string;
  type?: "number" | "text" | "password" | "date";
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1 min-w-0", className)}>
      <span className="text-[11px] text-muted truncate" title={humanize(label)}>
        {humanize(label)}
      </span>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="bg-panel border border-border rounded-md px-2 py-1.5 text-sm focus:border-accent outline-none tabular"
      />
      {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] text-muted truncate">{humanize(label)}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-panel border border-border rounded-md px-2 py-1.5 text-sm focus:border-accent outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-auto", className)}>{children}</div>;
}

export function SparklineNote({ children }: { children: ReactNode }) {
  return <div className="text-[11px] text-muted">{children}</div>;
}
