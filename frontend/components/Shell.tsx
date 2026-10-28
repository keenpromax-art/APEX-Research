"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BookOpen, Calculator, Cpu, FileText, Home, Menu, Moon, Search, Settings, Sun, X } from "lucide-react";
import { useTheme } from "./ThemeProvider";

const NAV = [
  { href: "/", label: "Home", icon: Home, group: "Workspace" },
  { href: "/company", label: "Company", icon: BarChart3, group: "Workspace" },
  { href: "/modelling", label: "Modelling", icon: Calculator, group: "Workspace" },
  { href: "/research", label: "Research", icon: FileText, group: "Workspace" },
  { href: "/ai", label: "AI Center", icon: Cpu, group: "Configure" },
  { href: "/library", label: "Library", icon: BookOpen, group: "Configure" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Configure" },
];

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

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
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-surface border-r border-border flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Primary navigation"
      >
        <div className="h-14 flex items-center px-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 border border-accent/30 text-accent font-bold text-sm">
              A
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-semibold tracking-tight text-fg text-sm">APEX</span>
              <span className="text-[10px] text-muted uppercase tracking-widest">Research</span>
            </span>
          </Link>
          <button className="ml-auto md:hidden p-1.5 rounded-md hover:bg-panel" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-4 overflow-auto">
          {groups.map((group) => (
            <div key={group}>
              <div className="px-2 mb-1.5 text-[10px] uppercase tracking-widest text-dim font-medium">{group}</div>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === group).map(({ href, label, icon: Icon }) => {
                  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                        active
                          ? "bg-panel text-fg border-l-2 border-accent pl-2"
                          : "text-muted hover:bg-panel hover:text-fg border-l-2 border-transparent"
                      }`}
                    >
                      <Icon size={16} className={active ? "text-accent" : ""} /> {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-border flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md hover:bg-panel"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <span className="text-xs text-muted capitalize">{theme} mode</span>
          <span className="ml-auto text-[10px] text-muted border border-border rounded px-1.5 py-0.5">v0.2</span>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 bg-surface">
          <button className="md:hidden p-1.5 rounded-md hover:bg-panel" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <form onSubmit={submitSearch} className="w-full max-w-2xl relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search ticker (AAPL, MSFT, RELIANCE.NS)"
              className="w-full bg-panel border border-border rounded-md pl-9 pr-24 py-1.5 text-sm focus:border-accent outline-none"
              aria-label="Ticker search"
            />
            <kbd className="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted border border-border rounded px-1.5 py-0.5 bg-surface">
              Ctrl K / /
            </kbd>
          </form>
          <Link
            href="/company/SAMPLE"
            className="hidden lg:inline-block text-xs text-muted hover:text-accent whitespace-nowrap"
            title="Open the sample company"
          >
            Try sample
          </Link>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}