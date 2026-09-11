/**
 * APEX RESEARCH — Operating-Model Layer Unit Tests
 * ------------------------------------------------
 * Verifies the hard company operating-model layer:
 *  1. One shared ResearchOperatingModel per company (deterministic, frozen).
 *  2. Explicit driver packs for every supported sector (no generic fallback
 *     drivers wherever a sector is known).
 *  3. Forbidden-concept leakage BLOCKS in every section (never WARN).
 *  4. Required-concept absence BLOCKS for known sectors (general exempt).
 *  5. Acceptance pins: Delhivery (no commodity/feedstock), Microsoft (no
 *     IT-services pyramid metrics), Reliance (no software/lending drivers).
 *  6. Deterministic PE output for MSFT/Delhivery passes its own model scan.
 *
 * Run: npx tsx scratch/test-operating-model.ts (exit 1 on any failure)
 */
import { buildResearchOperatingModel } from "../src/lib/research-model/operating-model";
import { SECTOR_DRIVER_PACKS } from "../src/lib/research-model/sector-drivers";
import { validateReport as validateReportAgainstModel, validateSection } from "../src/lib/research-model/model-validator";
import { generatePEFirmAnalysis } from "../src/lib/pe-analysis-engine";
import type { SectorId } from "../src/lib/sectors/types";

let failures = 0;
let passes = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passes++;
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROFILE = (p: Record<string, unknown>) => ({
  ticker: "TEST",
  name: "Test Co",
  sector: "",
  industry: "",
  currency: "USD",
  exchange: "N/A",
  country: "USA",
  description: "",
  ...p,
});

const MSFT = PROFILE({
  ticker: "MSFT",
  name: "Microsoft Corporation",
  sector: "Technology",
  industry: "Software - Infrastructure",
  description: "Microsoft develops cloud computing through Azure, productivity software through Microsoft 365, and personal computing through Windows.",
});
const DELHIVERY = PROFILE({
  ticker: "DELHIVERY.NS",
  name: "Delhivery Limited",
  sector: "Industrials",
  industry: "Integrated Freight & Logistics",
  currency: "INR",
  exchange: "NSE",
  country: "India",
  description: "Delhivery provides express parcel, part-truckload and supply chain services across India.",
});
const RELIANCE = PROFILE({
  ticker: "RELIANCE.NS",
  name: "Reliance Industries Limited",
  sector: "Energy",
  industry: "Oil & Gas Refining & Marketing",
  currency: "INR",
  exchange: "NSE",
  country: "India",
  description: "Indian conglomerate spanning energy, petrochemicals, telecommunications, and retail.",
});
const BANK = PROFILE({
  ticker: "HDFCBANK.NS",
  name: "HDFC Bank Limited",
  sector: "Financial Services",
  industry: "Banks - Diversified",
  currency: "INR",
  exchange: "NSE",
  country: "India",
  description: "Largest private sector bank in India with a strong CASA franchise and advances growth.",
});
const NBFC = PROFILE({
  ticker: "CREDITACC.NS",
  name: "CreditAccess Grameen Limited",
  sector: "Financial Services",
  industry: "Credit Services",
  currency: "INR",
  exchange: "NSE",
  country: "India",
  description: "Microfinance lender serving rural borrowers through group-lending centers.",
});
const TELECOM = PROFILE({
  ticker: "BHARTIARTL.NS",
  name: "Bharti Airtel Limited",
  sector: "Communication Services",
  industry: "Telecom Services",
  currency: "INR",
  exchange: "NSE",
  country: "India",
  description: "Telecom carrier providing mobile, broadband and enterprise connectivity services.",
});
const PHARMA = PROFILE({
  ticker: "SUNPHARMA.NS",
  name: "Sun Pharmaceutical Industries Limited",
  sector: "Healthcare",
  industry: "Drug Manufacturers - Specialty & Generic",
  currency: "INR",
  exchange: "NSE",
  country: "India",
  description: "Global specialty generic company with US generics and domestic formulations.",
});

console.log("=======================================================");
console.log("OPERATING-MODEL LAYER TESTS");
console.log("=======================================================\n");

// ── 1. Classification pins ──────────────────────────────────
console.log("--- 1. sector classification ---");
const mMsft = buildResearchOperatingModel({ profile: MSFT as never });
const mDel = buildResearchOperatingModel({ profile: DELHIVERY as never });
const mRel = buildResearchOperatingModel({ profile: RELIANCE as never });
const mBank = buildResearchOperatingModel({ profile: BANK as never });
const mNbfc = buildResearchOperatingModel({ profile: NBFC as never });
const mTel = buildResearchOperatingModel({ profile: TELECOM as never });
const mPharma = buildResearchOperatingModel({ profile: PHARMA as never });

check("MSFT → technology-software", mMsft.sector === "technology-software", `got ${mMsft.sector}`);
check("Delhivery → internet-retail", mDel.sector === "internet-retail", `got ${mDel.sector}`);
check("Reliance → general", mRel.sector === "general", `got ${mRel.sector}`);
check("HDFC Bank → bank", mBank.sector === "bank", `got ${mBank.sector}`);
check("CreditAccess → nbfc", mNbfc.sector === "nbfc", `got ${mNbfc.sector}`);
check("Airtel → telecom", mTel.sector === "telecom", `got ${mTel.sector}`);
check("Sun Pharma → pharma", mPharma.sector === "pharma", `got ${mPharma.sector}`);

// ── 2. Single instance: deterministic + frozen ──────────────
console.log("--- 2. single frozen instance ---");
const mMsft2 = buildResearchOperatingModel({ profile: MSFT as never });
check("rebuild is deep-equal (same instance content)", JSON.stringify(mMsft) === JSON.stringify(mMsft2));
check("model is frozen", Object.isFrozen(mMsft) && Object.isFrozen(mMsft.requiredConcepts));
check("MSFT and Delhivery models differ", mMsft.sector !== mDel.sector && mMsft.modelId !== mDel.modelId);
check("modelId carries ticker", mMsft.modelId.startsWith("MSFT@"));

// ── 3. Explicit packs for every sector ──────────────────────
console.log("--- 3. explicit driver packs (all 22 sectors) ---");
const sectorIds = Object.keys(SECTOR_DRIVER_PACKS) as SectorId[];
check("22 sector packs present", sectorIds.length === 22, `got ${sectorIds.length}`);
let packsOk = true;
for (const id of sectorIds) {
  const p = SECTOR_DRIVER_PACKS[id];
  const ok =
    p.revenueDrivers.length > 0 && p.costDrivers.length > 0 && p.capexDrivers.length > 0 &&
    p.nwcDrivers.length > 0 && p.kpis.length > 0 && p.requiredConcepts.length > 0 &&
    p.forbiddenConcepts.length > 0 && p.unitEconomics.length > 0 && p.valuationMethods.length > 0;
  if (!ok) {
    packsOk = false;
    console.error(`  ❌ pack incomplete: ${id}`);
  }
}
check("every pack has drivers/kpis/required/forbidden/unit-economics", packsOk);
const GENERIC_REV = ["volume", "realization / pricing", "mix"];
for (const id of sectorIds) {
  if (id === "general") continue;
  const rev = SECTOR_DRIVER_PACKS[id].revenueDrivers.map((d) => d.toLowerCase());
  if (GENERIC_REV.every((g, i) => rev[i] === g)) {
    packsOk = false;
    console.error(`  ❌ generic fallback drivers survive in pack: ${id}`);
  }
}
check("no generic fallback revenue drivers in known-sector packs", packsOk);

// ── 4. Acceptance: Delhivery ────────────────────────────────
console.log("--- 4. Delhivery: no commodity/feedstock language ---");
check("Delhivery forbidden includes feedstock", mDel.forbiddenConcepts.includes("feedstock"));
const delClean = "Order volume grew across the express parcel network with stable average order value (AOV) and improving take rate on fulfillment.";
const delDirty = "Commodity feedstock procurement and upstream crude exposure drove plant turnaround costs.";
check("clean logistics narrative passes", validateSection(mDel, "thesis", delClean).pass);
const delRes = validateReportAgainstModel(mDel, { thesis: delDirty });
check("commodity/feedstock narrative BLOCKS", !delRes.pass && delRes.blockers.length > 0);
check("blocker names the section", delRes.blockers.some((b) => b.section === "thesis"));
check("leakage flagged as forbidden", delRes.blockers.some((b) => b.kind === "forbidden"));

// ── 5. Acceptance: Microsoft ────────────────────────────────
console.log("--- 5. Microsoft: no IT-services pyramid metrics ---");
for (const t of ["delivery pyramid", "billable utilization", "offshore"]) {
  check(`MSFT forbidden includes "${t}"`, mMsft.forbiddenConcepts.includes(t), `missing ${t}`);
}
const msClean = "Subscription ARR expanded with strong net revenue retention; large-deal TCV conversion supports multi-year visibility.";
const msDirty = " growth came from offshore delivery pyramid optimization with billable utilization gains.";
check("clean software narrative passes", validateSection(mMsft, "thesis", msClean).pass);
const msRes = validateReportAgainstModel(mMsft, { thesis: "Solid quarter.", moat: msDirty });
check("pyramid/utilization narrative BLOCKS", !msRes.pass);
check("blocker attributes the moat section", msRes.blockers.some((b) => b.section === "moat"));
check("MSFT required concepts present", mMsft.requiredConcepts.includes("arr") && mMsft.requiredConcepts.includes("subscription"));

// ── 6. Acceptance: Reliance ─────────────────────────────────
console.log("--- 6. Reliance: no software/lending drivers ---");
const relDrivers = [...mRel.revenueDrivers, ...mRel.costDrivers, ...mRel.capexDrivers].join(" ").toLowerCase();
for (const t of ["arr", "subscription", "casa", "loan", "aum", "utilization", "attrition"]) {
  check(`Reliance drivers exclude "${t}"`, !relDrivers.includes(t), `found in: ${relDrivers}`);
}
const relLend = "CASA deposit growth expanded the loan book.";
check("lending narrative BLOCKS for Reliance", !validateReportAgainstModel(mRel, { thesis: relLend }).pass);
check("Reliance required concepts are sector-neutral",
  mRel.requiredConcepts.includes("revenue") && !mRel.requiredConcepts.includes("arr") && !mRel.requiredConcepts.includes("casa"),
  `got [${mRel.requiredConcepts.join(", ")}]`);
check("general never blocks on required absence", validateReportAgainstModel(mRel, { thesis: "Refining throughput was stable." }).blockers.every((b) => b.kind !== "required"));

// ── 7. Bank / NBFC / Telecom / Pharma pins ──────────────────
console.log("--- 7. bank / nbfc / telecom / pharma ---");
const bankClean = "CASA ratio improved with NIM expansion; GNPA declined as provisions covered slippages and advances grew.";
check("bank required evidenced", validateReportAgainstModel(mBank, { thesis: bankClean }).pass);
check("bank: spectrum auction BLOCKS", !validateReportAgainstModel(mBank, { thesis: "Growth from spectrum auction wins." }).pass);
const nbfcClean = "AUM grew with collection efficiency gains; credit cost normalized as borrowing costs eased.";
check("nbfc clean passes", validateReportAgainstModel(mNbfc, { thesis: nbfcClean }).pass);
check("nbfc: CASA BLOCKS", !validateReportAgainstModel(mNbfc, { thesis: "CASA deposits funded growth." }).pass);
const telClean = "ARPU expanded as subscribers grew and churn moderated despite capex intensity.";
check("telecom clean passes", validateReportAgainstModel(mTel, { thesis: telClean }).pass);
check("telecom: wafer fab BLOCKS", !validateReportAgainstModel(mTel, { thesis: "New wafer fab capacity supports growth." }).pass);
const phClean = "R&D yielded ANDA approvals supporting US generics with stable gross margin.";
check("pharma clean passes", validateReportAgainstModel(mPharma, { thesis: phClean }).pass);
check("pharma: spectrum auction BLOCKS", !validateReportAgainstModel(mPharma, { thesis: "Spectrum auction wins diversify revenue." }).pass);

// ── 8. Required-absence BLOCKS for known sectors ────────────
console.log("--- 8. required-concept validation ---");
const thinBank = validateReportAgainstModel(mBank, { thesis: "The company did well this quarter with good results." });
check("zero-required bank narrative BLOCKS", !thinBank.pass && thinBank.blockers.some((b) => b.kind === "required"));
const thinGeneral = validateReportAgainstModel(mRel, { thesis: "The company did well this quarter with good results." });
check("zero-required general narrative does NOT block on required", thinGeneral.blockers.every((b) => b.kind !== "required"));

// ── 9. Deterministic PE output passes its own model ─────────
console.log("--- 9. deterministic PE output self-scan ---");
const finRow = (year: string, revenue: number) => ({
  year,
  revenue,
  grossProfit: revenue * 0.68,
  ebitda: revenue * 0.47,
  ebitdaMargin: 0.47,
  operatingIncome: revenue * 0.44,
  netIncome: revenue * 0.36,
  netMargin: 0.36,
  eps: 10,
  totalDebt: revenue * 0.2,
  cash: revenue * 0.4,
  totalAssets: revenue * 1.4,
  totalLiabilities: revenue * 0.4,
  totalEquity: revenue * 1.0,
  operatingCashFlow: revenue * 0.4,
  capitalExpenditures: revenue * 0.05,
  freeCashFlow: revenue * 0.35,
  sharesOutstanding: 7430000000,
});
const msftFin = [finRow("FY2023", 211e9), finRow("FY2024", 245e9)];
const msftOut = generatePEFirmAnalysis({
  profile: MSFT as never,
  stockData: { currentPrice: 420, marketCap: 3.1e12, pe: 35, beta: 0.9 } as never,
  annualFinancials: msftFin as never,
  dcf: { intrinsicValue: 460, currentMarketPrice: 420, verdict: "HOLD", assumptions: { wacc: 0.085, terminalGrowthRate: 0.04, marginalTaxRate: 0.21 } } as never,
}) as unknown as Record<string, unknown>;
const msftBlob = JSON.stringify(msftOut);
const msftScan = validateReportAgainstModel(mMsft, { thesis: msftBlob });
check("MSFT deterministic output: zero forbidden", msftScan.blockers.filter((b) => b.kind === "forbidden").length === 0,
  msftScan.blockers.filter((b) => b.kind === "forbidden").map((b) => `${b.section}: ${b.terms.join(",")}`).join(" | "));
check("MSFT deterministic output: required evidenced", msftScan.requiredEvidenced.length >= 2, `got [${msftScan.requiredEvidenced.join(", ")}]`);

const delFin = [finRow("FY2023", 72e9), finRow("FY2024", 80e9)];
const delOut = generatePEFirmAnalysis({
  profile: DELHIVERY as never,
  stockData: { currentPrice: 380, marketCap: 280e9, pe: 60, beta: 1.1 } as never,
  annualFinancials: delFin as never,
  dcf: { intrinsicValue: 420, currentMarketPrice: 380, verdict: "HOLD", assumptions: { wacc: 0.11, terminalGrowthRate: 0.04, marginalTaxRate: 0.25 } } as never,
}) as unknown as Record<string, unknown>;
const delScan = validateReportAgainstModel(mDel, { thesis: JSON.stringify(delOut) });
check("Delhivery deterministic output: zero forbidden", delScan.blockers.filter((b) => b.kind === "forbidden").length === 0,
  delScan.blockers.filter((b) => b.kind === "forbidden").map((b) => `${b.section}: ${b.terms.join(",")}`).join(" | "));
check("Delhivery deterministic output: required evidenced", delScan.requiredEvidenced.length >= 1, `got [${delScan.requiredEvidenced.join(", ")}]`);

console.log("\n=======================================================");
console.log(`RESULT: ${passes} passed, ${failures} failed`);
console.log("=======================================================");
process.exit(failures > 0 ? 1 : 0);
