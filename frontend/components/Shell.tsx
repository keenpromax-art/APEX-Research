"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Calculator,
  Cpu,
  FileText,
  Home,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Home", icon: Home, group: "Workspace" },
  { href: "/company", label: "Company", icon: BarChart3, group: "Workspace" },
  { href: "/modelling", label: "Modelling", icon: Calculator, group: "Workspace" },
  { href: "/research", label: "Research", icon: FileText, group: "Workspace" },
  { href: "/ai", label: "AI Center", icon: Cpu, group: "Configure" },
  { href: "/library", label: "Library", icon: BookOpen, group: "Configure" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Configure" },
];

const COMPACT_KEY = "apex-sidebar-compact";

function ApexMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="apexMark" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
      <path d="M12 3 L21 20 H17.2 L12 10.6 L6.8 20 H3 Z" fill="url(#apexMark)" />
      <path d="M12 3 L15.5 9.6 H8.5 Z" fill="var(--bg)" opacity="0.55" />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(COMPACT_KEY) === "1") setCompact(true);
    } catch {
      // storage unavailable — stay expanded
    }
  }, []);

  function toggleCompact() {
    setCompact((current) => {
      const next = !current;
      try {
        localStorage.setItem(COMPACT_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      drawerRef.current?.focus();
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const ticker = q.trim().toUpperCase();
    if (!ticker) return;
    setOpen(false);
    router.push(`/company/${encodeURIComponent(ticker)}`);
    setQ("");
  }

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-surface border-r border-border transition-[transform,width] duration-200 md:static md:translate-x-0",
          compact ? "md:w-[68px]" : "md:w-[232px]",
          "w-[260px]",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        )}
        aria-label="Primary navigation"
      >
        {/* Brand */}
        <div className={cn("h-14 flex items-center border-b border-border shrink-0", compact ? "md:justify-center px-3" : "px-4 gap-2.5")}>
          <Link href="/" className="flex items-center gap-2.5 min-w-0" onClick={() => setOpen(false)} title="APEX Research — home">
            <span className="shrink-0 grid place-items-center h-8 w-8 rounded-lg bg-gradient-to-br from-accent/20 to-cyan/10 border border-accent/30 shadow-xs">
              <ApexMark size={18} />
            </span>
            <span className={cn("flex flex-col leading-none min-w-0", compact && "md:hidden")}>
              <span className="font-semibold tracking-tight text-fg text-[15px]">APEX</span>
              <span className="text-[9px] text-muted uppercase tracking-[0.22em] mt-0.5">Research</span>
            </span>
          </Link>
          <button
            className="ml-auto md:hidden p-1.5 rounded-md hover:bg-panel text-muted"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-auto py-3 px-2 space-y-5" aria-label="Sections">
          {groups.map((group) => (
            <div key={group}>
              <div className={cn("px-2.5 mb-1.5 text-[10px] uppercase tracking-[0.16em] text-dim font-semibold", compact && "md:hidden")}>
                {group}
              </div>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === group).map(({ href, label, icon: Icon }) => {
                  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      title={label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-md text-sm transition-colors border-l-2",
                        compact ? "md:justify-center md:px-2 md:py-2" : "px-2.5 py-2",
                        active
                          ? "bg-accent/10 text-fg border-accent"
                          : "text-muted hover:bg-panel hover:text-fg border-transparent",
                      )}
                    >
                      <Icon
                        size={16}
                        className={cn("shrink-0 transition-colors", active ? "text-accent" : "text-muted group-hover:text-fg")}
                        aria-hidden
                      />
                      <span className={cn("truncate", compact && "md:hidden")}>{label}</span>
                      {active && !compact ? (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-hidden />
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer controls */}
        <div className={cn("border-t border-border shrink-0", compact ? "md:py-2 px-2 py-2.5" : "px-3 py-2.5")}>
          <div className={cn("flex items-center gap-1", compact ? "md:flex-col" : "")}>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-panel text-muted hover:text-fg transition-colors"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <span className={cn("text-xs text-muted capitalize", compact && "md:hidden")}>{theme} mode</span>
            <button
              onClick={toggleCompact}
              className="hidden md:inline-flex p-2 rounded-md hover:bg-panel text-muted hover:text-fg transition-colors ml-auto"
              aria-label={compact ? "Expand sidebar" : "Compact sidebar"}
              aria-pressed={compact}
              title={compact ? "Expand sidebar" : "Compact sidebar"}
            >
              {compact ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
          <div className={cn("mt-2 flex items-center justify-between", compact && "md:hidden")}>
            <span className="text-[10px] text-dim border border-border rounded px-1.5 py-0.5">v0.2</span>
            <span className="text-[10px] text-dim">Local engine</span>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <header className="h-14 border-b border-border flex items-center px-3 md:px-5 gap-3 bg-surface/80 backdrop-blur-md shrink-0">
          <button
            className="md:hidden p-2 -m-1 rounded-md hover:bg-panel min-w-[36px] min-h-[36px] flex items-center justify-center text-muted"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>

          <form onSubmit={submitSearch} className="flex-1 max-w-2xl relative" role="search">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              ref={searchRef}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search ticker — AAPL, MSFT, RELIANCE.NS"
              className="w-full bg-panel border border-border rounded-lg pl-9 pr-20 py-2 text-sm focus:border-accent focus:bg-hover outline-none transition-colors"
              aria-label="Ticker search"
            />
            <kbd className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted border border-border rounded-md px-1.5 py-0.5 bg-surface items-center gap-1 pointer-events-none">
              <span>⌘K</span>
              <span className="text-dim">/</span>
            </kbd>
          </form>

          <Link
            href="/company/SAMPLE"
            className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg whitespace-nowrap border border-border rounded-lg px-3 py-2 hover:border-accent/50 hover:bg-panel transition-colors"
            title="Open the sample company"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden />
            Try sample
          </Link>
        </header>

        <main className="flex-1 overflow-auto" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
