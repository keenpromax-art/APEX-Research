import { createRequire } from "module";
import { fetchPeerQuotes } from "../src/lib/yahoo-finance.ts";
import { scorePeerSimilarity, gatePeerSet } from "../src/lib/peer-similarity.ts";
import { buildCompanyOntology } from "../src/lib/company-ontology.ts";
import { classifyArchetype } from "../src/lib/company-archetype.ts";

const require = createRequire(import.meta.url);
const d = require("./reliance_data.json");
const arch = classifyArchetype(d.profile, d.stockData, d.annualFinancials);
const ontology = buildCompanyOntology(d.profile, arch);
console.log("ontology:", ontology.sectorId, "| archetype:", arch.sector);

const rows = await fetchPeerQuotes(["ONGC.NS", "BPCL.NS", "IOC.NS", "NTPC.NS"]);
const peers = rows.map((p) => {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : (v && typeof v.raw === "number" ? v.raw : null));
  return {
    ticker: p.symbol, marketCap: num(p.marketCap), cmp: num(p.regularMarketPrice), pe: num(p.trailingPE),
    sector: (p.sector || "").toLowerCase() || null, industry: (p.industry || "").toLowerCase() || null,
    currency: p.currency || null, roe: num(p.returnOnEquity), netMargin: num(p.profitMargins),
    revenueGrowth: num(p.revenueGrowth), debtToEquity: num(p.debtToEquity),
  };
}).filter((p) => p.ticker && (p.marketCap != null || p.cmp != null || p.pe != null));
for (const p of peers) {
  const s = scorePeerSimilarity({
    profile: d.profile, stockData: d.stockData, annualFinancials: d.annualFinancials,
    ontologySectorId: ontology.sectorId, ontologyArchetype: ontology.operatingArchetype,
    peer: { sector: p.sector, industry: p.industry, currency: p.currency, marketCap: p.marketCap, roe: p.roe, netMargin: p.netMargin, revenueGrowth: p.revenueGrowth, debtToEquity: p.debtToEquity },
  });
  p.relevanceScore = s.total;
  console.log(p.ticker, "sector:", p.sector, "| industry:", p.industry, "| score:", s.total, JSON.stringify({ op: s.operatingModel, geo: s.geography, gro: s.growth, mar: s.margins, cap: s.capitalIntensity, size: s.size }));
}
console.log("gate:", JSON.stringify(gatePeerSet(peers)));
