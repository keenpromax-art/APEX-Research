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
  const formatted = Math.abs(v) < 1000 ? pct(v, 2).replace("%", "") : fmt(v);
  return `${formatted}${c ? ` ${c}` : ""}`;
}

export function incomeAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const annual = payload.annual || {};
  const income = Array.isArray(annual.income_statement) ? annual.income_statement : [];
  const currency = payload.currency || "USD";
  if (!income.length) return { agentId: "income-01", agentName: "Income Statement Agent", lens: "revenue & profitability", actions, findings: ["No income statement data available."], confidence: 0.5 };
  const latest = income[0].items || {};
  const periods = income.slice(0, 6).map((r: any) => r.period_end || r.year || "");
  actions.push(
    act("income-01", "Income Statement Agent", "revenue", "financials", "addPair", `Revenue (latest) · ${money(latest.revenue, currency)}`, 0.96, "Top-line revenue from the latest reported period."),
    act("income-02", "Income Statement Agent", "gross profit", "financials", "addPair", `Gross profit · ${money(latest.gross_profit, currency)}`, 0.95, "Revenue less cost of revenue."),
    act("income-03", "Income Statement Agent", "operating income", "financials", "addPair", `Operating income · ${money(latest.operating_income, currency)}`, 0.95, "Profit from core operations."),
    act("income-04", "Income Statement Agent", "EBITDA", "financials", "addPair", `EBITDA · ${money(latest.ebitda, currency)}`, 0.95, "Earnings before interest, tax, depreciation & amortization."),
    act("income-05", "Income Statement Agent", "net income", "financials", "addPair", `Net income · ${money(latest.net_income, currency)}`, 0.96, "Bottom-line profit attributable to shareholders."),
    act("income-06", "Income Statement Agent", "diluted EPS", "financials", "addPair", `Diluted EPS · ${isNum(latest.diluted_eps) ? num(latest.diluted_eps, 2) : "—"}`, 0.94, "Per-share earnings on a diluted basis."),
    act("income-07", "Income Statement Agent", "history periods", "financials", "addTable", `income_statement · ${periods.join(", ")}`, 0.9, "Multi-year income statement history.", { periods }),
  );
  const findings = [`Income statement: revenue ${money(latest.revenue, currency)}, net income ${money(latest.net_income, currency)} across ${periods.length} reported periods.`];
  return { agentId: "income-01", agentName: "Income Statement Agent", lens: "revenue & profitability", actions, findings, confidence: 0.94 };
}

export function balanceAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const annual = payload.annual || {};
  const balance = Array.isArray(annual.balance_sheet) ? annual.balance_sheet : [];
  const currency = payload.currency || "USD";
  if (!balance.length) return { agentId: "balance-01", agentName: "Balance Sheet Agent", lens: "assets & liabilities", actions, findings: ["No balance sheet data available."], confidence: 0.5 };
  const latest = balance[0].items || {};
  actions.push(
    act("balance-01", "Balance Sheet Agent", "total assets", "financials", "addPair", `Total assets · ${money(latest.total_assets, currency)}`, 0.96, "Total resources controlled by the company."),
    act("balance-02", "Balance Sheet Agent", "current assets", "financials", "addPair", `Current assets · ${money(latest.current_assets, currency)}`, 0.95, "Assets convertible within one year."),
    act("balance-03", "Balance Sheet Agent", "total liabilities", "financials", "addPair", `Total liabilities · ${money(latest.total_liabilities, currency)}`, 0.95, "Total obligations owed."),
    act("balance-04", "Balance Sheet Agent", "total debt", "financials", "addPair", `Total debt · ${money(latest.total_debt, currency)}`, 0.96, "Interest-bearing borrowings."),
    act("balance-05", "Balance Sheet Agent", "equity", "financials", "addPair", `Shareholders' equity · ${money(latest.equity, currency)}`, 0.96, "Net book value attributable to shareholders."),
    act("balance-06", "Balance Sheet Agent", "cash & equivalents", "financials", "addPair", `Cash · ${money(latest.cash, currency)}`, 0.94, "Cash and cash equivalents on hand."),
  );
  const findings = [`Balance sheet: total assets ${money(latest.total_assets, currency)}, equity ${money(latest.equity, currency)}, net debt ${money((latest.total_debt ?? 0) - (latest.cash ?? 0), currency)}.`];
  return { agentId: "balance-01", agentName: "Balance Sheet Agent", lens: "assets & liabilities", actions, findings, confidence: 0.94 };
}

export function cashFlowAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const annual = payload.annual || {};
  const cashflow = Array.isArray(annual.cash_flow) ? annual.cash_flow : [];
  const currency = payload.currency || "USD";
  if (!cashflow.length) return { agentId: "cashflow-01", agentName: "Cash Flow Agent", lens: "cash generation", actions, findings: ["No cash-flow statement data available."], confidence: 0.5 };
  const latest = cashflow[0].items || {};
  actions.push(
    act("cashflow-01", "Cash Flow Agent", "operating cash flow", "financials", "addPair", `Operating cash flow · ${money(latest.operating_cash_flow, currency)}`, 0.96, "Cash generated from core operations."),
    act("cashflow-02", "Cash Flow Agent", "capital expenditure", "financials", "addPair", `Capex · ${money(latest.capex, currency)}`, 0.95, "Cash invested in long-term assets."),
    act("cashflow-03", "Cash Flow Agent", "free cash flow", "financials", "addPair", `Free cash flow · ${money(latest.free_cash_flow, currency)}`, 0.96, "OCF less capex — cash available to providers of capital."),
    act("cashflow-04", "Cash Flow Agent", "dividends paid", "financials", "addPair", `Dividends paid · ${money(latest.dividends_paid, currency)}`, 0.93, "Cash returned to shareholders as dividends."),
    act("cashflow-05", "Cash Flow Agent", "share repurchase", "financials", "addPair", `Share repurchase · ${money(latest.share_repurchase, currency)}`, 0.93, "Cash spent buying back own shares."),
    act("cashflow-06", "Cash Flow Agent", "net borrowings", "financials", "addPair", `Net borrowings · ${money(latest.net_borrowings, currency)}`, 0.93, "New debt issued less debt repaid."),
  );
  const findings = [`Cash flow: OCF ${money(latest.operating_cash_flow, currency)}, FCF ${money(latest.free_cash_flow, currency)}, dividends+buybacks ${money((latest.dividends_paid ?? 0) + (latest.share_repurchase ?? 0), currency)}.`];
  return { agentId: "cashflow-01", agentName: "Cash Flow Agent", lens: "cash generation", actions, findings, confidence: 0.94 };
}

export function ratioAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const history: any[] = Array.isArray(payload.history) ? payload.history : [];
  if (!history.length) return { agentId: "ratio-01", agentName: "Ratio Analysis Agent", lens: "margin & return ratios", actions, findings: ["No historical ratio data available."], confidence: 0.5 };
  const latest = history[0];
  actions.push(
    act("ratio-01", "Ratio Analysis Agent", "gross margin", "financials", "addPair", `Gross margin · ${isNum(latest.gross_margin) ? pct(latest.gross_margin) : "—"}`, 0.95, "Gross profit as a share of revenue."),
    act("ratio-02", "Ratio Analysis Agent", "operating margin", "financials", "addPair", `Operating margin · ${isNum(latest.operating_margin) ? pct(latest.operating_margin) : "—"}`, 0.95, "Operating profit as a share of revenue."),
    act("ratio-03", "Ratio Analysis Agent", "net margin", "financials", "addPair", `Net margin · ${isNum(latest.net_margin) ? pct(latest.net_margin) : "—"}`, 0.96, "Net income as a share of revenue."),
    act("ratio-04", "Ratio Analysis Agent", "EBITDA margin", "financials", "addPair", `EBITDA margin · ${isNum(latest.ebitda) && isNum(latest.revenue) && latest.revenue ? pct(latest.ebitda / latest.revenue) : "—"}`, 0.94, "EBITDA as a share of revenue."),
    act("ratio-05", "Ratio Analysis Agent", "ROE", "financials", "addPair", `ROE · ${isNum(latest.roe) ? pct(latest.roe) : "—"}`, 0.96, "Return on average shareholders' equity."),
    act("ratio-06", "Ratio Analysis Agent", "ROIC", "financials", "addPair", `ROIC · ${isNum(latest.roic) ? pct(latest.roic) : "—"}`, 0.95, "Return on invested capital."),
    act("ratio-07", "Ratio Analysis Agent", "current ratio", "financials", "addPair", `Current ratio · ${isNum(latest.current_ratio) ? num(latest.current_ratio, 2) : "—"}`, 0.94, "Current assets ÷ current liabilities — short-term liquidity."),
    act("ratio-08", "Ratio Analysis Agent", "net debt / EBITDA", "financials", "addPair", `Net debt/EBITDA · ${isNum(latest.net_debt) && isNum(latest.ebitda) && latest.ebitda ? `${num(latest.net_debt / latest.ebitda, 1)}x` : "—"}`, 0.94, "Leverage multiple against earnings."),
  );
  const findings = [`Key ratios: ROE ${isNum(latest.roe) ? pct(latest.roe) : "n/a"}, ROIC ${isNum(latest.roic) ? pct(latest.roic) : "n/a"}, net debt/EBITDA ${isNum(latest.net_debt) && isNum(latest.ebitda) && latest.ebitda ? num(latest.net_debt / latest.ebitda, 1) + "x" : "n/a"}.`];
  return { agentId: "ratio-01", agentName: "Ratio Analysis Agent", lens: "margin & return ratios", actions, findings, confidence: 0.95 };
}

export function growthAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const history: any[] = Array.isArray(payload.history) ? payload.history : [];
  if (!history.length || history.length < 2) return { agentId: "growth-01", agentName: "Growth Metrics Agent", lens: "revenue & earnings growth", actions, findings: ["Insufficient history for growth computation."], confidence: 0.5 };
  const latest = history[0];
  const earliest = history[history.length - 1];
  const span = history.length - 1;
  const cagr = (a: any, b: any): string | null => {
    if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0 || span < 1) return null;
    return pct(Math.pow(b / a, 1 / span) - 1);
  };
  actions.push(
    act("growth-01", "Growth Metrics Agent", "revenue CAGR", "financials", "addPair", `Revenue CAGR (${span} yrs) · ${cagr(earliest.revenue, latest.revenue) ?? "n.m."}`, 0.94, "Compound annual revenue growth over the reported span."),
    act("growth-02", "Growth Metrics Agent", "EBITDA CAGR", "financials", "addPair", `EBITDA CAGR (${span} yrs) · ${cagr(earliest.ebitda, latest.ebitda) ?? "n.m."}`, 0.93, "Compound annual EBITDA growth over the reported span."),
    act("growth-03", "Growth Metrics Agent", "FCF CAGR", "financials", "addPair", `FCF CAGR (${span} yrs) · ${cagr(earliest.fcf, latest.fcf) ?? "n.m."}`, 0.93, "Compound annual free cash flow growth over the reported span."),
    act("growth-04", "Growth Metrics Agent", "EPS CAGR", "financials", "addPair", `Diluted EPS CAGR (${span} yrs) · ${cagr(earliest.eps_diluted, latest.eps_diluted) ?? "n.m."}`, 0.92, "Compound annual diluted EPS growth over the reported span."),
    act("growth-05", "Growth Metrics Agent", "latest revenue growth", "financials", "addPair", `Latest revenue growth · ${isNum(latest.revenue_growth) ? pct(latest.revenue_growth) : "—"}`, 0.95, "Year-over-year revenue growth in the latest period."),
  );
  const findings = [`Growth: revenue CAGR ${cagr(earliest.revenue, latest.revenue) ?? "n.m."}, EBITDA CAGR ${cagr(earliest.ebitda, latest.ebitda) ?? "n.m."} over ${span} reported years.`];
  return { agentId: "growth-01", agentName: "Growth Metrics Agent", lens: "revenue & earnings growth", actions, findings, confidence: 0.93 };
}

export function marginAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const history: any[] = Array.isArray(payload.history) ? payload.history : [];
  if (!history.length) return { agentId: "margin-01", agentName: "Margin Analysis Agent", lens: "profitability margins", actions, findings: ["No margin history available."], confidence: 0.5 };
  const latest = history[0];
  actions.push(
    act("margin-01", "Margin Analysis Agent", "gross margin trend", "financials", "addText", `Gross margin ${isNum(latest.gross_margin) ? pct(latest.gross_margin) : "n/a"} (latest period)`, 0.94, "Pricing power and cost-of-goods efficiency."),
    act("margin-02", "Margin Analysis Agent", "operating margin trend", "financials", "addText", `Operating margin ${isNum(latest.operating_margin) ? pct(latest.operating_margin) : "n/a"} (latest period)`, 0.94, "Operating leverage and opex discipline."),
    act("margin-03", "Margin Analysis Agent", "net margin trend", "financials", "addText", `Net margin ${isNum(latest.net_margin) ? pct(latest.net_margin) : "n/a"} (latest period)`, 0.95, "Bottom-line profitability after all costs and tax."),
    act("margin-04", "Margin Analysis Agent", "EBITDA margin trend", "financials", "addText", `EBITDA margin ${isNum(latest.ebitda) && isNum(latest.revenue) && latest.revenue ? pct(latest.ebitda / latest.revenue) : "n/a"} (latest period)`, 0.94, "Cash profitability before financing and non-cash charges."),
  );
  const findings = [`Margins: gross ${isNum(latest.gross_margin) ? pct(latest.gross_margin) : "n/a"}, operating ${isNum(latest.operating_margin) ? pct(latest.operating_margin) : "n/a"}, net ${isNum(latest.net_margin) ? pct(latest.net_margin) : "n/a"}.`];
  return { agentId: "margin-01", agentName: "Margin Analysis Agent", lens: "profitability margins", actions, findings, confidence: 0.94 };
}

export function returnAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const history: any[] = Array.isArray(payload.history) ? payload.history : [];
  if (!history.length) return { agentId: "return-01", agentName: "Return Metrics Agent", lens: "ROE / ROA / ROIC", actions, findings: ["No return data available."], confidence: 0.5 };
  const latest = history[0];
  actions.push(
    act("return-01", "Return Metrics Agent", "ROE", "financials", "addPair", `Return on equity · ${isNum(latest.roe) ? pct(latest.roe) : "—"}`, 0.96, "Profit generated per dollar of shareholders' equity."),
    act("return-02", "Return Metrics Agent", "ROA", "financials", "addPair", `Return on assets · ${isNum(latest.roa) ? pct(latest.roa) : "—"}`, 0.94, "Profit generated per dollar of total assets."),
    act("return-03", "Return Metrics Agent", "ROIC", "financials", "addPair", `Return on invested capital · ${isNum(latest.roic) ? pct(latest.roic) : "—"}`, 0.96, "Returns relative to capital deployed in the business."),
  );
  const findings = [`Returns: ROE ${isNum(latest.roe) ? pct(latest.roe) : "n/a"}, ROA ${isNum(latest.roa) ? pct(latest.roa) : "n/a"}, ROIC ${isNum(latest.roic) ? pct(latest.roic) : "n/a"}.`];
  return { agentId: "return-01", agentName: "Return Metrics Agent", lens: "ROE / ROA / ROIC", actions, findings, confidence: 0.95 };
}

export function leverageAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const history: any[] = Array.isArray(payload.history) ? payload.history : [];
  if (!history.length) return { agentId: "leverage-01", agentName: "Leverage Agent", lens: "debt & credit metrics", actions, findings: ["No leverage data available."], confidence: 0.5 };
  const latest = history[0];
  actions.push(
    act("leverage-01", "Leverage Agent", "net debt", "financials", "addPair", `Net debt · ${isNum(latest.net_debt) ? fmt(latest.net_debt) : "—"}`, 0.95, "Total debt less cash and equivalents."),
    act("leverage-02", "Leverage Agent", "net debt / EBITDA", "financials", "addPair", `Net debt/EBITDA · ${isNum(latest.net_debt) && isNum(latest.ebitda) && latest.ebitda ? `${num(latest.net_debt / latest.ebitda, 1)}x` : "—"}`, 0.96, "Credit leverage multiple against earnings."),
    act("leverage-03", "Leverage Agent", "current ratio", "financials", "addPair", `Current ratio · ${isNum(latest.current_ratio) ? num(latest.current_ratio, 2) : "—"}`, 0.94, "Short-term liquidity coverage."),
    act("leverage-04", "Leverage Agent", "interest coverage", "financials", "addPair", `Interest coverage · ${isNum(latest.ebit) && isNum(latest.interest_expense) && latest.interest_expense ? num(latest.ebit / Math.abs(latest.interest_expense), 1) + "x" : "n.m."}`, 0.93, "EBIT ÷ interest expense — ability to service debt."),
  );
  const findings = [`Leverage: net debt ${isNum(latest.net_debt) ? fmt(latest.net_debt) : "n/a"}, ND/EBITDA ${isNum(latest.net_debt) && isNum(latest.ebitda) && latest.ebitda ? num(latest.net_debt / latest.ebitda, 1) + "x" : "n/a"}, current ratio ${isNum(latest.current_ratio) ? num(latest.current_ratio, 2) : "n/a"}.`];
  return { agentId: "leverage-01", agentName: "Leverage Agent", lens: "debt & credit metrics", actions, findings, confidence: 0.94 };
}

export function perShareAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const history: any[] = Array.isArray(payload.history) ? payload.history : [];
  const price = payload.price_summary || {};
  if (!history.length) return { agentId: "perShare-01", agentName: "Per-Share Agent", lens: "per-share metrics", actions, findings: ["No per-share data available."], confidence: 0.5 };
  const latest = history[0];
  const px = isNum(price.last_close) ? price.last_close : null;
  actions.push(
    act("perShare-01", "Per-Share Agent", "diluted EPS", "financials", "addPair", `Diluted EPS · ${isNum(latest.eps_diluted) ? num(latest.eps_diluted, 2) : "—"}`, 0.96, "Earnings allocated to each diluted share."),
    act("perShare-02", "Per-Share Agent", "book value per share", "financials", "addPair", `Book value per share · ${isNum(latest.book_value_per_share) ? num(latest.book_value_per_share, 2) : "—"}`, 0.95, "Shareholders' equity ÷ shares outstanding."),
    act("perShare-03", "Per-Share Agent", "price-to-book", "financials", "addPair", `P/B · ${px && isNum(latest.book_value_per_share) && latest.book_value_per_share ? num(px / latest.book_value_per_share, 2) + "x" : "—"}`, 0.94, "Market price relative to book value per share."),
    act("perShare-04", "Per-Share Agent", "shares issued", "financials", "addPair", `Shares issued · ${isNum(latest.shares_issued) ? fmt(latest.shares_issued) : "—"}`, 0.92, "Total shares outstanding."),
  );
  const findings = [`Per-share: EPS ${isNum(latest.eps_diluted) ? num(latest.eps_diluted, 2) : "n/a"}, BVPS ${isNum(latest.book_value_per_share) ? num(latest.book_value_per_share, 2) : "n/a"}, P/B ${px && isNum(latest.book_value_per_share) && latest.book_value_per_share ? num(px / latest.book_value_per_share, 2) + "x" : "n/a"}.`];
  return { agentId: "perShare-01", agentName: "Per-Share Agent", lens: "per-share metrics", actions, findings, confidence: 0.94 };
}
