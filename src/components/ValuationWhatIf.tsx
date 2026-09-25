"use client";
import { useMemo, useState } from "react";
import type { ReportData } from "@/types/report";
import { applyFCFFWhatIf } from "@/lib/valuation/what-if";

export default function ValuationWhatIf({ data }: { data: ReportData }) {
  const dcf = data.dcf;
  const [wacc, setWacc] = useState(String((dcf.assumptions.wacc * 100).toFixed(2)));
  const [terminalGrowth, setTerminalGrowth] = useState(String((dcf.assumptions.terminalGrowthRate * 100).toFixed(2)));
  const [result, setResult] = useState<ReturnType<typeof applyFCFFWhatIf> | null>(null);
  const method = data.selectedModel || "FCFF_DCF";
  const input = useMemo(() => ({
    method,
    base: {
      method,
      wacc: dcf.assumptions.wacc,
      terminalGrowthRate: dcf.assumptions.terminalGrowthRate,
      fcff: dcf.projections.map((projection) => projection.fcff),
      netDebt: dcf.netDebt,
      sharesOutstanding: dcf.sharesOutstanding,
      currentPrice: data.cmp,
      terminalValueCapped: dcf.terminalValueCapped,
      terminalValueCapMultiple: (dcf as { terminalValueCapMultiple?: number }).terminalValueCapMultiple,
    },
  }), [data.cmp, dcf, method]);

  const run = () => {
    const parsedWacc = Number(wacc) / 100;
    const parsedGrowth = Number(terminalGrowth) / 100;
    if (!Number.isFinite(parsedWacc) || !Number.isFinite(parsedGrowth)) return;
    setResult(applyFCFFWhatIf(input, { wacc: parsedWacc, terminalGrowthRate: parsedGrowth }));
  };

  return (
    <div style={{ border: "1px solid var(--border-subtle)", padding: 16, marginTop: 16, background: "var(--surface-1)" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Valuation What-If Overlay</div>
      <div style={{ color: "var(--ink-muted)", fontSize: 12, marginBottom: 12 }}>Illustrative only. Published valuation and rating remain unchanged.</div>
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>WACC (%)<input value={wacc} onChange={(event) => setWacc(event.target.value)} inputMode="decimal" /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Terminal growth (%)<input value={terminalGrowth} onChange={(event) => setTerminalGrowth(event.target.value)} inputMode="decimal" /></label>
        <button type="button" className="btn-secondary" onClick={run}>Run overlay</button>
      </div>
      {result && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <div>Base fair value: <strong>{result.baseValue == null ? "N/A" : result.baseValue.toFixed(2)}</strong></div>
          <div>Overlay fair value: <strong>{result.fairValue == null ? "N/A" : result.fairValue.toFixed(2)}</strong></div>
          {result.diagnostics.length > 0 && <div style={{ color: "var(--warn, #b45309)", marginTop: 6 }}>{result.diagnostics.join(" · ")}</div>}
        </div>
      )}
    </div>
  );
}
