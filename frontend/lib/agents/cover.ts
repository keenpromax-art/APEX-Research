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

export function coverAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const company = payload.company || {};
  const ticker = payload.ticker || "APEX";
  const currency = payload.currency || "USD";
  actions.push(
    act("cover-01", "Cover Designer Agent", "title & branding", "cover", "addSection", `APEX TERMINAL · EQUITY RESEARCH`, 0.98, "Primary cover headline for the report.", { label: ticker }),
    act("cover-02", "Cover Designer Agent", "subtitle styling", "cover", "addText", `${company.name || ticker} — Equity Research Note`, 0.96, "Report subtitle with company name."),
    act("cover-03", "Cover Designer Agent", "venue & currency", "cover", "addPair", `${payload.listing?.venueLabel || company.exchange || "Listing venue"} · ${currency} · ${payload.horizon || "12M"} outlook`, 0.94, "Transaction context line under the title."),
  );
  const findings = [`Cover generated for ${ticker} with company branding and transaction context.`];
  return { agentId: "cover-01", agentName: "Cover Designer Agent", lens: "title & branding", actions, findings, confidence: 0.96 };
}

export function summaryAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const rating = payload.rating || "NOT RATED";
  const target = payload.target_price;
  const current = payload.current_price;
  const upside = payload.upside;
  const currency = payload.currency || "USD";
  const horizon = payload.horizon || "12M";
  actions.push(
    act("summary-01", "Investment Summary Agent", "rating KPI", "summary", "addPair", `RATING · ${String(rating).toUpperCase()}`, 0.97, "Headline rating as a top-of-report KPI.", rating === "BUY" ? { color: "pos" } : rating === "SELL" ? { color: "neg" } : { color: "ink" }),
    act("summary-02", "Investment Summary Agent", "target price", "summary", "addPair", `TARGET (${horizon}) · ${isNum(target) ? `${num(target)} ${currency}` : "—"}`, 0.97, "12-month target price call."),
    act("summary-03", "Investment Summary Agent", "implied upside", "summary", "addPair", `IMPLIED UPSIDE · ${isNum(upside) ? `${upside >= 0 ? "+" : ""}${pct(upside)}` : "—"}`, 0.96, "Upside/downside vs last price.", isNum(upside) ? (upside < 0 ? { color: "neg" } : { color: "pos" }) : { color: "ink" }),
    act("summary-04", "Investment Summary Agent", "last price", "summary", "addPair", `LAST PRICE · ${isNum(current) ? `${num(current)} ${currency}` : "—"}`, 0.95, "Reference last price for the upside math."),
  );
  const findings = [`Investment summary: ${rating} with target ${target ?? "n/a"} (upside ${upside ?? "n/a"}).`];
  return { agentId: "summary-01", agentName: "Investment Summary Agent", lens: "rating & target", actions, findings, confidence: 0.96 };
}

export function companyAgent(payload: ExportPayload): AgentResult {
  const actions: AgentAction[] = [];
  const company = payload.company || {};
  const ticker = payload.ticker || "APEX";
  const price = payload.price_summary || {};
  const currency = payload.currency || "USD";
  actions.push(
    act("company-01", "Company & Industry Agent", "market cap", "company", "addPair", `Market cap · ${money(company.market_cap, currency)}`, 0.95, "Equity value context."),
    act("company-02", "Company & Industry Agent", "employees", "company", "addPair", `Employees · ${isNum(company.fullTimeEmployees) ?? isNum(company.employees) ? Math.round(company.fullTimeEmployees ?? company.employees).toLocaleString("en-US") : "n/a"}`, 0.9, "Company scale."),
    act("company-03", "Company & Industry Agent", "last close", "company", "addPair", `Last close · ${money(price.last_close, currency)}`, 0.95, "Reference price."),
    act("company-04", "Company & Industry Agent", "52-week range", "company", "addPair", `52-week range · ${isNum(price.low_52w) ? `${num(price.low_52w)} - ${isNum(price.high_52w) ? num(price.high_52w) : "n/a"}` : "n/a"}`, 0.93, "Trading range context."),
    act("company-05", "Company & Industry Agent", "day change", "company", "addPair", `Day change · ${isNum(price.change_pct) ? pct(price.change_pct) : "n/a"}`, 0.91, "Intraday momentum signal.", isNum(price.change_pct) ? (price.change_pct < 0 ? { color: "neg" } : { color: "pos" }) : { color: "ink" }),
    act("company-06", "Company & Industry Agent", "avg volume", "company", "addPair", `Avg volume (3m) · ${isNum(price.avg_volume_3m) ? fmt(price.avg_volume_3m) : "n/a"}`, 0.88, "Liquidity context."),
    act("company-07", "Company & Industry Agent", "last reported period", "company", "addPair", `Last reported period · ${label(company.last_data_date)}`, 0.92, "Recency of disclosed data."),
  );
  if (company.summary) {
    actions.push(act("company-08", "Company & Industry Agent", "business overview", "company", "addText", String(company.summary), 0.94, "Narrative business description."));
  }
  const findings = [`Company profile: ${company.name || ticker}, ${company.sector || "n/a"} / ${company.industry || "n/a"}.`];
  return { agentId: "company-01", agentName: "Company & Industry Agent", lens: "company profile", actions, findings, confidence: 0.93 };
}

function label(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (isNum(v)) return num(v);
  return String(v);
}
