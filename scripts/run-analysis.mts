import fs from "fs";
import { normalize } from "../lib/normalizer";
import { calculate } from "../lib/calculator";
import { buildContext } from "../lib/context";
import { AIEngine } from "../lib/engine";
import { buildProvider, type ProviderName } from "../lib/providers";
import { AnalysisPipeline } from "../lib/pipeline";

const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
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
const context = buildContext([data], [derived], "Analyze this company.");

console.log("tickers:", context.meta.tickers.join(", "));
console.log("context bytes:", JSON.stringify(context).length);
console.log("derived metrics:", derived.metrics.size);
console.log("series:", Object.keys(context.companies[0].series).length);
console.log("dataQuality notes:", JSON.stringify(context.companies[0].dataQuality.notes, null, 1));
console.log("---");

const engine = new AIEngine(buildProvider(providerName, apiKey, model)!, 300);
const doc = await engine.analyze(context);
console.log("validated OK");

fs.writeFileSync(
  process.argv[3],
  JSON.stringify({ title: doc.title, summary: doc.summary, blocks: doc.blocks, meta: context.meta }, null, 1)
);
console.log("blocks:", doc.blocks.length);
for (const b of doc.blocks) console.log(" -", b.type);
