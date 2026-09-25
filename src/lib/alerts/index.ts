export const ALERT_RULE_VERSION = "apex-alert-rule-v1" as const;

export type AlertMetric = "fairValueChangePct" | "priceChangePct" | "thesisBreak" | "evidenceConflict";
export type AlertDirection = "above" | "below" | "any";

export interface AlertRule {
  id: string;
  ticker: string;
  metric: AlertMetric;
  threshold: number | null;
  direction: AlertDirection;
  enabled: boolean;
  lastTriggeredAt?: string;
}

export interface AlertSnapshot {
  ticker: string;
  fairValue: number | null;
  currentPrice: number | null;
  previousFairValue?: number | null;
  previousPrice?: number | null;
  thesisBreak?: boolean;
  materialEvidenceConflict?: boolean;
  observedAt: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ticker: string;
  metric: AlertMetric;
  value: number | boolean | null;
  threshold: number | null;
  triggeredAt: string;
  message: string;
}

export interface AlertEvaluation {
  events: AlertEvent[];
  rules: AlertRule[];
}

function pct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current as number) / (previous as number) - 1) * 100;
}

function eventId(rule: AlertRule, snapshot: AlertSnapshot, value: number | boolean | null): string {
  return `ALT-${rule.id}-${snapshot.observedAt}-${String(value)}`.replace(/[^A-Za-z0-9:_-]/g, "_");
}

export function evaluateAlertRules(rules: readonly AlertRule[], snapshot: AlertSnapshot): AlertEvaluation {
  const events: AlertEvent[] = [];
  const nextRules: AlertRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.ticker.toUpperCase() !== snapshot.ticker.toUpperCase()) {
      nextRules.push({ ...rule });
      continue;
    }
    let value: number | boolean | null = null;
    if (rule.metric === "fairValueChangePct") value = pct(snapshot.fairValue, snapshot.previousFairValue);
    if (rule.metric === "priceChangePct") value = pct(snapshot.currentPrice, snapshot.previousPrice);
    if (rule.metric === "thesisBreak") value = snapshot.thesisBreak === true;
    if (rule.metric === "evidenceConflict") value = snapshot.materialEvidenceConflict === true;
    const threshold = rule.threshold;
    const directionMatch = rule.metric === "thesisBreak" || rule.metric === "evidenceConflict"
      ? value === true
      : typeof value === "number" && threshold !== null && (rule.direction === "any" || (rule.direction === "above" ? value >= threshold : value <= threshold));
    if (directionMatch && value !== null) {
      events.push({
        id: eventId(rule, snapshot, value),
        ruleId: rule.id,
        ticker: rule.ticker,
        metric: rule.metric,
        value,
        threshold,
        triggeredAt: snapshot.observedAt,
        message: `${rule.metric} alert triggered for ${rule.ticker}.`,
      });
      nextRules.push({ ...rule, lastTriggeredAt: snapshot.observedAt });
    } else {
      nextRules.push({ ...rule });
    }
  }
  return { events, rules: nextRules };
}
