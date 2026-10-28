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

function ApexMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 L21 20 H17.2 L12 10.6 L6.8 20 H3 Z" fill="#FFFFFF" />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [q, setQ] = useState("");
  const [clock, setClock] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(COMPACT_KEY) === "1") setCompact(true);
    } catch {}
  }, []);

  useEffect(() => {
    function tick() {
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  function toggleCompact() {
    setCompact((current) => {
      const next = !current;
      try {
        localStorage.setItem(COMPACT_KEY, next ? "1" : "0");
      } catch {}
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
      {/* Sidebar */}
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-elev border-r border-border md:static md:translate-x-0 transition-[transform,width] duration-100 ease-linear",
          compact ? "md:w-[56px]" : "md:w-[208px]",
          "w-[240px]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Primary navigation"
      >
        {/* Brand */}
        <div
          className={cn(
            "flex items-center border-b border-border shrink-0 bg-accent",
            compact ? "md:justify-center h-11 px-2" : "h-11 px-3 gap-2.5",
          )}
        >
          <Link
            href="/"
            className="flex items-center gap-2 min-w-0"
            onClick={() => setOpen(false)}
            title="APEX Research — home"
          >
            <span className="shrink-0 grid place-items-center h-6 w-6 bg-white/15">
              <ApexMark size={13} />
            </span>
            <span className={cn("flex flex-col leading-none min-w-0", compact && "md:hidden")}>
              <span className="text-white text-[13px] font-bold tracking-[0.08em]">APEX</span>
              <span className="text-white/60 text-[8px] uppercase tracking-[0.22em] mt-px">Research</span>
            </span>
          </Link>
          <button
            className="ml-auto md:hidden p-1 text-white/70 hover:text-white"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-auto py-2 px-0" aria-label="Sections">
          {groups.map((group, gi) => (
            <div key={group} className={cn(gi > 0 && "border-t border-border mt-2 pt-2")}>
              <div
                className={cn(
                  "px-3 mb-1 text-[9px] uppercase tracking-[0.18em] text-dim font-medium",
                  compact && "md:hidden",
                )}
              >
                {group}
              </div>
              <div>
                {NAV.filter((n) => n.group === group).map(({ href, label, icon: Icon }) => {
                  const active =
                    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      title={label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 text-[12px] transition-colors border-l-3",
                        compact ? "md:justify-center md:px-2 md:py-2" : "px-3 py-1.5",
                        active
                          ? "bg-hover text-fg border-accent font-medium"
                          : "text-muted hover:bg-hover hover:text-fg border-transparent",
                      )}
                    >
                      <Icon
                        size={14}
                        className={cn("shrink-0", active ? "text-accent" : "text-dim")}
                        aria-hidden
                      />
                      <span className={cn("truncate", compact && "md:hidden")}>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer controls */}
        <div className={cn("border-t border-border shrink-0", compact ? "md:py-2 px-2" : "px-3 py-2")}>
          <div className={cn("flex items-center gap-1", compact ? "md:flex-col" : "")}>
            <button
              onClick={toggleTheme}
              className="p-1.5 hover:bg-hover text-muted hover:text-fg transition-colors"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <span className={cn("text-[10px] text-dim uppercase tracking-wider", compact && "md:hidden")}>
              {theme}
            </span>
            <button
              onClick={toggleCompact}
              className="hidden md:inline-flex p-1.5 hover:bg-hover text-muted hover:text-fg transition-colors ml-auto"
              aria-label={compact ? "Expand sidebar" : "Compact sidebar"}
              aria-pressed={compact}
              title={compact ? "Expand sidebar" : "Compact sidebar"}
            >
              {compact ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
          </div>
          <div className={cn("mt-1.5 flex items-center justify-between", compact && "md:hidden")}>
            <span className="text-[9px] text-dim">v0.2</span>
            <span className="text-[9px] text-dim">LOCAL</span>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Top bar */}
        <header className="h-10 border-b border-border flex items-center px-2 md:px-3 gap-2 bg-elev shrink-0">
          <button
            className="md:hidden p-1 -m-1 hover:bg-hover min-w-[28px] min-h-[28px] flex items-center justify-center text-muted"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={16} />
          </button>

          <form onSubmit={submitSearch} className="flex-1 max-w-md relative" role="search">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"
              aria-hidden
            />
            <input
              ref={searchRef}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Ticker search"
              className="w-full bg-bg border border-border pl-8 pr-14 py-1 text-[12px] focus:border-accent outline-none transition-colors placeholder:text-dim"
              aria-label="Ticker search"
            />
            <kbd className="hidden sm:flex absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-dim border border-border px-1 py-px bg-elev items-center gap-1 pointer-events-none">
              <span>⌘K</span>
              <span>/</span>
            </kbd>
          </form>

          <Link
            href="/company/SAMPLE"
            className="hidden md:inline-flex items-center gap-1.5 text-[10px] text-muted hover:text-accent whitespace-nowrap border border-border px-2 py-1 hover:border-accent transition-colors uppercase tracking-wider"
            title="Open the sample company"
          >
            Sample
          </Link>

          <div className="hidden md:flex items-center gap-2 ml-auto text-[10px] text-dim tabular">
            <span className="status-dot live" aria-hidden />
            <span>LIVE</span>
            <span className="text-border-strong">|</span>
            <span>{clock}</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
