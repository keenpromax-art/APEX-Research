import { classifySector, validateSectorConcepts } from "../src/lib/sectors/profiles.ts";
import { classifyArchetype } from "../src/lib/company-archetype.ts";
import { generatePEFirmAnalysis } from "../src/lib/pe-analysis-engine.ts";
import { sanitizeSectorBleed } from "../src/lib/ai/sanitizer.ts";

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("PASS:", name); } else { fail++; console.log("FAIL:", name); } };

// ── 1. META routes to internet-platform / technology_platform ──
const metaDesc = `Meta Platforms, Inc. engages in the development of products that enable people to connect and share with friends and family through mobile devices, personal computers, virtual reality (VR) headsets, and AI glasses. It operates through two segments, Family of Apps (FoA) and Reality Labs (RL). The FoA segment offers Facebook, Instagram, Messenger, Meta AI, Threads, and WhatsApp. The RL segment provides virtual and augmented reality products, including consumer hardware, software, and content that help people feel connected, as well as Meta Quest devices.`;
const metaProfile = { ticker: "META", name: "Meta Platforms, Inc.", sector: "Communication Services", industry: "Internet Content & Information", description: metaDesc, currency: "USD", exchange: "NasdaqGS", country: "USA" };
const sp = classifySector(metaProfile.sector, metaProfile.industry, metaProfile.description);
check("META SectorProfile is internet-platform", sp.id === "internet-platform");
const arch = classifyArchetype(metaProfile, { currentPrice: 616.77 }, [{ revenue: 100, ebitda: 40, ebitdaMargin: 0.4, netIncome: 30, netMargin: 0.3, totalDebt: 10, cash: 50, totalEquity: 200 }]);
check("META archetype is technology_platform", arch.sector === "technology_platform");

// ── 2. Correct platform narrative passes (digital ARPU allowed, no telecom/FMCG terms) ──
const goodNarrative = `Family of Apps advertising revenue grew on Daily Active Users expansion and higher average price per ad. Average Revenue Per User (ARPU) on a digital-advertising basis improved across DAU and MAU cohorts. Reality Labs operating loss narrowed while data-center and AI infrastructure capex scaled for ad ranking.`;
const goodLeak = validateSectorConcepts(sp, goodNarrative);
check("Platform-correct narrative passes (digital ARPU allowed)", goodLeak.valid);

// ── 3. Telecom boilerplate still blocked for META ──
const badNarrative = `Sequential ARPU expansion via tariff hikes. Spectrum auction investments and tower deployment drive 4G/5G densification. Subscriber churn stabilized.`;
const badLeak = validateSectorConcepts(sp, badNarrative);
check("Telecom boilerplate blocked for META", !badLeak.valid && badLeak.leakedConcepts.includes("spectrum auction"));

// ── 4. FMCG boilerplate still blocked for META ──
const fmcgNarrative = `Volume growth across kirana and modern trade with copra and palm oil procurement scale. Iconic consumer brand recall supports multi-tier retail distribution of packaged goods.`;
const fmcgLeak = validateSectorConcepts(sp, fmcgNarrative);
check("FMCG boilerplate blocked for META", !fmcgLeak.valid);

// ── 5. PE engine generates platform template (no telecom/FMCG terms) ──
const fin = [{ year: "FY24", revenue: 164500, grossProfit: 133000, ebitda: 85000, ebitdaMargin: 0.52, operatingIncome: 70000, netIncome: 55000, netMargin: 0.33, totalDebt: 18000, cash: 65000, shortTermInvestments: 0, totalEquity: 150000, totalAssets: 220000, operatingCashFlow: 90000, capitalExpenditures: 28000, freeCashFlow: 62000, eps: 21, sharesOutstanding: 2600 }];
const dcf = { intrinsicValue: 341.95, currentMarketPrice: 616.77, upsideDownside: -0.446, verdict: "SELL", assumptions: { wacc: 0.095 } };
const pe = generatePEFirmAnalysis({ profile: metaProfile, stockData: { currentPrice: 616.77, marketCap: 1.6e12, pe: 28, dividendYield: 0.003 }, annualFinancials: fin, dcf });
const peText = (pe.investmentThesis + " " + pe.companyOverview + " " + pe.investmentConclusion).toLowerCase();
check("PE thesis mentions dau/mau or family of apps", peText.includes("dau") || peText.includes("family of apps"));
check("PE thesis mentions reality labs", peText.includes("reality labs"));
check("PE thesis has NO spectrum auction", !peText.includes("spectrum auction"));
check("PE thesis has NO tower tenanc", !peText.includes("tower"));
check("PE thesis has NO fmcg/kirana/copra", !peText.includes("kirana") && !peText.includes("copra") && !peText.includes("fmcg"));
const peLeak = validateSectorConcepts(sp, pe.investmentThesis + " " + pe.companyOverview + " " + pe.investmentConclusion + " " + JSON.stringify(pe.moatSources) + " " + pe.businessStrategyCommentary);
check("Full PE deterministic narrative passes validator", peLeak.valid);

// ── 6. Sanitizer scrubs telecom bleed when it does occur ──
const scrubbed = sanitizeSectorBleed({ note: badNarrative }, metaProfile.sector, metaProfile.industry, metaProfile.description);
check("Sanitizer removes spectrum auction", !scrubbed.note.toLowerCase().includes("spectrum auction"));

// ── 7. No regressions: real telecom, FMCG, bank still route correctly ──
const tel = classifySector("Telecom Services", "Telecom - Wireless", "Bharti Airtel is a telecommunications service provider with wireless carrier operations and spectrum holdings.");
check("Real telecom still telecom", tel.id === "telecom");
const fmcg = classifySector("Consumer Goods", "Personal Products", "Hindustan Unilever sells packaged goods and personal care FMCG products.");
check("Real FMCG still consumer", fmcg.id === "consumer");
const bank = classifySector("Financial Services", "Banks", "HDFC Bank accepts deposits and operates a CASA franchise.");
check("Real bank still bank", bank.id === "bank");
const it = classifySector("Information Technology", "IT Services & Consulting", "Infosys is a global leader in digital services.");
check("IT services still it-services", it.id === "it-services");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
