import type { ExportPayload } from "../exporters";
import type { AgentAction, AgentResult, AgentSection } from "./types";
import { fmt, isNum, num, pct } from "../format";

const act = (
  agentId: string,
  agentName: string,
  lens: string,
  section: AgentSection,
  kind: AgentAction["kind"],
  target: string,
  confidence: number,
  rationale: string,
  payload: any = {},
): AgentAction => ({ agentId, agentName, lens, section, kind, target, payload, confidence, rationale });

function money(v: any, c?: string): string {
  if (!isNum(v)) return "—";
  const formatted = Math.abs(v) < 1000 ? num(v, 2) : fmt(v);
  return `${formatted}${c ? ` ${c}` : ""}`;
}

export function forecastAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const forecast = payload.forecast || null;
  const periods: any[] = Array.isArray(forecast?.periods) ? forecast.periods : [];
  const assumptions = payload.assumptions || forecast?.assumptions || {};
  const currency = payload.currency || "USD";
  if (!periods.length) return { agentId: "forecast-01", agentName: "Forecast Agent", lens: "base-case projections", actions, findings: ["No forecast data available."], confidence: 0.5 };
  const latest = periods[periods.length - 1];
  actions.push(
    act("forecast-01", "Forecast Agent", "final revenue", "forecast", "addPair", `Final-year revenue · ${money(latest.revenue, currency)}`, 0.96, "Base-case revenue in the final forecast year."),
    act("forecast-02", "Forecast Agent", "final EBITDA", "forecast", "addPair", `Final-year EBITDA · ${money(latest.ebitda, currency)}`, 0.95, "Base-case EBITDA in the final forecast year."),
    act("forecast-03", "Forecast Agent", "final FCF", "forecast", "addPair", `Final-year FCF · ${money(latest.free_cash_flow, currency)}`, 0.96, "Base-case free cash flow in the final forecast year."),
    act("forecast-04", "Forecast Agent", "revenue CAGR", "forecast", "addPair", `Forecast revenue CAGR · ${isNum(forecast?.summary?.revenue_cagr) ? pct(forecast.summary?.revenue_cagr) : "—"}`, 0.95, "Compound annual growth across the forecast horizon."),
    act("forecast-05", "Forecast Agent", "balance identity", "forecast", "addPair", `Balance-sheet identity · ${forecast?.summary?.balance_ok ? "Balanced every year" : "Mismatch detected"}`, forecast?.summary?.balance_ok ? 0.97 : 0.6, "Three-statement model integrity check."),
    act("forecast-06", "Forecast Agent", "documented drivers", "forecast", "addText", `Drivers: ${Object.entries(assumptions).filter(([, v]) => isNum(v)).map(([k, v]) => `${k.replace(/_/g, " ")}: ${pct(v as number)}`).join("; ")}`, 0.93, "Each forecast driver is documented with a source."),
  );
  const findings = [`Forecast: final revenue ${money(latest.revenue, currency)}, FCF ${money(latest.free_cash_flow, currency)}, balance identity ${forecast?.summary?.balance_ok ? "ok" : "mismatch"}.`];
  return { agentId: "forecast-01", agentName: "Forecast Agent", lens: "base-case projections", actions, findings, confidence: 0.94 };
}

export function dcfAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const dcf = payload.dcf || null;
  const currency = payload.currency || "USD";
  if (!dcf || dcf.error) return { agentId: "dcf-01", agentName: "DCF Agent", lens: "discounted cash flow valuation", actions, findings: ["No valid DCF output available."], confidence: 0.5 };
  actions.push(
    act("dcf-01", "DCF Agent", "risk-free rate", "valuation", "addPair", `Risk-free rate · ${isNum(dcf.wacc_components?.risk_free) ? pct(dcf.wacc_components.risk_free, 2) : "—"}`, 0.96, "CAPM risk-free input."),
    act("dcf-02", "DCF Agent", "equity beta", "valuation", "addPair", `Equity beta · ${isNum(dcf.wacc_components?.beta) ? num(dcf.wacc_components.beta, 2) : "—"}`, 0.95, "Levered equity beta."),
    act("dcf-03", "DCF Agent", "market risk premium", "valuation", "addPair", `Market risk premium · ${isNum(dcf.wacc_components?.market_premium) ? pct(dcf.wacc_components.market_premium, 2) : "—"}`, 0.95, "Equity risk premium over risk-free."),
    act("dcf-04", "DCF Agent", "cost of equity", "valuation", "addPair", `Cost of equity · ${isNum(dcf.wacc_components?.cost_of_equity) ? pct(dcf.wacc_components.cost_of_equity, 2) : "—"}`, 0.96, "Rf + beta × MRP."),
    act("dcf-05", "DCF Agent", "after-tax cost of debt", "valuation", "addPair", `After-tax cost of debt · ${isNum(dcf.wacc_components?.after_tax_cost_of_debt) ? pct(dcf.wacc_components.after_tax_cost_of_debt, 2) : "—"}`, 0.95, "Pre-tax debt cost × (1 − tax rate)."),
    act("dcf-06", "DCF Agent", "WACC applied", "valuation", "addPair", `WACC · ${pct(dcf.wacc, 2)}`, 0.97, "Blended cost of capital used to discount cash flows."),
    act("dcf-07", "DCF Agent", "enterprise value", "valuation", "addPair", `Enterprise value · ${money(dcf.enterprise_value, currency)}`, 0.97, "PV of explicit cash flows plus PV of terminal value."),
    act("dcf-08", "DCF Agent", "net debt / cash", "valuation", "addPair", `Net ${isNum(dcf.net_debt) && dcf.net_debt >= 0 ? "debt" : "cash"} · ${money(Math.abs(dcf.net_debt ?? 0), currency)}`, 0.96, "Debt less cash, subtracted from EV to get equity value."),
    act("dcf-09", "DCF Agent", "equity value", "valuation", "addPair", `Equity value · ${money(dcf.equity_value, currency)}`, 0.97, "Enterprise value less net debt (or plus net cash)."),
    act("dcf-10", "DCF Agent", "value per share", "valuation", "addPair", `Value per share · ${isNum(dcf.value_per_share) ? `${num(dcf.value_per_share)} ${currency}` : "—"}`, 0.97, "DCF-implied fair value per share."),
  );
  const findings = [`DCF: WACC ${pct(dcf.wacc, 2)}, EV ${money(dcf.enterprise_value, currency)}, equity value ${money(dcf.equity_value, currency)}, value/share ${isNum(dcf.value_per_share) ? num(dcf.value_per_share) : "n/a"} ${currency}.`];
  return { agentId: "dcf-01", agentName: "DCF Agent", lens: "discounted cash flow valuation", actions, findings, confidence: 0.95 };
}

export function sensitivityAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const sensitivity = payload.sensitivity || null;
  if (!sensitivity || sensitivity.error) return { agentId: "sensitivity-01", agentName: "Sensitivity Agent", lens: "WACC vs terminal growth grid", actions, findings: ["No sensitivity grid available."], confidence: 0.5 };
  const waccValues = Array.isArray(sensitivity.wacc_values) ? sensitivity.wacc_values : [];
  const terminalValues = Array.isArray(sensitivity.terminal_values) ? sensitivity.terminal_values : [];
  const table = Array.isArray(sensitivity.table) ? sensitivity.table : [];
  if (!waccValues.length || !terminalValues.length || !table.length) return { agentId: "sensitivity-01", agentName: "Sensitivity Agent", lens: "WACC vs terminal growth grid", actions, findings: ["Sensitivity grid is empty."], confidence: 0.5 };
  actions.push(
    act("sensitivity-01", "Sensitivity Agent", "WACC vs terminal growth", "valuation", "addTable", `sensitivity_grid · mode=${sensitivity.mode}`, 0.96, "Value per share across WACC and terminal assumption grid.", { waccValues, terminalValues, table, mode: sensitivity.mode }),
    act("sensitivity-02", "Sensitivity Agent", "sensitivity note", "valuation", "addText", `Sensitivity maps model response to assumptions; it does not remove uncertainty. Base WACC ${pct(payload.dcf?.wacc, 2)} with terminal ${payload.dcf?.terminal_growth ?? payload.dcf?.exit_multiple ?? "n/a"}.`, 0.9, "Cautionary interpretation of the grid."),
  );
  const findings = [`Sensitivity grid: ${waccValues.length} WACC points × ${terminalValues.length} terminal points, mode=${sensitivity.mode}.`];
  return { agentId: "sensitivity-01", agentName: "Sensitivity Agent", lens: "WACC vs terminal growth grid", actions, findings, confidence: 0.95 };
}

export function reverseDcfAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const reverse = payload.reverse_dcf || null;
  const dcf = payload.dcf || null;
  const currency = payload.currency || "USD";
  const price = payload.current_price;
  if (!reverse || reverse.error || !isNum(reverse.implied_wacc)) return { agentId: "reverse-01", agentName: "Reverse DCF Agent", lens: "implied WACC at market price", actions, findings: ["No reverse DCF output available."], confidence: 0.5 };
  actions.push(
    act("reverse-01", "Reverse DCF Agent", "implied WACC", "valuation", "addPair", `Implied WACC at market price · ${pct(reverse.implied_wacc, 2)}`, 0.97, "The WACC the market is pricing at the current share price."),
    act("reverse-02", "Reverse DCF Agent", "stated WACC", "valuation", "addPair", `Stated WACC · ${isNum(dcf?.wacc) ? pct(dcf.wacc, 2) : "—"}`, 0.96, "Our model's cost of capital."),
    act("reverse-03", "Reverse DCF Agent", "market premium vs model", "valuation", "addPair", `Market vs model · ${isNum(price) && price > 0 ? (reverse.implied_wacc > (dcf?.wacc ?? 0) ? "market discounts more steeply" : "market discounts less steeply") : "n/a"}`, 0.95, "Whether the market demands a higher or lower return than our model."),
    act("reverse-04", "Reverse DCF Agent", "current price", "valuation", "addPair", `Market price · ${isNum(price) ? `${num(price)} ${currency}` : "—"}`, 0.95, "Reference price used to back out the implied WACC."),
  );
  const findings = [`Reverse DCF: implied WACC ${pct(reverse.implied_wacc, 2)} vs stated ${pct(dcf?.wacc, 2)} at price ${isNum(price) ? num(price) : "n/a"} ${currency}.`];
  return { agentId: "reverse-01", agentName: "Reverse DCF Agent", lens: "implied WACC at market price", actions, findings, confidence: 0.96 };
}

export function scenarioAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const scenarios = payload.scenarios;
  const currency = payload.currency || "USD";
  if (!scenarios || typeof scenarios !== "object") return { agentId: "scenario-01", agentName: "Scenario Agent", lens: "bull / base / bear cases", actions, findings: ["No scenario data available."], confidence: 0.5 };
  const keys = ["bull", "base", "bear"].filter((k) => scenarios[k]);
  if (!keys.length) return { agentId: "scenario-01", agentName: "Scenario Agent", lens: "bull / base / bear cases", actions, findings: ["No scenario rows available."], confidence: 0.5 };
  const rows = keys.map((k) => {
    const s = scenarios[k];
    return { scenario: s?.label || k, growth: s?.assumptions?.revenue_growth, margin: s?.assumptions?.gross_margin, value: s?.dcf_value_per_share, ev: s?.enterprise_value };
  });
  actions.push(
    act("scenario-01", "Scenario Agent", "scenario comparison", "valuation", "addTable", `scenarios · ${keys.join(", ")}`, 0.96, "Value per share under bull / base / bear driver assumptions.", { rows, currency }),
    act("scenario-02", "Scenario Agent", "scenario note", "valuation", "addText", "Scenarios reflect distinct driver assumptions on revenue growth, margins, capex and tax; they are not price adjustments.", 0.9, "Interpretive guardrail for scenario spread."),
  );
  const findings = [`Scenarios: ${keys.map((k) => `${scenarios[k]?.label || k} = ${isNum(scenarios[k]?.dcf_value_per_share) ? num(scenarios[k].dcf_value_per_share) : "n/a"} ${currency}`).join("; ")}.`];
  return { agentId: "scenario-01", agentName: "Scenario Agent", lens: "bull / base / bear cases", actions, findings, confidence: 0.95 };
}

export function monteCarloAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const mc = payload.monte_carlo || null;
  const currency = payload.currency || "USD";
  const price = payload.current_price;
  if (!mc || mc.error) return { agentId: "monteCarlo-01", agentName: "Monte Carlo Agent", lens: "value-per-share distribution", actions, findings: ["No Monte Carlo output available."], confidence: 0.5 };
  const iterations = isNum(mc.iterations) ? mc.iterations : 0;
  const p = mc.percentiles || {};
  if (!iterations) return { agentId: "monteCarlo-01", agentName: "Monte Carlo Agent", lens: "value-per-share distribution", actions, findings: ["Monte Carlo ran zero iterations."], confidence: 0.5 };
  actions.push(
    act("monteCarlo-01", "Monte Carlo Agent", "distribution table", "valuation", "addTable", `monte_carlo · n=${iterations}`, 0.96, "Percentile distribution of simulated value per share.", { p, price, currency, iterations }),
    act("monteCarlo-02", "Monte Carlo Agent", "mean value", "valuation", "addPair", `Mean value · ${isNum(mc.mean) ? `${num(mc.mean, 2)} ${currency}` : "—"}`, 0.95, "Average simulated value per share."),
    act("monteCarlo-03", "Monte Carlo Agent", "range", "valuation", "addPair", `Range (min–max) · ${isNum(mc.min) && isNum(mc.max) ? `${num(mc.min, 2)} to ${num(mc.max, 2)} ${currency}` : "—"}`, 0.94, "Full spread of simulated outcomes."),
    act("monteCarlo-04", "Monte Carlo Agent", "interpretation", "valuation", "addText", `Drivers and WACC resampled per run; each run re-values the same three-statement forecast. The distribution reflects model sensitivity, not a forecast of returns. ${isNum(price) && price > 0 ? `At ${num(price)} ${currency}, the market sits between the ${isNum(p.p5) && price < p.p5 ? "below p5" : isNum(p.p95) && price > p.p95 ? "above p95" : "interquartile"} region.` : ""}`.trim(), 0.92, "Honest framing of the simulation as sensitivity, not prediction."),
  );
  const findings = [`Monte Carlo: ${iterations} runs, p50 ${isNum(p.p50) ? num(p.p50) : "n/a"} ${currency}, mean ${isNum(mc.mean) ? num(mc.mean) : "n/a"} ${currency}, range ${isNum(mc.min) ? num(mc.min) : "n/a"}–${isNum(mc.max) ? num(mc.max) : "n/a"} ${currency}.`];
  return { agentId: "monteCarlo-01", agentName: "Monte Carlo Agent", lens: "value-per-share distribution", actions, findings, confidence: 0.95 };
}

export function peerCompsAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const comps = payload.peer_comps || null;
  const rows = Array.isArray(comps?.peers) ? comps.peers : [];
  const currency = payload.currency || "USD";
  if (!comps || !rows.length) return { agentId: "peerComps-01", agentName: "Peer Comps Agent", lens: "relative valuation multiples", actions, findings: ["No peer comparables available."], confidence: 0.5 };
  const target = comps.target || {};
  const medians = comps.medians || {};
  const fmtX = (v: any) => (isNum(v) ? (v > 0 ? `${num(v, 1)}x` : "n.m.") : "—");
  actions.push(
    act("peerComps-01", "Peer Comps Agent", "peer multiples table", "valuation", "addTable", `peer_comps · ${rows.length} peers`, 0.96, "P/E, EV/EBITDA, P/B, EV/sales for target and peers plus peer medians.", { target, rows, medians, currency, fmtX }),
    act("peerComps-02", "Peer Comps Agent", "median P/E", "valuation", "addPair", `Median peer P/E · ${isNum(medians.pe) ? num(medians.pe, 1) + "x" : "—"}`, 0.95, "Median price-to-earnings across the peer set."),
    act("peerComps-03", "Peer Comps Agent", "target vs median", "valuation", "addPair", `Premium/(discount) vs median P/E · ${isNum(comps.premium_discount_vs_median_pe) ? pct(comps.premium_discount_vs_median_pe) : "—"}`, 0.95, "Whether the target trades rich or cheap vs peers."),
  );
  const findings = [`Peer comps: ${comps.peer_count} peers, median P/E ${isNum(medians.pe) ? num(medians.pe, 1) + "x" : "n/a"}, target ${isNum(comps.premium_discount_vs_median_pe) ? pct(comps.premium_discount_vs_median_pe) : "n/a"} vs median.`];
  return { agentId: "peerComps-01", agentName: "Peer Comps Agent", lens: "relative valuation multiples", actions, findings, confidence: 0.95 };
}
