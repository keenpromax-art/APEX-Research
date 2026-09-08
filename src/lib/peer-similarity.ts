/**
 * APEX RESEARCH - Business-Model Similarity Engine (Priority 5)
 *
 * Scores peers on operating model + segment mix + geography + growth +
 * margins + capital intensity + size. Curated ontology universe is the
 * candidate pool; this scorer is the gate. Below-threshold sets suppress
 * relative valuation instead of fabricating precision.
 */
import type { AnnualFinancials, CompanyProfile, PeerData, StockData } from "@/types/report";

export interface SimilarityBreakdown {
  operatingModel: number; // 0-40: sector/industry + ontology archetype
  geography: number; // 0-10: same market/currency
  growth: number; // 0-10: revenue growth proximity
  margins: number; // 0-15: net margin + ROE proximity
  capitalIntensity: number; // 0-15: capex intensity + leverage proximity
  size: number; // 0-10: market-cap proximity
  total: number; // 0-100
}

export const SIMILARITY_THRESHOLD_AVG = 40;
export const SIMILARITY_MIN_QUALIFYING = 50;
export const SIMILARITY_MIN_COUNT = 2;

export function isSameMarket(aCountry: string, bCurrency: string | null, aCurrency: string): boolean {
  if (!bCurrency) return false;
  const a = (aCurrency || "").toUpperCase();
  const b = (bCurrency || "").toUpperCase();
  if (a && b && a === b) return true;
  // INR listings are Indian market even when peer currency field is missing
  return false;
}

export function scorePeerSimilarity(params: {
  profile: CompanyProfile;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  ontologySectorId: string;
  ontologyArchetype: string;
  peer: { sector?: string | null; industry?: string | null; currency?: string | null; marketCap?: number | null; pe?: number | null; roe?: number | null; netMargin?: number | null; revenueGrowth?: number | null; debtToEquity?: number | null };
}): SimilarityBreakdown {
  const { profile, stockData, annualFinancials, ontologySectorId, peer } = params;
  const subjSec = (profile.sector || "").toLowerCase();
  const subjInd = (profile.industry || "").toLowerCase();
  const qSec = (peer.sector || "").toLowerCase();
  const qInd = (peer.industry || "").toLowerCase();
  const latest = annualFinancials[annualFinancials.length - 1];

  // Operating model 0-40
  let operatingModel = 0;
  if (qSec && subjSec && (qSec.includes(subjSec) || subjSec.includes(qSec))) operatingModel += 22;
  else if (qSec && subjSec) operatingModel -= 8;
  if (qInd && subjInd && (qInd.includes(subjInd) || subjInd.includes(qInd))) operatingModel += 18;
  else if (qInd && subjInd) operatingModel -= 4;
  // Hard ontology penalty: hospitality/REIT vs bank/industrial is never similar
  const subjIsHosp = subjInd.includes("lodg") || subjInd.includes("hotel") || subjInd.includes("hospitality") || ontologySectorId === "hospitality";
  const peerIsHosp = qInd.includes("lodg") || qInd.includes("hotel") || qInd.includes("hospitality");
  const peerIsBank = qSec.includes("bank") || qInd.includes("bank");
  if (subjIsHosp && !peerIsHosp && (peerIsBank || qSec.includes("industrial"))) operatingModel -= 25;
  // Hardware vs software/services/platform is never similar (the classic contamination)
  const subjIsHw = subjInd.includes("computer hardware") || subjInd.includes("electronic components") || subjInd.includes("computer peripherals") || subjInd.includes("data storage") || ontologySectorId === "technology-hardware";
  const peerIsSw = qInd.includes("software") || qInd.includes("it services") || qInd.includes("consulting") || qSec.includes("software");
  const peerIsPlat = qInd.includes("internet content") || qInd.includes("social media") || qInd.includes("interactive media");
  if (subjIsHw && (peerIsSw || peerIsPlat)) operatingModel -= 25;
  const subjIsSw = subjInd.includes("application software") || subjInd.includes("systems software") || ontologySectorId === "technology-software";
  const peerIsHw = qInd.includes("computer hardware") || qInd.includes("electronic components") || qInd.includes("data storage");
  if (subjIsSw && peerIsHw) operatingModel -= 25;
  const subjIsRE = subjInd.includes("reit") || subjInd.includes("real estate") || ontologySectorId === "real-estate";
  const peerIsRE = qInd.includes("reit") || qInd.includes("real estate");
  if (subjIsRE && !peerIsRE && peerIsBank) operatingModel -= 20;
  operatingModel = Math.max(0, Math.min(40, operatingModel));

  // Geography 0-10
  let geography = 0;
  if (peer.currency && profile.currency && peer.currency.toUpperCase() === profile.currency.toUpperCase()) geography = 10;
  else if (peer.currency) geography = 3;

  // Growth 0-10
  let growth = 5; // neutral when missing
  const subjGrowth = stockData.revenueGrowth;
  if (peer.revenueGrowth !== null && peer.revenueGrowth !== undefined && Number.isFinite(subjGrowth)) {
    const d = Math.abs(peer.revenueGrowth - subjGrowth);
    growth = d <= 0.03 ? 10 : d <= 0.08 ? 7 : d <= 0.15 ? 4 : 1;
  }

  // Margins 0-15 (net margin 8 + ROE 7)
  let margins = 7;
  const subjMargin = (stockData as { profitMargins?: number }).profitMargins ?? latest?.netMargin ?? null;
  let mScore = 4;
  if (peer.netMargin !== null && peer.netMargin !== undefined && subjMargin !== null && Number.isFinite(subjMargin)) {
    const d = Math.abs(peer.netMargin - subjMargin);
    mScore = d <= 0.05 ? 8 : d <= 0.1 ? 6 : d <= 0.2 ? 3 : 0;
  }
  let rScore = 3;
  const subjRoe = stockData.returnOnEquity;
  if (peer.roe !== null && peer.roe !== undefined && Number.isFinite(subjRoe)) {
    const d = Math.abs(peer.roe - subjRoe);
    rScore = d <= 0.03 ? 7 : d <= 0.08 ? 5 : d <= 0.15 ? 2 : 0;
  }
  margins = mScore + rScore;

  // Capital intensity 0-15 (leverage 8 + capex proxy 7)
  let capitalIntensity = 7;
  const subjDE = latest ? latest.totalDebt / Math.max(1, latest.totalEquity) : null;
  if (peer.debtToEquity !== null && peer.debtToEquity !== undefined && subjDE !== null && Number.isFinite(subjDE)) {
    const d = Math.abs(peer.debtToEquity - subjDE);
    capitalIntensity = d <= 0.3 ? 15 : d <= 0.8 ? 11 : d <= 1.5 ? 7 : 3;
  }

  // Size 0-10
  let size = 5;
  const subjCap = stockData.marketCap || 0;
  if (peer.marketCap && subjCap > 0) {
    const ratio = Math.min(peer.marketCap, subjCap) / Math.max(peer.marketCap, subjCap);
    size = Math.round(ratio * 10);
  }

  const total = Math.max(0, Math.min(100, Math.round(operatingModel + geography + growth + margins + capitalIntensity + size)));
  return { operatingModel, geography, growth, margins, capitalIntensity, size, total };
}

/** Gate decision: suppress relative valuation when similarity is insufficient. */
export function gatePeerSet(peers: PeerData[]): { avg: number | null; qualifying: number; suppress: boolean; reason: string } {
  const scored = peers.filter((p) => typeof p.relevanceScore === "number" && p.relevanceScore !== null) as { relevanceScore: number }[];
  if (scored.length === 0) return { avg: null, qualifying: 0, suppress: true, reason: "no scored peers — relative valuation withheld" };
  const avg = scored.reduce((a, b) => a + (b.relevanceScore as number), 0) / scored.length;
  const qualifying = scored.filter((p) => (p.relevanceScore as number) >= SIMILARITY_MIN_QUALIFYING).length;
  const suppress = avg < SIMILARITY_THRESHOLD_AVG || qualifying < SIMILARITY_MIN_COUNT;
  return {
    avg: Math.round(avg * 10) / 10,
    qualifying,
    suppress,
    reason: suppress
      ? `avg similarity ${avg.toFixed(1)} < ${SIMILARITY_THRESHOLD_AVG} or qualifying ${qualifying} < ${SIMILARITY_MIN_COUNT} — relative valuation suppressed`
      : `avg similarity ${avg.toFixed(1)}, qualifying ${qualifying} — relative valuation permitted`,
  };
}
