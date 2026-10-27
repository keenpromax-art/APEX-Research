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

const { dcfCompute, reverseDcfCompute, waccCompute } = require(path.join(OUT_DIR, "api.js"));

test("WACC weights normalize to one", () => {
  const r = waccCompute({ equity_weight: 7, debt_weight: 3, risk_free: 0.04, beta: 1, market_premium: 0.055, cost_of_debt: 0.06, tax_rate: 0.25 });
  assert.ok(Math.abs(r.equity_weight + r.debt_weight - 1) < 1e-9);
  assert.ok(r.weights_normalized);
});

test("DCF terminal growth below WACC", () => {
  const r = dcfCompute({ fcf: [100, 110], wacc: 0.1, terminal_growth: 0.2, net_debt: 0, shares: 10 });
  assert.ok(r.terminal_growth < r.wacc);
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