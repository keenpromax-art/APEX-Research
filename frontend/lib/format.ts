export const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!isNum(value)) return String(value);
  const abs = Math.abs(value);
  if (abs >= 1e12) return (value / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function signed(value: unknown, digits = 2): string {
  if (!isNum(value)) return "—";
  return (value >= 0 ? "+" : "") + value.toFixed(digits);
}

export function pct(value: unknown, digits = 1): string {
  if (!isNum(value)) return "—";
  return (value * 100).toFixed(digits) + "%";
}

export function num(value: unknown, digits = 2): string {
  if (!isNum(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function money(value: unknown, currency = "USD"): string {
  if (!isNum(value)) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function periodLabel(period: unknown): string {
  if (typeof period !== "string") return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(period)) return period.slice(0, 7);
  return period;
}

export function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function safeNumber(value: unknown, fallback = 0): number {
  if (isNum(value)) return value;
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function tone(value: unknown): string {
  if (!isNum(value)) return "text-muted";
  if (value > 0) return "text-pos";
  if (value < 0) return "text-neg";
  return "text-muted";
}

export function localDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
