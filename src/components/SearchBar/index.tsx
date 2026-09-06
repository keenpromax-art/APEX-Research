"use client";
import React, { useState, useEffect, useRef } from "react";
import styles from "./SearchBar.module.css";
import type { SearchResult } from "@/types/report";

interface SearchBarProps {
  onSelect: (result: SearchResult) => void;
  loading?: boolean;
}

export default function SearchBar({ onSelect, loading }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
        setOpen(true);
        setSelected(-1);
      } catch {}
      setSearching(false);
    }, 350);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, -1)); }
    if (e.key === "Enter" && selected >= 0) { handleSelect(results[selected]); }
    if (e.key === "Escape") setOpen(false);
  };

  const handleSelect = (result: SearchResult) => {
    setQuery(`${result.longname || result.shortname} (${result.symbol})`);
    setOpen(false);
    onSelect(result);
  };

  const exchangeFlag: Record<string, string> = {
    NYQ: "🇺🇸", NMS: "🇺🇸", NGM: "🇺🇸", NCM: "🇺🇸",
    NSI: "🇮🇳", BSE: "🇮🇳",
    LSE: "🇬🇧",
    TYO: "🇯🇵",
    SHA: "🇨🇳", SHZ: "🇨🇳",
    HKG: "🇭🇰",
    FRA: "🇩🇪",
    PAR: "🇫🇷",
    TSX: "🇨🇦",
    ASX: "🇦🇺",
  };

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  return (
    <div className={styles.searchWrapper} ref={containerRef}>
      <div className={styles.inputContainer}>
        <span className={styles.searchIcon}>
          {searching ? (
            <svg className={styles.spinner} viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Search any listed ticker or company (e.g. SUZLON.NS, AAPL, RELIANCE.NS)..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button className={styles.clearBtn} onClick={() => { setQuery(""); setResults([]); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <span className={styles.kbdHint}>⌘K</span>
        )}
      </div>

      {open && results.length > 0 && (
        <div className={styles.dropdown}>
          {results.map((r, i) => (
            <div
              key={r.symbol}
              className={`${styles.dropdownItem} ${i === selected ? styles.dropdownItemSelected : ""}`}
              onMouseDown={() => handleSelect(r)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className={styles.itemLeft}>
                <span className={styles.itemFlag}>{exchangeFlag[r.exchDisp || r.exchange] || "🌐"}</span>
                <div>
                  <div className={styles.itemName}>{r.longname || r.shortname}</div>
                  <div className={styles.itemMeta}>{r.industry || r.typeDisp}</div>
                </div>
              </div>
              <div className={styles.itemRight}>
                <span className={styles.itemTicker}>{r.symbol}</span>
                <span className={styles.itemExchange}>{r.exchDisp || r.exchange}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && results.length === 0 && !searching && query.length > 1 && (
        <div className={styles.dropdown}>
          <div className={styles.noResults}>No results found for "{query}"</div>
        </div>
      )}
    </div>
  );
}
