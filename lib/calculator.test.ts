import { describe, expect, it } from "vitest";
import { calculate } from "./calculator";
import { normalize } from "./normalizer";
import { makeRawData } from "./testUtils";

describe("calculator", () => {
  const derived = () => calculate(normalize(makeRawData()));

  it("computes revenue growth", () => {
    expect(derived().metrics.get("revenue_growth")!.value).toBeCloseTo(1000 / 900 - 1, 9);
  });

  it("computes margins", () => {
    const d = derived();
    expect(d.metrics.get("gross_margin")!.value).toBeCloseTo(0.4, 9);
    expect(d.metrics.get("operating_margin")!.value).toBeCloseTo(0.2, 9);
    expect(d.metrics.get("net_margin")!.value).toBeCloseTo(0.15, 9);
    expect(d.metrics.get("ebitda_margin")!.value).toBeCloseTo(0.25, 9);
  });

  it("computes returns on capital", () => {
    const d = derived();
    expect(d.metrics.get("roe")!.value).toBeCloseTo(0.15, 9);
    expect(d.metrics.get("roa")!.value).toBeCloseTo(0.075, 9);
  });

  it("computes leverage and liquidity", () => {
    const d = derived();
    expect(d.metrics.get("debt_to_equity")!.value).toBeCloseTo(0.5, 9);
    expect(d.metrics.get("net_debt")!.value).toBe(300);
    expect(d.metrics.get("current_ratio")!.value).toBeCloseTo(2, 9);
    expect(d.metrics.get("quick_ratio")!.value).toBeCloseTo(1.75, 9);
  });

  it("computes free cash flow and conversion", () => {
    const d = derived();
    expect(d.metrics.get("free_cash_flow")!.value).toBe(200);
    expect(d.metrics.get("fcf_margin")!.value).toBeCloseTo(0.2, 9);
    expect(d.metrics.get("cash_conversion")!.value).toBeCloseTo(200 / 150, 9);
  });

  it("computes valuation multiples", () => {
    const d = derived();
    expect(d.metrics.get("pe_current")!.value).toBeCloseTo(50, 9);
    expect(d.metrics.get("pb_current")!.value).toBeCloseTo(150 / (1000 / 50), 9);
    expect(d.metrics.get("ps_current")!.value).toBeCloseTo(7.5, 9);
    expect(d.metrics.get("ev_current")!.value).toBe(7500 + 500 - 200);
  });

  it("computes price metrics", () => {
    const d = derived();
    expect(d.metrics.get("price_return_1y")!.value).not.toBeNull();
    expect(d.metrics.get("price_return_1y")!.value!).toBeGreaterThan(0);
    expect(d.metrics.get("volatility_1y")!.value).not.toBeNull();
    expect(d.metrics.get("max_drawdown_5y")!.value).not.toBeNull();
    expect(d.metrics.get("max_drawdown_5y")!.value!).toBeLessThanOrEqual(0);
  });

  it("returns null instead of fabricating when inputs are missing", () => {
    const d = calculate(
      normalize(makeRawData({ withIncome: false, withBalance: false, withCashflow: false, withHistory: false }))
    );
    for (const key of ["revenue_growth", "roe", "free_cash_flow", "price_return_1y", "gross_margin"]) {
      const metric = d.metrics.get(key);
      expect(metric === undefined || metric.value === null, `${key} must be absent or null`).toBe(true);
    }
  });

  it("returns null for CAGR with insufficient periods", () => {
    const d = derived();
    expect(d.metrics.get("revenue_cagr_3y")!.value).toBeNull();
    expect(d.metrics.get("revenue_cagr_5y")!.value).toBeNull();
  });

  it("attaches provenance inputs", () => {
    const roe = derived().metrics.get("roe")!;
    expect(roe.inputs).toEqual([
      "financials.income_stmt[Net Income][2025-03-31]",
      "financials.balance_sheet[Stockholders Equity][2025-03-31]",
    ]);
    expect(roe.formula).toBe("net_income / stockholders_equity");
  });
});
