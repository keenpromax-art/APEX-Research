import { fetchQuoteSummary, parseQuoteSummary } from "../src/lib/yahoo-finance.ts";
import { classifySector } from "../src/lib/sectors/profiles.ts";
import { classifyArchetype } from "../src/lib/company-archetype.ts";
const tickers = ["BAJAJFINSV.NS", "MUTHOOTFIN.NS", "IGL.NS", "NETWEB.NS", "UNOMINDA.NS"];
for (const t of tickers) {
  try {
    const raw = await fetchQuoteSummary(t);
    const q = parseQuoteSummary(raw, t).companyProfile;
    const sector = classifySector(q.sector, q.industry, q.description ?? "");
    const arch = classifyArchetype(
      { ticker: t, name: q.name, sector: q.sector, industry: q.industry, description: q.description ?? "", currency: "INR", exchange: "NSI", country: "India" },
      { currentPrice: 100 },
      [{ revenue: 100, ebitda: 20, ebitdaMargin: 0.2, netIncome: 10, netMargin: 0.1, totalDebt: 30, cash: 10, totalEquity: 80 }]
    );
    console.log(t, "| sector:", JSON.stringify(q.sector), "| industry:", JSON.stringify(q.industry), "=> sectorProfile:", sector.id, "| archetype:", arch.sector);
  } catch (e) { console.log(t, "ERROR", String(e).slice(0, 120)); }
}
