import { evaluateAlertRules, type AlertRule } from "../src/lib/alerts";

const rules: AlertRule[] = [
  { id: "fv", ticker: "TEST.NS", metric: "fairValueChangePct", threshold: 10, direction: "above", enabled: true },
  { id: "break", ticker: "TEST.NS", metric: "thesisBreak", threshold: null, direction: "any", enabled: true },
  { id: "disabled", ticker: "TEST.NS", metric: "priceChangePct", threshold: 1, direction: "above", enabled: false },
];
const result = evaluateAlertRules(rules, {
  ticker: "TEST.NS",
  fairValue: 120,
  currentPrice: 100,
  previousFairValue: 100,
  previousPrice: 90,
  thesisBreak: true,
  observedAt: "2026-09-25T00:00:00.000Z",
});
if (result.events.length !== 2) throw new Error(`expected 2 events, got ${result.events.length}`);
if (result.rules.find((rule) => rule.id === "fv")?.lastTriggeredAt !== "2026-09-25T00:00:00.000Z") throw new Error("trigger timestamp not recorded");
if (result.events.some((event) => event.ruleId === "disabled")) throw new Error("disabled rule triggered");
console.log("alert tests passed");
