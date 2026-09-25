"use client";
import { useEffect, useState } from "react";
import { addWatchlistEntry, loadWatchlist, removeWatchlistEntry, saveWatchlist } from "@/lib/watchlist/local-store";

export default function WatchlistButton({ ticker, reportId, fairValue, currentPrice }: { ticker: string; reportId?: string; fairValue?: number; currentPrice?: number }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setSaved(loadWatchlist().entries.some((entry) => entry.ticker === ticker.toUpperCase()));
  }, [ticker]);
  const toggle = () => {
    const state = loadWatchlist();
    const next = saved
      ? removeWatchlistEntry(state, ticker)
      : addWatchlistEntry(state, { ticker, addedAt: new Date().toISOString(), lastReportId: reportId, lastFairValue: fairValue, lastPrice: currentPrice });
    saveWatchlist(next);
    setSaved(!saved);
  };
  return <button type="button" className="btn-secondary" onClick={toggle} style={{ padding: "8px 12px", fontSize: 12 }}>{saved ? "Remove from watchlist" : "Add to watchlist"}</button>;
}
