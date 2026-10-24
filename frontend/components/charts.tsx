"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt, pct } from "@/lib/format";

const axis = { stroke: "var(--text-muted)", fontSize: 10 };
const tooltipStyle = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 11,
  color: "var(--text)",
};
const grid = "var(--border)";

export type PricePoint = { date: string; close: number; high?: number; low?: number };

export function PriceChart({ data }: { data: PricePoint[] }) {
  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-xs text-muted">No price history available</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" {...axis} minTickGap={40} tickFormatter={(value: string) => value.slice(2, 7)} />
        <YAxis {...axis} width={44} domain={["auto", "auto"]} tickFormatter={(value: number) => value.toFixed(0)} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [fmt(value), "Close"]}
          labelFormatter={(label: string) => label}
        />
        <Area type="monotone" dataKey="close" stroke="var(--accent)" strokeWidth={1.8} fill="url(#priceFill)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export type PeriodMetric = {
  period_end: string;
  revenue?: number | null;
  net_income?: number | null;
  fcf?: number | null;
  ebitda?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  net_margin?: number | null;
};

export function RevenueChart({ data }: { data: PeriodMetric[] }) {
  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-xs text-muted">No historical metrics</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={48} tickFormatter={(value: number) => fmt(value)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [fmt(value), name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--accent)" strokeWidth={1.8} dot={false} />
        <Line type="monotone" dataKey="net_income" name="Net income" stroke="var(--pos)" strokeWidth={1.8} dot={false} />
        <Line type="monotone" dataKey="fcf" name="FCF" stroke="var(--warn)" strokeWidth={1.6} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MarginChart({ data }: { data: PeriodMetric[] }) {
  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-xs text-muted">No margin history</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={40} tickFormatter={(value: number) => pct(value, 0)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [pct(value), name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="gross_margin" name="Gross" stroke="var(--accent)" strokeWidth={1.6} dot={false} />
        <Line type="monotone" dataKey="operating_margin" name="Operating" stroke="var(--warn)" strokeWidth={1.6} dot={false} />
        <Line type="monotone" dataKey="net_margin" name="Net" stroke="var(--pos)" strokeWidth={1.6} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export type ForecastPeriod = {
  year: number;
  revenue?: number;
  ebitda?: number;
  net_income?: number;
  fcf?: number;
  cash?: number;
  debt?: number;
};

export function ForecastChart({ data }: { data: ForecastPeriod[] }) {
  if (!data.length) {
    return <div className="h-full flex items-center justify-center text-xs text-muted">Run the forecast to see projections</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="year" {...axis} tickFormatter={(value: number) => `Y${value}`} />
        <YAxis {...axis} width={48} tickFormatter={(value: number) => fmt(value)} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [fmt(value), name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="revenue" name="Revenue" fill="var(--accent)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="ebitda" name="EBITDA" fill="var(--pos)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="fcf" name="FCF" fill="var(--warn)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
