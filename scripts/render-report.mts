import fs from "fs";

const doc = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const fmt = (v: number | null, unit?: string): string => {
  if (v === null || v === undefined) return "N/A";
  if (unit === "percent") return `${(v * 100).toFixed(1)}%`;
  if (unit === "currency") {
    const a = Math.abs(v);
    if (a >= 1e12) return `INR ${(v / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `INR ${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `INR ${(v / 1e6).toFixed(1)}M`;
    return `INR ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "ratio") return `${v.toFixed(2)}x`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const line = (c = "=") => c.repeat(78);

console.log(line());
console.log(doc.title.toUpperCase());
console.log(line());
console.log(`Source: yfinance | Ticker: ${doc.meta.tickers.join(", ")} | ${new Date(doc.meta.generatedAt).toISOString()}`);
console.log(line());
console.log();
console.log("SUMMARY");
console.log(line("-"));
console.log(doc.summary);
console.log();

for (const b of doc.blocks) {
  if (b.type === "heading") {
    console.log();
    console.log("#".repeat(Math.min(Math.max(b.level, 2), 4)) + " " + b.content);
    console.log(line("-"));
  } else if (b.type === "paragraph") {
    console.log(b.content + (b.epistemic ? `  [${b.epistemic}]` : ""));
  } else if (b.type === "metric") {
    const change = b.change != null ? `  (${b.change >= 0 ? "+" : ""}${(b.change * 100).toFixed(1)}%)` : "";
    console.log(`  >> ${b.label}: ${fmt(b.value, b.unit)}${change}   [metricKey=${b.metricKey}]`);
  } else if (b.type === "list") {
    b.items.forEach((i: string, n: number) => console.log(`  ${b.ordered ? n + "." : "-"} ${i}`));
  } else if (b.type === "callout") {
    console.log(`  [${b.variant.toUpperCase()}] ${b.content}`);
  } else if (b.type === "formula") {
    console.log(`  ${b.expression}${b.result != null ? ` = ${fmt(b.result)}` : ""}`);
  } else if (b.type === "table") {
    console.log();
    const w = b.columns.map((c: string) => Math.max(c.length, 14));
    const cell = (v: string | number | null, i: number) => {
      if (i === 0) return String(v ?? "—").padEnd(w[i]);
      const s = typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? "—");
      return s.padStart(w[i]);
    };
    console.log("  " + b.columns.map((c: string, i: number) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  "));
    console.log("  " + w.map((n: number) => "-".repeat(n)).join("  "));
    for (const row of b.rows) {
      console.log("  " + row.map((v, i) => cell(v as string | number | null, i)).join("  "));
    }
  } else if (b.type === "chart") {
    console.log(`  [chart:${b.chartType}] ${b.title} -> ${(b.data ?? []).length} points`);
  } else if (b.type === "provenance") {
    console.log("  provenance:");
    for (const i of b.items) console.log(`    - ${i.claim} = ${fmt(i.value)} (${i.source})`);
  }
  console.log();
}
