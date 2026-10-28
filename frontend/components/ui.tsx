"use client";

import { KeyboardEvent, ReactNode, useRef } from "react";
import { AlertTriangle, Inbox, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  const variants: Record<string, string> = {
    primary: "btn-accent border border-accent shadow-xs",
    secondary: "bg-panel text-fg hover:bg-hover border border-border hover:border-border-strong",
    ghost: "bg-transparent text-muted hover:bg-panel hover:text-fg border border-transparent",
    danger: "bg-neg/10 text-neg hover:bg-neg/20 border border-neg/40",
  };
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-sm",
  };
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-surface border border-border rounded-xl shadow-xs card-interactive", className)}>{children}</div>;
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
    <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-tight text-fg">{title}</div>
        {subtitle ? <div className="text-xs text-muted mt-1 leading-relaxed">{subtitle}</div> : null}
      </div>
      {action ? <div className="shrink-0 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  compact,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("bg-surface border border-border rounded-xl min-w-0 shadow-xs", compact ? "px-3 py-2" : "p-4")}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted truncate font-medium">{label}</div>
      <div className={cn(compact ? "text-base" : "text-2xl", "font-semibold tabular mt-1.5 truncate leading-tight", tone)}>{value}</div>
      {hint ? <div className="text-[11px] text-muted mt-1 truncate">{hint}</div> : null}
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
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]", tones[tone])}>
      {children}
    </span>
  );
}

export function tabId(base: string, tab: string) {
  return `${base}-tab-${tab.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
  idBase = "tabs",
}: {
  tabs: readonly string[];
  value: string;
  onChange: (tab: string) => void;
  className?: string;
  idBase?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const index = tabs.indexOf(value);
    const count = tabs.length;
    if (count <= 1) return;
    let next = index;
    if (event.key === "ArrowLeft") next = index <= 0 ? count - 1 : index - 1;
    else if (event.key === "ArrowRight") next = index >= count - 1 ? 0 : index + 1;
    else if (event.key === "Home") next = 0;
    else next = count - 1;
    event.preventDefault();
    onChange(tabs[next]);
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    buttons?.[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn("flex items-end gap-1 border-b border-border overflow-x-auto", className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          id={tabId(idBase, tab)}
          role="tab"
          type="button"
          aria-selected={value === tab}
          aria-controls={`${idBase}-panel`}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          className={cn(
            "px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-t-md",
            value === tab
              ? "border-accent text-fg font-semibold bg-accent/5"
              : "border-transparent text-muted hover:text-fg hover:bg-panel/60",
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idBase = "tabs",
  active,
  children,
  className,
}: {
  idBase?: string;
  active: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel`}
      aria-labelledby={tabId(idBase, active)}
      className={className}
    >
      {children}
    </div>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-auto", className)}>{children}</div>;
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
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-4">
      <div className="grid place-items-center h-10 w-10 rounded-xl bg-panel border border-border text-dim mb-1">
        <Inbox size={18} aria-hidden />
      </div>
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      {body ? <div className="text-xs text-muted max-w-sm leading-relaxed">{body}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" role="status">
      <Loader2 size={14} className="animate-spin" aria-hidden />
      {label || "Working..."}
    </span>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-neg/40 bg-neg/10 px-4 py-3 text-sm text-neg"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{message}</span>
      {onRetry ? (
        <button onClick={onRetry} className="ml-auto shrink-0 underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function WarnBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
    >
      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-muted">
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-panel rounded-md animate-pulse", className)} />;
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
      <span className="text-[11px] text-muted truncate font-medium" title={humanize(label)}>
        {humanize(label)}
      </span>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="bg-panel border border-border rounded-lg px-3 py-2 text-sm focus:border-accent focus:bg-hover outline-none tabular transition-colors"
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
      <span className="text-[11px] text-muted truncate font-medium">{humanize(label)}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-panel border border-border rounded-lg px-3 py-2 text-sm focus:border-accent focus:bg-hover outline-none transition-colors"
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


