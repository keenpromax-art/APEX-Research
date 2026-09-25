"use client";
import type { ResearchMemorySnapshot } from "@/lib/research-ledger";

export default function ResearchHistoryPanel({ memory }: { memory?: ResearchMemorySnapshot | null }) {
  if (!memory) return null;
  const changes = memory.thesisDiff.changedFields;
  return (
    <div style={{ border: "1px solid var(--border-subtle)", padding: 16, marginTop: 16, background: "var(--surface-1)" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Research Memory</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 12 }}>
        <div>Run: <strong>{memory.run.runId.slice(0, 18)}…</strong></div>
        <div>Thesis: <strong>{memory.thesisBreak.classification}</strong></div>
        <div>Changed fields: <strong>{changes.length}</strong></div>
        <div>Open unknowns: <strong>{memory.unknownRegistry.entries.filter((entry) => entry.status === "open" || entry.status === "investigating").length}</strong></div>
        <div>Forecast snapshots: <strong>{memory.forecastIssuances.length}</strong></div>
        <div>Measured/known events: <strong>{memory.eventHistory.length}</strong></div>
        <div>Expectations gap: <strong>{memory.expectationsGap.status}</strong></div>
        <div>Risk rows: <strong>{memory.riskValueMap.length}</strong></div>
      </div>
      {changes.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-secondary)" }}>What changed: {changes.join(", ")}</div>}
    </div>
  );
}
