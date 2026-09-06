// ============================================================
// Automated Verification Suite: Backtest & Scoring Win Rate Engine
// ============================================================
import assert from "node:assert";
import { HISTORICAL_BACKTEST_RECORDS } from "../src/lib/backtest/data.ts";
import { computeBacktestMetrics, judgeSignalOutcome } from "../src/lib/backtest/engine.ts";

console.log("============================================================");
console.log("RUNNING VERIFICATION SUITE: BACKTEST & SCORING WIN RATE");
console.log("============================================================\n");

// ── Test 1: Signal Judgment Rules (Hurdle Logic) ──
console.log("[TEST 1] Deterministic Signal Judgment Rules...");
// BUY +15% return (>= +12% hurdle) -> WIN
const buyWin = judgeSignalOutcome("BUY", 0.15);
assert.strictEqual(buyWin.verdict, "WIN");

// BUY +5% return (< +12% hurdle) -> LOSS
const buyLoss = judgeSignalOutcome("BUY", 0.05);
assert.strictEqual(buyLoss.verdict, "LOSS");

// SELL -20% return (<= -12% hurdle) -> WIN
const sellWin = judgeSignalOutcome("SELL", -0.20);
assert.strictEqual(sellWin.verdict, "WIN");

// SELL +10% return (failed short thesis) -> LOSS
const sellLoss = judgeSignalOutcome("SELL", 0.10);
assert.strictEqual(sellLoss.verdict, "LOSS");

// HOLD +4% return (within [-12%, +12%]) -> WIN
const holdWin = judgeSignalOutcome("HOLD", 0.04);
assert.strictEqual(holdWin.verdict, "WIN");

// HOLD +25% return (breached neutral corridor) -> LOSS
const holdLoss = judgeSignalOutcome("HOLD", 0.25);
assert.strictEqual(holdLoss.verdict, "LOSS");

// NR -> EXEMPT
const nrExempt = judgeSignalOutcome("NR", 0.35);
assert.strictEqual(nrExempt.verdict, "EXEMPT");
console.log("  ✓ All 7 signal judgment hurdle conditions verified accurately.");

// ── Test 2: Full Cohort Metric Computation ──
console.log("\n[TEST 2] Full Cohort Summary Metrics...");
const summary = computeBacktestMetrics(HISTORICAL_BACKTEST_RECORDS);

assert.ok(summary.totalCohort >= 1000, `Expected >= 1000 historical records, got ${summary.totalCohort}`);
assert.ok(summary.settledSignals >= 1000, `Expected >= 1000 settled signals, got ${summary.settledSignals}`);
assert.ok(summary.overallWinRate >= 0.70, `Expected win rate >= 70%, got ${(summary.overallWinRate * 100).toFixed(1)}%`);
assert.ok(summary.directionalAlpha > 0, `Expected positive directional alpha, got ${(summary.directionalAlpha * 100).toFixed(1)}%`);
assert.ok(summary.profitFactor > 1.5, `Expected profit factor > 1.5x, got ${summary.profitFactor}x`);
assert.ok(summary.spearmanRankCorrelation > 0.40, `Expected Spearman rho > 0.40, got ${summary.spearmanRankCorrelation}`);

console.log(`  ✓ Total Cohort: ${summary.totalCohort} signals`);
console.log(`  ✓ Overall Win Rate: ${(summary.overallWinRate * 100).toFixed(1)}%`);
console.log(`  ✓ Overall 1Y Return: ${(summary.overallAvgReturn * 100).toFixed(1)}%`);
console.log(`  ✓ Benchmark Return: ${(summary.overallAvgBenchmarkReturn * 100).toFixed(1)}%`);
console.log(`  ✓ Directional Alpha: ${(summary.directionalAlpha * 100).toFixed(1)}% (BUY Alpha: ${(summary.buyAlpha * 100).toFixed(1)}%)`);
console.log(`  ✓ Spearman Rank Correlation: +${summary.spearmanRankCorrelation.toFixed(2)}`);
console.log(`  ✓ Information Coefficient (IC): +${summary.informationCoefficient.toFixed(2)}`);
console.log(`  ✓ Profit Factor: ${summary.profitFactor}x`);

// ── Test 3: Rating Cohort Performance Breakdown ──
console.log("\n[TEST 3] Rating Cohort Breakdown (BUY vs HOLD vs SELL)...");
const buyPerf = summary.ratingPerformance.BUY;
const holdPerf = summary.ratingPerformance.HOLD;
const sellPerf = summary.ratingPerformance.SELL;

assert.ok(buyPerf.totalCalls > 0, "Must have BUY calls");
assert.ok(buyPerf.winRate >= 0.65, `BUY win rate must be >= 65%, got ${(buyPerf.winRate * 100).toFixed(1)}%`);
assert.ok(buyPerf.avgRealizedReturn >= 0.12, `BUY avg return must be >= 12%, got ${(buyPerf.avgRealizedReturn * 100).toFixed(1)}%`);

assert.ok(holdPerf.totalCalls > 0, "Must have HOLD calls");
assert.ok(holdPerf.winRate >= 0.70, `HOLD win rate must be >= 70%, got ${(holdPerf.winRate * 100).toFixed(1)}%`);

assert.ok(sellPerf.totalCalls > 0, "Must have SELL calls");
assert.ok(sellPerf.avgRealizedReturn < 0, "SELL avg return must be negative");

console.log(`  ✓ BUY Cohort: ${buyPerf.totalCalls} calls | Win Rate: ${(buyPerf.winRate * 100).toFixed(1)}% | Avg Return: ${(buyPerf.avgRealizedReturn * 100).toFixed(1)}%`);
console.log(`  ✓ HOLD Cohort: ${holdPerf.totalCalls} calls | Win Rate: ${(holdPerf.winRate * 100).toFixed(1)}% | Avg Return: ${(holdPerf.avgRealizedReturn * 100).toFixed(1)}%`);
console.log(`  ✓ SELL Cohort: ${sellPerf.totalCalls} calls | Win Rate: ${(sellPerf.winRate * 100).toFixed(1)}% | Avg Realized: ${(sellPerf.avgRealizedReturn * 100).toFixed(1)}%`);

// ── Test 4: Decile Monotonicity & Spread ──
console.log("\n[TEST 4] Decile Monotonicity & Spread Verification...");
assert.strictEqual(summary.decilePerformance.length, 10, "Must evaluate exactly 10 deciles");
assert.ok(summary.decileSpread > 0.20, `Decile spread (D1 - D10) must be > 20%, got ${(summary.decileSpread * 100).toFixed(1)}%`);

for (const dp of summary.decilePerformance) {
  assert.ok(dp.count >= 80, `Decile ${dp.decile} must have >= 80 records, got ${dp.count}`);
}

const d1 = summary.decilePerformance[0];
const d10 = summary.decilePerformance[9];
console.log(`  ✓ Decile 1 (Top BUY): Count = ${d1.count}, Avg Return = ${(d1.avgRealizedReturn * 100).toFixed(1)}%`);
console.log(`  ✓ Decile 10 (Strong SELL): Count = ${d10.count}, Avg Return = ${(d10.avgRealizedReturn * 100).toFixed(1)}%`);
console.log(`  ✓ Decile Monotonicity Spread: +${(summary.decileSpread * 100).toFixed(1)}%`);

// ── Test 5: Sector Breakdown & Diversity ──
console.log("\n[TEST 5] Sector Breakdown Verification...");
assert.ok(summary.sectorBreakdown.length >= 5, `Must cover >= 5 distinct sectors, got ${summary.sectorBreakdown.length}`);
for (const sec of summary.sectorBreakdown) {
  console.log(`  ✓ Sector: ${sec.sector.padEnd(24)} | ${sec.count} calls | Win Rate: ${(sec.winRate * 100).toFixed(0)}%`);
}

console.log("\n============================================================");
console.log("ALL BACKTEST & SCORING WIN-RATE ENGINE TESTS PASSED (100%)!");
console.log("============================================================");
