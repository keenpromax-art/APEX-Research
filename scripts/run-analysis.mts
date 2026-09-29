import fs from "fs";
import { normalize } from "../lib/normalizer";
import { calculate } from "../lib/calculator";
import { buildContext } from "../lib/context";
import { AIEngine, type Depth } from "../lib/engine";
import { buildProvider, FailoverProvider, FALLBACK_MODELS, type ProviderName } from "../lib/providers";
import { AnalysisPipeline } from "../lib/pipeline";

const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const depth = (process.env.DEPTH ?? "standard") as Depth;
const ask = process.env.USER_REQUEST ?? "Analyze this company.";
const providerName = (process.env.AI_PROVIDER ?? "groq") as ProviderName;
const upper = providerName.toUpperCase();
const apiKey = process.env[`${upper}_API_KEY`];
const model = process.env[`${upper}_MODEL`];

if (!apiKey) {
  console.error(`Missing ${upper}_API_KEY`);
  process.exit(1);
}

const data = normalize(raw);
const derived = calculate(data);
const context = buildContext([data], [derived], ask);

console.log("tickers:", context.meta.tickers.join(", "));
console.log("depth:", depth, "| context bytes:", JSON.stringify(context).length);
console.log("derived metrics:", derived.metrics.size, "| series:", Object.keys(context.companies[0].series).length);
console.log("---");

const fallbacks = FALLBACK_MODELS[providerName] ?? [];
const provider = new FailoverProvider([
  { name: providerName, key: apiKey, model: model ?? fallbacks[0] ?? "" },
  ...fallbacks.map((m) => ({ name: providerName, key: apiKey, model: m })),
]);

// Run through the real pipeline so chart refs and metric units resolve
// exactly as they do in production.
const pipeline = new AnalysisPipeline({
  fetchFn: async () => raw,
  providerName: null,
  apiKey: null,
  model: null,
  depth,
  aiTimeout: 300,
});
const result = await pipeline.runWithProvider([data.ticker], ask, () => {}, provider);

fs.writeFileSync(
  process.argv[3],
  JSON.stringify({ title: result.title, summary: result.summary, blocks: result.blocks, meta: result.meta }, null, 1)
);
const counts: Record<string, number> = {};
for (const b of result.blocks) counts[b.type] = (counts[b.type] ?? 0) + 1;
console.log("blocks:", result.blocks.length, JSON.stringify(counts));
for (const b of result.blocks) {
  if (b.type === "chart") console.log(`  chart "${b.title}" -> ${(b.data ?? []).length} points`);
  if (b.type === "metric") console.log(`  metric ${b.metricKey} = ${b.value} (${b.unit})`);
}
