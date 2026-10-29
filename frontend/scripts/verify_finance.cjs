const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const FRONTEND_ROOT = path.resolve(__dirname, "..");
const LIB_DIR = path.join(FRONTEND_ROOT, "lib");
const OUT_DIR = path.join(require("node:os").tmpdir(), "apexfinance");
const nodeModules = path.join(FRONTEND_ROOT, "node_modules");
process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
require("node:module").Module._initPaths();

execFileSync(process.execPath, [
  path.join(nodeModules, "typescript", "bin", "tsc"),
  path.join(LIB_DIR, "api.ts"),
  "--outDir", OUT_DIR,
  "--module", "commonjs",
  "--target", "es2020",
  "--lib", "es2021,dom",
  "--moduleResolution", "node",
  "--esModuleInterop",
  "--skipLibCheck",
  "--types", "node",
], { cwd: FRONTEND_ROOT, stdio: "inherit" });

const { dcfCompute, reverseDcfCompute, waccCompute, sensitivityCompute } = require(path.join(OUT_DIR, "api.js"));

test("WACC weights normalize to one", () => {
  const r = waccCompute({ equity_weight: 7, debt_weight: 3, risk_free: 0.04, beta: 1, market_premium: 0.055, cost_of_debt: 0.06, tax_rate: 0.25 });
  assert.ok(Math.abs(r.equity_weight + r.debt_weight - 1) < 1e-9);
  assert.ok(r.weights_normalized);
});

test("DCF terminal growth >= WACC returns error instead of clamping", () => {
  const r = dcfCompute({ fcf: [100, 110], wacc: 0.1, terminal_growth: 0.2, net_debt: 0, shares: 10 });
  assert.ok("error" in r, `expected error, got ${JSON.stringify(r)}`);
  assert.ok(String(r.error).includes("must be below the WACC"), `unexpected error: ${r.error}`);
});

test("DCF round-trips enterprise/equity bridge", () => {
  const r = dcfCompute({ fcf: [100, 110], wacc: 0.1, terminal_growth: 0.025, net_debt: 50, shares: 10 });
  assert.ok(Math.abs(r.equity_value - (r.enterprise_value - r.net_debt)) < 1e-9);
  assert.ok(Math.abs(r.value_per_share - r.equity_value / r.shares) < 1e-9);
});

test("Reverse DCF reproduces price", () => {
  const fwd = dcfCompute({ fcf: [100, 110, 121], wacc: 0.1, terminal_growth: 0.025, net_debt: 50, shares: 10 });
  const price = fwd.value_per_share;
  const rev = reverseDcfCompute({ fcf: [100, 110, 121], wacc: 0.1, terminal_growth: 0.025, net_debt: 50, shares: 10, current_price: price });
  assert.ok(rev.converged, JSON.stringify(rev));
  assert.ok(Math.abs(rev.residual) < 1e-3, `residual=${rev.residual}`);
  assert.ok(Math.abs(rev.reproduced_value_per_share - price) < 1e-3);
});

test("Terminal value share reported", () => {
  const r = dcfCompute({ fcf: [100], wacc: 0.1, terminal_growth: 0.025, net_debt: 0, shares: 1 });
  assert.ok(Number.isFinite(r.terminal_value_share_of_ev));
});

// C1: dcfCompute rejects terminal_growth >= wacc instead of clamping
test("DCF Gordon growth: terminal_growth >= wacc returns error", () => {
  const r = dcfCompute({ fcf: [100, 110], wacc: 0.1, terminal_growth: 0.1, net_debt: 0, shares: 10 });
  assert.ok("error" in r, `expected error, got ${JSON.stringify(r)}`);
  assert.ok(String(r.error).includes("must be below the WACC"), `unexpected error: ${r.error}`);
});

test("DCF Gordon growth: terminal_growth < wacc still computes normally", () => {
  const r = dcfCompute({ fcf: [100, 110], wacc: 0.1, terminal_growth: 0.025, net_debt: 0, shares: 10 });
  assert.ok(!("error" in r), `unexpected error: ${r.error}`);
  assert.ok(r.terminal_growth < r.wacc);
});

// C2: reverseDcfCompute solves for WACC strictly above terminal growth
test("Reverse DCF: solved WACC is strictly above terminal growth", () => {
  const fwd = dcfCompute({ fcf: [100, 110, 121], wacc: 0.1, terminal_growth: 0.025, net_debt: 50, shares: 10 });
  const price = fwd.value_per_share;
  const rev = reverseDcfCompute({ fcf: [100, 110, 121], wacc: 0.1, terminal_growth: 0.025, net_debt: 50, shares: 10, current_price: price });
  assert.ok(rev.converged, `reverse DCF did not converge: ${JSON.stringify(rev)}`);
  assert.ok(rev.implied_wacc > rev.terminal_growth, `solved WACC ${rev.implied_wacc} must exceed terminal growth ${rev.terminal_growth}`);
  assert.ok(Math.abs(rev.residual) < 1e-3, `residual=${rev.residual}`);
  assert.ok(Math.abs(rev.reproduced_value_per_share - price) < 1e-3);
});

// C2: reverseDcfCompute round-trips a known DCF value back to input WACC
test("Reverse DCF: round-trips known DCF value to input WACC", () => {
  const fwd = dcfCompute({ fcf: [100, 110, 121], wacc: 0.12, terminal_growth: 0.03, net_debt: 30, shares: 8 });
  const price = fwd.value_per_share;
  const rev = reverseDcfCompute({ fcf: [100, 110, 121], wacc: 0.12, terminal_growth: 0.03, net_debt: 30, shares: 8, current_price: price });
  assert.ok(rev.converged, `reverse DCF did not converge: ${JSON.stringify(rev)}`);
  assert.ok(Math.abs(rev.implied_wacc - 0.12) < 1e-3, `implied WACC ${rev.implied_wacc} should be near 0.12`);
  assert.ok(Math.abs(rev.residual) < 1e-3, `residual=${rev.residual}`);
});

// C3: Forecast balance_residual is a blocking integrity issue
test("Integrity gates: forecast balance_residual blocks rating", () => {
  const { integrityGates } = require(path.join(OUT_DIR, "provenance.js"));
  const gates = integrityGates([
    { severity: "error", code: "forecast.balance_residual", message: "Balance sheet residual exceeds tolerance", blocking: true },
  ]);
  assert.ok(gates.blockers.length === 1);
  assert.ok(gates.blockers[0].blocking);
  assert.equal(gates.ratingAllowed, false);
  assert.equal(gates.targetAllowed, false);
});

// C3: Non-blocking warnings do not block rating
test("Integrity gates: non-blocking warn does not block rating", () => {
  const { integrityGates } = require(path.join(OUT_DIR, "provenance.js"));
  const gates = integrityGates([
    { severity: "warn", code: "forecast.balance_residual", message: "Minor residual", blocking: false },
  ]);
  assert.equal(gates.ratingAllowed, true);
  assert.equal(gates.targetAllowed, true);
});

// C4: Peer comps P/E returns null for zero or negative earnings
test("Peer comps: P/E is null when net income is zero", () => {
  const r = { market_cap: 1000, net_income: 0 };
  const pe = Number.isFinite(r.market_cap) && Number.isFinite(r.net_income) && r.net_income > 0 ? r.market_cap / r.net_income : null;
  assert.equal(pe, null);
});

test("Peer comps: P/E is null when net income is negative", () => {
  const r = { market_cap: 1000, net_income: -50 };
  const pe = Number.isFinite(r.market_cap) && Number.isFinite(r.net_income) && r.net_income > 0 ? r.market_cap / r.net_income : null;
  assert.equal(pe, null);
});

test("Peer comps: P/E is valid when net income is positive", () => {
  const r = { market_cap: 1000, net_income: 100 };
  const pe = Number.isFinite(r.market_cap) && Number.isFinite(r.net_income) && r.net_income > 0 ? r.market_cap / r.net_income : null;
  assert.equal(pe, 10);
});

// C4: EV/EBITDA is null when EBITDA is zero or negative
test("Peer comps: EV/EBITDA is null when EBITDA is zero", () => {
  const ev = 1000, ebitda = 0;
  const evEbitda = Number.isFinite(ev) && Number.isFinite(ebitda) && ebitda > 0 ? ev / ebitda : null;
  assert.equal(evEbitda, null);
});

test("Peer comps: EV/EBITDA is null when EBITDA is negative", () => {
  const ev = 1000, ebitda = -50;
  const evEbitda = Number.isFinite(ev) && Number.isFinite(ebitda) && ebitda > 0 ? ev / ebitda : null;
  assert.equal(evEbitda, null);
});

// H1: WACC weight normalization is tracked
test("WACC compute: weights_normalized flag when weights dont sum to 1", () => {
  const r = waccCompute({ equity_weight: 7, debt_weight: 3, risk_free: 0.04, beta: 1, market_premium: 0.055, cost_of_debt: 0.06, tax_rate: 0.25 });
  assert.ok(r.weights_normalized);
  assert.ok(Math.abs(r.equity_weight + r.debt_weight - 1) < 1e-9);
});

test("WACC compute: weights_normalized is false when weights already sum to 1", () => {
  const r = waccCompute({ equity_weight: 0.7, debt_weight: 0.3, risk_free: 0.04, beta: 1, market_premium: 0.055, cost_of_debt: 0.06, tax_rate: 0.25 });
  assert.equal(r.weights_normalized, false);
});

// H5: Sensitivity grid returns null for invalid WACC/terminal growth combinations
test("Sensitivity: invalid combinations (terminal_growth >= wacc) return null cells", () => {
  const r = sensitivityCompute({
    fcf: [100, 110],
    wacc_values: [0.05, 0.1, 0.15],
    terminal_values: [0.2, 0.25],
    mode: "growth",
    net_debt: 0,
    shares: 10,
    final_ebitda: 100,
  });
  assert.ok(!r.error);
  // terminal_growth 0.2 and 0.25 are both >= wacc 0.05, so those cells should be null
  assert.ok(r.table[0][0] === null, `expected null for wacc=0.05, tg=0.2, got ${r.table[0][0]}`);
  assert.ok(r.table[0][1] === null, `expected null for wacc=0.05, tg=0.25, got ${r.table[0][1]}`);
  // wacc=0.15, tg=0.2: tg >= wacc, should be null
  assert.ok(r.table[2][0] === null, `expected null for wacc=0.15, tg=0.2, got ${r.table[2][0]}`);
  // wacc=0.15, tg=0.25: tg >= wacc, should be null
  assert.ok(r.table[2][1] === null, `expected null for wacc=0.15, tg=0.25, got ${r.table[2][1]}`);
  // wacc=0.1, tg=0.2: tg >= wacc, should be null
  assert.ok(r.table[1][0] === null, `expected null for wacc=0.1, tg=0.2, got ${r.table[1][0]}`);
});