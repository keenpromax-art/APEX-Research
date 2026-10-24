"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BookOpen, Calculator, Cpu, Home, Menu, Moon, Search, Settings, Sun, X } from "lucide-react";
import { useTheme } from "./ThemeProvider";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/company", label: "Company", icon: BarChart3 },
  { href: "/modelling", label: "Modelling", icon: Calculator },
  { href: "/ai", label: "AI Center", icon: Cpu },
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);

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

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const ticker = q.trim().toUpperCase();
    if (!ticker) return;
    setOpen(false);
    router.push(`/company/${encodeURIComponent(ticker)}`);
    setQ("");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 bg-surface border-r border-border flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center px-4 border-b border-border">
          <Link href="/" className="flex items-baseline gap-1" onClick={() => setOpen(false)}>
            <span className="font-semibold tracking-tight text-accent text-lg">APEX</span>
            <span className="text-muted text-xs">Terminal</span>
          </Link>
          <button className="ml-auto md:hidden p-1" aria-label="Close navigation" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  active ? "bg-panel text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:bg-panel hover:text-fg"
                }`}
              >
                <Icon size={16} /> {label}
              </Link>
            );
          })}
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
          <span className="ml-auto text-[10px] text-muted border border-border rounded px-1.5 py-0.5">v0.1</span>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center px-4 gap-3 bg-surface">
          <button className="md:hidden p-1" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <form onSubmit={submitSearch} className="w-full max-w-2xl relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search ticker (AAPL, MSFT, RELIANCE.NS, DEMO)"
              className="w-full bg-panel border border-border rounded-md pl-9 pr-16 py-1.5 text-sm focus:border-accent outline-none"
              aria-label="Ticker search"
            />
            <kbd className="hidden sm:block absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted border border-border rounded px-1.5 py-0.5 bg-surface">
              Ctrl K
            </kbd>
          </form>
          <Link
            href="/company/DEMO"
            className="hidden lg:inline-block text-xs text-muted hover:text-accent whitespace-nowrap"
            title="Open the synthetic demo company"
          >
            Try demo
          </Link>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
