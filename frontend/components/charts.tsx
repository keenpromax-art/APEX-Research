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
import type { CSSProperties } from "react";
import { fmt, pct } from "@/lib/format";

const axisTick = { fill: "var(--text-dim)", fontSize: 10 };
const grid = "var(--border)";
const margin = { top: 8, right: 12, left: 2, bottom: 2 };

function tooltipProps(cursorLine = true) {
  const cursor = cursorLine
    ? { stroke: "var(--border-strong)", strokeWidth: 1 }
    : { fill: "var(--bg-hover)", opacity: 0.6 };
  return {
    cursor,
    contentStyle: {
      background: "var(--bg-elev)",
      border: "1px solid var(--border-strong)",
      borderRadius: 6,
      fontSize: 11,
      color: "var(--text)",
      boxShadow: "none",
      padding: "6px 10px",
    } as CSSProperties,
    itemStyle: { color: "var(--text)", fontSize: 11 } as CSSProperties,
    labelStyle: { color: "var(--text-muted)", fontSize: 10, marginBottom: 2 } as CSSProperties,
  };
}

const legendLine = {
  iconType: "circle" as const,
  iconSize: 7,
  wrapperStyle: { fontSize: 11, paddingTop: 4, color: "var(--text-muted)" },
};
const legendBar = {
  iconSize: 9,
  wrapperStyle: { fontSize: 11, paddingTop: 4, color: "var(--text-muted)" },
};

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1 text-center px-4">
      <div className="text-xs text-muted">{message}</div>
    </div>
  );
}

export type PricePoint = { date: string; close: number; high?: number; low?: number };

export function PriceChart({ data }: { data: PricePoint[] }) {
  if (!data.length) return <ChartEmpty message="No price history available" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={margin}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} strokeOpacity={0.7} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          {...axisTick}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={44}
          tickFormatter={(value: string) => value.slice(2, 7)}
        />
        <YAxis
          {...axisTick}
          tickLine={false}
          axisLine={false}
          width={46}
          domain={["auto", "auto"]}
          tickFormatter={(value: number) => fmt(value)}
        />
        <Tooltip {...tooltipProps()} labelFormatter={(label: string) => label} />
        <Area
          type="monotone"
          dataKey="close"
          name="Close"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#priceFill)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
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

export function RevenueChart({ data, unit }: { data: PeriodMetric[]; unit?: string }) {
  if (!data.length) return <ChartEmpty message="No historical metrics" />;
  const suffix = unit ? ` ${unit}` : "";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={margin}>
        <CartesianGrid stroke={grid} strokeOpacity={0.7} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          {...axisTick}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={24}
        />
        <YAxis
          {...axisTick}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(value: number) => fmt(value)}
        />
        <Tooltip
          {...tooltipProps()}
          formatter={(value: number, name: string) => [`${fmt(value)}${suffix}`, name]}
        />
        <Legend {...legendLine} />
        <Line
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="net_income"
          name="Net income"
          stroke="var(--pos)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="fcf"
          name="FCF"
          stroke="var(--warn)"
          strokeWidth={1.6}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MarginChart({ data }: { data: PeriodMetric[] }) {
  if (!data.length) return <ChartEmpty message="No margin history" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={margin}>
        <CartesianGrid stroke={grid} strokeOpacity={0.7} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          {...axisTick}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={24}
        />
        <YAxis
          {...axisTick}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(value: number) => pct(value, 0)}
        />
        <Tooltip
          {...tooltipProps()}
          formatter={(value: number, name: string) => [pct(value), name]}
        />
        <Legend {...legendLine} />
        <Line
          type="monotone"
          dataKey="gross_margin"
          name="Gross"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="operating_margin"
          name="Operating"
          stroke="var(--warn)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="net_margin"
          name="Net"
          stroke="var(--pos)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
          connectNulls={false}
        />
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

export function ForecastChart({ data, unit }: { data: ForecastPeriod[]; unit?: string }) {
  if (!data.length) return <ChartEmpty message="Run the forecast to see projections" />;
  const suffix = unit ? ` ${unit}` : "";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={margin} barGap={2} maxBarSize={30}>
        <CartesianGrid stroke={grid} strokeOpacity={0.7} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="year"
          {...axisTick}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          tickFormatter={(value: number) => `Y${value}`}
        />
        <YAxis
          {...axisTick}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(value: number) => fmt(value)}
        />
        <Tooltip
          {...tooltipProps(false)}
          formatter={(value: number, name: string) => [`${fmt(value)}${suffix}`, name]}
        />
        <Legend {...legendBar} />
        <Bar dataKey="revenue" name="Revenue" fill="var(--accent)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="ebitda" name="EBITDA" fill="var(--pos)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="fcf" name="FCF" fill="var(--warn)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
