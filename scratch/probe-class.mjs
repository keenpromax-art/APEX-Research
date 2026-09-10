import { classifyArchetype } from "../src/lib/company-archetype.ts";
import { classifySector } from "../src/lib/sectors/profiles.ts";

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra); }
};
const fin1 = [{ revenue: 100, ebitda: 20, ebitdaMargin: 0.2, netIncome: 10, netMargin: 0.1, totalDebt: 30, cash: 10, totalEquity: 80 }];
const px = { currentPrice: 100 };
const P = (ticker, name, sector, industry, description) =>
  ({ ticker, name, sector, industry, description, currency: "INR", exchange: "NSI", country: "India" });

// 1. Muthoot Finance (Credit Services NBFC) -> nbfc (not banking_financials)
{
  const p = P("MUTHOOTFIN", "Muthoot Finance Ltd", "Financial Services", "Credit Services",
    "Muthoot Finance Ltd is an Indian non-banking financial company providing gold loans, housing finance and microfinance through branches across India.");
  const a = classifyArchetype(p, px, fin1);
  check("MUTHOOTFIN archetype is nbfc", a.sector === "nbfc", "got " + a.sector);
  check("MUTHOOTFIN sector agrees (nbfc)", classifySector(p.sector, p.industry, p.description).id === "nbfc");
}
// 2. Bajaj Finserv (financial-sector holding co) -> general_industrial
{
  const p = P("BAJAJFINSV", "Bajaj Finserv Ltd", "Financial Services", "Financial Conglomerates",
    "Bajaj Finserv Ltd is the holding company for Bajaj Finance Ltd and Bajaj Allianz Life/General Insurance JVs; an unregistered core investment company.");
  const a = classifyArchetype(p, px, fin1);
  check("BAJAJFINSV archetype is general_industrial", a.sector === "general_industrial", "got " + a.sector);
}
// 3. Netweb (server maker, 'Kubernetes' contains 'uber') -> technology_hardware (not gig)
{
  const p = P("NETWEB", "Netweb Technologies India Ltd", "Technology", "Computer Hardware",
    "Netweb Technologies designs and manufactures high-end computing servers, storage and HCI systems with Kubernetes orchestration support for data centers.");
  const a = classifyArchetype(p, px, fin1);
  check("NETWEB archetype is technology_hardware", a.sector === "technology_hardware", "got " + a.sector);
}
// 4. Uno Minda (auto ancillary) -> auto_manufacturing
{
  const p = P("UNOMINDA", "Uno Minda Ltd", "Consumer Cyclical", "Auto Parts",
    "Uno Minda Ltd manufactures automotive lighting, switches, horns, alloy wheels and EV components for OEMs in India and overseas.");
  const a = classifyArchetype(p, px, fin1);
  check("UNOMINDA archetype is auto_manufacturing", a.sector === "auto_manufacturing", "got " + a.sector);
}
// 5. IGL (city gas distributor) -> gas/energy (not banking_financials)
{
  const p = P("IGL", "Indraprastha Gas Ltd", "Utilities", "Utilities - Regulated Gas",
    "Indraprastha Gas Ltd distributes compressed natural gas (CNG) and piped natural gas (PNG) in Delhi NCR; lays steel and MDPE pipeline networks.");
  const a = classifyArchetype(p, px, fin1);
  check("IGL archetype is not banking_financials", a.sector !== "banking_financials" && a.sector !== "nbfc", "got " + a.sector);
}
// 6. META regression -> technology_platform (financial-first must not swallow platforms)
{
  const p = { ticker: "META", name: "Meta Platforms, Inc.", sector: "Communication Services", industry: "Internet Content & Information", currency: "USD", exchange: "NasdaqGS", country: "USA",
    description: "Meta Platforms develops products enabling people to connect via mobile devices, personal computers, VR headsets. Family of Apps offers Facebook, Instagram, WhatsApp. Reality Labs provides consumer hardware including Quest devices." };
  const a = classifyArchetype(p, px, fin1);
  check("META archetype stays technology_platform", a.sector === "technology_platform", "got " + a.sector);
}
// 7. True bank still bank; true insurer still bank-sector; exchange still ratings
{
  const hdfc = P("HDFCBANK", "HDFC Bank Ltd", "Financial Services", "Banks - Regional",
    "HDFC Bank provides retail and wholesale banking, treasury and digital banking services across India.");
  check("HDFCBANK archetype is banking_financials", classifyArchetype(hdfc, px, fin1).sector === "banking_financials");
  const crisil = P("CRISIL", "CRISIL Ltd", "Financial Services", "Financial Data & Stock Exchanges",
    "CRISIL is a credit rating agency providing ratings, research and risk advisory; majority owned by S&P Global.");
  check("CRISIL archetype is financial_data_ratings", classifyArchetype(crisil, px, fin1).sector === "financial_data_ratings");
}
console.log(`\nprobe-class: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
