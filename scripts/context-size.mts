import fs from "fs";
import { normalize } from "../lib/normalizer";
import { calculate } from "../lib/calculator";
import { buildContext } from "../lib/context";

const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const data = normalize(raw);
const derived = calculate(data);
const context = buildContext([data], [derived], "Analyze this company.");
const c = context.companies[0];

const size = (o: unknown) => JSON.stringify(o).length;
const rows: [string, number][] = [
  ["company", size(c.company)],
  ["market", size(c.market)],
  ["price", size(c.price)],
  ["incomeStatement (annual)", size(c.financials.incomeStatement)],
  ["balanceSheet (annual)", size(c.financials.balanceSheet)],
  ["cashFlow (annual)", size(c.financials.cashFlow)],
  ["quarterly (all 3)", size(c.financials.quarterly)],
  ["historical", size(c.historical)],
  ["derivedMetrics", size(c.derivedMetrics)],
  ["series", size(c.series)],
  ["valuation", size(c.valuation)],
  ["earnings", size(c.earnings)],
  ["dividends", size(c.dividends)],
  ["ownership", size(c.ownership)],
  ["analystData", size(c.analystData)],
];
let total = 0;
for (const [k, v] of rows) {
  total += v;
  console.log(k.padEnd(24), String(v).padStart(8));
}
console.log("-".repeat(33));
console.log("subtotal".padEnd(24), String(total).padStart(8));
console.log("TOTAL CONTEXT".padEnd(24), String(size(context)).padStart(8));
console.log("price series points:", (c.series["price"] ?? []).length);
console.log("series count:", Object.keys(c.series).length);
