/**
 * APEX RESEARCH — Valuation Audit Engine (first-class DCF audit)
 *
 * Answers the institutional question the POWERGRID-style review asks:
 * "don't trust the model — AUDIT it, quantify every correction in ₹/share,
 * and show where independent methods disagree."
 *
 * Pure + deterministic. Operates ONLY on the engine's own outputs
 * (DCFResult + peers + quote + statements) — it verifies the ENGINE's
 * internal arithmetic, while XREF-02/03/05 verify ledger sync. Same
 * tolerances as XREF (±1000 money units, ±1.0/share) so the two layers
 * can never contradict each other.
 *
 * Sections:
 *   1. Bridge audit — EV = PV(FCFF) + PV(TV); Equity = EV − NetDebt;
 *      FV = Equity / Shares; plus the per-share decomposition
 *      (explicit-FCFF/share + TV/share − net-debt/share = FV).
 *   2. Terminal concentration — PV(TV)/EV share with HIGH/EXTREME bands.
 *   3. WACC input audit — beta/Rf/ERP/weights/terminal-g sanity + provenance.
 *   4. Cross-method disagreement — DCF vs peer P/E-implied vs peer
 *      EV/EBITDA-implied vs Street consensus (Yahoo targets): median,
 *      dispersion, and whether the DCF is the outlier.
 */

import type { AnnualFinancials, DCFResult, PeerData, StockData } from "@/types/report";
import { stmtNum } from "@/types/report";

export type AuditStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

export interface BridgeDecomposition {
  sumPvFcff: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  recomputedEv: number;
  evVariance: number;
  netDebt: number;
  equityValue: number;
  recomputedEquity: number;
  equityVariance: number;
  sharesOutstanding: number;
  fairValuePerShare: number;
  recomputedPerShare: number | null;
  perShareVariance: number | null;
  /** ₹/share anatomy of the target: explicit FCFF + terminal − net debt. */
  explicitFcffPerShare: number | null;
  terminalPerShare: number | null;
  lessNetDebtPerShare: number | null;
  tvPctOfEv: number | null;
  status: AuditStatus;
  detail: string;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmt0 = (n: number): string =>
  `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("en")}`;

/**
 * 1. Independent bridge recomputation + per-share decomposition.
 * SOTP-primary reports price off SOTP equity (GAV − discount − net debt),
 * so the bridge audits the FCFF CROSS-CHECK leg there — same scoping as
 * XREF-01 — while SOTP-01 owns the priced SOTP bridge.
 */
export function auditValuationBridge(dcf: DCFResult): BridgeDecomposition {
  const xc = (dcf as any)?.sotpBreakdown?.crossCheck;
  const isSotp = !!xc && typeof xc.enterpriseValue === "number";
  const sumPvFcff = num(xc?.sumPvFcff ?? (dcf as any).sumPvFcff);
  const pvTv = num(xc?.pvTerminalValue ?? (dcf as any).pvTerminalValue);
  const ev = num(xc?.enterpriseValue ?? (dcf as any).enterpriseValue);
  const netDebt = isSotp
    ? num(xc.enterpriseValue) - num(xc.equityValue)
    : (dcf as any).netDebt !== undefined && (dcf as any).netDebt !== null
      ? num((dcf as any).netDebt)
      : num((dcf as any).lessDebt) - num((dcf as any).plusCash);
  const equity = num(xc?.equityValue ?? (dcf as any).equityValue);
  const shares = num((dcf as any).sharesOutstanding);
  const fv = num(xc?.fairValuePerShare ?? (dcf as any).fairValuePerShare ?? (dcf as any).intrinsicValue);
  const scopeNote = isSotp ? "FCFF cross-check leg (SOTP primary prices equity; SOTP-01 verifies that bridge). " : "";

  const recomputedEv = sumPvFcff + pvTv;
  const evVariance = Math.abs(ev - recomputedEv);
  const recomputedEquity = ev - netDebt;
  const equityVariance = Math.abs(equity - recomputedEquity);
  const recomputedPerShare = shares > 0 && equity > 0 ? equity / shares : null;
  const perShareVariance = recomputedPerShare !== null && fv > 0 ? Math.abs(fv - recomputedPerShare) : null;

  const explicitFcffPerShare = shares > 0 ? sumPvFcff / shares : null;
  const terminalPerShare = shares > 0 ? pvTv / shares : null;
  const lessNetDebtPerShare = shares > 0 ? netDebt / shares : null;
  const tvPctOfEv = ev > 0 && pvTv >= 0 ? pvTv / ev : null;

  const bridgeOk = evVariance <= 1000 && equityVariance <= 1000;
  const perShareOk = perShareVariance === null || perShareVariance <= 1.0;
  const status: AuditStatus =
    !(shares > 0) || !(fv > 0) || !(equity > 0)
      ? "SKIP"
      : bridgeOk && perShareOk
        ? "PASS"
        : "FAIL";

  const anatomy =
    explicitFcffPerShare !== null && terminalPerShare !== null && lessNetDebtPerShare !== null && recomputedPerShare !== null
      ? `₹/share anatomy: explicit FCFF ${explicitFcffPerShare.toFixed(2)} + terminal ${terminalPerShare.toFixed(2)} − net debt ${lessNetDebtPerShare.toFixed(2)} = ${recomputedPerShare.toFixed(2)} vs published ${fv.toFixed(2)}.`
      : `Per-share anatomy unavailable (shares ${shares > 0 ? shares.toFixed(0) : "unresolved"}).`;
  const detail =
    status === "SKIP"
      ? `${scopeNote}No positive model equity exists (status ${(dcf as any).status ?? "unknown"}) — bridge audit not applicable; XREF owns the NR disclosure.`
      : status === "PASS"
        ? `${scopeNote}EV ${fmt0(ev)} = PV(FCFF) ${fmt0(sumPvFcff)} + PV(TV) ${fmt0(pvTv)} (Δ ${fmt0(evVariance)}); Equity ${fmt0(equity)} = EV − net debt ${fmt0(netDebt)} (Δ ${fmt0(equityVariance)}). ${anatomy}`
        : `${scopeNote}Bridge break: EV Δ ${fmt0(evVariance)}, equity Δ ${fmt0(equityVariance)}, per-share Δ ${perShareVariance !== null ? perShareVariance.toFixed(2) : "n/a"}. ${anatomy}`;

  return {
    sumPvFcff, pvTerminalValue: pvTv, enterpriseValue: ev, recomputedEv, evVariance,
    netDebt, equityValue: equity, recomputedEquity, equityVariance,
    sharesOutstanding: shares, fairValuePerShare: fv, recomputedPerShare, perShareVariance,
    explicitFcffPerShare, terminalPerShare, lessNetDebtPerShare, tvPctOfEv,
    status, detail,
  };
}

// ─────────────────────────────────────────────
// 2. Terminal concentration
// ─────────────────────────────────────────────

export interface TerminalConcentration {
  tvPctOfEv: number | null;
  band: "LOW" | "MODERATE" | "HIGH" | "EXTREME" | "UNKNOWN";
  status: AuditStatus;
  detail: string;
}

/** TV share of EV: <50% LOW, 50–75% MODERATE, 75–90% HIGH, >90% EXTREME. WARN at HIGH+. */
export function auditTerminalConcentration(dcf: DCFResult): TerminalConcentration {
  const pvTv = num((dcf as any).pvTerminalValue);
  const ev = num((dcf as any).enterpriseValue);
  if (!(ev > 0) || pvTv < 0) {
    return { tvPctOfEv: null, band: "UNKNOWN", status: "SKIP", detail: "Terminal concentration unmeasurable (non-positive EV) — skipped." };
  }
  const pct = pvTv / ev;
  const band = pct < 0.5 ? "LOW" : pct < 0.75 ? "MODERATE" : pct <= 0.9 ? "HIGH" : "EXTREME";
  const status: AuditStatus = band === "LOW" || band === "MODERATE" ? "PASS" : "WARN";
  return {
    tvPctOfEv: pct,
    band,
    status,
    detail:
      status === "PASS"
        ? `Terminal value is ${(pct * 100).toFixed(0)}% of EV (${band} dependency) — explicit-period cash flows carry the valuation.`
        : `Terminal value is ${(pct * 100).toFixed(0)}% of EV (${band} dependency) — the target is a terminal-growth bet; treat explicit-period precision accordingly and demand HIGH conviction on terminal g.`,
  };
}

// ─────────────────────────────────────────────
// 3. WACC input audit
// ─────────────────────────────────────────────

export interface WaccCheck {
  name: string;
  status: AuditStatus;
  detail: string;
}

export interface WaccAudit {
  wacc: number;
  checks: WaccCheck[];
  status: AuditStatus;
  detail: string;
}

/** Sanity-band every WACC input; provenance acknowledged, never required. */
export function auditWaccInputs(dcf: DCFResult): WaccAudit {
  const a = ((dcf.assumptions || {}) as unknown) as Record<string, unknown>;
  const wacc = num(a.wacc);
  const beta = num(a.beta);
  const rf = num(a.riskFreeRate);
  const erp = num(a.equityRiskPremium);
  const tgr = num(a.terminalGrowthRate);
  const codPre = num(a.costOfDebtPreTax);
  const dw = num(a.debtWeight);
  const ew = num(a.equityWeight);
  const prov = (dcf.assumptions as unknown as { inputProvenance?: Record<string, string> })?.inputProvenance;
  const checks: WaccCheck[] = [];

  const push = (name: string, ok: boolean, detail: string) =>
    checks.push({ name, status: ok ? "PASS" : "WARN", detail });

  push("Beta range", beta >= 0.3 && beta <= 2.5, `Beta ${beta.toFixed(2)} ${beta >= 0.3 && beta <= 2.5 ? "inside" : "OUTSIDE"} the [0.30, 2.50] sanity band.`);
  push("Risk-free rate", rf >= 0.02 && rf <= 0.12, `Rf ${(rf * 100).toFixed(2)}% ${rf >= 0.02 && rf <= 0.12 ? "plausible" : "OUTSIDE"} the [2%, 12%] nominal band — verify freshness against the 10Y sovereign yield.`);
  push("Equity risk premium", erp >= 0.04 && erp <= 0.08, `ERP ${(erp * 100).toFixed(2)}% ${erp >= 0.04 && erp <= 0.08 ? "inside" : "OUTSIDE"} the [4%, 8%] band.`);
  push("Capital weights", Math.abs(dw + ew - 1) <= 0.02 && dw >= 0 && ew > 0, `Debt ${(dw * 100).toFixed(1)}% + equity ${(ew * 100).toFixed(1)}% ${Math.abs(dw + ew - 1) <= 0.02 ? "sums to ~100%" : "DO NOT sum to 100%"} — market-value weights required.`);
  push("Cost of debt vs Rf", codPre + 0.005 >= rf, `Pre-tax cost of debt ${(codPre * 100).toFixed(2)}% vs Rf ${(rf * 100).toFixed(2)}% — ${codPre + 0.005 >= rf ? "coherent (debt ≥ sovereign)" : "INCOHERENT (debt cheaper than government)"}.`);
  push("Terminal growth", tgr >= 0.02 && tgr <= 0.06, `Terminal g ${(tgr * 100).toFixed(2)}% ${tgr >= 0.02 && tgr <= 0.06 ? "inside" : "OUTSIDE"} the [2%, 6%] nominal-GDP anchor band.`);
  push("WACC band", wacc >= 0.06 && wacc <= 0.2, `WACC ${(wacc * 100).toFixed(2)}% ${wacc >= 0.06 && wacc <= 0.2 ? "inside" : "OUTSIDE"} the [6%, 20%] institutional band.`);
  if (prov) {
    checks.push({ name: "Input provenance", status: "PASS", detail: `Per-input sourcing recorded (beta: ${prov.beta || "n/a"}; weights: ${prov.weights || "n/a"}; country: ${prov.country || "n/a"}).` });
  }

  const warns = checks.filter((c) => c.status === "WARN");
  return {
    wacc,
    checks,
    status: warns.length === 0 ? "PASS" : "WARN",
    detail: warns.length === 0
      ? `All ${checks.length} WACC inputs inside sanity bands (Rf/ERP/weights/terminal-g coherent).`
      : `${warns.length} WACC input(s) outside sanity bands: ${warns.map((w) => w.detail).join(" ")}`,
  };
}

// ─────────────────────────────────────────────
// 4. Cross-method disagreement (DCF vs multiples vs Street)
// ─────────────────────────────────────────────

export interface DisagreementLeg {
  method: string;
  fairValue: number | null;
  basis: string;
}

export interface ValuationDisagreement {
  legs: DisagreementLeg[];
  median: number | null;
  dispersion: number | null;
  dcfPremiumVsMedian: number | null;
  verdict: "AGREE" | "DIVERGE" | "DCF_OUTLIER" | "UNVERIFIABLE";
  status: AuditStatus;
  detail: string;
}

function medianOf(vs: number[]): number | null {
  if (vs.length === 0) return null;
  const s = [...vs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Independent cross-checks from data already on hand: peer-median P/E × EPS,
 * peer-median EV/EBITDA × EBITDA − net debt → per share, and Street consensus
 * (Yahoo targets). Legs that cannot be built (thin peers, negative earnings)
 * are disclosed as absent — never synthesized.
 */
export function auditDisagreement(args: {
  dcfFv: number;
  eps: number;
  ebitda: number;
  netDebt: number;
  shares: number;
  peers: PeerData[];
  streetMean: number;
  streetHigh: number;
  streetLow: number;
  opinions: number;
}): ValuationDisagreement {
  const legs: DisagreementLeg[] = [];
  legs.push({ method: "DCF", fairValue: args.dcfFv > 0 ? args.dcfFv : null, basis: "5Y explicit FCFF + Gordon terminal" });

  const peerPes = args.peers.map((p) => p.pe).filter((v): v is number => typeof v === "number" && v > 0);
  if (peerPes.length >= 2 && args.eps > 0 && args.shares > 0) {
    const med = medianOf(peerPes) as number;
    legs.push({ method: "P/E", fairValue: Math.round(med * args.eps * 100) / 100, basis: `peer-median P/E ${med.toFixed(1)}x (${peerPes.length} peers) × EPS ${args.eps.toFixed(2)}` });
  } else {
    legs.push({ method: "P/E", fairValue: null, basis: `insufficient (${peerPes.length} valid peer P/Es, EPS ${args.eps.toFixed(2)}) — leg absent, not modeled` });
  }

  const peerEvs = args.peers.map((p) => p.evToEbitda).filter((v): v is number => typeof v === "number" && v > 0);
  if (peerEvs.length >= 2 && args.ebitda > 0 && args.shares > 0) {
    const med = medianOf(peerEvs) as number;
    const ev = med * args.ebitda;
    legs.push({ method: "EV/EBITDA", fairValue: Math.round(((ev - args.netDebt) / args.shares) * 100) / 100, basis: `peer-median EV/EBITDA ${med.toFixed(1)}x (${peerEvs.length} peers) × EBITDA, less net debt, per share` });
  } else {
    legs.push({ method: "EV/EBITDA", fairValue: null, basis: `insufficient (${peerEvs.length} valid peer multiples, EBITDA ${args.ebitda > 0 ? "positive" : "non-positive"}) — leg absent, not modeled` });
  }

  if (args.opinions > 0 && args.streetMean > 0) {
    legs.push({ method: "Street", fairValue: args.streetMean, basis: `consensus mean ${args.streetMean.toFixed(2)} (${args.opinions} opinions${args.streetLow > 0 && args.streetHigh > 0 ? `, range ${args.streetLow.toFixed(2)}–${args.streetHigh.toFixed(2)}` : ""})` });
  } else {
    legs.push({ method: "Street", fairValue: null, basis: "no analyst targets on record — leg absent, not modeled" });
  }

  const values = legs.map((l) => l.fairValue).filter((v): v is number => typeof v === "number" && v > 0);
  if (values.length < 3 || args.dcfFv <= 0) {
    return {
      legs, median: medianOf(values), dispersion: null, dcfPremiumVsMedian: null,
      verdict: "UNVERIFIABLE", status: "PASS",
      detail: `Only ${values.length} valuation leg(s) available — dispersion cannot be judged. Legs: ${legs.map((l) => `${l.method} ${l.fairValue !== null ? l.fairValue.toFixed(2) : "n/a"}`).join(" · ")}.`,
    };
  }
  const med = medianOf(values) as number;
  const dispersion = (Math.max(...values) - Math.min(...values)) / med;
  const dcfPrem = (args.dcfFv - med) / med;
  const others = values.filter((v) => v !== args.dcfFv);
  const dcfOutside = others.length > 0 && (args.dcfFv < Math.min(...others) || args.dcfFv > Math.max(...others));
  const verdict = dcfOutside && dispersion > 0.25 ? "DCF_OUTLIER" : dispersion > 0.5 ? "DIVERGE" : "AGREE";
  return {
    legs, median: med, dispersion, dcfPremiumVsMedian: dcfPrem, verdict,
    status: verdict === "AGREE" ? "PASS" : "WARN",
    detail: verdict === "AGREE"
      ? `Methods agree within range: median ${med.toFixed(2)}, dispersion ${(dispersion * 100).toFixed(0)}%. Legs: ${legs.map((l) => `${l.method} ${l.fairValue !== null ? l.fairValue.toFixed(2) : "n/a"}`).join(" · ")}.`
      : `${verdict === "DCF_OUTLIER" ? "DCF sits OUTSIDE every independent leg" : "HIGH dispersion"}: median ${med.toFixed(2)}, dispersion ${(dispersion * 100).toFixed(0)}%, DCF premium vs median ${dcfPrem >= 0 ? "+" : ""}${(dcfPrem * 100).toFixed(0)}%. Legs: ${legs.map((l) => `${l.method} ${l.fairValue !== null ? l.fairValue.toFixed(2) : "n/a"}`).join(" · ")}. Ask why the DCF disagrees — usually capex/terminal assumptions the other methods reject.`,
  };
}

// ─────────────────────────────────────────────
// Aggregate report
// ─────────────────────────────────────────────

export interface ValuationAuditReport {
  ticker: string;
  bridge: BridgeDecomposition;
  terminal: TerminalConcentration;
  wacc: WaccAudit;
  disagreement: ValuationDisagreement;
  /** HIGH: engine-Arithmetic sound + corroborated. MEDIUM: warned but priced. LOW: no valid model. */
  reliability: "HIGH" | "MEDIUM" | "LOW";
  reliabilityReasons: string[];
  auditedAt: string;
}

export function auditValuation(args: {
  ticker: string;
  dcf: DCFResult;
  stockData: StockData;
  annualFinancials: AnnualFinancials[];
  peers: PeerData[];
}): ValuationAuditReport {
  const { ticker, dcf, stockData, annualFinancials, peers } = args;
  const bridge = auditValuationBridge(dcf);
  // Terminal concentration on the same leg the bridge audits (cross-check leg
  // for SOTP — mixing cross-check PVTV with SOTP GAV would be incoherent).
  const xc = (dcf as any)?.sotpBreakdown?.crossCheck;
  const legDcf = xc && typeof xc.enterpriseValue === "number"
    ? { ...dcf, pvTerminalValue: xc.pvTerminalValue, enterpriseValue: xc.enterpriseValue } as DCFResult
    : dcf;
  const terminal = auditTerminalConcentration(legDcf);
  const wacc = auditWaccInputs(dcf);

  const latest: any = annualFinancials[annualFinancials.length - 1] || {};
  // Disagreement judges the PRICED target (SOTP FV for conglomerates), not
  // the cross-check leg the bridge audits above.
  const pricedFv = num((dcf as any).fairValuePerShare ?? (dcf as any).intrinsicValue);
  const disagreement = auditDisagreement({
    dcfFv: pricedFv,
    eps: typeof latest.eps === "number" && latest.eps > 0 ? latest.eps : (typeof stockData.eps === "number" && stockData.eps > 0 ? stockData.eps : 0),
    ebitda: stmtNum(latest, "ebitda"),
    netDebt: bridge.netDebt,
    shares: bridge.sharesOutstanding,
    peers,
    streetMean: num(stockData.targetMeanPrice),
    streetHigh: num(stockData.targetHighPrice),
    streetLow: num(stockData.targetLowPrice),
    opinions: num(stockData.numberOfAnalystOpinions),
  });

  const reasons: string[] = [];
  let reliability: ValuationAuditReport["reliability"] = "HIGH";
  if (bridge.status !== "PASS") { reliability = "LOW"; reasons.push(`engine bridge ${bridge.status} — no validated model output`); }
  if (terminal.status === "WARN") { if (reliability === "HIGH") reliability = "MEDIUM"; reasons.push(`terminal dependency ${terminal.band} (${terminal.tvPctOfEv !== null ? (terminal.tvPctOfEv * 100).toFixed(0) : "?"}% of EV)`); }
  if (wacc.status === "WARN") { if (reliability === "HIGH") reliability = "MEDIUM"; reasons.push("WACC inputs outside sanity bands"); }
  if (disagreement.verdict === "DCF_OUTLIER" || disagreement.verdict === "DIVERGE") { if (reliability === "HIGH") reliability = "MEDIUM"; reasons.push(`cross-method ${disagreement.verdict} (dispersion ${disagreement.dispersion !== null ? (disagreement.dispersion * 100).toFixed(0) : "?"}%)`); }
  if (reasons.length === 0) reasons.push("engine arithmetic reconciles; inputs sane; methods corroborate");

  return { ticker, bridge, terminal, wacc, disagreement, reliability, reliabilityReasons: reasons, auditedAt: new Date().toISOString() };
}

export default { auditValuationBridge, auditTerminalConcentration, auditWaccInputs, auditDisagreement, auditValuation };
